// ────────────────────────────────────────────────────────────────────────────
//  zimmer.ts – Zimmer-/Raum-Erkennung & Injection in Langtexte
//  Quelle: bau4you-app/src/lib/claude.js Zeilen 1850-2064
//
//  Aufgabe:
//    - Erkennen ob ein Text bereits eine Raum-Bezeichnung enthält
//    - Räume aus einem User-Segment extrahieren
//    - "im {Raum}" intelligent in eine Position-Beschreibung einfügen
//    - Verstreute Raum-Referenzen im selben Langtext zusammenführen
//    - Nach KI-Antwort: fehlende Raum-Angaben aus User-Input nachziehen
//
//  Pure Functions – keine Mutation des Inputs.
// ────────────────────────────────────────────────────────────────────────────

import type { Gewerk, Position } from './types'

// ─── Konstanten ────────────────────────────────────────────────────────────

/**
 * Erkannte Zimmer-Namen.
 * Reihenfolge: längere Komposita (z. B. "badezimmer", "kinderzimmer") VOR
 * kürzeren ("bad") damit das Regex-Alternation greedy matched.
 * Quelle: bau4you/claude.js Z. 1850-1854 + Task-Spec Erweiterung.
 */
export const ZIMMER_NAMES: readonly string[] = [
  // Komposita zuerst (greedy match)
  'schlafzimmer',
  'wohnzimmer',
  'badezimmer',
  'kinderzimmer',
  'arbeitszimmer',
  'esszimmer',
  'gästezimmer',
  'gaestezimmer',
  'abstellraum',
  'abstellzimmer',
  'stiegenhaus',
  'dachboden',
  'hauswirtschaftsraum',
  'vorraum',
  'vorzimmer',
  'eingang',
  'foyer',
  'ankleide',
  'balkon',
  'terrasse',
  'loggia',
  'diele',
  'gang',
  'keller',
  'speis',
  'lager',
  'hwr',
  // kürzere zuletzt
  'küche',
  'kueche',
  'flur',
  'wc',
  'bad',
] as const

/**
 * Globales Regex zum Finden eines Raum-Namens (optional mit Ziffer dahinter,
 * z. B. "Bad 2"). Wird mit `lastIndex = 0` resettet vor jedem Lauf.
 */
const ZIMMER_RE_GLOBAL = new RegExp(
  `\\b((?:${ZIMMER_NAMES.join('|')})(?:\\s*\\d+)?)\\b`,
  'gi',
)

/**
 * Erkennung für "in der gesamten/ganzen/kompletten Wohnung" oder
 * einfaches "in der Wohnung" — wird als Raum-Bezeichnung behandelt.
 * Verhindert dass injectZimmerbezeichnungen fälschlich einen Raum
 * dazwischenfügt wenn die Beschreibung schon eine Wohnung-Bezeichnung hat.
 * Bau4you Z. 1866.
 */
export const WOHNUNG_RE = /(?:top|stiege|t[üu]r)\s*\d+\w*|\b(?:(?:gesamt|ganz|komplett)(?:e|er|en|es)?\s+wohnung|in\s+der\s+wohnung|der\s+(?:gesamten|ganzen|kompletten)\s+wohnung)\b/i

/**
 * Stopwords für die Keyword-Extraktion aus leistungsname.
 * Bau4you Z. 1731-1737.
 */
const KEYWORD_STOPWORDS = new Set<string>([
  'und', 'oder', 'mit', 'aus', 'auf', 'den', 'dem', 'des', 'die', 'das', 'ein', 'eine',
  'fuer', 'einer', 'einem', 'eines',
  'für', 'von', 'nach', 'zum', 'zur', 'beim', 'inkl', 'inklusive', 'sowie', 'bzw', 'etc',
  'gemäß', 'laut', 'per', 'je', 'stück', 'pauschal', 'laufmeter', 'meter',
  'wand', 'decke', 'raum', 'fläche', 'flaeche', 'bereich', 'kosten', 'arbeit', 'arbeiten',
])

// ─── kleine Helper ─────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * Lokale Kopie von `extractKeywords` (bau4you Z. 1739-1745). Wir duplizieren
 * hier bewusst um Zirkular-Imports mit detectKiVorschlag zu vermeiden.
 */
function extractKeywords(leistungsname: string | null | undefined): string[] {
  return String(leistungsname || '')
    .toLowerCase()
    .replace(/[()/\-,]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !KEYWORD_STOPWORDS.has(w))
}

/**
 * Lokale Kopie von `isMaterialFuerRegiePos` (bau4you Z. 719-724) — vermeidet
 * Zirkular-Import auf enrichFromCatalog falls dort definiert.
 */
