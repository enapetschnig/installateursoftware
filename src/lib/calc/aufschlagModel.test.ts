// ────────────────────────────────────────────────────────────────────────────
//  aufschlagModel.test.ts – Cent-Identität gegen bau4you-Verhalten
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  calcAufschlag,
  verifyAufschlaege,
  verifyAufschlaegeGewerke,
} from './aufschlagModel'
import {
  DEFAULT_KALK_SETTINGS,
  type KalkSettings,
  type Position,
  type Gewerk,
} from './types'

// ── Test-Helpers ────────────────────────────────────────────────────────────
const baseSettings: KalkSettings = { ...DEFAULT_KALK_SETTINGS }

function mkPos(overrides: Partial<Position> = {}): Position {
  return {
    leistungsnummer: '09-100',
    leistungsname: 'Wand spachteln Q3',
    einheit: 'm²',
    menge: 10,
    materialkosten_einheit: 2.5,
    lohnkosten_einheit: 8.75,
    vk_netto_einheit: 14.4,
    gesamtpreis: 144,
    aus_preisliste: false,
    ...overrides,
  }
}

// ── calcAufschlag ───────────────────────────────────────────────────────────
describe('calcAufschlag', () => {
  it('1. Standard: mat=2.5, lohn=8.75 → 14.40', () => {
    // material*1.3 = 3.25; +lohn 8.75 = 12.00; *1.2 = 14.40
    expect(calcAufschlag(2.5, 8.75, baseSettings)).toBe(14.4)
  })

  it('2. Pro-Gewerk-Override: aufschlagPerGewerk = { Maler: 25 } → 25 % statt 20 %', () => {
    const settings: KalkSettings = {
      ...baseSettings,
      aufschlagPerGewerk: { Maler: 25 },
    }
    // material*1.3 = 3.25; +8.75 = 12.00; *1.25 = 15.00
    expect(calcAufschlag(2.5, 8.75, settings, 'Maler')).toBe(15)
    // Anderes Gewerk → Default 20 %
    expect(calcAufschlag(2.5, 8.75, settings, 'Abbruch')).toBe(14.4)
    // Kein Gewerk → Default 20 %
    expect(calcAufschlag(2.5, 8.75, settings)).toBe(14.4)
  })

  it('Override mit 0 % wird als gültiger Override behandelt (nicht als falsy)', () => {
    const settings: KalkSettings = {
      ...baseSettings,
      aufschlagPerGewerk: { Gemeinkosten: 0 },
    }
    // material*1.3 + lohn = 12.00; *1.0 = 12.00 (kein Gesamtaufschlag)
    expect(calcAufschlag(2.5, 8.75, settings, 'Gemeinkosten')).toBe(12)
  })

  it('Nur Lohn (mat=0): aufschlagMaterial irrelevant', () => {
    // 0*1.3 + 10 = 10; *1.2 = 12.00
    expect(calcAufschlag(0, 10, baseSettings)).toBe(12)
  })

  it('Nur Material (lohn=0): beide Aufschläge greifen', () => {
    // 10*1.3 + 0 = 13; *1.2 = 15.60
    expect(calcAufschlag(10, 0, baseSettings)).toBe(15.6)
  })

  it('Rundung auf 2 Nachkommastellen', () => {
    // 1.111*1.3 + 2.222 = 1.4443 + 2.222 = 3.6663; *1.2 = 4.39956 → 4.40
    expect(calcAufschlag(1.111, 2.222, baseSettings)).toBe(4.4)
  })
})

