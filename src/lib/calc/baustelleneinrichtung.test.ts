// ────────────────────────────────────────────────────────────────────────────
//  baustelleneinrichtung.test.ts – Tests für Staffel-Parsing und
//  Baustelleneinrichtungs-Pauschalen.
//  Quelle: bau4you-app/src/lib/claude.js Z. 828-1484
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import {
  applyBaustelleneinrichtung,
  applyStaffel,
  buildFormulaPosition,
  isFormulaEntry,
  parseStaffelPreis,
  pickStaffel,
  recalcBaustelleneinrichtung,
} from './baustelleneinrichtung'
import type {
  Catalog,
  CatalogPosition,
  Gewerk,
  Position,
  StundensaetzeMap,
} from './types'

// ─────────────────────────────── Helpers ──────────────────────────────────

const pos = (overrides: Partial<Position>): Position => ({
  leistungsnummer: '09-001',
  leistungsname: 'Pos',
  beschreibung: '',
  einheit: 'm²',
  menge: 1,
  vk_netto_einheit: 10,
  gesamtpreis: 10,
  ...overrides,
})

const cat = (overrides: Partial<CatalogPosition>): CatalogPosition => ({
  leistungsnummer: '01-099',
  leistungsname: 'Formel-Pos',
  beschreibung: '',
  einheit: 'pauschal',
  vk_netto_einheit: 0,
  lohnkosten_einheit: 0,
  materialkosten_einheit: 0,
  lohnkosten_minuten: 0,
  stundensatz: 0,
  ...overrides,
})

const makeCatalog = (entries: CatalogPosition[]): Catalog => ({
  positionen: entries,
})

const makeGewerk = (name: string, positionen: Position[]): Gewerk => ({
  name,
  positionen,
})

const stundensaetze: StundensaetzeMap = {
  Maler: 75,
  Gemeinkosten: 70,
  Abbruch: 65,
}

// ─── parseStaffelPreis Tests ──────────────────────────────────────────────

describe('parseStaffelPreis', () => {
  it('parst "ab 0 € = 5 %" als unbounded Prozent-Staffel', () => {
    const staffeln = parseStaffelPreis('Berechnung: ab 0 € = 5 %')
    expect(staffeln).toHaveLength(1)
    expect(staffeln[0]).toMatchObject({
      from: 0,
      to: Number.POSITIVE_INFINITY,
      percent: 5,
      isPercent: true,
    })
    expect(staffeln[0].minBetrag).toBeUndefined()
  })

  it('parst "von 1000 € bis 5000 € = 4 %" als gebundene Prozent-Staffel', () => {
    const staffeln = parseStaffelPreis('Berechnung: von 1000 € bis 5000 € = 4 %')
    expect(staffeln).toHaveLength(1)
    expect(staffeln[0]).toMatchObject({
      from: 1000,
      to: 5000,
      percent: 4,
      isPercent: true,
    })
  })

  it('sortiert mehrere Staffeln aufsteigend nach `from`', () => {
    // bewusst in falscher Reihenfolge geliefert
    const text =
      'Berechnung: ab 5000 € = 3 %; von 1000 € bis 5000 € = 4 %; von 0 € bis 999 € = 200 €'
    const staffeln = parseStaffelPreis(text)
    expect(staffeln).toHaveLength(3)
    expect(staffeln[0].from).toBe(0)
    expect(staffeln[1].from).toBe(1000)
    expect(staffeln[2].from).toBe(5000)
    // Fixpreis-Erkennung
    expect(staffeln[0].isPercent).toBe(false)
    expect(staffeln[0].percent).toBe(200)
    // Prozent-Staffeln korrekt erkannt
    expect(staffeln[1].isPercent).toBe(true)
    expect(staffeln[2].isPercent).toBe(true)
  })

  it('liest "(mind. 200)" als minBetrag aus', () => {
    const staffeln = parseStaffelPreis('Berechnung: ab 0 € = 5 % (mind. 200)')
    expect(staffeln).toHaveLength(1)
    expect(staffeln[0].minBetrag).toBe(200)
    expect(staffeln[0].isPercent).toBe(true)
  })

  it('parst deutsches Zahlenformat (1.000,50 → 1000.5) korrekt', () => {
    const staffeln = parseStaffelPreis(
      'Berechnung: von 1.000 € bis 9.999 € = 1,2 % vom Umsatz (mind. 285)',
    )
    expect(staffeln).toHaveLength(1)
    expect(staffeln[0].from).toBe(1000)
    expect(staffeln[0].to).toBe(9999)
    expect(staffeln[0].percent).toBeCloseTo(1.2, 4)
    expect(staffeln[0].minBetrag).toBe(285)
  })

  it('liefert leeres Array bei leerem Text oder fehlendem "Berechnung:"-Anker mit leerem Body', () => {
    expect(parseStaffelPreis(undefined)).toEqual([])
    expect(parseStaffelPreis('')).toEqual([])
    // Text ohne Berechnung: → wird als Body verwendet, aber enthält keine Staffeln
    expect(parseStaffelPreis('Normale Beschreibung ohne Staffeln')).toEqual([])
  })
})

