// ────────────────────────────────────────────────────────────────────────────
//  Tests für sortPositionen.ts
//
//  Validiert Verhaltens-Identität gegen bau4you/claude.js (Z. 174-300).
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { sortGewerkeAndPositionen, tokenizeForMatch } from './sortPositionen'
import type { Gewerk, Position } from './types'

// ── Helper ──────────────────────────────────────────────────────────────

function mkPos(nr: string, name: string, ausPreisliste = true, extra: Partial<Position> = {}): Position {
  return {
    leistungsnummer: nr,
    leistungsname: name,
    aus_preisliste: ausPreisliste,
    ...extra,
  }
}

function mkG(name: string, positionen: Position[] = []): Gewerk {
  return { name, positionen }
}

function gewerkNames(gs: Gewerk[]): string[] {
  return gs.map(g => g.name)
}

function nummern(g: Gewerk): string[] {
  return g.positionen.map(p => String(p.leistungsnummer))
}

// ── Tokenize ────────────────────────────────────────────────────────────

describe('tokenizeForMatch', () => {
  it('produziert Stems für lange Wörter, Stopp-Wörter raus', () => {
    expect(tokenizeForMatch('Wand spachteln und schleifen')).toEqual(['wand', 'spac', 'schl'])
  })

  it('behandelt Sonderzeichen + Zahlen als Trenner', () => {
    // "Putzgrund" → "putz", "Tiefgrund" → "tief", "2x" → "x"
    // (Zahlen werden als Trenner behandelt, kurze Tokens bleiben unverändert.)
    expect(tokenizeForMatch('Putzgrund / Tiefgrund 2x')).toEqual(['putz', 'tief', 'x'])
  })

  it('lower-cases Eingaben', () => {
    expect(tokenizeForMatch('Maler-Arbeiten')).toEqual(['male', 'arbe'])
  })

  it('leerer String → leeres Array', () => {
    expect(tokenizeForMatch('')).toEqual([])
  })

  it('Stopp-Wörter werden vollständig entfernt', () => {
    expect(tokenizeForMatch('und der die das in im')).toEqual([])
  })
})

// ── Gewerk-Reihenfolge ──────────────────────────────────────────────────

describe('sortGewerkeAndPositionen — Gewerk-Reihenfolge', () => {
  it('sortiert ["Reinigung", "Maler", "Abbruch"] → ["Abbruch", "Maler", "Reinigung"]', () => {
    const input = [mkG('Reinigung'), mkG('Maler'), mkG('Abbruch')]
    const out = sortGewerkeAndPositionen(input)
    expect(gewerkNames(out)).toEqual(['Abbruch', 'Maler', 'Reinigung'])
  })

  it('unbekannte Gewerke landen am Ende — aber vor Reinigung', () => {
    const input = [
      mkG('Reinigung'),
      mkG('Foobar'),       // unbekannt
      mkG('Maler'),
      mkG('Abbruch'),
    ]
    const out = sortGewerkeAndPositionen(input)
    expect(gewerkNames(out)).toEqual(['Abbruch', 'Maler', 'Foobar', 'Reinigung'])
  })

  it('mehrere unbekannte Gewerke behalten ihre Eingangs-Reihenfolge (stable)', () => {
    const input = [
      mkG('Reinigung'),
      mkG('Z-Unknown'),
      mkG('A-Unknown'),
      mkG('Maler'),
    ]
    const out = sortGewerkeAndPositionen(input)
    expect(gewerkNames(out)).toEqual(['Maler', 'Z-Unknown', 'A-Unknown', 'Reinigung'])
  })

  it('"Reinigung" Variante mit Groß/Klein-Mischung → erkannt und ans Ende', () => {
    const input = [mkG('reinigung'), mkG('Maler')]
    const out = sortGewerkeAndPositionen(input)
    expect(gewerkNames(out)).toEqual(['Maler', 'reinigung'])
  })
})

// ── Positions-Reihenfolge ───────────────────────────────────────────────

describe('sortGewerkeAndPositionen — Positionen pro Gewerk', () => {
  it('Header (09-000) zuerst', () => {
    const g = mkG('Maler', [
      mkPos('09-100', 'Vollflächig spachteln'),
      mkPos('09-000', 'Maler-Header'),
      mkPos('09-005', 'Grundieren'),
    ])
    const out = sortGewerkeAndPositionen([g])
    expect(nummern(out[0])).toEqual(['09-000', '09-005', '09-100'])
  })

  it('Katalog-Positionen aufsteigend: 09-005 vor 09-010 vor 09-100', () => {
    const g = mkG('Maler', [
      mkPos('09-100', 'C'),
      mkPos('09-005', 'A'),
      mkPos('09-010', 'B'),
    ])
    const out = sortGewerkeAndPositionen([g])
    expect(nummern(out[0])).toEqual(['09-005', '09-010', '09-100'])
  })

  it('Spezial-Position (09-999) am Ende', () => {
    const g = mkG('Maler', [
      mkPos('09-999', 'Sonderwunsch'),
      mkPos('09-005', 'Grundieren'),
      mkPos('09-100', 'Spachteln'),
    ])
    const out = sortGewerkeAndPositionen([g])
    expect(nummern(out[0])).toEqual(['09-005', '09-100', '09-999'])
  })

  it('NEU-Pos wird nach Token-Match-Score gegen Katalog einsortiert', () => {
    const g = mkG('Maler', [
      mkPos('09-005', 'Grundieren', true),
      mkPos('09-100', 'Wand spachteln Q3', true),
      mkPos('09-NEU1', 'Wand spachteln und schleifen', false), // hoher Score gegen 09-100
    ])
    const out = sortGewerkeAndPositionen([g])
    // Katalog zuerst (in Nummern-Reihenfolge), dann KI dahinter (vor Spezial).
    expect(nummern(out[0])).toEqual(['09-005', '09-100', '09-NEU1'])
  })

  it('volles Beispiel: Header / Katalog / NEU / Spezial', () => {
    const g = mkG('Maler', [
      mkPos('09-999', 'Sonderwunsch', true),
      mkPos('09-NEU2', 'Tapete entfernen', false),
      mkPos('09-000', 'Header'),
      mkPos('09-010', 'Spachteln'),
      mkPos('09-005', 'Grundieren'),
    ])
    const out = sortGewerkeAndPositionen([g])
    expect(nummern(out[0])).toEqual(['09-000', '09-005', '09-010', '09-NEU2', '09-999'])
  })
})

