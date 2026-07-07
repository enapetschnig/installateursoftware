// ============================================================
// B4Y SuperAPP – Zentrale Kontakt-Namenslogik
// ------------------------------------------------------------
// EINE Quelle der Wahrheit für den Anzeigenamen eines Kontakts und den
// Empfänger-Adressblock in PDFs. Ersetzt die zuvor app-weit duplizierten und
// teils widersprüchlichen lokalen Namensfunktionen (mal Firma zuerst, mal
// Person zuerst).
//
// Einheitliche Regel:
//  • Kontaktform „Unternehmen" (customer_type === "firma")
//      → Firmenname (Fallback: Personenname)
//  • Kontaktform „Einzelperson" (privat / sonstige)
//      → Personenname (Fallback: Firmenname)
//
// Bewusst entkoppelt von der Kontaktart (kunde/lieferant/subunternehmer/…):
// auch ein Lieferant oder Subunternehmer darf eine Einzelperson sein.
//
// Die Funktionen akzeptieren bewusst nur die für den Namen nötigen Felder
// (Teil-Selects/loose Typen erlaubt), damit sie überall einsetzbar sind.
// ============================================================

/** Minimale Felder für die Namensbildung – erlaubt auch Teil-Selects. */
export type ContactNameParts = {
  customer_type?: string | null;
  company?: string | null;
  salutation?: string | null;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

/** Zusätzliche Adressfelder für den Empfängerblock. */
export type ContactAddressParts = ContactNameParts & {
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  address_extra?: string | null; // Adresszusatz zur Straße (Stiege/Top)
  recipient_extra_line1?: string | null; // Empfänger-Zusatzzeile 1 (z. B. „z. Hd. …")
  recipient_extra_line2?: string | null; // Empfänger-Zusatzzeile 2 (Hausverwaltung/Abteilung)
};

const join = (parts: (string | null | undefined)[]): string =>
  parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");

/**
 * Zerlegt einen Adresszusatz (Stiege/Top/Eingang/Keller …) in seine Einzelteile.
 * Akzeptiert gespeicherte Werte mit Komma ODER Slash als Trenner (NICHT destruktiv:
 * der DB-Wert bleibt unverändert, nur die Anzeige wird normalisiert). Trimmt alle
 * Teile, entfernt leere. Beispiel: „Stiege 2, Top 4" → ["Stiege 2", "Top 4"].
 */
export function addressExtraParts(raw?: string | null): string[] {
  return String(raw ?? "")
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Zentrale Slash-Darstellung des Adresszusatzes als Suffix für die Straßenzeile:
 * „ / Stiege 2 / Top 4". Leerer Zusatz → leerer String. Wird in Anzeige/PDF
 * verwendet, damit der Zusatz nicht mit Komma erscheint. Zentral – EINE Quelle.
 */
export function formatAddressExtraSuffix(raw?: string | null): string {
  const parts = addressExtraParts(raw);
  return parts.length ? " / " + parts.join(" / ") : "";
}

/**
 * Kombiniert Straße + Adresszusatz zu EINER Zeile im Slash-Format.
 * „Schrottgasse 7 / Stiege 2 / Top 4". Ohne Straße: nur der Zusatz (ohne führenden
 * Slash). Ohne Zusatz: nur die Straße. Beides leer → leerer String.
 */
export function formatStreetLine(street?: string | null, addressExtra?: string | null): string {
  const s = (street ?? "").trim();
  const parts = addressExtraParts(addressExtra);
  if (!s) return parts.join(" / ");
  return parts.length ? `${s} / ${parts.join(" / ")}` : s;
}

/**
 * Dokumentbezogene Empfängeranschrift (Override) – überschreibt den Kundenstamm NUR
 * für ein einzelnes Dokument (gespeichert als JSONB am Beleg, Migration 0102). Alle
 * Felder optional. `enabled=false` → Override ignorieren (Kundenstamm gilt).
 */
export type RecipientOverride = {
  enabled?: boolean | null;
  name?: string | null; // Empfänger / Firma
  line1?: string | null; // Zusatzzeile 1 (z. B. „z. Hd. …")
  line2?: string | null; // Zusatzzeile 2 (Abteilung/Hausverwaltung/c/o)
  street?: string | null; // Straße / Hausnummer
  address_extra?: string | null; // Adresszusatz (Stiege/Top) – Slash-Format in der Anzeige
  zip?: string | null;
  city?: string | null;
  country?: string | null;
};

/** True, wenn ein Override aktiv ist (nicht deaktiviert UND mindestens ein Feld befüllt). */
export function hasRecipientOverride(o: RecipientOverride | null | undefined): boolean {
  if (!o || o.enabled === false) return false;
  return !!(o.name || o.line1 || o.line2 || o.street || o.address_extra || o.zip || o.city || o.country);
}

/**
 * Empfänger-Adressblock aus einem dokumentbezogenen Override – gleiche Reihenfolge/
 * Slash-Logik wie contactRecipientLines, aber aus den Override-Feldern (kein Kundenstamm).
 * Leere Zeilen entfallen. „Land" wird – falls befüllt – als letzte Zeile angezeigt.
 */
export function recipientLinesFromOverride(o: RecipientOverride | null | undefined): string[] {
  if (!o) return [];
  const cityLine = join([o.zip, o.city]);
  return [
    (o.name ?? "").trim(),
    (o.line1 ?? "").trim(),
    (o.line2 ?? "").trim(),
    formatStreetLine(o.street, o.address_extra),
    cityLine,
    (o.country ?? "").trim(),
  ].filter(Boolean);
}

/**
 * Zentrale Auswahl der Empfängerzeilen: aktiver Override > Kundenstamm.
 * EINE Stelle für alle Dokumenttypen (Angebot/Auftrag/Rechnung/SUB).
 */
export function resolveRecipientLines(
  override: RecipientOverride | null | undefined,
  contact: ContactAddressParts | null | undefined
): string[] {
  return hasRecipientOverride(override)
    ? recipientLinesFromOverride(override)
    : contactRecipientLines(contact);
}

/**
 * Personenname: [Anrede] [Titel] Vorname Nachname.
 * @param withSalutation Anrede (Herr/Frau) voranstellen (Default: nein).
 * @param withTitle akademischen Titel voranstellen (Default: ja).
 */
export function personName(
  c: ContactNameParts,
  opts: { withSalutation?: boolean; withTitle?: boolean } = {}
): string {
  const { withSalutation = false, withTitle = true } = opts;
  return join([withSalutation ? c.salutation : null, withTitle ? c.title : null, c.first_name, c.last_name]);
}

/**
 * Vollständige, grammatikalisch korrekte Anredezeile für Dokumente/Briefe/Mails.
 * „Sehr geehrter Herr Ing. Pittner," / „Sehr geehrte Frau Dr. Mittermayer,".
 * Fallback (keine/unklare Anrede oder kein Nachname): „Sehr geehrte Damen und Herren,".
 * Verhindert kaputte Anreden wie „Sehr geehrte/r Ing.,". Zentral – überall wiederverwenden.
 */
export function salutationLine(c: ContactNameParts | null | undefined): string {
  const sal = (c?.salutation ?? "").trim();
  const last = (c?.last_name ?? "").trim();
  const titleLast = join([c?.title, last]); // z. B. „Ing. Pittner" oder „Pittner"
  if (last && sal === "Herr") return `Sehr geehrter Herr ${titleLast},`;
  if (last && sal === "Frau") return `Sehr geehrte Frau ${titleLast},`;
  return "Sehr geehrte Damen und Herren,";
}

/**
 * Einheitlicher Anzeigename eines Kontakts.
 * Unternehmen → Firmenname (Fallback Person); Einzelperson → Person (Fallback Firma).
 */
export function contactDisplayName(
  c: ContactNameParts | null | undefined,
  opts: { withSalutation?: boolean; withTitle?: boolean; fallback?: string } = {}
): string {
  const { withSalutation = false, withTitle = true, fallback = "Ohne Namen" } = opts;
  if (!c) return fallback;
  const company = (c.company ?? "").trim();
  const person = personName(c, { withSalutation, withTitle });
  if (c.customer_type === "firma") return company || person || fallback;
  return person || company || fallback;
}

/**
 * Empfänger-Adressblock für PDFs (zentral – EINE Quelle, keine Editor-Duplikate).
 * Jede befüllte Komponente steht auf einer EIGENEN Zeile (zeilenweise, kein
 * Komma-Zusammenkleben von Name/Firma und Adresse):
 *   1. Name/Firma (ohne Titel/Anrede)
 *   2. Zusatzzeile 1 (z. B. „z. Hd. …"), falls befüllt
 *   3. Zusatzzeile 2 (Hausverwaltung/Abteilung/c/o), falls befüllt
 *   4. Straße/Hausnr. + Adresszusatz (Stiege/Top/Eingang) im Slash-Format
 *      auf EINER Zeile: „Schrottgasse 7 / Stiege 2 / Top 4"
 *   5. PLZ Ort
 * Alle Werte werden getrimmt; leere Zeilen erzeugen KEINE Leerzeile (werden entfernt).
 */
export function contactRecipientLines(c: ContactAddressParts | null | undefined): string[] {
  if (!c) return [];
  const name = contactDisplayName(c, { withTitle: false, fallback: "" });
  const cityLine = join([c.zip, c.city]);
  return [
    name,
    (c.recipient_extra_line1 ?? "").trim(),
    (c.recipient_extra_line2 ?? "").trim(),
    formatStreetLine(c.street, c.address_extra),
    cityLine,
  ].filter(Boolean);
}

/**
 * Einzeilige Adresse für die Betreff-/„Betrifft"-Zeile (Projekt- oder Kundenadresse).
 * Zentral – ersetzt lokale, ungetrimmte fmtAddr-Duplikate in den Editoren.
 * Trimmt alle Teile → kein Leerzeichen vor dem Komma (z. B. „Heygasse 3, 1030 Wien").
 */
export function formatAddressInline(
  s:
    | { street?: string | null; address_extra?: string | null; zip?: string | null; city?: string | null }
    | null
    | undefined
): string {
  if (!s) return "";
  const cityLine = join([s.zip, s.city]);
  const streetLine = formatStreetLine(s.street, s.address_extra);
  return [streetLine, cityLine].filter(Boolean).join(", ");
}

export function getSalutationOptions(current?: string | null): string[] {
  const currentTrim = (current ?? "").trim();
  const values = ["Herr", "Frau"] as const;
  if (!currentTrim || values.includes(currentTrim as (typeof values)[number])) return [...values];
  return [currentTrim, ...values];
}
