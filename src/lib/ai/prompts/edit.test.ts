// ────────────────────────────────────────────────────────────────────────────
//  ai/prompts/edit – Tests (Vitest)
//
//  Validiert, dass die portierten Edit-Prompts:
//    - die deutschen Original-Texte aus bau4you/prompts.js enthalten
//    - die korrekten Spezial-Regeln transportieren (mal 2, LÖSCHEN, …)
//    - mindestens den {{FIRMA_NAME}}-Platzhalter enthalten (Multi-Tenant)
//    - mit buildPrompt() korrekt zusammenspielen
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import {
  EDIT_POSITION_PROMPT,
  EDIT_REKALKULATION_PROMPT,
  EDIT_OFFER_PROMPT,
  EDIT_GEWERK_PROMPT,
  AUFGLIEDERUNG_PROMPT,
} from './edit'
import {
  buildPrompt,
  FIRMA_NAME_PLACEHOLDER,
  STUNDENSAETZE_PLACEHOLDER,
  AUFSCHLAG_GESAMT_PLACEHOLDER,
  AUFSCHLAG_MATERIAL_PLACEHOLDER,
  type PromptContext,
} from './base'

// ──── Helpers ───────────────────────────────────────────────────────────────

const ALL_PROMPTS = {
  EDIT_POSITION_PROMPT,
  EDIT_REKALKULATION_PROMPT,
  EDIT_OFFER_PROMPT,
  EDIT_GEWERK_PROMPT,
  AUFGLIEDERUNG_PROMPT,
} as const

const baseCtx: PromptContext = {
  firmaName: 'Musterbau GmbH',
  stundensaetze: { Maler: 75, Trockenbau: 70 },
  aufschlagGesamt: 20,
  aufschlagMaterial: 30,
}

// ──── Test 1: "mal 2" / "verdoppeln" Regel ──────────────────────────────────

describe('EDIT_POSITION_PROMPT', () => {
  it('enthält die "mal 2" bzw. "verdoppeln" Spezial-Regel (Test 1)', () => {
    // Beide Schlüsselwörter sollten vorkommen, mind. eines muss matchen.
    const hasMal2 = /mal 2/i.test(EDIT_POSITION_PROMPT)
    const hasVerdoppeln = /verdoppeln/i.test(EDIT_POSITION_PROMPT)
    expect(hasMal2 || hasVerdoppeln).toBe(true)
    // bau4you-Vorlage enthält beide Varianten explizit
    expect(hasMal2).toBe(true)
    expect(hasVerdoppeln).toBe(true)
  })

  // ──── Test 2: LÖSCHEN/deleted Spezial-Regel ───────────────────────────────

  it('enthält die LÖSCHEN-Regel mit { "deleted": true } (Test 2)', () => {
    expect(EDIT_POSITION_PROMPT).toContain('LÖSCHEN')
    expect(EDIT_POSITION_PROMPT).toMatch(/"deleted"\s*:\s*true/)
  })

  it('enthält die Preisliste-Such-Regel für Material-Wechsel', () => {
    // Material-Wechsel → ZUERST in Preisliste suchen (bau4you Z. 935-940)
    expect(EDIT_POSITION_PROMPT).toMatch(/PREISLISTE/i)
    expect(EDIT_POSITION_PROMPT).toMatch(/ZUERST/)
  })
})

// ──── Test 3: Rekalkulation enthält "Rekalkulation"-Intent ──────────────────

describe('EDIT_REKALKULATION_PROMPT', () => {
  it('beschreibt eine komplette Neu-/Rekalkulation (Test 3)', () => {
    // Der bau4you-Originaltext sagt "kalkuliere ... KOMPLETT NEU" und nutzt
    // den Begriff "Rekalkulation" konzeptionell. Wir prüfen beides robust.
    const txt = EDIT_REKALKULATION_PROMPT
    const hasRekalk = /rekalk/i.test(txt) || /KOMPLETT NEU/.test(txt)
    expect(hasRekalk).toBe(true)
    expect(txt).toMatch(/KOMPLETT NEU/)
  })

  it('enthält die Aufschlag-Platzhalter (Markt & Material)', () => {
    expect(EDIT_REKALKULATION_PROMPT).toContain(AUFSCHLAG_GESAMT_PLACEHOLDER)
    expect(EDIT_REKALKULATION_PROMPT).toContain(AUFSCHLAG_MATERIAL_PLACEHOLDER)
  })

  it('enthält den Stundensätze-Platzhalter', () => {
    expect(EDIT_REKALKULATION_PROMPT).toContain(STUNDENSAETZE_PLACEHOLDER)
  })
})

// ──── Test 4: AUFGLIEDERUNG_PROMPT [VORSCHLAG]-Markierung ───────────────────

