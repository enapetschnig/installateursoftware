// ────────────────────────────────────────────────────────────────────────────
//  parseJson – Robuste Extraktion von JSON aus KI-Antworten.
//
//  Quelle: bau4you-app/src/lib/claude.js Z. 1487-1593.
//
//  Drei Hilfen:
//    • cleanWebSearchTags(text)   – entfernt <cite>/<a>/<span>… HTML-Tags
//    • repairTruncatedJson(text)  – schließt offene { / [ am Ende
//    • parseJsonResponse<T>(text) – 4-stufige Extraktion (raw → md → first/last → regex)
//
//  Bei totalem Fehlschlag wirft parseJsonResponse einen Error mit
//  (err as any).isParseError = true – damit Aufrufer ge­zielt "Bitte erneut" zeigt.
// ────────────────────────────────────────────────────────────────────────────

export interface ParseJsonError extends Error {
  isParseError: true
  rawText?: string
}

/**
 * Entfernt <cite>-Tags und andere HTML-Tags (z. B. von Web-Search-Antworten).
 * Wird typischerweise auf `leistungsname`/`beschreibung` jeder Position
 * angewendet, bevor diese im UI angezeigt werden.
 */
export function cleanWebSearchTags(text: string): string {
  if (!text) return text
  let out = text
  out = out.replace(/<cite[^>]*>/gi, '')
  out = out.replace(/<\/cite>/gi, '')
  out = out.replace(/<[^>]+>/g, '')
  out = out.replace(/\s{2,}/g, ' ')
  return out.trim()
}

/**
 * Versucht abgeschnittenes JSON zu reparieren, indem unvollständige Werte
 * am Ende entfernt und offene Klammern (`{`, `[`) geschlossen werden.
 *
 * Gibt den (ggf. reparierten) Text zurück. Falls nichts zu retten ist,
 * wird der Original-Text zurückgegeben – Aufrufer sollte danach trotzdem
 * `JSON.parse` versuchen und im Fehlerfall fortfahren.
 */
export function repairTruncatedJson(text: string): string {
  if (!text) return text

  const jsonStart = text.indexOf('{')
  if (jsonStart === -1) return text

  let json = text.slice(jsonStart)

  // Schon gültig?
  try {
    JSON.parse(json)
    return text
  } catch {
    /* weiter */
  }

  // Letztes "vollständiges" Element abschneiden
  const lastComplete = Math.max(
    json.lastIndexOf('},'),
    json.lastIndexOf('}]'),
    json.lastIndexOf('" ,'),
    json.lastIndexOf('",'),
    json.lastIndexOf('],'),
  )
  if (lastComplete > 0) {
    json = json.slice(0, lastComplete + 1)
  }

  // Stack-basiertes Klammer-Counting, String-aware (inkl. Escapes)
  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < json.length; i++) {
    const ch = json[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') openBraces++
    else if (ch === '}') openBraces--
    else if (ch === '[') openBrackets++
    else if (ch === ']') openBrackets--
  }

  // Hängenden Komma-Trailer entfernen (",}", ",]" usw. sind ungültig)
  // Wir entfernen einfach trailing whitespace + ggf. ","
  json = json.replace(/,\s*$/, '')

  for (let i = 0; i < openBrackets; i++) json += ']'
  for (let i = 0; i < openBraces; i++) json += '}'

  try {
    JSON.parse(json)
    return text.slice(0, jsonStart) + json
  } catch {
    return text
  }
}

/**
 * 4-stufige JSON-Extraktion aus einer KI-Antwort.
 *
 * Strategien (in Reihenfolge):
 *   1. Roher Text direkt parsen
 *   2. ```json … ``` Markdown-Block extrahieren
 *   3. Fences entfernen, dann Substring von erstem `{` bis letztem `}`
 *   4. Regex `\{[\s\S]*\}` (erster `{`-bis-`}`-Block)
 *
 * Wirft `ParseJsonError` mit `isParseError = true`, falls alle Strategien fehlschlagen.
 */
export function parseJsonResponse<T = unknown>(rawText: string): T {
  const candidates: string[] = []

  const trimmed = (rawText || '').trim()
  candidates.push(trimmed)

  // Stufe 2: Markdown-Block
  const mdMatch = (rawText || '').match(/```(?:json)?\s*([\s\S]*?)```/)
  if (mdMatch) candidates.push(mdMatch[1].trim())

  // Stufe 3: Fences entfernen + first { … last }
  const stripped = (rawText || '')
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()
  const firstBrace = stripped.indexOf('{')
  const lastBrace = stripped.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(stripped.substring(firstBrace, lastBrace + 1))
  }

  // Stufe 4: Regex
  const jsonMatch = (rawText || '').match(/\{[\s\S]*\}/)
  if (jsonMatch) candidates.push(jsonMatch[0])

  // Zusatz: ggf. abgeschnittenes JSON reparieren (für Stufe 3-Kandidat)
  if (firstBrace !== -1) {
    const repaired = repairTruncatedJson(stripped)
    if (repaired && repaired !== stripped) candidates.push(repaired)
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate) as T
    } catch {
      // weiter zum nächsten Kandidaten
    }
  }

  const err = new Error(
    'Das Angebot konnte nicht erstellt werden. Bitte versuche es erneut.',
  ) as ParseJsonError
  err.isParseError = true
  err.rawText = rawText
  throw err
}
