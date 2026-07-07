// ============================================================
// B4Y SuperAPP – Zentrale Platzhalterwerte für Dokumente
// ------------------------------------------------------------
// EINE Quelle der Wahrheit für die Werte ALLER Dokument-Platzhalter
// ({{kunde.*}}, {{projekt.*}}, {{dokument.*}}, {{firma.*}}, {{kondition.*}},
// {{angebot.*}}, {{bearbeiter.*}}) – verwendet von Angebot, Auftrag, Rechnung,
// Auftrag-SUB, Nachtrag und Textdokument. Verhindert doppelte/abweichende Logik
// je Editor. Die Auflösung selbst läuft über applyPlaceholders()/snapshotText()
// aus text-blocks.ts. Mandantenneutral – Firmenwerte kommen aus company_settings.
//
// WICHTIG: Diese Map muss zu KNOWN_PLACEHOLDERS (text-blocks.ts) passen, damit die
// in der UI angebotenen Platzhalter exakt den hier befüllbaren entsprechen.
// ============================================================
import { Contact } from "./types";
import { CompanySettings } from "./company";
import { PlaceholderValues, applyPlaceholders, plainToHtml, looksLikeHtml, isEmptyHtml, KNOWN_PLACEHOLDERS } from "./text-blocks";
import { salutationLine, formatStreetLine } from "./contact-name";
import { dateAt } from "./format";

// ============================================================
// Zentraler Platzhalter-Katalog (für die einheitliche Einfüge-UI)
// ------------------------------------------------------------
// EINE Quelle für die in der UI angebotenen Dokument-Platzhalter. Die Tokens
// stammen ausschließlich aus KNOWN_PLACEHOLDERS (text-blocks.ts) – damit es keine
// zweite, abweichende Liste gibt. Label + Beispiel sind generische, mandantenneutrale
// Musterwerte (keine BAU4YOU-Hardcodierung). Ein in der Liste neu ergänzter Platzhalter
// erscheint automatisch (unter „Weitere"), bis er hier kategorisiert/beschrieben wird.
// ============================================================
export type PlaceholderItem = { token: string; label: string; example: string };
export type PlaceholderGroup = { category: string; items: PlaceholderItem[] };

