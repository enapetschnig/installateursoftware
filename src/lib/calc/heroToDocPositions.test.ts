// ────────────────────────────────────────────────────────────────────────────
//  heroToDocPositions.test.ts — Adapter Gewerk[] → DocPosition[]
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

import { heroToDocPositions, type HeroToDocOpts } from './heroToDocPositions'
import type { Gewerk, Position } from './types'

// ─────────────────────────────── Helpers ──────────────────────────────────

const pos = (overrides: Partial<Position> = {}): Position => ({
  leistungsnummer: '09-001',
  leistungsname: 'Wand spachteln Q3',
  beschreibung: 'Spachtelqualität Q3, schleiffähig',
  einheit: 'm²',
  menge: 10,
  materialkosten_einheit: 2,
  lohnkosten_einheit: 8,
  lohnkosten_minuten: 12,
  stundensatz: 70,
  vk_netto_einheit: 12,
  gesamtpreis: 120,
  aufschlag_prozent: 20,
  ...overrides,
})

const gewerk = (name: string, positionen: Position[]): Gewerk => ({
  name,
  positionen,
})

const baseOpts = (overrides: Partial<HeroToDocOpts> = {}): HeroToDocOpts => ({
  services: [
    { id: 'svc-09-001', service_number: '09-001', name: 'Wand spachteln Q3', unit: 'm²', vat_rate: 20 },
  ],
  ...overrides,
})

// ─────────────────────────────── Tests ────────────────────────────────────

