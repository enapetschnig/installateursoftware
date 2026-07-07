// ────────────────────────────────────────────────────────────────────────────
//  aiComplete – Wrapper um POST /api/ai/chat.
//
//  Replikat der bau4you-Funktion `fetchWithRetry` / `callClaude` aus
//  /tmp/bau4you-app/src/lib/claude.js (Z. 271-389), portiert auf die
//  b4y-superapp-Backend-Route (`/api/ai/chat`) – diese spricht OpenAI gpt-4o
//  serverseitig, das Frontend bleibt provider-agnostisch.
//
//  Verhalten:
//    • POST { messages, system, max_tokens } an /api/ai/chat
//    • 429 → Backoff (Default 90 s) mit Countdown via onRetry
//    • 529 → 2 s Backoff (Anthropic-Overloaded-Style, vom Backend evtl.
//            durchgereicht; verhält sich identisch zu bau4you-Original)
//    • Timeout via AbortController (Default 120 s)
//    • Antwort-Shapes:
//        – Anthropic-Shape:  { content: [{ type:"text", text:"…" }], usage }
//        – b4y-Shape:        { type:"message", message:"…", text:"…" }
//      Beide werden auf AiCompleteResult.text normalisiert.
//    • Parse-Fehler werfen Error mit `isParseError = true`
//
//  Vision (Phase 1): images werden als Anthropic-kompatible Image-Blocks
//  in messages[0].content angehängt. Das Backend muss diese ggf. an
//  OpenAI-Format mappen – das ist außerhalb des Wrappers.
//
//  Auth-Hintergrund: Der zuvor verwendete dynamische `import("../supabase")`
//  hat alle Fehler stillschweigend geschluckt (auch Mappingfehler), wodurch
//  Auth-Probleme nur über die HTTP-401 Antwort sichtbar wurden. Wir importieren
//  daher statisch und führen vor dem Request einen Soft-Refresh durch, falls
//  der gecachte JWT in weniger als 60 s abläuft (Tab > 1 h offen).
// ────────────────────────────────────────────────────────────────────────────

import { supabase } from '../supabase'

export interface AiCompleteImage {
  /** MIME-Type, z. B. "image/jpeg" oder "image/png". */
  mime: string
  /** Base64-kodierte Bilddaten, ohne data:-Prefix. */
  base64: string
}

export interface AiCompleteRetryInfo {
  attempt: number
  status: number
  retryAfterMs?: number
}

export interface AiCompleteOpts {
  systemPrompt: string
  userMessage: string
  /** Prompt-Caching-Block (Katalog, Settings) – wird ans System angehängt. */
  cachedContext?: string
  /** Vision (Phase 1 stub: wird strukturiert mitgesendet). */
  images?: AiCompleteImage[]
  /** Default 16000. */
  maxTokens?: number
  /** Default 120000 ms. 0 deaktiviert das Timeout. */
  timeoutMs?: number
  onRetry?: (info: AiCompleteRetryInfo) => void
  /** Test-Hook: überschreibt globalThis.fetch. */
  fetchImpl?: typeof fetch
  /** Test-Hook: ersetzt setTimeout (für 429-Countdown ohne echte 90 s). */
  sleepImpl?: (ms: number) => Promise<void>
  /** Override Endpoint (Default `/api/ai/chat`). */
  endpoint?: string
  /** Optional: zusätzliche Bearer-Auth (Supabase JWT). */
  authToken?: string
  /**
   * Signalisiert dem Backend das gewünschte Antwortformat.
   *   • `"text"`  → freier Text (Default-Verhalten, unverändert)
   *   • `"json"` → strenger JSON-Modus (Backend setzt z. B.
   *     OpenAI `response_format: { type: "json_object" }`)
   * Wird als `response_format` in den Request-Body geschrieben.
   * Backend ignoriert das Feld, falls nicht unterstützt – kein Bruch.
   * Default: `"text"` (Feld wird gar nicht gesendet, wenn undefined).
   */
  responseFormat?: 'text' | 'json'
}

export interface AiCompleteUsage {
  input_tokens: number
  output_tokens: number
}

export interface AiCompleteResult {
  text: string
  usage?: AiCompleteUsage
}

export interface AiCompleteError extends Error {
  status?: number
  isParseError?: boolean
  isTimeout?: boolean
}

// ──── Konstanten (1:1 wie bau4you fetchWithRetry) ──────────────────────────
const MAX_RETRIES = 2
const RETRY_WAIT_SEC_DEFAULT = 90
const OVERLOADED_WAIT_MS = 2000
const DEFAULT_MAX_TOKENS = 16000
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_ENDPOINT = '/api/ai/chat'

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

function makeError(
  message: string,
  extras: Partial<AiCompleteError> = {},
): AiCompleteError {
  const err = new Error(message) as AiCompleteError
  Object.assign(err, extras)
  return err
}

