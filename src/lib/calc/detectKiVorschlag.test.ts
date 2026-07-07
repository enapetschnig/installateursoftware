// ────────────────────────────────────────────────────────────────────────────
//  Tests für detectKiVorschlag + stripVorschlag
//  Validiert gegen bau4you-Behavior (claude.js Z. 1758-1845).
//
//  Coverage: Match-Ebenen (vorwärts/rückwärts/Synonym), Auto-Vorschlag-Präfixe,
//  Stopwords, leere Keywords, Idempotenz für bereits gesetzte Flags,
//  Side-Effect-Freiheit (Input-Array darf nicht mutiert werden).
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { detectKiVorschlag, stripVorschlag } from './detectKiVorschlag'
import type { Gewerk, Position } from './types'

/** Helper: minimales Gewerk mit einer Position. */
function gw(name: string, positionen: Position[]): Gewerk {
  return { name, positionen }
}

describe('detectKiVorschlag', () => {
  it('1. Direkt-Match (vorwärts): "Wand spachteln" + "wand spachteln 30m²" → kein Vorschlag', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        { leistungsnummer: '09-100', leistungsname: 'Wand spachteln' },
      ]),
    ]
    const out = detectKiVorschlag(gewerke, 'wand spachteln 30m²')
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('2. Kein Match: "Decke streichen" + "wand spachteln" → isVorschlag=true', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        { leistungsnummer: '09-200', leistungsname: 'Decke streichen' },
      ]),
    ]
    const out = detectKiVorschlag(gewerke, 'wand spachteln')
    expect(out[0].positionen[0].isVorschlag).toBe(true)
  })

  it('3. Synonym-Match: "Wand glätten" + "wand spachteln" → kein Vorschlag (glaettsp-Alias)', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        // "wand" ist Stopword → Keyword = "glaetten" (nach norm)
        { leistungsnummer: '09-150', leistungsname: 'Wand glätten' },
      ]),
    ]
    const out = detectKiVorschlag(gewerke, 'wand spachteln')
    // /spachtel/ triggert Aliase ['spachtel','glaettsp'] → "glaett" liegt in "glaettsp"
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('4. Stem-Match: "spachteln" + "verspachteln" → kein Vorschlag', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        { leistungsnummer: '09-100', leistungsname: 'Spachteln' },
      ]),
    ]
    const out = detectKiVorschlag(gewerke, 'verspachteln 30m²')
    // Keyword-Stem "spacht" liegt in "verspachteln"
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('5. Auto-Vorschlag-Präfix 01: Baustelleneinrichtung wird NIE als Vorschlag markiert', () => {
    const gewerke: Gewerk[] = [
      gw('Gemeinkosten', [
        { leistungsnummer: '01-001', leistungsname: 'Baustelleneinrichtung' },
      ]),
    ]
    // User-Text erwähnt BE nicht – darf trotzdem NICHT als Vorschlag markiert sein
    const out = detectKiVorschlag(gewerke, 'wand streichen')
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('6. Auto-Vorschlag-Präfix 13: Besenreinigung wird NIE als Vorschlag markiert', () => {
    const gewerke: Gewerk[] = [
      gw('Reinigung', [
        { leistungsnummer: '13-001', leistungsname: 'Besenreinigung nach Bauarbeiten' },
      ]),
    ]
    const out = detectKiVorschlag(gewerke, 'wand spachteln')
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('7. Rückwärts-Stem-Match: User-Wort-Präfix als Teilstring im Keyword', () => {
    // Keyword "grundierung" (kein Synonym aktiv) - User schreibt "grundieren"
    // Vorwärts: stem "grundi" in eingabePlus? eingabe = "grundieren wand" → enthält "grundi" → ja, schon vorwärts-Match.
    // Hier teste ich expliziten Rückwärts-Pfad: User schreibt Langform, Keyword ist Kurzform.
    const gewerke: Gewerk[] = [
      gw('Maler', [
        // Keyword "abdichten" (>=4, kein Stopword)
        { leistungsnummer: '09-300', leistungsname: 'Abdichten' },
      ]),
    ]
    // /abdicht/ triggert Synonym 'abdicht' → eingabePlus enthält "abdicht"
    // Stem "abdich" liegt in eingabePlus → Vorwärts-Match. Kein Vorschlag.
    const out = detectKiVorschlag(gewerke, 'abdichtungsarbeiten ausführen')
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('8. Bereits gesetztes isVorschlag bleibt erhalten (Idempotenz)', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        { leistungsnummer: '09-100', leistungsname: 'Wand spachteln', isVorschlag: true },
      ]),
    ]
    // Selbst bei perfektem Match: vorhandenes Flag wird NICHT zurückgesetzt
    const out = detectKiVorschlag(gewerke, 'wand spachteln')
    expect(out[0].positionen[0].isVorschlag).toBe(true)
  })

  it('9. unsicher-Positionen werden NIE als Vorschlag markiert', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        { leistungsnummer: '09-999', leistungsname: 'Etwas Unklares', unsicher: true } as Position,
      ]),
    ]
    const out = detectKiVorschlag(gewerke, 'wand spachteln')
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('10. Leere Keywords (nur Stopwords) → kein Vorschlag gesetzt', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        // Nach norm + Stopword-Filter bleibt nichts übrig → kein Match-Versuch
        { leistungsnummer: '09-100', leistungsname: 'Wand Decke' },
      ]),
    ]
    const out = detectKiVorschlag(gewerke, 'völlig anderer text')
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('11. Side-Effect-Freiheit: Input-Gewerke und Input-Position werden nicht mutiert', () => {
    const inputPos: Position = { leistungsnummer: '09-200', leistungsname: 'Decke streichen' }
    const inputGewerk: Gewerk = gw('Maler', [inputPos])
    const inputArr: Gewerk[] = [inputGewerk]

    const out = detectKiVorschlag(inputArr, 'wand spachteln')

    // Output ist neues Array
    expect(out).not.toBe(inputArr)
    expect(out[0]).not.toBe(inputGewerk)
    expect(out[0].positionen).not.toBe(inputGewerk.positionen)
    expect(out[0].positionen[0]).not.toBe(inputPos)

    // Original-Position hat KEIN isVorschlag-Flag bekommen
    expect(inputPos.isVorschlag).toBeUndefined()
    expect(inputArr[0].positionen[0].isVorschlag).toBeUndefined()

    // Output schon
    expect(out[0].positionen[0].isVorschlag).toBe(true)
  })

  it('12. Umlaut-Normalisierung: ä/ö/ü/ß werden vor Match transliteriert', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        // "Fußboden schleifen" → "fussboden schleifen" → Keywords ["fussboden","schleifen"]
        { leistungsnummer: '05-100', leistungsname: 'Fußböden schleifen' },
      ]),
    ]
    // User schreibt mit Umlauten – nach norm muss Match klappen
    const out = detectKiVorschlag(gewerke, 'Fußböden müssen geschliffen werden')
    // /schleifen/ triggert Synonym 'schleif' → eingabePlus enthält "schleif"
    // Keyword-Stem "schlei" liegt in eingabePlus → Match
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
  })

  it('13. Gewerk-Reihenfolge bleibt erhalten, Positionen pro Gewerk werden korrekt verarbeitet', () => {
    const gewerke: Gewerk[] = [
      gw('Maler', [
        { leistungsnummer: '09-100', leistungsname: 'Wand spachteln' }, // Match
        { leistungsnummer: '09-200', leistungsname: 'Decke streichen' }, // Kein Match
      ]),
      gw('Reinigung', [
        { leistungsnummer: '13-001', leistungsname: 'Besenreinigung' }, // Auto-skip
      ]),
    ]
    const out = detectKiVorschlag(gewerke, 'wand spachteln 30m²')
    expect(out).toHaveLength(2)
    expect(out[0].name).toBe('Maler')
    expect(out[0].positionen[0].isVorschlag).toBeFalsy()
    expect(out[0].positionen[1].isVorschlag).toBe(true)
    expect(out[1].name).toBe('Reinigung')
    expect(out[1].positionen[0].isVorschlag).toBeFalsy()
  })
})