function isMaterialFuerRegiePos(pos: Position): boolean {
  const name = String(pos.leistungsname || '').toLowerCase()
  const beschr = String(pos.beschreibung || '').toLowerCase()
  return (
    (name.includes('material') && name.includes('regie')) ||
    (beschr.includes('material') && beschr.includes('regie'))
  )
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Prüft ob ein Text bereits eine Zimmerbezeichnung ODER "gesamte Wohnung"
 * bzw. Top-/Stiegen-/Tür-Nummer enthält.
 * Bau4you Z. 1869-1875.
 */
export function textHasRoom(text: string | null | undefined): boolean {
  const lower = String(text || '').toLowerCase()
  ZIMMER_RE_GLOBAL.lastIndex = 0
  if (ZIMMER_RE_GLOBAL.test(lower)) return true
  return WOHNUNG_RE.test(lower)
}

/**
 * Extrahiert alle Zimmer-Namen aus einem Textsegment.
 * Reihenfolge des ersten Auftretens bleibt erhalten, Duplikate werden entfernt.
 * Bau4you Z. 1878-1889.
 */
export function extractRoomsFromSegment(
  text: string | null | undefined,
): string[] {
  const lower = String(text || '').toLowerCase()
  ZIMMER_RE_GLOBAL.lastIndex = 0
  const rooms: string[] = []
  let m: RegExpExecArray | null
  while ((m = ZIMMER_RE_GLOBAL.exec(lower)) !== null) {
    const r = m[1].trim()
    if (!rooms.includes(r)) rooms.push(r)
  }
  return rooms
}

/**
 * Fügt `im {Zimmer}` an der natürlichsten Stelle in eine Beschreibung ein.
 * Strategie (bau4you Z. 1900-1911):
 *   1. Wenn schon ein Zimmer drin → unverändert
 *   2. Vor `, inklusive` / `, inkl.` einsetzen
 *   3. Sonst vor dem ersten `, ` einsetzen
 *   4. Sonst anhängen (Punkt am Ende strippen → `… im X.`)
 *
 * `zimmer` kann ein einzelner Raum sein oder ein bereits zusammengesetzter
 * String (z. B. "Schlafzimmer und Bad") — wird unverändert hinter "im "
 * eingefügt nur das erste Zeichen wird capitalized.
 */
export function insertRoomIntoBeschreibung(
  text: string | null | undefined,
  zimmer: string | string[] | null | undefined,
): string {
  const safeText = String(text || '')
  if (!safeText) return safeText

  // Normalize zimmer parameter (string oder string[])
  let zimmerStr: string
  if (Array.isArray(zimmer)) {
    if (zimmer.length === 0) return safeText
    zimmerStr = zimmer.map((z) => capitalize(String(z))).join(' und ')
  } else {
    if (!zimmer) return safeText
    zimmerStr = capitalize(String(zimmer))
  }

  // Wenn schon ein Zimmer im Text → unverändert
  if (textHasRoom(safeText)) return safeText

  const phrase = ` im ${zimmerStr}`

  // Vor ", inklusive" / ", inkl"
  const inkIdx = safeText.search(/,\s*inkl(?:usive)?[\s.,:]/i)
  if (inkIdx > 0) return safeText.slice(0, inkIdx) + phrase + safeText.slice(inkIdx)

  // Vor erstem ", "
  const commaIdx = safeText.indexOf(', ')
  if (commaIdx > 5) return safeText.slice(0, commaIdx) + phrase + safeText.slice(commaIdx)

  // Anhängen (Punkt strippen)
  return safeText.replace(/\.\s*$/, '') + phrase + '.'
}

/**
 * Post-Processing: Wenn die KI Räume getrennt im selben Langtext erwähnt
 * (z. B. "im Vorzimmer Wand spachteln im Bad") werden sie zusammengeführt
 * ("im Vorzimmer und Bad Wand spachteln").
 *
 * Operiert auf Gewerk-Array (Bau4you Z. 1918-1986).
 */
export function fixSplitRoomReferences(gewerke: Gewerk[]): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke

  const ROOM_WORDS = ZIMMER_NAMES.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )
  const roomPattern = new RegExp(
    `\\b(im|in)\\s+(${ROOM_WORDS.join('|')})(?:\\s*\\d+)?\\b`,
    'gi',
  )

  return gewerke.map((gewerk) => ({
    ...gewerk,
    positionen: (gewerk.positionen || []).map((pos) => {
      const beschreibung = pos.beschreibung || ''
      if (!beschreibung) return pos

      roomPattern.lastIndex = 0
      const matches: Array<{
        full: string
        preposition: string
        room: string
        index: number
        endIndex: number
      }> = []
      let m: RegExpExecArray | null
      while ((m = roomPattern.exec(beschreibung)) !== null) {
        matches.push({
          full: m[0],
          preposition: m[1],
          room: m[2],
          index: m.index,
          endIndex: m.index + m[0].length,
        })
      }

      if (matches.length < 2) return pos

      const uniqueRooms: string[] = []
      const seen = new Set<string>()
      for (const match of matches) {
        const key = match.room.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          uniqueRooms.push(capitalize(match.room))
        }
      }
      if (uniqueRooms.length < 2) return pos

      const combined = `${matches[0].preposition} ${uniqueRooms.join(' und ')}`

      let newBeschreibung = beschreibung
      // Hintere matches zuerst entfernen (Indices bleiben gültig)
      for (let i = matches.length - 1; i >= 1; i--) {
        const match = matches[i]
        const before = newBeschreibung.slice(0, match.index)
        const after = newBeschreibung.slice(match.endIndex)
        const cleanBefore = before.replace(/[\s,]+$/, '')
        const cleanAfter = after.replace(/^[\s,]+/, '')
        const needsSep =
          cleanBefore.length > 0 &&
          cleanAfter.length > 0 &&
          !/[.!?,;:]$/.test(cleanBefore) &&
          !/^[.!?,;:]/.test(cleanAfter)
        newBeschreibung = cleanBefore + (needsSep ? ', ' : ' ') + cleanAfter
      }
      // Ersten Match durch combined ersetzen
      const firstMatch = matches[0]
      newBeschreibung =
        newBeschreibung.slice(0, firstMatch.index) +
        combined +
        newBeschreibung.slice(firstMatch.index + firstMatch.full.length)

      newBeschreibung = newBeschreibung.replace(/\s{2,}/g, ' ').trim()

      if (newBeschreibung !== beschreibung) {
        return { ...pos, beschreibung: newBeschreibung }
      }
      return pos
    }),
  }))
}

