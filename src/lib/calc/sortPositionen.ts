// ────────────────────────────────────────────────────────────────────────────
//  sortPositionen – Stable Sort für Gewerke und Positionen im Angebot.
//
//  Portiert (vereinfacht) aus bau4you/claude.js Z. 174-300 + 31-83.
//
//  Sortier-Regeln:
//    1. Gewerke nach GEWERKE_REIHENFOLGE; unbekannte Gewerke danach,
//       Reinigung IMMER ganz am Ende.
//    2. Positionen innerhalb eines Gewerks:
//         - Header (XX-000) zuerst
//         - Katalog-Positionen aufsteigend nach Leistungsnummer
//         - NEU-Positionen (aus_preisliste !== true) sortiert per
//           Token-Match-Score gegen die Katalog-Positionen im gleichen Gewerk
//         - Spezial-Positionen (XX-9NN) am Ende
//    3. Regie-Pos (XX-997 / XX-998) + direkt nachfolgende "Material für Regie"-Pos
//       bleiben als unzertrennliches Pärchen nebeneinander – Regie zuerst,
//       Material direkt danach.
//
//  Pure: mutiert weder das Input-Array noch die Position-Objekte.
// ────────────────────────────────────────────────────────────────────────────

import {
  Gewerk,
  Position,
  GEWERKE_REIHENFOLGE,
} from './types'

const MIN_SCORE_FOR_KI_RANK = 0.15

// Deutsche Stopp-Wörter, die beim Keyword-Matching ignoriert werden.
const STOP_WORDS = new Set<string>([
  'und', 'der', 'die', 'das', 'in', 'im', 'auf', 'von', 'mit',
  'pro', 'je', 'ca', 'ca.',
])

/**
 * Zerlegt einen Leistungsnamen in Match-Tokens.
 *  - lowercase
 *  - split an Whitespace + Sonderzeichen
 *  - Stopp-Wörter raus
 *  - Wortstamm: bei Länge > 4 → erste 4 Zeichen als Stem
 *
 * Beispiel: "Wand spachteln und schleifen" → ["wand", "spac", "schl"]
 */
export function tokenizeForMatch(s: string): string[] {
  const raw = String(s || '').toLowerCase()
  // split an allem was kein Buchstabe (inkl. Umlaute) ist
  const parts = raw.split(/[^a-zäöüß]+/i).filter(Boolean)
  const tokens: string[] = []
  for (const w of parts) {
    if (!w) continue
    if (STOP_WORDS.has(w)) continue
    if (w.length > 4) {
      tokens.push(w.slice(0, 4))
    } else {
      tokens.push(w)
    }
  }
  return tokens
}

/**
 * Wort-Similarity Score:
 *  - exakter Match           → 1.0
 *  - 4-Zeichen-Präfix-Match  → 0.7  (Stem-Match)
 *  - Substring               → 0.4
 *  - sonst                   → 0
 */
function wordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)) return 0.7
  if (a.includes(b) || b.includes(a)) return 0.4
  return 0
}

/**
 * Score 0..1: Durchschnitt der Best-Match-Similarities je KI-Token.
 */
function scoreNameMatch(kiName: string, catalogName: string): number {
  const w1 = tokenizeForMatch(kiName)
  const w2 = tokenizeForMatch(catalogName)
  if (w1.length === 0 || w2.length === 0) return 0
  let sum = 0
  for (const a of w1) {
    let best = 0
    for (const b of w2) {
      const sim = wordSimilarity(a, b)
      if (sim > best) best = sim
      if (best === 1) break
    }
    sum += best
  }
  return sum / w1.length
}

// ── Pos-Klassifikation ──────────────────────────────────────────────────

/** Suffix-Zahl (-NNN) aus einer Leistungsnummer extrahieren. -1 wenn keine. */
function suffixNum(leistungsnummer: string | null | undefined): number {
  const nr = String(leistungsnummer || '')
  const m = nr.match(/[-–](\d{3,})$/)
  if (!m) return -1
  const n = parseInt(m[1], 10)
  return isNaN(n) ? -1 : n
}

/** Header-Position: XX-000 */
function isHeaderPos(p: Position): boolean {
  return suffixNum(p.leistungsnummer) === 0
}

/** Spezial-Position: XX-9NN (Suffix 900-999) */
function isSpezialPos(p: Position): boolean {
  const n = suffixNum(p.leistungsnummer)
  return n >= 900 && n <= 999
}

/** Katalog-Position (aus_preisliste === true und keine NEU-Nummer) */
function isCatalogPos(p: Position): boolean {
  if (p.aus_preisliste !== true) return false
  const nr = String(p.leistungsnummer || '')
  return /^\d{2}-\d{3,}$/.test(nr)
}

/** Echte Regie-Stunden-Position (XX-997 oder XX-998) */
function isRegiePos(p: Position): boolean {
  const nr = String(p.leistungsnummer || '')
  return /-(997|998)$/.test(nr)
}

/** "Material für Regie"-Position – Erkennung über Name/Beschreibung */
function isMaterialFuerRegiePos(p: Position): boolean {
  const name = String(p.leistungsname || '').toLowerCase()
  const beschr = String(p.beschreibung || '').toLowerCase()
  return (name.includes('material') && name.includes('regie')) ||
         (beschr.includes('material') && beschr.includes('regie'))
}

