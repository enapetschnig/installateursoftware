// ────────────────────────────────────────────────────────────────────────────
//  VoiceAngebotDialog – Unit-Tests (pure logic)
//
//  STATUS (2026-06-24): vitest laeuft mit environment: 'node' und das Projekt
//  hat KEIN @testing-library/react in den devDependencies. Wir koennen daher
//  den React-Component nicht via render() mounten und testen stattdessen die
//  reine Kern-Logik runVoiceAngebot(), die der Component intern aufruft.
//
//  Damit decken wir die im Modul-Auftrag verlangten 4 Test-Cases vollstaendig
//  ab – das Component-Wrapping selbst ist eine duenne State-/JSX-Schicht ohne
//  zusaetzliche Verzweigungen.
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest'

import {
  runVoiceAngebot,
  type RunVoiceAngebotDeps,
  type KomplettAngebotResponse,
  type VoiceAngebotStatus,
} from './VoiceAngebotDialog'
import type { AiCompleteOpts, AiCompleteResult } from '../../lib/ai/aiComplete'
import type { Catalog, Gewerk, KalkSettings, StundensaetzeMap } from '../../lib/calc/types'
import type { runCalcPipeline } from '../../lib/calc/pipeline'

/** Signatur der echten Pipeline – damit vi.fn() die Argumente korrekt typisiert. */
type RunCalcPipelineFn = typeof runCalcPipeline
import { DEFAULT_KALK_SETTINGS } from '../../lib/calc/types'
import { extractErgaenzungenHinweise } from '../../lib/speech/extractFields'
import { parseJsonResponse } from '../../lib/ai/parseJson'

// ──── Test-Fixtures ────────────────────────────────────────────────────────

const EMPTY_CATALOG: Catalog = { positionen: [] }
const EMPTY_STUNDENSAETZE: StundensaetzeMap = { Maler: 75, Reinigung: 58 }
const SETTINGS: KalkSettings = DEFAULT_KALK_SETTINGS

function makeAiResult(payload: KomplettAngebotResponse): AiCompleteResult {
  return { text: JSON.stringify(payload) }
}

/** Typed identity-stub fuer die Pipeline – akzeptiert (gewerke, opts), gibt gewerke zurueck. */
const identityPipeline: RunCalcPipelineFn = (gewerke, _opts) => gewerke

function defaultDeps(
  override: Partial<RunVoiceAngebotDeps> = {},
): RunVoiceAngebotDeps {
  return {
    aiComplete:
      override.aiComplete ??
      vi.fn(async () =>
        makeAiResult({
          betreff: 'Malerarbeiten Wohnung',
          adresse: 'Hyegasse 3, 1030 Wien',
          gewerke: [
            {
              name: 'Maler',
              positionen: [
                {
                  leistungsnummer: '09-NEU',
                  leistungsname: 'Wand spachteln',
                  einheit: 'm²',
                  menge: 30,
                  vk_netto_einheit: 15,
                  gesamtpreis: 450,
                  materialkosten_einheit: 5,
                  lohnkosten_einheit: 10,
                  lohnkosten_minuten: 8,
                  stundensatz: 75,
                  aus_preisliste: false,
                },
              ],
            },
          ],
        }),
      ),
    runCalcPipeline:
      override.runCalcPipeline ??
      // Identity-Stub: einfach durchreichen, damit wir die Pipeline-Verschaltung
      // pruefen koennen ohne die echten 19 Module mitzutesten.
      vi.fn<RunCalcPipelineFn>(identityPipeline),
    extractErgaenzungenHinweise:
      override.extractErgaenzungenHinweise ?? extractErgaenzungenHinweise,
    parseJsonResponse: override.parseJsonResponse ?? parseJsonResponse,
  }
}

// ──── Tests ────────────────────────────────────────────────────────────────

