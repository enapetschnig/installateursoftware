// B4Y SuperAPP – Textbaustein-System (v1)
// ============================================================
// B4Y SuperAPP – Zentrales Textbaustein-System
// Dynamisch für ALLE (auch künftigen) Dokumententypen.
//  • Texttypen (Vortext, Nachtext, Leistungstext, Rechtstext, …)
//  • Prioritäts-Matching (spezifischster aktiver Standardtext)
//  • Platzhalter-Ersetzung ({{kunde.name}} …)
//  • Snapshot-Helfer (Kopie ins Dokument, Vorlage bleibt unberührt)
// Bewusst ohne fixe Dokumentart-Liste – alles über IDs.
// ============================================================
import { supabase } from "./supabase";

// ---- Texttypen -------------------------------------------------
export type TextType =
  | "dokument_vortext"
  | "einleitung_vor_positionen"
  | "dokument_nachtext"
  | "leistungstext"
  | "rechtstext"
  | "zahlungsbedingung"
  | "hinweis"
  | "intern";

export const TEXT_TYPES: { key: TextType; label: string; help: string; inPdf: boolean }[] = [
  { key: "dokument_vortext", label: "Dokument-Vortext", help: "Anrede / Einleitung ganz oben", inPdf: true },
  { key: "einleitung_vor_positionen", label: "Einleitung vor Positionen", help: "Direkt vor der Positionstabelle", inPdf: true },
  { key: "dokument_nachtext", label: "Dokument-Nachtext", help: "Nach den Positionen / Leistungen", inPdf: true },
  { key: "leistungstext", label: "Leistungstext", help: "Für Leistungen, Artikel, Kalkulationen, LV", inPdf: true },
  { key: "rechtstext", label: "Rechtstext", help: "Optionaler rechtlicher Text", inPdf: true },
  { key: "zahlungsbedingung", label: "Zahlungsbedingung", help: "Text für Zahlungsbedingungen", inPdf: true },
  { key: "hinweis", label: "Hinweistext", help: "Allgemeiner Hinweistext", inPdf: true },
  { key: "intern", label: "Interner Text", help: "Nur intern sichtbar, nicht automatisch im PDF", inPdf: false },
];

export const textTypeLabel = (t: string | null | undefined): string =>
  TEXT_TYPES.find((x) => x.key === t)?.label ?? "Hinweistext";

// Kundentyp (entspricht contacts.customer_type)
export type CustomerType = "firma" | "privat" | string;

// ---- Datenmodell ----------------------------------------------
export type TextBlock = {
  id: string;
  type: "text";
  title: string;
  content: string;             // Plaintext-Fallback
  content_html: string | null; // Rich-Text (bevorzugt)
  text_type: TextType;
  category: string | null;
  doc_type: string | null;     // Alt-Feld (Legacy, nur informativ)
  document_type_id: string | null;
  document_subtype_id: string | null;
  project_type_id: string | null;
  customer_type: string | null;
  trade_id: string | null;
  language: string;
  is_default: boolean;
  applies_to_all_doctypes: boolean;
  active: boolean;
  sort_order: number;
  updated_at: string | null;
};

export const TEXT_BLOCK_COLUMNS =
  "id,type,title,content,content_html,text_type,category,doc_type,document_type_id," +
  "document_subtype_id,project_type_id,customer_type,trade_id,language,is_default," +
  "applies_to_all_doctypes,active,sort_order,updated_at";

/** Lädt alle Textbausteine (type='text'). */
export async function loadTextBlocks(): Promise<TextBlock[]> {
  const { data, error } = await supabase
    .from("text_blocks")
    .select(TEXT_BLOCK_COLUMNS)
    .eq("type", "text")
    .order("sort_order")
    .order("title");
  if (error) throw error;
  return (data as unknown as TextBlock[]) ?? [];
}

// ---- Matching-Kontext -----------------------------------------
export type MatchContext = {
  documentTypeId: string | null;
  documentSubtypeId?: string | null;
  projectTypeId?: string | null;
  customerType?: string | null;
  language?: string; // default "de"
};

