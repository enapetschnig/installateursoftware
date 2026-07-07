// ────────────────────────────────────────────────────────────────────────────
//  smartReinigung.test.ts – Vitest-Suite für die Reinigungs-Automatik.
//
//  Deckt alle vom Task-Spec geforderten Szenarien plus Edge-Cases ab und
//  testet zentral die Immutability-Garantie (Object.freeze auf Inputs).
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import {
  RAUM_M2,
  REINIGUNGS_CAP,
  DEFAULT_BODEN_M2,
  MAX_BODEN_M2,
  FEINREIN_PREIS_FALLBACK,
  bodenFlaecheSchaetzen,
  braucht_feinreinigung,
  smartReinigung,
} from './smartReinigung'
import type { CatalogPosition, Gewerk, Position } from './types'

// ─────────────────────────────── Helpers ──────────────────────────────────

const pos = (overrides: Partial<Position> = {}): Position => ({
  leistungsnummer: '09-001',
  leistungsname: 'Wand spachteln Q3',
  beschreibung: '',
  einheit: 'm²',
  menge: 10,
  vk_netto_einheit: 12,
  gesamtpreis: 120,
  ...overrides,
})

const gewerk = (name: string, positionen: Position[]): Gewerk => ({
  name,
  positionen,
})

const freezeDeep = <T>(obj: T): T => {
  if (obj && typeof obj === 'object') {
    Object.values(obj as Record<string, unknown>).forEach((v) => {
      if (v && typeof v === 'object') freezeDeep(v as Record<string, unknown>)
    })
    Object.freeze(obj)
  }
  return obj
}

// ───────────────────────── bodenFlaecheSchaetzen ──────────────────────────

describe('bodenFlaecheSchaetzen', () => {
  it('Priorität 1: Abdeckarbeiten 50 m² → 50', () => {
    const gewerke = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-001',
          leistungsname: 'Abdeckarbeiten Boden',
          menge: 50,
          einheit: 'm²',
        }),
        // Andere Maler-Pos die nicht relevant sein darf:
        pos({ leistungsname: 'Wand streichen', menge: 999, einheit: 'm²' }),
      ]),
    ]
    expect(bodenFlaecheSchaetzen(gewerke)).toBe(50)
  })

  it('Priorität 2: Bodenleger 80 m² → 80', () => {
    const gewerke = [
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett verlegen',
          menge: 80,
          einheit: 'm²',
        }),
      ]),
    ]
    expect(bodenFlaecheSchaetzen(gewerke)).toBe(80)
  })

  it('Priorität 3: Wand 120 m² (Maler) → 40 (geteilt durch 3)', () => {
    const gewerke = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-002',
          leistungsname: 'Wand streichen',
          menge: 120,
          einheit: 'm²',
        }),
      ]),
    ]
    expect(bodenFlaecheSchaetzen(gewerke)).toBe(40)
  })

  it('Priorität 4: eingabeText "Bad und WC" → 9 (6+3)', () => {
    const gewerke: Gewerk[] = []
    expect(bodenFlaecheSchaetzen(gewerke, 'Sanierung im Bad und WC')).toBe(
      RAUM_M2.bad + RAUM_M2.wc,
    )
  })

  it('Priorität 4: Räume werden nur einmal gezählt', () => {
    expect(
      bodenFlaecheSchaetzen([], 'Bad neu fliesen, Bad streichen, WC reinigen'),
    ).toBe(RAUM_M2.bad + RAUM_M2.wc)
  })

  it('Fallback: ohne Hinweise → 40', () => {
    expect(bodenFlaecheSchaetzen([])).toBe(DEFAULT_BODEN_M2)
    expect(bodenFlaecheSchaetzen([gewerk('Maler', [])])).toBe(DEFAULT_BODEN_M2)
  })

  it('Cap: 250 m² Bodenleger → 200', () => {
    const gewerke = [
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett',
          menge: 250,
          einheit: 'm²',
        }),
      ]),
    ]
    expect(bodenFlaecheSchaetzen(gewerke)).toBe(MAX_BODEN_M2)
  })

  it('Fliesenleger-Boden (06-) wird als Boden gezählt, Wand nicht', () => {
    const gewerke = [
      gewerk('Fliesenleger', [
        pos({
          leistungsnummer: '06-001',
          leistungsname: 'Bodenfliesen verlegen',
          menge: 30,
          einheit: 'm²',
        }),
        pos({
          leistungsnummer: '06-002',
          leistungsname: 'Wandfliesen verlegen',
          menge: 80,
          einheit: 'm²',
        }),
      ]),
    ]
    expect(bodenFlaecheSchaetzen(gewerke)).toBe(30)
  })

  it('Maler-Decke wird nicht als Wand gezählt', () => {
    const gewerke = [
      gewerk('Maler', [
        pos({ leistungsname: 'Deckenanstrich', menge: 90, einheit: 'm²' }),
      ]),
    ]
    // Decke trägt nicht zur Wandflächen-Summe bei → kein Treffer → Fallback
    expect(bodenFlaecheSchaetzen(gewerke)).toBe(DEFAULT_BODEN_M2)
  })

  it('Reinigungs-Gewerk wird beim Schätzen ignoriert', () => {
    const gewerke = [
      gewerk('Reinigung', [
        pos({ leistungsname: 'Bauschlussreinigung', menge: 999, einheit: 'm²' }),
      ]),
    ]
    expect(bodenFlaecheSchaetzen(gewerke)).toBe(DEFAULT_BODEN_M2)
  })
})

