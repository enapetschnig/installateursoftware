// ────────────────────────────────────────────────────────────────────────────
//  baustelleneinrichtung – Formel-Positionen aus dem Katalog auf totalNetto
//  anwenden + Spezial-Behandlung der "Baustelleneinrichtung" 01-001 / 01-002.
//
//  Quelle: bau4you-app/src/lib/claude.js Z. 828-1484
//    - isFormulaEntry       (Z. 828-831)
//    - parseStaffelPreis    (Z. 844-889, hier umgeformt: liefert Staffeln-Array)
//    - buildFormulaPosition (Z. 892-921)
//    - applyBaustelleneinrichtung (Z. 1267-1307)
//    - recalcBaustelleneinrichtung (Z. 1320-1484)
//
//  Side-Effect-frei: keine Mutation des Inputs (spread + map).
//
//  Hinweis zur API-Anpassung gegenüber bau4you:
//    parseStaffelPreis liefert hier ein typisiertes Staffel-Array (siehe Staffel).
//    Die Berechnung des konkreten Preises erfolgt durch `pickStaffel` +
//    `buildFormulaPosition`. Damit ist die Logik kompositional testbar.
// ────────────────────────────────────────────────────────────────────────────

import type {
  Catalog,
  CatalogPosition,
  Gewerk,
  Position,
  StundensaetzeMap,
} from './types'

const round2 = (n: number): number => Math.round(n * 100) / 100
const round1 = (n: number): number => Math.round(n * 10) / 10

// ─── parseDE (Bau4you Z. 816-818) ─────────────────────────────────────────
// Deutsche Zahl: "1.000,50" → 1000.5 ; "5" → 5 ; "200" → 200
function parseDE(str: string | number | null | undefined): number {
  return (
    parseFloat(String(str ?? '').replace(/\./g, '').replace(',', '.')) || 0
  )
}

// ─── trimBeschreibung (Bau4you Z. 821-824, lokal dupliziert um Zirkular-
//     Imports zu vermeiden) ─────────────────────────────────────────────────
function trimBeschreibung(text: string | null | undefined): string {
  if (!text) return ''
  const idx = text.indexOf('Berechnung:')
  return idx !== -1 ? text.substring(0, idx).trim() : text
}

// ─── Staffel-Repräsentation ───────────────────────────────────────────────

/**
 * Eine einzelne Staffel aus der Katalog-Beschreibung.
 * `percent` ist der Wert auf der rechten Seite des "=":
 *   - bei Prozent-Staffeln: Prozent-Zahl (z. B. 5 → 5 %)
 *   - bei Fixpreis-Staffeln: der Fixpreis in € (siehe `isPercent`)
 * `minBetrag` ist optional und nur bei Prozent-Staffeln gesetzt
 * ("mind. 200" → minBetrag = 200).
 */
export interface Staffel {
  from: number
  to: number
  percent: number
  isPercent: boolean
  minBetrag?: number
}

// ─── isFormulaEntry (Z. 828-831) ──────────────────────────────────────────

/**
 * True wenn der Katalog-Eintrag eine Formel-Position ist:
 *   - kein VK gesetzt (vk_netto_einheit fehlt oder 0)
 *   - Beschreibung enthält "Berechnung:" (case-insensitive)
 *
 * Die Preisermittlung muss dann über die Staffeln in der Beschreibung erfolgen.
 */
export function isFormulaEntry(
  catalogPos: CatalogPosition | null | undefined,
): boolean {
  if (!catalogPos) return false
  const vk = Number(catalogPos.vk_netto_einheit) || 0
  if (vk !== 0) return false
  return /Berechnung:/i.test(String(catalogPos.beschreibung || ''))
}

// ─── parseStaffelPreis (Z. 844-889) ──────────────────────────────────────

