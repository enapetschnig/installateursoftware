// ────────────────────────────────────────────────────────────────────────────
//  dedup.test.ts – Cent-Identitäts-Tests gegen bau4you-Verhalten
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import {
  deduplicatePositionen,
  deduplicateReinigung,
  isSpecialPosition,
} from './dedup'
import type { Gewerk, Position } from './types'

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

const gewerk = (name: string, positionen: Position[]): Gewerk => ({
  name,
  positionen,
})

// ─────────────────────────────── Tests ────────────────────────────────────

describe('isSpecialPosition', () => {
  it('erkennt 990-999 als Spezial-Bereich', () => {
    expect(isSpecialPosition('09-990')).toBe(true)
    expect(isSpecialPosition('09-997')).toBe(true)
    expect(isSpecialPosition('09-999')).toBe(true)
    expect(isSpecialPosition('13-995')).toBe(true)
  })

  it('weist 000-989 als nicht-Spezial zurück', () => {
    expect(isSpecialPosition('09-001')).toBe(false)
    expect(isSpecialPosition('09-100')).toBe(false)
    expect(isSpecialPosition('09-989')).toBe(false)
    expect(isSpecialPosition('09-000')).toBe(false)
  })

  it('handhabt null/undefined/leer korrekt', () => {
    expect(isSpecialPosition(null)).toBe(false)
    expect(isSpecialPosition(undefined)).toBe(false)
    expect(isSpecialPosition('')).toBe(false)
    expect(isSpecialPosition('09-NEU')).toBe(false)
  })

  it('unterstützt Geviertstrich (–) als Trenner', () => {
    expect(isSpecialPosition('09–997')).toBe(true)
    expect(isSpecialPosition('09–100')).toBe(false)
  })
})

