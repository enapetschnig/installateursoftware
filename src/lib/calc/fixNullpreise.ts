// ────────────────────────────────────────────────────────────────────────────
//  fixNullpreise – Nachkalkulation für Positionen mit vk_netto_einheit = 0.
//
//  Quelle: bau4you-app/src/lib/claude.js Z. 2073-2178.
//
//  Verhalten (vereinfachte Variante für b4y-superapp):
//    a) Reinigung (Präfix 13-)
//         m² / m2  → Katalog-Preis dieser Nr, sonst 13-100, sonst 10.40 €/m²
//         sonst    → Pauschal, mind. 1 h, Preis = stundensatz × max(1, menge)
//    b) Pauschal (einheit = pauschal/pausch/psch)
//         lohn = max(2 × stundensatz, bestehender Lohn)
//         vk   = lohn + material
//    c) Standard (m², lfm, Stk …) – braucht lohnkosten_minuten
//         lohn = (minuten/60) × stundensatz, gerundet auf 2 Dezimalen
//         vk   = lohn + material
//
//  Skip-Regeln:
//    • vk > 0  → unverändert
//    • XX-NEU* → unverändert (überlassen Modus-1)
//    • 01-001, 01-002 (Gemeinkosten-Anfahrt) → unverändert
//    • *-000 (Header) → unverändert
//    • Standard ohne lohnkosten_minuten → unverändert
//
//  Side-Effect-frei: gibt neue Strukturen zurück, mutiert Input nicht.
// ────────────────────────────────────────────────────────────────────────────

import { isSpecialPosition } from './dedup'
import { isRegiestundenPos } from './enrichFromCatalog'
import {
  GEWERK_PREFIX_MAP,
  type Catalog,
  type CatalogPosition,
  type Gewerk,
  type StundensaetzeMap,
} from './types'

const round2 = (n: number): number => Math.round(n * 100) / 100

const REINIGUNG_FALLBACK_M2 = 10.40
const REINIGUNG_FALLBACK_DEFAULT = 6.50

/**
 * Erkennt NEU-Positionen (XX-NEU, XX-NEU1 …). Diese werden NICHT angerührt.
 */
function isNeuPosition(nr: string): boolean {
  return /^\d{2}-NEU\d*$/i.test(nr)
}

/**
 * Erkennt Header-Positionen (XX-000 mit Bindestrich oder Geviertstrich).
 */
function isHeaderPosition(nr: string): boolean {
  return /[-–]\s*000$/.test(nr)
}

/**
 * Erkennt eine Pauschal-Einheit (pauschal, pausch, psch).
 */
function isPauschalEinheit(einheit: string): boolean {
  const e = einheit.toLowerCase().trim()
  return e === 'pauschal' || e === 'pausch' || e === 'psch'
}

/**
 * Erkennt m²/m2-Einheit (case-insensitive).
 */
function isM2Einheit(einheit: string): boolean {
  const e = einheit.toLowerCase().trim()
  return e === 'm²' || e === 'm2'
}

/**
 * Repariert Positionen mit vk_netto_einheit = 0 (oder null/undefined).
 *
 * @param gewerke        Liste der Gewerke mit Positionen
 * @param catalog        Katalog für Preis-Lookup und Regiestunden-Erkennung
 * @param stundensaetze  Map Gewerk-Name → Stundensatz €/h (Fallback 70)
 */
