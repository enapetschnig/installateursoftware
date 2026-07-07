// ============================================================
// B4Y SuperAPP – Zentrale Dokumentenübersicht (Datenlayer)
// Liest die View `documents_unified` SERVERSEITIG: Pagination, Filter,
// Suche und Sortierung laufen in der DB (skaliert auf >10.000 Dokumente).
// Mandantenfähig über die RLS der Basistabellen (security_invoker-View).
// Dokumenttypen kommen dynamisch aus document_types – nichts hartcodiert.
// ============================================================
import { supabase } from "./supabase";
import { sortAlpha } from "./sortOptions";
import { contactDisplayName } from "./contact-name";

// Dokument-„Art" (Quelltabelle) → Rechte-Modul + Editor-Route
// 'sub_order' = Auftrag-SUB (Subunternehmer); nutzt das Rechte-Modul 'orders'.
export type DocKindU = "offer" | "order" | "invoice" | "document" | "sub_order";

export const KIND_TABLE: Record<DocKindU, string> = {
  offer: "offers", order: "orders", invoice: "invoices", document: "documents", sub_order: "sub_orders",
};
export const KIND_MODULE: Record<DocKindU, string> = {
  offer: "offers", order: "orders", invoice: "invoices", document: "documents", sub_order: "orders",
};
const KIND_ROUTE: Record<DocKindU, string> = {
  offer: "/angebote", order: "/auftraege", invoice: "/rechnungen", document: "/dokumente", sub_order: "/auftraege-sub",
};

/** Slug der nativen Dokumentkette → Rechte-Modul (für Erstellen/Filter). */
export function slugToKind(slug: string | null): DocKindU {
  if (slug === "angebote") return "offer";
  if (slug === "auftraege") return "order";
  if (slug === "rechnungen") return "invoice";
  if (slug === "auftrag_sub") return "sub_order";
  return "document";
}
export function slugToModule(slug: string | null): string {
  return KIND_MODULE[slugToKind(slug)];
}

export type UnifiedDoc = {
  id: string;
  kind: DocKindU;
  organization_id: string | null;
  document_type_id: string | null;
  type_slug: string | null;
  type_name: string;
  type_sort: number;
  variant_id: string | null;
  variant_name: string | null;
  doc_number: string | null;
  status: string | null;
  status_norm: string;
  payment_status: string | null;
  is_draft: boolean;
  is_archived: boolean;
  is_canceled: boolean;
  is_locked: boolean;
  convertible: boolean;
  customer_id: string | null;
  customer_name: string | null;
  project_id: string | null;
  project_number: string | null;
  project_title: string | null;
  object_address: string | null;
  title: string | null;
  doc_date: string | null;
  doc_year: number | null;
  net: number | null;
  gross: number | null;
  editor_id: string | null;
  editor_name: string | null;
  created_at: string | null;
  last_change: string | null;
  file_url: string | null;
  version_no?: number | null; // höchste abgeschlossene Version (aus document_versions), falls vorhanden
};

// ── Status-Anzeige (normalisiert, einheitlich über alle Dokumentarten) ──
export const STATUS_LABEL: Record<string, string> = {
  entwurf: "Entwurf",
  abgeschlossen: "Abgeschlossen",
  versendet: "Versendet",
  bezahlt: "Bezahlt",
  teilbezahlt: "Teilbezahlt",
  ueberfaellig: "Überfällig",
  storniert: "Storniert",
  archiviert: "Archiviert",
  erhalten: "Erhalten",
  unterschrieben: "Unterschrieben",
  akzeptiert: "Akzeptiert",
  freigegeben: "Freigegeben",
};
export const STATUS_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  entwurf: "slate",
  abgeschlossen: "blue",
  versendet: "blue",
  bezahlt: "green",
  teilbezahlt: "amber",
  ueberfaellig: "red",
  storniert: "red",
  archiviert: "slate",
  erhalten: "green",
  unterschrieben: "green",
  akzeptiert: "green",
  freigegeben: "green",
};
export const statusLabel = (s: string | null) => (s ? STATUS_LABEL[s] ?? s : "–");
export const statusTone = (s: string | null) => (s ? STATUS_TONE[s] ?? "slate" : "slate");

export type QuickFilter =
  | "alle" | "entwuerfe" | "abgeschlossen" | "versendet"
  | "rechnungen_offen" | "dieses_jahr" | "letzte_30" | "archiviert";

export type SortKey =
  | "doc_number" | "type_name" | "variant_name" | "status_norm" | "customer_name"
  | "project_number" | "object_address" | "title" | "doc_date" | "doc_year"
  | "net" | "gross" | "editor_name" | "last_change";

