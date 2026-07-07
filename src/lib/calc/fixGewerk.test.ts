// ────────────────────────────────────────────────────────────────────────────
//  fixGewerk – Tests (Vitest)
//
//  Validiert Cent- & Verhalten-Identität gegen bau4you-Output:
//   - claude.js Z. 751-815 (fixGewerkeByLeistungsnummer, fixGewerkeLeistungsnummern)
//   - fixGewerkZuordnung.js (detectCorrectGewerk, adjustLeistungsnummer, fixGewerkZuordnung)
//
//  Hinweis: PREFIX_TO_GEWERK aus types.ts: 09 = Maler, 02 = Abbruch, 13 = Reinigung.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  detectCorrectGewerk,
  adjustLeistungsnummer,
  fixGewerkeLeistungsnummern,
  fixGewerkeByLeistungsnummer,
  fixGewerkZuordnung,
} from './fixGewerk'
import type { Position, Gewerk } from './types'

// ──── detectCorrectGewerk ────────────────────────────────────────────────────

describe('detectCorrectGewerk', () => {
  it('erkennt Bauschuttcontainer → Abbruch', () => {
    const pos: Position = {
      leistungsname: 'Bauschuttcontainer 7m³',
      beschreibung: 'Aufstellung und Abholung',
    }
    expect(detectCorrectGewerk(pos)).toBe('Abbruch')
  })

  it('erkennt Bauschlussreinigung → Reinigung', () => {
    const pos: Position = {
      leistungsname: 'Bauschlussreinigung Wohnung',
      beschreibung: null,
    }
    expect(detectCorrectGewerk(pos)).toBe('Reinigung')
  })

  it('liefert null für neutrale Position', () => {
    const pos: Position = {
      leistungsname: 'Wand streichen',
      beschreibung: 'Q3-Spachtelung, 2x Anstrich',
    }
    expect(detectCorrectGewerk(pos)).toBeNull()
  })

  it('matched Keyword case-insensitiv und in Umlaut-Varianten (Sperrmüll)', () => {
    const pos: Position = {
      leistungsname: 'Entsorgung Sperrmüll',
      beschreibung: '',
    }
    expect(detectCorrectGewerk(pos)).toBe('Abbruch')
  })

  it('matched Keyword im Langtext (beschreibung) wenn leistungsname neutral ist', () => {
    const pos: Position = {
      leistungsname: 'Diverse Arbeiten',
      beschreibung: 'inkl. Bauschuttentsorgung über Mulde',
    }
    expect(detectCorrectGewerk(pos)).toBe('Abbruch')
  })

  it('mutiert die Input-Position nicht', () => {
    const pos: Position = { leistungsname: 'Mulde 5m³', beschreibung: 'x' }
    const snapshot = JSON.stringify(pos)
    detectCorrectGewerk(pos)
    expect(JSON.stringify(pos)).toBe(snapshot)
  })
})

// ──── adjustLeistungsnummer ──────────────────────────────────────────────────

describe('adjustLeistungsnummer', () => {
  it('passt 09-NEU auf Abbruch (02-NEU) an', () => {
    const pos: Position = { leistungsnummer: '09-NEU' }
    expect(adjustLeistungsnummer(pos, 'Abbruch')).toBe('02-NEU')
  })

  it('passt 09-NEU3 auf Reinigung (13-NEU3) an', () => {
    const pos: Position = { leistungsnummer: '09-NEU3' }
    expect(adjustLeistungsnummer(pos, 'Reinigung')).toBe('13-NEU3')
  })

  it('lässt Katalog-Nummern (09-001) unverändert', () => {
    const pos: Position = { leistungsnummer: '09-001' }
    expect(adjustLeistungsnummer(pos, 'Abbruch')).toBe('09-001')
  })

  it('lässt leere/ungültige Nummern unverändert', () => {
    const pos: Position = { leistungsnummer: '' }
    expect(adjustLeistungsnummer(pos, 'Abbruch')).toBe('')
  })

  it('gibt Nummer unverändert zurück wenn Zielgewerk unbekannt ist', () => {
    const pos: Position = { leistungsnummer: '09-NEU' }
    expect(adjustLeistungsnummer(pos, 'UnknownGewerk')).toBe('09-NEU')
  })
})

// ──── fixGewerkeLeistungsnummern ─────────────────────────────────────────────

