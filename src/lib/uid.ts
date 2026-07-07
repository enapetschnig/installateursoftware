// ============================================================
// B4Y SuperAPP – UID-/USt-IdNr.-Helper (zentral, wiederverwendbar)
// ------------------------------------------------------------
// Führt österreichische UID-Nummern (ATU + 8 Ziffern) sauber, bleibt aber
// tolerant gegenüber ausländischen UID (z. B. DE…, IT…), damit das Produkt
// mandantenfähig/white-label bleibt (keine Hardcodierung auf AT).
//
// Normalisierung (normalizeUid):
//   "ATU12345678"      → "ATU12345678"
//   "atu 12345678"     → "ATU12345678"
//   "12345678"         → "ATU12345678"   (reine Ziffern → AT angenommen)
//   "AT12345678"       → "ATU12345678"   (häufiger Tippfehler: U vergessen)
//   "U12345678"        → "ATU12345678"
//   "DE123456789"      → "DE123456789"   (ausländische UID bleibt erhalten)
//   ""                 → ""
//
// Validierung (isValidUid): leere Eingabe gilt als gültig (UID ist optional).
// AT: exakt ATU + 8 Ziffern. Ausland: Ländercode (2 Buchstaben) + 2–13 Alnum.
// ============================================================

/** Reduziert die Eingabe auf Großbuchstaben+Ziffern (entfernt Leerzeichen, Punkte, Bindestriche, Slash). */
function cleanUid(input?: string | null): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Normalisiert eine UID-Nummer (siehe Datei-Kopf). Tolerant gegenüber ausländischen UID. */
export function normalizeUid(input?: string | null): string {
  const raw = cleanUid(input);
  if (!raw) return "";
  if (raw.startsWith("ATU")) return "ATU" + raw.slice(3);
  if (/^AT\d/.test(raw)) return "ATU" + raw.slice(2); // "AT12345678" → "ATU12345678"
  if (/^U\d/.test(raw)) return "ATU" + raw.slice(1); // "U12345678" → "ATU12345678"
  if (/^\d+$/.test(raw)) return "ATU" + raw; // reine Ziffern → AT angenommen
  return raw; // ausländische UID (Ländercode + Rest) unverändert
}

/** true, wenn die (normalisierte) UID plausibel ist. Leer = gültig (optional). */
export function isValidUid(input?: string | null): boolean {
  const v = normalizeUid(input);
  if (!v) return true;
  if (v.startsWith("ATU")) return /^ATU\d{8}$/.test(v); // Österreich: ATU + genau 8 Ziffern
  return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v); // Ausland: Ländercode + 2–13 Alnum
}

/**
 * Liefert die Ziffern/den Rest hinter dem führenden "ATU" für die Feldanzeige
 * (das Formular zeigt "ATU" als festes Präfix daneben). Ausländische UID werden
 * vollständig zurückgegeben, damit sie sichtbar/bearbeitbar bleiben.
 */
export function uidSuffix(input?: string | null): string {
  const v = (input ?? "").trim();
  if (/^ATU/i.test(v)) return v.replace(/^ATU/i, "");
  return v;
}

/**
 * Wandelt die Roh-Eingabe aus dem Suffix-Feld (neben dem festen "ATU"-Präfix) in den
 * zu speichernden, normalisierten UID-Wert um. `normalizeUid` deckt alle Fälle bereits ab
 * (reine Ziffern → ATU-Suffix; vollständig eingefügte „ATU…"/Auslands-UID bleiben erhalten);
 * diese Funktion existiert nur zur klaren Benennung am Eingabefeld.
 */
export function applyUidInput(typed: string): string {
  return normalizeUid(typed);
}
