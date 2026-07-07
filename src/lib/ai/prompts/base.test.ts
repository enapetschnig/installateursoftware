// ────────────────────────────────────────────────────────────────────────────
//  ai/prompts/base – Tests (Vitest)
//
//  Validiert das Verhalten der portierten bau4you-Prompt-Helper:
//    - buildPrompt: Platzhalter-Ersetzung (Stundensätze, Aufschläge, Firma)
//    - buildCompactCatalog: kompaktes Token-effizientes Format
//    - buildFilteredCatalog: KEYWORD_MAP-Regex → relevante Präfixe
//    - GEWERK_KEYWORDS: deckt GEWERKE_REIHENFOLGE komplett ab
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import {
  buildPrompt,
  buildCompactCatalog,
  buildFilteredCatalog,
  GEWERK_KEYWORDS,
  FILTERED_CATALOG_MAX_ENTRIES,
  STUNDENSAETZE_PLACEHOLDER,
  AUFSCHLAG_GESAMT_PLACEHOLDER,
  AUFSCHLAG_MATERIAL_PLACEHOLDER,
  FIRMA_NAME_PLACEHOLDER,
  type PromptContext,
} from './base'
import { GEWERKE_REIHENFOLGE } from '../../calc/types'
import type { Catalog, CatalogPosition } from '../../calc/types'

// ──── Helpers ────────────────────────────────────────────────────────────────

const baseCtx: PromptContext = {
  firmaName: 'BAU4YOU Baranowski Bau GmbH',
  stundensaetze: { Maler: 75, Abbruch: 65 },
  aufschlagGesamt: 20,
  aufschlagMaterial: 30,
}

const catPos = (overrides: Partial<CatalogPosition>): CatalogPosition => ({
  leistungsnummer: '09-001',
  leistungsname: 'Wand spachteln Q3',
  beschreibung: 'Spachteln und Schleifen',
  einheit: 'm²',
  vk_netto_einheit: 12.5,
  gewerk: 'Maler',
  ...overrides,
})

// ──── buildPrompt ────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('ersetzt alle vier Platzhalter (Test 1)', () => {
    const tpl = [
      'Firma: ' + FIRMA_NAME_PLACEHOLDER,
      'Aufschlag gesamt: ' + AUFSCHLAG_GESAMT_PLACEHOLDER + '%',
      'Aufschlag material: ' + AUFSCHLAG_MATERIAL_PLACEHOLDER + '%',
      'Stundensätze:',
      STUNDENSAETZE_PLACEHOLDER,
    ].join('\n')

    const out = buildPrompt(tpl, baseCtx)

    expect(out).toContain('Firma: BAU4YOU Baranowski Bau GmbH')
    expect(out).toContain('Aufschlag gesamt: 20%')
    expect(out).toContain('Aufschlag material: 30%')
    expect(out).toContain('- Maler: 75 €/Std')
    expect(out).toContain('- Abbruch: 65 €/Std')

    // Keine Platzhalter mehr übrig
    expect(out).not.toContain('{{')
    expect(out).not.toContain('}}')
  })

  it('lässt Prompts ohne Platzhalter unverändert (Test 2)', () => {
    const tpl = 'Reiner Prompt ohne Platzhalter – nur Text.'
    expect(buildPrompt(tpl, baseCtx)).toBe(tpl)
  })

  it('rendert Hinweistext bei leerer Stundensätze-Map', () => {
    const ctx: PromptContext = { ...baseCtx, stundensaetze: {} }
    const out = buildPrompt('S: ' + STUNDENSAETZE_PLACEHOLDER, ctx)
    expect(out).toBe('S: (keine Regiestunden in Preisliste gefunden)')
  })

  it('ersetzt mehrfaches Vorkommen desselben Platzhalters (replaceAll-Verhalten)', () => {
    const tpl = `${FIRMA_NAME_PLACEHOLDER} – ${FIRMA_NAME_PLACEHOLDER} – ${FIRMA_NAME_PLACEHOLDER}`
    const out = buildPrompt(tpl, { ...baseCtx, firmaName: 'ACME GmbH' })
    expect(out).toBe('ACME GmbH – ACME GmbH – ACME GmbH')
  })

  it('Multi-Tenant: unterschiedliche firmaName-Werte produzieren unterschiedliche Prompts', () => {
    const tpl = 'Hallo, hier ist ' + FIRMA_NAME_PLACEHOLDER + '.'
    const a = buildPrompt(tpl, { ...baseCtx, firmaName: 'Firma A' })
    const b = buildPrompt(tpl, { ...baseCtx, firmaName: 'Firma B' })
    expect(a).toBe('Hallo, hier ist Firma A.')
    expect(b).toBe('Hallo, hier ist Firma B.')
    expect(a).not.toEqual(b)
  })
})