/**
 * Parst die Staffel-Strings aus einem Beschreibungs-Text.
 *
 * Unterstützte Formate (alle Zahlen im deutschen Format mit `.` als
 * Tausender-Trenner und `,` als Dezimal-Trenner):
 *
 *   "ab 0 € = 5 %"
 *   "ab 0 € = 5 % (mind. 200)"
 *   "ab 5000 € = 3 %"
 *   "von 1.000 € bis 5.000 € = 4 %"
 *   "von 2.000 bis 9.999 EUR = 260 EUR"      (Fixpreis)
 *   "1.000-1.999 EUR = 185 EUR"              (Fixpreis, alternativer Syntax)
 *
 * Der Text vor "Berechnung:" wird abgeschnitten falls vorhanden.
 * Trennzeichen zwischen Staffeln: ";" oder Zeilenumbruch oder das nächste
 * "von "/"ab "-Schlüsselwort.
 *
 * Rückgabe: aufsteigend nach `from` sortiertes Staffel-Array.
 */
export function parseStaffelPreis(text: string | null | undefined): Staffel[] {
  const raw = String(text || '')
  if (!raw.trim()) return []

  // Nur den Teil nach "Berechnung:" auswerten (falls vorhanden).
  const berIdx = raw.indexOf('Berechnung:')
  const body = berIdx !== -1
    ? raw.substring(berIdx + 'Berechnung:'.length)
    : raw

  // Normalisieren: NBSP → Space, mehrfache Whitespaces zusammenfassen.
  // eslint-disable-next-line no-irregular-whitespace
  const normalised = body.replace(/ /g, ' ').replace(/\s+/g, ' ')

  // Aufspalten:
  //   - explizite Trenner ; und Zeilenumbruch
  //   - jedes neue "von "/"ab " startet eine Staffel (look-ahead)
  const parts = normalised
    .split(/[;\n]|(?=\bvon\s)|(?=\bab\s)/gi)
    .map((s) => s.trim())
    .filter(Boolean)

  const staffeln: Staffel[] = []

  for (const part of parts) {
    const lower = part.toLowerCase()

    // ── "ab X = Z [% ...] [(mind. M)]" ────────────────────────────────
    //    z. B. "ab 0 € = 5 % (mind. 200)" oder "ab 5000 € = 3 %"
    const abMatch = lower.match(/^ab\s+([\d.,]+)[^=]*=\s*([\d.,]+)\s*(%)?/)
    if (abMatch) {
      const from = parseDE(abMatch[1])
      const value = parseDE(abMatch[2])
      const isPercent = !!abMatch[3]
      const mindMatch = lower.match(/mind\.?\s*([\d.,]+)/)
      const staffel: Staffel = {
        from,
        to: Number.POSITIVE_INFINITY,
        percent: value,
        isPercent,
      }
      if (mindMatch) staffel.minBetrag = parseDE(mindMatch[1])
      staffeln.push(staffel)
      continue
    }

    // ── "von X bis Y = Z [%] [(mind. M)]"  ODER  "X-Y EUR = Z [%]" ──
    //    Zwischen Untergrenze und "bis" / "-" / "–" darf auch "€" oder "EUR"
    //    auftauchen ("von 3000 € bis 9999 € = …"), darum [^=]* statt \s*.
    const rangeMatch = lower.match(
      /([\d.,]+)[^=\d]*(?:–|-|bis)[^=\d]*([\d.,]+)[^=]*=\s*([\d.,]+)\s*(%)?/,
    )
    if (rangeMatch) {
      const from = parseDE(rangeMatch[1])
      const to = parseDE(rangeMatch[2])
      const value = parseDE(rangeMatch[3])
      const isPercent = !!rangeMatch[4]
      const mindMatch = lower.match(/mind\.?\s*([\d.,]+)/)
      const staffel: Staffel = {
        from,
        to,
        percent: value,
        isPercent,
      }
      if (mindMatch) staffel.minBetrag = parseDE(mindMatch[1])
      staffeln.push(staffel)
      continue
    }
  }

  staffeln.sort((a, b) => a.from - b.from)
  return staffeln
}

