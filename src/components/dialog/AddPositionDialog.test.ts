// ────────────────────────────────────────────────────────────────────────────
//  AddPositionDialog – Unit-Tests (pure logic)
//
//  Wie VoiceAngebotDialog.test.ts: vitest läuft mit environment 'node' und
//  ohne @testing-library/react — wir testen daher die reine Kern-Logik
//  runAddPosition() (+ normalizeToGewerke), die der Component intern aufruft.
//
//  Abgedeckt (Modul-Auftrag):
//    1. Smoke: aiComplete-Args (maxTokens 2000, cachedContext PREISLISTE,
//       responseFormat json) + kompletter Durchlauf bis DocPosition[]
//    2. Parse-Error-Pfad (Pipeline wird NICHT aufgerufen)
//    3. Leere-Antwort-Pfad (JSON ohne Position → Fehler)
//    4. Pipeline-Aufruf mit enforceUserStunden: true
//  Bonus: Gewerk-Wrapping (nackte Position → Gewerk[]), Service-Lookup.
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest'

import {
  runAddPosition,
  normalizeToGewerke,
  type RunAddPositionDeps,
  type AddPositionStatus,
} from './AddPositionDialog'
import type { AiCompleteOpts, AiCompleteResult } from '../../lib/ai/aiComplete'
import type { Catalog, KalkSettings, Position, StundensaetzeMap } from '../../lib/calc/types'
import type { runCalcPipeline } from '../../lib/calc/pipeline'
import { DEFAULT_KALK_SETTINGS } from '../../lib/calc/types'
import { parseJsonResponse } from '../../lib/ai/parseJson'

/** Signatur der echten Pipeline – damit vi.fn() die Argumente korrekt typisiert. */
type RunCalcPipelineFn = typeof runCalcPipeline

// ──── Test-Fixtures ────────────────────────────────────────────────────────

const EMPTY_CATALOG: Catalog = { positionen: [] }
const STUNDENSAETZE: StundensaetzeMap = { Maler: 75, Abbruch: 65 }
const SETTINGS: KalkSettings = DEFAULT_KALK_SETTINGS

/** Nackte Einzelposition — exakt das AUSGABE-Schema aus ADD_POSITION_PROMPT. */
const NAKED_POSITION: Position = {
  leistungsnummer: '09-NEU',
  leistungsname: 'Wände ausmalen zweifach',
  beschreibung: 'Wände zweifach ausmalen, mittlere Qualität.',
  menge: 25,
  einheit: 'm²',
  vk_netto_einheit: 12.5,
  gesamtpreis: 312.5,
  materialkosten_einheit: 2.5,
  materialanteil_prozent: 20,
  lohnkosten_minuten: 6,
  stundensatz: 75,
  lohnkosten_einheit: 7.5,
  lohnanteil_prozent: 80,
  gewerk: 'Maler',
  aus_preisliste: false,
  unsicher: false,
  hinweis: '',
}

function makeAiResult(payload: unknown): AiCompleteResult {
  return { text: JSON.stringify(payload) }
}

/** Typed identity-stub für die Pipeline – akzeptiert (gewerke, opts), gibt gewerke zurück. */
const identityPipeline: RunCalcPipelineFn = (gewerke, _opts) => gewerke

function defaultDeps(
  override: Partial<RunAddPositionDeps> = {},
): RunAddPositionDeps {
  return {
    aiComplete:
      override.aiComplete ?? vi.fn(async () => makeAiResult(NAKED_POSITION)),
    runCalcPipeline:
      override.runCalcPipeline ?? vi.fn<RunCalcPipelineFn>(identityPipeline),
    parseJsonResponse: override.parseJsonResponse ?? parseJsonResponse,
  }
}

function defaultArgs(
  override: Partial<Parameters<typeof runAddPosition>[0]> = {},
): Parameters<typeof runAddPosition>[0] {
  return {
    text: '25 m² Wände ausmalen zweifach, mittlere Qualität',
    organizationName: 'BAU4YOU Baranowski Bau GmbH',
    catalog: EMPTY_CATALOG,
    stundensaetze: STUNDENSAETZE,
    settings: SETTINGS,
    services: [],
    ...override,
  }
}

// ──── Tests ────────────────────────────────────────────────────────────────

