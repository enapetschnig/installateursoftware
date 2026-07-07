// ────────────────────────────────────────────────────────────────────────────
//  ai/prompts/modus1 – Tests (Vitest)
//
//  Validiert den portierten Modus-1-Prompt (Einzelposition-Nachkalkulation)
//  inkl. Multi-Tenant-Platzhalter, 9-Schritt-Kalkulation, Sprach-Beispielen
//  und Spezialfällen (Regiestunden, Wasserschaden, Abbruch-Splitting).
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import { MODUS_1_PROMPT, MODUS_1_PROMPT_DESCRIPTION } from './modus1'
import {
  buildPrompt,
  STUNDENSAETZE_PLACEHOLDER,
  AUFSCHLAG_GESAMT_PLACEHOLDER,
  AUFSCHLAG_MATERIAL_PLACEHOLDER,
  FIRMA_NAME_PLACEHOLDER,
  type PromptContext,
} from './base'

// ──── Pflicht-Tests (Aufgabenstellung) ──────────────────────────────────────

describe('MODUS_1_PROMPT – Platzhalter', () => {
  it('Test 1: enthält {{STUNDENSAETZE}} Platzhalter', () => {
    expect(MODUS_1_PROMPT).toContain(STUNDENSAETZE_PLACEHOLDER)
    expect(MODUS_1_PROMPT).toContain('{{STUNDENSAETZE}}')
  })

  it('Test 2: enthält {{FIRMA_NAME}} Platzhalter', () => {
    expect(MODUS_1_PROMPT).toContain(FIRMA_NAME_PLACEHOLDER)
    expect(MODUS_1_PROMPT).toContain('{{FIRMA_NAME}}')
    // Sicherstellen, dass der hartcodierte bau4you-Firmenname NICHT mehr
    // im Prompt steckt (Multi-Tenant-Anforderung).
    expect(MODUS_1_PROMPT).not.toContain('BAU4YOU Baranowski Bau GmbH Wien')
  })

  it('Test 3: enthält Sprach→Nummer-Beispiel ("neun null null eins")', () => {
    expect(MODUS_1_PROMPT).toContain('neun null null eins')
    // Auch das zweite Beispiel ist 1:1 übernommen worden.
    expect(MODUS_1_PROMPT).toContain('null zwei einhundert')
  })

  it('Test 4: ist ausführlich (length > 2000)', () => {
    expect(MODUS_1_PROMPT.length).toBeGreaterThan(2000)
  })
})

// ──── Inhaltliche Tests (Spezifika 1:1 aus bau4you) ─────────────────────────

