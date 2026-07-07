// ============================================================
// B4Y SuperAPP – Anfragen (Posteingang) – API-Client (Frontend)
// ------------------------------------------------------------
// Dünner Wrapper um die serverseitigen Endpunkte:
//   GET  /api/anfragen/list
//   GET  /api/anfragen/detail
//   POST /api/anfragen/create
//
// Auth-Muster (analog src/lib/ai.ts – chatAI):
//   - Supabase-Session via supabase.auth.getSession()
//   - access_token als "Authorization: Bearer <token>" mitgeben
//   - 401 → throw new Error("Nicht angemeldet")
//
// RLS / Mandantenfähigkeit greift serverseitig (User-Bearer wird im
// API-Handler 1:1 an PostgREST weitergereicht). Wir geben hier KEINE
// organization_id mit – die liefert der DB-Default current_org_id().
// ============================================================

import { supabase } from "./supabase";

// ── Typen (gespiegelt aus DB-Schema 0117/0118) ────────────────────────
export type AnfrageSource =
  | "phone_fonio"
  | "website_form"
  | "email"
  | "manual"
  | "instagram"
  | "facebook"
  | "whatsapp"
  | "other";

export type AnfrageStatus =
  | "neu"
  | "in_arbeit"
  | "qualifiziert"
  | "kontakt_erstellt"
  | "abgewiesen"
  | "archiviert";

export type AiClassification =
  | "interessent"
  | "kunde_bestand"
  | "spam"
  | "termine_anfrage"
  | "reklamation"
  | "info_only"
  | "rueckruf_gewuenscht"
  | "fehlanruf"
  | "sonstiges";

export type AiPriority = "hoch" | "mittel" | "niedrig";

export type CallDirection = "inbound" | "outbound";

export interface AnfrageRow {
  id: string;
  organization_id: string;
  source: AnfrageSource;
  source_ref: string | null;
  status: AnfrageStatus;
  assigned_to: string | null;

  caller_name: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  caller_address: string | null;

  subject: string | null;
  description: string | null;
  transcript: string | null;
  audio_url: string | null;

  duration_seconds: number | null;
  call_direction: CallDirection | null;
  call_started_at: string | null;
  call_ended_at: string | null;

  ai_summary: string | null;
  ai_classification: AiClassification | null;
  ai_priority: AiPriority | null;
  ai_extracted_data: Record<string, unknown>;

