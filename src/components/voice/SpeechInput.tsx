// ────────────────────────────────────────────────────────────────────────────
//  SpeechInput – Voice-Eingabe mit optionaler 4-Felder-Extraktion
//
//  Portiert von:
//    bau4you/src/components/SpeechInput.jsx  (Master-Komponente, JS, 668 LOC)
//
//  Was wir hier MACHEN:
//    1. UI: grosser Mic-Button (Glassmorphism, ähnlich Isabella – lucide-react
//       Icons "Mic" / "Square" / "Loader2").
//    2. Recording: nutzt unseren bestehenden `useAudioRecorder`-Hook
//       (src/hooks/useAudioRecorder.ts) – KEIN eigenes MediaRecorder-Setup.
//    3. Transkription: nutzt `transcribeAudio` aus
//       `src/lib/speech/transcribeClient.ts` (XHR-Fallback für iOS Safari
//       inklusive). KEIN Re-Implement aus bau4you.
//    4. Feld-Extraktion: nutzt `extractFields` aus
//       `src/lib/speech/extractFields.ts` (pure Logik, schon getestet).
//    5. Auto-Send-Trigger: ist im Hook konfiguriert; SpeechInput reicht es
//       lediglich via `onAutoSend` weiter → `handleSubmit()` wird gefeuert,
//       sobald der Recorder das Trigger-Wort hört und stop() abgeschlossen
//       ist (siehe `useEffect`-Block weiter unten).
//
//  Was wir BEWUSST WEGGELASSEN haben (vs. bau4you):
//    - WakeLock-Handling   → Hook bzw. zukünftige Verbesserung; hier nicht
//                            nötig, da `useAudioRecorder` Aufnahmen sauber
//                            beim Unmount cleant.
//    - Address-Enrichment  → kommt in einem späteren Modul.
//    - showXxxTipp-Slots   → können nachgereicht werden, Props bleiben offen.
//    - korrigiereTranskription / replaceMalWithTimes → noch nicht portiert;
//                            sobald `src/utils/textFormat.ts` existiert,
//                            kann das hier eingehängt werden (siehe TODO).
//
//  TS-Strict:  Strikte Props (siehe Interface), kein `any`, kein
//              implizites Casting. Refs nur dort, wo wir Browser-State
//              halten müssen, der nicht in den Render-Loop gehört.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Send, Square } from 'lucide-react'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import { transcribeAudio } from '../../lib/speech/transcribeClient'
import { extractFields, type ExtractedFields } from '../../lib/speech/extractFields'

// ────────────────────────────── Props ───────────────────────────────────────

export interface SpeechInputProps {
  /** Wird beim ersten Transkriptions-Ergebnis aufgerufen (Roh-Text). */
  onTranscriptCaptured?: (text: string) => void
  /** Wird beim Send-Click oder beim Auto-Send mit dem zusammengebauten Text aufgerufen. */
  onResult?: (text: string) => void
  /** 4-Felder-Modus (Projektnr / Adresse / Betrifft / Positionen). Default `true`. */
  enableBullets?: boolean
  /** Placeholder für die Textarea bzw. das Positionen-Feld. */
  placeholder?: string
  /** Komplettes Disable (Recording, Editieren, Submit). */
  disabled?: boolean
  /** Vorbefüllung (z. B. aus Vorlage geladen). */
  initialText?: string
  /** Stichwort für Auto-Send. Default `"senden"`. Wird an useAudioRecorder weitergereicht. */
  autoSendTrigger?: string
  /** Label des Submit-Buttons. Default `"Senden"`. */
  submitLabel?: string
}

// ──────────────────────────── Helpers ───────────────────────────────────────

export interface Fields {
  betrifft: string
  positionen: string
}

export const EMPTY_FIELDS: Fields = {
  betrifft: '',
  positionen: '',
}

/**
 *  Baut die Felder wieder zu einem einzelnen Text-Block zusammen
 *  (Vorbereitung für `onResult`).
 *
 *  Hinweis (2026-06-30): Das frühere `Adresse:`-Feld wurde entfernt — die
 *  Kunden-Adresse kommt jetzt aus dem im Pre-Step-Modal gewählten Kontakt.
 *  Projektnummer wurde schon früher entfernt (Editor-Dropdown).
 *
 *  Exportiert, damit der pure Submit-Vertrag ohne DOM testbar bleibt.
 */
export function assembleText(f: Fields): string {
  const lines: string[] = []
  if (f.betrifft.trim()) lines.push(`Betrifft: ${f.betrifft.trim()}`)
  if (lines.length > 0 && f.positionen.trim()) lines.push('')
  if (f.positionen.trim()) lines.push(f.positionen.trim())
  return lines.join('\n')
}

/**
 *  Parst einen formatierten Template-Text in die Felder zurueck.
 *  Alles, was nicht `Betrifft:` ist, gilt als Positionen.
 *
 *  Legacy: `Adresse:` und `Projektnummer:` Zeilen werden konsumiert
 *  (alte Vorlagen bleiben lesbar) aber nicht mehr gespeichert.
 *
 *  Exportiert für Unit-Tests – die Round-Trip-Garantie ist Teil des Vertrags.
 */
