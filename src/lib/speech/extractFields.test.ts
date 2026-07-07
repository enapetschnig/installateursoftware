// ────────────────────────────────────────────────────────────────────────────
//  extractFields.test.ts – Pure-Logic-Tests für Speech-Feld-Extraktion.
//
//  Wir testen zwei orthogonale Aspekte:
//    1. extractErgaenzungenHinweise() – Trennt Ergänzungen/Hinweise vom Text.
//    2. extractFields()               – Zerlegt Roh-Transkript in 4 Felder.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import { extractErgaenzungenHinweise, extractFields } from './extractFields'

// ─────────────────────── extractErgaenzungenHinweise ─────────────────────────

describe('extractErgaenzungenHinweise', () => {
  it('extrahiert eine einzelne Ergänzung und entfernt sie aus cleanedText', () => {
    const input =
      'Wand spachteln. Ergänzung: hochwertige Farbe verwenden. Nächste Position Decke streichen.'
    const result = extractErgaenzungenHinweise(input)

    expect(result.ergaenzungen).toEqual(['hochwertige Farbe verwenden'])
    expect(result.hinweise).toEqual([])
    expect(result.cleanedText).not.toContain('hochwertige Farbe')
    expect(result.cleanedText).toContain('Wand spachteln')
    expect(result.cleanedText).toContain('Decke streichen')
  })

  it('extrahiert mehrere Ergänzungen und Hinweise gemischt', () => {
    const input =
      'Badezimmer sanieren. Ergänzung: der Schlüssel muss abgeholt werden. ' +
      'Hinweis: der Kunde verzichtet auf Grundierung. ' +
      'Außerdem Decke streichen. Noch ein Hinweis: Parkplatz im Hof nutzen.'
    const result = extractErgaenzungenHinweise(input)

    expect(result.ergaenzungen).toEqual(['der Schlüssel muss abgeholt werden'])
    expect(result.hinweise).toHaveLength(2)
    expect(result.hinweise[0]).toBe('der Kunde verzichtet auf Grundierung')
    expect(result.hinweise[1]).toBe('Parkplatz im Hof nutzen')
    expect(result.cleanedText).toContain('Badezimmer sanieren')
    expect(result.cleanedText).toContain('Decke streichen')
    expect(result.cleanedText).not.toContain('Schlüssel')
    expect(result.cleanedText).not.toContain('Grundierung')
  })

  it('liefert leere Listen, wenn kein Marker im Text vorkommt', () => {
    const input = 'Wand spachteln 30m². Decke streichen 25m².'
    const result = extractErgaenzungenHinweise(input)

    expect(result.ergaenzungen).toEqual([])
    expect(result.hinweise).toEqual([])
    expect(result.cleanedText).toBe(input)
  })

  it('respektiert "weiterer Hinweis" / "noch eine Ergänzung" Präfixe', () => {
    const input =
      'Tür lackieren. Noch eine Ergänzung: rostfreie Schrauben. ' +
      'Weiterer Hinweis: Türstopper mitliefern.'
    const result = extractErgaenzungenHinweise(input)

    expect(result.ergaenzungen).toEqual(['rostfreie Schrauben'])
    expect(result.hinweise).toEqual(['Türstopper mitliefern'])
  })

  it('akzeptiert leeren / undefined Input ohne Crash', () => {
    expect(extractErgaenzungenHinweise('')).toEqual({
      cleanedText: '',
      ergaenzungen: [],
      hinweise: [],
    })
  })

  it('stoppt Ergänzung am Satzende vor neuem Großbuchstaben', () => {
    // "Schlüssel abholen." endet bei Punkt+Großbuchstabe → "Decke" gehört NICHT zur Ergänzung.
    const input = 'Wand spachteln. Ergänzung: Schlüssel abholen. Decke streichen.'
    const result = extractErgaenzungenHinweise(input)

    expect(result.ergaenzungen).toEqual(['Schlüssel abholen'])
    expect(result.cleanedText).toContain('Decke streichen')
  })
})

// ───────────────────────────── extractFields ─────────────────────────────────

