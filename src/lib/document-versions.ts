// ============================================================
// B4Y SuperAPP – Laufzeit-Versionierung von Dokumenten (generisch)
//  • finalizeDocumentVersion: unveränderlichen Snapshot (V1, V2, …) anlegen
//  • loadDocumentVersions / loadDocumentAudit: Historie laden
//  • logDocumentAudit: Änderungsprotokoll-Eintrag
// Steuerung erfolgt über die Dokumenttyp-Flags (versioning_enabled,
// create_pdf_snapshot_on_finalize, audit_log_enabled) – keine Hardcodierung.
// ============================================================
import { supabase } from "./supabase";
import { prepareDocumentPdf } from "./pdf";

export type DocVersion = {
  id: string;
  source_table: string;
  source_id: string;
  version_no: number;
  status: string | null;
  title: string | null;
  doc_number: string | null;
  data: any;
  summary: any;
  print_html: string | null;
  created_by: string | null;
  finalized_at: string;
  created_at: string;
};

export type AuditEntry = {
  id: string;
  source_table: string;
  source_id: string;
  version_no: number | null;
  action: string;
  detail: string | null;
  user_id: string | null;
  created_at: string;
};

const VERSION_COLUMNS =
  "id,source_table,source_id,version_no,status,title,doc_number,data,summary,print_html,created_by,finalized_at,created_at";

export type VersionFlags = {
  versioning_enabled: boolean;
  create_pdf_snapshot_on_finalize: boolean;
  audit_log_enabled: boolean;
};

/** Versions-Flags eines Dokumenttyps (per slug) laden – steuert das Versionieren je Mandant/Typ. */
export async function loadVersionFlags(typeSlug: string): Promise<VersionFlags | null> {
  const { data, error } = await supabase
    .from("document_types")
    .select("versioning_enabled,create_pdf_snapshot_on_finalize,audit_log_enabled")
    .eq("slug", typeSlug)
    .maybeSingle();
  if (error || !data) return null;
  return data as VersionFlags;
}

/**
 * Höchste abgeschlossene Versionsnummer je Dokument-ID (für Listen/Übersichten).
 * Eine Abfrage über alle übergebenen IDs; RLS von document_versions greift.
 */
export async function loadVersionMap(ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const clean = Array.from(new Set(ids.filter(Boolean)));
  if (clean.length === 0) return m;
  const { data, error } = await supabase
    .from("document_versions").select("source_id,version_no").in("source_id", clean);
  if (error || !data) return m;
  for (const v of data as { source_id: string; version_no: number }[]) {
    const cur = m.get(v.source_id) ?? 0;
    if (v.version_no > cur) m.set(v.source_id, v.version_no);
  }
  return m;
}

export async function loadDocumentVersions(sourceTable: string, sourceId: string): Promise<DocVersion[]> {
  const { data, error } = await supabase
    .from("document_versions")
    .select(VERSION_COLUMNS)
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId)
    .order("version_no", { ascending: false });
  if (error) throw error;
  return (data as unknown as DocVersion[]) ?? [];
}

export async function loadDocumentAudit(sourceTable: string, sourceId: string): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("document_audit_log")
    .select("id,source_table,source_id,version_no,action,detail,user_id,created_at")
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as AuditEntry[]) ?? [];
}

export async function logDocumentAudit(
  sourceTable: string, sourceId: string, action: string, detail?: string | null, versionNo?: number | null,
): Promise<void> {
  await supabase.from("document_audit_log").insert({
    source_table: sourceTable, source_id: sourceId, action,
    detail: detail ?? null, version_no: versionNo ?? null,
  });
}

/**
 * Einheitlicher Abschluss-Zeitstempel für die Finalisierung – EINE Quelle für
 * Dokumentdatum, Abschlussdatum/-uhrzeit und PDF-Snapshot-Datum aller Typen.
 * `iso` = voller Zeitstempel (closed_at u.ä.), `date` = Datumsteil YYYY-MM-DD
 * (für Datumsfelder wie order_date/invoice_date). Beim Finalisieren wird das
 * Dokumentdatum hierauf gesetzt; alte Versions-Snapshots bleiben unverändert.
 */
export function finalizeStamp(): { iso: string; date: string } {
  const iso = new Date().toISOString();
  return { iso, date: iso.slice(0, 10) };
}

export type FinalizeParams = {
  sourceTable: string;
  sourceId: string;
  status?: string | null;
  title?: string | null;
  docNumber?: string | null;
  data: any;                 // { head, positions }
  summary: any;              // { net, vat, gross }
  printHtml?: string | null; // gespeicherter Druckstand
  withAudit?: boolean;
  auditDetail?: string;
  finalizedByName?: string | null; // Anzeigename des abschließenden Benutzers (für Historie)
  note?: string | null;            // optionale Änderungsnotiz
};

