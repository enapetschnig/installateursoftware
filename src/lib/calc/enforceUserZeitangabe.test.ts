import { describe, it, expect } from 'vitest'
import { enforceUserZeitangabe } from './enforceUserZeitangabe'
import type { Position, StundensaetzeMap } from './types'

describe('enforceUserZeitangabe', () => {
  it('1. überschreibt Lohn bei "Wand spachteln ca. 3 Stunden" mit menge=30 (Default 70€/h)', () => {
    const pos: Position = {
      leistungsname: 'Wand spachteln',
      menge: 30,
      materialkosten_einheit: 0,
      lohnkosten_einheit: 1.23,
      lohnkosten_minuten: 5,
      stundensatz: null,
      vk_netto_einheit: 1.23,
      gesamtpreis: 36.9,
    }
    const result = enforceUserZeitangabe(pos, 'Wand spachteln ca. 3 Stunden', {})

    // userStunden=3 → userMinuten=180, stundensatz=70
    // lohn = round2((180/60) * 70) = 210
    // mat=0, vk=210, gesamtpreis = 30 * 210 = 6300
    expect(result.lohnkosten_minuten).toBe(180)
    expect(result.stundensatz).toBe(70)
    expect(result.lohnkosten_einheit).toBe(210)
    expect(result.materialkosten_einheit).toBe(0)
    expect(result.vk_netto_einheit).toBe(210)
    expect(result.gesamtpreis).toBe(6300)
    expect(result.materialanteil_prozent).toBe(0)
    expect(result.lohnanteil_prozent).toBe(100)
    expect(result.material_capped).toBeUndefined()
  })

  it('2. erkennt "dauert ungefähr 2.5h" und "2,5h" (Komma & Punkt als Dezimal)', () => {
    const basePos: Position = {
      leistungsname: 'Test',
      menge: 1,
      materialkosten_einheit: 0,
      stundensatz: null,
    }

    // Punkt-Variante
    const r1 = enforceUserZeitangabe({ ...basePos }, 'das dauert ungefähr 2.5h', {})
    expect(r1.lohnkosten_minuten).toBe(150)
    expect(r1.stundensatz).toBe(70)
    expect(r1.lohnkosten_einheit).toBe(175) // (150/60) * 70

    // Komma-Variante
    const r2 = enforceUserZeitangabe({ ...basePos }, 'das dauert ungefähr 2,5h', {})
    expect(r2.lohnkosten_minuten).toBe(150)
    expect(r2.lohnkosten_einheit).toBe(175)
  })

  it('3. lässt Position unverändert wenn kein Stunden-Match', () => {
    const pos: Position = {
      leistungsname: 'Wand spachteln',
      menge: 30,
      materialkosten_einheit: 5,
      lohnkosten_einheit: 10,
      lohnkosten_minuten: 8,
      stundensatz: 65,
      vk_netto_einheit: 15,
      gesamtpreis: 450,
    }
    const snapshot = JSON.parse(JSON.stringify(pos))
    const result = enforceUserZeitangabe(pos, 'Bitte nur die Wand verputzen, keine Zeitangabe.', {})

    // Identitäts-Check: Position kommt unverändert zurück.
    expect(result).toBe(pos)
    // Side-Effect-Freiheit: Input nicht mutiert.
    expect(pos).toEqual(snapshot)
  })

  it('4. cappt Material auf 30% wenn Anteil zu hoch ist (material_capped=true)', () => {
    const pos: Position = {
      leistungsname: 'Premium-Material-Position',
      menge: 1,
      materialkosten_einheit: 100, // hoch
      stundensatz: null,
    }
    const result = enforceUserZeitangabe(pos, 'arbeitszeit ca. 2 stunden', {})

    // userMinuten=120, stundensatz=70, lohn = (120/60)*70 = 140
    // initial vk = 140 + 100 = 240, mat/vk = 100/240 ≈ 0.4167 > 0.30 → CAP
    // vk = 140 / 0.70 = 200, mat = 200 * 0.30 = 60
    // lohnkosten_einheit = vk - mat = 140
    expect(result.lohnkosten_minuten).toBe(120)
    expect(result.stundensatz).toBe(70)
    expect(result.materialkosten_einheit).toBe(60)
    expect(result.vk_netto_einheit).toBe(200)
    expect(result.lohnkosten_einheit).toBe(140)
    expect(result.gesamtpreis).toBe(200)
    expect(result.material_capped).toBe(true)
    expect(result.material_capped_original).toBe(100)
    expect(result.materialanteil_prozent).toBe(30)
    expect(result.lohnanteil_prozent).toBe(70)
  })

  it('5. cappt NICHT wenn Material ≤ 30% (kein material_capped Flag)', () => {
    const pos: Position = {
      leistungsname: 'Standard-Position',
      menge: 1,
      materialkosten_einheit: 30, // moderat
      stundensatz: null,
    }
    const result = enforceUserZeitangabe(pos, 'das dauert 2 stunden', {})

    // lohn = 140, mat = 30, vk = 170, ratio = 30/170 ≈ 0.176 < 0.30 → kein Cap
    expect(result.materialkosten_einheit).toBe(30)
    expect(result.vk_netto_einheit).toBe(170)
    expect(result.lohnkosten_einheit).toBe(140)
    expect(result.material_capped).toBeUndefined()
    expect(result.material_capped_original).toBeUndefined()
  })

  it('6. nutzt Fallback-Stundensatz aus stundensaetze[gewerk] (z. B. Maler=75)', () => {
    const pos: Position = {
      leistungsname: 'Wand streichen',
      menge: 1,
      gewerk: 'Maler',
      materialkosten_einheit: 0,
      stundensatz: null, // kein Pos-Override
    }
    const stundensaetze: StundensaetzeMap = { Maler: 75, Abbruch: 65 }
    const result = enforceUserZeitangabe(pos, 'ca. 2 stunden', stundensaetze)

    // stundensatz aus Map = 75 → lohn = (120/60)*75 = 150
    expect(result.stundensatz).toBe(75)
    expect(result.lohnkosten_einheit).toBe(150)
    expect(result.vk_netto_einheit).toBe(150)
  })

  it('7. fällt auf DEFAULT_STUNDENSATZ=70 zurück wenn Gewerk nicht in Map', () => {
    const pos: Position = {
      leistungsname: 'Sonder-Arbeit',
      menge: 1,
      gewerk: 'Unbekannt',
      materialkosten_einheit: 0,
      stundensatz: null,
    }
    const stundensaetze: StundensaetzeMap = { Maler: 75 }
    const result = enforceUserZeitangabe(pos, 'dauert 1 h', stundensaetze)

    // userStunden=1, userMinuten=60, kein Match in Map → 70
    expect(result.stundensatz).toBe(70)
    expect(result.lohnkosten_minuten).toBe(60)
    expect(result.lohnkosten_einheit).toBe(70)
  })

  it('8. lässt deleted=true Positionen unverändert (Guard)', () => {
    const pos: Position = {
      leistungsname: 'Gelöscht',
      menge: 5,
      deleted: true,
      lohnkosten_einheit: 1,
      vk_netto_einheit: 1,
    }
    const result = enforceUserZeitangabe(pos, 'das dauert 4 stunden', {})

    // Identity-Check: kommt unverändert zurück.
    expect(result).toBe(pos)
    expect(result.lohnkosten_einheit).toBe(1)
    expect(result.vk_netto_einheit).toBe(1)
  })

  it('9. mutiert das Input-Objekt NICHT (Side-Effect-Freiheit)', () => {
    const pos: Position = {
      leistungsname: 'Pure-Test',
      menge: 10,
      materialkosten_einheit: 5,
      lohnkosten_einheit: 8,
      lohnkosten_minuten: 7,
      stundensatz: 60,
      vk_netto_einheit: 13,
      gesamtpreis: 130,
    }
    const snapshot = JSON.parse(JSON.stringify(pos))
    const result = enforceUserZeitangabe(pos, 'arbeitszeit ca. 3h', {})

    // Original unverändert
    expect(pos).toEqual(snapshot)
    // Neues Objekt
    expect(result).not.toBe(pos)
    // Pos-stundensatz hat Vorrang vor Default
    expect(result.stundensatz).toBe(60)
    expect(result.lohnkosten_minuten).toBe(180)
    // lohn = (180/60)*60 = 180, mat=5, vk=185, ratio=5/185 ≈ 2.7% < 30%
    expect(result.lohnkosten_einheit).toBe(180)
    expect(result.vk_netto_einheit).toBe(185)
    expect(result.gesamtpreis).toBe(1850)
  })

  it('10. wirft 0 oder negative Stundenangaben aus (Guard userStunden > 0)', () => {
    const pos: Position = {
      leistungsname: 'Edge',
      menge: 1,
      materialkosten_einheit: 0,
      lohnkosten_einheit: 5,
      vk_netto_einheit: 5,
    }
    // "0 stunden" → userStunden=0 → early return
    const result = enforceUserZeitangabe(pos, 'das dauert 0 stunden', {})
    expect(result).toBe(pos)
  })
})
