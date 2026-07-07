// ────────────────────────────────────────────────────────────────────────────
//  InlineMicButton
//
//  Kompakter Mikrofon-Button (Default 40 × 40 px) für Inline-Bearbeitung
//  einzelner Felder — Portierung von `bau4you/src/components/InlineMicButton.jsx`
//  nach TypeScript + React 18, basierend auf
//
//    - `useAudioRecorder`  (Aufnahme via MediaRecorder, iOS-kompatibel)
//    - `transcribeAudio`   (POST /api/ai/transcribe via `lib/ai.ts`)
//    - `inlineMicHelpers`  (Pure-Logik: TestMode, State-Machine, Klassen)
//
//  Charakteristika:
//   • 3 Größen: sm/md/lg (32 / 40 / 48 px) — Default `md`.
//   • Click → useAudioRecorder.start(); zweiter Click → stop() + STT.
//   • Safety-Net-Timer (30 s) bricht die Aufnahme zwangsweise ab, wenn der
//     User vergisst, manuell zu stoppen ("30 s Stille"-Fallback).
//   • Bei `?testmode=1` rendern wir statt des Mikrofons eine Text-Eingabe mit
//     `data-testid="inline-mic-test-input"` (Playwright kann darüber Sprache
//     simulieren — identisch zur bau4you-Konvention).
//   • Sauberes Cleanup im Unmount via `useAudioRecorder`'s eigenes
//     Effekt-Cleanup + lokaler Timer-Clear.
//
//  Bewusste Vereinfachungen gegenüber dem bau4you-Original:
//   – Keine Web-Speech-Branche (Server-STT only — die App hat den
//     Endpoint `/api/ai/transcribe` immer verfügbar).
//   – Kein `formatSpracheingabe` / `korrigiereTranskription` (Server liefert
//     den Text in passender Form; Frontend-Nachbearbeitung war ein bau4you-
//     Workaround für Whisper-Roh-Output, hier nicht nötig).
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Mic, Square } from 'lucide-react'
import { transcribeAudio } from '../../lib/ai'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import {
  INLINE_MIC_DEFAULT_SIZE,
  INLINE_MIC_MAX_RECORDING_MS,
  inlineMicAccessibleLabel,
  inlineMicButtonClasses,
  inlineMicIconPx,
  inlineMicSizePx,
  isInlineMicTestMode,
  nextInlineMicAction,
  type InlineMicSize,
  type InlineMicState,
} from './inlineMicHelpers'

export interface InlineMicButtonProps {
  /** Callback mit dem fertigen Transkriptions-Text (bereits getrimmt). */
  onResult: (text: string) => void
  /** Fehler-Callback (Mikrofon verweigert, STT-Fehler, leeres Audio). */
  onError?: (error: string) => void
  /** Optionaler title/aria-Hint für den idle-Button. */
  placeholder?: string
  /** sm = 32 px, md = 40 px (Default), lg = 48 px. */
  size?: InlineMicSize
  /** Wenn true: Button ist deaktiviert, Klicks werden ignoriert. */
  disabled?: boolean
}

/**
 * Hilfsfunktion: prüft browserseitige Verfügbarkeit von Mic-Aufnahme.
 * Wird in der Render-Phase mehrfach genutzt und sollte günstig sein.
 */
function micApiSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