// ─── pickStaffel / applyStaffel Tests ─────────────────────────────────────

describe('pickStaffel / applyStaffel', () => {
  it('pickStaffel wählt erste passende Staffel', () => {
    const staffeln = parseStaffelPreis(
      'Berechnung: von 0 € bis 999 € = 200 €; von 1000 € bis 4999 € = 4 %; ab 5000 € = 3 %',
    )
    expect(pickStaffel(staffeln, 500)?.percent).toBe(200)
    expect(pickStaffel(staffeln, 2000)?.percent).toBe(4)
    expect(pickStaffel(staffeln, 10000)?.percent).toBe(3)
  })

  it('applyStaffel rundet auf 2 Dezimalen und respektiert minBetrag', () => {
    const [staffel] = parseStaffelPreis('Berechnung: ab 0 € = 5 % (mind. 200)')
    // 1000 × 5 % = 50 → minBetrag (200) zieht
    expect(applyStaffel(staffel, 1000)).toBe(200)
    // 10000 × 5 % = 500 → über minBetrag
    expect(applyStaffel(staffel, 10000)).toBe(500)
  })
})

// ─── isFormulaEntry Tests ─────────────────────────────────────────────────

describe('isFormulaEntry', () => {
  it('vk=0 + "Berechnung:..." → true', () => {
    expect(
      isFormulaEntry(
        cat({ vk_netto_einheit: 0, beschreibung: 'Berechnung: ab 0 € = 5 %' }),
      ),
    ).toBe(true)
  })

  it('vk=0 + normale Beschreibung → false', () => {
    expect(
      isFormulaEntry(
        cat({ vk_netto_einheit: 0, beschreibung: 'Normale Beschreibung' }),
      ),
    ).toBe(false)
  })

  it('vk gesetzt → false (kein Formel-Eintrag mehr)', () => {
    expect(
      isFormulaEntry(
        cat({ vk_netto_einheit: 50, beschreibung: 'Berechnung: ab 0 € = 5 %' }),
      ),
    ).toBe(false)
  })

  it('null/undefined → false', () => {
    expect(isFormulaEntry(null)).toBe(false)
    expect(isFormulaEntry(undefined)).toBe(false)
  })
})

// ─── buildFormulaPosition Tests ───────────────────────────────────────────

describe('buildFormulaPosition', () => {
  it('baut Pauschal-Position aus Staffel + Stundensatz', () => {
    const entry = cat({
      leistungsnummer: '01-050',
      leistungsname: 'Generische Pauschale',
      beschreibung: 'Berechnung: ab 0 € = 5 %',
      einheit: 'pauschal',
      lohnkosten_minuten: 60, // 1h
    })

    const result = buildFormulaPosition(
      pos({ leistungsnummer: '01-050', leistungsname: 'X', menge: 5 }),
      entry,
      10000,
      stundensaetze,
      'Gemeinkosten',
    )

    expect(result.vk_netto_einheit).toBe(500) // 10000 × 5 %
    expect(result.gesamtpreis).toBe(500)
    expect(result.menge).toBe(1)
    expect(result.einheit).toBe('pauschal')
    expect(result.leistungsname).toBe('Generische Pauschale')
    expect(result.aus_preisliste).toBe(true)
    // Lohn = 1h × 70 = 70, Material = 500 - 70 = 430
    expect(result.lohnkosten_einheit).toBe(70)
    expect(result.materialkosten_einheit).toBe(430)
  })
})

// ─── recalcBaustelleneinrichtung Tests ───────────────────────────────────