describe('VoiceAngebotDialog / runVoiceAngebot', () => {
  // ────────────────────────────────────────────────────────────────────────
  it('Test 1: Pipeline-Flow-Smoke – aiComplete + parseJson + runCalcPipeline laufen durch', async () => {
    const aiComplete = vi.fn(
      async (_opts: AiCompleteOpts): Promise<AiCompleteResult> =>
        makeAiResult({
          betreff: 'Malerarbeiten Schlafzimmer',
          adresse: 'Klosterneuburger Straße 71/Top 12, 1200 Wien',
          gewerke: [
            {
              name: 'Maler',
              positionen: [
                {
                  leistungsnummer: '09-NEU',
                  leistungsname: 'Wände grundieren',
                  einheit: 'm²',
                  menge: 50,
                  vk_netto_einheit: 6,
                  gesamtpreis: 300,
                },
              ],
            },
            {
              name: 'Reinigung',
              positionen: [
                {
                  leistungsnummer: '13-001',
                  leistungsname: 'Baureinigung besenrein',
                  einheit: 'pausch',
                  menge: 1,
                  vk_netto_einheit: 180,
                  gesamtpreis: 180,
                  aus_preisliste: true,
                },
              ],
            },
          ],
        }),
    )
    const runCalc = vi.fn<RunCalcPipelineFn>(
      (gewerke, _opts) =>
        // simuliere kleine Pipeline-Aenderung: Sortierung gleich, aber wir markieren
        // dass die Pipeline tatsaechlich aufgerufen wurde.
        gewerke.map((g) => ({ ...g, _processed: true } as Gewerk)),
    )

    const deps = defaultDeps({
      aiComplete,
      runCalcPipeline: runCalc,
    })

    const statusUpdates: VoiceAngebotStatus[] = []
    const result = await runVoiceAngebot(
      {
        text:
          'Projektnummer: 369\n' +
          'Adresse: Klosterneuburger Straße 71/Top 12, 1200 Wien\n' +
          'Betrifft: Malerarbeiten\n' +
          '\n' +
          '• Wände grundieren 50 m²',
        organizationName: 'BAU4YOU Baranowski Bau GmbH',
        catalog: EMPTY_CATALOG,
        stundensaetze: EMPTY_STUNDENSAETZE,
        settings: SETTINGS,
        onStatus: (s) => statusUpdates.push(s),
      },
      deps,
    )

    // aiComplete wurde mit dem ausgebauten Prompt + User-Text aufgerufen.
    expect(aiComplete).toHaveBeenCalledTimes(1)
    const aiArgs = aiComplete.mock.calls[0][0]
    expect(aiArgs.systemPrompt).toContain('BAU4YOU Baranowski Bau GmbH')
    expect(aiArgs.systemPrompt).toContain('Maler: 75 €/Std')
    expect(aiArgs.maxTokens).toBe(8000)
    expect(typeof aiArgs.userMessage).toBe('string')
    expect(aiArgs.userMessage.length).toBeGreaterThan(0)
    // Preisliste wird via cachedContext injiziert — bei leerem Katalog der
    // definierte Fallback-Text (buildFilteredCatalog EMPTY-Pfad).
    expect(aiArgs.cachedContext).toContain('PREISLISTE')
    expect(aiArgs.cachedContext).toContain('(keine Preisliste verfügbar)')

    // Pipeline wurde mit den geparsten Gewerken aufgerufen.
    expect(runCalc).toHaveBeenCalledTimes(1)
    const [pipelineGewerke, pipelineOpts] = runCalc.mock.calls[0]
    expect(pipelineGewerke).toHaveLength(2)
    expect(pipelineGewerke[0].name).toBe('Maler')
    expect(pipelineGewerke[1].name).toBe('Reinigung')
    expect(pipelineOpts.catalog).toBe(EMPTY_CATALOG)
    expect(pipelineOpts.stundensaetze).toBe(EMPTY_STUNDENSAETZE)
    expect(pipelineOpts.settings).toBe(SETTINGS)
    expect(typeof pipelineOpts.eingabeText).toBe('string')
    // Diktierte Stundenzahlen haben Vorrang — Flag muss gesetzt sein.
    expect(pipelineOpts.enforceUserStunden).toBe(true)

    // Ergebnis enthaelt die durch die Pipeline gegangenen Gewerke.
    expect(result.gewerke).toHaveLength(2)
    expect(
      (result.gewerke[0] as Gewerk & { _processed?: boolean })._processed,
    ).toBe(true)

    // Meta: nur Betreff (+ Ergaenzungen/Hinweise) — Adresse wurde 2026-06-30
    // entfernt (Kunden-Adresse kommt aus dem Pre-Step-Modal). Projektnummer
    // schon 2026-06-24 raus (manuell ueber Projekt-Dropdown im Editor).
    expect(result.meta.betrifft).toBe('Malerarbeiten Schlafzimmer')

    // Status-Updates: mindestens "ai" → "pipeline" → "done".
    const phases = statusUpdates.map((s) => s.phase)
    expect(phases).toContain('ai')
    expect(phases).toContain('pipeline')
    expect(phases[phases.length - 1]).toBe('done')
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 2: Parse-Error → wirft Fehler ohne Pipeline-Aufruf', async () => {
    // aiComplete liefert kaputten JSON-Text zurueck → parseJsonResponse wirft.
    const aiComplete = vi.fn(
      async (): Promise<AiCompleteResult> => ({
        text: 'das ist gar kein JSON, sondern Fliesstext mit keiner geschweiften Klammer',
      }),
    )
    const runCalc = vi.fn<RunCalcPipelineFn>(identityPipeline)

    const deps = defaultDeps({ aiComplete, runCalcPipeline: runCalc })

    const statusUpdates: VoiceAngebotStatus[] = []
    await expect(
      runVoiceAngebot(
        {
          text: '• Wände grundieren 50 m²',
          organizationName: 'BAU4YOU',
          catalog: EMPTY_CATALOG,
          stundensaetze: EMPTY_STUNDENSAETZE,
          settings: SETTINGS,
          onStatus: (s) => statusUpdates.push(s),
        },
        deps,
      ),
    ).rejects.toThrow()

    // aiComplete wurde ZWEIMAL aufgerufen (bewusster Einzel-Retry bei
    // ungültigem JSON, seit 2026-07-10) – runCalcPipeline aber NIE
    // (beide Antworten unparsebar).
    expect(aiComplete).toHaveBeenCalledTimes(2)
    expect(runCalc).not.toHaveBeenCalled()

    // Vor dem Parse-Fehler hatten wir mindestens Status "ai" gesetzt.
    const phases = statusUpdates.map((s) => s.phase)
    expect(phases).toContain('ai')
    // "done" darf NICHT vorkommen, da wir den Erfolgspfad nie erreicht haben.
    expect(phases).not.toContain('done')
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 3: aiComplete-Error → wirft Fehler, runCalcPipeline wird nicht aufgerufen', async () => {
    const aiComplete = vi.fn(async () => {
      throw new Error('KI-Anfrage abgebrochen (Timeout nach 120000ms).')
    })
    const runCalc = vi.fn<RunCalcPipelineFn>(identityPipeline)

    const deps = defaultDeps({ aiComplete, runCalcPipeline: runCalc })

    const statusUpdates: VoiceAngebotStatus[] = []
    await expect(
      runVoiceAngebot(
        {
          text: '• Wände grundieren 50 m²',
          organizationName: 'BAU4YOU',
          catalog: EMPTY_CATALOG,
          stundensaetze: EMPTY_STUNDENSAETZE,
          settings: SETTINGS,
          onStatus: (s) => statusUpdates.push(s),
        },
        deps,
      ),
    ).rejects.toThrow(/Timeout/)

    // runCalcPipeline darf NICHT aufgerufen werden, wenn aiComplete fehlschlaegt.
    expect(runCalc).not.toHaveBeenCalled()

    // Vor dem Fehler hatten wir "ai" gesetzt – "pipeline" und "done" NICHT.
    const phases = statusUpdates.map((s) => s.phase)
    expect(phases).toContain('ai')
    expect(phases).not.toContain('pipeline')
    expect(phases).not.toContain('done')
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 4: extractErgaenzungenHinweise wird aufgerufen + cleanedText geht in aiComplete', async () => {
    // Mock extractErgaenzungenHinweise, damit wir den Aufruf direkt pruefen koennen.
    const extractMock = vi.fn((_text: string) => ({
      cleanedText: 'Wand spachteln 30m². Nächste Position Decke streichen.',
      ergaenzungen: ['hochwertige Farbe'],
      hinweise: ['Parkettboden bitte schützen'],
    }))

    const aiComplete = vi.fn(
      async (_opts: AiCompleteOpts): Promise<AiCompleteResult> =>
        makeAiResult({
          betreff: 'Malerarbeiten',
          adresse: null,
          gewerke: [
            {
              name: 'Maler',
              positionen: [
                {
                  leistungsnummer: '09-NEU',
                  leistungsname: 'Wand spachteln',
                  einheit: 'm²',
                  menge: 30,
                  vk_netto_einheit: 15,
                  gesamtpreis: 450,
                },
              ],
            },
          ],
        }),
    )

    const runCalc = vi.fn<RunCalcPipelineFn>(identityPipeline)

    const deps = defaultDeps({
      aiComplete,
      runCalcPipeline: runCalc,
      extractErgaenzungenHinweise: extractMock,
    })

    const rawText =
      'Wand spachteln 30m². Ergänzung: hochwertige Farbe. ' +
      'Hinweis: Parkettboden bitte schützen. Nächste Position Decke streichen.'

    const result = await runVoiceAngebot(
      {
        text: rawText,
        organizationName: 'BAU4YOU',
        catalog: EMPTY_CATALOG,
        stundensaetze: EMPTY_STUNDENSAETZE,
        settings: SETTINGS,
      },
      deps,
    )

    // 1) extractErgaenzungenHinweise wurde mit dem Original-Text aufgerufen.
    expect(extractMock).toHaveBeenCalledTimes(1)
    expect(extractMock).toHaveBeenCalledWith(rawText)

    // 2) aiComplete wurde mit dem CLEANED-Text (NICHT mit dem Original) aufgerufen.
    expect(aiComplete).toHaveBeenCalledTimes(1)
    const aiArgs = aiComplete.mock.calls[0][0]
    expect(aiArgs.userMessage).toBe(
      'Wand spachteln 30m². Nächste Position Decke streichen.',
    )
    expect(aiArgs.userMessage).not.toContain('Ergänzung')
    expect(aiArgs.userMessage).not.toContain('Hinweis')

    // 3) Pipeline laeuft mit dem cleanedText als eingabeText.
    expect(runCalc).toHaveBeenCalledTimes(1)
    expect(runCalc.mock.calls[0][1].eingabeText).toBe(
      'Wand spachteln 30m². Nächste Position Decke streichen.',
    )

    // 4) Ergaenzungen und Hinweise landen im Meta-Objekt.
    expect(result.meta.ergaenzungen).toEqual(['hochwertige Farbe'])
    expect(result.meta.hinweise).toEqual(['Parkettboden bitte schützen'])
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 5 (bonus): leere Gewerke aus der KI → wirft Fehler', async () => {
    const aiComplete = vi.fn(
      async (): Promise<AiCompleteResult> =>
        makeAiResult({ betreff: null, adresse: null, gewerke: [] }),
    )
    const runCalc = vi.fn<RunCalcPipelineFn>(identityPipeline)

    await expect(
      runVoiceAngebot(
        {
          text: '• irgendwas',
          organizationName: 'BAU4YOU',
          catalog: EMPTY_CATALOG,
          stundensaetze: EMPTY_STUNDENSAETZE,
          settings: SETTINGS,
        },
        defaultDeps({ aiComplete, runCalcPipeline: runCalc }),
      ),
    ).rejects.toThrow(/keine Gewerke/i)

    expect(runCalc).not.toHaveBeenCalled()
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 6 (bonus): organizationName-Fallback ist "BAU4YOU"', async () => {
    const aiComplete = vi.fn(
      async (_opts: AiCompleteOpts): Promise<AiCompleteResult> =>
        makeAiResult({
          gewerke: [
            {
              name: 'Maler',
              positionen: [
                {
                  leistungsnummer: '09-NEU',
                  leistungsname: 'Test',
                  einheit: 'm²',
                  menge: 1,
                  vk_netto_einheit: 10,
                },
              ],
            },
          ],
        }),
    )

    await runVoiceAngebot(
      {
        text: '• etwas',
        organizationName: '',
        catalog: EMPTY_CATALOG,
        stundensaetze: EMPTY_STUNDENSAETZE,
        settings: SETTINGS,
      },
      defaultDeps({ aiComplete }),
    )

    const aiArgs = aiComplete.mock.calls[0][0]
    expect(aiArgs.systemPrompt).toContain('BAU4YOU')
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 7 (bonus): Meta-Fallback – KI liefert null, User-Header werden genommen', async () => {
    const aiComplete = vi.fn(
      async (): Promise<AiCompleteResult> =>
        makeAiResult({
          betreff: null,
          adresse: null,
          gewerke: [
            {
              name: 'Maler',
              positionen: [
                {
                  leistungsnummer: '09-NEU',
                  leistungsname: 'Test',
                  einheit: 'm²',
                  menge: 1,
                  vk_netto_einheit: 10,
                },
              ],
            },
          ],
        }),
    )

    // Hinweis: extractFields() erkennt "Projektnummer 123" / "Adresse <Straße>"
    // / "Betrifft <Thema>" am natuerlichsten in flachem Whisper-Format
    // (Whitespace-separiert, nicht mit Doppelpunkt). Wir verwenden hier den
    // flachen Stil, weil extractFields() exakt damit gefuettert wird, bevor der
    // User auf "Generieren" drueckt (siehe SpeechInput.assembleText, die fuer
    // den Dialog zweitrangig ist – die KI bekommt sowieso den Roh-/Cleaned-Text).
    const result = await runVoiceAngebot(
      {
        text:
          'Projektnummer 123, Adresse Teststraße 5, 1010 Wien, ' +
          'Betrifft Sanierung. Wand grundieren 30 m²',
        organizationName: 'BAU4YOU',
        catalog: EMPTY_CATALOG,
        stundensaetze: EMPTY_STUNDENSAETZE,
        settings: SETTINGS,
      },
      defaultDeps({ aiComplete }),
    )

    // Adresse + Projektnummer werden nicht mehr in meta exposed.
    expect(result.meta.betrifft).toBe('Sanierung')
  })
})
