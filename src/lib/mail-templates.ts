// ============================================================
// B4Y SuperAPP – Mailvorlagen
// Typen, Kontext- & Variablenkatalog sowie Helfer zum Laden und
// Ersetzen von {{Variablen}}. Basis für die spätere Mail-Automatisierung.
// ============================================================
import { supabase } from "./supabase";

// ---------- Datenmodell ----------
export type MailContext =
  | "kunde" | "projekt" | "angebot" | "auftrag" | "rechnung" | "mahnung"
  | "subunternehmer" | "lieferant" | "allgemein" | "dokument" | "termin";

export type MailTemplate = {
  id: string;
  name: string;
  context: MailContext;            // Legacy-Fallback (bleibt erhalten)
  subject: string;
  body_html: string;
  description: string | null;
  sort_order: number;
  usage_count: number;
  active: boolean;
  updated_at: string | null;
  // Neue, präzise Zuordnung
  category: MailCategory | null;            // Bereich (dokument/projekt/termin/…)
  document_type_slug: string | null;        // Grund-Dokumenttyp (z.B. "angebote")
  document_type_id: string | null;          // optionale FK auf benutzerdef. Dokumentart
  doc_variant: string | null;               // optionale Variante (normal/pauschal/regie)
  trigger_action: string | null;            // Auslöser/Aktion (senden/bestaetigen/…)
  is_default: boolean;                       // Standardvorlage für Dokumentart+Auslöser
};

export const MAIL_COLUMNS =
  "id,name,context,subject,body_html,description,sort_order,usage_count,active,updated_at," +
  "category,document_type_slug,document_type_id,doc_variant,trigger_action,is_default";

// ---------- Bereiche / Kategorien ----------
export type MailCategory = "dokument" | "projekt" | "termin" | "subunternehmer" | "lieferant" | "allgemein";
export const MAIL_CATEGORIES: { key: MailCategory; label: string }[] = [
  { key: "dokument", label: "Dokument" },
  { key: "projekt", label: "Projekt" },
  { key: "termin", label: "Termin" },
  { key: "subunternehmer", label: "Subunternehmer" },
  { key: "lieferant", label: "Lieferant" },
  { key: "allgemein", label: "Allgemein" },
];
export const categoryLabel = (k: string | null | undefined): string =>
  MAIL_CATEGORIES.find((c) => c.key === k)?.label ?? (k || "–");

// ---------- Auslöser / Aktionen ----------
export const MAIL_TRIGGERS: { key: string; label: string }[] = [
  { key: "senden", label: "Senden" },
  { key: "nachtrag_senden", label: "Nachtrag senden" },
  { key: "bestaetigen", label: "Bestätigen" },
  { key: "abschliessen", label: "Abschließen" },
  { key: "freigeben", label: "Freigeben" },
  { key: "zahlungserinnerung", label: "Zahlungserinnerung" },
  { key: "mahnung", label: "Mahnung" },
  { key: "letzte_mahnung", label: "Letzte Mahnung" },
  { key: "termin_bestaetigen", label: "Termin bestätigen" },
  { key: "dokument_hochladen", label: "Dokument hochladen" },
  { key: "dokument_versenden", label: "Dokument versenden" },
  { key: "subunternehmer_anfragen", label: "Subunternehmer anfragen" },
];
export const triggerLabel = (k: string | null | undefined): string =>
  MAIL_TRIGGERS.find((t) => t.key === k)?.label ?? (k || "–");

/** Sinnvolle Auslöser je Grund-Dokumenttyp (Slug). Nicht jede Art braucht jeden Auslöser. */
export function triggersForDocType(slug: string | null | undefined): string[] {
  switch (slug) {
    case "angebote":        return ["senden", "nachtrag_senden", "freigeben"];
    case "angebot_nachtrag":return ["nachtrag_senden", "senden", "freigeben"];
    case "auftraege":       return ["bestaetigen", "senden", "abschliessen", "nachtrag_senden"];
    case "auftrag_sub":     return ["senden", "bestaetigen", "abschliessen", "subunternehmer_anfragen"];
    case "rechnungen":      return ["senden", "zahlungserinnerung", "mahnung", "letzte_mahnung"];
    case "mahnungen":       return ["zahlungserinnerung", "mahnung", "letzte_mahnung", "senden"];
    case "gutschriften":    return ["senden"];
    default:                return ["senden", "dokument_versenden", "dokument_hochladen"]; // eigene Dokumentarten
  }
}

export const DOC_VARIANTS: { key: string; label: string }[] = [
  { key: "", label: "Alle Varianten" },
  { key: "normal", label: "Normal" },
  { key: "pauschal", label: "Pauschal" },
  { key: "regie", label: "Regie" },
];

