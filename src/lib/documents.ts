// ============================================================
// B4Y SuperAPP – Zentrale Dokumentenstruktur
// Dokumentarten (document_types) + Dokumente (documents, Uploads/E-Mails)
// sowie Aggregation mit Angeboten/Aufträgen/Rechnungen.
// ============================================================
import { supabase } from "./supabase";

export type DocumentType = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  sort_order: number;
  icon: string | null;
  is_active: boolean;
  allow_upload: boolean;
  allow_create: boolean;
  belongs_to_project: boolean;
  belongs_to_customer: boolean;
  belongs_to_employee: boolean;
  belongs_to_supplier: boolean;
  belongs_to_subcontractor: boolean;
  // Versionierung & Compliance (je Dokumenttyp einstellbar)
  is_accounting_relevant: boolean;
  is_tax_relevant: boolean;
  versioning_enabled: boolean;
  versioning_required: boolean;
  finalization_required: boolean;
  lock_finalized_versions: boolean;
  create_pdf_snapshot_on_finalize: boolean;
  audit_log_enabled: boolean;
  // Geschützter System-Dokumenttyp (Dokumentkette Angebot→Auftrag→Rechnung).
  // Darf nicht gelöscht werden; Name/Texte/Layout bleiben pro Mandant konfigurierbar.
  is_system: boolean;
  // Dokumentstruktur (Migr. 0084): positions = Leistungstabelle/Kalkulation;
  // text = Brief/Anschreiben (Rich-Text); form = Formular/Bericht (Editor folgt);
  // upload_only = nur Dateiablage. is_system-Typen bleiben 'positions'.
  document_structure: DocumentStructure;
  updated_at?: string | null;
};

export type DocumentStructure = "positions" | "text" | "form" | "upload_only";

/** Struktur-Helfer (zentral, keine Slug-Hardcodes außer is_system-Schutz an anderer Stelle). */
export const docStructure = (t: { document_structure?: string | null } | null | undefined): DocumentStructure =>
  ((t?.document_structure as DocumentStructure) ?? "upload_only");
export const isPositionDocumentType = (t: { document_structure?: string | null; is_system?: boolean } | null | undefined): boolean =>
  !!t && (t.is_system === true || docStructure(t) === "positions");
export const isTextDocumentType = (t: { document_structure?: string | null } | null | undefined): boolean => docStructure(t) === "text";
export const isFormDocumentType = (t: { document_structure?: string | null } | null | undefined): boolean => docStructure(t) === "form";
export const isUploadOnlyDocumentType = (t: { document_structure?: string | null } | null | undefined): boolean => docStructure(t) === "upload_only";

/** Slugs der nativen Dokumentkette → eigene Editoren statt generischer documents-Tabelle. */
export const CHAIN_SLUGS: Record<string, "offer" | "order" | "invoice" | "nachtrag"> = {
  angebote: "offer",
  angebot_nachtrag: "nachtrag",
  auftraege: "order",
  rechnungen: "invoice",
};

export type DocumentRow = {
  id: string;
  project_id: string | null;
  customer_id: string | null;
  document_type_id: string | null;
  document_number: string | null;
  title: string | null;
  subject: string | null;
  status: string;
  source_type: string;
  body_html: string | null;            // Textdokument-Inhalt (Migr. 0084)
  print_html_snapshot: string | null;  // eingefrorener Druckstand (Migr. 0084)
  file_url: string | null;
  file_name: string | null;
  file_mime_type: string | null;
  file_size: number | null;
  sender: string | null;
  recipient: string | null;
  version: string | null;
  doc_date: string | null;
  note: string | null;
  created_by: string | null;
  uploaded_by: string | null;
  sent_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export const DOC_TYPE_COLUMNS = "*";
export const DOC_COLUMNS = "*";

export const DOC_STATUS_LABEL: Record<string, string> = {
  entwurf: "Entwurf",
  abgeschlossen: "Abgeschlossen",
  versendet: "Versendet",
  erhalten: "Erhalten",
  unterschrieben: "Unterschrieben",
  archiviert: "Archiviert",
  storniert: "Storniert",
};
export const DOC_STATUS_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  entwurf: "slate",
  abgeschlossen: "amber",
  versendet: "blue",
  erhalten: "green",
  unterschrieben: "green",
  archiviert: "slate",
  storniert: "red",
};
export const docStatusLabel = (s: string) => DOC_STATUS_LABEL[s] ?? s;

