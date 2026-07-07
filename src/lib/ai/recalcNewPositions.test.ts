// ────────────────────────────────────────────────────────────────────────────
//  recalcNewPositions – Tests (Vitest)
//
//  Verifiziert das portierte Verhalten von claude.js `recalcNewPositionsWithModus1`:
//    1. Neue Position (aus_preisliste=false) wird kalkuliert
//    2. Katalog-Position mit echtem Preis wird übersprungen
//    3. Header-Position (XX-000) wird übersprungen
//    4. Spezial-Position (XX-997 / XX-999) wird übersprungen
//    5. onProgress wird sequenziell mit korrektem current/total aufgerufen
//    6. Fehlgeschlagener aiComplete → Position bleibt unverändert
//    7. 0 €-Katalog-Position wird nachkalkuliert
//    8. Modus-2-Texte (leistungsname/beschreibung) bleiben erhalten
//    9. Empty-Input → no-op
//   10. Array-Antwort von KI → wird ignoriert (Modus-1 erwartet Objekt)
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest'
import { recalcNewPositions } from './recalcNewPositions'
import type { AiCompleteOpts, AiCompleteResult } from './aiComplete'
import type { Gewerk, Position } from '../calc/types'

// ──── Helpers ──────────────────────────────────────────────────────────────

function mkPos(over: Partial<Position> = {}): Position {
  return {
    leistungsnummer: '09-NEU1',
    leistungsname: 'Spachteln Q3',
    beschreibung: 'Wand glätten',
    einheit: 'm²',
    menge: 10,
    materialkosten_einheit: 0,
    lohnkosten_einheit: 0,
    lohnkosten_minuten: 0,
    stundensatz: 0,
    vk_netto_einheit: 0,
    gesamtpreis: 0,
    aus_preisliste: false,
    ...over,
  }
}

function mkGewerk(name: string, positionen: Position[]): Gewerk {
  return { name, positionen }
}

/** Mock-aiComplete der pro Aufruf eine vorgegebene JSON-Antwort liefert. */
function mockAiComplete(
  jsons: Array<Record<string, unknown> | string | Error>,
) {
  const calls: AiCompleteOpts[] = []
  let i = 0
  const fn = async (opts: AiCompleteOpts): Promise<AiCompleteResult> => {
    calls.push(opts)
    const next = jsons[i++]
    if (next === undefined) {
      throw new Error(`Mock: keine Antwort vorbereitet (Call ${i})`)
    }
    if (next instanceof Error) throw next
    const text = typeof next === 'string' ? next : JSON.stringify(next)
    return { text }
  }
  return { fn, calls }
}

// ──── 1. Neue Position wird kalkuliert ─────────────────────────────────────

describe('recalcNewPositions – Recalc-Kandidaten', () => {
  it('ruft aiComplete für Positionen mit aus_preisliste=false auf', async () => {
    const pos = mkPos({ aus_preisliste: false, vk_netto_einheit: 0 })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn, calls } = mockAiComplete([
      {
        vk_netto_einheit: 42.5,
        gesamtpreis: 425,
        lohnkosten_einheit: 30,
        lohnkosten_minuten: 25,
        materialkosten_einheit: 12.5,
        stundensatz: 72,
      },
    ])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS-PROMPT',
      aiComplete: fn,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].systemPrompt).toBe('SYS-PROMPT')
    expect(calls[0].userMessage).toContain('Spachteln Q3')
    expect(calls[0].userMessage).toContain('Gewerk: Maler')
    expect(calls[0].userMessage).toContain('Menge: 10 m²')

    const updated = result[0].positionen[0]
    expect(updated.vk_netto_einheit).toBe(42.5)
    expect(updated.gesamtpreis).toBe(425)
    expect(updated.lohnkosten_einheit).toBe(30)
    expect(updated.lohnkosten_minuten).toBe(25)
    expect(updated.materialkosten_einheit).toBe(12.5)
    expect(updated.stundensatz).toBe(72)
    expect(updated._modus1_recalc).toBe(true)
  })

  it('nachkalkuliert auch Katalog-Positionen mit 0 €-Preis', async () => {
    const pos = mkPos({
      leistungsnummer: '09-123',
      aus_preisliste: true,
      vk_netto_einheit: 0, // 0 € → muss ermittelt werden
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn, calls } = mockAiComplete([
      { vk_netto_einheit: 25, gesamtpreis: 250 },
    ])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(calls).toHaveLength(1)
    expect(result[0].positionen[0].vk_netto_einheit).toBe(25)
  })
})

// ──── 2. Skip-Kandidaten ───────────────────────────────────────────────────

