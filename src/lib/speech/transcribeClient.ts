// ────────────────────────────────────────────────────────────────────────────
//  Speech / Transcribe-Client (Frontend → /api/ai/transcribe)
//
//  Aufgabe: Audio-Blob → Text via vorhandenem Vercel-Endpoint.
//
//  Hintergrund (siehe bau4you/src/components/SpeechInput.jsx):
//    1.  Auf iOS Safari liefert `fetch()` bei FormData/Blob-Uploads gelegentlich
//        einen "Load failed"-TypeError. Wir bauen dasselbe XHR-Fallback wie
//        in bau4you ein – allerdings bereits am Base64-JSON-Body, da unser
//        Server-Endpoint (api/ai/transcribe.js) base64 statt FormData erwartet.
//    2.  Der OpenAI-Endpoint limitiert auf 25 MB. Wir prüfen vorab und werfen
//        sofort, damit der Upload erst gar nicht losgeht. Der Server prüft
//        nochmal bei 24 MB (Sicherheitsabstand) – beide Limits stimmen ab.
//    3.  Bei Netzwerk-/Server-Fehlern geben wir text="" zurück + console.error,
//        damit der aufrufende Code nicht in Try/Catch ertrinkt. Die 25-MB-
//        Prüfung wirft hingegen, weil das ein klarer Bedienfehler ist.
//
//  Bewusst KEIN Duplikat zu `transcribeAudio` aus src/lib/ai.ts:
//    – `ai.ts#transcribeAudio` ist die simple Variante für Isabella (Auth über
//      Supabase-Session, fixe Args).
//    – Dieser Client hier ist die voice-pipeline-Variante mit fetch-Injection,
//      Progress-Callback, Limit-Check und XHR-Fallback. Beide nutzen denselben
//      Endpoint, aber dieser hier ist test- und mock-bar.
// ────────────────────────────────────────────────────────────────────────────

import { supabase } from '../supabase'

/** Hard limit. OpenAI sagt 25 MB; wir blocken davor (gleich wie Server). */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024

/** Default-Sprache (de) und -Modell – beide vom Server akzeptiert. */
const DEFAULT_LANGUAGE = 'de'
const DEFAULT_MODEL = 'gpt-4o-transcribe'

export interface TranscribeOpts {
  /** Audio-Daten – aus MediaRecorder oder File-Upload. */
  audio: Blob | File
  /** ISO-639-1 Sprachcode. Default "de". */
  language?: string
  /** OpenAI-Modell-ID. Default "gpt-4o-transcribe". */
  model?: string
  /** Progress-Hook während Upload (nur XHR-Pfad). */
  onProgress?: (info: { uploadedBytes: number; totalBytes: number }) => void
  /** Fetch-Injection für Tests; default = globaler fetch. */
  fetchImpl?: typeof fetch
  /** XHR-Konstruktor-Injection für Tests; default = globaler XMLHttpRequest. */
  xhrImpl?: () => XMLHttpRequest
  /**
   * Auth-Token-Provider. Default: Supabase-Session.
   * Tests können `() => Promise.resolve('test-token')` injecten.
   */
  getAuthToken?: () => Promise<string | null>
}

export interface TranscribeResult {
  /** Transkribierter Text. Bei Fehler leer (""). */
  text: string
  /** Optionale Warnung vom Server (z. B. "kein Text erkannt"). */
  warning?: string
  /** Gemessene Antwortzeit (Client-Sicht). */
  durationMs?: number
  /** Vom Server tatsächlich verwendetes Modell. */
  model?: string
}

/**
 * Blob → reines Base64 (ohne "data:...;base64," Prefix).
 *
 * Im Browser nutzen wir FileReader.readAsDataURL (kompatibel mit der bau4you-
 * Implementierung und mit iOS Safari) und schneiden den Prefix ab.
 *
 * In Node-Tests fehlt FileReader; dort fallen wir auf Blob.arrayBuffer() +
 * Buffer (oder btoa via Uint8Array) zurück. So bleibt die Funktion ohne
 * jsdom test-bar.
 *
 * Server (api/ai/transcribe.js Z. 64+73) erwartet exakt dieses Format.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  // Browser-Pfad: FileReader vorhanden
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onloadend = () => {
        const s = String(fr.result || '')
        const commaIdx = s.indexOf(',')
        // Bei nicht-data-URL fallen wir auf den Volltext zurück (sollte nie passieren)
        resolve(commaIdx >= 0 ? s.slice(commaIdx + 1) : s)
      }
      fr.onerror = () => reject(new Error('Audio konnte nicht gelesen werden.'))
      fr.readAsDataURL(blob)
    })
  }
  // Node-/Test-Pfad ohne FileReader: arrayBuffer + btoa.
  // (Browser hat FileReader; Node hat globales btoa seit Node 16.)
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf)
    // CHUNK_SIZE verhindert "Maximum call stack" bei String.fromCharCode.apply
    // mit großen Arrays — 32 KiB Chunks reichen für 25 MB safely.
    const CHUNK = 0x8000
    const parts: string[] = []
    for (let i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
    }
    return btoa(parts.join(''))
  })
}

/**
 * Default-Token-Provider: liest aus Supabase-Session.
 *
 * Wichtig (vgl. Audit Phase 8, HIGH-2/3): `getSession()` liefert den
 * gecachten JWT zurück – bei langer Tab-Offen-Zeit ist der bereits abgelaufen
 * und das Backend antwortet 401. Wir prüfen daher die Restlaufzeit und
 * refreshen proaktiv, wenn weniger als 60 s bleiben.
 */
