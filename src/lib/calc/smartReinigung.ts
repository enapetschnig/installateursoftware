// ────────────────────────────────────────────────────────────────────────────
//  smartReinigung.ts – Heuristische Bodenflächen-Schätzung und automatische
//  Reinigungs-Position für ein Angebot.
//
//  Quelle: bau4you-app/src/lib/claude.js Z. 2386-2645.
//
//  Pipeline-Verhalten (1:1 mit bau4you, mit den im Task-Spec genannten
//  Konstanten):
//
//    1. bodenFlaecheSchaetzen(gewerke, eingabeText?)
//         Priorität:
//           a) Position mit Abdeckarbeiten/abdecken (Boden) → menge
//           b) Bodenleger (Prefix 05-) oder Fliesenleger-Boden (06-) → menge
//           c) Wand-Pos im Maler-Gewerk → menge / 3
//           d) Räume aus Eingabe-Text → RAUM_M2-Lookup summieren
//           e) Fallback DEFAULT_BODEN_M2 = 40
//         Cap: MAX_BODEN_M2 = 200
//
//    2. braucht_feinreinigung(gewerke)
//         True wenn STAUBINTENSIV_KW in Positions-Name/Beschreibung vorkommt.
//
//    3. smartReinigung(gewerke, catalog, stundensaetze, opts?)
//         - Manuell bearbeitete Reinigung oder reinigungEntfernt=true → unverändert.
//         - Art:  bodenFlaeche <= 10 m²  → Stunden-Reinigung
//                 braucht_feinreinigung() → 13-100 (Feinrein)
//                 sonst                   → 13-001 (Besenrein)
//         - VK kommt aus Katalog, sonst FEINREIN_PREIS_FALLBACK = 10.40
//         - Hard-Cap REINIGUNGS_CAP = 3000 € → Menge wird so reduziert dass
//           gesamtpreis exakt = REINIGUNGS_CAP (vk_netto bleibt).
//         - Reinigung-Gewerk wird ans Ende gehängt oder ersetzt.
//
//  Pure: das Input-Array und alle Positionen werden nie mutiert (spread).
// ────────────────────────────────────────────────────────────────────────────

import { isSpecialPosition } from './dedup'
import {
  STAUBINTENSIV_KW,
  type Catalog,
  type CatalogPosition,
  type Gewerk,
  type Position,
  type StundensaetzeMap,
} from './types'

// ─── Konstanten (Task-Spec) ───────────────────────────────────────────────

export const REINIGUNGS_CAP = 3000
export const DEFAULT_BODEN_M2 = 40
export const MAX_BODEN_M2 = 200
export const FEINREIN_PREIS_FALLBACK = 10.4

/**
 * Default-m²-Werte pro Raumtyp – für die Text-Schätzung der Bodenfläche.
 * Wird nur verwendet wenn keine Positions-Hinweise greifen.
 */
export const RAUM_M2: Readonly<Record<string, number>> = Object.freeze({
  bad: 6,
  wc: 3,
  küche: 12,
  kueche: 12,
  wohnzimmer: 25,
  schlafzimmer: 18,
  kinderzimmer: 14,
  vorzimmer: 8,
  flur: 6,
  abstellraum: 4,
  speis: 4,
  arbeitszimmer: 15,
  esszimmer: 16,
})

// ─── Helpers ──────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Normalisiert einen String für Case-/Umlaut-insensitive Substring-Vergleiche.
 * Lokal dupliziert – identisch mit dem Helper in `dedup.ts` (Z. 119-125).
 * Bewusst nicht importiert (norm ist dort nicht exportiert) und außerdem
 * trivial – Aufwand für einen geteilten Import wäre größer als der Nutzen.
 */
const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')

/** Prüft ob ein Einheits-String eine echte Flächeneinheit ist (m², m2). */
const istFlaechenEinheit = (e: unknown): boolean => {
  const u = String(e ?? '').trim().toLowerCase()
  return u === 'm²' || u === 'm2' || u === 'm ²'
}

/** Liefert die Positionen eines Gewerks als Array – auch wenn undefined. */
const positionsOf = (g: Gewerk): Position[] => g.positionen || []

/** Liefert true wenn das Gewerk ein Reinigungs-Gewerk ist. */
const isReinigungGewerk = (g: Gewerk): boolean =>
  norm(g.name).includes('reinigung')

/**
 * Findet eine Katalog-Position über die Leistungsnummer.
 * Akzeptiert sowohl `Catalog`-Objekt als auch ein loses Array von
 * Katalogeinträgen (z. B. wenn der Aufrufer direkt ein Hero-Array hat).
 */
