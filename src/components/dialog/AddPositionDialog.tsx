// ────────────────────────────────────────────────────────────────────────────
//  AddPositionDialog – "+ KI Leistung hinzufügen" (Einzelposition per KI).
//
//  Phase 6 – Single-Position-Pipeline (analog VoiceAngebotDialog, nur kleiner):
//    1. SpeechInput (1-Feld-Modus, enableBullets=false) liefert den Text
//    2. buildPrompt(ADD_POSITION_PROMPT, ctx) → systemPrompt
//    3. buildFilteredCatalog() → PREISLISTE als cachedContext
//    4. aiComplete (maxTokens 2000 – EINE Position, responseFormat json)
//    5. parseJsonResponse → nackte Position (Schema aus addPosition.ts)
//    6. normalizeToGewerke() → Gewerk[]-Wrapper (Pipeline braucht Gewerk-Name)
//    7. runCalcPipeline (enforceUserStunden: true)
//    8. heroToDocPositions (svcLookup) → DocPosition[]
//    9. onComplete(positions) → OfferEditor hängt an (setPositions, atomar)
//
//  WICHTIG: ADD_POSITION_PROMPT liefert per Vertrag EIN nacktes JSON-Objekt
//  (keine gewerke-Liste). normalizeToGewerke() wrappt es in die Gewerk-
//  Struktur, toleriert aber defensiv auch Arrays / {positionen} / {gewerke}
//  (z. B. Wasserschaden-Regel im Prompt kann mehrere Positionen ergeben).
//
//  Error-Handling: jeder Fehler landet in status.error; Retry über den
//  "Erneut versuchen"-Button (letzter Text bleibt im SpeechInput erhalten).
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Modal } from '../ui'

import { SpeechInput, type SpeechInputProps } from '../voice/SpeechInput'
import {
  aiComplete as defaultAiComplete,
  type AiCompleteOpts,
  type AiCompleteResult,
} from '../../lib/ai/aiComplete'
import { parseJsonResponse } from '../../lib/ai/parseJson'
import { ADD_POSITION_PROMPT } from '../../lib/ai/prompts/addPosition'
import {
  buildPrompt,
  buildFilteredCatalog,
  type PromptContext,
} from '../../lib/ai/prompts/base'
import { runCalcPipeline } from '../../lib/calc/pipeline'
import {
  heroToDocPositions,
  type HeroToDocOpts,
} from '../../lib/calc/heroToDocPositions'
import { logVoiceTranscript } from '../../lib/voice/logVoiceTranscript'
import type { DocPosition } from '../../lib/document-types'
import type {
  Catalog,
  Gewerk,
  KalkSettings,
  Position,
  StundensaetzeMap,
} from '../../lib/calc/types'
import { DEFAULT_KALK_SETTINGS, PREFIX_TO_GEWERK } from '../../lib/calc/types'

// ──────────────────────────── Types ────────────────────────────────────────

/** Service-Lookup für heroToDocPositions (service_number → service_id). */
export type SvcLookup = HeroToDocOpts['services']

export interface AddPositionDialogProps {
  open: boolean
  onClose: () => void
  /** Fertig gerechnete DocPositionen – der Editor hängt sie an. */
  onComplete: (positions: DocPosition[]) => void
  /** Für {{FIRMA_NAME}} im Prompt, Fallback "BAU4YOU". */
  organizationName?: string
  /** Wenn vorhanden, an Prompt-Filter + Pipeline weiterreichen. */
  catalog?: Catalog
  stundensaetze?: StundensaetzeMap
  settings?: KalkSettings
  /** Stamm-Services für den service_id-Bezug beim Konvertieren. */
  services?: SvcLookup
  // ── Test-Injection-Points (wie VoiceAngebotDialog) ──────────────────────
  /** Override für aiComplete (Tests). */
  aiCompleteImpl?: (opts: AiCompleteOpts) => Promise<AiCompleteResult>
  /** Override für runCalcPipeline (Tests). */
  runCalcPipelineImpl?: typeof runCalcPipeline
  /** Override für parseJsonResponse (Tests). */
  parseJsonResponseImpl?: <T = unknown>(text: string) => T
}

// ──────────────────────────── Status ───────────────────────────────────────

export type AddPositionStatus =
  | { phase: 'idle' }
  | { phase: 'ai' }
  | { phase: 'pipeline' }
  | { phase: 'done' }
  | { phase: 'error'; error: string }