// ── Regie + Material als Pärchen ────────────────────────────────────────

describe('sortGewerkeAndPositionen — Regie/Material-Pärchen', () => {
  it('Regie 03-998 + nachfolgendes Material 03-999 bleibt zusammen', () => {
    const g = mkG('Entrümpelung', [
      mkPos('03-998', 'Regiestunden Helfer'),
      mkPos('03-999', 'Material für Regiestunden'),
      mkPos('03-005', 'Container'),
    ])
    const out = sortGewerkeAndPositionen([g])
    // Regie+Material sortiert nach Regie-Suffix (998) – Material-Pärchen
    // bleibt direkt dahinter, ohne sich von 999 trennen zu lassen.
    expect(nummern(out[0])).toEqual(['03-005', '03-998', '03-999'])
  })

  it('Mehrfache Regie/Material-Pärchen bleiben getrennt erhalten', () => {
    const g = mkG('Maler', [
      mkPos('09-997', 'Regie Maler 1'),
      mkPos('09-999', 'Material für Regie 1'),
      mkPos('09-998', 'Regie Maler 2'),
      mkPos('09-999', 'Material für Regie 2'),
    ])
    const out = sortGewerkeAndPositionen([g])
    // Beide Pärchen bleiben benachbart — kein "alle 99x hintereinander"-Bug.
    expect(nummern(out[0])).toEqual(['09-997', '09-999', '09-998', '09-999'])
  })
})

// ── Immutability ────────────────────────────────────────────────────────

describe('sortGewerkeAndPositionen — Pure / Immutability', () => {
  it('Input-Array wird nicht mutiert', () => {
    const input: Gewerk[] = [
      mkG('Reinigung', [mkPos('13-100', 'Feinreinigung')]),
      mkG('Maler', [
        mkPos('09-100', 'X'),
        mkPos('09-005', 'A'),
      ]),
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    sortGewerkeAndPositionen(input)
    expect(input).toEqual(snapshot)
  })

  it('eingefrorenes Input-Array funktioniert (Object.freeze)', () => {
    const positionen = [
      Object.freeze(mkPos('09-100', 'X')),
      Object.freeze(mkPos('09-005', 'A')),
    ] as Position[]
    Object.freeze(positionen)
    const input = Object.freeze([Object.freeze({ name: 'Maler', positionen })]) as readonly Gewerk[]

    // Würde sortPositionen das Input-Array mutieren, würfe das einen TypeError.
    expect(() => sortGewerkeAndPositionen(input)).not.toThrow()
    const out = sortGewerkeAndPositionen(input)
    expect(nummern(out[0])).toEqual(['09-005', '09-100'])
  })

  it('liefert neue Gewerk-Objekte (kein Referenz-Sharing mit Input)', () => {
    const input = [mkG('Maler', [mkPos('09-005', 'A')])]
    const out = sortGewerkeAndPositionen(input)
    expect(out[0]).not.toBe(input[0])
    expect(out[0].positionen).not.toBe(input[0].positionen)
  })
})

// ── Edge Cases ──────────────────────────────────────────────────────────

describe('sortGewerkeAndPositionen — Edge Cases', () => {
  it('leeres Gewerke-Array → leeres Array', () => {
    expect(sortGewerkeAndPositionen([])).toEqual([])
  })

  it('Gewerk ohne Positionen → bleibt erhalten', () => {
    const out = sortGewerkeAndPositionen([mkG('Maler')])
    expect(out).toHaveLength(1)
    expect(out[0].positionen).toEqual([])
  })

  it('Position ohne leistungsnummer wird als KI/NEU behandelt', () => {
    const g = mkG('Maler', [
      mkPos('09-005', 'Grundieren'),
      { leistungsname: 'Irgendwas Freitext', aus_preisliste: false },
    ])
    const out = sortGewerkeAndPositionen([g])
    // Katalog zuerst, NEU danach.
    expect(out[0].positionen[0].leistungsnummer).toBe('09-005')
    expect(out[0].positionen[1].leistungsname).toBe('Irgendwas Freitext')
  })
})
