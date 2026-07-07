// ────────────────────────────────────────────────────────────────────────────
//  regiePaerchen.test.ts – Tests gegen bau4you Z. 730-1258
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import {
  applyRegieMaterial,
  ensureRegieMaterial,
  findMaterialFuerRegieInCatalog,
} from './regiePaerchen'
import type { Catalog, CatalogPosition, Gewerk, Position } from './types'

// ─────────────────────────────── Helpers ──────────────────────────────────

const catEntry = (overrides: Partial<CatalogPosition>): CatalogPosition => ({
  leistungsnummer: '09-001',
  leistungsname: 'Wand spachteln',
  beschreibung: '',
  einheit: 'm²',
  vk_netto_einheit: 0,
  ...overrides,
})

const makeCatalog = (entries: CatalogPosition[]): Catalog => ({
  positionen: entries,
})

const regiePos = (overrides: Partial<Position> = {}): Position => ({
  leistungsnummer: '09-998',
  leistungsname: 'Regiestunden Maler',
  beschreibung: '',
  einheit: 'Std',
  menge: 10,
  vk_netto_einheit: 20,
  gesamtpreis: 200,
  aus_preisliste: true,
  ...overrides,
})

const matRegiePos = (overrides: Partial<Position> = {}): Position => ({
  leistungsnummer: '09-999',
  leistungsname: 'Material für Regiestunden',
  beschreibung: '',
  einheit: 'pauschal',
  menge: 1,
  vk_netto_einheit: 0,
  gesamtpreis: 0,
  aus_preisliste: true,
  ...overrides,
})

const makeGewerk = (name: string, positionen: Position[]): Gewerk => ({
  name,
  positionen,
})

// ─── findMaterialFuerRegieInCatalog ───────────────────────────────────────

describe('findMaterialFuerRegieInCatalog', () => {
  it('findet "09-998 Material für Regie Maler" bei Prefix 09', () => {
    const catalog = makeCatalog([
      catEntry({ leistungsnummer: '09-001', leistungsname: 'Wand' }),
      catEntry({
        leistungsnummer: '09-998',
        leistungsname: 'Material für Regie Maler 10%',
        einheit: 'pauschal',
      }),
    ])
    const hit = findMaterialFuerRegieInCatalog(catalog, '09')
    expect(hit?.leistungsnummer).toBe('09-998')
  })

  it('liefert null bei Prefix "02", wenn nur 09er-Einträge existieren', () => {
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-998',
        leistungsname: 'Material für Regie Maler 10%',
        einheit: 'pauschal',
      }),
    ])
    expect(findMaterialFuerRegieInCatalog(catalog, '02')).toBeNull()
  })

  it('ignoriert Einträge ausserhalb 990-999 Bereich', () => {
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-500',
        leistungsname: 'Material für Regie Maler',
      }),
    ])
    expect(findMaterialFuerRegieInCatalog(catalog, '09')).toBeNull()
  })

  it('findet Treffer auch wenn nur die Beschreibung "Material + Regie" enthält', () => {
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-997',
        leistungsname: 'Sonstige Pauschale',
        beschreibung: 'Pauschale für Material zur Regiearbeit (10%)',
      }),
    ])
    const hit = findMaterialFuerRegieInCatalog(catalog, '09')
    expect(hit?.leistungsnummer).toBe('09-997')
  })
})

// ─── ensureRegieMaterial ──────────────────────────────────────────────────

describe('ensureRegieMaterial', () => {
  const catalog = makeCatalog([
    catEntry({
      leistungsnummer: '09-998',
      leistungsname: 'Material für Regie Maler 10%',
      einheit: 'pauschal',
      beschreibung: 'Pauschale 10 %',
    }),
  ])

  it('fügt Material-für-Regie ein, wenn nach Regie keine Material-Pos folgt', () => {
    const gewerke: Gewerk[] = [makeGewerk('Maler', [regiePos()])]
    const out = ensureRegieMaterial(gewerke, catalog)
    expect(out[0].positionen).toHaveLength(2)
    expect(out[0].positionen[1].leistungsnummer).toBe('09-998')
    expect(out[0].positionen[1].leistungsname).toBe('Material für Regie Maler 10%')
    expect(out[0].positionen[1].gesamtpreis).toBe(0)
  })

  it('lässt Gewerk unverändert, wenn Material-Pos bereits direkt nach Regie steht', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [regiePos(), matRegiePos()]),
    ]
    const out = ensureRegieMaterial(gewerke, catalog)
    expect(out).toBe(gewerke) // identity – nichts geändert
  })

  it('lässt Gewerk unverändert, wenn gar keine Regie-Pos existiert', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        {
          leistungsnummer: '09-001',
          leistungsname: 'Wand spachteln',
          einheit: 'm²',
          menge: 10,
          gesamtpreis: 125,
        },
      ]),
    ]
    const out = ensureRegieMaterial(gewerke, catalog)
    expect(out).toBe(gewerke)
  })

  it('mutiert den Input nicht', () => {
    const gewerke: Gewerk[] = [makeGewerk('Maler', [regiePos()])]
    const frozen = Object.freeze(gewerke[0].positionen)
    Object.freeze(gewerke[0])
    Object.freeze(gewerke)
    expect(() => ensureRegieMaterial(gewerke, catalog)).not.toThrow()
    expect(frozen).toHaveLength(1)
  })

  it('fügt nichts ein, wenn Katalog keine passende Material-Pos hat', () => {
    const leerCatalog = makeCatalog([])
    const gewerke: Gewerk[] = [makeGewerk('Maler', [regiePos()])]
    const out = ensureRegieMaterial(gewerke, leerCatalog)
    expect(out).toBe(gewerke)
  })
})