describe('fixGewerkeLeistungsnummern', () => {
  it('ersetzt erfundene Nummer (M001) durch XX-NEU + aus_preisliste=false', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: 'M001', leistungsname: 'Erfunden', aus_preisliste: true },
        ],
      },
    ]
    const fixed = fixGewerkeLeistungsnummern(gewerke)
    expect(fixed[0].positionen[0].leistungsnummer).toBe('09-NEU')
    expect(fixed[0].positionen[0].aus_preisliste).toBe(false)
  })

  it('zählt mehrere Neu-Positionen hoch (NEU, NEU1, NEU2…)', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: 'n. n.', leistungsname: 'A' },
          { leistungsnummer: '', leistungsname: 'B' },
          { leistungsnummer: 'foo', leistungsname: 'C' },
        ],
      },
    ]
    const fixed = fixGewerkeLeistungsnummern(gewerke)
    expect(fixed[0].positionen.map((p) => p.leistungsnummer)).toEqual([
      '09-NEU',
      '09-NEU1',
      '09-NEU2',
    ])
    expect(fixed[0].positionen.every((p) => p.aus_preisliste === false)).toBe(true)
  })

  it('lässt valide Nummern (XX-NNN, XX-NEU) unverändert und resettet flags nicht', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: '09-001', leistungsname: 'Katalog', aus_preisliste: true },
          { leistungsnummer: '09-NEU2', leistungsname: 'Neu', aus_preisliste: false },
        ],
      },
    ]
    const fixed = fixGewerkeLeistungsnummern(gewerke)
    expect(fixed[0].positionen[0].leistungsnummer).toBe('09-001')
    expect(fixed[0].positionen[0].aus_preisliste).toBe(true)
    expect(fixed[0].positionen[1].leistungsnummer).toBe('09-NEU2')
    expect(fixed[0].positionen[1].aus_preisliste).toBe(false)
  })

  it('mutiert das Input-Array nicht', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [{ leistungsnummer: 'M001', leistungsname: 'A' }],
      },
    ]
    const snapshot = JSON.stringify(gewerke)
    fixGewerkeLeistungsnummern(gewerke)
    expect(JSON.stringify(gewerke)).toBe(snapshot)
  })
})

// ──── fixGewerkeByLeistungsnummer ────────────────────────────────────────────

describe('fixGewerkeByLeistungsnummer', () => {
  it('routet Position anhand Prefix in das richtige Gewerk (02-001 in Maler → Abbruch)', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: '02-001', leistungsname: 'Bauschuttcontainer', gesamtpreis: 250 },
          { leistungsnummer: '09-001', leistungsname: 'Streichen', gesamtpreis: 500 },
        ],
      },
    ]
    const fixed = fixGewerkeByLeistungsnummer(gewerke)
    const abbruch = fixed.find((g) => g.name === 'Abbruch')
    const maler = fixed.find((g) => g.name === 'Maler')
    expect(abbruch?.positionen.map((p) => p.leistungsnummer)).toEqual(['02-001'])
    expect(maler?.positionen.map((p) => p.leistungsnummer)).toEqual(['09-001'])
    // gewerk-Feld wird auf den korrekten Wert gesetzt
    expect(abbruch?.positionen[0].gewerk).toBe('Abbruch')
    expect(maler?.positionen[0].gewerk).toBe('Maler')
  })

  it('entfernt leeres Gewerk komplett', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: '02-001', leistungsname: 'Mulde', gesamtpreis: 100 },
        ],
      },
      {
        name: 'Reinigung',
        positionen: [],
      },
    ]
    const fixed = fixGewerkeByLeistungsnummer(gewerke)
    expect(fixed.find((g) => g.name === 'Maler')).toBeUndefined()
    expect(fixed.find((g) => g.name === 'Reinigung')).toBeUndefined()
    expect(fixed.find((g) => g.name === 'Abbruch')).toBeDefined()
  })

  it('Reihenfolge der ursprünglichen Gewerk-Liste bleibt erhalten (stable)', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Abbruch',
        positionen: [
          { leistungsnummer: '02-100', leistungsname: 'A', gesamtpreis: 50 },
        ],
      },
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: '09-100', leistungsname: 'M', gesamtpreis: 100 },
        ],
      },
      {
        name: 'Reinigung',
        positionen: [
          { leistungsnummer: '13-100', leistungsname: 'R', gesamtpreis: 200 },
        ],
      },
    ]
    const fixed = fixGewerkeByLeistungsnummer(gewerke)
    expect(fixed.map((g) => g.name)).toEqual(['Abbruch', 'Maler', 'Reinigung'])
  })

  it('berechnet zwischensumme aus gesamtpreis-Summe (Cent-Identität)', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: '09-001', leistungsname: 'A', gesamtpreis: 100.5 },
          { leistungsnummer: '09-002', leistungsname: 'B', gesamtpreis: 49.5 },
        ],
      },
    ]
    const fixed = fixGewerkeByLeistungsnummer(gewerke) as (Gewerk & { zwischensumme?: number })[]
    expect(fixed[0].zwischensumme).toBe(150)
  })

  it('Position ohne gültiges Präfix bleibt im Original-Gewerk', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: 'no-prefix', leistungsname: 'X', gesamtpreis: 10 },
        ],
      },
    ]
    const fixed = fixGewerkeByLeistungsnummer(gewerke)
    expect(fixed[0].name).toBe('Maler')
    expect(fixed[0].positionen).toHaveLength(1)
  })

  it('mutiert das Input-Array nicht', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: '02-001', leistungsname: 'Mulde', gesamtpreis: 100 },
        ],
      },
    ]
    const snapshot = JSON.stringify(gewerke)
    fixGewerkeByLeistungsnummer(gewerke)
    expect(JSON.stringify(gewerke)).toBe(snapshot)
  })

  it('liefert das Input-Array zurück wenn es leer ist', () => {
    expect(fixGewerkeByLeistungsnummer([])).toEqual([])
  })
})

