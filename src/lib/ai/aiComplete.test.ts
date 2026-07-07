// ────────────────────────────────────────────────────────────────────────────
//  aiComplete – Tests (Vitest)
//
//  Validiert Verhalten gegen bau4you `fetchWithRetry` (claude.js Z. 271-376):
//   1. Normalfall (200 + content[0].text → text)
//   2. 429-Retry mit Retry-After-Header
//   3. 529-Retry (2 s Backoff, kein Retry-After-Header benötigt)
//   4. Timeout via AbortController
//   5. JSON-Parse-Fehler → wirft mit isParseError = true
//   6. Vision: images-Array landet als Anthropic-Image-Block im Body
//
//  Plus Bonus-Coverage für die zwei Antwort-Shapes (Anthropic + b4y-Backend).
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest'
import { aiComplete } from './aiComplete'
import type { AiCompleteOpts } from './aiComplete'

// ──── Helpers ──────────────────────────────────────────────────────────────

interface MockResponseInit {
  status?: number
  ok?: boolean
  json?: unknown
  /** Wirft beim .json()-Aufruf einen Fehler – simuliert kaputtes JSON. */
  jsonThrows?: boolean
  headers?: Record<string, string>
}

function mockResponse(init: MockResponseInit = {}): Response {
  const status = init.status ?? 200
  const headerMap = new Map<string, string>()
  Object.entries(init.headers ?? {}).forEach(([k, v]) =>
    headerMap.set(k.toLowerCase(), v),
  )
  const headers = {
    get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
  } as unknown as Headers
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    headers,
    json: async () => {
      if (init.jsonThrows) throw new Error('Unexpected token <')
      return init.json
    },
  } as unknown as Response
}

function makeFetchSequence(responses: Response[]): {
  fetchImpl: typeof fetch
  calls: Array<{ url: string; init: RequestInit }>
} {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} })
    const r = responses[i++]
    if (!r) throw new Error(`Test mock: keine Response für Call ${i}`)
    return r
  }) as typeof fetch
  return { fetchImpl, calls }
}

const baseOpts = (
  overrides: Partial<AiCompleteOpts> = {},
): AiCompleteOpts => ({
  systemPrompt: 'Du bist Tester.',
  userMessage: 'Sag Hallo.',
  // sleep stubben → keine echten 90 s Wartezeit in den Tests
  sleepImpl: async () => {},
  ...overrides,
})

// ──── 1. Normalfall ────────────────────────────────────────────────────────

describe('aiComplete – Normalfall', () => {
  it('liefert Text aus Anthropic-Shape content[0].text', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({
        json: {
          content: [{ type: 'text', text: 'Hallo Welt!' }],
          usage: { input_tokens: 12, output_tokens: 7 },
        },
      }),
    ])
    const result = await aiComplete(baseOpts({ fetchImpl }))
    expect(result.text).toBe('Hallo Welt!')
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 7 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/ai/chat')
    expect(calls[0].init.method).toBe('POST')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.system).toBe('Du bist Tester.')
    expect(body.messages).toEqual([{ role: 'user', content: 'Sag Hallo.' }])
    expect(body.max_tokens).toBe(16000)
  })

  it('liefert Text aus b4y-Shape { text }', async () => {
    const { fetchImpl } = makeFetchSequence([
      mockResponse({
        json: {
          type: 'message',
          message: 'Servus',
          text: 'Servus',
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        },
      }),
    ])
    const result = await aiComplete(baseOpts({ fetchImpl }))
    expect(result.text).toBe('Servus')
    // OpenAI-Tokens normalisieren auf Anthropic-Namen
    expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 1 })
  })

  it('hängt cachedContext ans System an', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ json: { content: [{ type: 'text', text: 'ok' }] } }),
    ])
    await aiComplete(
      baseOpts({
        fetchImpl,
        cachedContext: 'KATALOG: ABC',
      }),
    )
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.system).toBe('Du bist Tester.\n\nKATALOG: ABC')
  })
})