function findCatalogEntry(
  catalog: Catalog | CatalogPosition[] | null | undefined,
  nr: string,
): CatalogPosition | undefined {
  if (!catalog) return undefined
  const arr = Array.isArray(catalog) ? catalog : catalog.positionen
  if (!arr) return undefined
  return arr.find((e) => String(e.leistungsnummer || '') === nr)
}

// ─── 1) bodenFlaecheSchaetzen ─────────────────────────────────────────────

/** Keywords für Abdeckarbeiten am Boden (höchste Priorität). */
const ABDECKBODEN_KW: readonly string[] = [
  'abdeckarbeiten boden',
  'bodenflaechen abdecken',
  'bodenflächen abdecken',
  'abdeckpapier',
  'boden abdecken',
  'abdecken boden',
  'bodenabdeckung',
  'boeden abdecken',
  'abdeckarbeiten',
]

/**
 * Schätzt die Bodenfläche eines Bauprojekts aus den vorhandenen Positionen
 * und – als letzte Quelle – aus dem freien Eingabetext.
 *
 * Reihenfolge (höchste Priorität zuerst):
 *   1. Abdeckarbeiten/Bodenabdeckung-Pos in m² → menge
 *   2. Bodenleger (Prefix 05-) oder Fliesenleger-Boden (06-) in m² → menge
 *   3. Wand-Pos im Maler-Gewerk in m² → menge / 3
 *   4. Räume aus Eingabe-Text (RAUM_M2-Lookup) → summieren
 *   5. Fallback DEFAULT_BODEN_M2 (40)
 *
 * Hard-Cap: MAX_BODEN_M2 (200).
 *
 * @param gewerke Aktuelle Angebots-Gewerke (read-only – wird nicht mutiert).
 * @param eingabeText Optional: User-Freitext der ursprünglichen Anfrage.
 */
export function bodenFlaecheSchaetzen(
  gewerke: Gewerk[] | null | undefined,
  eingabeText?: string | null,
): number {
  const list = gewerke || []

  // ── Priorität 1: Abdeckarbeiten Boden ─────────────────────────────────
  let abdeckBodenM2 = 0
  for (const g of list) {
    if (isReinigungGewerk(g)) continue
    for (const p of positionsOf(g)) {
      if (!istFlaechenEinheit(p.einheit)) continue
      const menge = Number(p.menge) || 0
      if (menge <= 0) continue
      const posText = norm(`${p.leistungsname || ''} ${p.beschreibung || ''}`)
      if (ABDECKBODEN_KW.some((kw) => posText.includes(kw))) {
        abdeckBodenM2 = Math.max(abdeckBodenM2, menge)
      }
    }
  }
  if (abdeckBodenM2 > 0) {
    return Math.min(Math.round(abdeckBodenM2), MAX_BODEN_M2)
  }

  // ── Priorität 2: Bodenleger (05-) / Fliesenleger-Boden (06-) ──────────
  let bodenflaecheDirekt = 0
  // ── Priorität 3: Wand-Pos im Maler-Gewerk ─────────────────────────────
  let wandflaecheMaler = 0

  for (const g of list) {
    if (isReinigungGewerk(g)) continue
    const gn = norm(g.name)
    const istBodenleger = gn.includes('bodenleger') || gn.includes('parkett')
    const istFliesenleger = gn.includes('fliesenleger')
    const istMaler = gn.includes('maler') || gn.includes('anstreicher')

    for (const p of positionsOf(g)) {
      if (!istFlaechenEinheit(p.einheit)) continue
      const menge = Number(p.menge) || 0
      if (menge <= 0) continue

      const nr = String(p.leistungsnummer || '')
      const istBodenlegerPrefix = nr.startsWith('05-')
      const istFliesenlegerPrefix = nr.startsWith('06-')
      const posText = norm(`${p.leistungsname || ''} ${p.beschreibung || ''}`)

      if (istBodenleger || istBodenlegerPrefix) {
        bodenflaecheDirekt += menge
      } else if (istFliesenleger || istFliesenlegerPrefix) {
        const istBodenPos = posText.includes('boden') || posText.includes('floor')
        if (istBodenPos) bodenflaecheDirekt += menge
      } else if (istMaler) {
        // Wand-Position im Maler-Gewerk – Decke nicht einrechnen
        const istDecke = /\b(decke|deckenanstrich|deckenflaeche|ceiling)\b/.test(
          posText,
        )
        if (!istDecke) wandflaecheMaler += menge
      }
    }
  }

  if (bodenflaecheDirekt > 0) {
    return Math.min(Math.round(bodenflaecheDirekt), MAX_BODEN_M2)
  }
  if (wandflaecheMaler > 0) {
    return Math.min(Math.round(wandflaecheMaler / 3), MAX_BODEN_M2)
  }

  // ── Priorität 4: Raum-Erkennung aus Eingabe-Text ──────────────────────
  if (eingabeText) {
    const text = norm(eingabeText)
    const seen = new Set<string>()
    let total = 0
    for (const [room, m2] of Object.entries(RAUM_M2)) {
      // Wir prüfen die normalisierte Form des Raum-Keys – "küche" wird zu
      // "kueche", also matchen wir nur einmal pro logischem Raum.
      const key = norm(room)
      if (seen.has(key)) continue
      if (text.includes(key)) {
        seen.add(key)
        total += m2
      }
    }
    if (total > 0) {
      return Math.min(Math.round(total), MAX_BODEN_M2)
    }
  }

  // ── Priorität 5: Fallback ─────────────────────────────────────────────
  return DEFAULT_BODEN_M2
}