export type DocFilters = {
  search?: string;
  typeSlug?: string | null;
  variantId?: string | null;
  statusNorm?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  editorId?: string | null;
  year?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  archived?: "active" | "archived" | "all";
  canceled?: "active" | "canceled" | "all";
  quick?: QuickFilter;
};

export type QueryParams = DocFilters & {
  sortBy?: SortKey;
  sortDir?: "asc" | "desc";
  page: number;        // 0-basiert
  pageSize: number;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
function daysAgoISO(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10);
}

/**
 * Normalisiert einen Suchbegriff wie die DB-Spalte `search_norm`:
 * Kleinschreibung + alle Nicht-[a-z0-9]-Zeichen entfernt.
 * Dadurch finden Dokumentnummern unabhängig von Bindestrichen, Leerzeichen
 * und Schreibweise (z. B. "0012 2026", "00122026", "Angebot-0012" → "00122026").
 */
export function normalizeSearchValue(v: string): string {
  return (v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Begriff für eine PostgREST-or()-Klausel entschärfen (Trenner/Wildcards raus). */
function sanitizeOrTerm(v: string): string {
  return (v || "").replace(/[,()*%_]+/g, " ").trim();
}

/** Baut die gefilterte Query (ohne Pagination/Count) – Basis für Liste + Export. */
function buildQuery(p: DocFilters) {
  let q = supabase.from("documents_unified").select("*", { count: "exact" });

  // Suche (serverseitig): fehlertolerant über search_text (Volltext) UND
  // search_norm (normalisiert: ohne Bindestriche/Leerzeichen → Dokumentnummern
  // unabhängig von Schreibweise). Beide Treffer werden ODER-verknüpft.
  const term = (p.search ?? "").trim();
  if (term) {
    const raw = sanitizeOrTerm(term);
    const norm = normalizeSearchValue(term);
    const clauses: string[] = [];
    if (raw) clauses.push(`search_text.ilike.*${raw}*`);
    if (norm) clauses.push(`search_norm.ilike.*${norm}*`);
    if (clauses.length > 1) q = q.or(clauses.join(","));
    else if (norm) q = q.ilike("search_norm", `%${norm}%`);
    else if (raw) q = q.ilike("search_text", `%${raw}%`);
  }

  if (p.typeSlug) q = q.eq("type_slug", p.typeSlug);
  if (p.variantId) q = q.eq("variant_id", p.variantId);
  if (p.statusNorm) q = q.eq("status_norm", p.statusNorm);
  if (p.customerId) q = q.eq("customer_id", p.customerId);
  if (p.projectId) q = q.eq("project_id", p.projectId);
  if (p.editorId) q = q.eq("editor_id", p.editorId);
  if (p.year) q = q.eq("doc_year", p.year);
  if (p.dateFrom) q = q.gte("doc_date", p.dateFrom);
  if (p.dateTo) q = q.lte("doc_date", p.dateTo);
  if (p.amountMin != null) q = q.gte("gross", p.amountMin);
  if (p.amountMax != null) q = q.lte("gross", p.amountMax);

  // Archiviert / Storniert (Tri-State)
  const arch = p.archived ?? "active";
  if (arch === "active") q = q.eq("is_archived", false);
  else if (arch === "archived") q = q.eq("is_archived", true);
  const canc = p.canceled ?? "all";
  if (canc === "active") q = q.eq("is_canceled", false);
  else if (canc === "canceled") q = q.eq("is_canceled", true);

  // Schnellfilter (kombinieren mit obigen Filtern)
  switch (p.quick) {
    case "entwuerfe": q = q.eq("status_norm", "entwurf"); break;
    case "abgeschlossen": q = q.eq("status_norm", "abgeschlossen"); break;
    case "versendet": q = q.eq("status_norm", "versendet"); break;
    case "rechnungen_offen":
      q = q.eq("type_slug", "rechnungen").not("status_norm", "in", "(bezahlt,entwurf,storniert,archiviert)");
      break;
    case "dieses_jahr": q = q.eq("doc_year", new Date().getFullYear()); break;
    case "letzte_30": q = q.gte("doc_date", daysAgoISO(30)); break;
    case "archiviert": q = q.eq("is_archived", true); break;
    case "alle":
    default: break;
  }
  return q;
}

export async function queryDocuments(p: QueryParams): Promise<{ rows: UnifiedDoc[]; count: number }> {
  let q = buildQuery(p);
  const sortBy = p.sortBy ?? "last_change";
  q = q.order(sortBy, { ascending: p.sortDir === "asc", nullsFirst: false });
  // Stabiler Sekundärschlüssel (id ist keine Sortierspalte der UI)
  q = q.order("id", { ascending: true });
  const from = p.page * p.pageSize;
  q = q.range(from, from + p.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  const rows = (data as unknown as UnifiedDoc[]) ?? [];
  await attachVersionNumbers(rows);
  return { rows, count: count ?? 0 };
}

/**
 * Höchste abgeschlossene Versionsnummer je Dokument anhängen (eine Zusatzabfrage
 * pro Seite). Die große View bleibt unangetastet; RLS von document_versions greift.
 */
async function attachVersionNumbers(rows: UnifiedDoc[]): Promise<void> {
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  const { data, error } = await supabase
    .from("document_versions").select("source_id,version_no").in("source_id", ids);
  if (error || !data) return;
  const maxBy = new Map<string, number>();
  for (const v of data as { source_id: string; version_no: number }[]) {
    const cur = maxBy.get(v.source_id) ?? 0;
    if (v.version_no > cur) maxBy.set(v.source_id, v.version_no);
  }
  for (const r of rows) r.version_no = maxBy.get(r.id) ?? null;
}

/** Gefilterte Liste für CSV-Export (ohne Pagination, gedeckelt). */
export async function fetchForExport(p: DocFilters, cap = 5000): Promise<UnifiedDoc[]> {
  const q = buildQuery(p).order("last_change", { ascending: false, nullsFirst: false }).range(0, cap - 1);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as unknown as UnifiedDoc[]) ?? [];
}

// ── Filter-Optionen (dynamisch, mandantenfähig) ───────────────────────────
export type DocTypeOption = {
  id: string; name: string; slug: string; sort_order: number;
  is_active: boolean; allow_create: boolean; allow_upload: boolean;
  belongs_to_project: boolean; icon: string | null;
};

export async function loadDocTypeOptions(): Promise<DocTypeOption[]> {
  const { data, error } = await supabase
    .from("document_types")
    .select("id,name,slug,sort_order,is_active,allow_create,allow_upload,belongs_to_project,icon")
    .order("sort_order").order("name");
  if (error) throw new Error(error.message);
  return (data as DocTypeOption[]) ?? [];
}

export type VariantOption = { id: string; name: string; slug: string; is_active: boolean };
export async function loadVariantOptions(): Promise<VariantOption[]> {
  const { data, error } = await supabase
    .from("offer_types").select("id,name,slug,is_active").order("sort_order").order("name");
  if (error) throw new Error(error.message);
  return (data as VariantOption[]) ?? [];
}

export type EditorOption = { id: string; name: string | null };
export async function loadEditorOptions(): Promise<EditorOption[]> {
  const { data, error } = await supabase.from("profiles").select("id,name").order("name");
  if (error) throw new Error(error.message);
  return sortAlpha((data as EditorOption[]) ?? [], "name");
}

export type CustomerOption = { id: string; label: string };
export async function loadCustomerOptions(): Promise<CustomerOption[]> {
  const { data, error } = await supabase
    .from("contacts").select("id, company, first_name, last_name, customer_type")
    .order("company").order("last_name");
  if (error) throw new Error(error.message);
  return sortAlpha(((data as any[]) ?? []).map((c) => ({
    id: c.id,
    label: contactDisplayName(c, { fallback: "Kontakt" }),
  })), "label");
}

export type ProjectOption = { id: string; label: string };
export async function loadProjectOptions(): Promise<ProjectOption[]> {
  const { data, error } = await supabase
    .from("projects").select("id, title, project_number").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return sortAlpha(((data as any[]) ?? []).map((p) => ({
    id: p.id, label: p.project_number ? `${p.project_number} · ${p.title}` : (p.title || "Projekt"),
  })), "label");
}

// ── Editor-Route je Dokument (Klick öffnet passende Ansicht) ──────────────
/** Erkennt eine UUID (v4-Form) – zur Unterscheidung von sprechenden Nummern-Slugs in URLs. */
export const isUuid = (s: string | null | undefined): boolean =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function editorRoute(d: Pick<UnifiedDoc, "kind" | "id" | "project_id" | "file_url" | "doc_number">): string | null {
  // Generische Dokumente: hochgeladene Dateien → file_url; in der App erstellte
  // (Text-)Dokumente ohne Datei → eigener Editor /dokumente/:id; sonst Projekt-Fallback.
  if (d.kind === "document") return d.file_url || `/dokumente/${d.id}` || (d.project_id ? projectRoute({ id: d.project_id }) : null);
  // Sprechende URL über die Dokumentnummer (z. B. /angebote/ANGEBOT-0010-2026); Entwürfe ohne
  // Nummer und Alt-Links weiter über die UUID. Die Editoren lösen beides auf (Nummer ODER UUID).
  const slug = d.doc_number && d.doc_number.trim() ? encodeURIComponent(d.doc_number.trim()) : d.id;
  return `${KIND_ROUTE[d.kind]}/${slug}`;
}

/** Sprechende Projekt-Route: /projekte/PROJEKT-0001-2026; Fallback auf UUID (Alt-Links). */
export function projectRoute(p: { id: string; project_number?: string | null }): string {
  const slug = p.project_number && p.project_number.trim() ? encodeURIComponent(p.project_number.trim()) : p.id;
  return `/projekte/${slug}`;
}

/** Sprechender Slug aus Dokumentnummer (bevorzugt) oder UUID-Fallback. */
const numberSlug = (num: string | null | undefined, id: string) =>
  num && num.trim() ? encodeURIComponent(num.trim()) : id;

/** Sprechende Editor-Route aus bereits bekannter Nummer (kein DB-Zugriff). Nummer bevorzugt, UUID-Fallback. */
export function docPath(kind: "offer" | "order" | "invoice", id: string, number: string | null | undefined): string {
  return `${KIND_ROUTE[kind]}/${numberSlug(number, id)}`;
}

/** Liefert die sprechende Editor-Route für ein frisch erzeugtes Dokument (Nummer bevorzugt). */
export async function docRouteById(kind: "offer" | "order" | "invoice", id: string): Promise<string> {
  const col = kind === "order" ? "order_number" : "number";
  const { data } = await supabase.from(KIND_TABLE[kind]).select(col).eq("id", id).maybeSingle();
  return `${KIND_ROUTE[kind]}/${numberSlug((data as any)?.[col], id)}`;
}

// ── Archivieren / Reaktivieren (UPDATE, RLS der Basistabelle greift) ──────
export async function setArchived(kind: DocKindU, id: string, archived: boolean, userId: string | null) {
  const { error } = await supabase
    .from(KIND_TABLE[kind])
    .update({ archived_at: archived ? new Date().toISOString() : null, archived_by: archived ? userId : null })
    .eq("id", id);
  return { error: error?.message };
}

// ── Dokument erstellen (chain: eigene Editoren; generisch: Projekt) ───────
/**
 * Liefert die Ziel-Route zum Anlegen eines Dokuments des gewählten Typs.
 * Für Angebot/Auftrag wird sofort ein Entwurf angelegt (wie in den bestehenden
 * Listen), für Rechnung der Editor im Neu-Modus geöffnet. Generische Typen
 * (Uploads) werden im Projektkontext erstellt.
 */
export async function startCreateRoute(
  type: DocTypeOption,
  opts: { projectId?: string | null; contactId?: string | null; voice?: boolean } = {},
): Promise<{ route?: string; error?: string }> {
  const kind = slugToKind(type.slug);
  const projectId = opts.projectId || null;
  const contactId = opts.contactId || null;

  // Entwürfe verbrauchen KEINE Nummer (Vergabe erst beim Abschließen/Beauftragen
  // via ensure_document_number) → Entwurfs-Route = UUID.
  if (kind === "offer") {
    const { data, error } = await supabase.from("offers").insert({
      title: "Neues Angebot", number: null, status: "entwurf",
      items: [], net: 0, vat: 0, gross: 0, use_global_display: true,
      project_id: projectId, contact_id: contactId,
    }).select("id").single();
    if (error || !data) return { error: error?.message ?? "Angebot konnte nicht angelegt werden." };
    const base = `/angebote/${(data as any).id}`;
    return { route: opts.voice ? `${base}?voice=1` : base };
  }

  if (kind === "order") {
    const { data, error } = await supabase.from("orders").insert({
      order_number: null, order_date: todayISO(),
      title: "Neuer Auftrag", status: "entwurf", invoice_status: "offen",
      items: [], net: 0, vat: 0, gross: 0, project_id: projectId, contact_id: contactId,
    }).select("id").single();
    if (error || !data) return { error: error?.message ?? "Auftrag konnte nicht angelegt werden." };
    return { route: `/auftraege/${(data as any).id}` };
  }

  if (kind === "invoice") {
    const qs = projectId ? `?projectId=${projectId}` : "";
    return { route: `/rechnungen/new${qs}` };
  }

  // Generische Dokumente (Uploads): im Projektkontext erstellen
  if (projectId) return { route: `/projekte/${projectId}` };
  return { error: "PROJECT_REQUIRED" };
}

// ── CSV-Export-Helfer ─────────────────────────────────────────────────────
export function rowsToCsv(rows: UnifiedDoc[]): string {
  const head = [
    "Nummer", "Typ", "Variante", "Status", "Kunde", "Projektnr", "Projekt",
    "Adresse", "Betreff", "Datum", "Jahr", "Netto", "Brutto", "Bearbeiter", "Letzte Änderung",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => [
    r.doc_number, r.type_name, r.variant_name, statusLabel(r.status_norm),
    r.customer_name, r.project_number, r.project_title, r.object_address, r.title,
    r.doc_date, r.doc_year, r.net ?? "", r.gross ?? "", r.editor_name, r.last_change,
  ].map(esc).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\n");
}