/**
 * Nach der KI-Antwort: Räume aus dem User-Input in die Beschreibungen
 * der Positionen einfügen, sofern dort noch keine Raum-Angabe steht.
 *
 * Strategie (Bau4you Z. 1992-2064):
 *   1. User-Text an "nächste position" / "•" splitten → Segmente
 *      (zusätzlich: "weiters", "außerdem", "dann", "danach")
 *   2. Pro Segment: gefundene Räume merken, sonst lastRooms forwarden
 *   3. Pro Position (mit fehlender Raumangabe): Segment mit höchstem
 *      Keyword-Match aus leistungsname suchen → Raum daraus übernehmen
 *   4. Fallback: alle global im Input gefundenen Räume
 *
 * Skip:
 *   - Beschreibung enthält schon Raum
 *   - 01-001 / 01-002 (Baustelleneinrichtung)
 *   - XX-000 (Header)
 *   - Material-für-Regie-Positionen
 */
export function injectZimmerbezeichnungen(
  gewerke: Gewerk[],
  eingabeText: string | null | undefined,
): Gewerk[] {
  if (!eingabeText || !gewerke || gewerke.length === 0) return gewerke

  // Stop-Markers: bau4you nutzt nur "nächste Position" + "•" — wir erweitern
  // gemäß Task-Spec um "weiters", "außerdem", "dann", "danach".
  const STOP_MARKERS = /n[aä]chste\s+position|•|\bweiters\b|\bau(?:ß|ss)erdem\b|\bdann\b|\bdanach\b/gi

  const segments = String(eingabeText)
    .split(STOP_MARKERS)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)

  if (segments.length === 0) return gewerke

  // Pro-Segment-Räume mit carry-forward des letzten erkannten Raums
  let lastRooms: string[] = []
  const segmentData = segments.map((seg) => {
    const rooms = extractRoomsFromSegment(seg)
    if (rooms.length > 0) lastRooms = rooms
    // else: lastRooms bleibt — gilt für "selbe/dort/gleich" und für leere Hinweise
    return {
      text: seg.toLowerCase(),
      rooms: rooms.length > 0 ? rooms : [...lastRooms],
    }
  })

  // Globaler Fallback: alle Räume die irgendwo im Input vorkommen
  const globalRooms = extractRoomsFromSegment(String(eingabeText).toLowerCase())

  return gewerke.map((gewerk) => {
    const positionen = (gewerk.positionen || []).map((pos) => {
      const beschreibung = pos.beschreibung || ''

      // Skip wenn schon Raum
      if (textHasRoom(beschreibung)) return pos

      // Skip BE + Header
      const nr = String(pos.leistungsnummer || '')
      if (nr === '01-001' || nr === '01-002') return pos
      if (/[-–]\s*000$/.test(nr)) return pos

      // Skip Material-für-Regie
      if (isMaterialFuerRegiePos(pos)) return pos

      // Bestes Segment via Keyword-Score finden
      const keywords = extractKeywords(pos.leistungsname || '')
      let bestRooms: string[] = []
      let bestScore = -1

      for (const seg of segmentData) {
        if (seg.rooms.length === 0) continue
        const score = keywords.filter((kw) => seg.text.includes(kw)).length
        if (score > bestScore) {
          bestScore = score
          bestRooms = seg.rooms
        }
      }

      // Fallback: globale Räume
      if (bestRooms.length === 0) bestRooms = globalRooms
      if (bestRooms.length === 0) return pos

      const zimmer =
        bestRooms.length === 1
          ? bestRooms[0]
          : bestRooms.map(capitalize).join(' und ')

      const newBeschreibung = insertRoomIntoBeschreibung(beschreibung, zimmer)
      if (newBeschreibung === beschreibung) return pos

      return { ...pos, beschreibung: newBeschreibung }
    })
    return { ...gewerk, positionen }
  })
}
