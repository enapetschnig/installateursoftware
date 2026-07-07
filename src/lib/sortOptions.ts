// ============================================================
// B4Y SuperAPP – Alphabetische Sortierung für Auswahllisten
// ------------------------------------------------------------
// Zentrale Helfer, um Dropdown-/Select-/Combobox-Einträge
// alphabetisch nach österreichischem Deutsch (de-AT) zu sortieren.
//
// Bewusst NICHT sortieren (gehört NICHT hierher):
//   • Sidebar-Navigation (feste, fachlich gewollte Reihenfolge)
//   • Status-/Workflow-Abläufe (z. B. Entwurf → Angebot → Auftrag → Rechnung)
//   • Zahlen-/Datums-Folgen mit natürlicher Ordnung
//
// `sensitivity: "base"` ⇒ Groß-/Kleinschreibung und Akzente werden
// für die Reihenfolge ignoriert (ä = a, Ö = o), wie es Anwender erwarten.
// `numeric: true` ⇒ "Artikel 2" vor "Artikel 10".
// ============================================================

const collator = new Intl.Collator("de-AT", { sensitivity: "base", numeric: true });

/** Vergleichsfunktion für Strings (de-AT). Direkt in `[...].sort(...)` verwendbar. */
export const compareAlpha = (a: string, b: string): number => collator.compare(a, b);

/**
 * Sortiert ein Array von Objekten alphabetisch (de-AT) anhand eines String-Feldes.
 * Gibt eine NEUE Liste zurück; das Original bleibt unverändert.
 */
export function sortAlpha<T>(arr: readonly T[], labelKey: keyof T): T[] {
  return [...arr].sort((a, b) =>
    collator.compare(String(a[labelKey] ?? ""), String(b[labelKey] ?? "")),
  );
}

/**
 * Sortiert ein Array von Objekten alphabetisch (de-AT) anhand einer
 * abgeleiteten Beschriftung (z. B. zusammengesetzter Anzeigename).
 * Gibt eine NEUE Liste zurück; das Original bleibt unverändert.
 */
export function sortAlphaBy<T>(arr: readonly T[], label: (item: T) => string): T[] {
  return [...arr].sort((a, b) => collator.compare(label(a) ?? "", label(b) ?? ""));
}

/**
 * Sortiert ein String-Array alphabetisch (de-AT).
 * Gibt eine NEUE Liste zurück; das Original bleibt unverändert.
 */
export function sortAlphaStrings(arr: readonly string[]): string[] {
  return [...arr].sort(collator.compare);
}

/**
 * Natürlicher Vergleich zweier (optionaler) Nummern-Strings (de-AT, numeric):
 *   "09-010" < "09-100", "2" < "10".
 * Einträge MIT Nummer kommen vor Einträgen OHNE Nummer (leer/null ans Ende).
 */
export function compareNumberStr(a?: string | null, b?: string | null): number {
  const an = (a ?? "").trim();
  const bn = (b ?? "").trim();
  if (an && !bn) return -1;
  if (!an && bn) return 1;
  if (!an && !bn) return 0;
  return collator.compare(an, bn);
}

/**
 * Sortiert Objekte natürlich nach einer Nummer (nummerierte zuerst); bei gleicher
 * (oder fehlender) Nummer alphabetisch nach einem Namensfeld (de-AT).
 * Zentral für Auswahllisten mit Nummernschema (z. B. Leistungs-/Artikelnummern
 * „09-010 vor 09-100"). Gibt eine NEUE Liste zurück; das Original bleibt unverändert.
 */
export function sortByNumberThenName<T>(arr: readonly T[], numberKey: keyof T, nameKey: keyof T): T[] {
  return [...arr].sort((a, b) => {
    const c = compareNumberStr(a[numberKey] as unknown as string | null, b[numberKey] as unknown as string | null);
    if (c !== 0) return c;
    return collator.compare(String(a[nameKey] ?? ""), String(b[nameKey] ?? ""));
  });
}
