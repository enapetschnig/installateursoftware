// ────────────────────────────────────────────────────────────────────────────
//  VoiceAngebotDialog – Modal zur Erstellung eines kompletten Angebots
//                       per Spracheingabe.
//
//  Phase 5 – verbindet die portierten Module aus Phase 1-4 mit der UI:
//    1. SpeechInput (Mic + 4-Felder) liefert den Roh-Text
//    2. extractErgaenzungenHinweise()  trennt Hinweise/Ergaenzungen ab
//    3. extractFields() parst Projektnummer/Adresse/Betrifft aus dem
//       zusammengebauten Text fuer die Meta-Daten
//    4. buildPrompt(KOMPLETT_ANGEBOT_PROMPT, ctx) → systemPrompt
//    5. aiComplete() → Roh-JSON von der KI
//    6. parseJsonResponse<T>() → { betreff?, adresse?, gewerke }
//    7. runCalcPipeline() → finale, gerechnete Gewerk-Liste
//    8. onComplete(gewerke, meta) → der OfferEditor uebernimmt die Daten
//
//  Sichtbar im OfferEditor laut User-Constraint NUR wenn:
//      head.status === "entwurf"  UND  builder.positionen.length === 0
//  Diese Pruefung passiert beim Aufrufer; der Dialog selbst kennt diese
//  Regel nicht und wird ausschliesslich durch `open` gesteuert.
//
//  Layout:
//    - Halbtransparenter Overlay (z-50)
//    - Glassmorphism-Container (~600px breit, max-h:90vh)
//    - SpeechInput mit enableBullets=true und Label "Generieren"
//    - Statuszeile: "Bereit" → "KI generiert..." → "Pipeline rechnet..." → "Fertig"
//    - Buttons: "Abbrechen" + Generieren wird via SpeechInput-Submit ausgeloest
//
//  Error-Handling: bei jedem Schritt fangen wir Fehler und schreiben sie
//  in `status.error`. Der User sieht die exakte Fehlermeldung; ein Retry
//  ist via erneutem Senden moeglich.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../ui'

import { SpeechInput, type SpeechInputProps } from './SpeechInput'
import { extractErgaenzungenHinweise, extractFields } from '../../lib/speech/extractFields'
import {
  aiComplete as defaultAiComplete,
  type AiCompleteOpts,
  type AiCompleteResult,
} from '../../lib/ai/aiComplete'
import { parseJsonResponse } from '../../lib/ai/parseJson'
import { KOMPLETT_ANGEBOT_PROMPT } from '../../lib/ai/prompts/komplettangebot'
import {
  buildPrompt,
  buildFilteredCatalog,
  type PromptContext,
} from '../../lib/ai/prompts/base'
import { runCalcPipeline } from '../../lib/calc/pipeline'
import { logVoiceTranscript } from '../../lib/voice/logVoiceTranscript'
import type { BetriebsGewerk, Fachregel, Richtwert } from '../../lib/voice/loadStammdatenForVoice'
import { searchCatalogForTranscript, buildWholesaleBlock, applyWholesalePricing, splitMaterialArbeit, stuecklistenDeckungHints, detectMarken, detectUnknownMarken, type CatalogHit } from '../../lib/wholesale'
import type {
  Catalog,
  Gewerk,
  KalkSettings,
  StundensaetzeMap,
} from '../../lib/calc/types'
import { DEFAULT_KALK_SETTINGS } from '../../lib/calc/types'

// ──────────────────────────── Types ────────────────────────────────────────

export interface VoiceAngebotDialogMeta {
  betrifft?: string
  /** Ergaenzungen aus dem Roh-Text (separat extrahiert). */
  ergaenzungen?: string[]
  /** Hinweise aus dem Roh-Text (separat extrahiert). */
  hinweise?: string[]
  /** Rückfragen der KI (preisrelevante Lücken) – der Dialog zeigt sie VOR der Übernahme. */
  rueckfragen?: string[]
}