// ── verifyAufschlaege ───────────────────────────────────────────────────────
describe('verifyAufschlaege', () => {
  it('3. vk_ist genau richtig → unverändert', () => {
    const pos = mkPos({ vk_netto_einheit: 14.4 })
    const result = verifyAufschlaege(pos, baseSettings)
    // Identisches Objekt-Referenz möglich, aber wichtig: Werte unverändert
    expect(result.vk_netto_einheit).toBe(14.4)
    expect(result.gesamtpreis).toBe(144)
  })

  it('4. vk_ist ~5 % zu niedrig → wird auf vk_soll (14.40) korrigiert', () => {
    // Soll = 14.40, Ist = 13.68 (= -5 %), > 2 % Toleranz → Korrektur
    const pos = mkPos({ vk_netto_einheit: 13.68, gesamtpreis: 136.8 })
    const result = verifyAufschlaege(pos, baseSettings)
    expect(result.vk_netto_einheit).toBe(14.4)
    expect(result.gesamtpreis).toBe(144) // 10 × 14.40
    expect(result.aufschlag_prozent).toBe(20)
    // Materialanteil: 2.5 / (2.5 + 8.75) = 22.2 %
    expect(result.materialanteil_prozent).toBeCloseTo(22.2, 1)
    expect(result.lohnanteil_prozent).toBeCloseTo(77.8, 1)
  })

  it('5. vk_ist ~5 % zu hoch → unverändert (nur nach oben korrigieren)', () => {
    // Soll = 14.40, Ist = 15.12 (+5 %) → nicht runterkorrigieren
    const pos = mkPos({ vk_netto_einheit: 15.12, gesamtpreis: 151.2 })
    const result = verifyAufschlaege(pos, baseSettings)
    expect(result.vk_netto_einheit).toBe(15.12)
    expect(result.gesamtpreis).toBe(151.2)
  })

  it('Innerhalb Toleranz (1.5 % zu niedrig) → unverändert', () => {
    // Soll 14.40, Ist 14.18 = -1.53 %  → ≤ 2 % Toleranz → keep
    const pos = mkPos({ vk_netto_einheit: 14.18 })
    const result = verifyAufschlaege(pos, baseSettings)
    expect(result.vk_netto_einheit).toBe(14.18)
  })

  it('6. aus_preisliste=true UND Spezial-Keyword → unverändert', () => {
    const pos = mkPos({
      aus_preisliste: true,
      leistungsname: 'Venezianischer Stuck',
      vk_netto_einheit: 5, // krass zu niedrig
    })
    const result = verifyAufschlaege(pos, baseSettings)
    expect(result.vk_netto_einheit).toBe(5)
  })

  it('aus_preisliste=true OHNE Spezial-Keyword → wird verifiziert', () => {
    const pos = mkPos({
      aus_preisliste: true,
      leistungsname: 'Wand spachteln Q3',
      vk_netto_einheit: 10, // zu niedrig
    })
    const result = verifyAufschlaege(pos, baseSettings)
    expect(result.vk_netto_einheit).toBe(14.4)
  })

  it('Fehlende lohnkosten_einheit → unverändert', () => {
    const pos = mkPos({ lohnkosten_einheit: null, vk_netto_einheit: 5 })
    const result = verifyAufschlaege(pos, baseSettings)
    expect(result.vk_netto_einheit).toBe(5)
  })

  it('Fehlende materialkosten_einheit → unverändert', () => {
    const pos = mkPos({ materialkosten_einheit: undefined, vk_netto_einheit: 5 })
    const result = verifyAufschlaege(pos, baseSettings)
    expect(result.vk_netto_einheit).toBe(5)
  })

  it('mat=0 UND lohn=0 → unverändert', () => {
    const pos = mkPos({
      materialkosten_einheit: 0,
      lohnkosten_einheit: 0,
      vk_netto_einheit: 0,
    })
    const result = verifyAufschlaege(pos, baseSettings)
    expect(result.vk_netto_einheit).toBe(0)
  })

  it('Gewerk-Override greift in verifyAufschlaege', () => {
    const settings: KalkSettings = {
      ...baseSettings,
      aufschlagPerGewerk: { Maler: 25 },
    }
    // Soll mit 25 % = 15.00, Ist = 13.00 → korrigieren auf 15.00
    const pos = mkPos({ vk_netto_einheit: 13, gesamtpreis: 130 })
    const result = verifyAufschlaege(pos, settings, 'Maler')
    expect(result.vk_netto_einheit).toBe(15)
    expect(result.gesamtpreis).toBe(150)
    expect(result.aufschlag_prozent).toBe(25)
  })

  it('8a. Input-Position wird NICHT mutiert (Korrektur-Fall)', () => {
    const pos = mkPos({ vk_netto_einheit: 13.68, gesamtpreis: 136.8 })
    const snapshot = JSON.parse(JSON.stringify(pos))
    verifyAufschlaege(pos, baseSettings)
    expect(pos).toEqual(snapshot)
  })
})

