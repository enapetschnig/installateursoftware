// ────────────────────────────────────────────────────────────────────────────
//  enrichFromCatalog.test.ts – Cent-Identitäts-Tests gegen bau4you-Verhalten
//  Quelle: bau4you-app/src/lib/claude.js Z. 670-1098
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import {
  einheitenKompatibel,
  enrichFromCatalog,
  hatSpezialTechnik,
  isMaterialFuerRegiePos,
  isRegiestundenPos,
} from './enrichFromCatalog'
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
  leistungsname: 'Wand spachteln',
  beschreibung: '',
  einheit: 'm²',
  menge: 10,
  vk_netto_einheit: 12.5,
  gesamtpreis: 125,
  ...overrides,
})

const catEntry = (overrides: Partial<CatalogPosition>): CatalogPosition => ({
  leistungsnummer: '09-001',
  leistungsname: 'Wand spachteln Q3',
  beschreibung: 'Wand spachteln in Qualitätsstufe Q3',
  einheit: 'm²',
  vk_netto_einheit: 18,
  lohnkosten_einheit: 12,
  materialkosten_einheit: 6,
  lohnkosten_minuten: 9.6,
  stundensatz: 75,
  ...overrides,
})

const makeGewerk = (name: string, positionen: Position[]): Gewerk => ({
  name,
  positionen,
})

const makeCatalog = (entries: CatalogPosition[]): Catalog => ({
  positionen: entries,
})

const stundensaetze: StundensaetzeMap = {
  Maler: 75,
  Abbruch: 65,
  Reinigung: 58,
}

// ─────────────────────── Helper-Function Tests ───────────────────────────

describe('isRegiestundenPos', () => {
  it('erkennt "Regiestunden Maler" + Einheit "Std" als Regie', () => {
    expect(
      isRegiestundenPos(
        pos({ leistungsname: 'Regiestunden Maler', einheit: 'Std' }),
      ),
    ).toBe(true)
  })

  it('weist "Wand spachteln" + Einheit "m²" als Nicht-Regie zurück', () => {
    expect(
      isRegiestundenPos(pos({ leistungsname: 'Wand spachteln', einheit: 'm²' })),
    ).toBe(false)
  })

  it('akzeptiert "Stunde"/"Stunden" als Einheit', () => {
    expect(
      isRegiestundenPos(
        pos({ leistungsname: 'Regie Geselle', einheit: 'Stunden' }),
      ),
    ).toBe(true)
    expect(
      isRegiestundenPos(pos({ leistungsname: 'Regie', einheit: 'Stunde' })),
    ).toBe(true)
  })

  it('ist case-insensitive', () => {
    expect(
      isRegiestundenPos(pos({ leistungsname: 'REGIESTUNDEN', einheit: 'STD' })),
    ).toBe(true)
  })
})

describe('isMaterialFuerRegiePos', () => {
  it('erkennt "Material für Regie" im Namen', () => {
    expect(
      isMaterialFuerRegiePos(
        pos({ leistungsname: 'Material für Regiestunden', beschreibung: '' }),
      ),
    ).toBe(true)
  })

  it('erkennt "Material" + "Regie" auch in der Beschreibung', () => {
    expect(
      isMaterialFuerRegiePos(
        pos({
          leistungsname: 'Sonderposition',
          beschreibung: 'Material für Regie-Arbeiten',
        }),
      ),
    ).toBe(true)
  })

  it('weist normale Positionen ohne diese Tokens zurück', () => {
    expect(
      isMaterialFuerRegiePos(
        pos({ leistungsname: 'Wand spachteln', beschreibung: 'Standard' }),
      ),
    ).toBe(false)
  })
})

