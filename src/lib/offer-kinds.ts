// ============================================================
// B4Y SuperAPP – Angebotstypen (Standard / Pauschal / Regie)
// Jeder Typ liefert eigene PDF-Darstellung (OfferDisplay), Einleitungs-
// und Abschlusstext sowie eine PDF-Überschrift. Beim Anlegen/Typwechsel
// eines Angebots werden diese Werte als Snapshot ins Angebot kopiert.
// ============================================================
import { supabase } from "./supabase";
import { OfferDisplay, DEFAULT_DISPLAY } from "./offer-display";

export type OfferType = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  pdf_label: string;
  intro_text: string | null;
  closing_text: string | null;
  footer_text: string | null;       // optionaler Fußzeilen-Zusatztext je Variante
  show_page_numbers: boolean;        // eigene Seitenzählung „Seite X von Y" an/aus
  display: OfferDisplay;
  is_active: boolean;
  sort_order: number;
  is_system: boolean;   // geschützte Standardvariante (nicht löschbar; Migr. 0082)
};

const COLS =
  "id,name,slug,description,pdf_label,intro_text,closing_text,footer_text,show_page_numbers,is_active,sort_order,is_system," +
  "default_is_lump_sum,default_show_unit_prices,default_show_position_totals,default_show_subtotals," +
  "default_show_only_grand_total,default_show_images,default_show_service_images,default_show_article_images," +
  "default_show_articles_inside_services,default_show_vat,default_group_titles,default_show_title_sums," +
  "default_show_quantities,default_show_long_texts,default_show_discount";

function displayFromRow(r: any): OfferDisplay {
  return {
    is_lump_sum: !!r.default_is_lump_sum,
    show_unit_prices: !!r.default_show_unit_prices,
    show_position_totals: !!r.default_show_position_totals,
    show_subtotals: !!r.default_show_subtotals,
    show_only_grand_total: !!r.default_show_only_grand_total,
    show_images: !!r.default_show_images,
    show_service_images: !!r.default_show_service_images,
    show_article_images: !!r.default_show_article_images,
    show_articles_inside_services: !!r.default_show_articles_inside_services,
    show_vat: !!r.default_show_vat,
    group_titles: !!r.default_group_titles,
    show_title_sums: !!r.default_show_title_sums,
    show_quantities: r.default_show_quantities !== false,
    show_long_texts: r.default_show_long_texts !== false,
    show_discount: r.default_show_discount !== false,
  };
}

function fromRow(r: any): OfferType {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description ?? null,
    pdf_label: r.pdf_label || "Angebot",
    intro_text: r.intro_text ?? null,
    closing_text: r.closing_text ?? null,
    footer_text: r.footer_text ?? null,
    show_page_numbers: r.show_page_numbers !== false,
    display: displayFromRow(r),
    is_active: !!r.is_active,
    sort_order: Number(r.sort_order) || 0,
    is_system: !!r.is_system,
  };
}

/** Alle Angebotstypen (für die Verwaltung – inkl. inaktive). */
export async function loadOfferTypes(activeOnly = false): Promise<OfferType[]> {
  let q = supabase.from("offer_types").select(COLS).order("sort_order", { ascending: true });
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map(fromRow);
}

export async function saveOfferType(t: OfferType): Promise<{ error?: string; id?: string }> {
  const payload: any = {
    id: t.id || undefined,
    name: t.name,
    slug: t.slug,
    description: t.description,
    pdf_label: t.pdf_label || "Angebot",
    intro_text: t.intro_text,
    closing_text: t.closing_text,
    footer_text: t.footer_text,
    show_page_numbers: t.show_page_numbers,
    is_active: t.is_active,
    sort_order: t.sort_order,
    updated_at: new Date().toISOString(),
  };
  (Object.keys(t.display) as (keyof OfferDisplay)[]).forEach((k) => { payload["default_" + k] = t.display[k]; });
  const { data, error } = await supabase.from("offer_types").upsert(payload).select("id").maybeSingle();
  return { error: error?.message, id: (data as any)?.id };
}

/** Geschützte Standard-Dokumentvariante? (nicht löschbar) */
export const PROTECTED_OFFER_TYPE_MSG = "Standard-Dokumentvariante – kann nicht gelöscht werden.";

export async function deleteOfferType(id: string): Promise<{ error?: string }> {
  // Frontend-Schutz (zusätzlich zum DB-Trigger aus Migr. 0082): geschützte
  // Standardvarianten dürfen nicht gelöscht werden.
  const { data: row } = await supabase.from("offer_types").select("is_system").eq("id", id).maybeSingle();
  if ((row as any)?.is_system) return { error: PROTECTED_OFFER_TYPE_MSG };
  const { error } = await supabase.from("offer_types").delete().eq("id", id);
  return { error: error?.message };
}

// ============================================================
// Dokumentvariante (Familie) für Listen-Badges – aus dem Angebotstyp abgeleitet.
// offer_type_id wird entlang der Kette (Angebot→Auftrag→Rechnung) mitgeführt,
// daher funktioniert dies für alle drei Dokumentarten mit EINEM Feld.
// ============================================================
export type VariantFamily = "standard" | "pauschal" | "regie";

/** Leitet die Variantenfamilie aus Slug/Name eines Angebotstyps ab (Fallback: standard). */
export function variantFamily(t?: { slug?: string | null; name?: string | null } | null): VariantFamily {
  const s = `${t?.slug ?? ""} ${t?.name ?? ""}`.toLowerCase();
  if (s.includes("pausch")) return "pauschal";
  if (s.includes("regie")) return "regie";
  return "standard";
}

const FAMILY_LABEL: Record<VariantFamily, string> = { standard: "Standard", pauschal: "Pauschal", regie: "Regie" };
type DocNounKey = "angebot" | "auftrag" | "rechnung" | "nachtrag" | "auftrag_sub";
const DOC_NOUN: Record<DocNounKey, string> = { angebot: "angebot", auftrag: "auftrag", rechnung: "rechnung", nachtrag: "nachtrag", auftrag_sub: "auftrag SUB" };

/** Benutzerfreundliches Varianten-Label, z. B. „Pauschalangebot", „Regieauftrag", „Standardrechnung", „Regienachtrag", „Pauschalauftrag SUB". */
export function variantLabel(doctype: DocNounKey, t?: { slug?: string | null; name?: string | null } | null): string {
  return `${FAMILY_LABEL[variantFamily(t)]}${DOC_NOUN[doctype]}`;
}

/** Badge-Ton je Variantenfamilie (einheitlich in allen Listen). */
export function variantTone(t?: { slug?: string | null; name?: string | null } | null): "slate" | "blue" | "amber" {
  const f = variantFamily(t);
  return f === "pauschal" ? "blue" : f === "regie" ? "amber" : "slate";
}

/** Bequemer Default: der „standard"-Typ, sonst der erste aktive, sonst null. */
export function pickDefaultType(types: OfferType[]): OfferType | null {
  return types.find((t) => t.slug === "standard") ?? types.find((t) => t.is_active) ?? types[0] ?? null;
}

/** Leerer Typ (für „neuen Typ anlegen"). */
export function emptyOfferType(sortOrder = 0): OfferType {
  return {
    id: "", name: "", slug: "", description: "", pdf_label: "Angebot",
    intro_text: "", closing_text: "", footer_text: "", show_page_numbers: true,
    display: { ...DEFAULT_DISPLAY },
    is_active: true, sort_order: sortOrder, is_system: false,
  };
}