/** Metadaten (Label + Beispiel) je bekanntem Token. Reihenfolge der Kategorien = Anzeigereihenfolge. */
const DOC_PLACEHOLDER_META: Record<string, { category: string; label: string; example: string }> = {
  // Kunde
  "kunde.name": { category: "Kunde", label: "Name (Firma oder Person)", example: "Mustermann GmbH" },
  "kunde.anrede": { category: "Kunde", label: "Anrede (Wort)", example: "Herr" },
  "kunde.anrede_zeile": { category: "Kunde", label: "Vollständige Anredezeile", example: "Sehr geehrter Herr Mustermann," },
  "kunde.firma": { category: "Kunde", label: "Firmenname", example: "Mustermann GmbH" },
  "kunde.adresse": { category: "Kunde", label: "Adresse (einzeilig)", example: "Hauptstraße 1, 1010 Wien" },
  "kunde.strasse": { category: "Kunde", label: "Straße", example: "Hauptstraße 1" },
  "kunde.plz": { category: "Kunde", label: "PLZ", example: "1010" },
  "kunde.ort": { category: "Kunde", label: "Ort", example: "Wien" },
  "kunde.uid": { category: "Kunde", label: "UID-Nummer", example: "ATU12345678" },
  // Projekt
  "projekt.name": { category: "Projekt", label: "Projektname", example: "Sanierung Bürogebäude" },
  "projekt.nummer": { category: "Projekt", label: "Projektnummer", example: "P-2026-014" },
  "projekt.adresse": { category: "Projekt", label: "Projektadresse", example: "Baustraße 5, 4020 Linz" },
  // Dokument
  "dokument.nummer": { category: "Dokument", label: "Belegnummer", example: "AN-2026-014" },
  "dokument.datum": { category: "Dokument", label: "Belegdatum", example: "28.06.2026" },
  "dokument.typ": { category: "Dokument", label: "Belegart", example: "Angebot" },
  // Konditionen (inkl. Angebotsgültigkeit)
  "angebot.gueltig_bis": { category: "Konditionen", label: "Angebot gültig bis", example: "31.07.2026" },
  "kondition.zahlungsziel": { category: "Konditionen", label: "Zahlungsziel (Tage)", example: "14" },
  "kondition.skonto_prozent": { category: "Konditionen", label: "Skonto (Prozent)", example: "2" },
  "kondition.skonto_tage": { category: "Konditionen", label: "Skonto-Frist (Tage)", example: "7" },
  "kondition.skonto_text": { category: "Konditionen", label: "Skonto-Satz (leer bei 0 %)", example: "Bei Zahlung innerhalb von 7 Tagen gewähren wir Ihnen 2 % Skonto." },
  "kondition.zahlungsbedingungen_text": { category: "Konditionen", label: "Zahlungsbedingungen-Satz (leer ohne Konditionen)", example: "Zahlbar innerhalb von 14 Tagen netto. Bei Zahlung innerhalb von 7 Tagen gewähren wir Ihnen 2 % Skonto." },
  // Firma (mandantenabhängig aus company_settings)
  "firma.name": { category: "Firma", label: "Firmenname", example: "Beispiel Bau GmbH" },
  "firma.telefon": { category: "Firma", label: "Telefon", example: "+43 1 234 56 78" },
  "firma.email": { category: "Firma", label: "E-Mail", example: "office@beispiel-bau.at" },
  "firma.web": { category: "Firma", label: "Website", example: "www.beispiel-bau.at" },
  "firma.adresse": { category: "Firma", label: "Adresse (einzeilig)", example: "Gewerbeweg 10, 4020 Linz" },
  "firma.strasse": { category: "Firma", label: "Straße", example: "Gewerbeweg 10" },
  "firma.plz": { category: "Firma", label: "PLZ", example: "4020" },
  "firma.ort": { category: "Firma", label: "Ort", example: "Linz" },
  "firma.iban": { category: "Firma", label: "IBAN", example: "AT00 0000 0000 0000 0000" },
  "firma.bic": { category: "Firma", label: "BIC", example: "BKAUATWW" },
  "firma.uid": { category: "Firma", label: "UID-Nummer", example: "ATU87654321" },
  "firma.fn": { category: "Firma", label: "Firmenbuchnummer", example: "FN 123456a LG Linz" },
  "firma.geschaeftsfuehrer": { category: "Firma", label: "Geschäftsführer", example: "Maria Beispiel" },
  "firma.gesellschafter": { category: "Firma", label: "Gesellschafter", example: "Maria Beispiel, Hans Beispiel" },
  // Bearbeiter
  "bearbeiter.name": { category: "Bearbeiter", label: "Name des Bearbeiters", example: "Anna Müller" },
};

// Kategorien in fester Reihenfolge anzeigen (Kunde, Projekt, Dokument, Konditionen, Firma, Bearbeiter).
const DOC_CATEGORY_ORDER = ["Kunde", "Projekt", "Dokument", "Konditionen", "Firma", "Bearbeiter", "Weitere"];

/**
 * Strukturierter Dokument-Platzhalter-Katalog für die Einfüge-UI (PlaceholderMenu).
 * Abgeleitet aus KNOWN_PLACEHOLDERS – jeder real auflösbare Platzhalter erscheint genau einmal.
 * Tokens werden im Editor als `{{token}}` eingefügt (vgl. applyPlaceholders).
 */
export const DOC_PLACEHOLDER_CATALOG: PlaceholderGroup[] = (() => {
  const byCat = new Map<string, PlaceholderItem[]>();
  for (const key of KNOWN_PLACEHOLDERS) {
    const meta = DOC_PLACEHOLDER_META[key];
    const category = meta?.category ?? "Weitere";
    const item: PlaceholderItem = {
      token: `{{${key}}}`,
      label: meta?.label ?? key,
      example: meta?.example ?? "",
    };
    if (!byCat.has(category)) byCat.set(category, []);
    byCat.get(category)!.push(item);
  }
  const cats = Array.from(byCat.keys()).sort(
    (a, b) => DOC_CATEGORY_ORDER.indexOf(a) - DOC_CATEGORY_ORDER.indexOf(b),
  );
  return cats.map((category) => ({ category, items: byCat.get(category)! }));
})();