describe('recalcNewPositions – Skip-Regeln', () => {
  it('überspringt Header-Positionen (XX-000)', async () => {
    const header = mkPos({
      leistungsnummer: '09-000',
      leistungsname: 'Maler-Header',
      aus_preisliste: false,
    })
    const gewerke = [mkGewerk('Maler', [header])]
    const { fn, calls } = mockAiComplete([])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(calls).toHaveLength(0)
    expect(result[0].positionen[0]).toBe(header) // identity unchanged
    expect(result[0].positionen[0]._modus1_recalc).toBeUndefined()
  })

  it('überspringt Spezial-Positionen XX-990 bis XX-999', async () => {
    const positions = [
      mkPos({ leistungsnummer: '09-990', aus_preisliste: false }),
      mkPos({ leistungsnummer: '09-997', aus_preisliste: false }),
      mkPos({ leistungsnummer: '09-999', aus_preisliste: false }),
    ]
    const gewerke = [mkGewerk('Maler', positions)]
    const { fn, calls } = mockAiComplete([])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(calls).toHaveLength(0)
    expect(result[0].positionen).toEqual(positions)
  })

  it('überspringt Katalog-Positionen mit echtem Preis (>0)', async () => {
    const katalog = mkPos({
      leistungsnummer: '09-100',
      aus_preisliste: true,
      vk_netto_einheit: 35.5,
    })
    const gewerke = [mkGewerk('Maler', [katalog])]
    const { fn, calls } = mockAiComplete([])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(calls).toHaveLength(0)
    expect(result[0].positionen[0].vk_netto_einheit).toBe(35.5)
  })

  it('überspringt Header mit Geviertstrich (XX–000)', async () => {
    const header = mkPos({
      leistungsnummer: '09–000', // U+2013
      aus_preisliste: false,
    })
    const gewerke = [mkGewerk('Maler', [header])]
    const { fn, calls } = mockAiComplete([])

    await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(calls).toHaveLength(0)
  })
})

// ──── 3. onProgress ────────────────────────────────────────────────────────

describe('recalcNewPositions – onProgress', () => {
  it('ruft onProgress mit korrektem current/total in Reihenfolge auf', async () => {
    const a = mkPos({
      leistungsnummer: '09-NEU1',
      leistungsname: 'A',
      aus_preisliste: false,
    })
    const b = mkPos({
      leistungsnummer: '09-NEU2',
      leistungsname: 'B',
      aus_preisliste: false,
    })
    const c = mkPos({
      leistungsnummer: '09-NEU3',
      leistungsname: 'C',
      aus_preisliste: false,
    })
    const gewerke = [mkGewerk('Maler', [a, b, c])]
    const { fn } = mockAiComplete([
      { vk_netto_einheit: 1 },
      { vk_netto_einheit: 2 },
      { vk_netto_einheit: 3 },
    ])
    const onProgress = vi.fn()

    await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      current: 1,
      total: 3,
      positionName: 'A',
    })
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      current: 2,
      total: 3,
      positionName: 'B',
    })
    expect(onProgress).toHaveBeenNthCalledWith(3, {
      current: 3,
      total: 3,
      positionName: 'C',
    })
  })

  it('ruft onProgress nicht auf, wenn es keine Kandidaten gibt', async () => {
    const pos = mkPos({
      leistungsnummer: '09-100',
      aus_preisliste: true,
      vk_netto_einheit: 50,
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn } = mockAiComplete([])
    const onProgress = vi.fn()

    await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
      onProgress,
    })

    expect(onProgress).not.toHaveBeenCalled()
  })
})

// ──── 4. Fehlerbehandlung ──────────────────────────────────────────────────