// Gewichte bilden exakt die geforderte Prioritätsreihenfolge ab
const W_DOCTYPE = 1000; // konkreter Dokumententyp schlägt "alle"
const W_SUBTYPE = 400;
const W_PROJECT = 100;
const W_CUSTOMER = 40;

/**
 * Ist der Baustein für den Kontext zulässig (keine widersprüchliche Einschränkung)?
 * Ein gesetztes Feld muss passen; null = Platzhalter (gilt für alles).
 */
function isCandidate(b: TextBlock, ctx: MatchContext): boolean {
  const lang = ctx.language ?? "de";
  if (b.language && b.language !== lang) return false;
  // Dokumententyp
  if (!b.applies_to_all_doctypes) {
    if (!b.document_type_id || b.document_type_id !== ctx.documentTypeId) return false;
  }
  // Untertyp / Projektart / Kundentyp: gesetzt → muss passen
  if (b.document_subtype_id && b.document_subtype_id !== (ctx.documentSubtypeId ?? null)) return false;
  if (b.project_type_id && b.project_type_id !== (ctx.projectTypeId ?? null)) return false;
  if (b.customer_type && b.customer_type !== (ctx.customerType ?? null)) return false;
  return true;
}

/** Spezifitäts-Score (höher = spezifischer). */
function score(b: TextBlock): number {
  let s = 0;
  if (!b.applies_to_all_doctypes && b.document_type_id) s += W_DOCTYPE;
  if (b.document_subtype_id) s += W_SUBTYPE;
  if (b.project_type_id) s += W_PROJECT;
  if (b.customer_type) s += W_CUSTOMER;
  return s;
}

export type TextMatch = {
  block: TextBlock | null;
  candidates: TextBlock[]; // alle passenden, nach Priorität sortiert
  ambiguous: boolean;      // mehrere gleich gut → Hinweis an den Benutzer
};

/**
 * Wählt den passendsten aktiven Standardtext für einen Texttyp + Kontext.
 * @param defaultsOnly  nur is_default-Bausteine berücksichtigen (für Auto-Einfügen)
 */
export function pickBestText(
  blocks: TextBlock[],
  textType: TextType,
  ctx: MatchContext,
  defaultsOnly = true,
): TextMatch {
  const cands = blocks
    .filter((b) => b.active && b.text_type === textType)
    .filter((b) => (defaultsOnly ? b.is_default : true))
    .filter((b) => isCandidate(b, ctx))
    .map((b) => ({ b, sc: score(b) }))
    .sort((x, y) => {
      if (y.sc !== x.sc) return y.sc - x.sc;                       // 1) Spezifität
      if (x.b.sort_order !== y.b.sort_order) return x.b.sort_order - y.b.sort_order; // 2) Sortierung
      return (y.b.updated_at ?? "").localeCompare(x.b.updated_at ?? ""); // 3) zuletzt geändert
    });

  const candidates = cands.map((c) => c.b);
  const best = candidates[0] ?? null;
  const ambiguous =
    cands.length > 1 &&
    cands[0].sc === cands[1].sc &&
    cands[0].b.sort_order === cands[1].b.sort_order;
  return { block: best, candidates, ambiguous };
}

// ---- Platzhalter / Variablen ----------------------------------
/** Flache Map: Platzhalter-Pfad → Wert (Strings). */
export type PlaceholderValues = Record<string, string | null | undefined>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