// ── Gewerk-Order ────────────────────────────────────────────────────────

/**
 * Rang eines Gewerks innerhalb der globalen Reihenfolge.
 *   - Reinigung: IMMER zuletzt (Number.MAX_SAFE_INTEGER)
 *   - bekannt:   Index in GEWERKE_REIHENFOLGE
 *   - unbekannt: nach allen bekannten, aber vor Reinigung
 */
function gewerkRank(name: string): number {
  const norm = String(name || '').toLowerCase()
  if (norm.includes('reinigung')) return Number.MAX_SAFE_INTEGER
  const idx = GEWERKE_REIHENFOLGE.findIndex(g => g.toLowerCase() === norm)
  if (idx === -1) return GEWERKE_REIHENFOLGE.length // unbekannt: nach bekannten, vor Reinigung
  return idx
}

// ── Position-Buckets & Sort ─────────────────────────────────────────────

type BucketRank = 0 | 1 | 2 | 3
const BUCKET_HEADER: BucketRank = 0
const BUCKET_CATALOG: BucketRank = 1
const BUCKET_KI: BucketRank = 2
const BUCKET_SPEZIAL: BucketRank = 3

function bucketOf(p: Position): BucketRank {
  if (isHeaderPos(p)) return BUCKET_HEADER
  if (isSpezialPos(p)) return BUCKET_SPEZIAL
  if (isCatalogPos(p)) return BUCKET_CATALOG
  return BUCKET_KI
}

/**
 * Sortiert Positionen innerhalb eines Gewerks gemäß den oben dokumentierten
 * Regeln. Regie + Material-für-Regie werden vorher zu Gruppen gebündelt.
 */
function sortPositionenForGewerk(positionen: readonly Position[]): Position[] {
  // Phase 1: Regie + nachfolgendes "Material für Regie" als Pärchen gruppieren.
  // (Sonst zerreißt die Bucket-Sortierung 03-998 vor 03-999 bei mehrfachem Regie-Einsatz.)
  const groups: Position[][] = []
  let i = 0
  while (i < positionen.length) {
    const cur = positionen[i]
    const next = positionen[i + 1]
    if (next && isRegiePos(cur) && isMaterialFuerRegiePos(next)) {
      groups.push([cur, next])
      i += 2
    } else {
      groups.push([cur])
      i += 1
    }
  }

  // Phase 2: pro Gruppe Sortier-Schlüssel berechnen — basiert auf dem ersten
  // Element (= bei Pärchen die Regie-Position).
  const catalogPositionen = positionen.filter(isCatalogPos)

  type Keyed = {
    group: Position[]
    bucket: BucketRank
    /**
     * Sortier-Schlüssel innerhalb des Buckets:
     *   - Header / Spezial: numerischer Suffix
     *   - Katalog: numerischer Suffix
     *   - KI: -Score (negativ, damit höherer Score = früher sortiert)
     */
    subKey: number
    /** Stable-Sort-Anker. */
    originalIdx: number
  }

  const keyed: Keyed[] = groups.map((group, originalIdx) => {
    const p = group[0]
    const bucket = bucketOf(p)
    let subKey: number
    if (bucket === BUCKET_KI) {
      // NEU-Position: Score gegen Katalog-Positionen im gleichen Gewerk
      let best = 0
      for (const c of catalogPositionen) {
        const s = scoreNameMatch(String(p.leistungsname || ''), String(c.leistungsname || ''))
        if (s > best) best = s
      }
      // Score unter Schwellwert → ans Ende der KI-Sektion
      subKey = best >= MIN_SCORE_FOR_KI_RANK ? -best : 1
    } else {
      // Header / Katalog / Spezial: nach Suffix-Nummer
      subKey = suffixNum(p.leistungsnummer)
    }
    return { group, bucket, subKey, originalIdx }
  })

  keyed.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket
    if (a.subKey !== b.subKey) return a.subKey - b.subKey
    return a.originalIdx - b.originalIdx
  })

  return keyed.flatMap(k => k.group)
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Sortiert die Gewerke-Liste UND die Positionen innerhalb jedes Gewerks.
 *
 * Pure: weder das übergebene Array noch dessen Objekte werden mutiert.
 * Die Position-Objekte werden 1:1 wiederverwendet (Identität bleibt erhalten).
 */
export function sortGewerkeAndPositionen(gewerke: readonly Gewerk[]): Gewerk[] {
  // 1. Positionen pro Gewerk sortieren (neue Position-Arrays).
  const withSortedPos: Gewerk[] = gewerke.map(g => ({
    ...g,
    positionen: sortPositionenForGewerk(g.positionen || []),
  }))

  // 2. Gewerke nach Reihenfolge sortieren (stable über originalIdx).
  type GKeyed = { g: Gewerk; rank: number; originalIdx: number }
  const keyed: GKeyed[] = withSortedPos.map((g, i) => ({
    g,
    rank: gewerkRank(g.name),
    originalIdx: i,
  }))
  keyed.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.originalIdx - b.originalIdx
  })

  return keyed.map(k => k.g)
}
