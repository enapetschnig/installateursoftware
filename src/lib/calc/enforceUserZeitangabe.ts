// ────────────────────────────────────────────────────────────────────────────
//  enforceUserZeitangabe – User-Zeitangabe überschreibt KI-Zeitangabe.
//  Portiert 1:1 aus bau4you/claude.js Z. 1666-1726.
//
//  Wenn der User-Text eine konkrete Stundenanzahl nennt (z. B. "ca. 3 Stunden",
//  "dauert 2.5h", "Arbeitszeit ungefähr 4 std"), wird die KI-Schätzung verworfen
//  und der Lohnanteil neu berechnet. Material wird beibehalten, aber auf
//  maximal 30 % vom VK gecappt (material_capped-Flag fürs Audit).
//
//  Verhalten ist bewusst zeichengetreu zur bau4you-Quelle – inklusive der
//  Tatsache dass `lohnkosten_minuten` als Gesamt-Minuten der Position
//  gespeichert wird (nicht pro Einheit). Cent-Identität gegen bau4you-Output
//  ist Test-Kriterium.
// ────────────────────────────────────────────────────────────────────────────

import type { Position, StundensaetzeMap } from './types'

/** Regex-Muster zur Stunden-Extraktion (Reihenfolge wie in bau4you). */
const ZEIT_PATTERNS: readonly RegExp[] = [
  /(?:^|\s)(\d+[.,]?\d*)\s*(?:stunden?|std\.?|hours?|h)\b/i,
  /ca\.?\s*(\d+[.,]?\d*)\s*(?:stunden?|std\.?|hours?|h)\b/i,
  /ungef(?:ä|ae)hr\s*(\d+[.,]?\d*)\s*(?:stunden?|std\.?|hours?|h)\b/i,
  /dauert\s*(?:ca\.?\s*)?(\d+[.,]?\d*)\s*(?:stunden?|std\.?|hours?|h)\b/i,
  /arbeitszeit\s*(?:ca\.?\s*)?(\d+[.,]?\d*)\s*(?:stunden?|std\.?|hours?|h)\b/i,
]

const DEFAULT_STUNDENSATZ = 70
const MATERIAL_MAX_RATIO = 0.30

/** round2 = auf 2 Nachkommastellen runden (Cent-genau). */
const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Überschreibt die KI-Zeitangabe wenn der User im Text eine konkrete
 * Stundenanzahl nennt. Pure Function – mutiert `pos` nicht.
 *
 * @param pos          Aktuelle Position (nach fixPositionKosten).
 * @param userText     Original-User-Text aus dem Voice-/Chat-Input.
 * @param stundensaetze Map Gewerk → Stundensatz €/h (Stammdaten).
 * @returns Position mit korrigiertem Lohn/VK oder Original wenn kein Match.
 */
export function enforceUserZeitangabe(
  pos: Position,
  userText: string,
  stundensaetze: StundensaetzeMap = {},
): Position {
  if (!pos || typeof pos !== 'object' || pos.deleted) return pos

  // 1. Erste-Match-wins durch alle Patterns.
  let userStunden: number | null = null
  for (const re of ZEIT_PATTERNS) {
    const m = String(userText || '').match(re)
    if (m) {
      userStunden = parseFloat(String(m[1]).replace(',', '.'))
      break
    }
  }
  if (!userStunden || userStunden <= 0) return pos

  // 2. User-Minuten (Gesamt für die Position).
  const userMinuten = Math.round(userStunden * 60)

  // 3. Stundensatz: pos.stundensatz → stundensaetze[gewerk] → Default 70.
  const gewerk = String(pos.gewerk || '')
  const stundensatz =
    Number(pos.stundensatz) ||
    Number(stundensaetze?.[gewerk]) ||
    DEFAULT_STUNDENSATZ

  // 4. Neuer Lohn aus User-Zeit × Stundensatz.
  const lohn = round2((userMinuten / 60) * stundensatz)

  // 5. Material beibehalten – aber Cap-Prüfung gegen 30 %-Regel.
  const originalMat = Math.max(0, round2(Number(pos.materialkosten_einheit) || 0))
  let mat = originalMat
  let vk = round2(lohn + mat)
  let materialCapped = false

  if (vk > 0 && mat / vk > MATERIAL_MAX_RATIO) {
    // Lohn hält 70 % → VK = lohn / 0.70, Material = vk * 0.30.
    vk = round2(lohn / (1 - MATERIAL_MAX_RATIO))
    mat = round2(vk * MATERIAL_MAX_RATIO)
    materialCapped = true
  }

  // 6. Gesamtpreis & Prozent-Anteile.
  const menge = Number(pos.menge) || 1
  const gesamtpreis = round2(menge * vk)
  const matPct = vk > 0 ? Math.round((mat / vk) * 1000) / 10 : 0
  const lohnPct = Math.round((100 - matPct) * 10) / 10

  return {
    ...pos,
    lohnkosten_minuten: userMinuten,
    stundensatz,
    lohnkosten_einheit: round2(vk - mat),
    materialkosten_einheit: mat,
    vk_netto_einheit: vk,
    gesamtpreis,
    materialanteil_prozent: matPct,
    lohnanteil_prozent: lohnPct,
    material_capped: materialCapped || undefined,
    material_capped_original: materialCapped ? originalMat : undefined,
  }
}