function statusLabel(s: AddPositionStatus): string {
  switch (s.phase) {
    case 'idle':
      return 'Bereit'
    case 'ai':
      return 'KI kalkuliert die Position...'
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
 *  Prüft, ob ein geparster Wert wie eine Hero-Position aussieht.
 *  Der Prompt-Vertrag garantiert leistungsnummer + leistungsname; wir
 *  akzeptieren defensiv jedes Objekt, das mindestens eines der beiden trägt.
 */
function looksLikePosition(v: unknown): v is Position {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.leistungsname === 'string' || typeof o.leistungsnummer === 'string'
  )
}

/** Alle Positionen aus einer (beliebig geformten) KI-Antwort einsammeln. */
function collectPositionen(parsed: unknown): Position[] {
  // Variante 1: nacktes Array von Positionen.
  if (Array.isArray(parsed)) return parsed.filter(looksLikePosition)

  if (!parsed || typeof parsed !== 'object') return []
  const obj = parsed as Record<string, unknown>

  // Variante 2: Gewerk[]-Wrapper wie beim Komplettangebot.
  if (Array.isArray(obj.gewerke)) {
    const out: Position[] = []
    for (const g of obj.gewerke) {
      if (!g || typeof g !== 'object') continue
      const positionen = (g as { positionen?: unknown }).positionen
      if (!Array.isArray(positionen)) continue
      for (const p of positionen) if (looksLikePosition(p)) out.push(p)
    }
    return out
  }

  // Variante 3: { positionen: [...] }-Wrapper.
  if (Array.isArray(obj.positionen)) {
    return obj.positionen.filter(looksLikePosition)
  }

  // Variante 4 (Prompt-Vertrag): nackte Einzelposition.
  return looksLikePosition(parsed) ? [parsed] : []
}

/** Gewerk-Name einer Position auflösen: gewerk-Feld → Nr-Präfix → "Sonstiges". */
function resolveGewerkName(pos: Position): string {
  const fromField = typeof pos.gewerk === 'string' ? pos.gewerk.trim() : ''
  if (fromField) return fromField
  const prefix = String(pos.leistungsnummer ?? '').split('-')[0]
  return PREFIX_TO_GEWERK[prefix] ?? 'Sonstiges'
}

/**
 *  Normalisiert die KI-Antwort des ADD_POSITION_PROMPT in die Gewerk-Struktur,
 *  die runCalcPipeline erwartet (fixGewerkZuordnung & Co. brauchen den
 *  Gewerk-Namen als Bucket). Positionen desselben Gewerks werden gebündelt.
 *
 *  Exportiert für Unit-Tests (der Wrapper-Vertrag ist Teil des Moduls).
 */
export function normalizeToGewerke(parsed: unknown): Gewerk[] {
  const positionen = collectPositionen(parsed)
  const buckets = new Map<string, Gewerk>()
  for (const pos of positionen) {
    const name = resolveGewerkName(pos)
    let bucket = buckets.get(name)
    if (!bucket) {
      bucket = { name, positionen: [] }
      buckets.set(name, bucket)
    }
    bucket.positionen.push({ ...pos, gewerk: name })
  }
  return [...buckets.values()]
}

export interface RunAddPositionDeps {
  aiComplete: (opts: AiCompleteOpts) => Promise<AiCompleteResult>
  runCalcPipeline: typeof runCalcPipeline
  parseJsonResponse: <T = unknown>(text: string) => T
}

export interface RunAddPositionArgs {
  /** Positionstext des Users (diktiert oder getippt). */
  text: string
  organizationName: string
  catalog: Catalog
  stundensaetze: StundensaetzeMap
  settings: KalkSettings
  services: SvcLookup
  onStatus?: (s: AddPositionStatus) => void
}

export interface RunAddPositionResult {
  positions: DocPosition[]
}

/**
 *  Reine Kern-Logik des Dialogs – KEIN React, KEIN DOM (analog
 *  runVoiceAngebot). Wird sowohl vom Component intern als auch direkt aus
 *  Tests aufgerufen (s. AddPositionDialog.test.ts).
 */
export async function runAddPosition(
  args: RunAddPositionArgs,
  deps: RunAddPositionDeps,
): Promise<RunAddPositionResult> {
  const userMessage = args.text.trim()
  if (!userMessage) {
    throw new Error('Kein Text zum Senden vorhanden.')
  }

  // ── 1. Prompt bauen ──────────────────────────────────────────────────────
  const promptCtx: PromptContext = {
    firmaName: args.organizationName || 'BAU4YOU',
    stundensaetze: args.stundensaetze,
    aufschlagGesamt: args.settings.aufschlagGesamt,
    aufschlagMaterial: args.settings.aufschlagMaterial,
  }
  const systemPrompt = buildPrompt(ADD_POSITION_PROMPT, promptCtx)

  // ── 2. Preisliste injizieren ─────────────────────────────────────────────
  // Der ADD_POSITION_PROMPT verweist explizit auf die "mitgeschickte
  // PREISLISTE" (Katalog-Matching, aus_preisliste-Flag). buildFilteredCatalog
  // reduziert per Gewerk-Keyword auf max. 100 relevante Einträge.
  const catalogBlock = buildFilteredCatalog(args.catalog, userMessage)
  const cachedContext = `PREISLISTE (Auszug, gefiltert nach erkannten Gewerken):\n${catalogBlock}`

  // ── 3. KI-Call ───────────────────────────────────────────────────────────
  args.onStatus?.({ phase: 'ai' })
  const aiResult = await deps.aiComplete({
    systemPrompt,
    userMessage,
    cachedContext,
    // 2000 statt 8000 (Komplettangebot): der Prompt liefert EINE Position
    // (~200-400 Output-Tokens, Wasserschaden-Sonderfall max. ~5 Positionen).
    // Kleineres Limit = kürzere Roundtrip-Zeit.
    maxTokens: 2000,
    // Der Prompt erzwingt "NUR JSON" → Backend in den JSON-Modus schalten.
    responseFormat: 'json',
  })

  // ── 4. JSON parsen + in Gewerk-Struktur wrappen ──────────────────────────
  const parsed = deps.parseJsonResponse<unknown>(aiResult.text)
  const gewerke = normalizeToGewerke(parsed)
  if (gewerke.length === 0) {
    throw new Error('Die KI hat keine Position geliefert. Bitte erneut versuchen.')
  }

  // ── 5. Calc-Pipeline laufen lassen ───────────────────────────────────────
  args.onStatus?.({ phase: 'pipeline' })
  const processed = deps.runCalcPipeline(gewerke, {
    eingabeText: userMessage,
    catalog: args.catalog,
    stundensaetze: args.stundensaetze,
    settings: args.settings,
    // Diktierte Stundenzahlen ("dafür brauchen wir 6 Stunden") haben Vorrang
    // vor der KI-Schätzung — identisch zur Voice-Pipeline.
    enforceUserStunden: true,
  })

  // ── 6. Gewerk[] → DocPosition[] (inkl. Gewerk-Titelzeile) ────────────────
  const positions = heroToDocPositions(processed, { services: args.services })
  if (positions.length === 0) {
    throw new Error('Die KI hat keine Position erzeugt. Bitte erneut versuchen.')
  }

  args.onStatus?.({ phase: 'done' })
  return { positions }
}

// ──────────────────────────── Component ────────────────────────────────────

export function AddPositionDialog({
  open,
  onClose,
  onComplete,
  organizationName,
  catalog,
  stundensaetze,
  settings,
  services,
  aiCompleteImpl,
  runCalcPipelineImpl,
  parseJsonResponseImpl,
}: AddPositionDialogProps) {
  const [status, setStatus] = useState<AddPositionStatus>({ phase: 'idle' })
  // Letzter abgeschickter Text – Basis für den Retry-Button im Fehlerfall.
  const lastTextRef = useRef('')

  // Status zurücksetzen, sobald das Modal geöffnet wird.
  useEffect(() => {
    if (open) setStatus({ phase: 'idle' })
  }, [open])

  const isBusy = status.phase === 'ai' || status.phase === 'pipeline'

  // Stabile Dependencies (memo), damit der Handler nicht jeden Render neu bindet.
  const deps = useMemo<RunAddPositionDeps>(
    () => ({
      aiComplete: aiCompleteImpl ?? defaultAiComplete,
      runCalcPipeline: runCalcPipelineImpl ?? runCalcPipeline,
      parseJsonResponse:
        (parseJsonResponseImpl as RunAddPositionDeps['parseJsonResponse']) ??
        parseJsonResponse,
    }),
    [aiCompleteImpl, runCalcPipelineImpl, parseJsonResponseImpl],
  )

  const handleSubmit = useCallback<NonNullable<SpeechInputProps['onResult']>>(
    async (text) => {
      if (isBusy) return
      lastTextRef.current = text
      try {
        const result = await runAddPosition(
          {
            text,
            organizationName: organizationName || 'BAU4YOU',
            catalog: catalog ?? { positionen: [] },
            stundensaetze: stundensaetze ?? {},
            settings: settings ?? DEFAULT_KALK_SETTINGS,
            services: services ?? [],
            onStatus: setStatus,
          },
          deps,
        )
        // Audit-Trail (best-effort, non-blocking) — gleiche Tabelle wie das
        // Voice-Komplettangebot (voice_transcripts, Cockpit-Statistik).
        void logVoiceTranscript({ transcript: text, producedOffer: true })
        onComplete(result.positions)
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
    [isBusy, organizationName, catalog, stundensaetze, settings, services, deps, onComplete],
  )

  return (
    <Modal
      open={open}
      onClose={isBusy ? () => {} : onClose}
      title="KI Leistung hinzufügen"
      size="md"
    >
      <div data-testid="add-position-dialog">
        {/* 1-Feld-Modus: nur der Positionstext, kein Betrifft (enableBullets=false). */}
        <SpeechInput
          enableBullets={false}
          disabled={isBusy}
          submitLabel="Position erstellen"
          placeholder="z.B. 25 m² Wände ausmalen zweifach, mittlere Qualität"
          onResult={(text) => {
            void handleSubmit(text)
          }}
        />

        {/* Statuszeile – b4y-Tokens für Tone-Farben (wie VoiceAngebotDialog). */}
        <div
          className="mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--border)', background: 'var(--hover)' }}
          data-testid="add-position-dialog-status"
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
          {status.phase === 'error' && lastTextRef.current.trim() && (
            <button
              type="button"
              className="btn-ghost ml-auto flex shrink-0 items-center gap-1 px-2 py-1"
              data-testid="add-position-dialog-retry"
              onClick={() => {
                void handleSubmit(lastTextRef.current)
              }}
            >
              <RotateCcw size={12} />
              Erneut versuchen
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            data-testid="add-position-dialog-cancel"
            className="btn-secondary disabled:opacity-40"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default AddPositionDialog