// Slugs der „nativen" Dokumentarten (eigene Tabellen statt documents)
export const NATIVE_SLUGS = ["angebote", "auftraege", "rechnungen"] as const;

export const UPLOAD_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.heic,.eml,.msg,.zip,.dwg,.dxf,.txt";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function loadDocumentTypes(activeOnly = false): Promise<DocumentType[]> {
  let q = supabase.from("document_types").select(DOC_TYPE_COLUMNS).order("sort_order").order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data as DocumentType[]) ?? [];
}

// Generische Dokument-Untertypen (je Dokumententyp, frei erweiterbar)
export type DocumentSubtype = {
  id: string;
  document_type_id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
};

export async function loadDocumentSubtypes(activeOnly = false): Promise<DocumentSubtype[]> {
  let q = supabase.from("document_subtypes")
    .select("id,document_type_id,name,slug,sort_order,is_active")
    .order("sort_order").order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data as DocumentSubtype[]) ?? [];
}

export async function loadProjectDocuments(projectId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from("documents").select(DOC_COLUMNS)
    .eq("project_id", projectId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as DocumentRow[]) ?? [];
}

export type UploadInput = {
  projectId: string;
  customerId?: string | null;
  file: File;
  documentType: DocumentType;
  title?: string | null;
  subject?: string | null;
  status?: string;
  sourceType?: string;
  sender?: string | null;
  recipient?: string | null;
  version?: string | null;
  docDate?: string | null;
  note?: string | null;
  uploadedBy?: string | null;
};

/** Datei in Storage laden und Dokument-Datensatz anlegen. */
export async function uploadProjectDocument(inp: UploadInput): Promise<DocumentRow> {
  const ext = (inp.file.name.split(".").pop() || "bin").toLowerCase();
  const path = `projects/${inp.projectId}/documents/${inp.documentType.slug}/${uid()}.${ext}`;
  const up = await supabase.storage.from("project-files").upload(path, inp.file, {
    cacheControl: "3600", upsert: false, contentType: inp.file.type || undefined,
  });
  if (up.error) throw up.error;
  const fileUrl = supabase.storage.from("project-files").getPublicUrl(path).data.publicUrl;
  const isEmail = /\.(eml|msg)$/i.test(inp.file.name);
  const { data, error } = await supabase.from("documents").insert({
    project_id: inp.projectId,
    customer_id: inp.customerId ?? null,
    document_type_id: inp.documentType.id,
    title: inp.title || inp.file.name,
    subject: inp.subject || null,
    status: inp.status || "erhalten",
    source_type: inp.sourceType || (isEmail ? "uploaded_email" : "uploaded_file"),
    file_url: fileUrl,
    file_name: inp.file.name,
    file_mime_type: inp.file.type || null,
    file_size: inp.file.size ?? null,
    sender: inp.sender || null,
    recipient: inp.recipient || null,
    version: inp.version || null,
    doc_date: inp.docDate || null,
    note: inp.note || null,
    uploaded_by: inp.uploadedBy ?? null,
  }).select(DOC_COLUMNS).single();
  if (error) throw error;
  return data as DocumentRow;
}

/** Ein einzelnes Dokument (documents) laden – für den Textdokument-Editor. */
export async function loadDocument(id: string): Promise<DocumentRow | null> {
  const { data, error } = await supabase.from("documents").select(DOC_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as DocumentRow) ?? null;
}

