// ============================================================
// Installateur SuperAPP – Buchhaltung (Eingangsrechnungen) – Client-Lib
// ------------------------------------------------------------
// Datenzugriff für das Buchhaltungsmodul:
//   • Eingangsrechnungen (public.eingangsrechnungen) – Lieferantenrechnungen,
//     manuell ODER automatisch aus dem smarten KI-Postfach.
//   • Offene Posten (unbezahlte AUSGANGSrechnungen aus public.invoices).
//   • Belege (Bucket 'belege', privat, org-isoliert) – Upload + signierte URL.
//
// Zugriff läuft über den supabase-Client mit User-JWT; RLS erzwingt die
// Mandantentrennung (organization_id = current_org_id()). Belege liegen unter
// "<organization_id>/eingangsrechnungen/<id>/..." (Storage-Policy 0142).
// ============================================================
import { supabase } from "./supabase";
import { signedUrl } from "./storage";
import type { Tone } from "../components/ui";

// ── Typen ─────────────────────────────────────────────────────────────
export type EingangsrechnungStatus =
  | "offen"
  | "geprueft"
  | "freigegeben"
  | "bezahlt"
  | "storniert";

export interface Beleg {
  path: string;
  filename: string;
  content_type?: string | null;
  size?: number | null;
  uploaded_at?: string | null;
}

export interface Eingangsrechnung {
  id: string;
  organization_id: string;
  supplier_contact_id: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  received_date: string | null;
  net: number | null;
  vat: number | null;
  gross: number | null;
  vat_rate: number | null;
  currency: string;
  status: EingangsrechnungStatus;
  paid_at: string | null;
  payment_reference: string | null;
  iban: string | null;
  category: string | null;
  project_id: string | null;
  notes: string | null;
  source: "manual" | "email";
  incoming_mail_id: string | null;
  ai_extracted_data: Record<string, unknown>;
  belege: Beleg[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const EINGANG_STATUS_LABEL: Record<EingangsrechnungStatus, string> = {
  offen: "Offen",
  geprueft: "Geprüft",
  freigegeben: "Freigegeben",
  bezahlt: "Bezahlt",
  storniert: "Storniert",
};

export const EINGANG_STATUS_TONE: Record<EingangsrechnungStatus, Tone> = {
  offen: "amber",
  geprueft: "blue",
  freigegeben: "blue",
  bezahlt: "green",
  storniert: "slate",
};

/** True, wenn eine (nicht bezahlte/stornierte) Rechnung überfällig ist. */
export function isOverdue(er: Pick<Eingangsrechnung, "status" | "due_date">): boolean {
  if (er.status === "bezahlt" || er.status === "storniert") return false;
  if (!er.due_date) return false;
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return new Date(er.due_date).getTime() < t;
}

// ── Eingangsrechnungen: CRUD ──────────────────────────────────────────
export async function listEingangsrechnungen(): Promise<Eingangsrechnung[]> {
  const { data, error } = await supabase
    .from("eingangsrechnungen")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Eingangsrechnung[]) ?? [];
}

export async function getEingangsrechnung(id: string): Promise<Eingangsrechnung | null> {
  const { data, error } = await supabase
    .from("eingangsrechnungen")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Eingangsrechnung) ?? null;
}

export type EingangsrechnungInput = Partial<
  Pick<
    Eingangsrechnung,
    | "supplier_contact_id" | "supplier_name" | "invoice_number" | "invoice_date"
    | "due_date" | "received_date" | "net" | "vat" | "gross" | "vat_rate"
    | "currency" | "status" | "paid_at" | "payment_reference" | "iban"
    | "category" | "project_id" | "notes"
  >
>;