// ─── 2) braucht_feinreinigung ─────────────────────────────────────────────

/**
 * Prüft ob im Angebot staubintensive Arbeiten enthalten sind – diese triggern
 * automatisch eine Feinreinigung (13-100) statt Besenrein (13-001).
 *
 * Quelle: STAUBINTENSIV_KW aus types.ts.
 */
export function braucht_feinreinigung(
  gewerke: Gewerk[] | null | undefined,
): boolean {
  if (!gewerke || gewerke.length === 0) return false
  for (const g of gewerke) {
    if (isReinigungGewerk(g)) continue
    for (const p of positionsOf(g)) {
      const text = norm(`${p.leistungsname || ''} ${p.beschreibung || ''}`)
      if (!text) continue
      for (const kw of STAUBINTENSIV_KW) {
        if (text.includes(norm(kw))) return true
      }
    }
  }
  return false
}

// ─── 3) smartReinigung ────────────────────────────────────────────────────

export interface SmartReinigungOpts {
  /** User-Freitext der ursprünglichen Anfrage (für Raum-Erkennung). */
  eingabeText?: string | null
  /** User hat die Reinigung explizit entfernt – nicht wieder einfügen. */
  reinigungEntfernt?: boolean
}

/**
 * Fügt eine automatische Reinigungs-Position in das Angebot ein (oder
 * ersetzt eine bestehende auto-generierte). Manuell bearbeitete oder vom
 * User entfernte Reinigungen werden respektiert.
 *
 * Pure: gibt ein neues Array zurück, mutiert nichts.
 */