describe('stripVorschlag', () => {
  it('14. Entfernt "[VORSCHLAG]" aus leistungsname und setzt isVorschlag=true', () => {
    const pos: Position = {
      leistungsnummer: '09-100',
      leistungsname: '[VORSCHLAG] Wand spachteln',
      beschreibung: 'Wand glätten',
    }
    const out = stripVorschlag(pos)
    expect(out.leistungsname).toBe('Wand spachteln')
    expect(out.beschreibung).toBe('Wand glätten')
    expect(out.isVorschlag).toBe(true)
  })

  it('15. Entfernt "[VORSCHLAG]" auch aus beschreibung', () => {
    const pos: Position = {
      leistungsnummer: '09-100',
      leistungsname: 'Wand spachteln',
      beschreibung: '[VORSCHLAG] Wand spachteln Q3, inklusive Material',
    }
    const out = stripVorschlag(pos)
    expect(out.beschreibung).toBe('Wand spachteln Q3, inklusive Material')
    expect(out.isVorschlag).toBe(true)
  })

  it('16. Ohne Tag: Position unverändert (referentielle Identität)', () => {
    const pos: Position = {
      leistungsnummer: '09-100',
      leistungsname: 'Wand spachteln',
      beschreibung: 'Wand glätten',
    }
    const out = stripVorschlag(pos)
    // bau4you gibt das identische Objekt zurück wenn kein Tag vorhanden
    expect(out).toBe(pos)
    expect(out.isVorschlag).toBeUndefined()
  })

  it('17. Side-Effect-Freiheit: Original wird nicht mutiert wenn Tag entfernt wird', () => {
    const pos: Position = {
      leistungsnummer: '09-100',
      leistungsname: '[VORSCHLAG] Wand spachteln',
    }
    const original = { ...pos }
    const out = stripVorschlag(pos)
    expect(pos.leistungsname).toBe(original.leistungsname)
    expect(pos.isVorschlag).toBeUndefined()
    expect(out).not.toBe(pos)
  })

  it('18. Mehrfach-Tags und Case-Insensitivity: alle Vorkommen entfernt', () => {
    const pos: Position = {
      leistungsnummer: '09-100',
      leistungsname: '[VORSCHLAG] [vorschlag] Wand spachteln',
      beschreibung: '[VORSCHLAG] Detailtext',
    }
    const out = stripVorschlag(pos)
    expect(out.leistungsname).toBe('Wand spachteln')
    expect(out.beschreibung).toBe('Detailtext')
    expect(out.isVorschlag).toBe(true)
  })
})