describe('extractFields', () => {
  it('extrahiert Betrifft + Positionen aus Standard-Whisper-Output (Adresse wird konsumiert, aber NICHT zurueckgegeben)', () => {
    const input =
      'PN 369, Adresse Hyegasse 3 1030 Wien, Betrifft Renovierung, ' +
      'Wand spachteln 30m², nächste Position Decke streichen 25m²'
    const result = extractFields(input)

    // Adresse + Projektnummer werden aus dem Roh-Text entfernt, damit sie
    // nicht als Position-Bullets landen, aber NICHT mehr exposed.
    // (Kunde + dessen Adresse werden im neuen Workflow ueber das Pre-Step-
    // Modal vor dem Voice-Dialog gesetzt.)
    expect(result.betrifft).toBe('Renovierung')
    expect(result.positionen).toContain('Wand spachteln 30m²')
    expect(result.positionen).toContain('Decke streichen 25m²')
    expect(result.positionen.split('\n')).toHaveLength(2)
    // Adresse darf NICHT in den Positionen landen.
    expect(result.positionen).not.toMatch(/Hyegasse|1030/)
  })

  it('Strassen-Heuristik konsumiert die Adresse trotzdem (raus aus Positionen)', () => {
    const input = 'Mariahilfer Straße 1, 1060 Wien, Fenster putzen'
    const result = extractFields(input)

    expect(result.positionen).toContain('Fenster putzen')
    expect(result.positionen).not.toMatch(/Mariahilfer|1060/)
  })

  it('Wohnungs-Suffix (Top, Stiege) landet NICHT in Positionen', () => {
    const input =
      'Adresse Beispielgasse 5, 1010 Wien, Stiege 2 Top 12. ' +
      'Nächste Position Wand spachteln'
    const result = extractFields(input)

    // Suffix darf NICHT als Position auftauchen.
    expect(result.positionen).not.toMatch(/^•\s*(stiege|top)/i)
    expect(result.positionen).toContain('Wand spachteln')
  })

  it('packt reinen Positionen-Text in das Positionen-Feld', () => {
    const input = 'wand spachteln 30m²'
    const result = extractFields(input)

    expect(result.betrifft).toBe('')
    expect(result.positionen).toContain('wand spachteln 30m²')
    expect(result.positionen.startsWith('•')).toBe(true)
  })

  it('liefert für leeren Input alle Felder als leere Strings', () => {
    const result = extractFields('   ')
    expect(result).toEqual({
      betrifft: '',
      positionen: '',
    })
  })

  it('trennt mehrere Positionen via "nächste Position"', () => {
    const input =
      'Wand spachteln 30m², nächste Position Decke streichen 25m², nächste Position Tür lackieren'
    const result = extractFields(input)

    const bullets = result.positionen.split('\n').filter((l) => l.trim().length > 0)
    expect(bullets).toHaveLength(3)
    expect(bullets[0]).toContain('Wand spachteln')
    expect(bullets[1]).toContain('Decke streichen')
    expect(bullets[2]).toContain('Tür lackieren')
  })

  it('konsumiert Projektnummer-Pattern aus dem Roh-Text (kein Feld im Ergebnis)', () => {
    const input = 'Projekt Nr. 42, Wand spachteln'
    const result = extractFields(input)

    // Projektnummer wird aus dem Roh-Text entfernt, damit sie nicht
    // als Position-Bullet auftaucht. Sie ist aber kein eigenes Feld mehr.
    expect(result.positionen).toContain('Wand spachteln')
    expect(result.positionen).not.toContain('Projekt Nr. 42')
  })

  it('filtert "ich brauche ein Angebot"-Floskeln, wenn sie als eigenes Bullet stehen', () => {
    // IGNORE_BULLET_RE wirft das gesamte Bullet, das mit der Floskel
    // beginnt, weg – konsistent mit bau4you. Wenn ein zweites Bullet
    // existiert, bleibt nur dieses übrig.
    const result = extractFields(
      'Ich brauche ein Angebot für die Wohnung. Nächste Position Wand spachteln 30m²',
    )
    expect(result.positionen).toContain('Wand spachteln 30m²')
    expect(result.positionen).not.toMatch(/ich\s+brauche/i)
    // Genau ein Bullet überlebt.
    expect(result.positionen.split('\n').filter((l) => l.trim()).length).toBe(1)
  })
})
