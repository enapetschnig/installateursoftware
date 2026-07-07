// ────────────────────────────────────────────────────────────────────────────
//  ai/prompts/komplettangebot – Tests (Vitest)
//
//  Verifiziert dass die 1:1-Portierung von bau4you DEFAULT_PROMPT_2
//  alle wichtigen Phasen, Regeln und Platzhalter enthält und mit
//  buildPrompt() korrekt zusammenspielt.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import { KOMPLETT_ANGEBOT_PROMPT } from './komplettangebot'
import {
  buildPrompt,
  STUNDENSAETZE_PLACEHOLDER,
  AUFSCHLAG_GESAMT_PLACEHOLDER,
  AUFSCHLAG_MATERIAL_PLACEHOLDER,
  FIRMA_NAME_PLACEHOLDER,
  type PromptContext,
} from './base'

const ctx: PromptContext = {
  firmaName: 'BAU4YOU Baranowski Bau GmbH',
  stundensaetze: { Maler: 75, Abbruch: 65, Baumeister: 80 },
  aufschlagGesamt: 20,
  aufschlagMaterial: 30,
}

// ──── Test 1: Platzhalter vorhanden ─────────────────────────────────────────

describe('KOMPLETT_ANGEBOT_PROMPT – Platzhalter', () => {
  it('enthält alle vier Platzhalter (Test 1)', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain(STUNDENSAETZE_PLACEHOLDER)
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain(AUFSCHLAG_GESAMT_PLACEHOLDER)
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain(AUFSCHLAG_MATERIAL_PLACEHOLDER)
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain(FIRMA_NAME_PLACEHOLDER)
  })

  it('enthält die literalen Platzhalter-Strings {{X}}', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('{{STUNDENSAETZE}}')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('{{AUFSCHLAG_GESAMT}}')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('{{AUFSCHLAG_MATERIAL}}')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('{{FIRMA_NAME}}')
  })
})

// ──── Test 2: Abdeckarbeiten-Regeln ─────────────────────────────────────────

describe('KOMPLETT_ANGEBOT_PROMPT – Abdeckarbeiten', () => {
  it('enthält Abdeckarbeiten-Regeln mit allen vier Fällen (Test 2)', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('ABDECKARBEITEN')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('FALL 1')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('FALL 2')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('FALL 3')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('FALL 4')
    // Konkrete Inhalte aus der Original-Quelle
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('Generalsanierung')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('NUR Maler')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('NUR Abbruch')
  })
})

// ──── Test 3: Mengen-Hinweise / Räume ───────────────────────────────────────

describe('KOMPLETT_ANGEBOT_PROMPT – Mengenberechnung', () => {
  it('enthält Mengen-Hinweise für Räume (Test 3)', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('MENGENBERECHNUNG BEI RÄUMEN')
    // Konkrete Beispiel-Formel aus der Quelle
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('2×(L+B)×H + L×B')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('Wandfläche = 2 × (Länge + Breite) × Höhe')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('Deckenfläche = Länge × Breite')
  })

  it('enthält ZUSAMMENFASSEN/TRENNEN-Logik', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('ZUSAMMENFASSEN oder TRENNEN')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('Mengen addieren')
  })
})

// ──── Test 4: Prompt-Länge ──────────────────────────────────────────────────

describe('KOMPLETT_ANGEBOT_PROMPT – Größe', () => {
  it('ist ein großer Prompt (>5000 Zeichen) (Test 4)', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT.length).toBeGreaterThan(5000)
  })
})

// ──── Test 5: Synonym-Tabelle und Preisfindungs-Reihenfolge ─────────────────

describe('KOMPLETT_ANGEBOT_PROMPT – Preisfindung', () => {
  it('enthält Synonym-Tabelle für Katalog-Suche', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('SYNONYM-TABELLE')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"abscheren"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"ausmalen"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"grundieren"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"Gipskarton"')
  })

  it('enthält Preisfindungs-Reihenfolge mit Katalog-Priorität', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('PREISFINDUNG – REIHENFOLGE STRIKT EINHALTEN')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('SUCHE ZUERST in der Preisliste')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('aus_preisliste: true')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('aus_preisliste: false')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('EINHEIT PRÜFEN')
  })
})

// ──── Test 6: Spezialregeln – Wasserschaden / Regiestunden / Reinigung ─────