export function parseTemplateToFields(text: string): Fields {
  if (!text.trim()) return EMPTY_FIELDS

  const betrifftLine = text.match(/^Betrifft:\s*(.+)$/m)

  let remaining = text
  for (const re of [
    /^Projektnummer:\s*.+$/m,  // Legacy-Strip
    /^Adresse:\s*.+$/m,        // Legacy-Strip (2026-06-30 entfernt)
    /^Betrifft:\s*.+$/m,
  ]) {
    remaining = remaining.replace(re, '')
  }

  const positionen = remaining
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')

  return {
    betrifft: betrifftLine ? betrifftLine[1].trim() : '',
    positionen,
  }
}

/**
 *  Wandelt das `ExtractedFields`-Result aus `extractFields()` in unser
 *  internes `Fields`-Shape.  Append-Semantik fuer Positionen,
 *  Replace-Semantik fuer Meta-Felder.
 */
export function mergeExtracted(prev: Fields, ex: ExtractedFields): Fields {
  return {
    betrifft: ex.betrifft?.trim() ? ex.betrifft : prev.betrifft,
    // Positionen werden APPENDED, damit man mehrere Aufnahmen aneinanderhängen kann.
    positionen: ex.positionen
      ? prev.positionen.trim()
        ? `${prev.positionen}\n${ex.positionen}`
        : ex.positionen
      : prev.positionen,
  }
}

// ──────────────────────────── Component ─────────────────────────────────────