/**
 * Liefert die passende Staffel für `totalNetto` (oder undefined).
 * "passend" heißt: from <= totalNetto <= to.
 */
export function pickStaffel(
  staffeln: Staffel[],
  totalNetto: number,
): Staffel | undefined {
  return staffeln.find((s) => totalNetto >= s.from && totalNetto <= s.to)
}

/**
 * Berechnet den konkreten Preis aus einer Staffel.
 *   - Prozent-Staffel: max(minBetrag, totalNetto * percent / 100)
 *   - Fixpreis-Staffel: percent (= der eingetragene Fixbetrag)
 */
export function applyStaffel(staffel: Staffel, totalNetto: number): number {
  if (!staffel.isPercent) return round2(staffel.percent)
  const calc = round2((totalNetto * staffel.percent) / 100)
  const min = staffel.minBetrag ?? 0
  return Math.max(min, calc)
}

// ─── buildFormulaPosition (Z. 892-921) ───────────────────────────────────

/**
 * Baut eine vollständig kalkulierte Formel-Position aus
 *   - Katalog-Eintrag (für Stammdaten + Minuten),
 *   - berechnetem Staffel-Preis,
 *   - aktuellem Gewerk-Stundensatz.
 *
 * Eigenschaften der erzeugten Position:
 *   - menge = 1, einheit = "pauschal" (Formel-Pos = Pauschal-Pos)
 *   - vk_netto_einheit = preis, gesamtpreis = preis
 *   - Lohn = min((minuten/60) × stundensatz, preis), Material = preis - lohn
 *   - aus_preisliste = true
 *
 * Side-Effect-frei.
 */
export function buildFormulaPosition(
  pos: Position,
  catalogPos: CatalogPosition,
  totalNetto: number,
  stundensaetze: StundensaetzeMap,
  gewerkName?: string,
): Position {
  const staffeln = parseStaffelPreis(catalogPos.beschreibung)
  const treffer = pickStaffel(staffeln, totalNetto)
  const preisRaw = treffer ? applyStaffel(treffer, totalNetto) : 0
  const preis = round2(preisRaw)

  const stundensatz =
    Number(
      gewerkName ? stundensaetze?.[gewerkName] : undefined,
    ) || Number(catalogPos.stundensatz) || 0

  const minuten = round2(Number(catalogPos.lohnkosten_minuten ?? 0) || 0)
  const lohnRaw = stundensatz > 0 ? round2((minuten / 60) * stundensatz) : 0
  const lohn = round2(Math.min(lohnRaw, preis))
  const mat = round2(Math.max(0, preis - lohn))
  const materialProzent = preis > 0 ? round1((mat / preis) * 100) : 0
  const lohnProzent = preis > 0 ? round1(100 - materialProzent) : 0

  return {
    ...pos,
    leistungsnummer: catalogPos.leistungsnummer,
    leistungsname: catalogPos.leistungsname,
    beschreibung:
      pos.beschreibung || trimBeschreibung(catalogPos.beschreibung) || '',
    einheit: 'pauschal',
    vk_netto_einheit: preis,
    materialkosten_einheit: mat,
    lohnkosten_einheit: lohn,
    lohnkosten_minuten: minuten,
    stundensatz,
    menge: 1,
    gesamtpreis: preis,
    materialanteil_prozent: materialProzent,
    lohnanteil_prozent: lohnProzent,
    aus_preisliste: true,
  }
}

// ─── applyBaustelleneinrichtung (Z. 1267-1307) ───────────────────────────