describe('recalcBaustelleneinrichtung', () => {
  // Katalog-Einträge analog bau4you (vereinfachte Staffel-Beschreibung).
  const cat001 = cat({
    leistungsnummer: '01-001',
    leistungsname: 'Baustelleneinrichtung (groß)',
    beschreibung:
      'Großbaustelleneinrichtung\nBerechnung: von 3000 € bis 9999 € = 300 €; von 10000 € bis 99999 € = 5 % vom Umsatz, mindestens 600 €',
    einheit: 'pauschal',
  })
  const cat002 = cat({
    leistungsnummer: '01-002',
    leistungsname: 'Baustelleneinrichtung (klein)',
    beschreibung:
      'Kleinbaustelleneinrichtung\nBerechnung: von 0 € bis 999 € = 100 €; von 1000 € bis 2999 € = 200 €',
    einheit: 'pauschal',
  })
  const catalog: Catalog = makeCatalog([cat001, cat002])

  it('totalNetto < 3000 € → 01-002 (Kleinbaustelle) wird verwendet', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Gemeinkosten', [
        pos({ leistungsnummer: '01-001', leistungsname: 'BE', gesamtpreis: 0 }),
      ]),
      makeGewerk('Maler', [
        pos({ leistungsnummer: '09-001', gesamtpreis: 2000, menge: 100, vk_netto_einheit: 20 }),
      ]),
    ]

    const result = recalcBaustelleneinrichtung(gewerke, catalog)
    const bePos = result[0].positionen[0]
    expect(bePos.leistungsnummer).toBe('01-002')
    expect(bePos.gesamtpreis).toBe(200) // 1000-2999 → 200 €
    expect(bePos.vk_netto_einheit).toBe(200)
    expect(bePos.menge).toBe(1)
    expect(bePos.einheit).toBe('pauschal')
    expect(bePos.lohnkosten_einheit).toBe(0)
    expect(bePos.materialkosten_einheit).toBe(0)
  })

  it('totalNetto >= 3000 € → 01-001 (Großbaustelle) wird verwendet', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Gemeinkosten', [
        pos({ leistungsnummer: '01-002', leistungsname: 'BE klein', gesamtpreis: 0 }),
      ]),
      makeGewerk('Maler', [
        pos({ leistungsnummer: '09-001', gesamtpreis: 5000, menge: 100, vk_netto_einheit: 50 }),
      ]),
    ]

    const result = recalcBaustelleneinrichtung(gewerke, catalog)
    const bePos = result[0].positionen[0]
    expect(bePos.leistungsnummer).toBe('01-001') // hochgestuft von 01-002
    expect(bePos.gesamtpreis).toBe(300) // 3000-9999 → 300 €
  })

  it('totalNetto = 20000 → 01-001 mit Prozent-Staffel (5 %, mind. 600)', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Gemeinkosten', [
        pos({ leistungsnummer: '01-001', gesamtpreis: 0 }),
      ]),
      makeGewerk('Maler', [
        pos({ leistungsnummer: '09-001', gesamtpreis: 20000, menge: 100, vk_netto_einheit: 200 }),
      ]),
    ]
    const result = recalcBaustelleneinrichtung(gewerke, catalog)
    const bePos = result[0].positionen[0]
    expect(bePos.leistungsnummer).toBe('01-001')
    expect(bePos.gesamtpreis).toBe(1000) // 20000 × 5 % = 1000 > mind. 600
  })

  it('keine 01-001/01-002 Position im Angebot → Gewerke unverändert', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({ leistungsnummer: '09-001', gesamtpreis: 5000 }),
      ]),
    ]
    const result = recalcBaustelleneinrichtung(gewerke, catalog)
    expect(result).toBe(gewerke) // gleiche Referenz – kein Recalc
  })

  it('leerer Katalog → Gewerke unverändert', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Gemeinkosten', [
        pos({ leistungsnummer: '01-001', gesamtpreis: 0 }),
      ]),
    ]
    expect(recalcBaustelleneinrichtung(gewerke, { positionen: [] })).toBe(gewerke)
    expect(recalcBaustelleneinrichtung(gewerke, null)).toBe(gewerke)
  })
})

// ─── applyBaustelleneinrichtung Tests ────────────────────────────────────

