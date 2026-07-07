// ────────────────────────────────────────────────────────────────────────────
//  zimmer.test.ts – Tests für Raum-Erkennung & Injection
//  Spiegelt Verhalten von bau4you/claude.js Z. 1850-2064.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import {
  textHasRoom,
  extractRoomsFromSegment,
  insertRoomIntoBeschreibung,
  fixSplitRoomReferences,
  injectZimmerbezeichnungen,
} from './zimmer'
import type { Gewerk, Position } from './types'

// ─────────────────────────────── Helpers ──────────────────────────────────

const pos = (overrides: Partial<Position>): Position => ({
  leistungsnummer: '09-100',
  leistungsname: 'Wand spachteln',
  beschreibung: '',
  einheit: 'm²',
  menge: 10,
  ...overrides,
})

const gewerk = (name: string, positionen: Position[]): Gewerk => ({
  name,
  positionen,
})

// ─────────────────────────────── Tests ────────────────────────────────────

describe('textHasRoom', () => {
  it('erkennt einen Raum im Text', () => {
    expect(textHasRoom('wand spachteln im Vorzimmer')).toBe(true)
  })

  it('false für Text ohne Raumangabe', () => {
    expect(textHasRoom('wand spachteln')).toBe(false)
  })

  it('erkennt Großschreibung & Komposita', () => {
    expect(textHasRoom('Decke streichen im Schlafzimmer')).toBe(true)
    expect(textHasRoom('Boden verlegen im Wohnzimmer')).toBe(true)
  })

  it('erkennt "in der gesamten Wohnung"', () => {
    expect(textHasRoom('Boden verlegen in der gesamten Wohnung')).toBe(true)
  })

  it('erkennt "Top 12"-Notation als Wohnung', () => {
    expect(textHasRoom('Streichen Top 12')).toBe(true)
  })

  it('null/undefined → false', () => {
    expect(textHasRoom(null)).toBe(false)
    expect(textHasRoom(undefined)).toBe(false)
    expect(textHasRoom('')).toBe(false)
  })
})

describe('extractRoomsFromSegment', () => {
  it('findet mehrere Räume in Reihenfolge', () => {
    expect(extractRoomsFromSegment('im Bad und WC')).toEqual(['bad', 'wc'])
  })

  it('leeres Array bei keinem Raum', () => {
    expect(extractRoomsFromSegment('wand streichen')).toEqual([])
  })

  it('dedupliziert wiederholte Räume', () => {
    const rooms = extractRoomsFromSegment('im Bad, dann nochmal im Bad')
    expect(rooms).toEqual(['bad'])
  })

  it('erkennt Komposita greedy (badezimmer vor bad)', () => {
    const rooms = extractRoomsFromSegment('im Badezimmer arbeiten')
    expect(rooms).toEqual(['badezimmer'])
  })

  it('null/undefined → []', () => {
    expect(extractRoomsFromSegment(null)).toEqual([])
    expect(extractRoomsFromSegment(undefined)).toEqual([])
  })
})

describe('insertRoomIntoBeschreibung', () => {
  it('fügt Raum als String hinzu', () => {
    const out = insertRoomIntoBeschreibung('Wand spachteln Q3', 'bad')
    expect(out.toLowerCase()).toContain('bad')
    expect(out).toContain('im Bad')
  })

  it('akzeptiert Array von Räumen', () => {
    const out = insertRoomIntoBeschreibung('Wand spachteln Q3', ['bad'])
    expect(out).toContain('im Bad')
  })

  it('verbindet mehrere Räume mit "und"', () => {
    const out = insertRoomIntoBeschreibung('Wand spachteln', ['bad', 'wc'])
    expect(out).toContain('im Bad und Wc')
  })

  it('unverändert wenn schon Raum drin', () => {
    const text = 'Wand spachteln im Bad, inklusive Material'
    expect(insertRoomIntoBeschreibung(text, 'wohnzimmer')).toBe(text)
  })

  it('setzt vor ", inklusive" ein', () => {
    const out = insertRoomIntoBeschreibung(
      'Wand spachteln Q3, inklusive Grundierung',
      'bad',
    )
    expect(out).toBe('Wand spachteln Q3 im Bad, inklusive Grundierung')
  })

  it('hängt an wenn kein Komma vorhanden', () => {
    const out = insertRoomIntoBeschreibung('Wand spachteln Q3.', 'bad')
    expect(out).toBe('Wand spachteln Q3 im Bad.')
  })

  it('leerer Text → unverändert', () => {
    expect(insertRoomIntoBeschreibung('', 'bad')).toBe('')
    expect(insertRoomIntoBeschreibung(null, 'bad')).toBe('')
  })
})