/** Anzeigename des Abschließenden aus dem Snapshot einer Version (für Historie). */
export function versionFinalizedBy(v: DocVersion): string | null {
  return (v.data && typeof v.data === "object" ? (v.data.finalizedByName as string | null) : null) ?? null;
}

/**
 * Robuste Auflösung des abschließenden Benutzers für die Anzeige in der Historie.
 * Auflösungs-Kette (damit ältere Versionen ohne Snapshot-Namen nicht „–" zeigen):
 *   1) data.finalizedByName (im Snapshot gespeicherter Anzeigename – neue Versionen)
 *   2) profiles[created_by]   (DB-Ersteller der Version → Name)
 *   3) audit_log.user_id      (finalize-Eintrag gleicher Versionsnummer → Name)
 *   4) "Unbekannt"            (nie leer/„–", wenn nichts ermittelbar ist)
 */
export function resolveVersionUser(
  v: DocVersion,
  ctx: { profiles?: Map<string, string>; audit?: AuditEntry[] },
): string {
  const direct = versionFinalizedBy(v);
  if (direct && direct.trim()) return direct.trim();

  const byCreated = v.created_by ? ctx.profiles?.get(v.created_by) : null;
  if (byCreated && byCreated.trim()) return byCreated.trim();

  const a = ctx.audit?.find((x) => x.action === "finalize" && x.version_no === v.version_no && !!x.user_id);
  const byAudit = a?.user_id ? ctx.profiles?.get(a.user_id) : null;
  if (byAudit && byAudit.trim()) return byAudit.trim();

  return "Unbekannt";
}

/** Map auth-user-id → Anzeigename (profiles). Für die Benutzer-Auflösung der Historie. */
export async function loadProfileNames(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const { data, error } = await supabase.from("profiles").select("id,name");
  if (error || !data) return m;
  for (const p of data as { id: string; name: string | null }[]) {
    if (p.id) m.set(p.id, p.name || "");
  }
  return m;
}
/** Optionale Änderungsnotiz einer Version. */
export function versionNote(v: DocVersion): string | null {
  return (v.data && typeof v.data === "object" ? (v.data.note as string | null) : null) ?? null;
}

/** Wiederaufnahme eines abgeschlossenen Dokuments zur Korrektur protokollieren. */
export async function logReopen(sourceTable: string, sourceId: string, detail?: string | null): Promise<void> {
  await logDocumentAudit(sourceTable, sourceId, "reopen", detail ?? "Korrekturversion: Dokument zur Bearbeitung entsperrt", null);
}

/**
 * Legt eine neue, unveränderliche Version an (V1, V2, …).
 * organization_id/created_by werden DB-seitig per Default gesetzt.
 */
export async function finalizeDocumentVersion(p: FinalizeParams): Promise<{ versionNo: number } | { error: string }> {
  const { data: rows, error: selErr } = await supabase
    .from("document_versions")
    .select("version_no")
    .eq("source_table", p.sourceTable)
    .eq("source_id", p.sourceId)
    .order("version_no", { ascending: false })
    .limit(1);
  if (selErr) return { error: selErr.message };
  const nextNo = ((rows?.[0]?.version_no as number | undefined) ?? 0) + 1;

  // Abschließenden Benutzer + optionale Notiz informativ im data-Snapshot ablegen
  // (created_by/finalized_at setzt die DB; der Anzeigename ist für die Historie praktisch).
  const dataWithMeta = {
    ...(p.data && typeof p.data === "object" ? p.data : { value: p.data ?? null }),
    finalizedByName: p.finalizedByName ?? null,
    note: p.note ?? null,
  };
  const { error } = await supabase.from("document_versions").insert({
    source_table: p.sourceTable, source_id: p.sourceId, version_no: nextNo,
    status: p.status ?? null, title: p.title ?? null, doc_number: p.docNumber ?? null,
    data: dataWithMeta, summary: p.summary ?? null, print_html: p.printHtml ?? null,
  });
  if (error) return { error: error.message };

  if (p.withAudit) {
    await logDocumentAudit(p.sourceTable, p.sourceId, "finalize", p.auditDetail ?? `Version ${nextNo} abgeschlossen`, nextNo);
  }

  // PDF der neuen Version im HINTERGRUND vorbereiten (fire-and-forget): das erste
  // „PDF ansehen" öffnet dann sofort aus dem persistenten Cache statt live über
  // PDFShift zu rendern. Fehler sind unkritisch – dann rendert das erste Öffnen.
  if (p.printHtml) {
    void prepareDocumentPdf({ sourceTable: p.sourceTable, sourceId: p.sourceId, versionNo: nextNo }, p.printHtml);
  }

  return { versionNo: nextNo };
}
