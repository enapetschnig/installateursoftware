// ────────────────────────────────────────────────────────────────────────────
//  fixNullpreise.test.ts – Cent-Identitäts-Tests gegen bau4you-Verhalten
//  Quelle: bau4you-app/src/lib/claude.js Z. 2073-2178
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import { fixNullpreise } from './fixNullpreise'
import type {
  Catalog,
  CatalogPosition,
  Gewerk,
  Position,
  StundensaetzeMap,
} from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────

const pos = (overrides: Partial<Position>): Position => ({
  leistungsnummer: '09-100',
  leistungsname: 'Wand spachteln',
  einheit: 'm²',
  menge: 10,
  vk_netto_einheit: 0,
  gesamtpreis: 0,
  materialkosten_einheit: 0,
  ...overrides,
})

const makeGewerk = (name: string, positionen: Position[]): Gewerk => ({
  name,
  positionen,
})

const makeCatalog = (entries: CatalogPosition[]): Catalog => ({
  positionen: entries,
})

const emptyCatalog: Catalog = makeCatalog([])

const stundensaetze: StundensaetzeMap = {
  Maler: 70,
  Reinigung: 65,
  Abbruch: 70,
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('fixNullpreise', () => {
  it('Test 1: Standard-Pos vk=0 + minuten=15 + stundensatz=70 → lohn=17.50', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-100',
          einheit: 'm²',
          menge: 10,
          vk_netto_einheit: 0,
          lohnkosten_minuten: 15,
          materialkosten_einheit: 2.5,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    const p = result[0].positionen[0]
    // lohn = (15/60) * 70 = 17.50
    expect(p.lohnkosten_einheit).toBe(17.5)
    // vk = lohn + material = 17.50 + 2.50 = 20.00
    expect(p.vk_netto_einheit).toBe(20)
    // gesamtpreis = 10 * 20 = 200
    expect(p.gesamtpreis).toBe(200)
    expect(p.stundensatz).toBe(70)
    expect(p.lohnkosten_minuten).toBe(15)
  })

  it('Test 2: Pauschal vk=0 + stundensatz=70 → mind. 140 € (2h)', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-200',
          einheit: 'pauschal',
          menge: 1,
          vk_netto_einheit: 0,
          lohnkosten_einheit: 0,
          materialkosten_einheit: 0,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    const p = result[0].positionen[0]
    // Lohn = max(2 * 70, 0) = 140
    expect(p.lohnkosten_einheit).toBe(140)
    expect(p.vk_netto_einheit).toBe(140)
    expect(p.gesamtpreis).toBe(140)
  })

  it('Test 2b: Pauschal vk=0 mit bestehendem Lohn > 2h → bestehender Lohn gewinnt', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-200',
          einheit: 'pauschal',
          menge: 1,
          vk_netto_einheit: 0,
          lohnkosten_einheit: 200, // > 140 (= 2h × 70)
          materialkosten_einheit: 30,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    const p = result[0].positionen[0]
    // Lohn bleibt 200 (max(140, 200))
    expect(p.lohnkosten_einheit).toBe(200)
    // VK = 200 + 30 = 230
    expect(p.vk_netto_einheit).toBe(230)
  })

  it('Test 3: 13-100 vk=0 + menge=50 → vk=10.40, gesamt=520', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Reinigung', [
        pos({
          leistungsnummer: '13-100',
          leistungsname: 'Feinreinigung',
          einheit: 'm²',
          menge: 50,
          vk_netto_einheit: 0,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    const p = result[0].positionen[0]
    expect(p.vk_netto_einheit).toBe(10.4)
    expect(p.gesamtpreis).toBe(520)
  })

  it('Test 4: 13-001 vk=0 + Katalog leer → vk=6.50', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Reinigung', [
        pos({
          leistungsnummer: '13-001',
          leistungsname: 'Grobreinigung',
          einheit: 'm²',
          menge: 100,
          vk_netto_einheit: 0,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    const p = result[0].positionen[0]
    expect(p.vk_netto_einheit).toBe(6.5)
    expect(p.gesamtpreis).toBe(650)
  })

  it('Test 4b: 13-100 mit Katalog-Preis → Katalog gewinnt vor Fallback', () => {
    const catalog = makeCatalog([
      {
        leistungsnummer: '13-100',
        leistungsname: 'Feinreinigung',
        einheit: 'm²',
        vk_netto_einheit: 12.5,
      },
    ])
    const gewerke: Gewerk[] = [
      makeGewerk('Reinigung', [
        pos({
          leistungsnummer: '13-100',
          einheit: 'm²',
          menge: 20,
          vk_netto_einheit: 0,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, catalog, stundensaetze)
    const p = result[0].positionen[0]
    expect(p.vk_netto_einheit).toBe(12.5)
    expect(p.gesamtpreis).toBe(250)
  })

  it('Test 5: Pos mit vk>0 → unverändert', () => {
    const original = pos({
      leistungsnummer: '09-100',
      einheit: 'm²',
      menge: 10,
      vk_netto_einheit: 25,
      gesamtpreis: 250,
      lohnkosten_minuten: 20,
    })
    const gewerke: Gewerk[] = [makeGewerk('Maler', [original])]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    const p = result[0].positionen[0]
    expect(p.vk_netto_einheit).toBe(25)
    expect(p.gesamtpreis).toBe(250)
    expect(p.lohnkosten_minuten).toBe(20)
    // Identische Felder (kein Recalc)
    expect(p).toEqual(original)
  })

  it('Test 6: NEU-Pos (09-NEU) mit vk=0 → unverändert', () => {
    const original = pos({
      leistungsnummer: '09-NEU',
      leistungsname: 'Spezialtechnik',
      einheit: 'm²',
      menge: 10,
      vk_netto_einheit: 0,
      lohnkosten_minuten: 30, // sollte trotzdem nicht repariert werden
    })
    const gewerke: Gewerk[] = [makeGewerk('Maler', [original])]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    expect(result[0].positionen[0]).toEqual(original)
  })

  it('Test 6b: NEU1-Pos (09-NEU1) mit vk=0 → unverändert', () => {
    const original = pos({
      leistungsnummer: '09-NEU1',
      einheit: 'm²',
      vk_netto_einheit: 0,
      lohnkosten_minuten: 15,
    })
    const gewerke: Gewerk[] = [makeGewerk('Maler', [original])]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    expect(result[0].positionen[0]).toEqual(original)
  })

  it('Test 7: Standard-Pos ohne minuten → unverändert', () => {
    const original = pos({
      leistungsnummer: '09-100',
      einheit: 'm²',
      menge: 10,
      vk_netto_einheit: 0,
      lohnkosten_minuten: 0, // keine Minuten
      materialkosten_einheit: 5,
    })
    const gewerke: Gewerk[] = [makeGewerk('Maler', [original])]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    // Unverändert (kein vk gesetzt)
    expect(result[0].positionen[0]).toEqual(original)
  })

  it('Test 8: Input nicht mutiert (Object.freeze)', () => {
    const p1 = Object.freeze(
      pos({
        leistungsnummer: '09-100',
        einheit: 'm²',
        menge: 10,
        vk_netto_einheit: 0,
        lohnkosten_minuten: 15,
        materialkosten_einheit: 2.5,
      }),
    )
    const positionenFrozen = Object.freeze([p1]) as readonly Position[]
    const gewerkFrozen = Object.freeze({
      name: 'Maler',
      positionen: positionenFrozen as Position[],
    }) as Gewerk
    const gewerkeFrozen = Object.freeze([gewerkFrozen]) as readonly Gewerk[]

    // Sollte nicht werfen (kein In-place-Write)
    expect(() =>
      fixNullpreise(gewerkeFrozen as Gewerk[], emptyCatalog, stundensaetze),
    ).not.toThrow()

    // Original-Werte unverändert
    expect(p1.vk_netto_einheit).toBe(0)
    expect(p1.lohnkosten_einheit).toBeUndefined()
    expect(p1.gesamtpreis).toBe(0)
  })

  it('Test 9: Header-Position (XX-000) → unverändert', () => {
    const original = pos({
      leistungsnummer: '09-000',
      leistungsname: 'Header Maler',
      einheit: 'm²',
      menge: 0,
      vk_netto_einheit: 0,
      lohnkosten_minuten: 100,
    })
    const gewerke: Gewerk[] = [makeGewerk('Maler', [original])]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    expect(result[0].positionen[0]).toEqual(original)
  })

  it('Test 10: Gemeinkosten 01-001 und 01-002 → unverändert', () => {
    const orig1 = pos({
      leistungsnummer: '01-001',
      leistungsname: 'Anfahrt',
      einheit: 'pauschal',
      vk_netto_einheit: 0,
    })
    const orig2 = pos({
      leistungsnummer: '01-002',
      leistungsname: 'Baustelleneinrichtung',
      einheit: 'pauschal',
      vk_netto_einheit: 0,
    })
    const gewerke: Gewerk[] = [makeGewerk('Gemeinkosten', [orig1, orig2])]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    expect(result[0].positionen[0]).toEqual(orig1)
    expect(result[0].positionen[1]).toEqual(orig2)
  })

  it('Test 11: Stundensatz aus Regiestunden-Katalog gewinnt vor stundensaetze-Map', () => {
    const catalog = makeCatalog([
      {
        // 09-997 = Regiestunden Maler, Spezialbereich 990-999
        leistungsnummer: '09-997',
        leistungsname: 'Regiestunde Maler',
        einheit: 'Std',
        vk_netto_einheit: 85, // Katalog-Stundensatz
      },
    ])
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-100',
          einheit: 'm²',
          menge: 10,
          vk_netto_einheit: 0,
          lohnkosten_minuten: 60, // 1 h
          materialkosten_einheit: 0,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, catalog, stundensaetze)
    const p = result[0].positionen[0]
    // 1h × 85 = 85 (Katalog gewinnt, nicht 70 aus Map)
    expect(p.stundensatz).toBe(85)
    expect(p.lohnkosten_einheit).toBe(85)
    expect(p.vk_netto_einheit).toBe(85)
    expect(p.gesamtpreis).toBe(850)
  })

  it('Test 12: Fallback Stundensatz 70 wenn weder Katalog noch Map einen liefert', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('UnbekanntesGewerk', [
        pos({
          leistungsnummer: '09-100',
          einheit: 'm²',
          menge: 1,
          vk_netto_einheit: 0,
          lohnkosten_minuten: 60,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, emptyCatalog, {})
    const p = result[0].positionen[0]
    expect(p.stundensatz).toBe(70)
    expect(p.lohnkosten_einheit).toBe(70)
  })

  it('Test 13: Leere Eingabe → leeres Array', () => {
    expect(fixNullpreise([], emptyCatalog, stundensaetze)).toEqual([])
    expect(fixNullpreise(null, emptyCatalog, stundensaetze)).toEqual([])
    expect(fixNullpreise(undefined, emptyCatalog, stundensaetze)).toEqual([])
  })

  it('Test 14: Reinigung pauschal (13-xxx, einheit=pauschal) → mind. 1 Stunde', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Reinigung', [
        pos({
          leistungsnummer: '13-500',
          leistungsname: 'Baustellenreinigung',
          einheit: 'pauschal',
          menge: 1,
          vk_netto_einheit: 0,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    const p = result[0].positionen[0]
    // Reinigung-Stundensatz aus Map = 65, mind. 1h = 60 min → 65 €
    expect(p.vk_netto_einheit).toBe(65)
    expect(p.lohnkosten_minuten).toBe(60)
  })

  it('Test 15: Fraktionale Minuten (z.B. 3.22) bleiben mit 2 Dezimalen erhalten', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-100',
          einheit: 'm²',
          menge: 100,
          vk_netto_einheit: 0,
          lohnkosten_minuten: 3.22,
          materialkosten_einheit: 0,
        }),
      ]),
    ]
    const result = fixNullpreise(gewerke, emptyCatalog, stundensaetze)
    const p = result[0].positionen[0]
    expect(p.lohnkosten_minuten).toBe(3.22)
    // lohn = (3.22/60) * 70 = 3.7566... → round2 = 3.76
    expect(p.lohnkosten_einheit).toBe(3.76)
    expect(p.vk_netto_einheit).toBe(3.76)
  })
})
