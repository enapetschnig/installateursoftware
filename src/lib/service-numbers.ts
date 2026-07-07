// ============================================================
// B4Y SuperAPP – Reservierte Spezial-Leistungsnummern
// ------------------------------------------------------------
// Variable Position, Regiestunde und Regie-Material werden seit Migration 0060
// NICHT mehr als Stammleistungen geführt, sondern direkt im Dokumenteditor
// eingefügt (eigene Buttons / dokumentlokale Positionen, service_id = null).
//
// Die Nummernbereiche XX-980 bis XX-999 sind für genau diese Spezialpositionen
// reserviert. Importierte Katalog-Leistungen mit solchen Nummern (z. B. aus dem
// Hero-Import) dürfen NICHT in der normalen Leistungsauswahl auftauchen, weil sie
// die saubere dokumentlokale Regie-/Variable-Logik doppeln und umgehen würden.
//
// Wichtig: Es wird ausschließlich über das Nummernschema gefiltert, NICHT über
// is_variable_template o. ä. – diese Flags waren im Hero-Import inkonsistent
// gesetzt (z. B. fälschlich auch auf echten Leistungen wie „Mulde"). Echte
// Leistungen außerhalb 980–999 (z. B. XX-910 Mulde) bleiben dadurch sichtbar.
// ============================================================

/** Regex: zweistelliger Gewerk-Prefix + "-" + 98x oder 99x (980–999). */
export const RESERVED_SPECIAL_SERVICE_NUMBER_RE = /^\d{2}-9[89]\d$/;

/**
 * true, wenn die Leistungsnummer im reservierten Spezialbereich 980–999 liegt
 * (Variable Position / Regiestunde / Regie-Material). Solche Katalog-Leistungen
 * werden aus der normalen Leistungsauswahl (Sidebar, Voice-Katalog) ausgeblendet.
 */
export function isReservedSpecialServiceNumber(serviceNumber: string | null | undefined): boolean {
  if (!serviceNumber) return false;
  return RESERVED_SPECIAL_SERVICE_NUMBER_RE.test(serviceNumber.trim());
}