// ---------- Kontext-Katalog ----------
export const MAIL_CONTEXTS: { key: MailContext; label: string }[] = [
  { key: "kunde", label: "Kunde" },
  { key: "projekt", label: "Projekt" },
  { key: "angebot", label: "Angebot" },
  { key: "auftrag", label: "Auftrag" },
  { key: "rechnung", label: "Rechnung" },
  { key: "mahnung", label: "Mahnung / Zahlungserinnerung" },
  { key: "subunternehmer", label: "Subunternehmer" },
  { key: "lieferant", label: "Lieferant" },
  { key: "allgemein", label: "Allgemein" },
  { key: "dokument", label: "Dokument senden" },
  { key: "termin", label: "Termin / Besichtigung" },
];

export const contextLabel = (k: string): string =>
  MAIL_CONTEXTS.find((c) => c.key === k)?.label ?? k;

// ---------- Variablen-/Platzhalter-Katalog ----------
export type MailVariable = { token: string; label: string };
export type MailVariableGroup = { group: string; vars: MailVariable[] };

export const MAIL_VARIABLES: MailVariableGroup[] = [
  {
    group: "Kunde",
    vars: [
      { token: "{{Customer.salutation}}", label: "Anrede (z.B. Sehr geehrte Frau)" },
      { token: "{{Customer.name}}", label: "Name" },
      { token: "{{Customer.email}}", label: "E-Mail" },
    ],
  },
  {
    group: "Projekt",
    vars: [
      { token: "{{Project.name}}", label: "Projektname" },
      { token: "{{Project.address}}", label: "Projektadresse" },
      { token: "{{Project.display_id}}", label: "Projektnummer" },
    ],
  },
  {
    group: "Dokumente",
    vars: [
      { token: "{{Offer.number}}", label: "Angebotsnummer" },
      { token: "{{Order.number}}", label: "Auftragsnummer" },
      { token: "{{Invoice.number}}", label: "Rechnungsnummer" },
      { token: "{{Invoice.amount}}", label: "Rechnungsbetrag" },
      { token: "{{Invoice.due_date}}", label: "Fälligkeitsdatum" },
    ],
  },
  {
    group: "Firma & Benutzer",
    vars: [
      { token: "{{Company.name}}", label: "Firmenname" },
      { token: "{{Company.phone}}", label: "Firmen-Telefon" },
      { token: "{{Company.email}}", label: "Firmen-E-Mail" },
      { token: "{{User.name}}", label: "Angemeldeter Benutzer" },
    ],
  },
];

/** Flache Liste aller bekannten Tokens (z.B. zum Validieren/Hervorheben). */
export const ALL_MAIL_TOKENS: string[] = MAIL_VARIABLES.flatMap((g) =>
  g.vars.map((v) => v.token),
);

// ---------- Katalog für die einheitliche Einfüge-UI (PlaceholderMenu) ----------
// Mail nutzt EIGENE Tokens ({{Customer.name}}, {{Project.…}}, {{Offer.number}} …) –
// NICHT mit dem Dokument-Katalog vermischen. Abgeleitet aus MAIL_VARIABLES (eine Quelle),
// ergänzt um generische, mandantenneutrale Beispielwerte. Form passend zu
// PlaceholderGroup/PlaceholderItem aus document-placeholders.ts (gleiche Struktur,
// hier dupliziert, um eine Lib-Abhängigkeit mail-templates → document-placeholders zu vermeiden).
export type MailPlaceholderItem = { token: string; label: string; example: string };
export type MailPlaceholderGroup = { category: string; items: MailPlaceholderItem[] };

/** Generische Beispielwerte je Mail-Token (mandantenneutral). */
const MAIL_TOKEN_EXAMPLES: Record<string, string> = {
  "{{Customer.salutation}}": "Sehr geehrte Frau Beispiel,",
  "{{Customer.name}}": "Mustermann GmbH",
  "{{Customer.email}}": "kontakt@mustermann.at",
  "{{Project.name}}": "Sanierung Bürogebäude",
  "{{Project.address}}": "Baustraße 5, 4020 Linz",
  "{{Project.display_id}}": "P-2026-014",
  "{{Offer.number}}": "AN-2026-014",
  "{{Order.number}}": "AU-2026-031",
  "{{Invoice.number}}": "RE-2026-058",
  "{{Invoice.amount}}": "1.250,00 €",
  "{{Invoice.due_date}}": "12.07.2026",
  "{{Company.name}}": "Beispiel Bau GmbH",
  "{{Company.phone}}": "+43 1 234 56 78",
  "{{Company.email}}": "office@beispiel-bau.at",
  "{{User.name}}": "Anna Müller",
};