describe('deduplicatePositionen', () => {
  it('Test 1: zwei identische Pos "09-001" mit menge=10/20 → eine Pos menge=30', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-001', menge: 10, vk_netto_einheit: 12.5, gesamtpreis: 125 }),
        pos({ leistungsnummer: '09-001', menge: 20, vk_netto_einheit: 12.5, gesamtpreis: 250 }),
      ]),
    ]

    const result = deduplicatePositionen(input)
    expect(result).toHaveLength(1)
    expect(result[0].positionen).toHaveLength(1)
    expect(result[0].positionen[0].menge).toBe(30)
    // 30 * 12.5 = 375.00
    expect(result[0].positionen[0].gesamtpreis).toBe(375)
    expect(result[0].positionen[0].vk_netto_einheit).toBe(12.5)
    // Zwischensumme cent-genau
    expect((result[0] as unknown as { zwischensumme: number }).zwischensumme).toBe(375)
  })

  it('Test 2: Spezial-Pos 09-997 doppelt → BEIDE behalten (kein Merge)', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-997', leistungsname: 'Regiestunde', menge: 5, vk_netto_einheit: 80, gesamtpreis: 400 }),
        pos({ leistungsnummer: '09-997', leistungsname: 'Regiestunde', menge: 3, vk_netto_einheit: 80, gesamtpreis: 240 }),
      ]),
    ]

    const result = deduplicatePositionen(input)
    expect(result[0].positionen).toHaveLength(2)
    expect(result[0].positionen[0].menge).toBe(5)
    expect(result[0].positionen[1].menge).toBe(3)
    // Zwischensumme = 400 + 240
    expect((result[0] as unknown as { zwischensumme: number }).zwischensumme).toBe(640)
  })

  it('Test 3: Header 09-000 doppelt → beide behalten', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-000', leistungsname: 'Vorarbeiten', menge: 1, vk_netto_einheit: 0, gesamtpreis: 0 }),
        pos({ leistungsnummer: '09-000', leistungsname: 'Hauptarbeiten', menge: 1, vk_netto_einheit: 0, gesamtpreis: 0 }),
      ]),
    ]

    const result = deduplicatePositionen(input)
    expect(result[0].positionen).toHaveLength(2)
    expect(result[0].positionen[0].leistungsname).toBe('Vorarbeiten')
    expect(result[0].positionen[1].leistungsname).toBe('Hauptarbeiten')
  })

  it('Test 4: NEU-Nummern "09-NEU" + "09-NEU1" → beide behalten (unterschiedl. Keys)', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-NEU', leistungsname: 'Sonder A', menge: 5, vk_netto_einheit: 10, gesamtpreis: 50 }),
        pos({ leistungsnummer: '09-NEU1', leistungsname: 'Sonder B', menge: 7, vk_netto_einheit: 20, gesamtpreis: 140 }),
      ]),
    ]

    const result = deduplicatePositionen(input)
    expect(result[0].positionen).toHaveLength(2)
    expect(result[0].positionen[0].leistungsnummer).toBe('09-NEU')
    expect(result[0].positionen[1].leistungsnummer).toBe('09-NEU1')
    expect((result[0] as unknown as { zwischensumme: number }).zwischensumme).toBe(190)
  })

  it('Test 7: Beschreibungs-Merge – verschiedene Texte werden mit Leerzeichen verbunden, gleiche nicht doppelt', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-001', menge: 5, vk_netto_einheit: 10, gesamtpreis: 50, beschreibung: 'Wohnzimmer' }),
        pos({ leistungsnummer: '09-001', menge: 5, vk_netto_einheit: 10, gesamtpreis: 50, beschreibung: 'Schlafzimmer' }),
        // Duplizierte Beschreibung darf nicht erneut angehängt werden
        pos({ leistungsnummer: '09-001', menge: 2, vk_netto_einheit: 10, gesamtpreis: 20, beschreibung: 'Wohnzimmer' }),
      ]),
    ]

    const result = deduplicatePositionen(input)
    expect(result[0].positionen).toHaveLength(1)
    const merged = result[0].positionen[0]
    expect(merged.menge).toBe(12)
    expect(merged.beschreibung).toBe('Wohnzimmer Schlafzimmer')
    // Gesamtpreis exakt 12 * 10 = 120
    expect(merged.gesamtpreis).toBe(120)
  })

  it('mischt Spezial- und Standard-Positionen korrekt (Reihenfolge bleibt)', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-000', leistungsname: 'Header', menge: 1, vk_netto_einheit: 0, gesamtpreis: 0 }),
        pos({ leistungsnummer: '09-001', menge: 10, vk_netto_einheit: 5, gesamtpreis: 50 }),
        pos({ leistungsnummer: '09-997', leistungsname: 'Regie', menge: 2, vk_netto_einheit: 80, gesamtpreis: 160 }),
        pos({ leistungsnummer: '09-001', menge: 5, vk_netto_einheit: 5, gesamtpreis: 25 }),
      ]),
    ]

    const result = deduplicatePositionen(input)
    expect(result[0].positionen).toHaveLength(3)
    expect(result[0].positionen[0].leistungsnummer).toBe('09-000')
    expect(result[0].positionen[1].leistungsnummer).toBe('09-001')
    expect(result[0].positionen[1].menge).toBe(15)
    expect(result[0].positionen[1].gesamtpreis).toBe(75)
    expect(result[0].positionen[2].leistungsnummer).toBe('09-997')
  })

  it('Side-Effect-Freiheit: Input wird nicht mutiert', () => {
    const original = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-001', menge: 10, vk_netto_einheit: 12.5, gesamtpreis: 125 }),
        pos({ leistungsnummer: '09-001', menge: 20, vk_netto_einheit: 12.5, gesamtpreis: 250 }),
      ]),
    ]
    const snapshot = JSON.parse(JSON.stringify(original))

    deduplicatePositionen(original)

    expect(original).toEqual(snapshot)
    expect(original[0].positionen).toHaveLength(2)
    expect(original[0].positionen[0].menge).toBe(10)
    expect(original[0].positionen[1].menge).toBe(20)
  })

  it('handhabt leere Gewerke-Liste und 1-Position-Gewerk', () => {
    expect(deduplicatePositionen([])).toEqual([])

    const single = [gewerk('Maler', [pos({ menge: 5 })])]
    const result = deduplicatePositionen(single)
    expect(result[0].positionen).toHaveLength(1)
  })

  it('handhabt null/leere Leistungsnummer (kein Merge)', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({ leistungsnummer: null, menge: 5, vk_netto_einheit: 10, gesamtpreis: 50 }),
        pos({ leistungsnummer: '', menge: 5, vk_netto_einheit: 10, gesamtpreis: 50 }),
        pos({ leistungsnummer: null, menge: 5, vk_netto_einheit: 10, gesamtpreis: 50 }),
      ]),
    ]

    const result = deduplicatePositionen(input)
    // alle 3 bleiben, da keine Nummer
    expect(result[0].positionen).toHaveLength(3)
  })
})