// Muss exakt zu buildDocPlaceholders() (document-placeholders.ts) passen – beide
// gemeinsam pflegen. Diese Liste wird dem Nutzer in der UI als „verfügbare Platzhalter"
// angezeigt (kalkulation/Texte.tsx) und gilt für ALLE Dokumenttypen.
export const KNOWN_PLACEHOLDERS = [
  // Kunde
  "kunde.name", "kunde.anrede", "kunde.anrede_zeile", "kunde.firma",
  "kunde.adresse", "kunde.strasse", "kunde.plz", "kunde.ort", "kunde.uid",
  // Projekt
  "projekt.name", "projekt.nummer", "projekt.adresse",
  // Dokument
  "dokument.nummer", "dokument.datum", "dokument.typ",
  // Angebot / Konditionen
  "angebot.gueltig_bis",
  "kondition.zahlungsziel", "kondition.skonto_prozent", "kondition.skonto_tage",
  // Fertige Konditionen-Sätze: leeren sich selbst, wenn nichts gepflegt ist
  // (Skonto 0 %/leer → kein Skonto-Satz im Dokument).
  "kondition.skonto_text", "kondition.zahlungsbedingungen_text",
  // Firma (aus den Firmeneinstellungen)
  "firma.name", "firma.telefon", "firma.email", "firma.web",
  "firma.adresse", "firma.strasse", "firma.plz", "firma.ort",
  "firma.iban", "firma.bic", "firma.uid", "firma.fn",
  "firma.geschaeftsfuehrer", "firma.gesellschafter",
  // Bearbeiter
  "bearbeiter.name",
];

/**
 * Ersetzt {{platzhalter}} im (HTML-)Text.
 *  • markMissing=true  → unbekannte/leere Platzhalter werden für die Vorschau markiert
 *  • markMissing=false → leerer String (kein kaputtes PDF), Platzhalter verschwindet
 * Gibt zusätzlich die Liste fehlender Platzhalter zurück.
 */
export function applyPlaceholders(
  input: string | null | undefined,
  values: PlaceholderValues,
  opts: { markMissing?: boolean } = {},
): { html: string; missing: string[] } {
  const missing: string[] = [];
  const html = String(input ?? "").replace(PLACEHOLDER_RE, (_m, key: string) => {
    const v = values[key];
    if (v != null && String(v).trim() !== "") return escapeHtml(String(v));
    if (!missing.includes(key)) missing.push(key);
    return opts.markMissing
      ? `<span class="ph-missing" title="Platzhalter nicht gefüllt" style="background:#fde68a;color:#92400e;border-radius:3px;padding:0 3px;">{{${key}}}</span>`
      : "";
  });
  return { html, missing };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML → grober Plaintext (für content-Fallback & Suchen). */
export function htmlToPlain(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plaintext → einfache HTML-Absätze. */
export function plainToHtml(plain: string | null | undefined): string {
  const t = (plain ?? "").trim();
  if (!t) return "";
  return t.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Heuristik: enthält der String HTML-Tags? */
export const looksLikeHtml = (s: string | null | undefined): boolean => /<[a-z][\s\S]*>/i.test(s ?? "");

/** True, wenn ein (Rich-)Text faktisch leer ist – auch "<p></p>", "<p><br></p>", "&nbsp;".
 *  Damit erzeugt eine bewusst leere „Einleitung vor Positionen" keine Leerbox/Lücke im PDF. */
export const isEmptyHtml = (s: string | null | undefined): boolean => {
  if (!s) return true;
  return String(s).replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replace(/\s+/g, "").length === 0;
};

/** Bevorzugt Rich-Text, sonst Plaintext (in Absätze gewandelt). */
export function blockHtml(b: Pick<TextBlock, "content_html" | "content">): string {
  if (b.content_html && b.content_html.trim()) return b.content_html;
  const plain = (b.content ?? "").trim();
  if (!plain) return "";
  return plain.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/**
 * Snapshot eines Bausteins für ein Dokument: Rich-Text auflösen + Platzhalter ersetzen.
 * Das Ergebnis wird als KOPIE im Dokument gespeichert – die zentrale Vorlage bleibt unberührt.
 */
export function snapshotText(
  b: Pick<TextBlock, "content_html" | "content">,
  values: PlaceholderValues,
): { html: string; missing: string[] } {
  return applyPlaceholders(blockHtml(b), values, { markMissing: false });
}