export interface VoiceAngebotDialogProps {
  open: boolean
  onClose: () => void
  onComplete: (gewerke: Gewerk[], meta: VoiceAngebotDialogMeta) => void
  /** Fuer {{FIRMA_NAME}} im Prompt, Fallback "BAU4YOU". */
  organizationName?: string
  /** Wenn vorhanden, an Pipeline weiterreichen. */
  catalog?: Catalog
  stundensaetze?: StundensaetzeMap
  settings?: KalkSettings
  /** Handelsübliche Richtwert-Spannen (Migr. 0150). */
  richtwerte?: Richtwert[]
  /** Aktive Gewerke des Betriebs (Angebots-Gliederung). */
  gewerkeProfil?: BetriebsGewerk[]
  /** Fachwissen-Regeln (Migr. 0155) – Mitdenken + Rückfragen. */
  fachregeln?: Fachregel[]
  // ── Test-Injection-Points ────────────────────────────────────────────────
  /** Override fuer aiComplete (Tests). */
  aiCompleteImpl?: (opts: AiCompleteOpts) => Promise<AiCompleteResult>
  /** Override fuer runCalcPipeline (Tests). */
  runCalcPipelineImpl?: typeof runCalcPipeline
  /** Override fuer extractErgaenzungenHinweise (Tests). */
  extractErgaenzungenHinweiseImpl?: typeof extractErgaenzungenHinweise
  /** Override fuer parseJsonResponse (Tests). */
  parseJsonResponseImpl?: <T = unknown>(text: string) => T
}

// ──────────────────────────── Status ───────────────────────────────────────

export type VoiceAngebotStatus =
  | { phase: 'idle' }
  | { phase: 'wholesale' }
  | { phase: 'ai'; wholesaleHits?: number }
  | { phase: 'pipeline' }
  | { phase: 'done' }
  | { phase: 'error'; error: string }

function statusLabel(s: VoiceAngebotStatus): string {
  switch (s.phase) {
    case 'idle':
      return 'Bereit'
    case 'wholesale':
      return 'Durchsuche Großhandelskatalog …'
    case 'ai':
      return s.wholesaleHits
        ? `KI kalkuliert das Angebot (${s.wholesaleHits} Katalog-Artikel mit echten Einkaufspreisen gefunden) …`
        : 'KI kalkuliert das Angebot …'
    case 'pipeline':
      return 'Positionen werden geprüft und kalkuliert …'
    case 'done':
      return 'Fertig'
    case 'error':
      return `Fehler: ${s.error}`
  }
}

// ──────────────────────────── Pure Logic (test-friendly) ───────────────────

/**
 *  Erwartete Shape der KI-Antwort. Felder sind alle optional, weil verschiedene
 *  Prompt-Varianten unterschiedlich befuellen koennen; der einzig zwingende
 *  Vertrag ist `gewerke: Gewerk[]`.
 */
export interface KomplettAngebotResponse {
  betreff?: string | null
  adresse?: string | null
  gewerke: Gewerk[]
  /** Mitdenken: offene Punkte, die der Chef vor Versand klären sollte. */
  fehlt_moeglicherweise?: string[] | null
  /** Rückfragen des Kalkulators (Fachregeln, Migr. 0155) – preisrelevante Lücken. */
  rueckfragen?: string[] | null
}

/**
 *  Reine Kern-Logik des Dialogs – KEIN React, KEIN DOM. Trennt Tests von der
 *  UI-Schicht. Wird sowohl vom Component intern als auch direkt aus Tests
 *  aufgerufen (s. VoiceAngebotDialog.test.ts).
 *
 *  Reihenfolge (1:1 wie im Modul-Auftrag beschrieben):
 *    1. extractErgaenzungenHinweise(text)
 *    2. buildPrompt(KOMPLETT_ANGEBOT_PROMPT, ctx)
 *    3. aiComplete({ systemPrompt, userMessage: cleanedText, ... })
 *    4. parseJsonResponse(result.text)
 *    5. runCalcPipeline(gewerke, opts)
 *
 *  Meta-Daten kommen primaer aus der KI-Antwort (betreff/adresse); falls die
 *  KI null liefert, fallen wir auf die Felder zurueck, die extractFields aus
 *  dem Roh-Text holt (Projektnummer steht im Header und kommt NIEMALS aus
 *  der KI – die ist explizit verboten im Prompt, Z. 354).
 */