// ──── buildCompactCatalog ────────────────────────────────────────────────────

describe('buildCompactCatalog', () => {
  it('rendert 3 Positionen als 3 Zeilen + Header (Test 3)', () => {
    const cat: Catalog = {
      positionen: [
        catPos({ leistungsnummer: '09-001', leistungsname: 'A', vk_netto_einheit: 10 }),
        catPos({ leistungsnummer: '09-002', leistungsname: 'B', vk_netto_einheit: 20.5 }),
        catPos({ leistungsnummer: '13-100', leistungsname: 'C', vk_netto_einheit: 30 }),
      ],
    }
    const out = buildCompactCatalog(cat)
    const lines = out.split('\n')

    // Header + 3 Zeilen
    expect(lines.length).toBe(4)
    expect(lines[0]).toBe('Leistungsnummer | Kurztext | Einheit | VK-Netto | Beschreibung')
    expect(lines[1]).toContain('09-001 | A')
    expect(lines[1]).toContain('| 10.00')
    expect(lines[2]).toContain('09-002 | B')
    expect(lines[2]).toContain('| 20.50')
    expect(lines[3]).toContain('13-100 | C')
  })

  it('liefert Hinweistext bei leerem Katalog', () => {
    expect(buildCompactCatalog({ positionen: [] })).toBe('(keine Preisliste verfügbar)')
  })

  it('überspringt Positionen ohne leistungsnummer', () => {
    const cat: Catalog = {
      positionen: [
        catPos({ leistungsnummer: '09-001' }),
        catPos({ leistungsnummer: '' }),
        catPos({ leistungsnummer: '09-002' }),
      ],
    }
    const out = buildCompactCatalog(cat)
    const dataLines = out.split('\n').slice(1) // ohne Header
    expect(dataLines).toHaveLength(2)
  })

  it('quetscht mehrzeilige Beschreibung auf eine Zeile', () => {
    const cat: Catalog = {
      positionen: [
        catPos({
          leistungsnummer: '09-001',
          beschreibung: 'Zeile1\nZeile2\r\nZeile3',
        }),
      ],
    }
    const out = buildCompactCatalog(cat)
    expect(out.split('\n')).toHaveLength(2) // Header + 1 Datenzeile
    expect(out).toContain('Zeile1 Zeile2 Zeile3')
  })
})

// ──── buildFilteredCatalog ───────────────────────────────────────────────────

