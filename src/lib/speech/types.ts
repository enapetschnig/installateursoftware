// ────────────────────────────────────────────────────────────────────────────
//  Speech / Audio-Recorder – gemeinsame Typen
//
//  Wir halten die Typen für Web-APIs (MediaRecorder, SpeechRecognition) hier
//  zentral, damit Hook + Helpers + Tests dasselbe Vokabular verwenden.
//  Die Browser-Typen sind in lib.dom.d.ts nicht alle einheitlich exportiert
//  (SpeechRecognition fehlt z. B. komplett), daher minimal-strikte Shims.
// ────────────────────────────────────────────────────────────────────────────

/** Minimaler MediaRecorder-Konstruktor-Type (für Mocks + Tests). */
export interface MediaRecorderCtor {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorderLike
  isTypeSupported(type: string): boolean
}

/** Minimaler MediaRecorder-Instanz-Type (Subset, das wir nutzen). */
export interface MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused'
  mimeType: string
  ondataavailable: ((ev: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((ev: unknown) => void) | null
  start(timeslice?: number): void
  stop(): void
}

/** Minimal-Shape eines SpeechRecognition-Result-Items (WebSpeech API). */
export interface SRResultItem {
  isFinal: boolean
  0: { transcript: string }
  length: number
}

/** Result-Liste: indexierbar + length. */
export interface SRResultList {
  length: number
  [index: number]: SRResultItem
}

export interface SREvent {
  resultIndex: number
  results: SRResultList
}

export interface SRErrorEvent {
  error: string
}

/** Minimal-Shape einer SpeechRecognition-Instanz. */
export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((ev: SREvent) => void) | null
  onend: (() => void) | null
  onerror: ((ev: SRErrorEvent) => void) | null
  start(): void
  abort(): void
}

export interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike
}

/** Bevorzugte MIME-Type-Reihenfolge (Opus > MP4 > WAV). */
export const PREFERRED_MIME_TYPES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/wav',
] as const

/** Default-Trigger-Wort für Auto-Send. */
export const DEFAULT_AUTO_SEND_TRIGGER = 'senden'

/** Default-Sprache. */
export const DEFAULT_LANG = 'de-DE'
