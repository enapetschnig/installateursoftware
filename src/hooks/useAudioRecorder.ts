// ────────────────────────────────────────────────────────────────────────────
//  useAudioRecorder
//
//  TypeScript-Port von `bau4you/src/hooks/useAudioRecorder.js` mit dem
//  reduzierten API-Shape, das `Isabella` und die neuen Voice-Komponenten
//  brauchen:
//
//    { recording, audioBlob, interimTranscript, finalTranscript, error,
//      start, stop, reset }
//
//  Wichtige Punkte:
//   • MediaRecorder mit MIME-Sniffing (Opus > MP4 > WAV), siehe `recorderHelpers`.
//   • `mediaRecorder.start(1000)` mit Timeslice – Pflicht für iOS Safari,
//     sonst kommt das `ondataavailable`-Event nie.
//   • Optionale parallele `SpeechRecognition` (de-DE) für Live-Transkript +
//     Auto-Send-Trigger ("senden" am Satzende).
//   • Cleanup im Unmount: alle Tracks stoppen, Recognition abbrechen, Timer
//     löschen.
//
//  Pure Logik lebt in `src/lib/speech/recorderHelpers.ts`; der Hook ist nur
//  noch ein dünner Effects-Wrapper darum.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  describeRecorderError,
  detectAutoSendTrigger,
  getSpeechRecognitionCtor,
  pickSupportedMimeType,
} from '../lib/speech/recorderHelpers'
import {
  DEFAULT_AUTO_SEND_TRIGGER,
  DEFAULT_LANG,
  type MediaRecorderCtor,
  type MediaRecorderLike,
  type SpeechRecognitionLike,
} from '../lib/speech/types'

// ──── Public API ──────────────────────────────────────────────────────────

export interface AudioRecorderOpts {
  /** Stichwort, das Auto-Send triggert. Default: `"senden"`. */
  autoSendTrigger?: string
  /** Wird nach 300 ms aufgerufen, wenn das Trigger-Wort fällt. */
  onAutoSend?: () => void
  /** Sprache für SpeechRecognition. Default: `"de-DE"`. */
  lang?: string
}

export interface AudioRecorderState {
  recording: boolean
  audioBlob: Blob | null
  interimTranscript: string
  finalTranscript: string
  error: string | null
}

export interface AudioRecorderControls {
  start: () => Promise<void>
  stop: () => Promise<void>
  reset: () => void
}

export type AudioRecorderApi = AudioRecorderState & AudioRecorderControls

// ──── Hook ────────────────────────────────────────────────────────────────

const AUTO_SEND_DEBOUNCE_MS = 300