export interface RunVoiceAngebotDeps {
  aiComplete: (opts: AiCompleteOpts) => Promise<AiCompleteResult>
  runCalcPipeline: typeof runCalcPipeline
  extractErgaenzungenHinweise: typeof extractErgaenzungenHinweise
  parseJsonResponse: <T = unknown>(text: string) => T
}

export interface RunVoiceAngebotArgs {
  text: string
  organizationName: string
  catalog: Catalog
  stundensaetze: StundensaetzeMap
  settings: KalkSettings
  /** Handelsübliche Richtwert-Spannen (Migr. 0150) – Prompt-Kalibrierung + Guard. */
  richtwerte?: Richtwert[]
  /** Aktive Gewerke des Betriebs – bestimmt die Angebots-Gliederung der KI. */
  gewerkeProfil?: BetriebsGewerk[]
  /** Fachwissen-Regeln des Betriebs (Migr. 0155) – Mitdenken + Rückfragen. */
  fachregeln?: Fachregel[]
  onStatus?: (s: VoiceAngebotStatus) => void
}

export interface RunVoiceAngebotResult {
  gewerke: Gewerk[]
  meta: VoiceAngebotDialogMeta
}

/**
 * Plausibilitäts-Wache: erkennt offensichtlich unglaubwürdige Preise/Mengen
 * in Neu-Kalkulationen. Erfindet KEINE Preise – sie meldet nur Prüf-Hinweise
 * (Mitdenken-Prinzip: aufzeigen statt raten).
 */
export function plausibilityHints(gewerke: Gewerk[], richtwerte: Richtwert[] = [], transcript = ''): string[] {
  const hints: string[] = []

  // ── Deterministische Wächter (LLM-Varianz-Netz) ──────────────────────────
  // 1) MARKENTREUE: Diktiert der Kunde eine Marke, muss sie im Ergebnis
  //    auftauchen (Positionsname/Beschreibung). Sonst wurde still getauscht.
  if (transcript) {
    const dump = JSON.stringify(gewerke).toLowerCase()
    for (const marke of detectMarken(transcript)) {
      if (!dump.includes(marke)) {
        hints.push(`Prüfen: Marke „${marke.charAt(0).toUpperCase()}${marke.slice(1)}“ wurde diktiert, taucht aber in keiner Position auf – Artikelwahl prüfen.`)
      }
    }
    // 2) AUFSCHLÜSSELUNG: Werden im Diktat mehr Komponenten-Klassen genannt,
    //    als Positionen entstanden sind, wurde vermutlich geklumpt.
    const KLASSEN: Array<[string, RegExp]> = [
      ['Verteiler', /unterverteil|verteilerkasten|sicherungskasten|verteilung/i],
      ['FI', /\bfi\b|fehlerstrom/i],
      ['LS-Automaten', /leitungsschutz|\bls\b|automat/i],
      ['Steckdosen', /steckdose/i],
      ['Schalter', /(?<![a-zäöü-])schalter|taster|dimmer/i],
      ['SAT/Antenne', /\bsat\b|antennen/i],
      ['Leitung', /leitung(?!sschutz)|kabel|nym/i],
    ]
    const genannt = KLASSEN.filter(([, re]) => re.test(transcript)).map(([k]) => k)
    const posCount = gewerke.reduce((n, g) => n + (g.positionen?.length ?? 0), 0)
    if (genannt.length > posCount) {
      hints.push(
        `Prüfen: ${genannt.length} Komponenten-Gruppen diktiert (${genannt.join(', ')}), aber nur ` +
        `${posCount} Position(en) erstellt – jede Komponente sollte eine eigene Position sein.`,
      )
    }
  }
  const arbeit = /demontage|montage|einbau|ausbau|installation|austausch|tausch|entsorgung|verlegen|anschließen|abdichten|sanierung/i
  for (const g of gewerke) {
    for (const p of g.positionen ?? []) {
      const vk = Number(p.vk_netto_einheit ?? 0)
      const menge = Number(p.menge ?? 0)
      const einheit = String(p.einheit ?? '').toLowerCase()
      const name = String(p.leistungsname ?? '')
      // Datengetriebene Richtwert-Prüfung (company_settings.kalk_richtwerte):
      // Neu-Kalkulationen außerhalb der handelsüblichen Spanne melden –
      // nur Hinweis, nie Preisänderung. Faktor 0,7/1,3 = Toleranz gegen
      // legitime Sonderfälle (Altbau, Anfahrt, Materialqualität).
      if (!p.aus_preisliste && vk > 0 && !p.ist_materialposition) {
        for (const r of richtwerte) {
          let re: RegExp
          try { re = new RegExp(r.stichwort, 'i') } catch { continue }
          if (!re.test(name)) continue
          if (vk < r.vk_min * 0.7 || vk > r.vk_max * 1.3) {
            hints.push(
              `Prüfen: „${name}“ – ${vk.toFixed(2)} € liegt außerhalb des handelsüblichen Richtwerts ` +
              `${r.vk_min}–${r.vk_max} € (${r.bezeichnung}).`,
            )
          }
          break // nur der erste passende Richtwert je Position
        }
      }
      // Gilt für ALLE Positionen (auch Preisliste): 0-€-Zeilen und
      // Mengen-Ausreißer bei Pauschalen dürfen nie unbemerkt durchrutschen.
      if (vk <= 0) {
        hints.push(`Prüfen: „${name}“ hat keinen Preis (0 €) – Stammdaten-VK fehlt oder Position entfernen.`)
      }
      if (/pausch|psch/.test(einheit) && menge > 1) {
        hints.push(`Prüfen: „${name}“ – Menge ${menge} bei Einheit „pauschal“ wirkt falsch (Menge 1?).`)
      }
      if (p.aus_preisliste) continue
      if (arbeit.test(name) && /pausch|psch/.test(einheit) && vk > 0 && vk < 50) {
        hints.push(`Prüfen: „${name}“ wirkt mit ${vk.toFixed(2)} € pauschal unplausibel niedrig kalkuliert.`)
      }
      if (vk > 5000 && /^(m|lfm|m²|m2|mtr)/.test(einheit)) {
        hints.push(`Prüfen: „${name}“ – ${vk.toFixed(2)} € je ${p.einheit} wirkt sehr hoch (Zahlendreher?).`)
      }
      if (menge > 500 && /st(k|ück)?/.test(einheit)) {
        hints.push(`Prüfen: „${name}“ – Menge ${menge} Stück wirkt sehr hoch (Verhörer?).`)
      }
    }
  }
  return hints
}

