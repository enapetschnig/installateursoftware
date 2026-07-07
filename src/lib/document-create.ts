// ============================================================
// B4Y SuperAPP – Zentrale Dokument-Erstellung (Entwürfe)
// ------------------------------------------------------------
// EINE Quelle für das Anlegen neuer Dokument-Entwürfe (Angebot,
// Angebot-Nachtrag, Auftrag) – genutzt sowohl im Projektkontext
// (ProjectDetail) als auch in der globalen Dokumente-Übersicht
// (/dokumente). Übernimmt die gewählte Variante sauber als
// `offer_type_id` + `display_settings_snapshot` (Bugfix: die alte
// globale `startCreateRoute` hat das nicht gespeichert).
//
// Bewusst PUR: nur DB-Insert + Ziel-Route. Logbuch-Einträge,
// Reiter-/Section-Merker und Navigation bleiben beim Aufrufer
// (kontextabhängig). Mandantenfähig über die RLS der Basistabellen
// (offers/orders haben organization_id + org_isolation-Policy).
// ============================================================
import { supabase } from "./supabase";
import type { OfferType } from "./offer-kinds";
import { docPath } from "./documents-overview";
import { loadTransitionFor, deriveFollowDoc } from "./document-transitions";
import {
  DocumentType, createTextDocument, createFormDocument,
  isTextDocumentType, isFormDocumentType, isUploadOnlyDocumentType,
} from "./documents";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Gemeinsamer Kontext für einen neuen Dokument-Entwurf. */
export type DraftCtx = {
  projectId?: string | null;
  contactId?: string | null;
  title?: string | null;
  /** Gewählte Variante (offer_type) – wird als Snapshot übernommen. */
  offerType?: OfferType | null;
};

export type DraftResult = { id?: string; number?: string | null; route?: string; error?: string };

/** Angebot-Entwurf anlegen (Projekt optional). Variante wird übernommen.
 *  OHNE Nummer: Entwürfe verbrauchen keine Nummer aus dem Nummernkreis –
 *  die Angebotsnummer wird erst beim Abschließen vergeben (ensure_document_number). */
