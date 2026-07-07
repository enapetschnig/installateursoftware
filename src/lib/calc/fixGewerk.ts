// ────────────────────────────────────────────────────────────────────────────
//  fixGewerk – Gewerk-Routing & Leistungsnummer-Korrektur
//
//  Portiert aus bau4you-app:
//    - /src/lib/claude.js  Z. 645-660 (PREFIX-Maps), 751-815 (fixGewerke*)
//    - /src/lib/fixGewerkZuordnung.js (komplettes Modul)
//
//  Pure functions: kein Input-Mutate, alles via spread/map.
// ────────────────────────────────────────────────────────────────────────────

import {
  type Position,
  type Gewerk,
  GEWERK_PREFIX_MAP,
  PREFIX_TO_GEWERK,
  VALID_LEISTUNGSNR,
} from './types'

/**
 * SPEZIAL_REGELN – haben höchste Priorität.
 * Wenn ein Keyword im Kurztext (leistungsname) oder Langtext (beschreibung)
 * einer Position gefunden wird, wird das Gewerk IMMER auf den definierten
 * Wert gesetzt – egal was die KI als gewerk-Feld gesetzt hat.
 *
 * Quelle: bau4you/fixGewerkZuordnung.js Z. 25-50.
 * Reihenfolge bewusst: spezifischere/eindeutigere Keywords zuerst.
 */
interface SpezialRegel {
  gewerk: string
  keywords: readonly string[]
}

const SPEZIAL_REGELN: readonly SpezialRegel[] = [
  {
    gewerk: 'Abbruch',
    keywords: [
      'mulde',
      'schuttcontainer',
      'bauschuttcontainer',
      'bauschutt',
      'containerentsorgung',
      'entsorgungskosten',
      'bauschuttentsorgung',
      'deponie',
      'deponiegebuehr',
      'sperrmuell',
      'schuttabfuhr',
    ],
  },
  {
    gewerk: 'Reinigung',
    keywords: [
      'bauschlussreinigung',
      'endreinigung',
      'besenrein',
      'feinrein',
      'grundreinigung',
      'fensterreinigung',
    ],
  },
]

/**
 * Normalisiert Text für Keyword-Vergleich – lowercase + Umlaute auflösen.
 * Quelle: bau4you/fixGewerkZuordnung.js Z. 46-49.
 */
function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

/**
 * Liefert den korrekten Gewerknamen wenn ein Spezial-Keyword im Kurz-/Langtext
 * der Position gefunden wird, sonst `null` (keine Korrektur nötig).
 */
export function detectCorrectGewerk(pos: Position): string | null {
  const text = norm(`${pos.leistungsname ?? ''} ${pos.beschreibung ?? ''}`)
  for (const { gewerk, keywords } of SPEZIAL_REGELN) {
    if (keywords.some((kw) => text.includes(norm(kw)))) {
      return gewerk
    }
  }
  return null
}

/**
 * Passt die Leistungsnummer an, wenn das Gewerk wechselt:
 *  - Katalog-Nummern (XX-NNN) bleiben unverändert – die Nummer bestimmt das Gewerk.
 *  - NEU-Nummern (XX-NEU, XX-NEU1 …) bekommen den neuen Präfix.
 *
 * Signatur akzeptiert `Position` (nicht nur String) damit künftige Erweiterungen
 * (z. B. Snapshot-Lookup) ohne API-Bruch möglich sind.
 */
export function adjustLeistungsnummer(pos: Position, newGewerk: string): string {
  const nr = String(pos.leistungsnummer ?? '')
  const newPrefix = GEWERK_PREFIX_MAP[newGewerk]
  if (!newPrefix) return nr

  const neuMatch = nr.match(/^\d{2}-(NEU\d*)$/)
  if (neuMatch) {
    return `${newPrefix}-${neuMatch[1]}`
  }
  // Katalog-Nummern oder ungültige Formate bleiben unverändert.
  return nr
}

/**
 * Post-processed gewerke array: ersetzt erfundene/ungültige Leistungsnummern
 * (z. B. "M001", "n. n.", leer) durch korrekte "XX-NEU"/"XX-NEU1"/… mit dem
 * Präfix des jeweiligen Gewerks und setzt `aus_preisliste = false`.
 *
 * Bestehende valide Nummern (XX-NNN oder XX-NEU[N]) bleiben unverändert.
 *
 * Quelle: bau4you/claude.js Z. 800-812.
 */
export function fixGewerkeLeistungsnummern(gewerke: Gewerk[]): Gewerk[] {
  return gewerke.map((gewerk) => {
    const prefix = GEWERK_PREFIX_MAP[gewerk.name] ?? '00'
    let neuCounter = 0
    const positionen: Position[] = (gewerk.positionen ?? []).map((pos) => {
      if (VALID_LEISTUNGSNR.test(String(pos.leistungsnummer ?? ''))) return pos
      const neuSuffix = neuCounter === 0 ? 'NEU' : `NEU${neuCounter}`
      neuCounter++
      return {
        ...pos,
        leistungsnummer: `${prefix}-${neuSuffix}`,
        aus_preisliste: false,
      }
    })
    return { ...gewerk, positionen }
  })
}