/**
 * Behandelt GENERISCHE Formel-Positionen aus dem Katalog (NICHT 01-001/01-002 –
 * die werden in `recalcBaustelleneinrichtung` separat berechnet, weil ihr
 * Sonderverhalten anders aussieht).
 *
 * Vorgehen:
 *   1. totalNetto = Summe aller `gesamtpreis` OHNE 01-001/01-002.
 *   2. Pro Position prüfen: wenn der Katalog-Eintrag eine Formel-Position
 *      ist → mit `buildFormulaPosition` neu setzen.
 *   3. Zwischensummen werden bei Änderungen aktualisiert.
 *
 * Side-Effect-frei.
 */
export function applyBaustelleneinrichtung(
  gewerke: Gewerk[],
  catalog: Catalog | null | undefined,
  stundensaetze: StundensaetzeMap,
): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke
  const positionenInCatalog = catalog?.positionen || []
  if (positionenInCatalog.length === 0) return gewerke

  const catalogMap = new Map<string, CatalogPosition>(
    positionenInCatalog.map((p) => [String(p.leistungsnummer), p]),
  )

  // totalNetto: ohne 01-001 und 01-002 (alles andere zählt).
  let totalNetto = 0
  for (const g of gewerke) {
    for (const p of g.positionen || []) {
      const nr = String(p.leistungsnummer || '')
      if (nr === '01-001' || nr === '01-002') continue
      totalNetto += Number(p.gesamtpreis) || 0
    }
  }
  totalNetto = round2(totalNetto)

  let changedAny = false
  const newGewerke = gewerke.map((gewerk) => {
    let posChanged = false

    const positionen = (gewerk.positionen || []).map((pos) => {
      const nr = String(pos.leistungsnummer || '')
      if (nr === '01-001' || nr === '01-002') return pos // handled by recalc

      const entry = catalogMap.get(nr)
      if (!entry || !isFormulaEntry(entry)) return pos

      const staffeln = parseStaffelPreis(entry.beschreibung)
      const treffer = pickStaffel(staffeln, totalNetto)
      if (!treffer) return pos
      const preis = applyStaffel(treffer, totalNetto)
      if (preis === 0) return pos

      posChanged = true
      changedAny = true
      return buildFormulaPosition(pos, entry, totalNetto, stundensaetze, gewerk.name)
    })

    if (!posChanged) return gewerk
    const zwischensumme = round2(
      positionen.reduce((s, p) => s + (Number(p.gesamtpreis) || 0), 0),
    )
    return { ...gewerk, positionen, zwischensumme } as Gewerk
  })

  return changedAny ? newGewerke : gewerke
}

// ─── recalcBaustelleneinrichtung (Z. 1320-1484) ──────────────────────────

/**
 * Recalculates 01-001 / 01-002 (Baustelleneinrichtung) NACH allen anderen
 * Pipeline-Stufen, weil ihre Berechnung von der Summe aller anderen Positionen
 * abhängt.
 *
 * Logik:
 *   1. Summe aller Positionen außer 01-001 / 01-002 ⇒ `summeOhneBE`.
 *   2. Schwelle: summeOhneBE < 3000 € → 01-002 (Kleinbaustellen-Pauschale),
 *      sonst                            → 01-001 (große Pauschale).
 *   3. Aus der Katalog-Beschreibung der gewählten Position die Staffeln
 *      parsen und passende Staffel anwenden.
 *   4. Fällt keine Staffel der Hauptkandidaten-Position → Fallback auf die
 *      andere (z. B. wenn nur 01-001 Staffeln für > 3000 € hat).
 *   5. Position in allen Gewerken in-place ersetzen mit Pauschal-Werten:
 *      einheit = "pauschal", lohn = 0, mat = 0, ganze Lohnabbildung 0
 *      (Lump-Sum). Andere Gewerke bleiben unverändert.
 *
 * Side-Effect-frei.
 */