// ──── fixGewerkZuordnung ────────────────────────────────────────────────────

describe('fixGewerkZuordnung', () => {
  it('verschiebt "Bauschuttcontainer" aus Maler nach Abbruch und passt NEU-Nummer an', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          {
            leistungsnummer: '09-NEU',
            leistungsname: 'Bauschuttcontainer 7m³',
            beschreibung: 'Aufstellung',
            gesamtpreis: 280,
          },
          {
            leistungsnummer: '09-001',
            leistungsname: 'Wand streichen',
            gesamtpreis: 500,
          },
        ],
      },
    ]
    const fixed = fixGewerkZuordnung(gewerke)
    const abbruch = fixed.find((g) => g.name === 'Abbruch')
    const maler = fixed.find((g) => g.name === 'Maler')
    expect(abbruch?.positionen).toHaveLength(1)
    expect(abbruch?.positionen[0].leistungsnummer).toBe('02-NEU')
    expect(abbruch?.positionen[0].gewerk).toBe('Abbruch')
    expect(maler?.positionen).toHaveLength(1)
    expect(maler?.positionen[0].leistungsname).toBe('Wand streichen')
  })

  it('lässt Katalog-Nummer beim Gewerk-Wechsel unverändert (XX-NNN bleibt)', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          {
            leistungsnummer: '09-555',
            leistungsname: 'Bauschlussreinigung Wohnung',
            gesamtpreis: 300,
          },
        ],
      },
    ]
    const fixed = fixGewerkZuordnung(gewerke)
    const reinigung = fixed.find((g) => g.name === 'Reinigung')
    expect(reinigung?.positionen[0].leistungsnummer).toBe('09-555')
    expect(reinigung?.positionen[0].gewerk).toBe('Reinigung')
  })

  it('liefert die Original-Referenz zurück wenn nichts geändert wurde', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          { leistungsnummer: '09-001', leistungsname: 'Streichen', gesamtpreis: 100 },
        ],
      },
    ]
    expect(fixGewerkZuordnung(gewerke)).toBe(gewerke)
  })

  it('entfernt leere Gewerke und behält Reihenfolge der ursprünglichen Liste', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Abbruch',
        positionen: [],
      },
      {
        name: 'Maler',
        positionen: [
          {
            leistungsnummer: '09-NEU',
            leistungsname: 'Mulde 5m³',
            gesamtpreis: 250,
          },
        ],
      },
    ]
    const fixed = fixGewerkZuordnung(gewerke)
    expect(fixed.map((g) => g.name)).toEqual(['Abbruch', 'Maler'].filter((n) => n === 'Abbruch'))
    // Maler ist leer geworden und wird entfernt; Abbruch hat jetzt die Mulde.
    expect(fixed).toHaveLength(1)
    expect(fixed[0].name).toBe('Abbruch')
    expect(fixed[0].positionen[0].leistungsnummer).toBe('02-NEU')
  })

  it('berechnet zwischensumme korrekt nach Move (Cent-Identität)', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          {
            leistungsnummer: '09-NEU',
            leistungsname: 'Bauschuttcontainer',
            gesamtpreis: 280.55,
          },
          {
            leistungsnummer: '09-001',
            leistungsname: 'Streichen',
            gesamtpreis: 119.45,
          },
        ],
      },
    ]
    const fixed = fixGewerkZuordnung(gewerke) as (Gewerk & { zwischensumme?: number })[]
    const abbruch = fixed.find((g) => g.name === 'Abbruch')
    const maler = fixed.find((g) => g.name === 'Maler')
    expect(abbruch?.zwischensumme).toBe(280.55)
    expect(maler?.zwischensumme).toBe(119.45)
  })

  it('mutiert das Input-Array nicht', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          {
            leistungsnummer: '09-NEU',
            leistungsname: 'Bauschuttcontainer',
            gesamtpreis: 100,
          },
        ],
      },
    ]
    const snapshot = JSON.stringify(gewerke)
    fixGewerkZuordnung(gewerke)
    expect(JSON.stringify(gewerke)).toBe(snapshot)
  })

  it('liefert das Input-Array zurück wenn es leer ist', () => {
    expect(fixGewerkZuordnung([])).toEqual([])
  })
})