describe('applyBaustelleneinrichtung', () => {
  it('berechnet generische Formel-Position (NICHT 01-001/01-002)', () => {
    const formelEntry = cat({
      leistungsnummer: '01-050',
      leistungsname: 'Bauschuttentsorgung Pauschale',
      beschreibung: 'Berechnung: ab 0 € = 2 %',
      einheit: 'pauschal',
      lohnkosten_minuten: 0,
    })
    const catalog = makeCatalog([formelEntry])

    const gewerke: Gewerk[] = [
      makeGewerk('Gemeinkosten', [
        pos({ leistungsnummer: '01-050', leistungsname: 'X', gesamtpreis: 0 }),
      ]),
      makeGewerk('Maler', [
        pos({ leistungsnummer: '09-001', gesamtpreis: 10000, vk_netto_einheit: 100, menge: 100 }),
      ]),
    ]

    const result = applyBaustelleneinrichtung(gewerke, catalog, stundensaetze)
    const formelPos = result[0].positionen[0]
    expect(formelPos.leistungsnummer).toBe('01-050')
    expect(formelPos.gesamtpreis).toBe(200) // 10000 × 2 %
    expect(formelPos.einheit).toBe('pauschal')
    expect(formelPos.menge).toBe(1)
  })

  it('ignoriert 01-001/01-002 (delegiert an recalcBaustelleneinrichtung)', () => {
    const beEntry = cat({
      leistungsnummer: '01-001',
      beschreibung: 'Berechnung: ab 0 € = 10 %',
    })
    const catalog = makeCatalog([beEntry])

    const gewerke: Gewerk[] = [
      makeGewerk('Gemeinkosten', [
        pos({ leistungsnummer: '01-001', gesamtpreis: 0, vk_netto_einheit: 0 }),
      ]),
      makeGewerk('Maler', [
        pos({ leistungsnummer: '09-001', gesamtpreis: 5000 }),
      ]),
    ]
    const result = applyBaustelleneinrichtung(gewerke, catalog, stundensaetze)
    // 01-001 wird nicht berührt
    expect(result[0].positionen[0].gesamtpreis).toBe(0)
    expect(result[0].positionen[0].vk_netto_einheit).toBe(0)
  })
})

// ─── Immutability ─────────────────────────────────────────────────────────

describe('Immutability', () => {
  it('recalcBaustelleneinrichtung mutiert Input nicht', () => {
    const input: Gewerk[] = [
      {
        name: 'Gemeinkosten',
        positionen: [
          {
            leistungsnummer: '01-001',
            leistungsname: 'BE',
            menge: 1,
            einheit: 'pauschal',
            vk_netto_einheit: 0,
            gesamtpreis: 0,
          },
        ],
      },
      {
        name: 'Maler',
        positionen: [
          {
            leistungsnummer: '09-001',
            leistungsname: 'Wand',
            menge: 100,
            einheit: 'm²',
            vk_netto_einheit: 50,
            gesamtpreis: 5000,
          },
        ],
      },
    ]
    const catalog = makeCatalog([
      cat({
        leistungsnummer: '01-001',
        beschreibung: 'Berechnung: von 3000 € bis 9999 € = 350 €',
      }),
    ])

    // Deep-freeze
    Object.freeze(input)
    input.forEach((g) => {
      Object.freeze(g)
      Object.freeze(g.positionen)
      g.positionen.forEach((p) => Object.freeze(p))
    })
    Object.freeze(catalog)
    Object.freeze(catalog.positionen)
    catalog.positionen.forEach((p) => Object.freeze(p))

    expect(() => recalcBaustelleneinrichtung(input, catalog)).not.toThrow()

    const result = recalcBaustelleneinrichtung(input, catalog)
    // Input darf nicht verändert worden sein
    expect(input[0].positionen[0].leistungsnummer).toBe('01-001')
    expect(input[0].positionen[0].gesamtpreis).toBe(0)
    // Output enthält neue Werte
    expect(result[0].positionen[0].gesamtpreis).toBe(350)
  })

  it('applyBaustelleneinrichtung mutiert Input nicht', () => {
    const input: Gewerk[] = [
      {
        name: 'Gemeinkosten',
        positionen: [
          {
            leistungsnummer: '01-050',
            leistungsname: 'Formel',
            menge: 1,
            einheit: 'pauschal',
            vk_netto_einheit: 0,
            gesamtpreis: 0,
          },
        ],
      },
    ]
    const catalog = makeCatalog([
      cat({
        leistungsnummer: '01-050',
        beschreibung: 'Berechnung: ab 0 € = 5 %',
      }),
    ])

    Object.freeze(input)
    input.forEach((g) => {
      Object.freeze(g)
      Object.freeze(g.positionen)
      g.positionen.forEach((p) => Object.freeze(p))
    })

    expect(() => applyBaustelleneinrichtung(input, catalog, stundensaetze)).not.toThrow()
    // Input bleibt 0
    expect(input[0].positionen[0].gesamtpreis).toBe(0)
  })
})