// ──── 2. 429-Retry mit Retry-After ─────────────────────────────────────────

describe('aiComplete – 429 Retry', () => {
  it('retryt bei 429 und respektiert Retry-After (Sekunden)', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ status: 429, headers: { 'retry-after': '3' } }),
      mockResponse({
        json: { content: [{ type: 'text', text: 'Endlich.' }] },
      }),
    ])
    const sleep = vi.fn(async (_ms: number) => {})
    const onRetry = vi.fn()

    const result = await aiComplete(
      baseOpts({ fetchImpl, sleepImpl: sleep, onRetry }),
    )

    expect(result.text).toBe('Endlich.')
    expect(calls).toHaveLength(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      status: 429,
      retryAfterMs: 3000,
    })
    // sleep wurde mit den 3000 ms aufgerufen
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it('fällt auf 90 s zurück, wenn kein Retry-After-Header vorhanden ist', async () => {
    const { fetchImpl } = makeFetchSequence([
      mockResponse({ status: 429 }),
      mockResponse({
        json: { content: [{ type: 'text', text: 'Ok jetzt.' }] },
      }),
    ])
    const sleep = vi.fn(async (_ms: number) => {})
    const onRetry = vi.fn()
    const result = await aiComplete(
      baseOpts({ fetchImpl, sleepImpl: sleep, onRetry }),
    )
    expect(result.text).toBe('Ok jetzt.')
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      status: 429,
      retryAfterMs: 90_000,
    })
    expect(sleep).toHaveBeenCalledWith(90_000)
  })
})

// ──── 3. 529-Retry ─────────────────────────────────────────────────────────

describe('aiComplete – 529 Overloaded', () => {
  it('retryt bei 529 mit 2 s Backoff', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ status: 529 }),
      mockResponse({
        json: { content: [{ type: 'text', text: 'Wieder oben.' }] },
      }),
    ])
    const sleep = vi.fn(async (_ms: number) => {})
    const onRetry = vi.fn()
    const result = await aiComplete(
      baseOpts({ fetchImpl, sleepImpl: sleep, onRetry }),
    )
    expect(result.text).toBe('Wieder oben.')
    expect(calls).toHaveLength(2)
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      status: 529,
      retryAfterMs: 2000,
    })
  })

  it('wirft nach erschöpften Retries bei dauerhaftem 529', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ status: 529 }),
      mockResponse({ status: 529 }),
      mockResponse({ status: 529 }),
    ])
    await expect(
      aiComplete(baseOpts({ fetchImpl, sleepImpl: async () => {} })),
    ).rejects.toMatchObject({ status: 529 })
    expect(calls).toHaveLength(3) // initial + 2 retries
  })
})

// ──── 4. Timeout ───────────────────────────────────────────────────────────

describe('aiComplete – Timeout', () => {
  it('wirft isTimeout=true wenn AbortController feuert', async () => {
    // fetch-Mock simuliert ein "hängendes" Request, das auf signal.abort reagiert.
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          reject(new Error('Test erwartet AbortSignal'))
          return
        }
        if (signal.aborted) {
          const err = new Error('aborted') as Error & { name: string }
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('aborted') as Error & { name: string }
          err.name = 'AbortError'
          reject(err)
        })
      })) as typeof fetch

    await expect(
      aiComplete(
        baseOpts({
          fetchImpl,
          timeoutMs: 25, // sehr kurz – Timer feuert direkt
        }),
      ),
    ).rejects.toMatchObject({ isTimeout: true })
  })
})

// ──── 5. JSON-Parse-Fehler ─────────────────────────────────────────────────