/**
 * Liest Retry-After-Header (Sekunden ODER HTTP-Date) und liefert ms.
 * Fällt auf den übergebenen Default zurück, falls Header fehlt/ungültig.
 */
function parseRetryAfter(headerValue: string | null, defaultMs: number): number {
  if (!headerValue) return defaultMs
  const trimmed = headerValue.trim()
  if (!trimmed) return defaultMs
  const asNum = Number(trimmed)
  if (Number.isFinite(asNum) && asNum >= 0) {
    return Math.round(asNum * 1000)
  }
  const asDate = Date.parse(trimmed)
  if (Number.isFinite(asDate)) {
    const diff = asDate - Date.now()
    return diff > 0 ? diff : defaultMs
  }
  return defaultMs
}

/**
 * Extrahiert den Antworttext aus dem JSON-Body – akzeptiert sowohl
 * Anthropic- als auch b4y-Shape und wirft einen ParseError, wenn keiner passt.
 */
function extractText(data: unknown): { text: string; usage?: AiCompleteUsage } {
  if (!data || typeof data !== 'object') {
    throw makeError('Leere oder ungültige KI-Antwort.', { isParseError: true })
  }
  const d = data as Record<string, unknown>

  // ── Anthropic-Shape: content: [{ type:"text", text:"…" }] ─────────────
  const content = d.content
  if (Array.isArray(content) && content.length > 0) {
    const textBlocks = content.filter(
      (b): b is { type: string; text: string } =>
        !!b &&
        typeof b === 'object' &&
        (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string',
    )
    if (textBlocks.length > 0) {
      const text = textBlocks.map((b) => b.text).join('\n')
      const usage = normalizeUsage(d.usage)
      return usage ? { text, usage } : { text }
    }
  }

  // ── b4y-Shape: { type:"message", message:"…", text:"…" } ──────────────
  if (typeof d.text === 'string' && d.text.length > 0) {
    const usage = normalizeUsage(d.usage)
    return usage ? { text: d.text, usage } : { text: d.text }
  }
  if (typeof d.message === 'string' && d.message.length > 0) {
    const usage = normalizeUsage(d.usage)
    return usage ? { text: d.message, usage } : { text: d.message }
  }

  throw makeError('Keine Textantwort von der KI erhalten.', {
    isParseError: true,
  })
}

function normalizeUsage(u: unknown): AiCompleteUsage | undefined {
  if (!u || typeof u !== 'object') return undefined
  const o = u as Record<string, unknown>
  // Anthropic: input_tokens/output_tokens. OpenAI: prompt_tokens/completion_tokens.
  const input =
    typeof o.input_tokens === 'number'
      ? o.input_tokens
      : typeof o.prompt_tokens === 'number'
        ? o.prompt_tokens
        : undefined
  const output =
    typeof o.output_tokens === 'number'
      ? o.output_tokens
      : typeof o.completion_tokens === 'number'
        ? o.completion_tokens
        : undefined
  if (input === undefined && output === undefined) return undefined
  return { input_tokens: input ?? 0, output_tokens: output ?? 0 }
}

/**
 * Baut den User-Content. Bei reinem Text bleibt es ein String (b4y-Backend
 * erwartet `content: string` für OpenAI-Mapping). Sobald Bilder dabei sind,
 * wird das Anthropic-kompatible Content-Block-Array gesendet.
 */
function buildUserContent(
  userMessage: string,
  images?: AiCompleteImage[],
): string | Array<Record<string, unknown>> {
  if (!images || images.length === 0) return userMessage
  const blocks: Array<Record<string, unknown>> = [
    { type: 'text', text: userMessage },
  ]
  for (const img of images) {
    if (!img || !img.mime || !img.base64) continue
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.base64 },
    })
  }
  return blocks
}

/**
 * Wrapper um /api/ai/chat mit Retry/Timeout-Verhalten wie bau4you
 * `fetchWithRetry`. Wirft AiCompleteError mit aussagekräftigen Flags.
 */