describe('fixSplitRoomReferences', () => {
  it('fasst getrennte Raumreferenzen zusammen', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({
          beschreibung: 'im Vorzimmer Wand im Bad',
        }),
      ]),
    ]
    const out = fixSplitRoomReferences(input)
    expect(out[0].positionen[0].beschreibung).toBe('im Vorzimmer und Bad Wand')
  })

  it('lässt Beschreibung mit nur einem Raum unverändert', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [pos({ beschreibung: 'Wand spachteln im Bad' })]),
    ]
    const out = fixSplitRoomReferences(input)
    expect(out[0].positionen[0].beschreibung).toBe('Wand spachteln im Bad')
  })

  it('leeres Array → leeres Array', () => {
    expect(fixSplitRoomReferences([])).toEqual([])
  })

  it('dedupliziert gleichen Raum in unterschiedlicher Form', () => {
    const input: Gewerk[] = [
      gewerk('Maler', [
        pos({ beschreibung: 'im Bad spachteln im Bad streichen' }),
      ]),
    ]
    const out = fixSplitRoomReferences(input)
    // Zwei Treffer auf "Bad" → einer wird zusammengeführt aber unique → 1 Raum
    // → keine 2 unique Räume → Funktion lässt den Text unverändert
    expect(out[0].positionen[0].beschreibung).toBe(
      'im Bad spachteln im Bad streichen',
    )
  })
})