describe('aiComplete – Parse-Fehler', () => {
  it('wirft isParseError=true wenn JSON kaputt ist', async () => {
    const { fetchImpl } = makeFetchSequence([
      mockResponse({ jsonThrows: true }),
    ])
    await expect(
      aiComplete(baseOpts({ fetchImpl })),
    ).rejects.toMatchObject({ isParseError: true })
  })

  it('wirft isParseError=true wenn weder content[].text noch text/message vorhanden sind', async () => {
    const { fetchImpl } = makeFetchSequence([
      mockResponse({ json: { foo: 'bar' } }),
    ])
    await expect(
      aiComplete(baseOpts({ fetchImpl })),
    ).rejects.toMatchObject({ isParseError: true })
  })
})

// ──── 6. Vision: Bilder im Body ────────────────────────────────────────────

describe('aiComplete – Vision', () => {
  it('hängt images als Anthropic-Image-Blocks an messages[0].content an', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ json: { content: [{ type: 'text', text: 'gesehen' }] } }),
    ])
    const result = await aiComplete(
      baseOpts({
        fetchImpl,
        images: [
          { mime: 'image/jpeg', base64: 'AAAA' },
          { mime: 'image/png', base64: 'BBBB' },
        ],
      }),
    )
    expect(result.text).toBe('gesehen')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.messages).toHaveLength(1)
    expect(Array.isArray(body.messages[0].content)).toBe(true)
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Sag Hallo.' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
      },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'BBBB' },
      },
    ])
  })

  it('lässt content als String, wenn images leer/undefined', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ json: { content: [{ type: 'text', text: 'ok' }] } }),
    ])
    await aiComplete(baseOpts({ fetchImpl, images: [] }))
    const body = JSON.parse(calls[0].init.body as string)
    expect(typeof body.messages[0].content).toBe('string')
    expect(body.messages[0].content).toBe('Sag Hallo.')
  })
})

// ──── 7. Header / Auth / maxTokens ─────────────────────────────────────────

describe('aiComplete – Auth & Optionen', () => {
  it('setzt Authorization-Header, wenn authToken gesetzt ist', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ json: { content: [{ type: 'text', text: 'ok' }] } }),
    ])
    await aiComplete(
      baseOpts({ fetchImpl, authToken: 'jwt-xyz', maxTokens: 4000 }),
    )
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer jwt-xyz')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.max_tokens).toBe(4000)
  })

  it('wirft Validation-Error bei leerem userMessage', async () => {
    await expect(
      aiComplete(
        baseOpts({ userMessage: '', fetchImpl: makeFetchSequence([]).fetchImpl }),
      ),
    ).rejects.toThrow(/userMessage/)
  })

  it('sendet response_format NICHT, wenn responseFormat undefined ist (Rückwärts-Kompat)', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ json: { content: [{ type: 'text', text: 'ok' }] } }),
    ])
    await aiComplete(baseOpts({ fetchImpl }))
    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>
    expect('response_format' in body).toBe(false)
  })

  it('sendet response_format="json" wenn opts.responseFormat="json"', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ json: { content: [{ type: 'text', text: 'ok' }] } }),
    ])
    await aiComplete(baseOpts({ fetchImpl, responseFormat: 'json' }))
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.response_format).toBe('json')
  })

  it('sendet response_format="text" wenn explizit gesetzt', async () => {
    const { fetchImpl, calls } = makeFetchSequence([
      mockResponse({ json: { content: [{ type: 'text', text: 'ok' }] } }),
    ])
    await aiComplete(baseOpts({ fetchImpl, responseFormat: 'text' }))
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.response_format).toBe('text')
  })

  it('reicht Server-Fehlermeldung bei 500 durch', async () => {
    const { fetchImpl } = makeFetchSequence([
      mockResponse({
        status: 500,
        ok: false,
        json: { error: { message: 'Backend kaputt' } },
      }),
    ])
    await expect(
      aiComplete(baseOpts({ fetchImpl })),
    ).rejects.toMatchObject({ status: 500, message: 'Backend kaputt' })
  })
})
