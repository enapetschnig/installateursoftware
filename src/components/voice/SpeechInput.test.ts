// ────────────────────────────────────────────────────────────────────────────
//  SpeechInput – Unit-Tests
//
//  STATUS (2026-06-24): Das Projekt nutzt `vitest` mit `environment: 'node'`
//  (siehe vitest.config.ts) und hat KEIN `@testing-library/react` in den
//  devDependencies. Wir können den React-Component daher nicht mit
//  `render()` / `renderHook()` mounten.
//
//  Strategie:
//    - Drei UI-Render-Smoke-Tests gem. Modul-Auftrag werden mit `it.skip()`
//      angelegt + ausführlich begründet, damit klar ist, _warum_ sie ruhen
//      und _wann_ sie aktiviert werden müssen.
//    - Stattdessen testen wir hier die PUREN Hilfsfunktionen
//      (`assembleText`, `parseTemplateToFields`, `mergeExtracted`), die das
//      Verhalten des Components vollständig prägen. Wenn diese korrekt sind,
//      kann der Component sein 4-Felder-Versprechen einhalten.
//    - Mindestens fünf solche Tests (Vorgabe des Auftrags), aktuell sieben.
//
//  Wenn später jsdom + RTL hinzukommen, die `it.skip(...)` durch echte
//  Renders ersetzen.
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  assembleText,
  parseTemplateToFields,
  mergeExtracted,
  EMPTY_FIELDS,
  type Fields,
} from './SpeechInput'

// ──── Pure-Helper-Tests ───────────────────────────────────────────────────────

describe('SpeechInput / assembleText', () => {
  it('gibt leeren String zurück, wenn alle Felder leer sind', () => {
    expect(assembleText(EMPTY_FIELDS)).toBe('')
  })

  it('baut Betrifft + Positionen in der erwarteten Reihenfolge zusammen', () => {
    const f: Fields = {
      betrifft: 'Renovierung',
      positionen: '• Wand spachteln 30m²\n• Decke streichen',
    }
    // Header-Zeile, Leerzeile, Positionen — Adresse-Feld entfernt
    // (2026-06-30: Kunden-Adresse kommt aus dem Pre-Step-Modal).
    expect(assembleText(f)).toBe(
      'Betrifft: Renovierung\n' +
        '\n' +
        '• Wand spachteln 30m²\n• Decke streichen',
    )
  })

  it('trimmt Leerzeichen in einzelnen Feldern weg', () => {
    const f: Fields = {
      betrifft: '   ',
      positionen: '  • alleine\n',
    }
    expect(assembleText(f)).toBe('• alleine')
  })
})

describe('SpeechInput / parseTemplateToFields', () => {
  it('parst einen voll-formatierten Template-Text korrekt', () => {
    const text =
      'Projektnummer: 100\n' +
      'Adresse: Hyegasse 3, 1030 Wien\n' +
      'Betrifft: Renovierung\n' +
      '\n' +
      '• Wand spachteln 30m²\n' +
      '• Decke streichen'
    // Legacy "Adresse:" + "Projektnummer:" werden konsumiert (alte
    // Vorlagen bleiben lesbar), aber NICHT mehr gespeichert.
    expect(parseTemplateToFields(text)).toEqual({
      betrifft: 'Renovierung',
      positionen: '• Wand spachteln 30m²\n• Decke streichen',
    })
  })

  it('round-trip: assemble → parse → assemble bleibt stabil', () => {
    const start: Fields = {
      betrifft: 'Bodenarbeiten',
      positionen: '• Parkett schleifen 40m²\n• Sockelleisten erneuern',
    }
    const text1 = assembleText(start)
    const parsed = parseTemplateToFields(text1)
    const text2 = assembleText(parsed)
    expect(text2).toBe(text1)
  })

  it('akzeptiert nur Positionen ohne Meta-Header', () => {
    const text = '• nur position eins\n• und position zwei'
    expect(parseTemplateToFields(text)).toEqual({
      betrifft: '',
      positionen: '• nur position eins\n• und position zwei',
    })
  })
})