export async function runVoiceAngebot(
  args: RunVoiceAngebotArgs,
  deps: RunVoiceAngebotDeps,
): Promise<RunVoiceAngebotResult> {
  // ── 1. Ergaenzungen / Hinweise ausschneiden ─────────────────────────────
  const { cleanedText, ergaenzungen, hinweise } =
    deps.extractErgaenzungenHinweise(args.text)

  // Aus dem (urspruenglichen) Text extrahieren wir die User-Header-Felder
  // (Projektnummer/Adresse/Betrifft). Diese sind unsere FALLBACK-Quelle fuer
  // Meta, falls die KI sie nicht liefert.
  const userFields = extractFields(args.text)

  // ── 2. Prompt bauen ──────────────────────────────────────────────────────
  const promptCtx: PromptContext = {
    firmaName: args.organizationName || 'BAU4YOU',
    stundensaetze: args.stundensaetze,
    aufschlagGesamt: args.settings.aufschlagGesamt,
    aufschlagMaterial: args.settings.aufschlagMaterial,
    richtwerte: args.richtwerte,
    gewerke: args.gewerkeProfil,
    autoNebenpositionen: args.settings.autoNebenpositionen,
    fachregeln: args.fachregeln,
  }
  const systemPrompt = buildPrompt(KOMPLETT_ANGEBOT_PROMPT, promptCtx)

  // ── 3. KI-Call ───────────────────────────────────────────────────────────
  const userMessage = (cleanedText || args.text).trim()
  if (!userMessage) {
    throw new Error('Kein Text zum Senden vorhanden.')
  }
  args.onStatus?.({ phase: 'wholesale' })

  // Preisliste in den Prompt injizieren: der KOMPLETT_ANGEBOT_PROMPT verweist
  // explizit auf die "kompakte Preisliste" (Synonym-Matching, aus_preisliste-
  // Flag) — ohne diesen Block raet die KI Preise statt die Stammdaten zu
  // nutzen. buildFilteredCatalog reduziert per Gewerk-Keyword-Matching auf
  // max. 100 relevante Eintraege (~2-3k Token statt ~25k).
  const catalogBlock = buildFilteredCatalog(args.catalog, userMessage)

  // Großhandels-Retrieval: aus 600.000+ Katalog-Artikeln holt die DB-Suche
  // (pg_trgm) die zum Transkript passenden ~36 Artikel mit ECHTEM EK
  // (Liste − Kundenrabatt bzw. Nettopreis). Ist kein Katalog importiert,
  // bleibt der Block leer und der Flow verhält sich exakt wie bisher.
  let wholesaleBlock = ''
  let wholesaleHits: CatalogHit[] = []
  try {
    wholesaleHits = await searchCatalogForTranscript(userMessage)
    wholesaleBlock = buildWholesaleBlock(wholesaleHits)
  } catch {
    /* Katalog ist Zusatznutzen – Voice-Angebot darf daran nie scheitern */
  }

  args.onStatus?.({ phase: 'ai', wholesaleHits: wholesaleHits.length })

  const cachedContext =
    `PREISLISTE (Auszug, gefiltert nach erkannten Gewerken):\n${catalogBlock}` +
    (wholesaleBlock ? `\n\n${wholesaleBlock}` : '')

  const aiResult = await deps.aiComplete({
    systemPrompt,
    userMessage,
    cachedContext,
    // 8000 statt 16000: ein vollstaendiges Angebot mit ~30 Gewerken bleibt
    // selten ueber ~5000 Output-Tokens; 8000 reicht mit Reserve. Halbiert
    // die Roundtrip-Zeit (gpt-4o-mini ~15-25 s statt 30-45 s) — wichtig
    // wegen Vercel-Function-Timeout (siehe vercel.json maxDuration).
    maxTokens: 8000,
    // Voice-Angebot erwartet zwingend JSON → Backend in JSON-Modus zwingen.
    responseFormat: 'json',
  })

  // ── 4. JSON parsen (mit EINEM Wiederholungsversuch) ─────────────────────
  // gpt-4o-mini liefert selten abgeschnittenes/ungültiges JSON. Ein einzelner
  // erneuter Anlauf behebt das fast immer – besser als den Nutzer nach 30 s
  // Aufnahme mit einem Fehler stehen zu lassen.
  let parsed: KomplettAngebotResponse
  try {
    parsed = deps.parseJsonResponse<KomplettAngebotResponse>(aiResult.text)
  } catch {
    const retry = await deps.aiComplete({
      systemPrompt,
      userMessage,
      cachedContext,
      maxTokens: 8000,
      responseFormat: 'json',
    })
    parsed = deps.parseJsonResponse<KomplettAngebotResponse>(retry.text)
  }
  const gewerke: Gewerk[] = Array.isArray(parsed?.gewerke) ? parsed.gewerke : []
  if (gewerke.length === 0) {
    throw new Error('Die KI hat keine Gewerke geliefert. Bitte erneut versuchen.')
  }

  // ── 5. Calc-Pipeline laufen lassen ───────────────────────────────────────
  args.onStatus?.({ phase: 'pipeline' })
  // Material-Positionen mit Katalog-Artikel DETERMINISTISCH bepreisen –
  // das LLM liefert nur Artikelnummer + Zeitschätzung, die Mathematik
  // (EK × Aufschlag + Minuten × Stundensatz) macht der Code. Läuft VOR der
  // Pipeline, damit fixNullpreise/Sortierung mit echten Preisen arbeiten.
  applyWholesalePricing(gewerke, wholesaleHits, {
    aufschlagMaterialProzent: args.settings.aufschlagMaterial,
    stundensatzDefault: args.settings.stundensatzDefault,
    // Gleiche Kalibrierung wie die Prompt-Formel (Material×1,3 + Lohn)×1,2 –
    // ohne Gesamtaufschlag lagen Katalog-Positionen systematisch ~17 % zu tief.
    aufschlagGesamtProzent: args.settings.aufschlagGesamt,
  })

  let processed = deps.runCalcPipeline(gewerke, {
    eingabeText: userMessage,
    catalog: args.catalog,
    stundensaetze: args.stundensaetze,
    settings: args.settings,
    // Diktierte Stundenzahlen ("dafuer brauchen wir 6 Stunden") haben Vorrang
    // vor der KI-Schaetzung — enforceUserZeitangabe matcht die Zahl aus dem
    // Eingabetext gegen die Position und ueberschreibt arbeitszeit_h.
    // Stage + Tests existieren seit Phase 4; das Flag war nur nie gesetzt.
    enforceUserStunden: true,
  })

  // Deckungs-/Pflicht-Guards laufen auf den KOMBINIERTEN Positionen (vor dem
  // Angebotsformat-Split, solange die Stücklisten noch an den Positionen hängen).
  const deckungHints = stuecklistenDeckungHints(processed as never, userMessage)
  const pflichtHints: string[] = []
  {
    const dump = JSON.stringify(processed).toLowerCase()
    for (const regel of args.fachregeln ?? []) {
      if (!regel.pflicht_muster) continue
      let wenn: RegExp, muss: RegExp
      try { wenn = new RegExp(regel.stichwort, 'i'); muss = new RegExp(regel.pflicht_muster, 'i') } catch { continue }
      if (!wenn.test(userMessage)) continue
      if (muss.test(dump)) continue
      pflichtHints.push(`Prüfen: Fachregel „${regel.stichwort.split('|')[0]}“ – im Angebot fehlt: ${regel.pflicht_muster.split('|').join('/')}.`)
    }
  }

  // Angebotsformat "material_lohn_getrennt" (Elektriker-Stil, Migr. 0157):
  // Materialliste + separate Arbeitszeit – rein deterministisch aus den
  // aufgelösten Stücklisten geformt, NACH der Pipeline (kein LLM-Risiko).
  if (args.settings.angebotsformat === 'material_lohn_getrennt') {
    splitMaterialArbeit(processed as never, {
      aufschlagMaterialProzent: args.settings.aufschlagMaterial,
      aufschlagGesamtProzent: args.settings.aufschlagGesamt,
      stundensatzDefault: args.settings.stundensatzDefault,
      stundensaetze: args.stundensaetze,
    })
    processed = [...processed]
  }

  // ── 6. Meta zusammensetzen ───────────────────────────────────────────────
  // Projektnummer + Adresse werden NICHT mehr aus der Sprache uebernommen:
  //   - Projektnummer: ueber Projekt-Dropdown im Editor (2026-06-24).
  //   - Adresse: kommt aus dem im Pre-Step-Modal gewaehlten Kunden (2026-06-30).
  // Falls die KI sie trotzdem zurueckgibt, wird sie hier ignoriert.
  // Mitdenken: KI-Hinweise auf mögliche Lücken in die Meta-Hinweise mergen –
  // sie landen über mergeVoiceNotes() als interne Notiz am Angebot.
  const kiHinweise = (Array.isArray(parsed?.fehlt_moeglicherweise) ? parsed.fehlt_moeglicherweise : [])
    .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    .map((h) => `Prüfen: ${h.trim()}`)
    .concat(deckungHints, pflichtHints, plausibilityHints(processed, args.richtwerte ?? [], userMessage))

  const alleHinweise = [...hinweise, ...kiHinweise]
  const rueckfragen = (Array.isArray(parsed?.rueckfragen) ? parsed.rueckfragen : [])
    .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    .slice(0, 3)
  // Verhörte/unbekannte Marken ("Schierer" statt "Gira") NIE still bepreisen –
  // immer nachfragen, bevor Fantasiepreise ins Angebot wandern.
  for (const unbekannt of detectUnknownMarken(userMessage, wholesaleHits)) {
    if (rueckfragen.length >= 4) break
    rueckfragen.push(
      `Die Marke „${unbekannt}“ ist im Großhandelskatalog nicht auffindbar – welche Marke ist gemeint (z. B. Gira, Berker, Jung, Hager)?`,
    )
  }
  const meta: VoiceAngebotDialogMeta = {
    betrifft:
      (parsed.betreff?.trim() || userFields.betrifft?.trim()) || undefined,
    ergaenzungen: ergaenzungen.length > 0 ? ergaenzungen : undefined,
    hinweise: alleHinweise.length > 0 ? alleHinweise : undefined,
    rueckfragen: rueckfragen.length > 0 ? rueckfragen : undefined,
  }

  args.onStatus?.({ phase: 'done' })
  return { gewerke: processed, meta }
}