// ───────────────────────── braucht_feinreinigung ──────────────────────────

describe('braucht_feinreinigung', () => {
  it('true bei "spachteln" in Positions-Name', () => {
    expect(
      braucht_feinreinigung([
        gewerk('Maler', [pos({ leistungsname: 'Wand spachteln Q3' })]),
      ]),
    ).toBe(true)
  })

  it('true bei "abbruch" in Beschreibung', () => {
    expect(
      braucht_feinreinigung([
        gewerk('Abbruch', [
          pos({
            leistungsname: 'Wand entfernen',
            beschreibung: 'Sauberer Abbruch der Innenwand',
          }),
        ]),
      ]),
    ).toBe(true)
  })

  it('false bei reinem Tapezieren', () => {
    expect(
      braucht_feinreinigung([
        gewerk('Tapezierer', [
          pos({ leistungsname: 'Tapezieren Raufaser', beschreibung: '' }),
        ]),
      ]),
    ).toBe(false)
  })

  it('false bei leerem Angebot', () => {
    expect(braucht_feinreinigung([])).toBe(false)
    expect(braucht_feinreinigung(null)).toBe(false)
    expect(braucht_feinreinigung(undefined)).toBe(false)
  })

  it('Reinigungs-Gewerk wird ignoriert (keine Selbst-Auslösung)', () => {
    expect(
      braucht_feinreinigung([
        gewerk('Reinigung', [
          pos({ leistungsname: 'Maler-Reinigung Spachtelreste' }),
        ]),
      ]),
    ).toBe(false)
  })
})

// ───────────────────────── smartReinigung ─────────────────────────────────