describe('einheitenKompatibel', () => {
  it('"qm" ist kompatibel mit "m²"', () => {
    expect(einheitenKompatibel('qm', 'm²')).toBe(true)
  })

  it('"lfm" ist kompatibel mit "laufmeter"', () => {
    expect(einheitenKompatibel('lfm', 'laufmeter')).toBe(true)
  })

  it('"Stk" ist NICHT kompatibel mit "m²"', () => {
    expect(einheitenKompatibel('Stk', 'm²')).toBe(false)
  })

  it('identische Werte sind immer kompatibel', () => {
    expect(einheitenKompatibel('m²', 'm²')).toBe(true)
    expect(einheitenKompatibel('pauschal', 'pauschal')).toBe(true)
  })

  it('null/undefined → im Zweifel kompatibel', () => {
    expect(einheitenKompatibel(null, 'm²')).toBe(true)
    expect(einheitenKompatibel('m²', undefined)).toBe(true)
  })
})

describe('hatSpezialTechnik', () => {
  it('erkennt venezianische Spachteltechnik', () => {
    expect(hatSpezialTechnik('venezianische Spachteltechnik')).toBe(true)
  })

  it('erkennt Marmorino, Tadelakt, Sumpfkalk', () => {
    expect(hatSpezialTechnik('Marmorino edel')).toBe(true)
    expect(hatSpezialTechnik('Tadelakt-Putz')).toBe(true)
    expect(hatSpezialTechnik('Sumpfkalk-Anstrich')).toBe(true)
  })

  it('Standard-Tätigkeiten triggern nicht', () => {
    expect(hatSpezialTechnik('Wand streichen')).toBe(false)
    expect(hatSpezialTechnik('Wand spachteln')).toBe(false)
  })

  it('null/leer → false', () => {
    expect(hatSpezialTechnik(null)).toBe(false)
    expect(hatSpezialTechnik('')).toBe(false)
  })
})

// ─────────────────────── enrichFromCatalog Tests ─────────────────────────

describe('enrichFromCatalog – Normalfall', () => {
  it('übernimmt Katalog-Werte 1:1 für 09-001', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-001',
          leistungsname: 'Wand spachteln',
          einheit: 'm²',
          menge: 10,
          vk_netto_einheit: 12.5,
        }),
      ]),
    ]
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-001',
        leistungsname: 'Wand spachteln Q3',
        einheit: 'm²',
        vk_netto_einheit: 18,
        lohnkosten_einheit: 12,
        materialkosten_einheit: 6,
        lohnkosten_minuten: 9.6,
        stundensatz: 75,
      }),
    ])

    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    const p = out[0].positionen[0]

    expect(p.vk_netto_einheit).toBe(18)
    expect(p.lohnkosten_einheit).toBe(12)
    expect(p.materialkosten_einheit).toBe(6)
    expect(p.lohnkosten_minuten).toBe(9.6)
    expect(p.stundensatz).toBe(75)
    expect(p.leistungsname).toBe('Wand spachteln Q3')
    expect(p.gesamtpreis).toBe(180) // 10 × 18
    expect(p.materialanteil_prozent).toBeCloseTo(33.3, 1) // 6/18 = 33.3
    expect(p.lohnanteil_prozent).toBeCloseTo(66.7, 1)
    expect(p.aus_preisliste).toBe(true)
  })

  it('lohnkosten_minuten behält 2 Dezimalstellen (3.22 statt 3)', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [pos({ leistungsnummer: '09-002' })]),
    ]
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-002',
        lohnkosten_minuten: 3.22,
      }),
    ])
    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    expect(out[0].positionen[0].lohnkosten_minuten).toBe(3.22)
  })
})

describe('enrichFromCatalog – Spezial-Technik-Mismatch', () => {
  it('KI:"Marmorino", Katalog:"Wand spachteln" → aus_preisliste=false', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-001',
          leistungsname: 'Wand mit Marmorino spachteln',
          vk_netto_einheit: 95,
        }),
      ]),
    ]
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-001',
        leistungsname: 'Wand spachteln Q3',
        vk_netto_einheit: 18,
      }),
    ])

    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    const p = out[0].positionen[0]

    expect(p.aus_preisliste).toBe(false)
    // KI-Preis bleibt; wird durch Modus-1 später nachkalkuliert
    expect(p.vk_netto_einheit).toBe(95)
    // Spezial-Technik im Namen → KI-Name bleibt
    expect(p.leistungsname).toBe('Wand mit Marmorino spachteln')
  })
})

