// ────────────────────────────────────────────────────────────────────────────
//  heroToDocPositions.ts — Adapter: Hero-Pipeline-Output → DocPosition[]
//
//  Die Calc-Pipeline (siehe pipeline.ts) liefert Gewerk[] im Hero-Format
//  (siehe types.ts: Position, Gewerk). Der OfferEditor und alle abgeleiteten
//  Dokumente (Auftrag/Rechnung/Nachtrag …) arbeiten jedoch mit dem b4y-internen
//  DocPosition[]-Modell (siehe document-types.ts).
//
//  Dieser Adapter:
//   1. Erzeugt für jedes Gewerk eine "title"-DocPosition (Level 1).
//   2. Mappt jede Hero-Position auf eine "service"- oder "free"-DocPosition.
//   3. Lookt service_id über die service_number aus dem mitgegebenen Katalog.
//   4. Setzt die Pipeline-Schutzflags (surcharge_baked=true, da Hero-VK bereits
//      inkl. Aufschlag) sowie is_variable / is_regie_hour.
//   5. Friert einen FrozenSnapshot mit den Hero-Feldern ein, damit ein späterer
//      "Preise aktualisieren"-Lauf erkennt, dass diese Positionen aus der
//      KI-Pipeline stammen (Recalc-Stop bei Bedarf).
//   6. Mutiert das Input-Array nicht (defensive Kopien, kein In-Place).
//
//  Erwartete Ausgabe ist NICHT renumber()/applySurcharge'd — das macht
//  der Caller (OfferEditor → setPositions → automatischer renumber).
// ────────────────────────────────────────────────────────────────────────────

import type { FrozenSnapshot } from '../offer-types'
import { type DocPosition, emptyPosition, uid } from '../document-types'
import type { Gewerk, Position } from './types'

// ─────────────────────────── Options ──────────────────────────────────────

export interface HeroToDocOpts {
  /**
   * Stammdaten-Lookup. Alle Felder optional bis auf id+service_number,
   * damit Tests/Caller nicht eine vollständige Service-Row mitschleppen müssen.
   */
  services: Array<{
    id: string
    service_number: string
    name?: string
    unit?: string
    vat_rate?: number | null
  }>

  /**
   * Wie soll mit Positionen umgegangen werden deren leistungsnummer NICHT
   * in `services` gefunden wird (z. B. "XX-NEU" oder unbekannte Hero-Nummer)?
   *
   *  - "create_free": als type="free" einfügen (Default — User sieht alles)
   *  - "skip":        Position überspringen (nichts einfügen)
   */
  onUnknownService?: 'create_free' | 'skip'

  /**
   * Default-MwSt wenn der Service kein `vat_rate` mitbringt und die Position
   * auch keinen vat_rate-Hinweis hat. Default 20 (AT-Standard).
   */
  defaultVatRate?: number
}

// ─────────────────────────── Helpers ──────────────────────────────────────

const VARIABLE_RE = /-9\d{2}$/
const HOUR_UNITS = new Set(['std', 'stunde', 'stunden', 'h'])

function isVariableNumber(leistungsnummer: string | null | undefined): boolean {
  if (!leistungsnummer) return false
  return VARIABLE_RE.test(leistungsnummer)
}