describe('deduplicateReinigung', () => {
  it('Test 5: Reinigung mit 3 Positionen verschiedener Preise → nur teuerste behalten', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [pos({ leistungsnummer: '09-001', menge: 10, gesamtpreis: 100 })]),
      gewerk('Reinigung', [
        pos({ leistungsnummer: '13-100', leistungsname: 'Feinreinigung', menge: 50, gesamtpreis: 500 }),
        pos({ leistungsnummer: '13-101', leistungsname: 'Baureinigung', menge: 50, gesamtpreis: 1200 }),
        pos({ leistungsnummer: '13-102', leistungsname: 'Endreinigung', menge: 50, gesamtpreis: 800 }),
      ]),
    ]

    const result = deduplicateReinigung(input)
    expect(result).toHaveLength(2)
    expect(result[1].positionen).toHaveLength(1)
    expect(result[1].positionen[0].leistungsname).toBe('Baureinigung')
    expect(result[1].positionen[0].gesamtpreis).toBe(1200)
    expect((result[1] as unknown as { zwischensumme: number }).zwischensumme).toBe(1200)
    // andere Gewerke unverändert
    expect(result[0].positionen).toHaveLength(1)
  })

  it('Test 6: Reinigung mit nur einer Position → unverändert (kein 13-XXX nötig)', () => {
    const input: Gewerk[] = [
      gewerk('Reinigung', [
        pos({ leistungsnummer: '13-100', leistungsname: 'Feinreinigung', menge: 50, gesamtpreis: 500 }),
      ]),
    ]

    const result = deduplicateReinigung(input)
    expect(result).toBe(input) // gleiche Referenz weil pos.length <= 1
    expect(result[0].positionen).toHaveLength(1)
  })

  it('Reinigung mit 0 Positionen → unverändert', () => {
    const input: Gewerk[] = [gewerk('Reinigung', [])]

    const result = deduplicateReinigung(input)
    expect(result[0].positionen).toHaveLength(0)
  })

  it('kein Reinigung-Gewerk vorhanden → unverändert', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [pos({ leistungsnummer: '09-001', gesamtpreis: 100 })]),
      gewerk('Abbruch', [pos({ leistungsnummer: '02-001', gesamtpreis: 200 })]),
    ]

    const result = deduplicateReinigung(input)
    expect(result).toBe(input) // Original-Referenz zurück
    expect(result).toHaveLength(2)
  })

  it('erkennt "Reinigung" case-insensitive und mit Umlauten in Gewerk-Namen', () => {
    const input: Gewerk[] = [
      gewerk('Bauendreinigung', [
        pos({ leistungsnummer: '13-100', menge: 10, gesamtpreis: 300 }),
        pos({ leistungsnummer: '13-101', menge: 20, gesamtpreis: 700 }),
      ]),
    ]

    const result = deduplicateReinigung(input)
    expect(result[0].positionen).toHaveLength(1)
    expect(result[0].positionen[0].gesamtpreis).toBe(700)
  })

  it('bei Gleichstand wird die spätere Position behalten (>=)', () => {
    const input: Gewerk[] = [
      gewerk('Reinigung', [
        pos({ leistungsnummer: '13-100', leistungsname: 'A', menge: 1, gesamtpreis: 500 }),
        pos({ leistungsnummer: '13-101', leistungsname: 'B', menge: 1, gesamtpreis: 500 }),
      ]),
    ]

    const result = deduplicateReinigung(input)
    expect(result[0].positionen).toHaveLength(1)
    // reduce mit >= → spätere gewinnt
    expect(result[0].positionen[0].leistungsname).toBe('B')
  })

  it('Side-Effect-Freiheit: Input wird nicht mutiert', () => {
    const original: Gewerk[] = [
      gewerk('Reinigung', [
        pos({ leistungsnummer: '13-100', menge: 50, gesamtpreis: 500 }),
        pos({ leistungsnummer: '13-101', menge: 50, gesamtpreis: 1200 }),
      ]),
    ]
    const snapshot = JSON.parse(JSON.stringify(original))

    deduplicateReinigung(original)

    expect(original).toEqual(snapshot)
    expect(original[0].positionen).toHaveLength(2)
  })

  it('leere Gewerke-Liste → unverändert', () => {
    expect(deduplicateReinigung([])).toEqual([])
  })
})
