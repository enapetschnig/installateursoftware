import { describe, it, expect } from 'vitest'
import {
  cleanWebSearchTags,
  repairTruncatedJson,
  parseJsonResponse,
  type ParseJsonError,
} from './parseJson'

describe('parseJsonResponse', () => {
  it('parst reines JSON {"a":1} → {a:1}', () => {
    const out = parseJsonResponse<{ a: number }>('{"a": 1}')
    expect(out).toEqual({ a: 1 })
  })

  it('parst Markdown-Block ```json …``` ', () => {
    const raw = '```json\n{"a":1,"b":"x"}\n```'
    const out = parseJsonResponse<{ a: number; b: string }>(raw)
    expect(out).toEqual({ a: 1, b: 'x' })
  })

  it('parst Markdown-Block ohne json-Tag (```...```)', () => {
    const raw = '```\n{"v": 42}\n```'
    const out = parseJsonResponse<{ v: number }>(raw)
    expect(out).toEqual({ v: 42 })
  })

  it('parst Text mit Prefix "Hier ist:\\n{…}"', () => {
    const raw = 'Hier ist das Angebot:\n{"gewerke":[{"name":"Maler"}]}'
    const out = parseJsonResponse<{ gewerke: { name: string }[] }>(raw)
    expect(out.gewerke[0].name).toBe('Maler')
  })

  it('parst tief verschachteltes JSON aus Mischtext', () => {
    const raw =
      'OK. ```json\n{"a":{"b":[1,2,3]},"c":"hello"}\n```\nViele Grüße'
    const out = parseJsonResponse<{ a: { b: number[] }; c: string }>(raw)
    expect(out.a.b).toEqual([1, 2, 3])
    expect(out.c).toBe('hello')
  })

  it('wirft Error mit isParseError=true bei totalem Garbage', () => {
    let caught: ParseJsonError | null = null
    try {
      parseJsonResponse('das ist gar kein JSON, nur Prosa.')
    } catch (e) {
      caught = e as ParseJsonError
    }
    expect(caught).not.toBeNull()
    expect(caught!.isParseError).toBe(true)
    expect(caught!.message).toMatch(/Angebot/i)
  })

  it('wirft Error mit isParseError=true bei leerem Input', () => {
    let caught: ParseJsonError | null = null
    try {
      parseJsonResponse('')
    } catch (e) {
      caught = e as ParseJsonError
    }
    expect(caught).not.toBeNull()
    expect(caught!.isParseError).toBe(true)
  })

  it('parst JSON, wenn nur ein abgeschlossenes Element-Trail folgt', () => {
    // Repair-Stufe: ", trailing entfernen, Klammern schließen
    const raw = '{"a":1,"b":2,'
    const out = parseJsonResponse<{ a: number; b: number }>(raw)
    expect(out.a).toBe(1)
    expect(out.b).toBe(2)
  })
})

describe('repairTruncatedJson', () => {
  it('repariert "{"a":1,"b":2," → schließt mit }', () => {
    const out = repairTruncatedJson('{"a":1,"b":2,')
    const parsed = JSON.parse(out)
    expect(parsed.a).toBe(1)
    expect(parsed.b).toBe(2)
  })

  it('repariert offenes Array "{"arr":[1,2,"', () => {
    const out = repairTruncatedJson('{"arr":[1,2,')
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed.arr)).toBe(true)
    expect(parsed.arr).toContain(1)
    expect(parsed.arr).toContain(2)
  })

  it('lässt bereits gültiges JSON unverändert', () => {
    const valid = '{"a":1}'
    expect(repairTruncatedJson(valid)).toBe(valid)
  })

  it('repariert verschachtelte abgeschnittene Struktur', () => {
    const raw = '{"x":{"y":[{"z":1},{"z":2'
    const out = repairTruncatedJson(raw)
    // Sollte parsebar sein
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('gibt Text unverändert zurück, wenn kein { vorhanden', () => {
    expect(repairTruncatedJson('nur prosa')).toBe('nur prosa')
  })

  it('ignoriert Klammern innerhalb von Strings (escaping-aware)', () => {
    // Klammern in Strings dürfen Counter NICHT verändern – der msg-String
    // enthält ein `{` und ein `[`, das Repair muss diese ignorieren.
    const raw = '{"msg":"hat { und [ drin","x":1}'
    const out = repairTruncatedJson(raw)
    // Bereits gültig → identisch
    expect(out).toBe(raw)
    const parsed = JSON.parse(out)
    expect(parsed.msg).toBe('hat { und [ drin')
    expect(parsed.x).toBe(1)
  })
})

describe('cleanWebSearchTags', () => {
  it('entfernt <cite>...</cite> Tags (Inhalt bleibt, Tags weg)', () => {
    // Quelle: claude.js – Tags werden entfernt, der Inner-Text bleibt erhalten.
    expect(cleanWebSearchTags('<cite>(1)</cite> Hallo')).toBe('(1) Hallo')
  })

  it('entfernt nackte <cite>-Tags vollständig wenn nur Tag steht', () => {
    expect(cleanWebSearchTags('<cite></cite>Hallo')).toBe('Hallo')
  })

  it('lässt Text ohne Tags unverändert (außer Trim)', () => {
    expect(cleanWebSearchTags('Hallo Welt')).toBe('Hallo Welt')
  })

  it('entfernt <cite ...>-Tags mit Attributen (Text bleibt)', () => {
    const input = '<cite source="foo" id="bar">Quelle</cite> Hallo'
    expect(cleanWebSearchTags(input)).toBe('Quelle Hallo')
  })

  it('entfernt beliebige HTML-Tags (<span>, <a>)', () => {
    const input = '<span class="x">A</span> <a href="#">B</a> <strong>C</strong>'
    expect(cleanWebSearchTags(input)).toBe('A B C')
  })

  it('kollabiert doppelte Whitespaces zu single space', () => {
    expect(cleanWebSearchTags('Hallo    Welt')).toBe('Hallo Welt')
  })

  it('gibt leeren String für leeren Input', () => {
    expect(cleanWebSearchTags('')).toBe('')
  })

  it('gibt undefined/null durch (defensiv)', () => {
    // @ts-expect-error – Test defensiver Pfad
    expect(cleanWebSearchTags(undefined)).toBeUndefined()
    // @ts-expect-error – Test defensiver Pfad
    expect(cleanWebSearchTags(null)).toBeNull()
  })
})