describe('heroToDocPositions', () => {
  it('Test 1: 1 Gewerk mit 1 Katalog-Pos → 1 title + 1 service DocPosition', () => {
    const input = [gewerk('Maler', [pos()])]
    const out = heroToDocPositions(input, baseOpts())

    expect(out).toHaveLength(2)
    expect(out[0].type).toBe('title')
    expect(out[0].name).toBe('Maler')
    expect(out[0].level).toBe(1)

    const p = out[1]
    expect(p.type).toBe('service')
    expect(p.service_id).toBe('svc-09-001')
    expect(p.name).toBe('Wand spachteln Q3')
    expect(p.description).toBe('Spachtelqualität Q3, schleiffähig')
    expect(p.qty).toBe(10)
    expect(p.unit).toBe('m²')
    expect(p.unit_price).toBe(12)
    expect(p.unit_cost).toBe(10) // 2 + 8
    expect(p.material_cost).toBe(2)
    expect(p.labor_minutes).toBe(12)
    expect(p.vat_rate).toBe(20)
    expect(p.parent_title_id).toBe(out[0].id)
    expect(p.surcharge_baked).toBe(true)
    expect(p.is_variable).toBe(false)
    expect(p.is_regie_hour).toBe(false)
    expect(p.snapshot).not.toBeNull()
    expect(p.snapshot?.overhead_percent).toBe(20)
  })

  it('Test 2: Position NICHT im Katalog → type="free", service_id=null', () => {
    const input = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-NEU1', leistungsname: 'Erfinder-Leistung' }),
      ]),
    ]
    const out = heroToDocPositions(input, baseOpts())

    expect(out).toHaveLength(2)
    expect(out[1].type).toBe('free')
    expect(out[1].service_id).toBeNull()
    expect(out[1].name).toBe('Erfinder-Leistung')
    expect(out[1].parent_title_id).toBe(out[0].id)
  })

  it('Test 2b: onUnknownService="skip" überspringt unbekannte Positionen', () => {
    const input = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-NEU1', leistungsname: 'Unbekannt' }),
        pos({ leistungsnummer: '09-001', leistungsname: 'Bekannt' }),
      ]),
    ]
    const out = heroToDocPositions(input, baseOpts({ onUnknownService: 'skip' }))

    // 1 title + 1 bekannte Pos (die unbekannte gesprungen)
    expect(out).toHaveLength(2)
    expect(out[0].type).toBe('title')
    expect(out[1].type).toBe('service')
    expect(out[1].name).toBe('Bekannt')
  })

  it('Test 3: Mehrere Gewerke → mehrere title-Blocks in Reihenfolge', () => {
    const input = [
      gewerk('Abbruch', [
        pos({ leistungsnummer: '02-001', leistungsname: 'Wand abbrechen' }),
      ]),
      gewerk('Maler', [
        pos({ leistungsnummer: '09-001', leistungsname: 'Wand spachteln' }),
        pos({ leistungsnummer: '09-002', leistungsname: 'Decke streichen' }),
      ]),
    ]
    const opts = baseOpts({
      services: [
        { id: 'svc-02-001', service_number: '02-001', name: 'Wand abbrechen', unit: 'm²', vat_rate: 20 },
        { id: 'svc-09-001', service_number: '09-001', name: 'Wand spachteln', unit: 'm²', vat_rate: 20 },
        { id: 'svc-09-002', service_number: '09-002', name: 'Decke streichen', unit: 'm²', vat_rate: 20 },
      ],
    })

    const out = heroToDocPositions(input, opts)

    // title + pos | title + pos + pos
    expect(out).toHaveLength(5)
    expect(out[0].type).toBe('title')
    expect(out[0].name).toBe('Abbruch')
    expect(out[1].type).toBe('service')
    expect(out[1].parent_title_id).toBe(out[0].id)

    expect(out[2].type).toBe('title')
    expect(out[2].name).toBe('Maler')
    expect(out[3].type).toBe('service')
    expect(out[3].parent_title_id).toBe(out[2].id)
    expect(out[4].type).toBe('service')
    expect(out[4].parent_title_id).toBe(out[2].id)

    // Title-IDs sind eindeutig
    expect(out[0].id).not.toBe(out[2].id)
  })

  it('Test 4: Variable Position (-9NN) → is_variable=true', () => {
    const input = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-997', leistungsname: 'Sondertechnik' }),
        pos({ leistungsnummer: '09-001', leistungsname: 'Normal' }),
      ]),
    ]
    const opts = baseOpts({
      services: [
        { id: 'svc-09-997', service_number: '09-997', unit: 'm²' },
        { id: 'svc-09-001', service_number: '09-001', unit: 'm²' },
      ],
    })

    const out = heroToDocPositions(input, opts)
    const variable = out.find((p) => p.name === 'Sondertechnik')!
    const normal = out.find((p) => p.name === 'Normal')!

    expect(variable.is_variable).toBe(true)
    expect(normal.is_variable).toBe(false)
  })

  it('Test 5: Regie-Pos mit Einheit "Std" → is_regie_hour=true', () => {
    const input = [
      gewerk('Maler', [
        pos({
          leistungsnummer: '09-900',
          leistungsname: 'Regiestunde Maler',
          einheit: 'Std',
          menge: 5,
          vk_netto_einheit: 75,
        }),
      ]),
    ]
    const opts = baseOpts({
      services: [{ id: 'svc-09-900', service_number: '09-900', unit: 'Std', vat_rate: 20 }],
    })

    const out = heroToDocPositions(input, opts)
    expect(out[1].is_regie_hour).toBe(true)
    expect(out[1].unit).toBe('Std')

    // Case-insensitiv (auch "h", "Stunde" …)
    const input2 = [gewerk('Maler', [pos({ einheit: 'h' })])]
    const out2 = heroToDocPositions(input2, baseOpts())
    expect(out2[1].is_regie_hour).toBe(true)
  })

  it('Test 6: Input wird nicht mutiert (Object.freeze überlebt)', () => {
    const p = Object.freeze(pos())
    const g = Object.freeze(gewerk('Maler', Object.freeze([p]) as Position[]))
    const input = Object.freeze([g]) as Gewerk[]

    expect(() => heroToDocPositions(input, baseOpts())).not.toThrow()

    // Original-Werte unverändert
    expect(p.leistungsnummer).toBe('09-001')
    expect(p.vk_netto_einheit).toBe(12)
    expect(g.name).toBe('Maler')
    expect(g.positionen).toHaveLength(1)
  })

  it('Test 7: surcharge_baked=true und FrozenSnapshot enthält Hero-Felder', () => {
    const input = [
      gewerk('Maler', [
        pos({
          materialkosten_einheit: 3,
          lohnkosten_einheit: 9,
          lohnkosten_minuten: 12,
          aufschlag_prozent: 25,
          aus_preisliste: true,
          isVorschlag: true,
        }),
      ]),
    ]
    const out = heroToDocPositions(input, baseOpts())
    const p = out[1]

    expect(p.surcharge_baked).toBe(true)
    expect(p.snapshot).not.toBeNull()
    expect(p.snapshot?.overhead_percent).toBe(25)
    expect((p.snapshot?.totals as Record<string, unknown>)?.source).toBe('hero-pipeline')
    expect((p.snapshot?.totals as Record<string, unknown>)?.aus_preisliste).toBe(true)
    expect((p.snapshot?.totals as Record<string, unknown>)?.isVorschlag).toBe(true)
    expect((p.snapshot?.totals as Record<string, unknown>)?.service_id).toBe('svc-09-001')
    expect((p.snapshot?.totals as Record<string, unknown>)?.leistungsnummer).toBe('09-001')

    const materialComp = p.snapshot?.components.find((c) => c.kind === 'hero-material')
    const laborComp = p.snapshot?.components.find((c) => c.kind === 'hero-labor')
    expect(materialComp?.cost_rate).toBe(3)
    expect(laborComp?.cost_rate).toBe(9)
    expect(laborComp?.minutes).toBe(12)
  })

  it('Test 8: manuellBearbeitet → price_overridden=true (verhindert stille Preis-Updates)', () => {
    const input = [
      gewerk('Maler', [
        pos({ manuellBearbeitet: true, vk_netto_einheit: 99 }),
        pos({ leistungsnummer: '09-002', manuellBearbeitet: false }),
      ]),
    ]
    const opts = baseOpts({
      services: [
        { id: 'svc-09-001', service_number: '09-001', unit: 'm²', vat_rate: 20 },
        { id: 'svc-09-002', service_number: '09-002', unit: 'm²', vat_rate: 20 },
      ],
    })

    const out = heroToDocPositions(input, opts)
    expect(out[1].price_overridden).toBe(true)
    expect(out[1].unit_price).toBe(99)
    expect(out[2].price_overridden).toBe(false)
  })

  it('Test 9: Soft-deletes (deleted=true) werden übersprungen', () => {
    const input = [
      gewerk('Maler', [
        pos({ leistungsname: 'Bleibt' }),
        pos({ leistungsname: 'Geht weg', deleted: true }),
      ]),
    ]
    const out = heroToDocPositions(input, baseOpts())

    // 1 title + 1 lebende Pos
    expect(out).toHaveLength(2)
    expect(out[1].name).toBe('Bleibt')
  })

  it('Test 10: vat_rate fallback wenn service kein vat_rate liefert', () => {
    const input = [gewerk('Maler', [pos()])]
    const opts = baseOpts({
      services: [{ id: 'svc-09-001', service_number: '09-001', unit: 'm²' }],
      defaultVatRate: 10,
    })

    const out = heroToDocPositions(input, opts)
    expect(out[1].vat_rate).toBe(10)
  })

  it('Test 11: jede DocPosition hat eindeutige id', () => {
    const input = [
      gewerk('Maler', [
        pos({ leistungsnummer: '09-001' }),
        pos({ leistungsnummer: '09-002' }),
      ]),
      gewerk('Abbruch', [pos({ leistungsnummer: '02-001' })]),
    ]
    const opts = baseOpts({
      services: [
        { id: 'svc-09-001', service_number: '09-001', unit: 'm²' },
        { id: 'svc-09-002', service_number: '09-002', unit: 'm²' },
        { id: 'svc-02-001', service_number: '02-001', unit: 'm²' },
      ],
    })

    const out = heroToDocPositions(input, opts)
    const ids = out.map((p) => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
    expect(out.every((p) => typeof p.id === 'string' && p.id.length > 0)).toBe(true)
  })

  it('Test 12: leere Gewerke-Liste → leeres Array', () => {
    expect(heroToDocPositions([], baseOpts())).toEqual([])
  })
})