// ── verifyAufschlaegeGewerke ────────────────────────────────────────────────
describe('verifyAufschlaegeGewerke', () => {
  it('7. Kompletter Durchlauf über 2 Gewerke mit gemischten Positionen', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [
          mkPos({
            leistungsnummer: '09-100',
            vk_netto_einheit: 13.68, // zu niedrig → korrigieren
            gesamtpreis: 136.8,
          }),
          mkPos({
            leistungsnummer: '09-101',
            vk_netto_einheit: 14.4, // passt
            gesamtpreis: 144,
          }),
        ],
      },
      {
        name: 'Abbruch',
        positionen: [
          mkPos({
            leistungsnummer: '02-200',
            vk_netto_einheit: 20, // zu hoch → unverändert
            gesamtpreis: 200,
          }),
        ],
      },
    ]

    const result = verifyAufschlaegeGewerke(gewerke, baseSettings)

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Maler')
    expect(result[0].positionen[0].vk_netto_einheit).toBe(14.4) // korrigiert
    expect(result[0].positionen[1].vk_netto_einheit).toBe(14.4) // unverändert
    expect(result[1].positionen[0].vk_netto_einheit).toBe(20)   // unverändert
  })

  it('Gewerk-Name wird als gewerk-Parameter durchgereicht (Pro-Gewerk-Override)', () => {
    const settings: KalkSettings = {
      ...baseSettings,
      aufschlagPerGewerk: { Maler: 25, Abbruch: 15 },
    }
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [mkPos({ vk_netto_einheit: 10, gesamtpreis: 100 })],
      },
      {
        name: 'Abbruch',
        positionen: [mkPos({ vk_netto_einheit: 10, gesamtpreis: 100 })],
      },
    ]
    const result = verifyAufschlaegeGewerke(gewerke, settings)

    // Maler: 3.25 + 8.75 = 12.00; *1.25 = 15.00
    expect(result[0].positionen[0].vk_netto_einheit).toBe(15)
    expect(result[0].positionen[0].aufschlag_prozent).toBe(25)
    // Abbruch: 3.25 + 8.75 = 12.00; *1.15 = 13.80
    expect(result[1].positionen[0].vk_netto_einheit).toBe(13.8)
    expect(result[1].positionen[0].aufschlag_prozent).toBe(15)
  })

  it('8b. Input-Gewerke-Array wird NICHT mutiert', () => {
    const gewerke: Gewerk[] = [
      {
        name: 'Maler',
        positionen: [mkPos({ vk_netto_einheit: 13.68, gesamtpreis: 136.8 })],
      },
    ]
    const snapshot = JSON.parse(JSON.stringify(gewerke))
    const result = verifyAufschlaegeGewerke(gewerke, baseSettings)

    // Input unverändert
    expect(gewerke).toEqual(snapshot)
    // Ergebnis ist ein NEUES Array, nicht dieselbe Referenz
    expect(result).not.toBe(gewerke)
    expect(result[0]).not.toBe(gewerke[0])
    expect(result[0].positionen).not.toBe(gewerke[0].positionen)
  })

  it('Leeres Positionen-Array → leeres Positionen-Array', () => {
    const gewerke: Gewerk[] = [{ name: 'Maler', positionen: [] }]
    const result = verifyAufschlaegeGewerke(gewerke, baseSettings)
    expect(result).toEqual([{ name: 'Maler', positionen: [] }])
  })
})
