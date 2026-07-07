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

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  | { phase: 'ai' }
  | { phase: 'pipeline' }
  | { phase: 'done' }
  | { phase: 'error'; error: string }

function statusLabel(s: VoiceAngebotStatus): string {
  switch (s.phase) {
    case 'idle':
      return 'Bereit'
    case 'ai':
      return 'KI generiert das Angebot...'
    case 'pipeline':
      return 'Pipeline rechnet...'
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
  onStatus?: (s: VoiceAngebotStatus) => void
}

export interface RunVoiceAngebotResult {
  gewerke: Gewerk[]
  meta: VoiceAngebotDialogMeta
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
  }
  const systemPrompt = buildPrompt(KOMPLETT_ANGEBOT_PROMPT, promptCtx)

  // ── 3. KI-Call ───────────────────────────────────────────────────────────
  args.onStatus?.({ phase: 'ai' })
  const userMessage = (cleanedText || args.text).trim()
  if (!userMessage) {
    throw new Error('Kein Text zum Senden vorhanden.')
  }

  // Preisliste in den Prompt injizieren: der KOMPLETT_ANGEBOT_PROMPT verweist
  // explizit auf die "kompakte Preisliste" (Synonym-Matching, aus_preisliste-
  // Flag) — ohne diesen Block raet die KI Preise statt die Stammdaten zu
  // nutzen. buildFilteredCatalog reduziert per Gewerk-Keyword-Matching auf
  // max. 100 relevante Eintraege (~2-3k Token statt ~25k).
  const catalogBlock = buildFilteredCatalog(args.catalog, userMessage)
  const cachedContext = `PREISLISTE (Auszug, gefiltert nach erkannten Gewerken):\n${catalogBlock}`

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

  // ── 4. JSON parsen ───────────────────────────────────────────────────────
  const parsed = deps.parseJsonResponse<KomplettAngebotResponse>(aiResult.text)
  const gewerke: Gewerk[] = Array.isArray(parsed?.gewerke) ? parsed.gewerke : []
  if (gewerke.length === 0) {
    throw new Error('Die KI hat keine Gewerke geliefert. Bitte erneut versuchen.')
  }

  // ── 5. Calc-Pipeline laufen lassen ───────────────────────────────────────
  args.onStatus?.({ phase: 'pipeline' })
  const processed = deps.runCalcPipeline(gewerke, {
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

  // ── 6. Meta zusammensetzen ───────────────────────────────────────────────
  // Projektnummer + Adresse werden NICHT mehr aus der Sprache uebernommen:
  //   - Projektnummer: ueber Projekt-Dropdown im Editor (2026-06-24).
  //   - Adresse: kommt aus dem im Pre-Step-Modal gewaehlten Kunden (2026-06-30).
  // Falls die KI sie trotzdem zurueckgibt, wird sie hier ignoriert.
  const meta: VoiceAngebotDialogMeta = {
    betrifft:
      (parsed.betreff?.trim() || userFields.betrifft?.trim()) || undefined,
    ergaenzungen: ergaenzungen.length > 0 ? ergaenzungen : undefined,
    hinweise: hinweise.length > 0 ? hinweise : undefined,
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
  aiCompleteImpl,
  runCalcPipelineImpl,
  extractErgaenzungenHinweiseImpl,
  parseJsonResponseImpl,
}: VoiceAngebotDialogProps) {
  const [status, setStatus] = useState<VoiceAngebotStatus>({ phase: 'idle' })

  // Status zuruecksetzen, sobald das Modal geoeffnet wird.
  useEffect(() => {
    if (open) setStatus({ phase: 'idle' })
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
            onStatus: setStatus,
          },
          deps,
        )
        // Audit-Trail (best-effort, non-blocking): fuettert voice_transcripts
        // → Cockpit-Wochenstatistik "Sprach-Angebote" + Nachvollziehbarkeit.
        // organization_id + created_by kommen aus den DB-Defaults
        // (current_org_id() / auth.uid()).
        void logVoiceTranscript({ transcript: text, producedOffer: true })
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
    [isBusy, organizationName, catalog, stundensaetze, settings, deps, onComplete],
  )

  // Wir nutzen die zentrale b4y `Modal`-Komponente (Portal, Scroll-Lock,
  // einheitlicher Glassmorphism, Tokens) statt eines eigenen Overlays —
  // siehe docs/ui-guidelines.md und src/components/ui.tsx Z. 89.
  return (
    <Modal open={open} onClose={isBusy ? () => {} : onClose} title="Angebot per Sprache erstellen" size="xl">
      <div data-testid="voice-angebot-dialog">
        {/* Body */}
        <SpeechInput
          enableBullets
          disabled={isBusy}
          submitLabel="Generieren"
          placeholder="Sprich frei oder tippe die Positionen ein..."
          onResult={(text) => {
            void handleSubmit(text)
          }}
        />

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
