// ────────────────────────────────────────────────────────────────────────────
//  detectKiVorschlag – portiert aus bau4you-app/src/lib/claude.js (Z. 1758-1845)
//
//  Markiert Positionen als KI-Vorschlag (isVorschlag: true) wenn sie nicht
//  durch den User-Text gedeckt sind. Auto-Vorschläge: 01-xxx (Gemeinkosten/BE)
//  und 13-xxx (Reinigung) werden NIE als Vorschlag markiert (bleiben ohne Badge).
//
//  Matching-Strategie (3 Ebenen, jede liefert "Match → kein Vorschlag"):
//    1. Stem-Match vorwärts: erste 6 Zeichen eines Position-Keywords liegen
//       im (synonym-erweiterten) User-Text.
//    2. Stem-Match rückwärts: erste 6 Zeichen eines User-Worts liegen als
//       Teilstring in einem Position-Keyword.
//    3. Synonym-Erweiterung: User-Text wird vor Match um Aliase ergänzt.
//
//  WICHTIG: Pure Funktion – Input wird nicht mutiert, neues Array via map().
// ────────────────────────────────────────────────────────────────────────────

import type { Gewerk, Position } from './types'

/**
 * Synonym-Map als (Trigger-Regex, Alias-Tokens)-Paare.
 * Wenn der User-Text das Trigger-Pattern enthält, werden die Aliase
 * an den normalisierten Text angehängt – Position-Keywords matchen dann
 * gegen ihre semantischen Verwandten.
 *
 * Quelle: bau4you/claude.js Z. 1766-1778 (1:1 portiert).
 */
const SYNONYME: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/streich|ausmal|malerarbeit/, ['anstrich', 'dispersi', 'farbanst', 'innenanst']],
  [/farb[e ]|farben /, ['anstrich', 'dispersi', 'farbanst']],
  [/grundier/, ['grundier', 'voranstr']],
  [/spachtel/, ['spachtel', 'glaettsp']],
  [/tapezier|tapete/, ['tapete', 'vliestap', 'tapezier']],
  [/vinyl|klickboden|bodenbelag/, ['vinyl', 'klickpar', 'bodenbe']],
  [/abdecken|abkleb|schutz/, ['abdeckar', 'schutzfo', 'abdeckun']],
  [/schleifen/, ['schleif', 'abschlei']],
  [/verfugen|fuggen/, ['verfug', 'fugenmoe']],
  [/abdicht/, ['abdicht']],
  [/daemm|daemmung/, ['daemmun', 'waermed']],
]

/**
 * Stopwords werden weder als Position-Keyword noch als User-Wort verwendet.
 * Quelle: bau4you/claude.js Z. 1786-1790.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'fuer', 'eine', 'einer', 'einem', 'eines', 'und', 'oder', 'mit', 'aus', 'auf',
  'den', 'dem', 'des', 'die', 'das', 'inkl', 'inklusive', 'sowie', 'pauschal',
  'meter', 'wand', 'decke', 'raum', 'flaeche', 'bereich', 'kosten', 'arbeit',
])

/** Präfix-Länge für Stem-Match (vorwärts + rückwärts). */
const STEM = 6

/** Auto-Vorschlag-Präfixe: werden NICHT als Vorschlag markiert (auch ohne Match). */
const AUTO_VORSCHLAG_PREFIXE: readonly string[] = ['01', '13']

/**
 * Normalisiert deutschen Text: lowercase + Umlaute → ASCII.
 * (Punktuation wird NICHT entfernt – das macht die Tokenisierung.)
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
 * Markiert alle Positionen die der User-Text NICHT abdeckt als KI-Vorschlag.
 *
 * Regeln:
 *  - bereits gesetzte `isVorschlag: true` bleiben unverändert.
 *  - `unsicher: true` Positionen werden NIE als Vorschlag markiert
 *    (stammen aus User-Eingabe, nur mit unsicherer Menge/Einheit).
 *  - 01-xxx (Baustelleneinrichtung) + 13-xxx (Reinigung) → automatisch dabei,
 *    NIE als Vorschlag markiert.
 *  - Pure Funktion: Input-Array bleibt unverändert.
 */
export function detectKiVorschlag(gewerke: Gewerk[], eingabeText: string): Gewerk[] {
  const eingabe = norm(eingabeText)

  // Eingabe um Synonym-Aliase erweitern (nur für Vorwärts-Match)
  let eingabePlus = eingabe
  for (const [re, aliase] of SYNONYME) {
    if (re.test(eingabe)) eingabePlus += ' ' + aliase.join(' ')
  }

  return gewerke.map(gewerk => {
    const positionen: Position[] = (gewerk.positionen || []).map(pos => {
      if (pos.isVorschlag) return pos
      if (pos.unsicher) return pos

      const nr = String(pos.leistungsnummer || '')
      const prefix = nr.split('-')[0]
      if (AUTO_VORSCHLAG_PREFIXE.includes(prefix)) return pos

      const kurztext = norm(pos.leistungsname || '')
      const keywords = kurztext
        .split(/[\s\-–,/()]+/)
        .filter(w => w.length >= 4 && !STOPWORDS.has(w))

      if (keywords.length === 0) return pos

      // Ebene 1: Stem-Match vorwärts (Keyword-Präfix im synonym-erweiterten User-Text)
      const stemVorwaerts = keywords.some(kw => {
        const stem = kw.slice(0, STEM)
        return stem.length >= 4 && eingabePlus.includes(stem)
      })
      if (stemVorwaerts) return pos

      // Ebene 2: Stem-Match rückwärts (User-Wort-Präfix im Position-Keyword)
      const userWords = eingabe
        .split(/\s+/)
        .filter(w => w.length >= 4 && !STOPWORDS.has(w))
      const stemRueckwaerts = userWords.some(uw => {
        const stem = uw.slice(0, STEM)
        return keywords.some(kw => kw.includes(stem))
      })
      if (stemRueckwaerts) return pos

      return { ...pos, isVorschlag: true }
    })
    return { ...gewerk, positionen }
  })
}

/**
 * Entfernt "[VORSCHLAG]" Markierungen aus leistungsname + beschreibung
 * und setzt isVorschlag: true. Wenn kein Tag vorhanden ist, bleibt die
 * Position unverändert (referentielle Identität).
 *
 * Quelle: bau4you/claude.js Z. 1834-1845 (1:1 portiert).
 */
export function stripVorschlag(pos: Position): Position {
  if (!pos || typeof pos !== 'object') return pos
  const name = String(pos.leistungsname || '')
  const desc = String(pos.beschreibung || '')
  if (!name.includes('[VORSCHLAG]') && !desc.includes('[VORSCHLAG]')) return pos
  return {
    ...pos,
    isVorschlag: true,
    leistungsname: name.replace(/\[VORSCHLAG\]\s*/gi, '').trim(),
    beschreibung: desc.replace(/\[VORSCHLAG\]\s*/gi, '').trim(),
  }
}