export function recalcBaustelleneinrichtung(
  gewerke: Gewerk[],
  catalog: Catalog | null | undefined,
): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke
  const positionenInCatalog = catalog?.positionen || []
  if (positionenInCatalog.length === 0) return gewerke

  // Schritt 1: Summe ohne 01-001/01-002
  let summeOhneBE = 0
  let hasBeAnywhere = false
  for (const gewerk of gewerke) {
    for (const pos of gewerk.positionen || []) {
      const nr = String(pos.leistungsnummer || '')
      if (nr === '01-001' || nr === '01-002') {
        hasBeAnywhere = true
        continue
      }
      summeOhneBE += Number(pos.gesamtpreis) || 0
    }
  }
  summeOhneBE = round2(summeOhneBE)

  // Keine 01-001/01-002 vorhanden → nichts zu tun.
  if (!hasBeAnywhere) return gewerke

  // Schritt 2: Katalog-Einträge holen
  const pos001 = positionenInCatalog.find(
    (p) => String(p.leistungsnummer) === '01-001',
  )
  const pos002 = positionenInCatalog.find(
    (p) => String(p.leistungsnummer) === '01-002',
  )

  const staffeln001 = pos001 ? parseStaffelPreis(pos001.beschreibung) : []
  const staffeln002 = pos002 ? parseStaffelPreis(pos002.beschreibung) : []

  // Schritt 3: Welche Position verwenden?
  const useKlein = summeOhneBE < 3000
  let verwendeNr: '01-001' | '01-002'
  let bePreis: number
  let beEntry: CatalogPosition | undefined

  const tryStaffel = (
    staffeln: Staffel[],
  ): number => {
    const t = pickStaffel(staffeln, summeOhneBE)
    return t ? applyStaffel(t, summeOhneBE) : 0
  }

  if (useKlein && pos002) {
    verwendeNr = '01-002'
    bePreis = tryStaffel(staffeln002)
    beEntry = pos002
    if (bePreis === 0 && pos001) {
      verwendeNr = '01-001'
      bePreis = tryStaffel(staffeln001)
      beEntry = pos001
    }
  } else if (pos001) {
    verwendeNr = '01-001'
    bePreis = tryStaffel(staffeln001)
    beEntry = pos001
    if (bePreis === 0 && pos002) {
      verwendeNr = '01-002'
      bePreis = tryStaffel(staffeln002)
      beEntry = pos002
    }
  } else if (pos002) {
    // Fallback wenn nur 01-002 im Katalog existiert
    verwendeNr = '01-002'
    bePreis = tryStaffel(staffeln002)
    beEntry = pos002
  } else {
    return gewerke
  }

  if (!beEntry || bePreis === 0) return gewerke

  const beLangtext = trimBeschreibung(beEntry.beschreibung || '')
  const finalPreis = round2(bePreis)

  // Schritt 4: In allen Gewerken die BE-Position ersetzen
  return gewerke.map((gewerk) => {
    const hasBE = (gewerk.positionen || []).some((p) => {
      const nr = String(p.leistungsnummer || '')
      return nr === '01-001' || nr === '01-002'
    })
    if (!hasBE) return gewerk

    const positionen = (gewerk.positionen || []).map((pos) => {
      const nr = String(pos.leistungsnummer || '')
      if (nr !== '01-001' && nr !== '01-002') return pos
      return {
        ...pos,
        leistungsnummer: verwendeNr,
        leistungsname: beEntry!.leistungsname || pos.leistungsname,
        beschreibung: beLangtext || pos.beschreibung || '',
        menge: 1,
        einheit: beEntry!.einheit || 'pauschal',
        vk_netto_einheit: finalPreis,
        gesamtpreis: finalPreis,
        materialkosten_einheit: 0,
        materialanteil_prozent: 0,
        lohnkosten_einheit: 0,
        lohnkosten_minuten: 0,
        stundensatz: 0,
        lohnanteil_prozent: 0,
        aus_preisliste: true,
      } as Position
    })

    const zwischensumme = round2(
      positionen.reduce((s, p) => s + (Number(p.gesamtpreis) || 0), 0),
    )
    return { ...gewerk, positionen, zwischensumme } as Gewerk
  })
}