describe('buildFilteredCatalog', () => {
  // Bunter Katalog mit verschiedenen Gewerk-Präfixen
  const mixedCatalog = (): Catalog => ({
    positionen: [
      catPos({ leistungsnummer: '09-001', leistungsname: 'Wand spachteln' }),
      catPos({ leistungsnummer: '09-002', leistungsname: 'Decke streichen' }),
      catPos({ leistungsnummer: '09-003', leistungsname: 'Grundierung auftragen' }),
      catPos({ leistungsnummer: '10-001', leistungsname: 'Tapete entfernen' }),
      catPos({ leistungsnummer: '02-001', leistungsname: 'Abbruch Bauschutt' }),
      catPos({ leistungsnummer: '11-001', leistungsname: 'Fliesen verlegen' }),
      catPos({ leistungsnummer: '13-100', leistungsname: 'Endreinigung' }),
    ],
  })

  it('Eingabe "Wand spachteln" liefert nur Maler-Positionen (Präfix 09/10) (Test 4)', () => {
    const out = buildFilteredCatalog(mixedCatalog(), 'Wand spachteln')
    expect(out).toContain('09-001')
    expect(out).toContain('09-002')
    expect(out).toContain('09-003')
    expect(out).toContain('10-001')
    expect(out).not.toContain('02-001')
    expect(out).not.toContain('11-001')
    expect(out).not.toContain('13-100')
  })

  it('respektiert MAX_ENTRIES = 100 (Test 5)', () => {
    const positionen: CatalogPosition[] = []
    for (let i = 0; i < 250; i++) {
      const idx = String(i).padStart(3, '0')
      positionen.push(
        catPos({ leistungsnummer: `09-${idx}`, leistungsname: `Maler ${i}` })
      )
    }
    const out = buildFilteredCatalog({ positionen }, 'streichen')
    const lines = out.split('\n')
    // 1 Header + max FILTERED_CATALOG_MAX_ENTRIES Datenzeilen
    expect(lines.length).toBe(1 + FILTERED_CATALOG_MAX_ENTRIES)
    expect(FILTERED_CATALOG_MAX_ENTRIES).toBe(100)
  })

  it('Umlaut-Normalisierung: "Wände spachteln" funktioniert wie "Waende spachteln"', () => {
    const cat = mixedCatalog()
    const a = buildFilteredCatalog(cat, 'Wände spachteln')
    const b = buildFilteredCatalog(cat, 'Waende spachteln')
    expect(a).toBe(b)
  })

  it('Fallback bei unbekanntem Text: erste MAX_ENTRIES des Gesamtkatalogs', () => {
    const cat = mixedCatalog()
    const out = buildFilteredCatalog(cat, 'völlig zusammenhanglose Eingabe xyz')
    // Alle 7 Einträge enthalten
    expect(out).toContain('09-001')
    expect(out).toContain('02-001')
    expect(out).toContain('11-001')
    expect(out).toContain('13-100')
  })

  it('Fallback bei < 3 Treffern: gibt Gesamt-Katalog zurück', () => {
    // Katalog mit nur 1 Maler-Eintrag → Match < 3 → Fallback auf alle
    const cat: Catalog = {
      positionen: [
        catPos({ leistungsnummer: '09-001', leistungsname: 'Wand spachteln' }),
        catPos({ leistungsnummer: '02-001', leistungsname: 'Abbruch' }),
        catPos({ leistungsnummer: '11-001', leistungsname: 'Fliesen' }),
        catPos({ leistungsnummer: '13-100', leistungsname: 'Reinigung' }),
      ],
    }
    const out = buildFilteredCatalog(cat, 'streichen')
    // Auch nicht-Maler-Einträge müssen drin sein
    expect(out).toContain('02-001')
    expect(out).toContain('11-001')
  })

  it('liefert Hinweistext bei leerem Katalog', () => {
    expect(buildFilteredCatalog({ positionen: [] }, 'irgendwas')).toBe(
      '(keine Preisliste verfügbar)'
    )
  })
})

// ──── GEWERK_KEYWORDS ────────────────────────────────────────────────────────

describe('GEWERK_KEYWORDS', () => {
  it('deckt alle GEWERKE_REIHENFOLGE-Einträge ab (Test 6)', () => {
    const missing: string[] = []
    for (const gewerk of GEWERKE_REIHENFOLGE) {
      const key = gewerk.toLowerCase()
      if (!GEWERK_KEYWORDS[key] || GEWERK_KEYWORDS[key].length === 0) {
        missing.push(gewerk)
      }
    }
    expect(missing).toEqual([])
  })

  it('jedes Keyword-Array enthält ausschließlich lowercase-Strings', () => {
    for (const [key, kws] of Object.entries(GEWERK_KEYWORDS)) {
      expect(key).toBe(key.toLowerCase())
      for (const kw of kws) {
        expect(typeof kw).toBe('string')
        // Erlaube Umlaute, aber keine Großbuchstaben (A-Z).
        expect(/[A-Z]/.test(kw)).toBe(false)
      }
    }
  })
})