export function fixNullpreise(
  gewerke: Gewerk[] | null | undefined,
  catalog: Catalog | null | undefined,
  stundensaetze: StundensaetzeMap = {},
): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke || []

  const catalogPositionen: CatalogPosition[] = catalog?.positionen || []

  // ── Regie-Map: Präfix → Stundensatz aus Katalog-Regiestunden-Pos ──
  const regieMap: Record<string, number> = {}
  for (const entry of catalogPositionen) {
    const nr = String(entry.leistungsnummer || '')
    if (!isSpecialPosition(nr)) continue
    const preis = Number(entry.vk_netto_einheit || 0)
    if (preis <= 0) continue
    // Nur echte Regiestunden (Name+Einheit), keine Variable oder Material
    if (
      !isRegiestundenPos({
        leistungsname: entry.leistungsname,
        einheit: entry.einheit,
      })
    ) {
      continue
    }
    const prefix = nr.split('-')[0]
    if (prefix && regieMap[prefix] === undefined) regieMap[prefix] = preis
  }

  // ── Catalog-Preise (Nr → vk_netto_einheit > 0) ──
  const catalogPriceMap: Record<string, number> = {}
  for (const entry of catalogPositionen) {
    const nr = String(entry.leistungsnummer || '')
    const preis = Number(entry.vk_netto_einheit || 0)
    if (nr && preis > 0) catalogPriceMap[nr] = preis
  }

  return gewerke.map((gewerk) => {
    const prefix = GEWERK_PREFIX_MAP[gewerk.name]
    const stundensatz =
      (prefix && regieMap[prefix]) ||
      Number(stundensaetze?.[gewerk.name] || 0) ||
      70

    const positionen = (gewerk.positionen || []).map((pos) => {
      const nr = String(pos.leistungsnummer || '')

      // Skip: leer, NEU, Sonder-Ausnahmen, Header
      if (!nr) return pos
      if (isNeuPosition(nr)) return pos
      if (nr === '01-001' || nr === '01-002') return pos
      if (isHeaderPosition(nr)) return pos

      const vk = Number(pos.vk_netto_einheit) || 0
      if (vk > 0) return pos

      const menge = Number(pos.menge) || 1
      const einheit = String(pos.einheit || '').toLowerCase().trim()
      const material = round2(Number(pos.materialkosten_einheit) || 0)

      // ─── (a) Reinigung (Präfix 13-) ───────────────────────────────
      if (/^13-/.test(nr)) {
        const reinigungsSatz = regieMap['13'] || stundensatz
        let newPreis: number
        let minuten: number

        if (isM2Einheit(einheit)) {
          // 13-100 hat Sonderbehandlung (Feinreinigung) → Fallback 10.40
          // 13-001 und andere Reinigungs-Pos → Katalog oder 6.50
          const catalogPreis = catalogPriceMap[nr]
          if (catalogPreis !== undefined) {
            newPreis = round2(catalogPreis)
          } else if (nr === '13-100') {
            newPreis = REINIGUNG_FALLBACK_M2
          } else {
            // 13-001 und andere ohne Katalog-Eintrag
            newPreis = REINIGUNG_FALLBACK_DEFAULT
          }
          minuten = round2((newPreis / reinigungsSatz) * 60)
        } else {
          // Pauschal-Reinigung: mind. 1 Stunde
          minuten = Math.max(60, menge * 60)
          newPreis = round2((minuten / 60) * reinigungsSatz)
        }

        const newGesamt = round2(newPreis * menge)
        return {
          ...pos,
          vk_netto_einheit: newPreis,
          gesamtpreis: newGesamt,
          lohnkosten_einheit: newPreis,
          lohnkosten_minuten: minuten,
          stundensatz: reinigungsSatz,
          materialkosten_einheit: 0,
          materialanteil_prozent: 0,
          lohnanteil_prozent: 100,
        }
      }

      // ─── (b) Pauschal-Position ────────────────────────────────────
      if (isPauschalEinheit(einheit)) {
        const existingLohn = round2(Number(pos.lohnkosten_einheit) || 0)
        const minLohn = round2(2 * stundensatz)
        const lohn = Math.max(minLohn, existingLohn)
        const minuten = round2((lohn / stundensatz) * 60)
        const newPreis = round2(lohn + material)
        const newGesamt = round2(newPreis * menge)
        const materialAnteil = newPreis > 0 ? round2((material / newPreis) * 100) : 0
        const lohnAnteil = newPreis > 0 ? round2(100 - materialAnteil) : 100
        return {
          ...pos,
          vk_netto_einheit: newPreis,
          gesamtpreis: newGesamt,
          lohnkosten_einheit: round2(lohn),
          lohnkosten_minuten: minuten,
          stundensatz,
          materialkosten_einheit: material,
          materialanteil_prozent: materialAnteil,
          lohnanteil_prozent: lohnAnteil,
        }
      }

      // ─── (c) Standard (m², lfm, Stk …) ────────────────────────────
      // Braucht lohnkosten_minuten — sonst skip (siehe Spec).
      const minutenRaw = Number(pos.lohnkosten_minuten) || 0
      if (minutenRaw <= 0) return pos

      const minuten = round2(minutenRaw)
      const lohn = round2((minuten / 60) * stundensatz)
      const newPreis = round2(lohn + material)
      const newGesamt = round2(newPreis * menge)
      const materialAnteil = newPreis > 0 ? round2((material / newPreis) * 100) : 0
      const lohnAnteil = newPreis > 0 ? round2(100 - materialAnteil) : 100

      return {
        ...pos,
        vk_netto_einheit: newPreis,
        gesamtpreis: newGesamt,
        lohnkosten_einheit: lohn,
        lohnkosten_minuten: minuten,
        stundensatz,
        materialkosten_einheit: material,
        materialanteil_prozent: materialAnteil,
        lohnanteil_prozent: lohnAnteil,
      }
    })

    return { ...gewerk, positionen }
  })
}
