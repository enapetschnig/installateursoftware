// ────────────────────────────────────────────────────────────────────────────
//  transcribeClient – Tests (Vitest)
//
//  Wir testen die Pure-Logic-Pfade von src/lib/speech/transcribeClient.ts:
//   1. Erfolgreicher Aufruf  → text zurückgegeben
//   2. > 25 MB Blob         → wirft mit klarer Message
//   3. Network-Fehler        → text="" + console.error
//   4. Base64-Encoding korrekt (kein "data:...;base64," Prefix)
//   5. fetchImpl-Injection für Stubs
//   6. (Bonus) iOS-Load-Failed-Fehler → XHR-Fallback wird aufgerufen
//   7. (Bonus) Leeres Blob → wirft sofort
//   8. (Bonus) Server liefert !ok → text="" + warning übernommen
//
//  Wir injecten getAuthToken, damit der Supabase-Default-Provider in Node-Tests
//  nicht greift.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  transcribeAudio,
  blobToBase64,
  TRANSCRIBE_MAX_BYTES,
} from './transcribeClient'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBlob(bytes: number, type = 'audio/webm'): Blob {
  // Uint8Array → Blob; default-content lässt sich später wieder decodieren.
  const buf = new Uint8Array(bytes)
  for (let i = 0; i < bytes; i++) buf[i] = i % 256
  return new Blob([buf], { type })
}

function makeFakeBlob(size: number, type = 'audio/webm'): Blob {
  // Künstliches Blob mit definierter .size ohne echte Allokation –
  // für den 25-MB-Test (echte 25 MB im RAM wäre Verschwendung).
  return {
    size,
    type,
    arrayBuffer: async () => new ArrayBuffer(0),
    slice: () => makeFakeBlob(0, type),
    stream: () => ({ getReader: () => ({}) }) as unknown as ReadableStream,
    text: async () => '',
  } as unknown as Blob
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

const tokenStub = () => Promise.resolve('test-token')

let consoleErrorSpy: ReturnType<typeof vi.spyOn>
let consoleWarnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  consoleWarnSpy.mockRestore()
  vi.restoreAllMocks()
})

// ────────────────────────────────────────────────────────────────────────────