export default function InlineMicButton({
  onResult,
  onError,
  placeholder,
  size = INLINE_MIC_DEFAULT_SIZE,
  disabled = false,
}: InlineMicButtonProps) {
  const [state, setState] = useState<InlineMicState>('idle')
  // Test-Mode: lokaler State für das simulierte Text-Input-Feld.
  const [testText, setTestText] = useState('')
  // `testMode` einmal pro Mount evaluieren — kein Re-Render-Bedarf, da
  // sich der URL-Param zur Laufzeit nicht ändern sollte.
  const testModeRef = useRef<boolean>(isInlineMicTestMode())

  const recorder = useAudioRecorder()
  // `recorder` in Ref halten — wir greifen aus Timer-Callbacks darauf zu,
  // ohne das Effekt-Dependency-Array zu verseuchen.
  const recorderRef = useRef(recorder)
  useEffect(() => {
    recorderRef.current = recorder
  }, [recorder])

  // 30-s-Safety-Net-Timer: bricht laufende Aufnahmen ab.
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearMaxDurationTimer = useCallback(() => {
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current)
      maxDurationTimerRef.current = null
    }
  }, [])

  // Cleanup bei Unmount: Timer löschen. Der Recorder selbst macht eigenes
  // Cleanup (Stream-Tracks stoppen) — siehe `useAudioRecorder.ts`.
  useEffect(() => {
    return () => {
      clearMaxDurationTimer()
    }
  }, [clearMaxDurationTimer])

  /**
   * Wird aufgerufen, wenn der Recorder ein finales Blob liefert.
   * Reagiert idempotent — bei leerem Blob loggen wir einen Soft-Error und
   * gehen zurück in `idle`.
   */
  const handleBlob = useCallback(
    async (blob: Blob) => {
      if (!blob || blob.size === 0) {
        setState('idle')
        onError?.('Keine Aufnahme erkannt.')
        return
      }
      setState('transcribing')
      try {
        const route =
          typeof window !== 'undefined' ? window.location.hash : null
        const result = await transcribeAudio(blob, { route })
        if (result.error) {
          onError?.(result.error)
        } else if (result.warning) {
          onError?.(result.warning)
        } else if (result.text) {
          onResult(result.text.trim())
        } else {
          onError?.('Kein Text erkannt.')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onError?.(`Transkription fehlgeschlagen: ${msg}`)
      } finally {
        setState('idle')
        recorderRef.current?.reset()
      }
    },
    [onError, onResult],
  )

  // Sobald der Hook ein Blob bereitstellt → verarbeiten und State zurücksetzen.
  // Wir vergleichen per Object-Identity gegen `null`, damit nicht jeder
  // unverwandte Re-Render einen STT-Call auslöst.
  const lastHandledBlobRef = useRef<Blob | null>(null)
  useEffect(() => {
    if (recorder.audioBlob && recorder.audioBlob !== lastHandledBlobRef.current) {
      lastHandledBlobRef.current = recorder.audioBlob
      void handleBlob(recorder.audioBlob)
    }
  }, [recorder.audioBlob, handleBlob])

  // Fehler aus dem Recorder durchreichen.
  useEffect(() => {
    if (recorder.error) {
      onError?.(recorder.error)
      setState('idle')
      clearMaxDurationTimer()
    }
  }, [recorder.error, onError, clearMaxDurationTimer])

  /** Recorder starten + Safety-Net-Timer setzen. */
  const beginRecording = useCallback(async () => {
    setState('recording')
    clearMaxDurationTimer()
    maxDurationTimerRef.current = setTimeout(() => {
      // Falls der User vergisst zu stoppen, brechen wir nach 30 s ab.
      // `state` lesen wir _nicht_ via Closure — wir prüfen über den Recorder
      // selbst, ob noch aufgenommen wird.
      if (recorderRef.current?.recording) {
        void recorderRef.current.stop()
      }
    }, INLINE_MIC_MAX_RECORDING_MS)
    try {
      await recorder.start()
    } catch (err) {
      clearMaxDurationTimer()
      setState('idle')
      const msg = err instanceof Error ? err.message : String(err)
      onError?.(`Mikrofon: ${msg}`)
    }
  }, [recorder, clearMaxDurationTimer, onError])

  /** Recorder stoppen — Safety-Timer abräumen, State auf `transcribing`. */
  const finishRecording = useCallback(async () => {
    clearMaxDurationTimer()
    // State erst nach Hook-Aufruf umschalten, damit der `audioBlob`-Effekt
    // den richtigen Übergang sieht (`recording → transcribing`).
    try {
      await recorder.stop()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onError?.(`Aufnahme stoppen: ${msg}`)
      setState('idle')
    }
  }, [recorder, clearMaxDurationTimer, onError])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      const action = nextInlineMicAction(state, { disabled })
      if (action === 'start_recording') void beginRecording()
      else if (action === 'stop_recording') void finishRecording()
      // 'noop' → bewusst ignorieren (transcribing-State, disabled, etc.)
    },
    [state, disabled, beginRecording, finishRecording],
  )

  // ── Test-Mode: Text-Fallback statt Mikrofon ──────────────────────────────
  // Aktiv bei `?testmode=1`. Playwright kann den Text in das sichtbare
  // Input-Feld tippen und über den Check-Button als "Spracheingabe" emitten.
  if (testModeRef.current) {
    const px = inlineMicSizePx(size)
    return (
      <span
        data-testid="inline-mic-test-mode"
        className="inline-flex gap-1 items-center flex-shrink-0"
      >
        <input
          data-testid="inline-mic-test-input"
          type="text"
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder={placeholder || 'Testeingabe'}
          className="border border-gray-300 rounded px-2 py-1 text-xs w-32"
          disabled={disabled}
        />
        <button
          data-testid="inline-mic-test-set"
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            const trimmed = testText.trim()
            if (trimmed) {
              onResult(trimmed)
              setTestText('')
            }
          }}
          disabled={disabled || !testText.trim()}
          className="bg-blue-600 text-white rounded flex items-center justify-center disabled:opacity-40"
          style={{ width: px, height: px }}
          title="Test-Mode: Text als Spracheingabe übernehmen"
          aria-label="Testeingabe übernehmen"
        >
          <Check size={inlineMicIconPx(size)} strokeWidth={2.5} />
        </button>
      </span>
    )
  }

  // ── Normal-Mode: Mikrofon-Button ─────────────────────────────────────────
  const supported = micApiSupported()
  const pxBox = inlineMicSizePx(size)
  const pxIcon = inlineMicIconPx(size)
  const blocked = disabled || !supported || state === 'transcribing'
  const titleText = state === 'recording' ? 'Stoppen' : placeholder || 'Spracheingabe'

  return (
    <button
      type="button"
      data-testid="inline-mic-button"
      onClick={handleClick}
      disabled={blocked}
      title={titleText}
      aria-label={inlineMicAccessibleLabel(state)}
      aria-pressed={state === 'recording'}
      className={inlineMicButtonClasses(state, { disabled, supported })}
      style={{ width: pxBox, height: pxBox }}
    >
      {state === 'transcribing' ? (
        <Loader2 size={pxIcon} className="animate-spin" aria-hidden="true" />
      ) : state === 'recording' ? (
        <Square size={pxIcon} fill="currentColor" aria-hidden="true" />
      ) : (
        <Mic size={pxIcon} aria-hidden="true" />
      )}
    </button>
  )
}