describe('MODUS_1_PROMPT – Inhalt 1:1 aus bau4you portiert', () => {
  it('enthält {{AUFSCHLAG_GESAMT}} und {{AUFSCHLAG_MATERIAL}} Platzhalter', () => {
    expect(MODUS_1_PROMPT).toContain(AUFSCHLAG_GESAMT_PLACEHOLDER)
    expect(MODUS_1_PROMPT).toContain(AUFSCHLAG_MATERIAL_PLACEHOLDER)
  })

  it('enthält die 9 Kalkulationsschritte (Schritt 1 bis 9)', () => {
    expect(MODUS_1_PROMPT).toContain('KALKULATION (strikt in dieser Reihenfolge)')
    // Alle 9 Schritte vorhanden
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(MODUS_1_PROMPT).toContain(`${n}.`)
    }
    expect(MODUS_1_PROMPT).toContain('materialkosten_basis')
    expect(MODUS_1_PROMPT).toContain('lohnanteil_prozent = 100 − materialanteil_prozent')
  })

  it('behält "Höchster Wiener Marktpreis"-Anweisung (Phase 1: KI schätzt ohne Web-Search)', () => {
    expect(MODUS_1_PROMPT).toContain('HÖCHSTER Wiener Marktpreis')
    expect(MODUS_1_PROMPT).toContain('NIEMALS Durchschnitt')
  })

  it('behält Abbruch-Stundensatz-Splitting: Folgearbeiten → BAUMEISTER', () => {
    expect(MODUS_1_PROMPT).toContain('STUNDENSATZ BEI GEWERK 02 (ABBRUCH)')
    expect(MODUS_1_PROMPT).toContain('BAUMEISTER-Stundensatz (07-997/998/999)')
    expect(MODUS_1_PROMPT).toContain('gewichteter Stundensatz')
  })

  it('behält Regiestunden-Format XX-997/-998 + XX-999 Material-Position', () => {
    expect(MODUS_1_PROMPT).toContain('REGIESTUNDEN')
    expect(MODUS_1_PROMPT).toContain('XX-997 ODER XX-998')
    expect(MODUS_1_PROMPT).toContain('XX-999')
  })

  it('behält Wasserschaden-Spezialpositionen 09-400/401/402/403/410', () => {
    expect(MODUS_1_PROMPT).toContain('WASSERSCHADEN')
    expect(MODUS_1_PROMPT).toContain('09-400')
    expect(MODUS_1_PROMPT).toContain('09-401')
    expect(MODUS_1_PROMPT).toContain('09-402')
    expect(MODUS_1_PROMPT).toContain('09-403')
    expect(MODUS_1_PROMPT).toContain('09-410')
  })

  it('behält Fachbegriffe (Dippelbaumdecke, Liapor, Schwarzdeckung)', () => {
    expect(MODUS_1_PROMPT).toContain('Dippelbaumdecke')
    expect(MODUS_1_PROMPT).toContain('Liapor')
    expect(MODUS_1_PROMPT).toContain('Schwarzdeckung')
    expect(MODUS_1_PROMPT).toContain('ÖNORM B 3661')
  })

  it('behält Langtext-Stufen 1, 2 und 3', () => {
    expect(MODUS_1_PROMPT).toContain('LANGTEXT-STUFE')
    expect(MODUS_1_PROMPT).toContain('Stufe 1')
    expect(MODUS_1_PROMPT).toContain('Stufe 2')
    expect(MODUS_1_PROMPT).toContain('Stufe 3')
  })

  it('behält Ausgabe-Regel: EXAKT EIN JSON-Objekt', () => {
    expect(MODUS_1_PROMPT).toContain('EXAKT EINEM JSON-Objekt')
    expect(MODUS_1_PROMPT).toContain('NIEMALS mehrere Positionen')
  })

  it('enthält Gewerk-Liste 01..16', () => {
    expect(MODUS_1_PROMPT).toContain('01 Gemeinkosten')
    expect(MODUS_1_PROMPT).toContain('02 Abbruch')
    expect(MODUS_1_PROMPT).toContain('07 Baumeister')
    expect(MODUS_1_PROMPT).toContain('09 Maler')
    expect(MODUS_1_PROMPT).toContain('13 Reinigung')
    expect(MODUS_1_PROMPT).toContain('16 Elektrozuleitung')
  })
})

// ──── Integration mit buildPrompt() ─────────────────────────────────────────

describe('MODUS_1_PROMPT – Zusammenspiel mit buildPrompt()', () => {
  const ctx: PromptContext = {
    firmaName: 'Test-Bau GmbH',
    stundensaetze: { Maler: 75, Baumeister: 80 },
    aufschlagGesamt: 20,
    aufschlagMaterial: 30,
  }

  it('buildPrompt ersetzt alle Platzhalter im Modus-1-Prompt', () => {
    const out = buildPrompt(MODUS_1_PROMPT, ctx)
    expect(out).not.toContain('{{FIRMA_NAME}}')
    expect(out).not.toContain('{{STUNDENSAETZE}}')
    expect(out).not.toContain('{{AUFSCHLAG_GESAMT}}')
    expect(out).not.toContain('{{AUFSCHLAG_MATERIAL}}')
    expect(out).toContain('Test-Bau GmbH')
    expect(out).toContain('Maler: 75 €/Std')
    expect(out).toContain('Baumeister: 80 €/Std')
    expect(out).toContain('× (1 + 30/100)')
    expect(out).toContain('× (1 + 20/100)')
  })

  it('buildPrompt mutiert MODUS_1_PROMPT nicht (Pure Function)', () => {
    const snapshot = MODUS_1_PROMPT
    buildPrompt(MODUS_1_PROMPT, ctx)
    expect(MODUS_1_PROMPT).toBe(snapshot)
  })
})

// ──── Description-Export ────────────────────────────────────────────────────

describe('MODUS_1_PROMPT_DESCRIPTION', () => {
  it('ist eine nicht-leere kurze Beschreibung', () => {
    expect(typeof MODUS_1_PROMPT_DESCRIPTION).toBe('string')
    expect(MODUS_1_PROMPT_DESCRIPTION.length).toBeGreaterThan(20)
    expect(MODUS_1_PROMPT_DESCRIPTION.length).toBeLessThan(500)
  })
})
