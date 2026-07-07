// ────────────────────────────────────────────────────────────────────────────
//  extractFields.ts – Feld-Extraktion aus Sprach-Transkripten
//
//  Portiert von:
//    - bau4you/src/lib/speechExtract.js          (extractErgaenzungenHinweise)
//    - bau4you/src/components/SpeechInput.jsx    (extractFields, Z. 44-127)
//
//  Hauptaufgabe:
//    Whisper liefert Roh-Text wie
//      "PN 369, Adresse Hyegasse 3 1030 Wien, Betrifft Renovierung,
//       Wand spachteln 30m², Ergänzung hochwertige Farbe, nächste Position
//       Decke streichen"
//    Wir zerlegen ihn in 4 strukturierte Felder + extrahieren optional
//    Ergänzungen/Hinweise als separate Listen.
//
//  Designziele:
//    - Pure Logik, kein DOM, kein Side-Effect → 100% testbar.
//    - Komma-tolerant (Hero-Adressformat „Straße 5, 1030 Wien").
//    - Robust gegen Whisper-Quirks (Klein-/Großschreibung, Füllwörter).
// ────────────────────────────────────────────────────────────────────────────

// ─────────────────────────── Public Types ────────────────────────────────────

export interface ExtractedFields {
  betrifft?: string
  /** Roh-Text der Positionen – mehrzeilig als Bullet-Liste („• …\n• …"). */
  positionen: string
}

export interface ErgaenzungenHinweise {
  cleanedText: string
  ergaenzungen: string[]
  hinweise: string[]
}

// ─────────────────────────── Section-Markers ─────────────────────────────────
//  Ergänzung / Hinweis – auch mit Präfixen „als / noch eine / weiterer".

interface SectionMarker {
  type: 'ergaenzung' | 'hinweis'
  re: RegExp
}

const SECTION_MARKERS: readonly SectionMarker[] = [
  { type: 'ergaenzung', re: /(?:(?:als|noch\s+eine?|weitere[rs]?)\s+)?erg[äa]nzung(?:en)?/i },
  { type: 'hinweis', re: /(?:(?:als|noch\s+eine?n?|weitere[rs]?)\s+)?hinweis(?:e)?/i },
]

function buildSectionRegex(): RegExp {
  const parts = SECTION_MARKERS.map((m) => `(${m.re.source})`)
  return new RegExp(`\\b(?:${parts.join('|')})\\b[,:\\s]*`, 'gi')
}

const COMBINED_RE = buildSectionRegex()

/**
 *  END_MARKERS_RE – Signale, dass die Ergänzungs-/Hinweis-Sektion endet
 *  und normaler Positionstext fortgesetzt wird. Werden NICHT konsumiert,
 *  sondern bleiben im `cleanedText`.
 */
const END_MARKERS_RE =
  /(?:\n•|\b(?:n[aä]chste\s+position|n[aä]chster\s+punkt|weiters|au[sß]erdem|zus[aä]tzlich|dann\s+noch|und\s+dann|dann\b|ansonsten|des\s+weiteren|dar[uü]ber\s+hinaus))/gi

function classifyKeyword(keyword: string): 'ergaenzung' | 'hinweis' | null {
  const lower = keyword.toLowerCase().replace(/[,:\s]+$/, '')
  if (/erg[äa]nzung/i.test(lower)) return 'ergaenzung'
  if (/hinweis/i.test(lower)) return 'hinweis'
  return null
}

/**
 *  Findet das früheste Ende einer Ergänzungs-/Hinweis-Sektion.
 *  Stop-Kriterien (das jeweils früheste gewinnt):
 *    1. Nächster Section-Marker (oder Textende)
 *    2. End-Marker (z. B. „nächste Position", „außerdem", „\n•")
 *    3. Satzende [.!?] gefolgt von Großbuchstabe (neuer Satz)
 */
function findContentEnd(
  text: string,
  contentStart: number,
  nextSectionStart: number,
): number {
  let end = nextSectionStart
  const searchArea = text.slice(contentStart, nextSectionStart)

  END_MARKERS_RE.lastIndex = 0
  const endMatch = END_MARKERS_RE.exec(searchArea)
  if (endMatch) {
    end = contentStart + endMatch.index
  }

  const sentenceEndRe = /[.!?]\s+(?=[A-ZÄÖÜ])/g
  const sentenceMatch = sentenceEndRe.exec(searchArea)
  if (sentenceMatch) {
    const sentenceEnd = contentStart + sentenceMatch.index + 1
    if (sentenceEnd < end) {
      end = sentenceEnd
    }
  }

  return end
}