describe('smartReinigung', () => {
  it('leeres Angebot → unverändert', () => {
    expect(smartReinigung([], null)).toEqual([])
  })

  it('Tapezierer (80 m² Boden) → fügt 13-001 Besenrein ein', () => {
    const gewerke = [
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett verlegen',
          menge: 80,
          einheit: 'm²',
        }),
      ]),
      gewerk('Tapezierer', [
        pos({
          leistungsnummer: '10-001',
          leistungsname: 'Tapezieren',
          menge: 40,
          einheit: 'm²',
        }),
      ]),
    ]
    const result = smartReinigung(gewerke, null)
    const reinigung = result.find((g) => g.name === 'Reinigung')
    expect(reinigung).toBeDefined()
    expect(reinigung!.positionen).toHaveLength(1)
    const r = reinigung!.positionen[0]
    expect(r.leistungsnummer).toBe('13-001')
    expect(r.menge).toBe(80)
    expect(r.vk_netto_einheit).toBe(FEINREIN_PREIS_FALLBACK)
    expect(r.gesamtpreis).toBe(80 * FEINREIN_PREIS_FALLBACK)
  })

  it('mit Spachtel-Pos (80 m² Boden) → fügt 13-100 Feinrein ein', () => {
    const gewerke = [
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett verlegen',
          menge: 80,
          einheit: 'm²',
        }),
      ]),
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-001',
          leistungsname: 'Wand spachteln Q3',
          menge: 100,
          einheit: 'm²',
        }),
      ]),
    ]
    const result = smartReinigung(gewerke, null)
    const reinigung = result.find((g) => g.name === 'Reinigung')!
    expect(reinigung.positionen[0].leistungsnummer).toBe('13-100')
  })

  it('300 m² × 10.40 € = 3120 € → Hard-Cap auf REINIGUNGS_CAP (3000 €)', () => {
    // Bodenleger 300 m² → vor Cap: 200 m² (MAX_BODEN_M2). Damit der Cap
    // tatsächlich greift, hier mit Katalog-Preis 20 € arbeiten.
    const catalog: CatalogPosition[] = [
      {
        leistungsnummer: '13-001',
        leistungsname: 'Baureinigung besenrein',
        einheit: 'm²',
        vk_netto_einheit: 20,
        lohnkosten_minuten: 0,
      },
    ]
    const gewerke = [
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett verlegen',
          menge: 300, // wird durch MAX_BODEN_M2 auf 200 gecappt
          einheit: 'm²',
        }),
      ]),
    ]
    const result = smartReinigung(gewerke, catalog)
    const r = result.find((g) => g.name === 'Reinigung')!.positionen[0]
    // 200 m² × 20 € = 4000 € > 3000 €  → Menge anpassen auf 150
    expect(r.vk_netto_einheit).toBe(20)
    expect(r.gesamtpreis).toBeLessThanOrEqual(REINIGUNGS_CAP)
    expect(r.menge).toBe(150)
    expect(r.gesamtpreis).toBe(3000)
  })

  it('manuell bearbeitete Reinigung → unverändert', () => {
    const gewerke = [
      gewerk('Maler', [
        pos({ leistungsname: 'Wand spachteln Q3', menge: 100, einheit: 'm²' }),
      ]),
      gewerk('Reinigung', [
        pos({
          leistungsnummer: '13-100',
          leistungsname: 'User-Custom-Reinigung',
          menge: 1,
          einheit: 'pauschal',
          vk_netto_einheit: 500,
          gesamtpreis: 500,
          manuellBearbeitet: true,
        }),
      ]),
    ]
    const result = smartReinigung(gewerke, null)
    expect(result).toBe(gewerke)
    expect(result[1].positionen[0].leistungsname).toBe('User-Custom-Reinigung')
    expect(result[1].positionen[0].gesamtpreis).toBe(500)
  })

  it('opts.reinigungEntfernt=true → unverändert (kein Re-Insert)', () => {
    const gewerke = [
      gewerk('Maler', [
        pos({ leistungsname: 'Wand spachteln', menge: 50, einheit: 'm²' }),
      ]),
    ]
    const result = smartReinigung(gewerke, null, {}, { reinigungEntfernt: true })
    expect(result).toBe(gewerke)
    expect(result.find((g) => g.name === 'Reinigung')).toBeUndefined()
  })

  it('Bodenfläche <= 10 m² → Stunden-Reinigung (13-998)', () => {
    const gewerke = [
      gewerk('Fliesenleger', [
        pos({
          leistungsnummer: '06-001',
          leistungsname: 'Bodenfliesen',
          menge: 8,
          einheit: 'm²',
        }),
      ]),
    ]
    const result = smartReinigung(gewerke, null)
    const r = result.find((g) => g.name === 'Reinigung')!.positionen[0]
    expect(r.leistungsnummer).toBe('13-998')
    expect(r.einheit).toBe('Stunde(n)')
    expect(r.menge).toBe(2) // mindestens 2h
  })

  it('Reinigungs-Gewerk wird am Ende angehängt', () => {
    const gewerke = [
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett',
          menge: 50,
          einheit: 'm²',
        }),
      ]),
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-001',
          leistungsname: 'Tapezieren',
          menge: 40,
          einheit: 'm²',
        }),
      ]),
    ]
    const result = smartReinigung(gewerke, null)
    expect(result[result.length - 1].name).toBe('Reinigung')
  })

  it('existierendes Reinigungs-Gewerk wird ersetzt (nicht dupliziert)', () => {
    const gewerke = [
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett',
          menge: 50,
          einheit: 'm²',
        }),
      ]),
      gewerk('Reinigung', [
        pos({
          leistungsnummer: '13-001',
          leistungsname: 'Alte Reinigung',
          menge: 5,
          einheit: 'm²',
          vk_netto_einheit: 5,
          gesamtpreis: 25,
        }),
      ]),
    ]
    const result = smartReinigung(gewerke, null)
    const reinigungBloecke = result.filter((g) => g.name === 'Reinigung')
    expect(reinigungBloecke).toHaveLength(1)
    expect(reinigungBloecke[0].positionen).toHaveLength(1)
    expect(reinigungBloecke[0].positionen[0].menge).toBe(50)
  })

  it('Katalog-Eintrag überschreibt Fallback-Preis', () => {
    const catalog: CatalogPosition[] = [
      {
        leistungsnummer: '13-100',
        leistungsname: 'Bauschlussreinigung feinrein',
        einheit: 'm²',
        vk_netto_einheit: 12.5,
        lohnkosten_minuten: 0,
      },
    ]
    const gewerke = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-001',
          leistungsname: 'Spachteln',
          menge: 80,
          einheit: 'm²',
        }),
      ]),
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett',
          menge: 50,
          einheit: 'm²',
        }),
      ]),
    ]
    const result = smartReinigung(gewerke, catalog)
    const r = result.find((g) => g.name === 'Reinigung')!.positionen[0]
    expect(r.vk_netto_einheit).toBe(12.5)
    expect(r.gesamtpreis).toBe(50 * 12.5)
    expect(r.aus_preisliste).toBe(true)
  })

  // ─── Immutability ────────────────────────────────────────────────────
  it('Input-Arrays/Objekte werden nicht mutiert (Object.freeze)', () => {
    const gewerke = freezeDeep([
      gewerk('Bodenleger', [
        pos({
          leistungsnummer: '05-001',
          leistungsname: 'Parkett',
          menge: 60,
          einheit: 'm²',
        }),
      ]),
    ])
    expect(() => smartReinigung(gewerke, null)).not.toThrow()
    expect(() => bodenFlaecheSchaetzen(gewerke, 'Bad und WC')).not.toThrow()
    expect(() => braucht_feinreinigung(gewerke)).not.toThrow()
    // Input bleibt unverändert
    expect(gewerke).toHaveLength(1)
    expect(gewerke[0].positionen[0].menge).toBe(60)
  })
})