export function smartReinigung(
  gewerke: Gewerk[] | null | undefined,
  catalog: Catalog | CatalogPosition[] | null | undefined,
  stundensaetze: StundensaetzeMap | null | undefined = {},
  opts: SmartReinigungOpts = {},
): Gewerk[] {
  const list = gewerke || []
  if (list.length === 0) return list

  // ── Opt-Out: User hat Reinigung explizit entfernt ─────────────────────
  if (opts.reinigungEntfernt) return list

  // ── Opt-Out: Reinigung wurde manuell bearbeitet ───────────────────────
  const existingReinigung = list.find(isReinigungGewerk)
  if (
    existingReinigung &&
    positionsOf(existingReinigung).some(
      (p) => p.manuellBearbeitet || p.reinigungEntfernt,
    )
  ) {
    return list
  }

  // ── Stundensatz Reinigung (für Stunden-Variante) ──────────────────────
  const reinigungStundensatz =
    Number((stundensaetze || {})['Reinigung']) > 0
      ? Number((stundensaetze || {})['Reinigung'])
      : 55

  // ── Schritt 1: Bodenfläche schätzen ───────────────────────────────────
  const bodenflaeche = bodenFlaecheSchaetzen(list, opts.eingabeText)

  // ── Schritt 2: Reinigungs-Art bestimmen ───────────────────────────────
  let targetNr: '13-100' | '13-001' | 'STUNDEN'
  if (bodenflaeche <= 10) {
    targetNr = 'STUNDEN'
  } else if (braucht_feinreinigung(list)) {
    targetNr = '13-100'
  } else {
    targetNr = '13-001'
  }

  // ── Schritt 3: Position bauen ─────────────────────────────────────────
  let newPos: Position

  if (targetNr === 'STUNDEN') {
    // Stunden-Reinigung: 1h pro 15 m², mindestens 2h.
    const stunden = Math.max(2, Math.round(bodenflaeche / 15))
    const ep = reinigungStundensatz
    const gp = round2(stunden * ep)
    const regieEntry =
      Array.isArray(catalog) || (catalog && catalog.positionen)
        ? (Array.isArray(catalog) ? catalog : catalog!.positionen).find(
            (e) => {
              const nr = String(e.leistungsnummer || '')
              return (
                nr.startsWith('13-') &&
                isSpecialPosition(nr) &&
                norm(e.leistungsname).includes('regie') &&
                (norm(e.einheit).includes('std') ||
                  norm(e.einheit).includes('stunde'))
              )
            },
          )
        : undefined

    newPos = {
      leistungsnummer: regieEntry?.leistungsnummer || '13-998',
      leistungsname: regieEntry?.leistungsname || 'Reinigung Regiestunden',
      beschreibung:
        'Reinigungsarbeiten nach Abschluss der Bauarbeiten, abgerechnet nach Aufwand.',
      menge: stunden,
      einheit: 'Stunde(n)',
      vk_netto_einheit: ep,
      gesamtpreis: gp,
      materialkosten_einheit: 0,
      materialanteil_prozent: 0,
      lohnkosten_minuten: 60,
      stundensatz: reinigungStundensatz,
      lohnkosten_einheit: ep,
      lohnanteil_prozent: 100,
      aus_preisliste: !!regieEntry,
      gewerk: 'Reinigung',
    }
  } else {
    // m²-Reinigung: VK aus Katalog oder Fallback.
    const catalogEntry = findCatalogEntry(catalog, targetNr)
    const preis = catalogEntry
      ? round2(Number(catalogEntry.vk_netto_einheit || 0))
      : FEINREIN_PREIS_FALLBACK
    const menge = bodenflaeche
    const minuten = catalogEntry
      ? Math.round(Number(catalogEntry.lohnkosten_minuten || 0))
      : 0
    const lohn =
      reinigungStundensatz > 0 && minuten > 0
        ? Math.min(round2((minuten / 60) * reinigungStundensatz), preis)
        : preis
    const mat = Math.max(0, round2(preis - lohn))
    const gesamtpreis = round2(menge * preis)
    const matPct = preis > 0 ? Math.round((mat / preis) * 1000) / 10 : 0

    const fallbackBeschreibung =
      targetNr === '13-100'
        ? 'Fachgerechte Feinreinigung aller Räume nach Abschluss der Bauarbeiten.'
        : 'Fachgerechte Baustellenreinigung besenrein nach Abschluss der Arbeiten.'

    newPos = {
      leistungsnummer: catalogEntry?.leistungsnummer || targetNr,
      leistungsname:
        catalogEntry?.leistungsname ||
        (targetNr === '13-100'
          ? 'Bauschlussreinigung feinrein'
          : 'Baureinigung besenrein'),
      beschreibung:
        (catalogEntry?.beschreibung || '').trim() || fallbackBeschreibung,
      menge,
      einheit: catalogEntry?.einheit || 'm²',
      vk_netto_einheit: preis,
      gesamtpreis,
      materialkosten_einheit: mat,
      materialanteil_prozent: matPct,
      lohnkosten_minuten: minuten,
      stundensatz: reinigungStundensatz,
      lohnkosten_einheit: lohn,
      lohnanteil_prozent: Math.round((100 - matPct) * 10) / 10,
      aus_preisliste: !!catalogEntry,
      gewerk: 'Reinigung',
    }
  }

  // ── Schritt 4: Hard-Cap REINIGUNGS_CAP (€) ────────────────────────────
  if (
    (newPos.gesamtpreis || 0) > REINIGUNGS_CAP &&
    (newPos.vk_netto_einheit || 0) > 0
  ) {
    const vk = newPos.vk_netto_einheit as number
    // Mengen-Anpassung sodass gesamtpreis genau = REINIGUNGS_CAP.
    const cappedMenge = round2(REINIGUNGS_CAP / vk)
    const cappedGP = round2(cappedMenge * vk)
    newPos = {
      ...newPos,
      menge: cappedMenge,
      gesamtpreis: cappedGP,
    }
  }

  // ── Schritt 5: In Gewerke einsortieren ────────────────────────────────
  const rIdx = list.findIndex(isReinigungGewerk)
  const newGewerke = [...list]
  const zwischensumme = Number(newPos.gesamtpreis) || 0

  if (rIdx >= 0) {
    newGewerke[rIdx] = {
      ...list[rIdx],
      name: list[rIdx].name,
      positionen: [newPos],
      zwischensumme,
    } as Gewerk
  } else {
    newGewerke.push({
      name: 'Reinigung',
      positionen: [newPos],
      zwischensumme,
    } as Gewerk)
  }

  return newGewerke
}