type AddrParts = {
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  address_extra?: string | null;
} | null | undefined;

const nameOf = (c: Contact | null | undefined): string =>
  !c ? "" : (c.customer_type === "firma" ? (c.company || "") : [c.first_name, c.last_name].filter(Boolean).join(" "));

/** Einzeilige Adresse „Straße / Zusatz, PLZ Ort" (Slash-Zusatz, zentral wie im Empfängerblock). */
const inlineAddr = (s: AddrParts): string => {
  if (!s) return "";
  const street = formatStreetLine(s.street, s.address_extra);
  const city = [s.zip, s.city].filter(Boolean).join(" ");
  return [street, city].filter(Boolean).join(", ");
};

const listJoin = (arr?: string[] | null): string =>
  (arr ?? []).map((x) => (x ?? "").trim()).filter(Boolean).join(", ");

const decimalDe = (n: number | null | undefined): string =>
  n == null ? "" : String(n).replace(".", ",");

/** Zahlungs-/Skonto-Konditionen für {{kondition.*}} (mandanten-/belegabhängig). */
export type DocPlaceholderConditions = {
  paymentTermDays?: number | null;
  skontoPercent?: number | null;
  skontoDays?: number | null;
} | null | undefined;

/**
 * Fertiger Skonto-Satz für {{kondition.skonto_text}}.
 * Erscheint NUR bei Skonto > 0 – bei 0 %, leer oder nicht gesetzt bleibt der
 * Platzhalter leer (kein halber „…0 % Skonto"-Satz im Dokument).
 */
export function skontoSentence(c: DocPlaceholderConditions): string {
  const pct = Number(c?.skontoPercent) || 0;
  if (pct <= 0) return "";
  const frist = c?.skontoDays != null && Number(c.skontoDays) > 0
    ? `innerhalb von ${c.skontoDays} Tagen`
    : "innerhalb der Skontofrist";
  return `Bei Zahlung ${frist} gewähren wir Ihnen ${decimalDe(pct)} % Skonto.`;
}

/**
 * Fertiger Zahlungsbedingungen-Satz für {{kondition.zahlungsbedingungen_text}}:
 * Zahlungsziel-Satz + (nur bei Skonto > 0) Skonto-Satz. Ohne gepflegte
 * Konditionen bleibt der Platzhalter komplett leer.
 */
export function paymentTermsSentence(c: DocPlaceholderConditions): string {
  const parts: string[] = [];
  if (c?.paymentTermDays != null && Number(c.paymentTermDays) > 0) {
    parts.push(`Zahlbar innerhalb von ${c.paymentTermDays} Tagen netto.`);
  }
  const skonto = skontoSentence(c);
  if (skonto) parts.push(skonto);
  return parts.join(" ");
}

/**
 * Baut die flache Platzhalter-Wertemap für ein Dokument. Mandantenneutral – keine festen
 * Firmentexte; Firmenwerte kommen aus den übergebenen company_settings. Fehlende Quellen
 * → leerer String (kein kaputter Platzhalter im PDF).
 */