export async function createEingangsrechnung(input: EingangsrechnungInput): Promise<string> {
  const { data, error } = await supabase
    .from("eingangsrechnungen")
    .insert({ ...input, source: "manual" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateEingangsrechnung(id: string, patch: EingangsrechnungInput): Promise<void> {
  const { error } = await supabase.from("eingangsrechnungen").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteEingangsrechnung(id: string): Promise<void> {
  const { error } = await supabase.from("eingangsrechnungen").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Belege (Bucket 'belege') ──────────────────────────────────────────
const BELEGE_BUCKET = "belege";

// Muss zur Bucket-Allowlist (Migration 0142) passen.
export const ALLOWED_BELEG_MIME = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
] as const;
/** accept-Attribut für Datei-Inputs (deckt sich mit der Bucket-Allowlist). */
export const BELEG_ACCEPT = ALLOWED_BELEG_MIME.join(",");
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
};

function safeFileName(n: string): string {
  return (
    String(n || "beleg")
      .replace(/[/\\]/g, "_")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 120) || "beleg"
  );
}

/** Erlaubten Content-Type ermitteln (aus file.type oder Endung). null = nicht erlaubt. */
function resolveBelegContentType(file: File): string | null {
  const ct = String(file.type || "").toLowerCase().split(";")[0].trim();
  if ((ALLOWED_BELEG_MIME as readonly string[]).includes(ct)) return ct;
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext && EXT_MIME[ext] ? EXT_MIME[ext] : null;
}

/** Signierte URL eines Belegs (1 h). Leerer String bei Fehler (nie ein roher Pfad). */
export async function belegUrl(beleg: Beleg): Promise<string> {
  const u = await signedUrl(BELEGE_BUCKET, beleg.path);
  return /^https?:\/\//i.test(u) ? u : "";
}

/**
 * Lädt eine Beleg-Datei hoch (client-seitig, RLS). Pfad org-isoliert:
 * "<orgId>/eingangsrechnungen/<erId>/<ts>-<name>". Prüft den Dateityp vorab
 * gegen die Bucket-Allowlist (sprechende Fehlermeldung statt Storage-400).
 */
export async function uploadBeleg(erId: string, file: File): Promise<Beleg> {
  const contentType = resolveBelegContentType(file);
  if (!contentType) {
    throw new Error("Dateityp nicht erlaubt. Bitte PDF oder Bild (JPG, PNG, WEBP, HEIC) hochladen.");
  }
  const { data: orgId, error: orgErr } = await supabase.rpc("current_org_id");
  if (orgErr || !orgId) throw new Error("Organisation konnte nicht ermittelt werden.");
  const path = `${orgId}/eingangsrechnungen/${erId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(BELEGE_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  return {
    path,
    filename: file.name,
    content_type: contentType,
    size: file.size,
    uploaded_at: new Date().toISOString(),
  };
}

/** Hängt einen hochgeladenen Beleg an die Eingangsrechnung an (jsonb). */
export async function addBelegToInvoice(er: Eingangsrechnung, beleg: Beleg): Promise<Beleg[]> {
  const next = [...(er.belege ?? []), beleg];
  const { error } = await supabase.from("eingangsrechnungen").update({ belege: next }).eq("id", er.id);
  if (error) throw new Error(error.message);
  return next;
}

/**
 * Entfernt einen Beleg (Storage-Objekt + jsonb-Eintrag). Schlägt die
 * Storage-Löschung fehl, bleibt der jsonb-Eintrag erhalten (Konsistenz:
 * keine verwaisten Objekte durch verschluckte Fehler). Supabase `.remove`
 * ist idempotent – ein bereits fehlendes Objekt ist KEIN Fehler.
 */
export async function removeBeleg(er: Eingangsrechnung, beleg: Beleg): Promise<Beleg[]> {
  const { error: rmErr } = await supabase.storage.from(BELEGE_BUCKET).remove([beleg.path]);
  if (rmErr) throw new Error(`Beleg-Datei konnte nicht gelöscht werden: ${rmErr.message}`);
  const next = (er.belege ?? []).filter((b) => b.path !== beleg.path);
  const { error } = await supabase.from("eingangsrechnungen").update({ belege: next }).eq("id", er.id);
  if (error) throw new Error(error.message);
  return next;
}

// ── Offene Posten (unbezahlte AUSGANGSrechnungen) ─────────────────────
export interface OpenPosten {
  id: string;
  number: string | null;
  title: string | null;
  gross: number | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_status: string;
  doc_status: string;
  customer_name: string;
  overdue: boolean;
}

interface InvoiceRow {
  id: string;
  number: string | null;
  title: string | null;
  gross: number | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_status: string;
  doc_status: string;
  locked: boolean;
  contact: {
    company: string | null;
    first_name: string | null;
    last_name: string | null;
    customer_type: string | null;
  } | null;
}

function customerName(c: InvoiceRow["contact"]): string {
  if (!c) return "–";
  if (c.customer_type === "firma") return c.company || "Firma";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "Kunde";
}

/**
 * Offene Posten = finalisierte, nicht stornierte, nicht bezahlte
 * Ausgangsrechnungen (kanonischer Filter aus Dashboard/Cockpit:
 * locked=true, doc_status<>'storniert', payment_status<>'bezahlt',
 * deleted_at IS NULL). Überfällig = zusätzlich due_date < heute.
 */
export async function listOpenPosten(): Promise<OpenPosten[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id,number,title,gross,invoice_date,due_date,payment_status,doc_status,locked," +
        "contact:contacts(company,first_name,last_name,customer_type)",
    )
    .is("deleted_at", null)
    .eq("locked", true)
    .neq("doc_status", "storniert")
    .neq("payment_status", "bezahlt")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);

  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return ((data as unknown as InvoiceRow[]) ?? []).map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    gross: r.gross,
    invoice_date: r.invoice_date,
    due_date: r.due_date,
    payment_status: r.payment_status,
    doc_status: r.doc_status,
    customer_name: customerName(r.contact),
    overdue: !!r.due_date && new Date(r.due_date).getTime() < t,
  }));
}