describe('KOMPLETT_ANGEBOT_PROMPT – Spezialregeln', () => {
  it('enthält Wasserschaden-Spezial-Positionen', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('WASSERSCHADEN')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('09-400')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('09-410')
  })

  it('enthält Regiestunden-Pärchen-Logik (XX-997 + XX-999)', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('REGIESTUNDEN')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('XX-997')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('XX-999')
  })

  it('enthält Reinigungsregeln (Fall A / Fall B)', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('REINIGUNG')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('FALL A')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('FALL B')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('13-001')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('13-100')
  })

  it('enthält Baustelleneinrichtungs-Regel mit Schwellwert 3.000 €', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('BAUSTELLENEINRICHTUNG')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('01-001')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('01-002')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('3.000')
  })
})

// ──── Test 7: Multi-Tenant – FIRMA_NAME wird durch buildPrompt ersetzt ─────

describe('KOMPLETT_ANGEBOT_PROMPT – buildPrompt-Integration', () => {
  it('ersetzt {{FIRMA_NAME}} korrekt durch ctx.firmaName', () => {
    const out = buildPrompt(KOMPLETT_ANGEBOT_PROMPT, ctx)
    expect(out).toContain('BAU4YOU Baranowski Bau GmbH')
    expect(out).not.toContain('{{FIRMA_NAME}}')
    // Hardcoded BAU4YOU im Original ist weg
    expect(out).not.toMatch(/BAU4YOU Baranowski Bau GmbH in Wien.*BAU4YOU/s)
  })

  it('ersetzt Aufschlag-Platzhalter mit numerischen Werten', () => {
    const out = buildPrompt(KOMPLETT_ANGEBOT_PROMPT, ctx)
    expect(out).not.toContain('{{AUFSCHLAG_GESAMT}}')
    expect(out).not.toContain('{{AUFSCHLAG_MATERIAL}}')
    // Konkrete Werte tauchen auf
    expect(out).toContain('1 + 20/100')
    expect(out).toContain('1 + 30/100')
  })

  it('ersetzt {{STUNDENSAETZE}} durch Liste aus PromptContext', () => {
    const out = buildPrompt(KOMPLETT_ANGEBOT_PROMPT, ctx)
    expect(out).not.toContain('{{STUNDENSAETZE}}')
    expect(out).toContain('- Maler: 75 €/Std')
    expect(out).toContain('- Abbruch: 65 €/Std')
    expect(out).toContain('- Baumeister: 80 €/Std')
  })

  it('funktioniert für andere Tenants (Multi-Tenant)', () => {
    const out = buildPrompt(KOMPLETT_ANGEBOT_PROMPT, {
      ...ctx,
      firmaName: 'Musterbau GmbH',
    })
    expect(out).toContain('Musterbau GmbH')
    expect(out).not.toContain('BAU4YOU')
  })
})

// ──── Test 8: Strukturelle Vollständigkeit ──────────────────────────────────

describe('KOMPLETT_ANGEBOT_PROMPT – Strukturelle Vollständigkeit', () => {
  it('enthält JSON-Ausgabeschema mit gewerke/positionen/netto/mwst/brutto', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('AUSGABE')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"gewerke"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"positionen"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"netto"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"mwst"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"brutto"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"aus_preisliste"')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('"unsicher"')
  })

  it('enthält Ausführungsreihenfolge für alle relevanten Gewerke', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('GEWERK MALER (09) – PFLICHT-REIHENFOLGE')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('GEWERK FLIESENLEGER (11) – PFLICHT-REIHENFOLGE')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('GEWERK BAUMEISTER (07) – PFLICHT-REIHENFOLGE')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('GEWERK TROCKENBAU (08) – PFLICHT-REIHENFOLGE')
  })

  it('enthält Betreff/Adresse-Parsing-Regeln und ignoriert Projektnummer', () => {
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('EINGABE PARSEN')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('BETREFF')
    expect(KOMPLETT_ANGEBOT_PROMPT).toContain('ADRESSE')
    // Projektnummer wird vom Frontend separat verwaltet und ignoriert.
    expect(KOMPLETT_ANGEBOT_PROMPT).toMatch(/Projektnummer.*IGNORIEREN/i)
    expect(KOMPLETT_ANGEBOT_PROMPT).not.toContain('HERO PROJEKTNUMMER')
  })
})