// ──────────────────────────── Component ────────────────────────────────────

export function VoiceAngebotDialog({
  open,
  onClose,
  onComplete,
  organizationName,
  catalog,
  stundensaetze,
  settings,
  richtwerte,
  gewerkeProfil,
  fachregeln,
  aiCompleteImpl,
  runCalcPipelineImpl,
  extractErgaenzungenHinweiseImpl,
  parseJsonResponseImpl,
}: VoiceAngebotDialogProps) {
  const [status, setStatus] = useState<VoiceAngebotStatus>({ phase: 'idle' })
  // Rückfragen-Runde: Ergebnis zwischenparken, Fragen zeigen, Antwort einholen,
  // einmal neu kalkulieren (answeredRef verhindert Endlos-Frage-Schleifen).
  const [pendingFragen, setPendingFragen] = useState<{ result: RunVoiceAngebotResult; text: string } | null>(null)
  const [antwortText, setAntwortText] = useState('')
  const answeredRef = useRef(false)

  // Status zuruecksetzen, sobald das Modal geoeffnet wird.
  useEffect(() => {
    if (open) {
      setStatus({ phase: 'idle' })
      setPendingFragen(null)
      setAntwortText('')
      answeredRef.current = false
    }
  }, [open])

  // Body-Scroll sperren waehrend Modal offen.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const isBusy = status.phase === 'ai' || status.phase === 'pipeline'

  // Stabile Dependencies (memo) damit der Handler nicht jeden Render neu gebunden wird.
  const deps = useMemo<RunVoiceAngebotDeps>(
    () => ({
      aiComplete: aiCompleteImpl ?? defaultAiComplete,
      runCalcPipeline: runCalcPipelineImpl ?? runCalcPipeline,
      extractErgaenzungenHinweise:
        extractErgaenzungenHinweiseImpl ?? extractErgaenzungenHinweise,
      parseJsonResponse:
        (parseJsonResponseImpl as RunVoiceAngebotDeps['parseJsonResponse']) ??
        parseJsonResponse,
    }),
    [
      aiCompleteImpl,
      runCalcPipelineImpl,
      extractErgaenzungenHinweiseImpl,
      parseJsonResponseImpl,
    ],
  )

  // Onresult ist der "Generieren"-Trigger aus dem SpeechInput-Submit-Button.
  const handleSubmit = useCallback<NonNullable<SpeechInputProps['onResult']>>(
    async (text) => {
      if (isBusy) return
      try {
        const result = await runVoiceAngebot(
          {
            text,
            organizationName: organizationName || 'BAU4YOU',
            catalog: catalog ?? { positionen: [] },
            stundensaetze: stundensaetze ?? {},
            settings: settings ?? DEFAULT_KALK_SETTINGS,
            richtwerte: richtwerte ?? [],
            gewerkeProfil: gewerkeProfil ?? [],
            fachregeln: fachregeln ?? [],
            onStatus: setStatus,
          },
          deps,
        )
        // Audit-Trail (best-effort, non-blocking): fuettert voice_transcripts
        // → Cockpit-Wochenstatistik "Sprach-Angebote" + Nachvollziehbarkeit.
        // organization_id + created_by kommen aus den DB-Defaults
        // (current_org_id() / auth.uid()).
        void logVoiceTranscript({ transcript: text, producedOffer: true })
        const fragen = result.meta.rueckfragen ?? []
        if (fragen.length > 0 && !answeredRef.current) {
          // Der Kalkulator hat preisrelevante Rückfragen → erst klären,
          // dann (einmal) neu kalkulieren. Kein stilles Annehmen.
          setPendingFragen({ result, text })
          setStatus({ phase: 'idle' })
          return
        }
        // Nach der Antwortrunde verbleibende Rückfragen wandern als Hinweis
        // in die internen Notizen ("Vor dem Versand prüfen"-Modal).
        if (fragen.length > 0) {
          result.meta.hinweise = [
            ...(result.meta.hinweise ?? []),
            ...fragen.map((f) => `Prüfen: Offene Rückfrage – ${f}`),
          ]
        }
        onComplete(result.gewerke, result.meta)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        void logVoiceTranscript({
          transcript: text,
          producedOffer: false,
          errorMessage: msg,
        })
        setStatus({ phase: 'error', error: msg })
      }
    },
    [isBusy, organizationName, catalog, stundensaetze, settings, richtwerte, gewerkeProfil, fachregeln, deps, onComplete],
  )

  // Wir nutzen die zentrale b4y `Modal`-Komponente (Portal, Scroll-Lock,
  // einheitlicher Glassmorphism, Tokens) statt eines eigenen Overlays —
  // siehe docs/ui-guidelines.md und src/components/ui.tsx Z. 89.
  return (
    <Modal open={open} onClose={isBusy ? () => {} : onClose} title="Angebot per Sprache erstellen" size="xl">
      <div data-testid="voice-angebot-dialog">
        {/* Rückfragen-Runde: Der Kalkulator fragt nach wie ein echter Meister,
            BEVOR das Angebot übernommen wird. Antwort per Text (oder erneut
            per Sprache über das Eingabefeld) → einmalige Neu-Kalkulation. */}
        {pendingFragen ? (
          <div data-testid="voice-rueckfragen">
            <p className="text-sm font-semibold">Kurze Rückfragen zur Kalkulation:</p>
            <ul className="mt-2 space-y-1.5">
              {(pendingFragen.result.meta.rueckfragen ?? []).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }}>?</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <textarea
              className="input mt-3 min-h-[80px] text-sm"
              placeholder="Antworten eintippen – z. B. „6 Stromkreise, Überspannungsschutz ja, Gira reinweiß“"
              value={antwortText}
              onChange={(e) => setAntwortText(e.target.value)}
              data-testid="voice-rueckfragen-antwort"
            />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                className="btn-outline"
                onClick={() => {
                  // Ohne Antworten übernehmen: offene Fragen als Prüf-Hinweise mitgeben.
                  const r = pendingFragen.result
                  r.meta.hinweise = [
                    ...(r.meta.hinweise ?? []),
                    ...(r.meta.rueckfragen ?? []).map((f) => `Prüfen: Offene Rückfrage – ${f}`),
                  ]
                  setPendingFragen(null)
                  onComplete(r.gewerke, r.meta)
                }}
              >
                Mit Annahmen übernehmen
              </button>
              <button
                className="btn-primary"
                disabled={!antwortText.trim() || isBusy}
                onClick={() => {
                  answeredRef.current = true
                  const text = `${pendingFragen.text}\n\nANTWORTEN AUF RÜCKFRAGEN:\n${antwortText.trim()}`
                  setPendingFragen(null)
                  setAntwortText('')
                  void handleSubmit(text)
                }}
              >
                Antworten &amp; neu kalkulieren
              </button>
            </div>
          </div>
        ) : (
        <SpeechInput
          enableBullets
          disabled={isBusy}
          submitLabel="Generieren"
          placeholder="Sprich frei oder tippe die Positionen ein..."
          onResult={(text) => {
            void handleSubmit(text)
          }}
        />
        )}

        {/* Statusleiste – b4y-Tokens fuer Tone-Farben */}
        <div
          className="mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--border)', background: 'var(--hover)' }}
          data-testid="voice-angebot-dialog-status"
        >
          {isBusy && (
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
          )}
          <span
            style={{
              color:
                status.phase === 'error'
                  ? '#dc2626'
                  : status.phase === 'done'
                    ? '#16a34a'
                    : 'var(--text2)',
            }}
          >
            {statusLabel(status)}
          </span>
        </div>

        {/* Footer */}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            data-testid="voice-angebot-dialog-cancel"
            className="btn-secondary disabled:opacity-40"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default VoiceAngebotDialog
