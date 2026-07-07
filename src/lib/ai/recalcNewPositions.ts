// ────────────────────────────────────────────────────────────────────────────
//  recalcNewPositions – Nachkalkulation neuer / preisloser Positionen via KI.
//
//  Portiert aus bau4you-app/src/lib/claude.js Z. 430-503
//  (`recalcNewPositionsWithModus1`). Original-Verhalten 1:1 erhalten, nur:
//    • Provider-agnostisch: ruft keine `callClaudeWithSearch`, sondern eine
//      injectable `aiComplete`-Funktion (passend zu /api/ai/chat / gpt-4o).
//    • Web-Search SKIP in Phase 1 — `modus1Prompt` muss bereits ohne Search-
//      Tool-Calls funktionieren (höchster Wiener Marktpreis aus Trainings-
//      wissen).
//
//  Nachkalkuliert werden:
//    • Neue Positionen (`aus_preisliste === false`) – die KI hat sie frei
//      kalkuliert, die Modus-1-Pipeline soll die Preise schärfen.
//    • Katalog-Positionen mit 0 €-Preis (`vk_netto_einheit === 0`) – Preis
//      fehlt im Katalog, muss ermittelt werden.
//
//  Nie nachkalkuliert werden:
//    • Header-Positionen (`XX-000`).
//    • Spezial-Positionen (`XX-990` … `XX-999`: Regie, Material, Variable).
//    • Katalog-Positionen MIT echtem Preis (`aus_preisliste === true` und
//      `vk_netto_einheit > 0`).
//
//  Fehler-Verhalten:
//    Pro Position try/catch — schlägt ein einzelner aiComplete-Call fehl,
//    bleibt die Original-Position unverändert und die Pipeline läuft weiter.
//    Es wird nichts geworfen (Logger via console.warn).
// ────────────────────────────────────────────────────────────────────────────

import type { Gewerk, Position } from '../calc/types'
import { isSpecialPosition } from '../calc/dedup'
import { cleanWebSearchTags, parseJsonResponse } from './parseJson'
import type { AiCompleteOpts, AiCompleteResult } from './aiComplete'

/** Felder, die aus dem Modus-1-JSON in die Position übernommen werden. */
interface Modus1Recalc {
  vk_netto_einheit?: number | null
  gesamtpreis?: number | null
  materialkosten_einheit?: number | null
  materialanteil_prozent?: number | null
  lohnkosten_minuten?: number | null
  lohnkosten_einheit?: number | null
  lohnanteil_prozent?: number | null
  stundensatz?: number | null
  leistungsname?: string | null
  beschreibung?: string | null
}

export interface RecalcProgressInfo {
  /** 1-basiert: aktuelle Position. */
  current: number
  /** Gesamtzahl der zu kalkulierenden Positionen. */
  total: number
  /** Name der gerade verarbeiteten Position (für UI-Feedback). */
  positionName?: string
}

export interface RecalcOpts {
  /**
   * Vorbereiteter Modus-1-System-Prompt (z. B. via `buildPrompt('MODUS_1', …)`).
   * Wird unverändert als `systemPrompt` an `aiComplete` durchgereicht.
   */
  modus1Prompt: string
  /**
   * Injection-Point für KI-Aufruf — in Produktion `aiComplete` aus
   * `./aiComplete`, in Tests ein Mock. Erlaubt Test-Isolation ohne fetch-Stub.
   */
  aiComplete: (opts: AiCompleteOpts) => Promise<AiCompleteResult>
  /** UI-Callback für Fortschritt (Spinner / Progress-Bar). */
  onProgress?: (info: RecalcProgressInfo) => void
  /**
   * Maximale Tokens pro Position. Default 2000 (= bau4you Original, da pro
   * Position nur ein kompaktes JSON-Objekt zurückkommt).
   */
  maxTokens?: number
}

/**
 * Prüft ob eine Position für die Modus-1-Nachkalkulation in Frage kommt.
 * Siehe Modul-Header für die Regeln.
 */
function shouldRecalc(p: Position): boolean {
  const nr = String(p.leistungsnummer || '')
  // Header (-000) → skip
  if (/[-–]\s*000$/.test(nr)) return false
  // Spezial-Positionen 990-999 → skip
  if (isSpecialPosition(nr)) return false
  // Katalog-Position MIT echtem Preis → skip
  if (p.aus_preisliste === true && (p.vk_netto_einheit || 0) > 0) return false
  // Neue Position ODER Katalog mit 0 €
  return p.aus_preisliste === false || (p.vk_netto_einheit || 0) === 0
}

/**
 * Baut die User-Message für die KI – kompakt, ein-zeilig, alle relevanten
 * Felder die der Modus-1-Prompt braucht (1:1 wie bau4you Z. 458).
 */
