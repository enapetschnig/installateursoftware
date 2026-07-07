// ────────────────────────────────────────────────────────────────────────────
//  fixPositionKosten – Cent-Identitäts-Tests gegen bau4you-Behavior.
//  Quelle: bau4you/src/lib/claude.js Z. 1595-1660 (1:1 portiert).
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import type { Position } from './types'
import { fixPositionKosten } from './fixPositionKosten'

describe('fixPositionKosten', () => {
  it('Normalfall: berechnet Minuten + Lohn-Drift korrekt (mat=2.50, vk=13.50, ss=70 → vk=13.00)', () => {
    // 13.50 - 2.50 = 11.00 lohn → round(11/70*60)=9 min → (9/60)*70 = 10.50 lohn
    // → vk = 10.50 + 2.50 = 13.00 (kein SNAP weil Drift=0.50)
    const out = fixPositionKosten({
      materialkosten_einheit: 2.5,
      vk_netto_einheit: 13.5,
      stundensatz: 70,
      menge: 30,
    })
    expect(out.materialkosten_einheit).toBe(2.5)
    expect(out.vk_netto_einheit).toBe(13)
    expect(out.lohnkosten_einheit).toBe(10.5)
    expect(out.lohnkosten_minuten).toBe(9)
    expect(out.gesamtpreis).toBe(390) // 30 × 13.00
    expect(out.materialanteil_prozent).toBe(19.2)
    expect(out.lohnanteil_prozent).toBe(80.8)
    // Invariante: mat + lohn === vk
    expect(
      round2((out.materialkosten_einheit as number) + (out.lohnkosten_einheit as number)),
    ).toBe(out.vk_netto_einheit)
  })

  it('Material > 30 %: KEIN Cap auf dieser Ebene – durchlassen', () => {
    // 10 - 5 = 5 lohn → round(5/70*60)=4 min → (4/60)*70 = 4.67 lohn → vk=9.67
    const out = fixPositionKosten({
      materialkosten_einheit: 5,
      vk_netto_einheit: 10,
      stundensatz: 70,
      menge: 1,
    })
    expect(out.materialkosten_einheit).toBe(5)
    expect(out.vk_netto_einheit).toBe(9.67)
    expect(out.lohnkosten_einheit).toBe(4.67)
    expect(out.lohnkosten_minuten).toBe(4)
    expect(out.gesamtpreis).toBe(9.67)
    // Material-Anteil > 30 % wird hier NICHT zurückgekürzt
    expect(out.materialanteil_prozent).toBe(51.7)
    expect(out.lohnanteil_prozent).toBe(48.3)
  })

  it('stundensatz=0: Fallback auf pos.lohnkosten_minuten, lohn=lohnRaw', () => {
    const out = fixPositionKosten({
      materialkosten_einheit: 5,
      vk_netto_einheit: 20,
      stundensatz: 0,
      lohnkosten_minuten: 15,
      menge: 2,
    })
    // ohne Stundensatz: lohn = lohnRaw = 15.00, vk = 20.00 (unverändert), minuten = 15
    expect(out.lohnkosten_minuten).toBe(15)
    expect(out.lohnkosten_einheit).toBe(15)
    expect(out.vk_netto_einheit).toBe(20)
    expect(out.gesamtpreis).toBe(40)
    expect(out.materialanteil_prozent).toBe(25)
    expect(out.lohnanteil_prozent).toBe(75)
  })

  it('vk=0: alle Prozente = 0, kein NaN', () => {
    const out = fixPositionKosten({
      materialkosten_einheit: 0,
      vk_netto_einheit: 0,
      stundensatz: 70,
      menge: 1,
    })
    expect(out.vk_netto_einheit).toBe(0)
    expect(out.lohnkosten_einheit).toBe(0)
    expect(out.lohnkosten_minuten).toBe(0)
    expect(out.gesamtpreis).toBe(0)
    expect(out.materialanteil_prozent).toBe(0)
    expect(out.lohnanteil_prozent).toBe(0)
    expect(Number.isFinite(out.materialanteil_prozent as number)).toBe(true)
    expect(Number.isFinite(out.lohnanteil_prozent as number)).toBe(true)
  })

  it('deleted=true: gibt Input unverändert zurück (identisches Objekt)', () => {
    const input: Position = { deleted: true, vk_netto_einheit: 99, materialkosten_einheit: 5 }
    const out = fixPositionKosten(input)
    expect(out).toBe(input) // identische Referenz – kein Spread
  })

  it('SNAP-Logik: vkRaw=19 glatt + Drift < 0.05 → snap auf 19.00', () => {
    // vkRaw=19, ss=67, mat=0:
    //   lohnRaw=19 → minuten=round(19/67*60)=17 → lohn=(17/60)*67=18.98
    //   vkBerechnet=18.98 → Drift=|18.98-19|=0.02 < 0.05 → SNAP → vk=19.00
    const out = fixPositionKosten({
      materialkosten_einheit: 0,
      vk_netto_einheit: 19,
      stundensatz: 67,
      menge: 1,
    })
    expect(out.vk_netto_einheit).toBe(19)
    expect(out.lohnkosten_minuten).toBe(17)
    expect(out.lohnkosten_einheit).toBe(19) // vk - mat = 19 - 0
    expect(out.gesamtpreis).toBe(19)
  })

  it('SNAP-Logik mit Material: vkRaw=36 + Drift 0.02 → snap, lohn = 35.75', () => {
    // mat=0.25, vk=36, ss=67:
    //   lohnRaw=35.75 → minuten=round(35.75/67*60)=32 → lohn=(32/60)*67=35.7333→35.73
    //   vkBerechnet=35.98 → Drift=0.02 → SNAP → vk=36.00
    //   lohnFinal = 36 - 0.25 = 35.75
    const out = fixPositionKosten({
      materialkosten_einheit: 0.25,
      vk_netto_einheit: 36,
      stundensatz: 67,
      menge: 1,
    })
    expect(out.vk_netto_einheit).toBe(36)
    expect(out.lohnkosten_einheit).toBe(35.75)
    expect(out.materialkosten_einheit).toBe(0.25)
    // Invariante: mat + lohn = vk (Cent-Identität nach SNAP)
    expect(
      round2((out.materialkosten_einheit as number) + (out.lohnkosten_einheit as number)),
    ).toBe(out.vk_netto_einheit)
  })

  it('Input-Mutation: Object.freeze(Input) – Aufruf wirft NICHT und liefert neue Felder', () => {
    const input = Object.freeze<Position>({
      materialkosten_einheit: 2.5,
      vk_netto_einheit: 13.5,
      stundensatz: 70,
      menge: 30,
    })
    const out = fixPositionKosten(input)
    // Input unverändert
    expect(input.vk_netto_einheit).toBe(13.5)
    expect(input.materialkosten_einheit).toBe(2.5)
    // Output ist ein neues Objekt mit überschriebenen Feldern
    expect(out).not.toBe(input)
    expect(out.vk_netto_einheit).toBe(13)
    expect(out.lohnkosten_minuten).toBe(9)
  })

  it('Pass-Through: zusätzliche Felder (customField, leistungsnummer) bleiben erhalten', () => {
    const out = fixPositionKosten({
      materialkosten_einheit: 2.5,
      vk_netto_einheit: 13.5,
      stundensatz: 70,
      menge: 30,
      leistungsnummer: '09-100',
      leistungsname: 'Wand spachteln',
      einheit: 'm²',
      gewerk: 'Maler',
      customField: 'hello',
    } as Position)
    expect(out.leistungsnummer).toBe('09-100')
    expect(out.leistungsname).toBe('Wand spachteln')
    expect(out.einheit).toBe('m²')
    expect(out.gewerk).toBe('Maler')
    expect((out as Position).customField).toBe('hello')
  })

  it('menge=0: Fallback auf gerundeten Quell-gesamtpreis (bau4you-Verhalten)', () => {
    // Wenn menge nicht > 0, übernimmt fixPositionKosten den vorhandenen gesamtpreis (gerundet).
    const out = fixPositionKosten({
      materialkosten_einheit: 2.5,
      vk_netto_einheit: 13.5,
      stundensatz: 70,
      menge: 0,
      gesamtpreis: 42.0,
    })
    expect(out.gesamtpreis).toBe(42)
    expect(out.vk_netto_einheit).toBe(13) // einheit weiterhin korrigiert
    expect(out.lohnkosten_minuten).toBe(9)
  })

  it('Cent-Invariante: material + lohn === vk in allen Standard-Cases', () => {
    const cases: Position[] = [
      { materialkosten_einheit: 2.5, vk_netto_einheit: 13.5, stundensatz: 70, menge: 30 },
      { materialkosten_einheit: 5, vk_netto_einheit: 10, stundensatz: 70, menge: 1 },
      { materialkosten_einheit: 0.25, vk_netto_einheit: 36, stundensatz: 67, menge: 1 },
      { materialkosten_einheit: 0, vk_netto_einheit: 19, stundensatz: 67, menge: 1 },
      { materialkosten_einheit: 12.34, vk_netto_einheit: 99.99, stundensatz: 75, menge: 7.5 },
    ]
    for (const c of cases) {
      const out = fixPositionKosten(c)
      const sum = round2(
        (out.materialkosten_einheit as number) + (out.lohnkosten_einheit as number),
      )
      expect(sum).toBe(out.vk_netto_einheit)
      // Prozente summieren auf exakt 100 (oder beide 0 bei vk=0)
      if ((out.vk_netto_einheit as number) > 0) {
        const pct = round1(
          (out.materialanteil_prozent as number) + (out.lohnanteil_prozent as number),
        )
        expect(pct).toBe(100)
      }
    }
  })

  it('Guard: null/undefined/non-object → unverändert', () => {
    // @ts-expect-error – absichtlich invalide Eingabe
    expect(fixPositionKosten(null)).toBe(null)
    // @ts-expect-error
    expect(fixPositionKosten(undefined)).toBe(undefined)
    // @ts-expect-error
    expect(fixPositionKosten('string')).toBe('string')
  })
})

// Test-lokale Helpers (parallel zur Modul-Implementierung, damit die
// Invarianten-Checks ohne Re-Export auskommen).
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
