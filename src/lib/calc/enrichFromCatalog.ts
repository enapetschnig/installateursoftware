// ────────────────────────────────────────────────────────────────────────────
//  enrichFromCatalog – nach KI-Antwort: Positionen mit Katalog-Format
//  (XX-NNN) bekommen Preis/Name/Beschreibung 1:1 aus dem Katalog.
//
//  Quelle: bau4you-app/src/lib/claude.js
//    - Helpers Z. 670-961 (isSpecialPosition, isRegiestundenPos,
//      isMaterialFuerRegiePos, einheitenKompatibel, hatSpezialTechnik,
//      trimBeschreibung, isFormulaEntry)
//    - Hauptfunktion Z. 963-1098 (enrichFromCatalog)
//
//  Side-Effect-frei: keine Mutation des Inputs (spread + map).
//  Numerische Genauigkeit:
//    round2 = Math.round(n*100)/100
//    round1 = Math.round(n*10)/10
//  lohnkosten_minuten wird mit 2 Dezimalen erhalten (Hero liefert z. B. 3.22).
// ────────────────────────────────────────────────────────────────────────────

import { isSpecialPosition } from './dedup'
import {
  CATALOG_NR_RE,
  SPEZIAL_TECHNIK_KEYWORDS,
  type Catalog,
  type CatalogPosition,
  type Gewerk,
  type Position,
  type StundensaetzeMap,
} from './types'

export { isSpecialPosition }

const round2 = (n: number): number => Math.round(n * 100) / 100
const round1 = (n: number): number => Math.round(n * 10) / 10

// ─── Helpers (Z. 683-961) ─────────────────────────────────────────────────

/**
 * Prüft ob eine Position eine Regiestunden-Position ist.
 * Erkennung über Name (enthält "Regie") UND Einheit (Std/Stunde).
 * Funktioniert unabhängig von der konkreten Nummer (-997, -998 etc.).
 *
 * Bau4you Z. 683-689.
 */
export function isRegiestundenPos(pos: Position): boolean {
  const name = String(pos.leistungsname || '').toLowerCase()
  const einheit = String(pos.einheit || '').toLowerCase()
  const hasRegie = name.includes('regie')
  const hasStd = einheit.includes('std') || einheit.includes('stunde')
  return hasRegie && hasStd
}

/**
 * Prüft ob eine Position eine "Material für Regiestunden" Position ist.
 * Erkennung über Name oder Beschreibung (enthält "Material" + "Regie").
 *
 * Bau4you Z. 719-724.
 */
export function isMaterialFuerRegiePos(pos: Position): boolean {
  const name = String(pos.leistungsname || '').toLowerCase()
  const beschr = String(pos.beschreibung || '').toLowerCase()
  return (
    (name.includes('material') && name.includes('regie')) ||
    (beschr.includes('material') && beschr.includes('regie'))
  )
}

/**
 * Prüft ob KI-Einheit mit Katalog-Einheit kompatibel ist.
 * Normalisiert gängige Varianten (qm/m², lfm/laufmeter, stk/stück …).
 *
 * Bau4you Z. 933-946.
 */