/**
 * Strukturierter Mail-Platzhalter-Katalog für die einheitliche Einfüge-UI.
 * Abgeleitet aus MAIL_VARIABLES – Gruppen/Tokens bleiben die EINE Quelle.
 */
export const MAIL_PLACEHOLDER_CATALOG: MailPlaceholderGroup[] = MAIL_VARIABLES.map((g) => ({
  category: g.group,
  items: g.vars.map((v) => ({
    token: v.token,
    label: v.label,
    example: MAIL_TOKEN_EXAMPLES[v.token] ?? "",
  })),
}));

// ---------- Variablen ersetzen ----------
// ctx ist eine flache Map mit gepunkteten Schlüsseln ohne Klammern,
// z.B. { "Customer.name": "Max Mustermann", "Invoice.number": "2026-014" }.
export type MailContextData = Record<string, string | number | null | undefined>;

/**
 * Ersetzt alle {{Key.sub}}-Platzhalter im Text durch Werte aus ctx.
 * Unbekannte oder leere Werte werden zu "" ersetzt, der Token verschwindet.
 * Lässt den Text ansonsten (inkl. HTML) unverändert.
 */
export function applyTemplate(text: string, ctx: MailContextData = {}): string {
  if (!text) return "";
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = ctx[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

// ---------- Laden für die Verwendung beim Mailschreiben ----------
/**
 * Liefert aktive Vorlagen, die zum Kontext passen. "allgemein"-Vorlagen
 * werden zusätzlich immer mit angeboten (außer der Kontext ist selbst
 * "allgemein"). Gelöschte/inaktive Vorlagen erscheinen nie.
 */
export async function loadTemplatesByContext(
  context: MailContext,
): Promise<MailTemplate[]> {
  const contexts = context === "allgemein" ? [context] : [context, "allgemein"];
  const { data, error } = await supabase
    .from("mail_templates")
    .select(MAIL_COLUMNS)
    .eq("active", true)
    .in("context", contexts)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data as unknown as MailTemplate[]) ?? [];
}

/**
 * Wendet eine Vorlage auf Kontextdaten an und liefert fertigen
 * Betreff + Body. Mail bleibt danach beim Versand frei editierbar.
 */
export function renderTemplate(t: MailTemplate, ctx: MailContextData = {}) {
  return {
    subject: applyTemplate(t.subject, ctx),
    body_html: applyTemplate(t.body_html, ctx),
  };
}

// ---------- Automatische Vorlagenwahl (für späteren Versand) ----------
/** Alle aktiven Vorlagen (mandantengefiltert via RLS). */
export async function loadActiveTemplates(): Promise<MailTemplate[]> {
  const { data, error } = await supabase
    .from("mail_templates").select(MAIL_COLUMNS)
    .eq("active", true).order("sort_order").order("name");
  if (error) throw error;
  return (data as unknown as MailTemplate[]) ?? [];
}

/**
 * Wählt die passende Mailvorlage für eine Dokumentart + Auslöser (+ optional Variante).
 * Liefert die beste Übereinstimmung (Standardvorlage zuerst) sowie alle Kandidaten,
 * sodass der Benutzer beim Versand eine andere passende Vorlage wählen kann.
 * Bereit für die spätere Versand-Integration (Angebot/Auftrag/Rechnung senden …).
 */
export function pickTemplate(
  templates: MailTemplate[],
  sel: { docTypeSlug?: string | null; trigger?: string | null; variant?: string | null },
): { best: MailTemplate | null; candidates: MailTemplate[] } {
  const slug = sel.docTypeSlug ?? null;
  const trigger = sel.trigger ?? null;
  const variant = sel.variant ?? null;
  const candidates = templates.filter((t) =>
    t.active &&
    (slug == null || t.document_type_slug === slug) &&
    (trigger == null || t.trigger_action === trigger || t.trigger_action == null) &&
    (t.doc_variant == null || variant == null || t.doc_variant === variant),
  );
  const score = (t: MailTemplate) => {
    let s = 0;
    if (slug && t.document_type_slug === slug) s += 8;
    if (trigger && t.trigger_action === trigger) s += 4;
    if (variant && t.doc_variant === variant) s += 2;
    if (t.is_default) s += 1;
    return s;
  };
  const sorted = [...candidates].sort(
    (a, b) => score(b) - score(a) || a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  return { best: sorted[0] ?? null, candidates: sorted };
}