describe('injectZimmerbezeichnungen', () => {
  it('weist Positionen Räumen via Segmente zu', () => {
    const gewerke: Gewerk[] = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-100',
          leistungsname: 'Wand spachteln',
          beschreibung: 'Wand spachteln Q3',
        }),
        pos({
          leistungsnummer: '09-200',
          leistungsname: 'Wand streichen',
          beschreibung: 'Wand streichen weiß',
        }),
      ]),
    ]
    const input = 'im Bad spachteln, nächste Position im WC streichen'
    const out = injectZimmerbezeichnungen(gewerke, input)
    const positionen = out[0].positionen
    expect(positionen[0].beschreibung).toContain('Bad')
    expect(positionen[1].beschreibung).toContain('Wc')
  })

  it('lässt Beschreibungen mit Raumangabe unverändert', () => {
    const gewerke: Gewerk[] = [
      gewerk('Maler', [
        pos({
          leistungsname: 'Wand spachteln',
          beschreibung: 'Wand spachteln im Wohnzimmer',
        }),
      ]),
    ]
    const out = injectZimmerbezeichnungen(gewerke, 'im Bad arbeiten')
    expect(out[0].positionen[0].beschreibung).toBe(
      'Wand spachteln im Wohnzimmer',
    )
  })

  it('skipt Baustelleneinrichtung (01-001/01-002)', () => {
    const gewerke: Gewerk[] = [
      gewerk('Gemeinkosten', [
        pos({
          leistungsnummer: '01-001',
          leistungsname: 'Baustelleneinrichtung',
          beschreibung: 'Antransport und Abtransport',
        }),
      ]),
    ]
    const out = injectZimmerbezeichnungen(gewerke, 'im Bad arbeiten')
    expect(out[0].positionen[0].beschreibung).toBe(
      'Antransport und Abtransport',
    )
  })

  it('skipt Header-Positionen (-000)', () => {
    const gewerke: Gewerk[] = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-000',
          leistungsname: 'Malerarbeiten',
          beschreibung: 'Malerarbeiten gesamt',
        }),
      ]),
    ]
    const out = injectZimmerbezeichnungen(gewerke, 'im Bad arbeiten')
    expect(out[0].positionen[0].beschreibung).toBe('Malerarbeiten gesamt')
  })

  it('skipt Material-für-Regie-Positionen', () => {
    const gewerke: Gewerk[] = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-991',
          leistungsname: 'Material für Regiestunden',
          beschreibung: 'Materialaufwand pauschal',
        }),
      ]),
    ]
    const out = injectZimmerbezeichnungen(gewerke, 'im Bad arbeiten')
    expect(out[0].positionen[0].beschreibung).toBe('Materialaufwand pauschal')
  })

  it('Fallback auf globale Räume wenn kein Keyword-Match', () => {
    const gewerke: Gewerk[] = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-100',
          leistungsname: 'Sonstige Leistung',
          beschreibung: 'Pauschale Leistung',
        }),
      ]),
    ]
    const out = injectZimmerbezeichnungen(gewerke, 'Arbeiten im Schlafzimmer')
    expect(out[0].positionen[0].beschreibung).toContain('Schlafzimmer')
  })

  it('leerer eingabeText → unverändert', () => {
    const gewerke: Gewerk[] = [
      gewerk('Maler', [pos({ beschreibung: 'Wand spachteln' })]),
    ]
    expect(injectZimmerbezeichnungen(gewerke, '')).toBe(gewerke)
    expect(injectZimmerbezeichnungen(gewerke, null)).toBe(gewerke)
  })

  it('carry-forward des letzten Raums in folgenden Segmenten', () => {
    const gewerke: Gewerk[] = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-100',
          leistungsname: 'Wand grundieren',
          beschreibung: 'Wand grundieren tief',
        }),
        pos({
          leistungsnummer: '09-200',
          leistungsname: 'Wand spachteln',
          beschreibung: 'Wand spachteln Q3',
        }),
      ]),
    ]
    // Zweites Segment hat keinen Raum → soll lastRoom (Bad) übernehmen
    const input = 'im Bad grundieren, weiters spachteln'
    const out = injectZimmerbezeichnungen(gewerke, input)
    expect((out[0].positionen[0].beschreibung ?? '').toLowerCase()).toContain('bad')
    expect((out[0].positionen[1].beschreibung ?? '').toLowerCase()).toContain('bad')
  })
})

describe('Immutability', () => {
  it('mutiert Input für injectZimmerbezeichnungen nicht', () => {
    const inputPos: Position = pos({
      leistungsnummer: '09-100',
      leistungsname: 'Wand spachteln',
      beschreibung: 'Wand spachteln Q3',
    })
    const inputGewerk: Gewerk = gewerk('Maler', [inputPos])
    const input: Gewerk[] = [inputGewerk]

    Object.freeze(inputPos)
    Object.freeze(inputGewerk)
    Object.freeze(inputGewerk.positionen)
    Object.freeze(input)

    expect(() =>
      injectZimmerbezeichnungen(input, 'im Bad spachteln'),
    ).not.toThrow()

    // Original-Beschreibung unverändert
    expect(inputPos.beschreibung).toBe('Wand spachteln Q3')
  })

  it('mutiert Input für fixSplitRoomReferences nicht', () => {
    const inputPos: Position = pos({
      beschreibung: 'im Vorzimmer Wand im Bad',
    })
    const inputGewerk: Gewerk = gewerk('Maler', [inputPos])
    const input: Gewerk[] = [inputGewerk]

    Object.freeze(inputPos)
    Object.freeze(inputGewerk)
    Object.freeze(inputGewerk.positionen)
    Object.freeze(input)

    expect(() => fixSplitRoomReferences(input)).not.toThrow()
    expect(inputPos.beschreibung).toBe('im Vorzimmer Wand im Bad')
  })
})