describe('AddPositionDialog / runAddPosition', () => {
  // ────────────────────────────────────────────────────────────────────────
  it('Test 1: Smoke – aiComplete-Args (maxTokens 2000, PREISLISTE, json) + Durchlauf bis DocPosition[]', async () => {
    const aiComplete = vi.fn(
      async (_opts: AiCompleteOpts): Promise<AiCompleteResult> =>
        makeAiResult(NAKED_POSITION),
    )
    const deps = defaultDeps({ aiComplete })

    const statusUpdates: AddPositionStatus[] = []
    const result = await runAddPosition(
      defaultArgs({ onStatus: (s) => statusUpdates.push(s) }),
      deps,
    )

    // aiComplete wurde mit dem ausgebauten ADD_POSITION_PROMPT aufgerufen.
    expect(aiComplete).toHaveBeenCalledTimes(1)
    const aiArgs = aiComplete.mock.calls[0][0]
    expect(aiArgs.systemPrompt).toContain('BAU4YOU Baranowski Bau GmbH')
    expect(aiArgs.systemPrompt).toContain('einzelne Bauposition')
    expect(aiArgs.systemPrompt).toContain('- Maler: 75 €/Std')
    expect(aiArgs.userMessage).toBe('25 m² Wände ausmalen zweifach, mittlere Qualität')
    // EINE Position → deutlich kleineres Token-Limit als Komplettangebot (8000).
    expect(aiArgs.maxTokens).toBe(2000)
    expect(aiArgs.responseFormat).toBe('json')
    // Preisliste via cachedContext — bei leerem Katalog der definierte Fallback.
    expect(aiArgs.cachedContext).toContain('PREISLISTE')
    expect(aiArgs.cachedContext).toContain('(keine Preisliste verfügbar)')

    // Ergebnis: Gewerk-Titel + eine free-Position (kein Service-Match).
    expect(result.positions).toHaveLength(2)
    expect(result.positions[0].type).toBe('title')
    expect(result.positions[0].name).toBe('Maler')
    expect(result.positions[1].type).toBe('free')
    expect(result.positions[1].name).toBe('Wände ausmalen zweifach')
    expect(result.positions[1].qty).toBe(25)
    expect(result.positions[1].unit).toBe('m²')
    expect(result.positions[1].unit_price).toBe(12.5)
    // Hero-VK bereits inkl. Aufschlag → Doppelanwendung verhindern.
    expect(result.positions[1].surcharge_baked).toBe(true)

    // Status-Phasen: "ai" → "pipeline" → "done".
    const phases = statusUpdates.map((s) => s.phase)
    expect(phases).toContain('ai')
    expect(phases).toContain('pipeline')
    expect(phases[phases.length - 1]).toBe('done')
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 2: Parse-Error → wirft Fehler ohne Pipeline-Aufruf', async () => {
    const aiComplete = vi.fn(
      async (): Promise<AiCompleteResult> => ({
        text: 'kein JSON weit und breit, nur Fließtext ohne geschweifte Klammer',
      }),
    )
    const runCalc = vi.fn<RunCalcPipelineFn>(identityPipeline)
    const deps = defaultDeps({ aiComplete, runCalcPipeline: runCalc })

    const statusUpdates: AddPositionStatus[] = []
    await expect(
      runAddPosition(defaultArgs({ onStatus: (s) => statusUpdates.push(s) }), deps),
    ).rejects.toThrow()

    expect(aiComplete).toHaveBeenCalledTimes(1)
    expect(runCalc).not.toHaveBeenCalled()

    const phases = statusUpdates.map((s) => s.phase)
    expect(phases).toContain('ai')
    expect(phases).not.toContain('done')
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 3: leere Antwort (JSON ohne Positionsfelder) → wirft Fehler, Pipeline läuft nicht', async () => {
    const aiComplete = vi.fn(
      async (): Promise<AiCompleteResult> => makeAiResult({ hinweis: 'nichts erkannt' }),
    )
    const runCalc = vi.fn<RunCalcPipelineFn>(identityPipeline)
    const deps = defaultDeps({ aiComplete, runCalcPipeline: runCalc })

    await expect(runAddPosition(defaultArgs(), deps)).rejects.toThrow(
      /keine Position/i,
    )
    expect(runCalc).not.toHaveBeenCalled()
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 4: Pipeline-Aufruf – Gewerk-Wrapper + enforceUserStunden + Options-Durchreichung', async () => {
    const runCalc = vi.fn<RunCalcPipelineFn>(identityPipeline)
    const deps = defaultDeps({ runCalcPipeline: runCalc })

    await runAddPosition(defaultArgs(), deps)

    expect(runCalc).toHaveBeenCalledTimes(1)
    const [pipelineGewerke, pipelineOpts] = runCalc.mock.calls[0]
    // Die nackte Position wurde in die Gewerk-Struktur gewrappt.
    expect(pipelineGewerke).toHaveLength(1)
    expect(pipelineGewerke[0].name).toBe('Maler')
    expect(pipelineGewerke[0].positionen).toHaveLength(1)
    expect(pipelineGewerke[0].positionen[0].leistungsnummer).toBe('09-NEU')
    // Options 1:1 durchgereicht, User-Stundenangaben haben Vorrang.
    expect(pipelineOpts.catalog).toBe(EMPTY_CATALOG)
    expect(pipelineOpts.stundensaetze).toBe(STUNDENSAETZE)
    expect(pipelineOpts.settings).toBe(SETTINGS)
    expect(pipelineOpts.eingabeText).toBe(
      '25 m² Wände ausmalen zweifach, mittlere Qualität',
    )
    expect(pipelineOpts.enforceUserStunden).toBe(true)
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 5 (bonus): Katalog-Treffer → service-Position mit service_id aus dem Lookup', async () => {
    const aiComplete = vi.fn(
      async (): Promise<AiCompleteResult> =>
        makeAiResult({
          ...NAKED_POSITION,
          leistungsnummer: '09-001',
          aus_preisliste: true,
        }),
    )
    const deps = defaultDeps({ aiComplete })

    const result = await runAddPosition(
      defaultArgs({
        services: [
          { id: 'svc-1', service_number: '09-001', name: 'Wände ausmalen', unit: 'm²', vat_rate: 20 },
        ],
      }),
      deps,
    )

    const pos = result.positions.find((p) => p.type !== 'title')
    expect(pos).toBeDefined()
    expect(pos!.type).toBe('service')
    expect(pos!.service_id).toBe('svc-1')
    expect(pos!.vat_rate).toBe(20)
  })

  // ────────────────────────────────────────────────────────────────────────
  it('Test 6 (bonus): leerer Text → wirft sofort, ohne KI-Call', async () => {
    const aiComplete = vi.fn(async () => makeAiResult(NAKED_POSITION))
    const deps = defaultDeps({ aiComplete })

    await expect(
      runAddPosition(defaultArgs({ text: '   ' }), deps),
    ).rejects.toThrow(/Kein Text/)
    expect(aiComplete).not.toHaveBeenCalled()
  })
})