export function buildDocPlaceholders(opts: {
  customer: Contact | null;
  project: ({ title?: string | null; project_number?: string | null } & AddrParts) | null;
  docNumber?: string | null;
  docDate?: string | null;
  docLabel: string;
  company: CompanySettings | null;
  bearbeiter: string;
  validUntil?: string | null;
  conditions?: DocPlaceholderConditions;
}): PlaceholderValues {
  const { customer, project, docNumber, docDate, docLabel, company: c, bearbeiter, validUntil, conditions } = opts;
  const compCity = c ? [c.zip, c.city].filter(Boolean).join(" ") : "";
  const compAddr = c ? [(c.street ?? "").trim(), compCity].filter(Boolean).join(", ") : "";
  const custUid = (customer as { uid?: string | null; vat_id?: string | null } | null)?.uid
    ?? (customer as { vat_id?: string | null } | null)?.vat_id ?? "";
  return {
    // Kunde
    "kunde.name": nameOf(customer),
    "kunde.anrede": customer?.salutation ?? "",
    "kunde.anrede_zeile": salutationLine(customer),
    "kunde.firma": customer?.company ?? "",
    "kunde.adresse": inlineAddr(customer),
    "kunde.strasse": formatStreetLine(customer?.street, (customer as AddrParts)?.address_extra),
    "kunde.plz": customer?.zip ?? "",
    "kunde.ort": customer?.city ?? "",
    "kunde.uid": custUid,
    // Projekt
    "projekt.name": project?.title ?? "",
    "projekt.nummer": project?.project_number ?? "",
    "projekt.adresse": inlineAddr(project) || inlineAddr(customer),
    // Dokument
    "dokument.nummer": docNumber ?? "",
    "dokument.datum": docDate ? dateAt(docDate) : "",
    "dokument.typ": docLabel,
    // Angebot / Konditionen
    "angebot.gueltig_bis": validUntil ? dateAt(validUntil) : "",
    "kondition.zahlungsziel": conditions?.paymentTermDays != null ? String(conditions.paymentTermDays) : "",
    "kondition.skonto_prozent": decimalDe(conditions?.skontoPercent),
    "kondition.skonto_tage": conditions?.skontoDays != null ? String(conditions.skontoDays) : "",
    "kondition.skonto_text": skontoSentence(conditions),
    "kondition.zahlungsbedingungen_text": paymentTermsSentence(conditions),
    // Firma (mandantenabhängig aus company_settings)
    "firma.name": c?.name ?? "",
    "firma.telefon": c?.phone ?? c?.mobile ?? "",
    "firma.email": c?.email ?? "",
    "firma.web": c?.web ?? "",
    "firma.adresse": compAddr,
    "firma.strasse": c?.street ?? "",
    "firma.plz": c?.zip ?? "",
    "firma.ort": c?.city ?? "",
    "firma.iban": c?.iban ?? "",
    "firma.bic": c?.bic ?? "",
    "firma.uid": c?.uid ?? "",
    "firma.fn": c?.fn ? `FN ${c.fn}${c.fn_court ? " " + c.fn_court : ""}` : "",
    "firma.geschaeftsfuehrer": listJoin(c?.geschaeftsfuehrer),
    "firma.gesellschafter": listJoin(c?.gesellschafter),
    // Bearbeiter
    "bearbeiter.name": bearbeiter,
  };
}

/**
 * Löst die drei Dokument-Textfelder (Einleitung / „vor Positionen" / Schluss) mit der
 * übergebenen Platzhaltermap auf und liefert druckfertiges HTML. EINE zentrale Stelle für
 * Angebot/Auftrag/Rechnung/SUB/Nachtrag – sowohl in der Live-Vorschau als auch beim finalen
 * Snapshot. Idempotent: bereits aufgelöste Texte (ohne {{…}}) bleiben unverändert.
 */
export function resolveDocTexts(
  raw: { intro?: string | null; prePositions?: string | null; closing?: string | null },
  ph: PlaceholderValues,
): { introHtml?: string; prePositionsHtml?: string; closingHtml?: string } {
  const apply = (s: string) => applyPlaceholders(s, ph, { markMissing: false }).html;
  const toHtml = (s: string) => (looksLikeHtml(s) ? s : plainToHtml(s));
  return {
    introHtml: raw.intro ? apply(toHtml(raw.intro)) : undefined,
    prePositionsHtml: !isEmptyHtml(raw.prePositions ?? null) ? apply(toHtml(raw.prePositions as string)) : undefined,
    closingHtml: raw.closing ? apply(toHtml(raw.closing)) : undefined,
  };
}

/**
 * Löst Platzhalter in einem einzelnen Rich-Text/HTML-Feld auf (z. B. Textdokument-Body).
 * Idempotent, markMissing=false (leert unbekannte). Für „freie" Dokumente ohne intro/closing.
 */
export function resolveBodyHtml(raw: string | null | undefined, ph: PlaceholderValues): string {
  if (!raw) return "";
  const html = looksLikeHtml(raw) ? raw : plainToHtml(raw);
  return applyPlaceholders(html, ph, { markMissing: false }).html;
}