describe('enrichFromCatalog – Einheit-Mismatch', () => {
  it('KI:"m²" vs. Katalog:"Stk" → aus_preisliste=false', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-100',
          einheit: 'm²',
          vk_netto_einheit: 50,
        }),
      ]),
    ]
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-100',
        einheit: 'Stk',
        vk_netto_einheit: 200,
      }),
    ])

    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    const p = out[0].positionen[0]

    expect(p.aus_preisliste).toBe(false)
    // KI-Werte bleiben (kein Katalog-Override)
    expect(p.einheit).toBe('m²')
    expect(p.vk_netto_einheit).toBe(50)
  })
})

describe('enrichFromCatalog – NEU-Nummern', () => {
  it('09-NEU bleibt unverändert (kein Lookup, kein aus_preisliste-Flag-Set)', () => {
    const original = pos({
      leistungsnummer: '09-NEU',
      leistungsname: 'KI-Spezial-Pos',
      vk_netto_einheit: 42,
      aus_preisliste: false,
    })
    const gewerke: Gewerk[] = [makeGewerk('Maler', [original])]
    const catalog = makeCatalog([catEntry({ leistungsnummer: '09-001' })])

    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    const p = out[0].positionen[0]

    expect(p.leistungsnummer).toBe('09-NEU')
    expect(p.leistungsname).toBe('KI-Spezial-Pos')
    expect(p.vk_netto_einheit).toBe(42)
    expect(p.aus_preisliste).toBe(false)
  })

  it('09-NEU1 bleibt unverändert', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({ leistungsnummer: '09-NEU1', vk_netto_einheit: 99 }),
      ]),
    ]
    const catalog = makeCatalog([catEntry({})])
    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    expect(out[0].positionen[0].vk_netto_einheit).toBe(99)
  })
})

describe('enrichFromCatalog – Hero-Quirk: nicht im Katalog', () => {
  it('Katalog-Format aber nicht in der DB → aus_preisliste=true (Hero-Quirk)', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-555', // Katalog-Format, aber nicht in catalog
          leistungsname: 'KI-Pos',
          vk_netto_einheit: 30,
          aus_preisliste: false,
        }),
      ]),
    ]
    const catalog = makeCatalog([catEntry({ leistungsnummer: '09-001' })])

    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    const p = out[0].positionen[0]

    // Hero-Quirk: Pos wurde in Hero nach Sync angelegt → als Katalog markieren
    expect(p.aus_preisliste).toBe(true)
    // KI-Werte bleiben
    expect(p.vk_netto_einheit).toBe(30)
    expect(p.leistungsname).toBe('KI-Pos')
  })
})

describe('enrichFromCatalog – Material-für-Regie-Pos', () => {
  it('übernimmt nur Name/Einheit – Preise bleiben für applyRegieMaterial', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-998',
          leistungsname: 'Material für Regiestunden',
          einheit: 'pauschal',
          vk_netto_einheit: 0,
          menge: 1,
        }),
      ]),
    ]
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-998',
        leistungsname: 'Material für Regiestunden (Katalog)',
        einheit: 'pauschal',
        vk_netto_einheit: 50, // wird ignoriert für diese Pos
      }),
    ])

    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    const p = out[0].positionen[0]

    expect(p.leistungsname).toBe('Material für Regiestunden (Katalog)')
    expect(p.einheit).toBe('pauschal')
    // KEINE Preisübernahme – wird später von applyRegieMaterial berechnet
    expect(p.vk_netto_einheit).toBe(0)
    expect(p.aus_preisliste).toBe(true)
  })
})