// ──── normalizeToGewerke (Wrapper-Vertrag) ─────────────────────────────────

describe('AddPositionDialog / normalizeToGewerke', () => {
  it('wrappt eine nackte Position in die Gewerk-Struktur (Prompt-Vertrag)', () => {
    const gewerke = normalizeToGewerke(NAKED_POSITION)
    expect(gewerke).toHaveLength(1)
    expect(gewerke[0].name).toBe('Maler')
    expect(gewerke[0].positionen).toHaveLength(1)
    expect(gewerke[0].positionen[0].gewerk).toBe('Maler')
  })

  it('leitet den Gewerk-Namen aus dem Leistungsnummer-Präfix ab, wenn gewerk fehlt', () => {
    const gewerke = normalizeToGewerke({
      leistungsnummer: '02-NEU',
      leistungsname: 'Fliesen abschlagen',
    })
    expect(gewerke).toHaveLength(1)
    expect(gewerke[0].name).toBe('Abbruch')
  })

  it('toleriert Arrays und gruppiert nach Gewerk (Wasserschaden-Sonderfall)', () => {
    const gewerke = normalizeToGewerke([
      { leistungsnummer: '09-400', leistungsname: 'Wasserfleck grundieren', gewerk: 'Maler' },
      { leistungsnummer: '09-410', leistungsname: 'Feuchtigkeitsmessung', gewerk: 'Maler' },
      { leistungsnummer: '02-NEU', leistungsname: 'Verputz abschlagen', gewerk: 'Abbruch' },
    ])
    expect(gewerke).toHaveLength(2)
    expect(gewerke[0].name).toBe('Maler')
    expect(gewerke[0].positionen).toHaveLength(2)
    expect(gewerke[1].name).toBe('Abbruch')
  })

  it('toleriert defensiv einen gewerke-Wrapper (Komplettangebot-Format)', () => {
    const gewerke = normalizeToGewerke({
      gewerke: [
        { name: 'Maler', positionen: [{ leistungsnummer: '09-NEU', leistungsname: 'x', gewerk: 'Maler' }] },
      ],
    })
    expect(gewerke).toHaveLength(1)
    expect(gewerke[0].name).toBe('Maler')
  })

  it('liefert [] für Antworten ohne erkennbare Position', () => {
    expect(normalizeToGewerke({})).toEqual([])
    expect(normalizeToGewerke(null)).toEqual([])
    expect(normalizeToGewerke('text')).toEqual([])
  })
})