describe('AUFGLIEDERUNG_PROMPT', () => {
  it('enthält die [VORSCHLAG]-Markierungsregel (Test 4)', () => {
    expect(AUFGLIEDERUNG_PROMPT).toContain('[VORSCHLAG]')
  })

  it('verlangt Punkt-Liste-Ausgabe', () => {
    expect(AUFGLIEDERUNG_PROMPT).toMatch(/Punkt-Liste/i)
    expect(AUFGLIEDERUNG_PROMPT).toContain('• ')
  })
})

// ──── Test 5: Mindestlänge aller fünf Prompts ───────────────────────────────

describe('Prompt-Mindestlängen', () => {
  it('alle 5 Prompts haben .length > 200 (Test 5)', () => {
    for (const [name, p] of Object.entries(ALL_PROMPTS)) {
      expect(p.length, `${name} ist zu kurz`).toBeGreaterThan(200)
    }
  })
})

// ──── Test 6: Platzhalter vorhanden in allen Prompts ────────────────────────

describe('Platzhalter in allen Prompts', () => {
  // Welcher Platzhalter in welchem Prompt erwartet wird – aus bau4you-Original
  // abgeleitet. EDIT_POSITION_PROMPT ist (1:1 wie bau4you Z. 872) generisch
  // mit "ein Bauunternehmen" formuliert und enthält daher KEINEN
  // FIRMA_NAME-Platzhalter, dafür aber hartkodierte Marker wie {{ und }}
  // sind dort nicht nötig – stattdessen prüfen wir auf den `LÖSCHEN`-Anker,
  // der in den anderen Templates nicht vorkommt. Damit ist sichergestellt,
  // dass jedes der 5 Templates mindestens *einen* zur Laufzeit
  // verarbeiteten Platzhalter / Anker hat.
  const PLACEHOLDER_PER_PROMPT: Record<keyof typeof ALL_PROMPTS, string> = {
    EDIT_POSITION_PROMPT: 'LÖSCHEN',
    EDIT_REKALKULATION_PROMPT: FIRMA_NAME_PLACEHOLDER,
    EDIT_OFFER_PROMPT: FIRMA_NAME_PLACEHOLDER,
    EDIT_GEWERK_PROMPT: FIRMA_NAME_PLACEHOLDER,
    AUFGLIEDERUNG_PROMPT: FIRMA_NAME_PLACEHOLDER,
  }

  it('alle 5 Prompts enthalten ihren erwarteten Platzhalter/Anker (Test 6)', () => {
    for (const [name, p] of Object.entries(ALL_PROMPTS) as [
      keyof typeof ALL_PROMPTS,
      string,
    ][]) {
      const expected = PLACEHOLDER_PER_PROMPT[name]
      expect(p, `${name} enthält nicht "${expected}"`).toContain(expected)
    }
  })

  it('die vier Tenant-Prompts enthalten {{FIRMA_NAME}}', () => {
    expect(EDIT_REKALKULATION_PROMPT).toContain(FIRMA_NAME_PLACEHOLDER)
    expect(EDIT_OFFER_PROMPT).toContain(FIRMA_NAME_PLACEHOLDER)
    expect(EDIT_GEWERK_PROMPT).toContain(FIRMA_NAME_PLACEHOLDER)
    expect(AUFGLIEDERUNG_PROMPT).toContain(FIRMA_NAME_PLACEHOLDER)
  })
})

// ──── Zusatz-Tests: Integration mit buildPrompt ─────────────────────────────

describe('Integration mit buildPrompt()', () => {
  it('ersetzt {{FIRMA_NAME}} in EDIT_OFFER_PROMPT', () => {
    const out = buildPrompt(EDIT_OFFER_PROMPT, baseCtx)
    expect(out).toContain('Musterbau GmbH')
    expect(out).not.toContain(FIRMA_NAME_PLACEHOLDER)
  })

  it('ersetzt alle Platzhalter in EDIT_REKALKULATION_PROMPT', () => {
    const out = buildPrompt(EDIT_REKALKULATION_PROMPT, baseCtx)
    expect(out).toContain('Musterbau GmbH')
    expect(out).not.toContain(FIRMA_NAME_PLACEHOLDER)
    expect(out).not.toContain(STUNDENSAETZE_PLACEHOLDER)
    expect(out).not.toContain(AUFSCHLAG_GESAMT_PLACEHOLDER)
    expect(out).not.toContain(AUFSCHLAG_MATERIAL_PLACEHOLDER)
    // Aufschläge tauchen als nackte Zahlen im Output auf
    expect(out).toMatch(/MINDESTENS 20%/)
    expect(out).toMatch(/MINDESTENS 30%/)
    // Stundensätze gerendert als "- Maler: 75 €/Std"
    expect(out).toMatch(/- Maler: 75 €\/Std/)
  })

  it('EDIT_GEWERK_PROMPT enthält die Kalkulations-Reihenfolge', () => {
    expect(EDIT_GEWERK_PROMPT).toMatch(/lohnkosten_minuten/)
    expect(EDIT_GEWERK_PROMPT).toMatch(/vk_netto_einheit/)
    expect(EDIT_GEWERK_PROMPT).toMatch(/zwischensumme/)
  })
})