describe('transcribeAudio', () => {
  // ── 1. Happy Path ────────────────────────────────────────────────────────
  it('returns text on successful response', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ text: 'Hallo Welt', model: 'gpt-4o-transcribe' }),
    )
    const r = await transcribeAudio({
      audio: makeBlob(128),
      fetchImpl: fetchMock as unknown as typeof fetch,
      getAuthToken: tokenStub,
    })
    expect(r.text).toBe('Hallo Welt')
    expect(r.model).toBe('gpt-4o-transcribe')
    expect(typeof r.durationMs).toBe('number')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  // ── 2. Size Limit ────────────────────────────────────────────────────────
  it('throws when blob exceeds 25 MB', async () => {
    const tooBig = makeFakeBlob(TRANSCRIBE_MAX_BYTES + 1)
    const fetchMock = vi.fn()
    await expect(
      transcribeAudio({
        audio: tooBig,
        fetchImpl: fetchMock as unknown as typeof fetch,
        getAuthToken: tokenStub,
      }),
    ).rejects.toThrow(/Audio zu groß/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── 3. Network-Fehler → text="" + log ────────────────────────────────────
  it('returns text="" and logs error on non-iOS fetch failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('DNS resolution failed')
    })
    const r = await transcribeAudio({
      audio: makeBlob(64),
      fetchImpl: fetchMock as unknown as typeof fetch,
      getAuthToken: tokenStub,
    })
    expect(r.text).toBe('')
    expect(consoleErrorSpy).toHaveBeenCalled()
    // Stelle sicher, dass kein XHR-Fallback versucht wurde
    expect(consoleWarnSpy).not.toHaveBeenCalled()
  })

  // ── 4. Base64-Encoding korrekt ───────────────────────────────────────────
  it('strips "data:...;base64," prefix when encoding', async () => {
    // "abc" → Base64 "YWJj"
    const blob = new Blob(['abc'], { type: 'audio/webm' })
    const encoded = await blobToBase64(blob)
    expect(encoded).toBe('YWJj')
    expect(encoded).not.toMatch(/^data:/)
    expect(encoded).not.toContain(',')
  })

  // ── 4b. Encoded payload landet im fetch-Body ohne Prefix ────────────────
  it('sends audio without data-URL prefix in request body', async () => {
    let capturedBody: string | undefined
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return jsonResponse({ text: 'ok' })
    })
    await transcribeAudio({
      audio: new Blob(['abc'], { type: 'audio/webm' }),
      fetchImpl: fetchMock as unknown as typeof fetch,
      getAuthToken: tokenStub,
    })
    expect(capturedBody).toBeDefined()
    const parsed = JSON.parse(capturedBody!)
    expect(parsed.audio).toBe('YWJj')
    expect(parsed.audio).not.toMatch(/^data:/)
    expect(parsed.mimeType).toBe('audio/webm')
    expect(parsed.language).toBe('de')
    expect(parsed.model).toBe('gpt-4o-transcribe')
  })

  // ── 5. fetchImpl-Injection ───────────────────────────────────────────────
  it('uses injected fetchImpl over global fetch', async () => {
    const customFetch = vi.fn(async () => jsonResponse({ text: 'INJECTED' }))
    const r = await transcribeAudio({
      audio: makeBlob(32),
      fetchImpl: customFetch as unknown as typeof fetch,
      getAuthToken: tokenStub,
    })
    expect(r.text).toBe('INJECTED')
    expect(customFetch).toHaveBeenCalledWith(
      '/api/ai/transcribe',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      }),
    )
  })

  // ── 6. iOS-Fallback ──────────────────────────────────────────────────────
  it('falls back to XHR when fetch throws "Load failed" (iOS Safari)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Load failed')
    })
    // Minimal-XHR-Stub – simuliert 200-Response
    const xhrInstance = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(function (this: { onload?: () => void }) {
        // Asynchron auflösen, damit onload (set danach) sicher gesetzt ist
        queueMicrotask(() => this.onload?.())
      }),
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
      ontimeout: null as null | (() => void),
      upload: { onprogress: null },
      status: 200,
      responseText: JSON.stringify({ text: 'XHR-OK' }),
      timeout: 0,
    }
    const xhrImpl = vi.fn(() => xhrInstance as unknown as XMLHttpRequest)
    const r = await transcribeAudio({
      audio: makeBlob(64),
      fetchImpl: fetchMock as unknown as typeof fetch,
      xhrImpl,
      getAuthToken: tokenStub,
    })
    expect(r.text).toBe('XHR-OK')
    expect(xhrImpl).toHaveBeenCalledOnce()
    expect(consoleWarnSpy).toHaveBeenCalled()
  })

  // ── 7. Empty blob ────────────────────────────────────────────────────────
  it('throws on empty blob', async () => {
    const fetchMock = vi.fn()
    await expect(
      transcribeAudio({
        audio: makeBlob(0),
        fetchImpl: fetchMock as unknown as typeof fetch,
        getAuthToken: tokenStub,
      }),
    ).rejects.toThrow(/leer/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── 8. Server liefert !ok ────────────────────────────────────────────────
  it('returns text="" and passes server error through warning on non-ok response', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'Audioformat nicht unterstützt.' }, { ok: false, status: 415 }),
    )
    const r = await transcribeAudio({
      audio: makeBlob(64, 'audio/exotic'),
      fetchImpl: fetchMock as unknown as typeof fetch,
      getAuthToken: tokenStub,
    })
    expect(r.text).toBe('')
    expect(r.warning).toBe('Audioformat nicht unterstützt.')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  // ── 9. Missing auth ──────────────────────────────────────────────────────
  it('throws when no auth token is available', async () => {
    const fetchMock = vi.fn()
    await expect(
      transcribeAudio({
        audio: makeBlob(64),
        fetchImpl: fetchMock as unknown as typeof fetch,
        getAuthToken: () => Promise.resolve(null),
      }),
    ).rejects.toThrow(/angemeldet/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── 10. Custom language + model durchgereicht ───────────────────────────
  it('forwards custom language and model to server', async () => {
    let capturedBody: string | undefined
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return jsonResponse({ text: 'ok' })
    })
    await transcribeAudio({
      audio: makeBlob(64),
      language: 'en',
      model: 'whisper-1',
      fetchImpl: fetchMock as unknown as typeof fetch,
      getAuthToken: tokenStub,
    })
    const parsed = JSON.parse(capturedBody!)
    expect(parsed.language).toBe('en')
    expect(parsed.model).toBe('whisper-1')
  })
})