export function useAudioRecorder(
  opts: AudioRecorderOpts = {},
): AudioRecorderApi {
  const triggerWord = (opts.autoSendTrigger ?? DEFAULT_AUTO_SEND_TRIGGER)
    .trim()
    .toLowerCase()
  const lang = opts.lang ?? DEFAULT_LANG

  // onAutoSend in Ref halten – sonst würde jede Render-Aktualisierung das
  // Restart-Pattern von SpeechRecognition kaputt machen.
  const onAutoSendRef = useRef<(() => void) | undefined>(opts.onAutoSend)
  useEffect(() => {
    onAutoSendRef.current = opts.onAutoSend
  }, [opts.onAutoSend])

  // ──── State ──────────────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  // ──── Refs für Web-APIs ─────────────────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorderLike | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const autoSendTriggeredRef = useRef(false)
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ──── SpeechRecognition ─────────────────────────────────────────────────

  const stopSpeechRecognition = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.onend = null
        rec.onresult = null
        rec.onerror = null
        rec.abort()
      } catch {
        // Cleanup-Fehler ignorieren
      }
      recognitionRef.current = null
    }
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current)
      autoSendTimerRef.current = null
    }
  }, [])

  const startSpeechRecognition = useCallback(() => {
    if (typeof window === 'undefined') return
    const Ctor = getSpeechRecognitionCtor(window)
    if (!Ctor) return // graceful: kein Browser-Support → einfach kein Live-Transkript

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang
    autoSendTriggeredRef.current = false

    recognition.onresult = (event) => {
      if (autoSendTriggeredRef.current) return
      const { triggered, interim, final } = detectAutoSendTrigger(
        event,
        triggerWord,
      )
      if (interim) setInterimTranscript(interim)
      if (final) setFinalTranscript((prev) => (prev ? `${prev} ${final}` : final))

      if (triggered && !autoSendTriggeredRef.current) {
        autoSendTriggeredRef.current = true
        autoSendTimerRef.current = setTimeout(() => {
          onAutoSendRef.current?.()
        }, AUTO_SEND_DEBOUNCE_MS)
      }
    }

    recognition.onend = () => {
      // Auto-Restart, solange wir noch aufnehmen und kein Trigger gefallen ist.
      if (
        !autoSendTriggeredRef.current &&
        mediaRecorderRef.current?.state === 'recording'
      ) {
        try {
          recognition.start()
        } catch {
          // Restart-Fehler ignorieren
        }
      }
    }

    recognition.onerror = (ev) => {
      if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
        // Nur loggen, nicht in `error` schieben – das ist eine Soft-Feature.
        // eslint-disable-next-line no-console
        console.warn('SpeechRecognition error:', ev.error)
      }
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
    } catch {
      // Kein Hardstop: Recording läuft auch ohne Live-Transkript weiter.
      // eslint-disable-next-line no-console
      console.warn('Could not start SpeechRecognition')
    }
  }, [lang, triggerWord])

  // ──── start / stop / reset ──────────────────────────────────────────────

  const start = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      setAudioBlob(null)
      setInterimTranscript('')
      setFinalTranscript('')
      chunksRef.current = []

      const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
      if (!md || typeof md.getUserMedia !== 'function') {
        throw Object.assign(new Error('getUserMedia nicht verfügbar'), {
          name: 'NotSupportedError',
        })
      }

      const stream = await md.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const MR = (typeof window !== 'undefined'
        ? (window as unknown as { MediaRecorder?: MediaRecorderCtor }).MediaRecorder
        : undefined)
      if (!MR) {
        throw Object.assign(new Error('MediaRecorder nicht verfügbar'), {
          name: 'NotSupportedError',
        })
      }

      const mimeType = pickSupportedMimeType(MR)
      const mediaRecorder = new MR(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      mediaRecorder.onerror = () => {
        setError('Fehler bei der Aufnahme.')
      }

      // 1000-ms-Timeslice ist Pflicht für iOS Safari.
      mediaRecorder.start(1000)
      setRecording(true)

      startSpeechRecognition()
    } catch (err) {
      // Cleanup von eventuell halb-aufgemachtem Stream:
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop())
        } catch {
          // ignore
        }
        streamRef.current = null
      }
      setRecording(false)
      setError(describeRecorderError(err))
    }
  }, [startSpeechRecognition])

  const stop = useCallback(async (): Promise<void> => {
    stopSpeechRecognition()

    const mediaRecorder = mediaRecorderRef.current
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      // Sauber: kein Recorder oder schon inaktiv – kein Fehler werfen.
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop())
        } catch {
          // ignore
        }
        streamRef.current = null
      }
      setRecording(false)
      return
    }

    await new Promise<void>((resolve) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        })
        setAudioBlob(blob)
        if (streamRef.current) {
          try {
            streamRef.current.getTracks().forEach((t) => t.stop())
          } catch {
            // ignore
          }
          streamRef.current = null
        }
        setRecording(false)
        resolve()
      }
      try {
        mediaRecorder.stop()
      } catch {
        // Falls stop() wirft (z. B. weil schon stop läuft), state aktualisieren.
        setRecording(false)
        resolve()
      }
    })
  }, [stopSpeechRecognition])

  const reset = useCallback(() => {
    setAudioBlob(null)
    setInterimTranscript('')
    setFinalTranscript('')
    setError(null)
    chunksRef.current = []
    autoSendTriggeredRef.current = false
  }, [])

  // ──── Cleanup im Unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopSpeechRecognition()
      const mr = mediaRecorderRef.current
      if (mr && mr.state !== 'inactive') {
        try {
          mr.stop()
        } catch {
          // ignore
        }
      }
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop())
        } catch {
          // ignore
        }
        streamRef.current = null
      }
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current)
        autoSendTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    recording,
    audioBlob,
    interimTranscript,
    finalTranscript,
    error,
    start,
    stop,
    reset,
  }
}
