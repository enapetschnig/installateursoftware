/**
 * One-Shot-Import: Hero-Stammdaten (gespiegelt in bau4you.catalog) → b4y-superapp
 *
 * KONTEXT (vom User mehrfach betont):
 *   - bau4you-app wird NIE angefasst → wir lesen nur die catalog-Tabelle READ-ONLY
 *   - Hero-API wird NICHT aufgerufen (Daten sind bereits in bau4you-Supabase gespiegelt)
 *   - Einmaliger Import (kein Cron, kein Re-Import-Knopf)
 *   - Konflikt-Strategie: "Hero gewinnt" — bestehende b4y-Services mit gleicher
 *     service_number werden UPDATE-overridden mit Hero-Werten
 *   - vk_net_manual = Hero.preis 1:1 (überspringt aufschlag_percent-Rechnung)
 *   - bau4you-Bug "sale_rate ignoriert" wird HIER nicht gefixt — Phase-1-calc nutzt
 *     bereits service_components mit sale_rate; der Bug entstand durch UI die nur
 *     internal_rate setzt. Wir setzen sale_rate KORREKT aus stundensaetze_json.
 *
 * Aufruf:
 *   tsx scripts/import-hero-to-b4y.ts
 *
 * Erwartete Env-Vars (oder hartkodiert in dieser Datei via const):
 *   SUPABASE_ACCESS_TOKEN  – sbp_… Token (account-weit gültig)
 *   B4Y_PROJECT_REF        – Default: pqwcpgmsutpbuvdzslbc
 *   BAU4YOU_PROJECT_REF    – Default: ukeadjwvyvytvfybgoja
 *   ORG_ID                 – Default: aus b4y `organizations`-Tabelle gelesen
 *   DRY_RUN                – wenn 'true', keine Writes
 *
 * Quelle der Daten:
 *   bau4you.public.catalog WHERE is_active=true
 *     - data_json: Position[] mit { nr, name, gewerk, einheit, preis, hero_id,
 *                                   zeit_min, beschreibung, lohn_minuten,
 *                                   stundensatz_pos, lohnkosten_einheit,
 *                                   material_enthalten, materialkosten_einheit }
 *     - stundensaetze_json: Record<gewerk, €/h>
 */

import {
  GEWERK_PREFIX_MAP,
  GEWERKE_REIHENFOLGE,
} from '../src/lib/calc/types'
import { isReservedSpecialServiceNumber } from '../src/lib/service-numbers'

// ── Konfiguration ────────────────────────────────────────────────────────────

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!ACCESS_TOKEN) {
  console.error('FEHLER: SUPABASE_ACCESS_TOKEN nicht gesetzt')
  process.exit(1)
}

const B4Y_PROJECT_REF = process.env.B4Y_PROJECT_REF || 'pqwcpgmsutpbuvdzslbc'
const BAU4YOU_PROJECT_REF = process.env.BAU4YOU_PROJECT_REF || 'ukeadjwvyvytvfybgoja'
const DRY_RUN = process.env.DRY_RUN === 'true'

// ── Hero-Position-Schema (im JSONB) ──────────────────────────────────────────

interface HeroCatalogPos {
  nr: string
  name: string
  gewerk: string
  einheit: string
  preis: number
  hero_id?: number
  zeit_min?: number
  beschreibung?: string
  lohn_minuten?: number
  stundensatz_pos?: number
  lohnkosten_einheit?: number
  material_enthalten?: boolean
  materialkosten_einheit?: number
}

interface HeroStundensaetze {
  [gewerk: string]: number
}

// ── Management-API-Helper ────────────────────────────────────────────────────

async function dbQuery<T = unknown>(
  projectRef: string,
  sql: string,
): Promise<T[]> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Query failed ${res.status} (${projectRef}): ${body}`)
  }
  const result = (await res.json()) as T[] | { message: string }
  if (!Array.isArray(result)) {
    throw new Error(`Query returned non-array: ${JSON.stringify(result)}`)
  }
  return result
}

// ── Mapping-Helpers ──────────────────────────────────────────────────────────

/** Sanitize-Funktion für SQL-String-Literale (escaped single quotes). */
function sqlString(value: string | number | null | undefined | boolean): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${String(value).replace(/'/g, "''")}'`
}