describe('SpeechInput / mergeExtracted', () => {
  // Vertrag:
  //   - Meta-Feld (Betrifft) wird ÜBERSCHRIEBEN, wenn der Extract-Output einen
  //     nicht-leeren Wert liefert — Whisper liefert es nur, wenn der Sprecher
  //     es explizit gesagt hat, also klare "Ja, ich meine es"-Geste vom User.
  //   - Leeres Extract-Feld lässt prev unverändert.
  //   - Positionen werden hingegen APPENDED (mehrere Aufnahmen kumulierbar).
  it('überschreibt Betrifft, wenn Extract einen nicht-leeren Wert liefert', () => {
    const prev: Fields = {
      betrifft: 'Manuell gesetzt',
      positionen: '• altes Bullet',
    }
    const merged = mergeExtracted(prev, {
      betrifft: 'Neuer Betrifft',
      positionen: '• neues Bullet',
    })
    expect(merged.betrifft).toBe('Neuer Betrifft')
    // Positionen → append-Semantik (mehrere Aufnahmen kumulierbar).
    expect(merged.positionen).toBe('• altes Bullet\n• neues Bullet')
  })

  it('lässt prev-Felder unverändert, wenn der Extract leere Strings liefert', () => {
    const prev: Fields = {
      betrifft: 'Manuell gesetzt',
      positionen: '• altes Bullet',
    }
    const merged = mergeExtracted(prev, {
      betrifft: '',
      positionen: '',
    })
    expect(merged).toEqual(prev)
  })

  it('Positionen-Append: bei leerem Prev wird nur das neue Bullet übernommen', () => {
    const merged = mergeExtracted(EMPTY_FIELDS, {
      betrifft: '',
      positionen: '• einsames Bullet',
    })
    expect(merged.positionen).toBe('• einsames Bullet')
  })
})

// ──── UI-Render-Tests (skipped) ─────────────────────────────────────────────

describe('SpeechInput / UI-Smoke (TODO bei jsdom)', () => {
  it.skip(
    '[1] rendert Mic-Button und Textarea',
    /* Begründung:
       Erfordert `@testing-library/react` + jsdom-Env.
       Aktuell läuft Vitest in node-env → render() nicht verfügbar.
       Sobald installiert:

         import { render, screen } from '@testing-library/react'
         render(<SpeechInput />)
         expect(screen.getByTestId('speech-input-mic')).toBeInTheDocument()
         expect(screen.getByTestId('speech-input-positionen')).toBeInTheDocument()
    */
    () => {},
  )

  it.skip(
    '[2] Mic-Click triggert useAudioRecorder.start()',
    /* Begründung:
       Braucht jsdom + Mock von `useAudioRecorder`. Mit RTL würde das so aussehen:

         const start = vi.fn()
         vi.mock('../../hooks/useAudioRecorder', () => ({
           useAudioRecorder: () => ({
             recording: false, audioBlob: null, error: null,
             start, stop: vi.fn(), reset: vi.fn(),
           }),
         }))
         render(<SpeechInput />)
         await userEvent.click(screen.getByTestId('speech-input-mic'))
         expect(start).toHaveBeenCalledOnce()
    */
    () => {},
  )

  it.skip(
    '[3] enableBullets=true rendert zwei Eingabefelder',
    /* Begründung:
       UI-Test. Logik äquivalent:
         render(<SpeechInput enableBullets />)
         expect(screen.getByTestId('speech-input-betrifft')).toBeInTheDocument()
         expect(screen.getByTestId('speech-input-positionen')).toBeInTheDocument()
       Projektnummer-Feld wurde entfernt (User 2026-06-24: Projekt im Editor
       Dropdown). Adresse-Feld entfernt (2026-06-30: Pre-Step-Modal liefert
       Kunde inkl. Adresse).
    */
    () => {},
  )
})