/**
 *  Trennt Ergänzungen/Hinweise vom restlichen Text.
 *
 *  Beispiel:
 *    Input:  "Wand spachteln. Ergänzung: hochwertige Farbe. Nächste Position
 *             Decke streichen."
 *    Output: cleanedText  = "Wand spachteln. Nächste Position Decke streichen."
 *            ergaenzungen = ["hochwertige Farbe"]
 *            hinweise     = []
 */
export function extractErgaenzungenHinweise(text: string): ErgaenzungenHinweise {
  if (!text) return { cleanedText: text || '', ergaenzungen: [], hinweise: [] }

  COMBINED_RE.lastIndex = 0
  const matches = [...text.matchAll(COMBINED_RE)]

  if (matches.length === 0) {
    return { cleanedText: text, ergaenzungen: [], hinweise: [] }
  }

  const ergaenzungen: string[] = []
  const hinweise: string[] = []
  const segments: Array<{ start: number; end: number }> = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (match.index === undefined) continue
    const keywordStart = match.index
    const contentStart = keywordStart + match[0].length

    const nextSectionStart =
      i + 1 < matches.length && matches[i + 1].index !== undefined
        ? (matches[i + 1].index as number)
        : text.length

    const contentEnd = findContentEnd(text, contentStart, nextSectionStart)

    let content = text.slice(contentStart, contentEnd).trim()
    content = content.replace(/[,;.]+\s*$/, '').trim()

    if (!content) continue

    const type = classifyKeyword(match[0])
    if (!type) continue

    if (type === 'ergaenzung') ergaenzungen.push(content)
    else hinweise.push(content)

    segments.push({ start: keywordStart, end: contentEnd })
  }

  if (segments.length === 0) {
    return { cleanedText: text, ergaenzungen: [], hinweise: [] }
  }

  // Reverse-Iteration, damit die Indizes stabil bleiben.
  let cleanedText = text
  for (let i = segments.length - 1; i >= 0; i--) {
    const { start, end } = segments[i]
    cleanedText = cleanedText.slice(0, start) + cleanedText.slice(end)
  }

  cleanedText = cleanedText
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[,;.]\s*/, '')
    .replace(/\s*[,;.]\s*$/, '')
    .trim()

  return { cleanedText, ergaenzungen, hinweise }
}

// ─────────────────────────── Field-Extraction ────────────────────────────────

/** „nächste Position" – primärer Trenner für Bullet-Listen. */
const NAECHSTE_POSITION_RE = /n[aä]chste\s+position/gi

/** Sekundäre Signalwörter (Fallback, wenn „nächste Position" fehlt). */
const SIGNAL_WORDS_FALLBACK =
  /\b(nächster\s+punkt|nächstes|weiters|außerdem|zusätzlich|dann\s+noch|dann|und\s+dann)\b/gi

/**
 *  Adresse – explizite Variante: nach „Adresse" / „für die" greift lazy zu,
 *  Kommas erlaubt (Hero-Format „Straße 5, Top 3, 1010 Wien").
 *  Stop: Satzende, „betrifft"-Keyword, Newline. Negative Lookbehind (?<!\d)
 *  verhindert Stop bei „2. OG".
 */
const ADRESSE_EXPLICIT_RE =
  /(?:adresse|f[uü]r\s+die)[,:\s]+(?:ist\s+|sind\s+|lautet\s+)?(.+?)(?=\s*(?<!\d)[.!?]\s*(?:$|[A-ZÄÖÜ•])|\s+(?:betrifft|es\s+geht\s+um|geht\s+um|n[aä]chste)\b|\n|$)/i

/** Adresse – Heuristik via Straßenendung („…straße/…gasse/…weg …"). */
const ADRESSE_STREET_RE =
  /((?:[\wäöüßÄÖÜ-]+\s+){0,3}[\wäöüßÄÖÜ-]*(?:stra[sß]e|gasse|weg|platz|ring|allee|l[aä]nde|steig|zeile|hof|markt|br[uü]cke|promenade|ufer|damm|g[uü]rtel|boulevard)\s+\d+[a-z]?.+?)(?=\s*(?<!\d)[.!?]\s*(?:$|[A-ZÄÖÜ•])|\s+(?:betrifft|es\s+geht\s+um|geht\s+um|n[aä]chste)\b|\n|$)/i