function buildUserMessage(gewerkName: string, p: Position): string {
  const desc = `${p.leistungsname || ''} – ${p.beschreibung || ''} – Gewerk: ${gewerkName} – Menge: ${p.menge || 1} ${p.einheit || 'm²'}`
  return `BESCHREIBUNG: ${desc}`
}

/**
 * Nachkalkulation aller "neuen" oder preislosen Positionen sequenziell
 * mit Modus-1-Prompt. Sequenziell → vermeidet Rate-Limits & hält die
 * Reihenfolge in den Progress-Callbacks stabil.
 *
 * Side-effect-frei: liefert ein neues Gewerke-Array zurück, das Input wird
 * nicht mutiert.
 */
export async function recalcNewPositions(
  gewerke: Gewerk[],
  opts: RecalcOpts,
): Promise<Gewerk[]> {
  if (!gewerke || gewerke.length === 0) return gewerke
  if (!opts || typeof opts.aiComplete !== 'function') {
    throw new Error('recalcNewPositions: opts.aiComplete fehlt.')
  }
  if (typeof opts.modus1Prompt !== 'string' || opts.modus1Prompt.length === 0) {
    throw new Error('recalcNewPositions: opts.modus1Prompt fehlt.')
  }

  // 1) Sammle alle Kandidaten (mit Gewerk-Bezug, da User-Message es braucht).
  const candidates: Array<{ gewerk: string; position: Position }> = []
  for (const g of gewerke) {
    for (const p of g.positionen || []) {
      if (shouldRecalc(p)) candidates.push({ gewerk: g.name, position: p })
    }
  }

  if (candidates.length === 0) {
    return gewerke
  }

  const maxTokens = opts.maxTokens ?? 2000

  // 2) Sequentielle Nachkalkulation. Identitäts-Map: Position-Ref → Modus1-JSON
  const results = new Map<Position, Modus1Recalc>()
  for (let i = 0; i < candidates.length; i++) {
    const { gewerk, position } = candidates[i]

    opts.onProgress?.({
      current: i + 1,
      total: candidates.length,
      positionName: position.leistungsname ?? undefined,
    })

    try {
      const response = await opts.aiComplete({
        systemPrompt: opts.modus1Prompt,
        userMessage: buildUserMessage(gewerk, position),
        maxTokens,
        // Modus-1-Recalc parst das Resultat als JSON → Backend in JSON-Modus zwingen.
        responseFormat: 'json',
      })
      const parsed = parseJsonResponse<Modus1Recalc | Modus1Recalc[]>(
        response.text,
      )
      // Modus 1 liefert pro Position ein Objekt — Arrays ignorieren wir.
      if (parsed && !Array.isArray(parsed)) {
        const cleaned: Modus1Recalc = {
          ...parsed,
          leistungsname: parsed.leistungsname
            ? cleanWebSearchTags(parsed.leistungsname)
            : parsed.leistungsname,
          beschreibung: parsed.beschreibung
            ? cleanWebSearchTags(parsed.beschreibung)
            : parsed.beschreibung,
        }
        results.set(position, cleaned)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.warn(
        `[recalcNewPositions] Fehler bei "${position.leistungsname}":`,
        msg,
      )
      // Position bleibt unverändert.
    }
  }

  // 3) Ergebnisse in die Gewerke einspielen (immutable, identity-keyed).
  return gewerke.map((g) => ({
    ...g,
    positionen: (g.positionen || []).map((p) => {
      const recalced = results.get(p)
      if (!recalced) return p
      return {
        ...p,
        vk_netto_einheit: recalced.vk_netto_einheit ?? p.vk_netto_einheit,
        gesamtpreis: recalced.gesamtpreis ?? p.gesamtpreis,
        materialkosten_einheit:
          recalced.materialkosten_einheit ?? p.materialkosten_einheit,
        materialanteil_prozent:
          recalced.materialanteil_prozent ?? p.materialanteil_prozent,
        lohnkosten_minuten:
          recalced.lohnkosten_minuten ?? p.lohnkosten_minuten,
        lohnkosten_einheit:
          recalced.lohnkosten_einheit ?? p.lohnkosten_einheit,
        lohnanteil_prozent:
          recalced.lohnanteil_prozent ?? p.lohnanteil_prozent,
        stundensatz: recalced.stundensatz ?? p.stundensatz,
        // Texte: Modus-2-Texte (bestehend) haben Vorrang — Modus-1 nur Fallback.
        beschreibung: p.beschreibung || recalced.beschreibung || null,
        leistungsname: p.leistungsname || recalced.leistungsname || null,
        _modus1_recalc: true,
      }
    }),
  }))
}