export async function createOfferDraft(ctx: DraftCtx & { voice?: boolean }): Promise<DraftResult> {
  const { data, error } = await supabase.from("offers").insert({
    project_id: ctx.projectId ?? null, contact_id: ctx.contactId ?? null,
    title: ctx.title || "Neues Angebot", status: "entwurf",
    number: null, items: [], net: 0, vat: 0, gross: 0,
    offer_intro_text: null, offer_closing_text: null, notes: null,
    use_global_display: true,
    offer_type_id: ctx.offerType?.id ?? null,
    display_settings_snapshot: ctx.offerType?.display ?? null,
  }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Angebot konnte nicht angelegt werden." };
  // Entwurfs-Route = UUID (docPath fällt ohne Nummer automatisch darauf zurück).
  const base = docPath("offer", (data as any).id, null);
  return { id: (data as any).id, number: null, route: ctx.voice ? `${base}?voice=1` : base };
}

/**
 * Angebot-Nachtrag anlegen (Angebot mit kind='nachtrag' + Auftragsbezug).
 * Braucht ein Projekt (für Nummernkreis-Kontext + Auftragsbezug). Genau einen
 * aktiven Auftrag automatisch verknüpfen; Variante-spezifische Nachtragstexte
 * als Default ziehen (fehlen sie → null, OfferEditor füllt aus Standardtexten).
 */
export async function createNachtragDraft(ctx: DraftCtx): Promise<DraftResult> {
  if (!ctx.projectId) return { error: "PROJECT_REQUIRED" };
  const { data: ords } = await supabase.from("orders").select("id")
    .eq("project_id", ctx.projectId).is("deleted_at", null)
    .neq("status", "storniert").neq("status", "archiviert").neq("status", "entwurf");
  const relatedOrderId = ords && ords.length === 1 ? (ords[0] as any).id : null;
  const ntTrans = ctx.offerType?.id ? await loadTransitionFor(ctx.offerType.id) : null;
  const ntFollow = deriveFollowDoc(
    "nachtrag",
    { offer_type_id: ctx.offerType?.id ?? null, display_settings_snapshot: ctx.offerType?.display ?? null },
    ntTrans, ctx.offerType ?? null,
  );
  const { data, error } = await supabase.from("offers").insert({
    project_id: ctx.projectId, contact_id: ctx.contactId ?? null,
    title: ctx.title || "Nachtrag", status: "entwurf",
    number: null, items: [], net: 0, vat: 0, gross: 0,
    kind: "nachtrag", related_order_id: relatedOrderId,
    offer_type_id: ctx.offerType?.id ?? null,
    offer_intro_text: ntFollow.doc_intro_text, offer_closing_text: ntFollow.doc_closing_text,
    notes: null, use_global_display: true,
    display_settings_snapshot: ctx.offerType?.display ?? null,
  }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Nachtrag konnte nicht angelegt werden." };
  // Nachtragsnummer erst beim Abschließen (doc_type 'nachtrag' via ensure_document_number).
  return { id: (data as any).id, number: null, route: docPath("offer", (data as any).id, null) };
}

/** Auftrag-Entwurf anlegen (Projekt optional). Variante wird übernommen.
 *  OHNE Nummer: die Auftragsnummer wird erst beim Beauftragen/Abschließen vergeben. */
export async function createOrderDraft(ctx: DraftCtx): Promise<DraftResult> {
  const { data, error } = await supabase.from("orders").insert({
    order_number: null, order_date: todayISO(),
    title: ctx.title || "Neuer Auftrag", project_id: ctx.projectId ?? null, contact_id: ctx.contactId ?? null,
    status: "entwurf", invoice_status: "offen", net: 0, vat: 0, gross: 0, offer_ids: [],
    offer_type_id: ctx.offerType?.id ?? null,
    display_settings_snapshot: ctx.offerType?.display ?? null,
  }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Auftrag konnte nicht angelegt werden." };
  return { id: (data as any).id, number: null, route: docPath("order", (data as any).id, null) };
}

/** Ziel-Route für eine neue Rechnung (Neu-Flow; Projekt + Variante optional). */
export function invoiceNewRoute(ctx: { projectId?: string | null; offerType?: OfferType | null } = {}): string {
  const params = new URLSearchParams();
  if (ctx.projectId) params.set("projectId", ctx.projectId);
  if (ctx.offerType?.id) params.set("offerType", ctx.offerType.id);
  const qs = params.toString();
  return `/rechnungen/new${qs ? `?${qs}` : ""}`;
}

// ── Generische (Nicht-Ketten-)Dokumenttypen ───────────────────────────────
export type GenericResult =
  | { kind: "navigate"; route: string }      // Textdokument angelegt → Editor öffnen
  | { kind: "refresh" }                       // Datensatz angelegt → Liste aktualisieren
  | { kind: "info"; message: string }         // (noch) kein Editor / nur Upload
  | { error: string };

/**
 * Generischen Dokumenttyp im Projektkontext anlegen (Verzweigung nach
 * Dokumentstruktur, Migr. 0084): text → echtes Textdokument + Editor-Route;
 * form → Hinweis (Editor folgt); upload_only → Hinweis (nur Upload);
 * sonst → generischer documents-Datensatz (Liste aktualisieren).
 * Side-Effects (Toast/Logbuch/Navigation) bleiben beim Aufrufer.
 */
export async function createGenericDocument(opts: {
  projectId: string;
  docType: DocumentType;
  customerId?: string | null;
  title?: string | null;
  createdBy?: string | null;
}): Promise<GenericResult> {
  const { projectId, docType } = opts;
  if (isUploadOnlyDocumentType(docType)) {
    return { kind: "info", message: `„${docType.name}" ist eine reine Ablage-Dokumentart – bitte per Datei-Upload hinzufügen.` };
  }
  if (isFormDocumentType(docType)) {
    try {
      const created = await createFormDocument({
        projectId, documentType: docType,
        customerId: opts.customerId ?? null,
        title: opts.title || docType.name, createdBy: opts.createdBy ?? null,
      });
      return { kind: "navigate", route: `/dokumente/${created.id}` };
    } catch (e: any) { return { error: e?.message ?? "Formular konnte nicht erstellt werden." }; }
  }
  if (isTextDocumentType(docType)) {
    try {
      const created = await createTextDocument({
        projectId, documentType: docType,
        customerId: opts.customerId ?? null,
        title: opts.title || docType.name, createdBy: opts.createdBy ?? null,
      });
      return { kind: "navigate", route: `/dokumente/${created.id}` };
    } catch (e: any) { return { error: e?.message ?? "Dokument konnte nicht erstellt werden." }; }
  }
  // Fallback (positions / unbekannt): generischen Datensatz anlegen.
  const { error } = await supabase.from("documents").insert({
    project_id: projectId, document_type_id: docType.id, title: opts.title || docType.name,
    status: "entwurf", source_type: "created_in_app", uploaded_by: opts.createdBy ?? null,
  });
  if (error) return { error: error.message };
  return { kind: "refresh" };
}