/** Betrifft – „betrifft" / „es geht um" / „geht um". */
const BETRIFFT_RE =
  /(?:betrifft|es\s+geht\s+um|geht\s+um)\s+(?:ist\s+|sind\s+|lautet\s+|:\s*)?([^,.!?\n]+)/i

/** Projektnummer – „Projektnummer", „Projekt Nr.", „Hero Nr.", „P-Nr.", „PN". */
const PROJEKTNUMMER_RE =
  /(?:(?:hero\s+)?projekt(?:\s*nummer)?(?:\s*[-.\s]?nr\.?)?|p[-.\s]?nr\.?|hero\s+nr\.?|\bpn)\s*:?\s*(?:ist|lautet|number|#)?\s*([^\s.,!?\n•]+)/i

/** Standard-Floskeln, die nicht als Bullet zählen. */
const IGNORE_BULLET_RE =
  /^ich\s+(brauche|möchte|hätte\s+gern|will)\s+ein\s+angebot|^ein\s+angebot\s+(für|bitte)|^angebot\s+für/i

/**
 *  Wohnungs-Suffix-Regex (für externen Export & internes Cleanup).
 *  Erkennt: Top X, Tür X, Stiege X [Top Y], OG, EG, Keller, Stiegenhaus, Hof.
 */
export const WOHNUNG_RE =
  /(?:top|stiege|t[uü]r|t[uü]r)\s*\d+\w*/i

/**
 *  Strikteres internes Wohnungs-Suffix: muss am Anfang stehen (nach Trim).
 *  Wird genutzt, um Suffixe aus dem Positionen-Text zurück in die Adresse
 *  zu schieben.
 */
const WOHNUNGS_SUFFIX_RE =
  /^(stiege\s+\d+[a-z]?(?:\s+top\s+[\d+-]+[a-z]?)?|top\s+[\d+-]+[a-z]?|t[uü]r\s+\d+[a-z]?|[odeu]g\s+\d*|keller|stiegenhaus(?:\s+und\s+hof)?|hof)/i

function cleanPart(s: string): string {
  return s
    .trim()
    .replace(/^[,.:;!?\s]+/, '')
    .replace(/[.!?,;]+$/, '')
    .trim()
}

/**
 *  Extrahiert die 4 Felder (projektnummer, adresse, betrifft, positionen)
 *  aus einem Roh-Transkript.
 *
 *  Reihenfolge wichtig:
 *    1. PROJEKTNUMMER zuerst (kurzer, eindeutiger Marker)
 *    2. ADRESSE (explizit > Straßen-Heuristik)
 *       - PLZ-Trim: alles nach „PLZ Ort" → zurück nach `remaining`
 *       - Wohnungs-Suffixe einsammeln, falls am Anfang von `remaining`
 *    3. BETRIFFT
 *    4. Rest → Positionen, split via „nächste Position" oder Fallback
 */
export function extractFields(rawText: string): ExtractedFields {
  if (!rawText || !rawText.trim()) {
    return { betrifft: '', positionen: '' }
  }

  let remaining = rawText

  // ── 1. Projektnummer-Pattern wird konsumiert (nicht zurueckgegeben) ──
  // Projektnummer-Zuordnung erfolgt in b4y-superapp manuell ueber das
  // Projekt-Dropdown im Editor (User-Wunsch 2026-06-24).
  const pnrMatch = remaining.match(PROJEKTNUMMER_RE)
  if (pnrMatch) {
    remaining = remaining.replace(pnrMatch[0], ' ').trim()
  }

  // ── 2. Adresse ────────────────────────────────────────────────────
  let adresse = ''
  const adresseMatch =
    remaining.match(ADRESSE_EXPLICIT_RE) || remaining.match(ADRESSE_STREET_RE)
  if (adresseMatch) {
    let adresseRaw = (adresseMatch[1] || adresseMatch[0])
      .replace(/[,.\s]+$/, '')
      .trim()

    // Safety: Falls „betrifft" durchgerutscht ist → abschneiden.
    const keywordCut = adresseRaw.match(
      /\s+((?:betrifft|es\s+geht\s+um|geht\s+um)\b.*)$/i,
    )
    if (keywordCut && keywordCut.index !== undefined) {
      adresseRaw = adresseRaw.slice(0, keywordCut.index).trim()
    }

    // PLZ-Trim: alles nach „PLZ Ort, …" wandert zurück nach `remaining`.
    // FIX vs. bau4you: separator [,.] ist Pflicht. Sonst backtracked die Engine
    // den letzten Buchstaben des Ortes in group 2 (z. B. „Wien" → „Wie" + „n").
    const plzOrtTrim = adresseRaw.match(/^(.*?\d{4}\s+[\wÄÖÜäöü]+)\s*[,.]\s*(.+)/)
    if (
      plzOrtTrim &&
      plzOrtTrim[2] &&
      !/^(?:top|stiege|t[uü]r|stock|og|eg|dg|ug|keller|hof)\b/i.test(plzOrtTrim[2])
    ) {
      adresseRaw = plzOrtTrim[1].trim()
      remaining = plzOrtTrim[2].trim() + (remaining ? ' ' + remaining : '')
    }

    adresse = adresseRaw
    remaining = remaining.replace(adresseMatch[0], ' ').trim()

    if (keywordCut) {
      remaining = keywordCut[1].trim() + (remaining ? ' ' + remaining : '')
    }

    // Orphan „Adresse"-Keyword am Anfang von `remaining` entfernen.
    remaining = remaining
      .replace(/^[\s,.:;]*\b(?:adresse|die\s+adresse)\b[\s,.:;]*/i, '')
      .trim()

    // Wohnungs-Suffix einsammeln, falls am Anfang von `remaining`.
    const remainingForWohnung = remaining.replace(/^[\s,.:;]+/, '')
    const wohnungsMatch = remainingForWohnung.match(WOHNUNGS_SUFFIX_RE)
    if (wohnungsMatch) {
      adresse = adresse + ' ' + wohnungsMatch[0].trim()
      remaining = remainingForWohnung.slice(wohnungsMatch[0].length).trim()
    }

    // Wenn noch keine PLZ erkannt → trailing „1030 Wien" einsammeln.
    if (!/\d{4}/.test(adresse)) {
      const plzClean = remaining.replace(/^[\s,.:;]+/, '')
      const plzMatch = plzClean.match(/^(\d{4})\s+([\wÄÖÜäöü]+)/)
      if (plzMatch) {
        adresse += `, ${plzMatch[1]} ${plzMatch[2]}`
        remaining = plzClean.slice(plzMatch[0].length).trim()
      }
    }
  }

  // ── 3. Betrifft ───────────────────────────────────────────────────
  let betrifft = ''
  const betrifftMatch = remaining.match(BETRIFFT_RE)
  if (betrifftMatch) {
    betrifft = betrifftMatch[1].replace(/[,.\s]+$/, '').trim()
    remaining = remaining.replace(betrifftMatch[0], ' ').trim()
  }

  remaining = remaining.replace(/^\s*[,.:;!?]+\s*/, '').trim()

  // ── 4. Positionen ─────────────────────────────────────────────────
  let bullets: string[]
  const primaryParts = remaining.split(NAECHSTE_POSITION_RE)
  if (primaryParts.length > 1) {
    bullets = primaryParts
      .map(cleanPart)
      .filter((s) => s.length > 2)
      .filter((s) => !IGNORE_BULLET_RE.test(s))
      .filter((s) => !PROJEKTNUMMER_RE.test(s))
      .filter((s) => !WOHNUNGS_SUFFIX_RE.test(s))
  } else {
    const normalised = remaining.replace(SIGNAL_WORDS_FALLBACK, '\x00')
    // eslint-disable-next-line no-control-regex
    const fallbackParts = normalised.split(/[.!?]+\s+|\x00/)
    bullets = fallbackParts
      .map(cleanPart)
      .filter((s) => s.length > 2)
      .filter((s) => !IGNORE_BULLET_RE.test(s))
      .filter((s) => !PROJEKTNUMMER_RE.test(s))
      .filter((s) => !WOHNUNGS_SUFFIX_RE.test(s))
    if (bullets.length === 0 && remaining.trim().length > 2) {
      bullets = [remaining.trim()]
    }
  }

  // adresse wird intern weiterhin geparsed (damit "Hyegasse 3" + Wohnungs-
  // Suffixe nicht als Position-Bullets landen), aber NICHT mehr zurueckgegeben.
  // Die Kunden-Adresse kommt im neuen Workflow aus dem ausgewaehlten Kontakt;
  // das Pre-Step-Modal (VoiceAngebotPrestepModal) erzwingt die Kunden-Wahl
  // vor dem Voice-Dialog. Variable absichtlich referenziert, damit der
  // Compiler die obige Logik nicht als toten Code wegoptimiert.
  void adresse

  return {
    betrifft,
    positionen: bullets.map((b) => `• ${b}`).join('\n'),
  }
}