export function SpeechInput({
  onTranscriptCaptured,
  onResult,
  enableBullets = true,
  placeholder = 'Mikrofon drücken zum Sprechen, oder hier tippen…',
  disabled = false,
  initialText,
  autoSendTrigger = 'senden',
  submitLabel = 'Senden',
}: SpeechInputProps) {
  // Zentraler Auto-Send-Ref, damit der Hook-Callback nicht jeden Render neu
  // gebunden werden muss.  Tatsächliche Logik: nach Stop + Transcribe wird
  // `handleSubmit()` aufgerufen.
  const autoSendPendingRef = useRef(false)

  const { recording, audioBlob, error: recorderError, start, stop, reset } =
    useAudioRecorder({
      autoSendTrigger,
      onAutoSend: () => {
        autoSendPendingRef.current = true
        // stop() wird durch das `onAutoSend` getriggert, nicht durch den User.
        // Wir rufen stop() hier explizit, falls der Recorder noch läuft.
        void stop()
      },
    })

  // ──── State ───────────────────────────────────────────────────────────────
  const [transcript, setTranscript] = useState('')
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ──── Initial-Text einspielen (z. B. aus Template) ───────────────────────
  useEffect(() => {
    if (initialText === undefined || initialText === null) return
    if (enableBullets) {
      setFields(parseTemplateToFields(initialText))
    } else {
      setTranscript(initialText)
    }
    // initialText soll nur initial wirken; bewusst kein Re-Run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ──── Recorder-Error in lokalen Error spiegeln ───────────────────────────
  useEffect(() => {
    if (recorderError) setError(recorderError)
  }, [recorderError])

  // ──── Helper: zusammengebauter Submit-Text ───────────────────────────────
  const buildOutputText = useCallback((): string => {
    return enableBullets ? assembleText(fields) : transcript
  }, [enableBullets, fields, transcript])

  const hasContent = enableBullets
    ? assembleText(fields).trim().length > 0
    : transcript.trim().length > 0

  // ──── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const text = buildOutputText().trim()
    if (!text) return
    onResult?.(text)
  }, [buildOutputText, onResult])

  // ──── Recording stop → transkribieren ────────────────────────────────────
  // Wenn `audioBlob` neu reinkommt (Recorder hat aufgehört), schicken wir es
  // an `/api/ai/transcribe`. Bei `enableBullets=true` extrahieren wir die
  // 4 Felder; sonst füllen wir die einzelne Textarea.
  useEffect(() => {
    if (!audioBlob) return

    let cancelled = false
    setIsTranscribing(true)
    setError(null)

    void (async () => {
      try {
        const result = await transcribeAudio({ audio: audioBlob })
        if (cancelled) return

        const text = (result.text ?? '').trim()

        if (text) {
          onTranscriptCaptured?.(text)
          // TODO: sobald `korrigiereTranskription` / `replaceMalWithTimes` aus
          //       bau4you portiert sind, hier einfügen. Aktuell rohes Whisper-
          //       Result – die Extraktion ist tolerant genug.
          if (enableBullets) {
            const ex = extractFields(text)
            setFields((prev) => mergeExtracted(prev, ex))
          } else {
            // Mehrere Aufnahmen aneinanderhängen, getrennt durch Whitespace.
            setTranscript((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
          }
        } else if (result.warning) {
          setError(result.warning)
        } else {
          setError('Es wurde kein Text erkannt. Bitte nochmal versuchen.')
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Transkription fehlgeschlagen.'
        setError(msg)
      } finally {
        if (!cancelled) {
          setIsTranscribing(false)
          reset()

          // Auto-Send-Trigger: falls die Aufnahme via Trigger-Wort beendet wurde,
          // jetzt (nach Transkription) den Submit feuern.
          if (autoSendPendingRef.current) {
            autoSendPendingRef.current = false
            // setTimeout, damit der State-Update aus setFields/setTranscript
            // sicher gerendert wurde, bevor wir `buildOutputText()` einsammeln.
            setTimeout(() => {
              const text = enableBullets
                ? // Hinweis: wir lesen den Funktions-Closure-State NEU aus dem
                  //         Setter-Pattern – statt `buildOutputText` benutzen wir
                  //         direkt assembleText auf dem letzten Field-State via
                  //         flushSync-äquivalenten Trick. Da wir hier keinen
                  //         Render-Loop steuern, ist setTimeout ausreichend.
                  assembleText(fieldsRef.current)
                : transcriptRef.current
              const trimmed = text.trim()
              if (trimmed) onResult?.(trimmed)
            }, 0)
          }
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // `reset` und `onTranscriptCaptured` etc. sind stabil/Refs; wir hängen
    // bewusst nur an `audioBlob`, damit jeder neue Blob exakt einmal verarbeitet
    // wird. Sonst würden mehrfache Re-Renders eine Doppel-Transkription auslösen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBlob])

  // Refs spiegeln den aktuellen Field-/Transcript-State – für den Auto-Send-
  // Path (siehe Kommentar oben).
  const fieldsRef = useRef(fields)
  const transcriptRef = useRef(transcript)
  useEffect(() => {
    fieldsRef.current = fields
  }, [fields])
  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  // ──── Mic-Button-Click ───────────────────────────────────────────────────
  const onMicClick = useCallback(() => {
    if (disabled || isTranscribing) return
    if (recording) {
      void stop()
    } else {
      setError(null)
      void start()
    }
  }, [disabled, isTranscribing, recording, start, stop])

  // ──── Render ──────────────────────────────────────────────────────────────
  const micLabel = recording
    ? 'Aufnahme stoppen'
    : isTranscribing
      ? 'Wird transkribiert…'
      : 'Aufnahme starten'

  return (
    <div className="glass space-y-4 p-4" data-testid="speech-input">
      {/* ── Mic-Button + Status-Text ── */}
      <div className="flex flex-col items-center gap-2 py-2">
        <button
          type="button"
          onClick={onMicClick}
          disabled={disabled || isTranscribing}
          aria-label={micLabel}
          aria-pressed={recording}
          data-testid="speech-input-mic"
          className={[
            'grid h-16 w-16 place-items-center rounded-full text-white shadow-lg transition-all duration-200',
            recording
              ? 'animate-pulse bg-rose-500'
              : 'bg-gradient-to-br from-brand-500 to-brand-700 hover:scale-105 active:scale-95',
            (disabled || isTranscribing) && 'cursor-not-allowed opacity-40',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {isTranscribing ? (
            <Loader2 size={28} className="animate-spin" />
          ) : recording ? (
            <Square size={24} />
          ) : (
            <Mic size={28} />
          )}
        </button>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {isTranscribing
            ? 'Wird transkribiert…'
            : recording
              ? 'Aufnahme läuft – Stop drücken zum Beenden'
              : 'Mikrofon drücken zum Sprechen'}
        </p>
      </div>

      {/* ── Fehler-Anzeige (rot) ── */}
      {error && (
        <div
          role="alert"
          data-testid="speech-input-error"
          className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
        >
          {error}
        </div>
      )}

      {/* ── Felder (enableBullets) oder Textarea ── */}
      {enableBullets ? (
        <div className="space-y-3" data-testid="speech-input-fields">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Betrifft
            </label>
            <input
              type="text"
              className="input"
              data-testid="speech-input-betrifft"
              value={fields.betrifft}
              onChange={(e) =>
                setFields((p) => ({ ...p, betrifft: e.target.value }))
              }
              placeholder="z.B. Malerarbeiten Wohnung"
              disabled={disabled}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Positionen
            </label>
            <textarea
              className="input resize-none"
              data-testid="speech-input-positionen"
              style={{ minHeight: 120 }}
              value={fields.positionen}
              onChange={(e) =>
                setFields((p) => ({ ...p, positionen: e.target.value }))
              }
              placeholder={
                placeholder ||
                '• Boden abdecken im Schlafzimmer 20m²\n• Wände und Decken abscheren 5×4×3,5m\n• …'
              }
              disabled={disabled}
            />
          </div>
        </div>
      ) : (
        <textarea
          className="input resize-none"
          data-testid="speech-input-textarea"
          style={{ minHeight: 120 }}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}

      {/* ── Submit-Button ── */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!hasContent || isTranscribing || recording || disabled}
        data-testid="speech-input-submit"
        className="btn-primary flex w-full items-center justify-center gap-2"
      >
        <Send size={18} />
        {submitLabel}
      </button>
    </div>
  )
}

export default SpeechInput