export async function aiComplete(
  opts: AiCompleteOpts,
): Promise<AiCompleteResult> {
  if (!opts || typeof opts !== 'object') {
    throw makeError('aiComplete: opts fehlt.')
  }
  if (typeof opts.systemPrompt !== 'string') {
    throw makeError('aiComplete: systemPrompt muss String sein.')
  }
  if (typeof opts.userMessage !== 'string' || opts.userMessage.length === 0) {
    throw makeError('aiComplete: userMessage muss nicht-leerer String sein.')
  }

  const fetchImpl: typeof fetch =
    opts.fetchImpl ?? (globalThis.fetch?.bind(globalThis) as typeof fetch)
  if (typeof fetchImpl !== 'function') {
    throw makeError('aiComplete: kein fetch verfügbar (Browser/Node 18+).')
  }
  const sleep = opts.sleepImpl ?? defaultSleep
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT

  // System: optional + cachedContext separat (Backend kann beides nutzen)
  const system = opts.cachedContext
    ? `${opts.systemPrompt}\n\n${opts.cachedContext}`
    : opts.systemPrompt

  const userContent = buildUserContent(opts.userMessage, opts.images)
  const body: {
    system: string
    messages: Array<{
      role: 'user'
      content: string | Array<Record<string, unknown>>
    }>
    max_tokens: number
    response_format?: 'text' | 'json'
  } = {
    system,
    messages: [{ role: 'user' as const, content: userContent }],
    max_tokens: maxTokens,
  }
  // Optional response_format-Flag – Backend kann daraus z. B.
  // OpenAI `response_format: { type: "json_object" }` ableiten.
  // Wenn `opts.responseFormat` undefined ist, wird das Feld weggelassen
  // (= rückwärts-kompatibel; bestehende Caller bleiben unverändert).
  if (opts.responseFormat !== undefined) {
    body.response_format = opts.responseFormat
  }
  const bodyStr = JSON.stringify(body)

  // Auth-Token: explizit uebergeben hat Vorrang, sonst aus Supabase-Session.
  // Backend /api/ai/chat verlangt einen Bearer-Token, sonst 401 "Nicht angemeldet".
  //
  // Wichtig (vgl. Audit Phase 8, HIGH-2/3): `getSession()` liefert den
  // gecachten JWT zurück – bei langer Tab-Offen-Zeit ist der bereits abgelaufen
  // und das Backend antwortet 401. Wir prüfen daher die Restlaufzeit und
  // refreshen proaktiv, wenn weniger als 60 s bleiben.
  let token = opts.authToken
  if (!token) {
    try {
      const { data: sess } = await supabase.auth.getSession()
      let access = sess.session?.access_token
      const expAt = sess.session?.expires_at ?? 0
      // Refresh, wenn weniger als 60 s Restlaufzeit (expires_at ist UNIX-Seconds).
      if (access && expAt > 0 && expAt * 1000 - Date.now() < 60_000) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        access = refreshed.session?.access_token ?? access
      }
      token = access ?? undefined
    } catch {
      // In Tests / SSR ohne lebende Supabase-Session: kein Auto-Token.
      // Der Request läuft ohne Authorization-Header los; Backend antwortet 401,
      // was im aufrufenden Code (Voice/Cockpit/Isabella) sauber gehandhabt wird.
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const controller = timeoutMs > 0 ? new AbortController() : null
  const timeoutId = controller
    ? setTimeout(
        () =>
          controller.abort(
            new DOMException(`Timeout nach ${timeoutMs}ms`, 'AbortError'),
          ),
        timeoutMs,
      )
    : null

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: bodyStr,
          signal: controller?.signal,
        })
      } catch (e) {
        // AbortError → Timeout
        const isAbort =
          (e instanceof Error && e.name === 'AbortError') ||
          (e as { name?: string })?.name === 'AbortError'
        if (isAbort) {
          throw makeError(
            `KI-Anfrage abgebrochen (Timeout nach ${timeoutMs}ms).`,
            { isTimeout: true },
          )
        }
        throw e
      }

      // 529 → 2 s Backoff (Overloaded)
      if (response.status === 529 && attempt < MAX_RETRIES) {
        opts.onRetry?.({
          attempt: attempt + 1,
          status: 529,
          retryAfterMs: OVERLOADED_WAIT_MS,
        })
        await sleep(OVERLOADED_WAIT_MS)
        continue
      }

      // 429 → Backoff mit Countdown
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const headerWaitMs = parseRetryAfter(
          response.headers.get('retry-after'),
          RETRY_WAIT_SEC_DEFAULT * 1000,
        )
        opts.onRetry?.({
          attempt: attempt + 1,
          status: 429,
          retryAfterMs: headerWaitMs,
        })
        await sleep(headerWaitMs)
        continue
      }

      if (!response.ok) {
        // Letzter Versuch oder nicht-retrybarer Status
        let errMsg: string | null = null
        try {
          const errJson = (await response.json()) as Record<string, unknown>
          errMsg =
            (errJson?.error as { message?: string } | undefined)?.message ||
            (typeof errJson?.error === 'string'
              ? (errJson.error as string)
              : null) ||
            (typeof errJson?.message === 'string'
              ? (errJson.message as string)
              : null)
        } catch {
          /* ignore parse errors on error-body */
        }
        if (response.status === 529) {
          throw makeError(
            'API momentan überlastet, bitte in 30 Sekunden nochmal versuchen.',
            { status: 529 },
          )
        }
        throw makeError(errMsg || `KI-Fehler (HTTP ${response.status}).`, {
          status: response.status,
        })
      }

      let data: unknown
      try {
        data = await response.json()
      } catch (e) {
        throw makeError('KI-Antwort war kein gültiges JSON.', {
          isParseError: true,
          status: response.status,
        })
      }

      return extractText(data)
    }

    // Alle Retries erschöpft
    throw makeError(
      'Die KI ist gerade ausgelastet. Bitte in einigen Minuten erneut versuchen.',
    )
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