async function defaultGetAuthToken(): Promise<string | null> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    let access = sess.session?.access_token
    const expAt = sess.session?.expires_at ?? 0
    if (access && expAt > 0 && expAt * 1000 - Date.now() < 60_000) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      access = refreshed.session?.access_token ?? access
    }
    return access ?? null
  } catch {
    return null
  }
}

/**
 * iOS-Safari-Fallback: derselbe POST nochmal via XHR.
 * Triggert nur wenn fetch() einen TypeError "Load failed"-artigen Fehler wirft.
 */
function xhrPostJson(
  url: string,
  body: string,
  headers: Record<string, string>,
  onProgress: TranscribeOpts['onProgress'],
  xhrImpl?: () => XMLHttpRequest,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = xhrImpl ? xhrImpl() : new XMLHttpRequest()
    xhr.open('POST', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable) {
          onProgress({ uploadedBytes: e.loaded, totalBytes: e.total })
        }
      }
    }
    xhr.onload = () => {
      let data: unknown = {}
      try { data = JSON.parse(xhr.responseText || '{}') } catch { /* ignore */ }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data })
    }
    xhr.onerror = () => reject(new Error('Netzwerkfehler – bitte Verbindung prüfen.'))
    xhr.ontimeout = () => reject(new Error('Zeitüberschreitung – bitte erneut versuchen.'))
    xhr.timeout = 60_000
    xhr.send(body)
  })
}

/**
 * Erkennt den iOS-Safari "Load failed"-TypeError, der bei großen Bodies kommt.
 * Wir matchen breit (auch deutsche Browser-Übersetzungen), wie es bau4you tut.
 */
function isIosLoadFailedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /load\s*failed|failed\s+to\s+fetch|netzwerk|fehlt/i.test(msg)
}

/**
 * Transkribiert ein Audio-Blob via /api/ai/transcribe.
 *
 * Verträge:
 *   – Wirft bei >25 MB (Bedienfehler, soll früh fallieren).
 *   – Wirft bei fehlendem Auth-Token (nicht eingeloggt).
 *   – Liefert text="" bei Netzwerk-/Server-Fehlern + console.error (kein Throw,
 *     damit UIs einfacher reagieren können – z. B. Toast statt Crash).
 */
export async function transcribeAudio(opts: TranscribeOpts): Promise<TranscribeResult> {
  const {
    audio,
    language = DEFAULT_LANGUAGE,
    model = DEFAULT_MODEL,
    onProgress,
    fetchImpl,
    xhrImpl,
    getAuthToken = defaultGetAuthToken,
  } = opts

  // ── 1. Vorab-Limit (vor Base64-Encoding, das die Größe ~33 % aufbläht) ──
  if (audio.size > TRANSCRIBE_MAX_BYTES) {
    const mb = (audio.size / (1024 * 1024)).toFixed(1)
    throw new Error(`Audio zu groß (${mb} MB > 25 MB). Bitte kürzere Aufnahme.`)
  }
  if (audio.size === 0) {
    throw new Error('Audio ist leer.')
  }

  // ── 2. Auth ──
  const token = await getAuthToken()
  if (!token) {
    throw new Error('Nicht angemeldet.')
  }

  // ── 3. Base64-Encoding ──
  let audioB64: string
  try {
    audioB64 = await blobToBase64(audio)
  } catch (err) {
    console.error('[transcribeClient] blobToBase64 failed:', err)
    return { text: '' }
  }

  const url = '/api/ai/transcribe'
  const body = JSON.stringify({
    audio: audioB64,
    mimeType: audio.type || 'audio/webm',
    language,
    model,
  })
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  const t0 = Date.now()
  const doFetch = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined)

  // ── 4. Primary: fetch ──
  try {
    if (!doFetch) throw new Error('fetch nicht verfügbar')
    const res = await doFetch(url, { method: 'POST', headers, body })
    const data = (await res.json().catch(() => ({}))) as {
      text?: string
      warning?: string
      model?: string
      error?: string
    }
    if (!res.ok) {
      console.error('[transcribeClient] server error:', res.status, data.error)
      return { text: '', warning: data.error, durationMs: Date.now() - t0 }
    }
    // Server liefert nur text+warning; model echoen wir aus dem Request,
    // falls Server keinen liefert (Schema-Compat).
    return {
      text: data.text ?? '',
      warning: data.warning,
      model: data.model ?? model,
      durationMs: Date.now() - t0,
    }
  } catch (err) {
    if (!isIosLoadFailedError(err)) {
      console.error('[transcribeClient] fetch failed (non-iOS):', err)
      return { text: '', durationMs: Date.now() - t0 }
    }

    // ── 5. iOS-Fallback: XHR (siehe bau4you SpeechInput.jsx, ca. Z. 521-532) ──
    console.warn('[transcribeClient] fetch failed (iOS?), retrying via XHR:', err)
    try {
      const xhrRes = await xhrPostJson(url, body, headers, onProgress, xhrImpl)
      const data = xhrRes.data as { text?: string; warning?: string; model?: string; error?: string }
      if (!xhrRes.ok) {
        console.error('[transcribeClient] XHR server error:', xhrRes.status, data?.error)
        return { text: '', warning: data?.error, durationMs: Date.now() - t0 }
      }
      return {
        text: data?.text ?? '',
        warning: data?.warning,
        model: data?.model ?? model,
        durationMs: Date.now() - t0,
      }
    } catch (xhrErr) {
      console.error('[transcribeClient] XHR fallback failed:', xhrErr)
      return { text: '', durationMs: Date.now() - t0 }
    }
  }
}