// ─── applyRegieMaterial ───────────────────────────────────────────────────

describe('applyRegieMaterial', () => {
  it('berechnet Material = Regie-Gesamt × Prozent aus Katalog ("10 %")', () => {
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-998',
        leistungsname: 'Material für Regie Maler 10%',
        einheit: 'pauschal',
        beschreibung: 'Pauschale 10 % der Regie',
      }),
    ])
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        regiePos({ gesamtpreis: 200 }),
        matRegiePos({ leistungsnummer: '09-998' }),
      ]),
    ]
    const out = applyRegieMaterial(gewerke, catalog)
    const mat = out[0].positionen[1]
    expect(mat.gesamtpreis).toBe(20)
    expect(mat.vk_netto_einheit).toBe(20)
    expect(mat.materialkosten_einheit).toBe(20)
    expect(mat.materialanteil_prozent).toBe(100)
    expect(mat.lohnanteil_prozent).toBe(0)
    // Zwischensumme prüfen (Summe aller gesamtpreis im Gewerk)
    const zwischensumme = out[0].positionen.reduce(
      (sum, p) => sum + (Number(p.gesamtpreis) || 0),
      0
    )
    expect(zwischensumme).toBe(220)
  })

  it('verwendet 10 % Default, wenn kein Prozentsatz im Katalog/Pos steht', () => {
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-998',
        leistungsname: 'Material für Regie',
        beschreibung: 'Pauschale Material',
      }),
    ])
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        regiePos({ gesamtpreis: 500 }),
        matRegiePos({
          leistungsnummer: '09-998',
          leistungsname: 'Material für Regie',
          beschreibung: '',
        }),
      ]),
    ]
    const out = applyRegieMaterial(gewerke, catalog)
    expect(out[0].positionen[1].gesamtpreis).toBe(50) // 500 × 10 %
  })

  it('respektiert non-default Prozentsatz aus Katalog ("30%")', () => {
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '02-998',
        leistungsname: 'Material für Regie Abbruch 30%',
      }),
    ])
    const gewerke: Gewerk[] = [
      makeGewerk('Abbruch', [
        regiePos({
          leistungsnummer: '02-997',
          leistungsname: 'Regiestunden Abbruch',
          gesamtpreis: 1000,
        }),
        matRegiePos({
          leistungsnummer: '02-998',
          leistungsname: 'Material für Regie Abbruch 30%',
        }),
      ]),
    ]
    const out = applyRegieMaterial(gewerke, catalog)
    expect(out[0].positionen[1].gesamtpreis).toBe(300)
  })

  it('lässt Material-Pos unverändert, wenn davor keine Regie-Pos steht', () => {
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-998',
        leistungsname: 'Material für Regie Maler 10%',
      }),
    ])
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [matRegiePos({ leistungsnummer: '09-998' })]),
    ]
    const out = applyRegieMaterial(gewerke, catalog)
    expect(out).toBe(gewerke)
  })

  it('mutiert den Input nicht', () => {
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-998',
        leistungsname: 'Material für Regie Maler 10%',
      }),
    ])
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        regiePos({ gesamtpreis: 200 }),
        matRegiePos({ leistungsnummer: '09-998' }),
      ]),
    ]
    // Deep-freeze
    Object.freeze(gewerke[0].positionen[0])
    Object.freeze(gewerke[0].positionen[1])
    Object.freeze(gewerke[0].positionen)
    Object.freeze(gewerke[0])
    Object.freeze(gewerke)
    expect(() => applyRegieMaterial(gewerke, catalog)).not.toThrow()
    // Original-Werte unverändert
    expect(gewerke[0].positionen[1].gesamtpreis).toBe(0)
    expect(gewerke[0].positionen[1].vk_netto_einheit).toBe(0)
  })
})