function isRegieHourUnit(einheit: string | null | undefined): boolean {
  if (!einheit) return false
  return HOUR_UNITS.has(String(einheit).trim().toLowerCase())
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function buildSnapshot(pos: Position, serviceId: string | null): FrozenSnapshot {
  const material = num(pos.materialkosten_einheit)
  const labor = num(pos.lohnkosten_einheit)
  const minutes = num(pos.lohnkosten_minuten)
  const stundensatz = num(pos.stundensatz)
  const vk = num(pos.vk_netto_einheit)
  const aufschlag = num(pos.aufschlag_prozent)
  const cost = material + labor

  return {
    frozen_at: new Date().toISOString(),
    overhead_percent: aufschlag,
    components: [
      {
        kind: 'hero-material',
        label: 'Material',
        unit: pos.einheit ?? null,
        minutes: 0,
        quantity: 1,
        cost_rate: material,
        sale_rate: material,
        percent: num(pos.materialanteil_prozent),
      },
      {
        kind: 'hero-labor',
        label: 'Lohn',
        unit: 'min',
        minutes,
        quantity: 1,
        cost_rate: labor,
        sale_rate: labor,
        percent: num(pos.lohnanteil_prozent),
      },
    ],
    totals: {
      source: 'hero-pipeline',
      service_id: serviceId,
      leistungsnummer: pos.leistungsnummer ?? null,
      cost_per_unit: cost,
      vk_per_unit: vk,
      aufschlag_prozent: aufschlag,
      stundensatz,
      aus_preisliste: pos.aus_preisliste === true,
      manuellBearbeitet: pos.manuellBearbeitet === true,
      isVorschlag: pos.isVorschlag === true,
    },
  }
}

// ─────────────────────────── Adapter ──────────────────────────────────────

/**
 * Konvertiert Hero-Pipeline-Output (Gewerk[]) in das b4y-interne
 * DocPosition[]-Modell für den OfferEditor.
 *
 * Reihenfolge der Ausgabe:
 *   gewerk[0].title, gewerk[0].positionen…, gewerk[1].title, gewerk[1].positionen…
 *
 * Numbering (DocPosition.number) wird NICHT gesetzt — das übernimmt renumber()
 * im Editor / beim Speichern.
 */
export function heroToDocPositions(
  gewerke: Gewerk[],
  opts: HeroToDocOpts
): DocPosition[] {
  if (!Array.isArray(gewerke)) return []

  const onUnknown: 'create_free' | 'skip' = opts.onUnknownService ?? 'create_free'
  const defaultVat = num(opts.defaultVatRate, 20)

  // Lookup-Map: service_number → service-Eintrag.
  const svcByNumber = new Map<string, HeroToDocOpts['services'][number]>()
  for (const s of opts.services ?? []) {
    if (s && typeof s.service_number === 'string' && s.service_number) {
      svcByNumber.set(s.service_number, s)
    }
  }

  const out: DocPosition[] = []

  for (const gewerk of gewerke) {
    if (!gewerk || typeof gewerk !== 'object') continue
    const positionen = Array.isArray(gewerk.positionen) ? gewerk.positionen : []

    // ── 1) Title-Position für das Gewerk ────────────────────────────────
    const titleId = uid()
    const titlePos: DocPosition = emptyPosition('title', {
      id: titleId,
      level: 1,
      name: String(gewerk.name ?? '').trim() || 'Gewerk',
    })
    out.push(titlePos)

    // ── 2) Pro Hero-Position eine DocPosition ───────────────────────────
    for (const pos of positionen) {
      if (!pos || typeof pos !== 'object') continue
      if (pos.deleted === true) continue // Soft-deletes überspringen

      const leistungsnummer = pos.leistungsnummer ?? null
      const svc = leistungsnummer ? svcByNumber.get(leistungsnummer) : undefined

      const isKnown = !!svc
      if (!isKnown && onUnknown === 'skip') continue

      const material = num(pos.materialkosten_einheit)
      const labor = num(pos.lohnkosten_einheit)
      const vk = num(pos.vk_netto_einheit)
      const menge = num(pos.menge, 1)
      const minutes = num(pos.lohnkosten_minuten)
      const einheit = (pos.einheit ?? svc?.unit ?? 'Stk').toString() || 'Stk'

      const vatRate = (() => {
        if (svc && svc.vat_rate !== undefined && svc.vat_rate !== null) {
          return num(svc.vat_rate, defaultVat)
        }
        return defaultVat
      })()

      // surcharge_baked = true:
      //   Die Hero-Pipeline rechnet aufschlagGesamt (und ggf. Material-Aufschlag)
      //   BEREITS in vk_netto_einheit ein. applySurchargeToPositions() darf den
      //   Preis NICHT noch einmal hochziehen.
      const docPos: DocPosition = emptyPosition(isKnown ? 'service' : 'free', {
        id: uid(),
        service_id: isKnown ? svc!.id : null,
        parent_title_id: titleId,
        level: 1,
        name: String(pos.leistungsname ?? '').trim() || (isKnown ? (svc?.name ?? '') : ''),
        description: pos.beschreibung != null ? String(pos.beschreibung) : null,
        qty: menge,
        unit: einheit,
        unit_price: vk,
        unit_cost: material + labor,
        material_cost: material,
        labor_minutes: minutes,
        vat_rate: vatRate,
        is_variable: isVariableNumber(leistungsnummer),
        is_regie_hour: isRegieHourUnit(pos.einheit),
        // Hero-VK ist bereits inkl. Aufschlag → Doppelanwendung verhindern.
        surcharge_baked: true,
        // Bei User-Override im voice-driven Flow markieren wir den Preis als
        // manuell gesetzt, damit "Preise aktualisieren" nicht still überschreibt.
        price_overridden: pos.manuellBearbeitet === true,
        snapshot: buildSnapshot(pos, isKnown ? svc!.id : null),
      })

      out.push(docPos)
    }
  }

  return out
}
