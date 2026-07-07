// ────────────────────────────────────────────────────────────────────────────
//  recorderHelpers
//
//  Pure, framework-unabhängige Logik für `useAudioRecorder`:
//   - MIME-Sniffing (Opus > MP4 > WAV)
//   - Auto-Send-Trigger-Detection ("senden" als finales Wort)
//   - SpeechRecognition-Verfügbarkeit
//
//  Die eigentlichen Web-API-Effekte (getUserMedia, MediaRecorder) bleiben im
//  Hook; alles, was sich pur testen lässt, lebt hier.
// ────────────────────────────────────────────────────────────────────────────

import {
  PREFERRED_MIME_TYPES,
  type MediaRecorderCtor,
  type SREvent,
  type SpeechRecognitionCtor,
} from './types'

// ──── MIME-Sniffing ────────────────────────────────────────────────────────

/**
 * Wählt den ersten MIME-Type aus `PREFERRED_MIME_TYPES`, den der vorliegende
 * `MediaRecorder`-Ctor unterstützt. Fällt am Ende auf `audio/webm` zurück,
 * weil ältere Chromium-Versionen `audio/webm;codecs=opus` zwar abspielen,
 * aber `isTypeSupported` darauf `false` liefern.
 *
 * Die Reihenfolge stammt aus bau4you (webm/opus = Desktop/Android,
 * mp4 = iOS-Safari-Fallback, wav = Last-Resort).
 */
export function pickSupportedMimeType(
  Ctor: Pick<MediaRecorderCtor, 'isTypeSupported'> | undefined,
  preferred: readonly string[] = PREFERRED_MIME_TYPES,
): string {
  if (!Ctor || typeof Ctor.isTypeSupported !== 'function') {
    return 'audio/webm'
  }
  for (const mime of preferred) {
    try {
      if (Ctor.isTypeSupported(mime)) return mime
    } catch {
      // Manche Browser werfen für unbekannte MIME-Types – einfach weiter.
    }
  }
  return 'audio/webm'
}

// ──── SpeechRecognition-Verfügbarkeit ──────────────────────────────────────

/** Holt den `SpeechRecognition`-Ctor aus einem Window-ähnlichen Objekt. */
export function getSpeechRecognitionCtor(
  win: unknown,
): SpeechRecognitionCtor | null {
  if (!win || typeof win !== 'object') return null
  const w = win as Record<string, unknown>
  const ctor =
    (w.SpeechRecognition as SpeechRecognitionCtor | undefined) ??
    (w.webkitSpeechRecognition as SpeechRecognitionCtor | undefined)
  return typeof ctor === 'function' ? ctor : null
}

export function isSpeechRecognitionSupported(win: unknown): boolean {
  return getSpeechRecognitionCtor(win) !== null
}

// ──── Auto-Send-Trigger-Erkennung ──────────────────────────────────────────

export interface TriggerDetectionResult {
  /** Wurde das Trigger-Wort als finales Wort erkannt? */
  triggered: boolean
  /** Aktueller Interim-Transkript-Stand (für UI-Anzeige). */
  interim: string
  /** Aktueller Final-Transkript-Stand (für UI-Anzeige). */
  final: string
}

/**
 * Wertet ein `SpeechRecognition`-`onresult`-Event aus und liefert:
 *   - `triggered` = true, wenn ein finales Result mit dem Trigger-Wort endet.
 *   - `interim` / `final` = die jeweils zusammengefassten Transkripte.
 *
 * Die Funktion ist pur – kein Side-Effect. Sie wird vom Hook gerufen, der
 * dann (debounced) `onAutoSend()` auslöst.
 */
export function detectAutoSendTrigger(
  event: SREvent,
  triggerWord: string,
): TriggerDetectionResult {
  const trigger = triggerWord.trim().toLowerCase()
  let triggered = false
  let interim = ''
  let final = ''

  for (let i = 0; i < event.results.length; i++) {
    const result = event.results[i]
    if (!result) continue
    const transcript = result[0]?.transcript ?? ''
    if (result.isFinal) {
      final += transcript
      // Trigger nur, wenn das finale Result mit dem Stichwort endet
      // und wir nicht schon vorher getriggert haben.
      if (
        !triggered &&
        i >= event.resultIndex &&
        trigger.length > 0 &&
        transcript.trim().toLowerCase().endsWith(trigger)
      ) {
        triggered = true
      }
    } else {
      interim += transcript
    }
  }

  return { triggered, interim: interim.trim(), final: final.trim() }
}

// ──── Permission-Error-Mapping ─────────────────────────────────────────────

/** Übersetzt `getUserMedia`-Fehler in eine deutschsprachige Fehlermeldung. */
export function describeRecorderError(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name: string }).name
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Mikrofonzugriff verweigert. Bitte erlauben Sie den Zugriff.'
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'Kein Mikrofon gefunden.'
    }
    if (name === 'NotReadableError') {
      return 'Mikrofon wird bereits verwendet.'
    }
  }
  if (err instanceof Error && err.message) return err.message
  return 'Aufnahme konnte nicht gestartet werden.'
}