describe('enrichFromCatalog – Template-Position (Katalog VK=0)', () => {
  it('Template-Pos → Name/Einheit aus Katalog, KI-Preis bleibt, aus_preisliste=false', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [
        pos({
          leistungsnummer: '09-001',
          leistungsname: 'Abdeckarbeiten (KI)',
          einheit: 'pauschal',
          vk_netto_einheit: 45,
          menge: 1,
        }),
      ]),
    ]
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-001',
        leistungsname: 'Abdeckarbeiten',
        einheit: 'pauschal',
        vk_netto_einheit: 0, // Template
        lohnkosten_einheit: 0,
        materialkosten_einheit: 0,
      }),
    ])

    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    const p = out[0].positionen[0]

    expect(p.leistungsname).toBe('Abdeckarbeiten')
    expect(p.einheit).toBe('pauschal')
    // KI-Preis bleibt (NICHT mit 0 überschrieben)
    expect(p.vk_netto_einheit).toBe(45)
    // Triggers Modus-1-Nachkalkulation
    expect(p.aus_preisliste).toBe(false)
  })
})

describe('enrichFromCatalog – _katalog_snapshot', () => {
  it('wird für übernommene (Normalfall-)Pos gesetzt', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [pos({ leistungsnummer: '09-001' })]),
    ]
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-001',
        leistungsname: 'Wand spachteln Q3',
        beschreibung: 'Q3-Spachtelung',
        vk_netto_einheit: 18,
        lohnkosten_einheit: 12,
        materialkosten_einheit: 6,
        lohnkosten_minuten: 9.6,
      }),
    ])

    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    const snap = out[0].positionen[0]._katalog_snapshot

    expect(snap).toBeDefined()
    expect(snap!.vk_netto_einheit).toBe(18)
    expect(snap!.lohnkosten_einheit).toBe(12)
    expect(snap!.materialkosten_einheit).toBe(6)
    expect(snap!.lohnkosten_minuten).toBe(9.6)
    expect(snap!.leistungsname).toBe('Wand spachteln Q3')
    expect(snap!.beschreibung).toBe('Q3-Spachtelung')
  })
})

describe('enrichFromCatalog – Side-Effect-Freiheit', () => {
  it('mutiert den Input nicht', () => {
    const origPos: Position = pos({
      leistungsnummer: '09-001',
      leistungsname: 'KI-Name',
      vk_netto_einheit: 12.5,
      aus_preisliste: false,
    })
    const origPosSnapshot = JSON.parse(JSON.stringify(origPos)) as Position

    const origGewerk = makeGewerk('Maler', [origPos])
    const origGewerkSnapshot = JSON.parse(JSON.stringify(origGewerk)) as Gewerk

    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-001',
        leistungsname: 'Wand spachteln Q3',
        vk_netto_einheit: 18,
        lohnkosten_einheit: 12,
        materialkosten_einheit: 6,
      }),
    ])

    const out = enrichFromCatalog([origGewerk], catalog, stundensaetze)

    // Original-Input unverändert
    expect(origPos).toEqual(origPosSnapshot)
    expect(origGewerk).toEqual(origGewerkSnapshot)
    // Output ist ein neues Objekt
    expect(out[0]).not.toBe(origGewerk)
    expect(out[0].positionen[0]).not.toBe(origPos)
  })
})

describe('enrichFromCatalog – Edge-Cases', () => {
  it('leere Gewerk-Liste → leere Ausgabe', () => {
    expect(enrichFromCatalog([], makeCatalog([catEntry({})]), stundensaetze)).toEqual(
      [],
    )
  })

  it('leerer Katalog → Input unverändert durchgereicht', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [pos({ leistungsnummer: '09-001' })]),
    ]
    const out = enrichFromCatalog(gewerke, makeCatalog([]), stundensaetze)
    expect(out).toBe(gewerke)
  })

  it('Stundensatz-Fallback aus stundensaetze-Map wenn Katalog keinen liefert', () => {
    const gewerke: Gewerk[] = [
      makeGewerk('Maler', [pos({ leistungsnummer: '09-300' })]),
    ]
    const catalog = makeCatalog([
      catEntry({
        leistungsnummer: '09-300',
        vk_netto_einheit: 20,
        lohnkosten_einheit: 10,
        materialkosten_einheit: 10,
        lohnkosten_minuten: 8,
        stundensatz: null,
      }),
    ])
    const out = enrichFromCatalog(gewerke, catalog, stundensaetze)
    expect(out[0].positionen[0].stundensatz).toBe(75) // Maler-Stundensatz
  })
})