export function einheitenKompatibel(
  aiEinheit: string | null | undefined,
  catalogEinheit: string | null | undefined,
): boolean {
  if (!aiEinheit || !catalogEinheit) return true
  const a = String(aiEinheit).toLowerCase().trim()
  const c = String(catalogEinheit).toLowerCase().trim()
  if (a === c) return true
  const norm = (s: string): string =>
    s
      .replace(/laufmeter|lfdm|lfm\.?|m'|meter/g, 'lfm')
      .replace(/quadratmeter|qm/g, 'm²')
      .replace(/stück|stk\.?/g, 'stk')
      .replace(/pausch\.?|psch\.?/g, 'pauschal')
      .replace(/paar/g, 'paar')
  return norm(a) === norm(c)
}

/**
 * Prüft ob ein Text ein Spezial-Maler-Technik-Keyword enthält.
 * Diese Techniken (venezianisch, Marmorino, Tadelakt, …) haben im Hero-
 * Standard-Katalog keinen passenden Preis — Standard-Spachtelpositionen wären
 * 3-10× zu niedrig kalkuliert.
 *
 * Bau4you Z. 958-961.
 */
export function hatSpezialTechnik(text: string | null | undefined): boolean {
  const t = String(text || '').toLowerCase()
  return SPEZIAL_TECHNIK_KEYWORDS.some((kw) => t.includes(kw))
}

/** Liefert nur den Anzeige-Teil der Beschreibung (vor "Berechnung:"). */
function trimBeschreibung(text: string | null | undefined): string {
  if (!text) return ''
  const idx = text.indexOf('Berechnung:')
  return idx !== -1 ? text.substring(0, idx).trim() : text
}

/** True wenn der Katalog-Eintrag eine "Berechnung:"-Formel hat (Staffel-Preis). */
function isFormulaEntry(entry: CatalogPosition | undefined): boolean {
  return !!entry && String(entry.beschreibung || '').includes('Berechnung:')
}

// ─── enrichFromCatalog (Z. 963-1098) ──────────────────────────────────────

/**
 * Nach KI-Antwort: Für Positionen mit gültiger Katalog-Leistungsnummer
 * (XX-NNN) werden Preis/Name/Beschreibung 1:1 aus dem Katalog übernommen.
 * Die KI-Menge bleibt erhalten.
 *
 * Sonderfälle:
 *   a) Nummer XX-NEU/XX-NEUn → unverändert (kein Lookup)
 *   b) Nicht im Katalog → aus_preisliste=true (Hero-Quirk: Hero hat Pos nach
 *      letztem Sync angelegt). Preis bleibt KI-Initialwert.
 *   c) Formel-Eintrag ("Berechnung:") → unverändert (applyBaustelleneinrichtung).
 *   d) Spezial-Technik-Mismatch (KI: Marmorino; Katalog: Standard) →
 *      aus_preisliste=false. KI-Werte werden NICHT geändert. Triggert Modus-1.
 *   e) Einheit-Mismatch (z. B. KI: lfm vs. Katalog: pauschal) →
 *      aus_preisliste=false. KI-Werte unverändert.
 *   f) Material-für-Regie-Pos → Name/Einheit aus Katalog, Preise später.
 *   g) Template-Pos (Katalog-Preis = 0) → Name/Einheit aus Katalog,
 *      KI-Preis bleibt, aus_preisliste=false → Modus-1-Nachkalkulation.
 *   h) Normalfall: Hero-Werte 1:1 übernehmen + `_katalog_snapshot` setzen.
 *
 * Side-Effect-frei: Liefert eine NEUE Gewerk-Liste; Input bleibt unverändert.
 */
export function enrichFromCatalog(
  gewerke: Gewerk[],
  catalog: Catalog,
  stundensaetze: StundensaetzeMap,
): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke
  const positionenInCatalog = catalog?.positionen || []
  if (positionenInCatalog.length === 0) return gewerke

  const catalogMap = new Map<string, CatalogPosition>(
    positionenInCatalog.map((p) => [String(p.leistungsnummer), p]),
  )

  return gewerke.map((gewerk) => {
    const stundensatzGewerk = Number(stundensaetze?.[gewerk.name]) || 0

    const positionen = (gewerk.positionen || []).map((pos) => {
      const nr = String(pos.leistungsnummer || '')
      // (a) NEU-Nummer oder kein Katalog-Format → unverändert
      if (!CATALOG_NR_RE.test(nr)) return pos

      const entry = catalogMap.get(nr)

      // (b) Nicht im Katalog → aus_preisliste bleibt true (Hero-Quirk)
      if (!entry) {
        return { ...pos, aus_preisliste: true }
      }

      // (c) Formel-Eintrag → später behandelt
      if (isFormulaEntry(entry)) return pos

      // (d) Spezial-Technik-Mismatch
      const userTechnik =
        hatSpezialTechnik(pos.leistungsname) || hatSpezialTechnik(pos.beschreibung)
      const katalogHatTechnik =
        hatSpezialTechnik(entry.leistungsname) || hatSpezialTechnik(entry.beschreibung)
      if (userTechnik && !katalogHatTechnik) {
        return { ...pos, aus_preisliste: false }
      }

      // (e) Einheit-Mismatch
      if (
        pos.einheit &&
        entry.einheit &&
        !einheitenKompatibel(pos.einheit, entry.einheit)
      ) {
        return { ...pos, aus_preisliste: false }
      }

      // (f) Material für Regiestunden — Preise später (applyRegieMaterial)
      if (isMaterialFuerRegiePos(pos)) {
        return {
          ...pos,
          leistungsname: entry.leistungsname,
          beschreibung: pos.beschreibung || trimBeschreibung(entry.beschreibung) || '',
          einheit: entry.einheit || pos.einheit,
          aus_preisliste: true,
        }
      }

      // (g) Template-Position (Katalog-Preis = 0) → KI-Preis behalten,
      //     aber Name/Einheit aus Katalog, Modus-1-Nachkalkulation triggern.
      const katalogVk = Number(entry.vk_netto_einheit) || 0
      if (katalogVk <= 0) {
        return {
          ...pos,
          leistungsname: entry.leistungsname,
          beschreibung: pos.beschreibung || trimBeschreibung(entry.beschreibung) || '',
          einheit: entry.einheit || pos.einheit,
          aus_preisliste: false,
        }
      }

      // (h) Normalfall – Hero-Werte 1:1 übernehmen
      const menge = Number(pos.menge) || 1
      const vk = round2(katalogVk)

      const lohn = round2(Number(entry.lohnkosten_einheit) || 0)
      const mat = round2(Number(entry.materialkosten_einheit) || 0)
      // Minuten mit 2 Dezimalen erhalten (Hero z. B. 3.22 — nicht auf 3 abschneiden)
      const minuten = round2(Number(entry.lohnkosten_minuten) || 0)
      const satz = Number(entry.stundensatz) || stundensatzGewerk

      const gesamtpreis = round2(menge * vk)
      const materialProzent = vk > 0 ? round1((mat / vk) * 100) : 0
      const lohnProzent = vk > 0 ? round1(100 - materialProzent) : 0

      // Leistungsname-Bewahrung: NUR wenn die KI ein Spezial-Technik-Keyword
      // im Namen hat, behalten wir ihn — sonst gewinnt der Katalog-Name.
      const aiHatSpezialTechnikInName =
        !!pos.leistungsname && hatSpezialTechnik(pos.leistungsname)
      const finaleLeistungsname = aiHatSpezialTechnikInName
        ? pos.leistungsname
        : entry.leistungsname

      return {
        ...pos,
        leistungsname: finaleLeistungsname,
        beschreibung: pos.beschreibung || trimBeschreibung(entry.beschreibung) || '',
        einheit: entry.einheit || pos.einheit,
        vk_netto_einheit: vk,
        materialkosten_einheit: mat,
        lohnkosten_einheit: lohn,
        lohnkosten_minuten: minuten,
        stundensatz: satz,
        menge,
        gesamtpreis,
        materialanteil_prozent: materialProzent,
        lohnanteil_prozent: lohnProzent,
        aus_preisliste: true,
        // Snapshot der Katalog-Werte → hero-create-document entscheidet damit
        // ob Position unverändert (add_existing_service) oder editiert
        // (create_supply_service) gepostet wird.
        _katalog_snapshot: {
          vk_netto_einheit: vk,
          lohnkosten_einheit: lohn,
          materialkosten_einheit: mat,
          lohnkosten_minuten: minuten,
          leistungsname: entry.leistungsname,
          beschreibung: trimBeschreibung(entry.beschreibung) || '',
        },
      }
    })

    return { ...gewerk, positionen }
  })
}
