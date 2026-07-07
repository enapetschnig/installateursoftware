// ============================================================
// B4Y SuperAPP – Zentrale Soft-Delete-Logik für Dokumente
// Dynamisch für ALLE Dokumenttypen über Status + Registry, NICHT
// hart auf Namen programmiert. Mandantenfähig (Org-RLS greift in der DB).
//
//  • Nur Entwürfe/Arbeitsversionen sind löschbar.
//  • Abgeschlossene / gebuchte / gesperrte / stornierte / ersetzte
//    Dokumente sind geschützt.
//  • Soft-Delete: deleted_at + deleted_by werden gesetzt; Zeile bleibt
//    erhalten, wird aber aus allen normalen Listen ausgeblendet.
// ============================================================
import { supabase } from "./supabase";

export type DocKind = "offer" | "order" | "invoice" | "document" | "sub_order";

type DeleteConfig = {
  table: string;
  statusCol: string;        // Spalte mit dem Dokumentstatus
  draftStatuses: string[];  // Status, in denen gelöscht werden darf
  lockedCol?: string;       // optionale Sperr-Spalte (true = gesperrt)
  permModule: string;       // Rechte-Modul für can(module,'delete')
};

// Registry: neue Dokumenttypen hier ergänzen – keine Speziallogik in den Seiten.
export const DOC_DELETE_REGISTRY: Record<DocKind, DeleteConfig> = {
  offer:    { table: "offers",    statusCol: "status",     draftStatuses: ["entwurf"],          permModule: "offers" },
  order:    { table: "orders",    statusCol: "status",     draftStatuses: ["entwurf"],          permModule: "orders" },
  invoice:  { table: "invoices",  statusCol: "doc_status", draftStatuses: ["entwurf"],          lockedCol: "locked", permModule: "invoices" },
  document: { table: "documents", statusCol: "status",     draftStatuses: ["entwurf", "draft"], permModule: "documents" },
  // Auftrag-SUB: nur Entwürfe löschbar; Rechte über das Auftrags-Modul 'orders'.
  sub_order: { table: "sub_orders", statusCol: "status",   draftStatuses: ["entwurf"],          permModule: "orders" },
};

export const DELETE_CONFIRM_TEXT =
  "Diesen Entwurf dauerhaft löschen? Diese Aktion kann nicht rückgängig gemacht werden.";
export const DELETE_LOCKED_HINT =
  "Abgeschlossene Dokumente können nicht gelöscht werden. Bitte Storno, Korrektur oder neue Version verwenden.";
export const DELETE_GONE_TEXT =
  "Dieser Entwurf wurde gelöscht oder ist nicht mehr verfügbar.";

/** Ist die Zeile gelöscht oder gar nicht (mehr) vorhanden? */
export function isDeletedOrMissing(row: any | null | undefined): boolean {
  return !row || row.deleted_at != null;
}

/** Darf dieses konkrete Dokument (Status/Sperre) gelöscht werden? Reine Statusprüfung – Rechte separat. */
export function isDeletable(kind: DocKind, row: any | null | undefined): boolean {
  if (isDeletedOrMissing(row)) return false;
  const cfg = DOC_DELETE_REGISTRY[kind];
  if (!cfg) return false;
  if (cfg.lockedCol && row[cfg.lockedCol]) return false;
  const status = row[cfg.statusCol];
  return cfg.draftStatuses.includes(status);
}

/**
 * Hard-Delete eines ENTWURFS (echtes DELETE, kein Soft-Delete).
 *
 * Warum hart: Ein Soft-Delete (UPDATE deleted_at) kollidiert mit der
 * SELECT-Policy `hide_soft_deleted` (deleted_at IS NULL) – PostgREST liest die
 * Zeile nach dem Update zurück und die Policy blendet sie aus
 * → "new row violates row-level security policy hide_soft_deleted".
 * Entwürfe sind rechtlich unkritisch und dürfen vollständig entfernt werden.
 *
 * Der Status-Guard liegt zusätzlich in der WHERE-Klausel (in[draftStatuses],
 * nicht gesperrt), damit zwischenzeitlich abgeschlossene Dokumente NIE gelöscht
 * werden. Kind-Daten (Positionen/Items/Verknüpfungen) räumen die FK-Cascades
 * (order_items, invoice_items, invoice_offers …); project_log.offer_id ist SET NULL.
 * Polymorphe Versions-/Audit-Daten (ohne FK) werden hier zusätzlich entfernt.
 * Mandantentrennung erfolgt über die bestehende Org-RLS; das Recht über `del`.
 */
export async function deleteDraftDocument(
  kind: DocKind, id: string,
): Promise<{ error?: string }> {
  const cfg = DOC_DELETE_REGISTRY[kind];
  if (!cfg) return { error: "Unbekannter Dokumenttyp." };
  let q = supabase
    .from(cfg.table)
    .delete()
    .eq("id", id)
    .in(cfg.statusCol, cfg.draftStatuses);
  if (cfg.lockedCol) q = q.neq(cfg.lockedCol, true);
  const { data, error } = await q.select("id");
  if (error) return { error: error.message };
  // 0 Treffer → Status-Guard hat geblockt (Dokument ist kein Entwurf mehr / gesperrt)
  if (!data || data.length === 0) return { error: DELETE_LOCKED_HINT };
  // Verwaiste polymorphe Daten dieses Entwurfs aufräumen (keine FK vorhanden)
  await supabase.from("document_versions").delete().eq("source_table", kind).eq("source_id", id);
  await supabase.from("document_audit_log").delete().eq("source_table", kind).eq("source_id", id);
  return {};
}

/** @deprecated Alt-Name – nutzt jetzt das echte Hard-Delete für Entwürfe. */
export const softDeleteDocument = (kind: DocKind, id: string, _userId?: string | null) =>
  deleteDraftDocument(kind, id);