// ── Import-Pipeline ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Hero → b4y-superapp Stammdaten-Import')
  console.log(`  bau4you-Ref:  ${BAU4YOU_PROJECT_REF}`)
  console.log(`  b4y-Ref:      ${B4Y_PROJECT_REF}`)
  console.log(`  DRY_RUN:      ${DRY_RUN}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 1. Organization-ID aus b4y holen (single-tenant aktuell)
  const orgs = await dbQuery<{ id: string; name: string }>(
    B4Y_PROJECT_REF,
    `select id, name from public.organizations limit 1;`,
  )
  if (orgs.length === 0) {
    throw new Error('Keine Organization in b4y-superapp gefunden')
  }
  const organizationId = orgs[0].id
  console.log(`✓ Organization: ${orgs[0].name} (${organizationId})`)

  // 2. Aktive catalog-Version aus bau4you lesen
  const catalogRows = await dbQuery<{
    id: string
    name: string
    data_json: HeroCatalogPos[]
    stundensaetze_json: HeroStundensaetze
  }>(
    BAU4YOU_PROJECT_REF,
    `select id, name, data_json, stundensaetze_json
     from public.catalog
     where is_active = true
     order by uploaded_at desc
     limit 1;`,
  )
  if (catalogRows.length === 0) {
    throw new Error('Keine aktive catalog-Version in bau4you gefunden')
  }
  const { name: catalogName, data_json, stundensaetze_json } = catalogRows[0]
  console.log(`✓ Hero-Katalog: ${catalogName} (${data_json.length} Positionen)`)
  console.log(`✓ Stundensätze: ${Object.keys(stundensaetze_json).length} Gewerke`)

  // 3. Trades anlegen/aktualisieren (alle 14 Gewerke aus GEWERKE_REIHENFOLGE + alle in Hero verwendeten)
  const heroGewerke = new Set<string>()
  for (const pos of data_json) heroGewerke.add(pos.gewerk)
  for (const gewerk of Object.keys(stundensaetze_json)) heroGewerke.add(gewerk)
  const allTrades = new Set<string>([...GEWERKE_REIHENFOLGE, ...heroGewerke])

  console.log(`\n[1/4] Trades importieren (${allTrades.size} unique)...`)
  const tradeIdMap = new Map<string, string>() // gewerk-name → trade.id

  for (const gewerkName of allTrades) {
    const code = GEWERK_PREFIX_MAP[gewerkName] || null
    // sort_order = kanonischer Leistungsnummer-Präfix (GEWERK_PREFIX_MAP), wenn vorhanden.
    // So bleibt gewerkNo(sort_order) auch bei einem ERNEUTEN Import deckungsgleich mit den
    // Nummern-Präfixen (z. B. Reinigung=13, Elektrozuleitung=16) – ohne dass die einmalige
    // Datenausrichtungs-Migration 0095 erneut laufen müsste. Fallback: Reihenfolge-Index+1
    // (1-basiert, damit gewerkNo() eine Nummer liefert – gewerkNo(0) wäre null), sonst 999.
    const idx = GEWERKE_REIHENFOLGE.indexOf(gewerkName)
    const prefixNo = code && /^\d{2}$/.test(code) ? parseInt(code, 10) : null
    const sortOrder = prefixNo ?? (idx >= 0 ? idx + 1 : 999)
    const trade = await upsertTrade(
      gewerkName,
      code,
      sortOrder,
      organizationId,
    )
    tradeIdMap.set(gewerkName, trade.id)
  }

  // 4. Hourly Rates: aus stundensaetze_json + 70 €/h Default für unbekannte
  console.log(`\n[2/4] Hourly Rates importieren...`)
  for (const [gewerkName, satz] of Object.entries(stundensaetze_json)) {
    const tradeId = tradeIdMap.get(gewerkName)
    if (!tradeId) {
      console.warn(`  ⚠ Gewerk "${gewerkName}" nicht in trades — skip Hourly Rate`)
      continue
    }
    await upsertHourlyRate(gewerkName, tradeId, satz, organizationId)
  }

  // 5. Services importieren — vk_net_manual = Hero.preis (1:1 Cent-genau)
  console.log(`\n[3/4] Services importieren (${data_json.length} Positionen)...`)
  let inserted = 0
  let updated = 0
  let skipped = 0

  for (let i = 0; i < data_json.length; i++) {
    const pos = data_json[i]
    if (!pos.nr || !pos.name) {
      skipped++
      continue
    }
    const tradeId = tradeIdMap.get(pos.gewerk)
    if (!tradeId) {
      console.warn(`  ⚠ ${pos.nr} ${pos.name}: Gewerk "${pos.gewerk}" unbekannt — skip`)
      skipped++
      continue
    }

    const result = await upsertService(pos, tradeId, organizationId)
    if (result === 'inserted') inserted++
    else if (result === 'updated') updated++

    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${data_json.length} (✓ neu: ${inserted} · ↻ update: ${updated} · ⊘ skip: ${skipped})`)
    }
  }
  console.log(`  ✓ Services fertig: ${inserted} neu · ${updated} aktualisiert · ${skipped} skip`)

  // 6. Trades.default_surcharge_percent: pro Gewerk 20% Default (kann später angepasst werden)
  console.log(`\n[4/4] Trades default_surcharge_percent setzen (20% Default)...`)
  for (const tradeId of tradeIdMap.values()) {
    if (!DRY_RUN) {
      await dbQuery(
        B4Y_PROJECT_REF,
        `update public.trades
         set default_surcharge_percent = 20
         where id = '${tradeId}'
           and default_surcharge_percent = 0;`,
      )
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`✓ Import abgeschlossen (${DRY_RUN ? 'DRY_RUN' : 'PERSISTED'})`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

// ── Upsert-Implementierungen ─────────────────────────────────────────────────

async function upsertTrade(
  name: string,
  code: string | null,
  sortOrder: number,
  orgId: string,
): Promise<{ id: string; existed: boolean }> {
  // Lookup by name + organization_id
  const existing = await dbQuery<{ id: string }>(
    B4Y_PROJECT_REF,
    `select id from public.trades
     where organization_id = '${orgId}'
       and lower(name) = lower('${name.replace(/'/g, "''")}')
     limit 1;`,
  )
  if (existing.length > 0) {
    if (!DRY_RUN && code) {
      // Update code falls leer (Hero ist Wahrheit)
      await dbQuery(
        B4Y_PROJECT_REF,
        `update public.trades
         set code = coalesce(code, '${code}'),
             sort_order = ${sortOrder}
         where id = '${existing[0].id}';`,
      )
    }
    return { id: existing[0].id, existed: true }
  }
  // Insert
  if (DRY_RUN) {
    return { id: '00000000-0000-0000-0000-000000000000', existed: false }
  }
  const inserted = await dbQuery<{ id: string }>(
    B4Y_PROJECT_REF,
    `insert into public.trades (organization_id, name, code, sort_order, active)
     values ('${orgId}', ${sqlString(name)}, ${sqlString(code)}, ${sortOrder}, true)
     returning id;`,
  )
  return { id: inserted[0].id, existed: false }
}

async function upsertHourlyRate(
  gewerkName: string,
  tradeId: string,
  satzEUR: number,
  orgId: string,
): Promise<void> {
  const label = `${gewerkName} (Standard)`
  const existing = await dbQuery<{ id: string }>(
    B4Y_PROJECT_REF,
    `select id from public.hourly_rates
     where organization_id = '${orgId}'
       and trade_id = '${tradeId}'
       and label = ${sqlString(label)}
     limit 1;`,
  )
  if (existing.length > 0) {
    if (!DRY_RUN) {
      // Hero gewinnt: sale_rate aktualisieren
      await dbQuery(
        B4Y_PROJECT_REF,
        `update public.hourly_rates
         set sale_rate = ${satzEUR},
             internal_rate = case when internal_rate = 0 then ${satzEUR} else internal_rate end
         where id = '${existing[0].id}';`,
      )
    }
    return
  }
  if (DRY_RUN) return
  await dbQuery(
    B4Y_PROJECT_REF,
    `insert into public.hourly_rates (organization_id, trade_id, label, internal_rate, sale_rate, active)
     values ('${orgId}', '${tradeId}', ${sqlString(label)}, ${satzEUR}, ${satzEUR}, true);`,
  )
}

/**
 * Trennt einen Hero-Beschreibungstext in echte Beschreibung + Berechnungs-/Staffelpreis-Block.
 * Alles ab dem ersten "Berechnung:" (case-insensitive) wird zur Berechnung; davor die Beschreibung.
 * Robust gegen "Berechnung:von" / Whitespace / Umbrueche (vgl. Migration 0097-Backfill).
 */
function splitBerechnung(text: string): { beschreibung: string; berechnung: string } {
  const t = text || ''
  const m = t.match(/Berechnung:/i)
  if (!m || m.index === undefined) return { beschreibung: t.trim(), berechnung: '' }
  const beschreibung = t.slice(0, m.index).replace(/\s+$/, '').trim()
  const berechnung = t.slice(m.index + m[0].length).replace(/^\s+|\s+$/g, '').trim()
  return { beschreibung, berechnung }
}

async function upsertService(
  pos: HeroCatalogPos,
  tradeId: string,
  orgId: string,
): Promise<'inserted' | 'updated' | 'skipped'> {
  // Reservierte Spezialnummern XX-980–999 (Variable Position / Regiestunde /
  // Regie-Material) werden NICHT importiert. Diese Positionen werden seit Migration
  // 0060 dokumentlokal über die Editor-Buttons erzeugt; als Katalog-Leistungen würden
  // sie die saubere Regie-/Variable-Logik doppeln und in der Sidebar erscheinen.
  if (isReservedSpecialServiceNumber(pos.nr)) {
    return 'skipped'
  }

  // Lookup by service_number (Hero "nr" wie "09-001")
  const existing = await dbQuery<{ id: string }>(
    B4Y_PROJECT_REF,
    `select id from public.services
     where organization_id = '${orgId}'
       and service_number = ${sqlString(pos.nr)}
     limit 1;`,
  )

  // Note: in dieser ersten Version setzen wir KEINE service_components.
  // Die Pipeline kennt die Werte ueber DocPosition.material_cost/labor_minutes
  // (gespiegelt aus dem _katalog_snapshot beim Anlegen einer Position).
  // service_components werden in Phase 2.5 nachgereicht falls benoetigt.

  const note = `Hero ID: ${pos.hero_id || 'unknown'} · Import aus bau4you.catalog am ${new Date().toISOString().slice(0, 10)}`
  const split = splitBerechnung(pos.beschreibung || '')
  const fields = {
    organization_id: `'${orgId}'`,
    service_number: sqlString(pos.nr),
    name: sqlString(pos.name),
    short_text: sqlString(pos.name),
    long_text: sqlString(split.beschreibung),
    calculation_text: split.berechnung ? sqlString(split.berechnung) : 'NULL',
    trade_id: `'${tradeId}'`,
    unit: sqlString(pos.einheit || 'Stk'),
    vk_net_manual: sqlString(pos.preis || 0),
    aufschlag_percent: '0', // Hero-Preis ist bereits inkl. Aufschlag
    material_mode: sqlString('artikel'),
    pauschale_active: 'FALSE',
    pauschale_type: sqlString('kein'),
    pauschale_fix: '0',
    pauschale_percent: '0',
    overhead_percent: '0',
    vat_rate: '20',
    sort_order: '0',
    internal_note: sqlString(note),
    active: 'TRUE',
    // Importierte Katalog-Leistungen sind NIE Variable-Templates. Variable/Regie-
    // Positionen (XX-980–999) werden oben übersprungen und dokumentlokal erzeugt.
    // (Früher wurde hier fälschlich /-9\d{2}$/ markiert – traf auch echte Leistungen
    // wie „Mulde" XX-910.)
    is_variable_template: 'FALSE',
  }

  if (existing.length > 0) {
    // UPDATE: Hero gewinnt
    if (DRY_RUN) return 'updated'
    const setClause = Object.entries(fields)
      .filter(([k]) => k !== 'organization_id') // org_id nie aendern
      .map(([k, v]) => `${k} = ${v}`)
      .join(', ')
    await dbQuery(
      B4Y_PROJECT_REF,
      `update public.services set ${setClause} where id = '${existing[0].id}';`,
    )
    return 'updated'
  }

  // INSERT
  if (DRY_RUN) return 'inserted'
  const cols = Object.keys(fields).join(', ')
  const vals = Object.values(fields).join(', ')
  await dbQuery(
    B4Y_PROJECT_REF,
    `insert into public.services (${cols}) values (${vals});`,
  )
  return 'inserted'
}

// ── Entry-Point ──────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('FEHLER:', err)
  process.exit(1)
})