  related_contact_id: string | null;
  related_project_id: string | null;
  converted_to_contact_at: string | null;

  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type AnfrageEventType =
  | "created"
  | "status_changed"
  | "assigned"
  | "note"
  | "ai_classified"
  | "contact_linked"
  | "project_linked"
  | "converted"
  | "rejected"
  | "reopened"
  | "audio_played";

export interface AnfrageEvent {
  id: string;
  anfrage_id: string;
  created_by: string | null;
  event_type: AnfrageEventType;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

// ── Listen-/Detail-/Create-Payloads ───────────────────────────────────
export interface ListAnfragenOpts {
  status?: AnfrageStatus;
  source?: AnfrageSource;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListAnfragenResult {
  rows: AnfrageRow[];
  total_count: number;
}

export interface AnfrageDetailResult {
  anfrage: AnfrageRow;
  events: AnfrageEvent[];
}

export interface CreateAnfrageManualPayload {
  subject: string;
  description?: string;
  caller_name?: string;
  caller_phone?: string;
  caller_email?: string;
  caller_address?: string;
}

export interface CreateAnfrageResult {
  ok: true;
  id: string;
  created_at?: string | null;
}

// ── Auth-Helfer (analog src/lib/ai.ts) ────────────────────────────────
// Holt das aktuelle Access-Token; wirft "Nicht angemeldet", wenn keine
// Session vorhanden ist. Wird VOR jedem Fetch aufgerufen – die Edge-/
// Serverless-Function prüft das Token erneut serverseitig (verifyUser).
async function authHeaders(): Promise<HeadersInit> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Nicht angemeldet");
  return { Authorization: `Bearer ${token}` };
}

// ── Fetch-Helfer mit auto-Bearer + uniformer Fehlerbehandlung ─────────
// 401 → "Nicht angemeldet" (Session-Verlust kann zwischen authHeaders()
//       und Antwort passieren). 4xx/5xx → JSON-Error-Message (falls
//       vorhanden) oder generischer Fallback.
async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  const r = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  if (r.status === 401) throw new Error("Nicht angemeldet");
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) {
    const msg = (data && typeof data === "object" && "error" in data && data.error)
      ? String(data.error)
      : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Anfragen-Liste laden.
 * Status/Source/Suche werden serverseitig auf eine Whitelist validiert
 * (siehe api/anfragen/list.js) – unbekannte Werte werden ignoriert.
 */
export async function listAnfragen(opts: ListAnfragenOpts = {}): Promise<ListAnfragenResult> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set("status", opts.status);
  if (opts.source) qs.set("source", opts.source);
  if (opts.search && opts.search.trim()) qs.set("search", opts.search.trim());
  if (typeof opts.limit === "number" && Number.isFinite(opts.limit)) {
    qs.set("limit", String(Math.max(1, Math.floor(opts.limit))));
  }
  if (typeof opts.offset === "number" && Number.isFinite(opts.offset)) {
    qs.set("offset", String(Math.max(0, Math.floor(opts.offset))));
  }
  const url = qs.toString().length > 0
    ? `/api/anfragen/list?${qs.toString()}`
    : `/api/anfragen/list`;
  return await fetchJson<ListAnfragenResult>(url, { method: "GET" });
}

/**
 * Einzelne Anfrage + ihre Events laden.
 * 404 → "Anfrage nicht gefunden" (Existenz + RLS-Filter zusammengefasst).
 */
export async function getAnfrage(id: string): Promise<AnfrageDetailResult> {
  if (!id) throw new Error("Parameter 'id' ist erforderlich.");
  const url = `/api/anfragen/detail?id=${encodeURIComponent(id)}`;
  return await fetchJson<AnfrageDetailResult>(url, { method: "GET" });
}

/**
 * Manuelle Anfrage anlegen (source="manual", status="neu").
 * subject ist Pflicht – alles andere optional. Rate-Limit (serverseitig):
 * 30/min/User.
 */
export async function createAnfrageManual(
  payload: CreateAnfrageManualPayload,
): Promise<CreateAnfrageResult> {
  const subject = (payload.subject ?? "").trim();
  if (!subject) throw new Error("Feld 'subject' ist erforderlich.");
  const body: CreateAnfrageManualPayload = {
    subject,
    description: payload.description?.trim() || undefined,
    caller_name: payload.caller_name?.trim() || undefined,
    caller_phone: payload.caller_phone?.trim() || undefined,
    caller_email: payload.caller_email?.trim() || undefined,
    caller_address: payload.caller_address?.trim() || undefined,
  };
  return await fetchJson<CreateAnfrageResult>(`/api/anfragen/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── KI-Enrichment (manueller Trigger aus der UI) ──────────────────────
export interface EnrichResult {
  ok: true;
  classification: AiClassification | null;
  priority: AiPriority | null;
  summary: string | null;
  subject: string | null;
  skipped?: string;
}

/**
 * Loest die KI-Klassifizierung einer bestehenden Anfrage erneut aus.
 * Wird automatisch vom Fonio-Webhook getriggert (fire-and-forget) –
 * dieser Aufruf hier ist der manuelle "Re-Enrich"-Button in der UI.
 */
export async function enrichAnfrage(id: string): Promise<EnrichResult> {
  if (!id) throw new Error("Parameter 'id' ist erforderlich.");
  return await fetchJson<EnrichResult>(`/api/anfragen/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

// ── Convert: Anfrage → Kontakt ────────────────────────────────────────
export type ContactType = "kunde" | "lieferant" | "subunternehmer";
export type CustomerType = "privat" | "firma";
export type Salutation = "herr" | "frau";

export interface ConvertAnfragePayload {
  anfrage_id: string;
  type?: ContactType;
  customer_type?: CustomerType;
  salutation?: Salutation | null;
  first_name?: string;
  last_name?: string;
  company?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  notes?: string;
}

export interface ConvertAnfrageResult {
  ok: true;
  contact_id: string;
  contact_number: string | null;
}

/**
 * Wandelt eine Anfrage in einen Kontakt um:
 *   1. Insert in contacts (mit contact_number aus Nummernkreis "kunde")
 *   2. Update anfragen.related_contact_id + status="kontakt_erstellt"
 *   3. Audit-Events "contact_linked" + "converted"
 *
 * Bei "ist bereits konvertiert" wirft 409 → "Diese Anfrage ist bereits …".
 */
export async function convertAnfrageToContact(
  payload: ConvertAnfragePayload,
): Promise<ConvertAnfrageResult> {
  if (!payload.anfrage_id) {
    throw new Error("Parameter 'anfrage_id' ist erforderlich.");
  }
  return await fetchJson<ConvertAnfrageResult>(`/api/anfragen/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