/**
 * Re-Buckets alle Positionen anhand des 2-stelligen Präfix ihrer Leistungsnummer.
 *
 * Beispiel: Pos "02-001 Bauschuttcontainer" landet im Gewerk "Abbruch", auch
 * wenn die KI sie ursprünglich ins Gewerk "Maler" einsortiert hat.
 *
 * Positionen ohne gültiges Präfix bleiben in ihrem ursprünglichen Gewerk.
 * Reihenfolge der ursprünglichen Gewerk-Liste wird beibehalten (Stable Sort),
 * neu entstandene Gewerke werden hinten angehängt. Leere Gewerke entfernt.
 *
 * Quelle: bau4you/claude.js Z. 751-793.
 */
export function fixGewerkeByLeistungsnummer(gewerke: Gewerk[]): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke

  // name → { ...gewerkTemplate, positionen: Position[] }
  const gewerkBuckets: Record<string, Gewerk> = {}

  for (const gewerk of gewerke) {
    for (const pos of gewerk.positionen ?? []) {
      const nr = String(pos.leistungsnummer ?? '')
      const match = nr.match(/^(\d{2})-/)
      const correctName = match
        ? PREFIX_TO_GEWERK[match[1]] ?? gewerk.name
        : gewerk.name

      if (!gewerkBuckets[correctName]) {
        const template =
          gewerke.find((g) => g.name === correctName) ?? { name: correctName, positionen: [] }
        gewerkBuckets[correctName] = { ...template, positionen: [] }
      }

      gewerkBuckets[correctName].positionen.push({ ...pos, gewerk: correctName })
    }
  }

  // In ursprünglicher Reihenfolge zusammenbauen, neue Gewerke hinten anhängen.
  const result: Gewerk[] = []
  const seen = new Set<string>()

  for (const gewerk of gewerke) {
    if (gewerkBuckets[gewerk.name] && !seen.has(gewerk.name)) {
      const g = gewerkBuckets[gewerk.name]
      result.push({
        ...g,
        zwischensumme: g.positionen.reduce(
          (s, p) => s + (Number(p.gesamtpreis) || 0),
          0,
        ),
      } as Gewerk)
      seen.add(gewerk.name)
    }
  }
  for (const [name, g] of Object.entries(gewerkBuckets)) {
    if (!seen.has(name)) {
      result.push({
        ...g,
        zwischensumme: g.positionen.reduce(
          (s, p) => s + (Number(p.gesamtpreis) || 0),
          0,
        ),
      } as Gewerk)
    }
  }

  // Leere Gewerke entfernen.
  return result.filter((g) => (g.positionen ?? []).length > 0)
}

/**
 * Hauptfunktion: Korrigiert die Gewerk-Zuordnung aller Positionen anhand der
 * Spezial-Keyword-Regeln (Container/Mulde → Abbruch, Bauschlussreinigung →
 * Reinigung etc.).
 *
 * Effekte:
 *  - Position wandert in den richtigen Gewerk-Bucket.
 *  - NEU-Nummer (XX-NEU…) bekommt den neuen Präfix (Katalog-Nummern bleiben).
 *  - Leere Gewerke werden entfernt.
 *  - Reihenfolge der ursprünglichen Gewerk-Liste bleibt erhalten.
 *  - Wenn keine Position geändert wurde, wird das Original-Array zurückgegeben
 *    (Referenz-Identität wie in bau4you/fixGewerkZuordnung.js Z. 139).
 *
 * Quelle: bau4you/fixGewerkZuordnung.js Z. 107-166.
 */
export function fixGewerkZuordnung(gewerke: Gewerk[]): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke

  // Buckets aus bestehenden Gewerken aufbauen (Template ohne Positionen).
  const buckets: Record<string, Gewerk> = {}
  for (const g of gewerke) {
    buckets[g.name] = { ...g, positionen: [] }
  }

  let changed = false

  for (const gewerk of gewerke) {
    for (const pos of gewerk.positionen ?? []) {
      const correctGewerk = detectCorrectGewerk(pos)

      if (correctGewerk && correctGewerk !== gewerk.name) {
        if (!buckets[correctGewerk]) {
          buckets[correctGewerk] = { name: correctGewerk, positionen: [] }
        }
        const adjustedNr = adjustLeistungsnummer(pos, correctGewerk)
        buckets[correctGewerk].positionen.push({
          ...pos,
          gewerk: correctGewerk,
          leistungsnummer: adjustedNr,
        })
        changed = true
      } else {
        if (!buckets[gewerk.name]) {
          buckets[gewerk.name] = { ...gewerk, positionen: [] }
        }
        buckets[gewerk.name].positionen.push(pos)
      }
    }
  }

  if (!changed) return gewerke

  const result: Gewerk[] = []
  const seen = new Set<string>()

  for (const g of gewerke) {
    if (!seen.has(g.name) && buckets[g.name]) {
      const b = buckets[g.name]
      result.push({
        ...b,
        zwischensumme: b.positionen.reduce(
          (s, p) => s + (Number(p.gesamtpreis) || 0),
          0,
        ),
      } as Gewerk)
      seen.add(g.name)
    }
  }
  for (const [name, b] of Object.entries(buckets)) {
    if (!seen.has(name) && b.positionen.length > 0) {
      result.push({
        ...b,
        zwischensumme: b.positionen.reduce(
          (s, p) => s + (Number(p.gesamtpreis) || 0),
          0,
        ),
      } as Gewerk)
    }
  }

  return result.filter((g) => (g.positionen ?? []).length > 0)
}