/** Neues Textdokument (Brief/Anschreiben) im Projekt anlegen → liefert die neue ID. */
export async function createTextDocument(inp: {
  projectId: string; documentType: DocumentType; customerId?: string | null;
  title?: string | null; createdBy?: string | null;
}): Promise<DocumentRow> {
  const { data, error } = await supabase.from("documents").insert({
    project_id: inp.projectId,
    customer_id: inp.customerId ?? null,
    document_type_id: inp.documentType.id,
    title: inp.title || inp.documentType.name,
    status: "entwurf",
    source_type: "created_in_app",
    body_html: null,
    doc_date: new Date().toISOString().slice(0, 10),
    created_by: inp.createdBy ?? null,
    uploaded_by: inp.createdBy ?? null,
  }).select(DOC_COLUMNS).single();
  if (error) throw error;
  return data as DocumentRow;
}

// ── Formular / Bericht (document_structure = 'form') ──────────────────────────
// Strukturierte Felder werden als JSON im vorhandenen Feld `documents.body_html`
// gespeichert (keine eigene Spalte/Migration nötig – ein Dokument ist entweder
// 'text' ODER 'form', nie beides). Für das PDF werden die Felder zur Druckzeit in
// HTML gerendert und über die zentrale Text-Render-/Druck-Engine ausgegeben.
export type FormFieldType = "heading" | "text" | "textarea" | "date";
export type FormField = { id: string; label: string; type: FormFieldType; value: string };
export type FormDocData = { fields: FormField[] };

/** Parst den in body_html gespeicherten Formular-JSON robust (Fallback: leeres Formular). */
export function parseFormData(raw: string | null | undefined): FormDocData {
  try {
    const o = JSON.parse(raw || "");
    if (o && Array.isArray(o.fields)) {
      return {
        fields: (o.fields as any[])
          .filter((f) => f && typeof f === "object")
          .map((f) => ({
            id: String(f.id ?? Math.random().toString(36).slice(2)),
            label: String(f.label ?? ""),
            type: (["heading", "text", "textarea", "date"].includes(f.type) ? f.type : "text") as FormFieldType,
            value: String(f.value ?? ""),
          })),
      };
    }
  } catch { /* leeres Formular */ }
  return { fields: [] };
}

/** Neues Formular/Bericht-Dokument im Projekt anlegen → liefert die neue ID. */
export async function createFormDocument(inp: {
  projectId: string; documentType: DocumentType; customerId?: string | null;
  title?: string | null; createdBy?: string | null;
}): Promise<DocumentRow> {
  const { data, error } = await supabase.from("documents").insert({
    project_id: inp.projectId,
    customer_id: inp.customerId ?? null,
    document_type_id: inp.documentType.id,
    title: inp.title || inp.documentType.name,
    status: "entwurf",
    source_type: "created_in_app",
    body_html: JSON.stringify({ fields: [] } as FormDocData),
    doc_date: new Date().toISOString().slice(0, 10),
    created_by: inp.createdBy ?? null,
    uploaded_by: inp.createdBy ?? null,
  }).select(DOC_COLUMNS).single();
  if (error) throw error;
  return data as DocumentRow;
}

/** Textdokument-Felder speichern (Betreff/Empfänger/Datum/Inhalt/Status/Snapshot). */
export async function saveTextDocument(id: string, patch: {
  title?: string | null; subject?: string | null; recipient?: string | null;
  customer_id?: string | null; doc_date?: string | null; body_html?: string | null;
  status?: string; print_html_snapshot?: string | null; completed_at?: string | null;
}): Promise<{ error?: string }> {
  const { error } = await supabase.from("documents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error: error?.message };
}

/** Leichte .eml-Metadaten-Erkennung (Betreff/Absender/Datum) aus dem Dateitext. */
export async function parseEmlMeta(file: File): Promise<{ subject?: string; from?: string; date?: string }> {
  try {
    if (!/\.eml$/i.test(file.name)) return {};
    const text = (await file.text()).slice(0, 8000);
    const head = text.split(/\r?\n\r?\n/)[0] || text;
    const grab = (re: RegExp) => head.match(re)?.[1]?.trim();
    return {
      subject: grab(/^Subject:\s*(.+)$/im),
      from: grab(/^From:\s*(.+)$/im),
      date: grab(/^Date:\s*(.+)$/im),
    };
  } catch { return {}; }
}