describe('recalcNewPositions – Fehlerbehandlung', () => {
  it('lässt Position unverändert, wenn aiComplete fehlschlägt', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pos = mkPos({
      leistungsnummer: '09-NEU1',
      aus_preisliste: false,
      vk_netto_einheit: 99,
      gesamtpreis: 990,
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn } = mockAiComplete([new Error('Backend kaputt')])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    const updated = result[0].positionen[0]
    expect(updated.vk_netto_einheit).toBe(99)
    expect(updated.gesamtpreis).toBe(990)
    expect(updated._modus1_recalc).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('lässt Position unverändert, wenn JSON-Parse fehlschlägt', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pos = mkPos({
      leistungsnummer: '09-NEU1',
      aus_preisliste: false,
      vk_netto_einheit: 50,
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    // String, der kein gültiges JSON liefert
    const { fn } = mockAiComplete(['das ist kein JSON haha'])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(result[0].positionen[0].vk_netto_einheit).toBe(50)
    expect(result[0].positionen[0]._modus1_recalc).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('läuft nach einem Einzel-Fehler mit der nächsten Position weiter', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = mkPos({
      leistungsnummer: '09-NEU1',
      leistungsname: 'A',
      aus_preisliste: false,
      vk_netto_einheit: 10,
    })
    const b = mkPos({
      leistungsnummer: '09-NEU2',
      leistungsname: 'B',
      aus_preisliste: false,
      vk_netto_einheit: 20,
    })
    const gewerke = [mkGewerk('Maler', [a, b])]
    const { fn } = mockAiComplete([
      new Error('A fehlgeschlagen'),
      { vk_netto_einheit: 99 },
    ])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(result[0].positionen[0].vk_netto_einheit).toBe(10) // unverändert
    expect(result[0].positionen[1].vk_netto_einheit).toBe(99) // neu
    expect(result[0].positionen[1]._modus1_recalc).toBe(true)
    warnSpy.mockRestore()
  })
})

// ──── 5. Texte: Modus-2 hat Vorrang ────────────────────────────────────────

describe('recalcNewPositions – Modus-2-Texte bleiben erhalten', () => {
  it('behält bestehende leistungsname/beschreibung, wenn vorhanden', async () => {
    const pos = mkPos({
      leistungsname: 'Modus-2 Text mit Raumbezug',
      beschreibung: 'Wohnzimmer 25 m² spachteln',
      aus_preisliste: false,
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn } = mockAiComplete([
      {
        vk_netto_einheit: 30,
        leistungsname: 'Modus-1 Generischer Text',
        beschreibung: 'Generische Beschreibung',
      },
    ])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    const updated = result[0].positionen[0]
    expect(updated.leistungsname).toBe('Modus-2 Text mit Raumbezug')
    expect(updated.beschreibung).toBe('Wohnzimmer 25 m² spachteln')
    expect(updated.vk_netto_einheit).toBe(30)
  })

  it('übernimmt Modus-1-Texte als Fallback bei leeren Modus-2-Texten', async () => {
    const pos = mkPos({
      leistungsname: '',
      beschreibung: '',
      aus_preisliste: false,
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn } = mockAiComplete([
      {
        vk_netto_einheit: 30,
        leistungsname: 'Modus-1 Text',
        beschreibung: 'Modus-1 Beschreibung',
      },
    ])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(result[0].positionen[0].leistungsname).toBe('Modus-1 Text')
    expect(result[0].positionen[0].beschreibung).toBe('Modus-1 Beschreibung')
  })

  it('strippt HTML-Tags (z. B. <cite>) aus Modus-1-Texten', async () => {
    const pos = mkPos({
      leistungsname: '',
      beschreibung: '',
      aus_preisliste: false,
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn } = mockAiComplete([
      {
        leistungsname: 'Saubere <cite>Quelle</cite> Anstrich',
        beschreibung: 'Mit <a href="x">Link</a> Verweis',
      },
    ])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(result[0].positionen[0].leistungsname).toBe('Saubere Quelle Anstrich')
    expect(result[0].positionen[0].beschreibung).toBe('Mit Link Verweis')
  })
})

// ──── 6. Edge-Cases ───────────────────────────────────────────────────────

describe('recalcNewPositions – Edge-Cases', () => {
  it('liefert Input zurück, wenn keine Gewerke vorhanden', async () => {
    const { fn, calls } = mockAiComplete([])
    const result = await recalcNewPositions([], {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })
    expect(result).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('liefert Gewerke unverändert zurück, wenn keine Kandidaten existieren', async () => {
    const pos = mkPos({
      leistungsnummer: '09-100',
      aus_preisliste: true,
      vk_netto_einheit: 50,
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn, calls } = mockAiComplete([])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(calls).toHaveLength(0)
    // identity preserved (no candidates → early return)
    expect(result).toBe(gewerke)
  })

  it('ignoriert Array-Antworten von der KI (Modus-1 erwartet Objekt)', async () => {
    const pos = mkPos({
      aus_preisliste: false,
      vk_netto_einheit: 11,
    })
    const gewerke = [mkGewerk('Maler', [pos])]
    const { fn } = mockAiComplete([
      [{ vk_netto_einheit: 999 }] as unknown as Record<string, unknown>,
    ])

    const result = await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(result[0].positionen[0].vk_netto_einheit).toBe(11)
    expect(result[0].positionen[0]._modus1_recalc).toBeUndefined()
  })

  it('wirft, wenn opts.aiComplete fehlt', async () => {
    const gewerke = [mkGewerk('Maler', [mkPos({ aus_preisliste: false })])]
    await expect(
      // @ts-expect-error – Test: missing aiComplete
      recalcNewPositions(gewerke, { modus1Prompt: 'SYS' }),
    ).rejects.toThrow(/aiComplete/)
  })

  it('wirft, wenn opts.modus1Prompt fehlt oder leer ist', async () => {
    const gewerke = [mkGewerk('Maler', [mkPos({ aus_preisliste: false })])]
    const { fn } = mockAiComplete([])
    await expect(
      recalcNewPositions(gewerke, { modus1Prompt: '', aiComplete: fn }),
    ).rejects.toThrow(/modus1Prompt/)
  })

  it('mutiert das Input-Array nicht (Immutability)', async () => {
    const pos = mkPos({ aus_preisliste: false, vk_netto_einheit: 5 })
    const gewerke = [mkGewerk('Maler', [pos])]
    const snapshot = JSON.parse(JSON.stringify(gewerke))
    const { fn } = mockAiComplete([{ vk_netto_einheit: 77 }])

    await recalcNewPositions(gewerke, {
      modus1Prompt: 'SYS',
      aiComplete: fn,
    })

    expect(gewerke).toEqual(snapshot)
    // Original-Position blieb 5 €
    expect(pos.vk_netto_einheit).toBe(5)
  })
})
