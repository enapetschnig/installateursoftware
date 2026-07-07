// ============================================================
// B4Y SuperAPP – Microsoft Mail – API-Client (Frontend)
// ------------------------------------------------------------
// Duenner Wrapper um die serverseitigen Endpunkte:
//   GET  /api/microsoft/mail-list
//   GET  /api/microsoft/mail-detail
//   POST /api/microsoft/mail-send
//   GET  /api/microsoft/mail-attachment
//
// Auth-Muster analog src/lib/anfragen.ts:
//   - Supabase-Session via supabase.auth.getSession()
//   - access_token als "Authorization: Bearer <token>" mitgeben
//   - 401 → throw new Error("Nicht angemeldet")
//
// Die Response-Shapes spiegeln exakt die Backend-Handler in
// api/microsoft/mail-*.js. Aenderungen dort muessen hier
// nachgezogen werden.
// ============================================================

import { supabase } from "../supabase";

// ── Basistypen ────────────────────────────────────────────────────────
export type MailFolder = "inbox" | "sent" | "drafts";

/** Wohldefinierte Graph-Ordner, die der Backend-Handler akzeptiert. */
const FOLDER_TO_GRAPH: Record<MailFolder, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
};

// ── Listen-Response ───────────────────────────────────────────────────
export interface MailListItem {
  id: string;
  subject: string | null;
  from: { emailAddress: { name?: string; address: string } };
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  bodyPreview: string;
  importance: "low" | "normal" | "high";
}

export interface MailListResult {
  messages: MailListItem[];
  nextLink: string | null;
  total: number | null;
}

// ── Detail-Response (spiegelt mapMessage() in mail-detail.js) ─────────
export interface MailEmailAddress {
  name?: string | null;
  address?: string | null;
}

export interface MailRecipient {
  emailAddress: MailEmailAddress;
}

export interface MailAttachmentMeta {
  id: string;
  name: string;
  size: number;
  contentType: string | null;
  isInline: boolean;
}

export interface MailBody {
  contentType: "html" | "text";
  content: string;
}

export interface MailDetail {
  id: string;
  subject: string;
  from: MailRecipient | null;
  toRecipients: MailRecipient[];
  ccRecipients: MailRecipient[];
  bccRecipients: MailRecipient[];
  receivedDateTime: string | null;
  sentDateTime: string | null;
  isRead: boolean;
  hasAttachments: boolean;
  importance: "low" | "normal" | "high";
  conversationId: string | null;
  body: MailBody;
  attachments: MailAttachmentMeta[];
}

// ── Send-Payload ──────────────────────────────────────────────────────
export interface Recipient {
  name?: string;
  address: string;
}

export interface MailAttachment {
  name: string;
  mime: string;
  base64: string;
}

export type MailDocumentKind = "offer" | "order" | "invoice";

export interface MailDocumentContext {
  kind: MailDocumentKind;
  id: string;
}

export interface SendMailPayload {
  to: Recipient[];
  cc?: Recipient[];
  bcc?: Recipient[];
  subject: string;
  html: string;
  attachments?: MailAttachment[];
  /** Graph-Message-ID – aktiviert /reply-Pfad im Backend. */
  inReplyTo?: string;
  documentContext?: MailDocumentContext;
}

export interface SendMailResult {
  ok: true;
  sentAt: string;
}

// ── Listen-Optionen ───────────────────────────────────────────────────
export interface ListMailOpts {
  top?: number;
  skip?: number;
  folder?: MailFolder;
  search?: string;
}

/**
 * Erweiterte Optionen fuer den paginierten Fetch (siehe fetchMailList()):
 * unterstuetzt AbortSignal + nextLink (Fortsetzung einer Server-Response).
 * Wenn `nextLink` gesetzt ist, wird die URL 1:1 verwendet – folder/search/top
 * werden aus der URL uebernommen und nicht neu gesetzt.
 */
export interface FetchMailListOpts {
  top?: number;
  skip?: number;
  /**
   * "inbox"|"sent"|"drafts" oder bereits ein Graph-Wellknown-Name
   * ("sentitems", "deleteditems", …). Unbekannte Werte klemmt das
   * Backend defensiv auf "inbox".
   */
  folder?: MailFolder | string;
  search?: string;
  nextLink?: string | null;
  signal?: AbortSignal;
}

export interface FetchMailDetailOpts {
  signal?: AbortSignal;
}

// ── Auth-Helfer (identisch zu src/lib/anfragen.ts) ────────────────────
async function authHeaders(): Promise<HeadersInit> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Nicht angemeldet");
  return { Authorization: `Bearer ${token}` };
}

// ── Fetch-Helfer mit auto-Bearer + uniformer Fehlerbehandlung ─────────
async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  const r = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  if (r.status === 401) throw new Error("Nicht angemeldet");
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && data.error
        ? String(data.error)
        : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Wandelt einen Ordner-Namen aus dem UI-Vokabular ("inbox"|"sent"|"drafts")
 * in einen Graph-Wellknown-Name um. Akzeptiert auch bereits gemappte Werte
 * ("sentitems") und laesst diese unveraendert.
 */
function resolveFolder(folder: string | undefined): string | null {
  if (!folder) return null;
  if (folder in FOLDER_TO_GRAPH) {
    return FOLDER_TO_GRAPH[folder as MailFolder];
  }
  return folder;
}

/**
 * Extrahiert `$skip`/`$skiptoken` aus einem Graph-nextLink. Wir koennen die
 * absolute Graph-URL nicht direkt aus dem Browser aufrufen (kein CORS +
 * Klartext-Token wuerde ans Frontend geraten), also uebersetzen wir sie in
 * einen erneuten Aufruf des eigenen Proxies mit derselben `skip`-Position.
 */
function parseSkipFromNextLink(nextLink: string): number | null {
  try {
    const url = new URL(nextLink);
    const skip = url.searchParams.get("$skip");
    if (skip && /^\d+$/.test(skip)) return Number.parseInt(skip, 10);
  } catch {
    /* invalid URL – ignorieren */
  }
  return null;
}

/**
 * Mail-Liste laden.
 * - `folder`: "inbox" | "sent" | "drafts" (Default "inbox"). Wird auf die
 *   Graph-Wellknown-Names abgebildet (sent → sentitems).
 * - `top`: 1..100 (Backend klemmt, Default 25).
 * - `skip`: Offset ab 0.
 * - `search`: Volltext (Backend baut $filter mit contains()).
 */
export async function listMail(opts: ListMailOpts = {}): Promise<MailListResult> {
  const qs = new URLSearchParams();
  if (typeof opts.top === "number" && Number.isFinite(opts.top)) {
    qs.set("top", String(Math.max(1, Math.min(100, Math.floor(opts.top)))));
  }
  if (typeof opts.skip === "number" && Number.isFinite(opts.skip)) {
    qs.set("skip", String(Math.max(0, Math.floor(opts.skip))));
  }
  const folderName = resolveFolder(opts.folder);
  if (folderName) qs.set("folder", folderName);
  if (opts.search && opts.search.trim()) {
    qs.set("search", opts.search.trim());
  }
  const url = qs.toString().length > 0
    ? `/api/microsoft/mail-list?${qs.toString()}`
    : `/api/microsoft/mail-list`;
  return await fetchJson<MailListResult>(url, { method: "GET" });
}

/**
 * Erweiterte Variante von listMail() mit AbortSignal- und nextLink-Support.
 * Wird von useMailList() (Hook) genutzt.
 *
 * Verhalten:
 *   - `nextLink` gesetzt → skip wird aus dem Graph-nextLink extrahiert und
 *     mit denselben folder/search/top-Werten neu angefragt.
 *   - `signal` wird durchgereicht, damit React-StrictMode/AbortController
 *     unnoetige Requests abbrechen kann.
 */
export async function fetchMailList(
  opts: FetchMailListOpts = {},
): Promise<MailListResult> {
  const { nextLink, signal, ...rest } = opts;
  const effective: Omit<FetchMailListOpts, "nextLink" | "signal"> = { ...rest };
  if (nextLink) {
    const skip = parseSkipFromNextLink(nextLink);
    if (skip !== null) effective.skip = skip;
  }

  const qs = new URLSearchParams();
  if (typeof effective.top === "number" && Number.isFinite(effective.top)) {
    qs.set(
      "top",
      String(Math.max(1, Math.min(100, Math.floor(effective.top)))),
    );
  }
  if (typeof effective.skip === "number" && Number.isFinite(effective.skip)) {
    qs.set("skip", String(Math.max(0, Math.floor(effective.skip))));
  }
  const folderName = resolveFolder(effective.folder);
  if (folderName) qs.set("folder", folderName);
  if (effective.search && effective.search.trim()) {
    qs.set("search", effective.search.trim());
  }

  const url =
    qs.toString().length > 0
      ? `/api/microsoft/mail-list?${qs.toString()}`
      : `/api/microsoft/mail-list`;
  return await fetchJson<MailListResult>(url, { method: "GET", signal });
}

/**
 * Einzelne Mail inklusive Body + Attachment-Metadaten laden.
 * 404 → "Nachricht nicht gefunden" (Existenz + RLS/Graph-Filter kombiniert).
 */
export async function getMail(id: string): Promise<MailDetail> {
  if (!id) throw new Error("Parameter 'id' ist erforderlich.");
  const url = `/api/microsoft/mail-detail?id=${encodeURIComponent(id)}`;
  return await fetchJson<MailDetail>(url, { method: "GET" });
}

/**
 * Alias fuer getMail() mit AbortSignal-Support. Wird von useMailDetail()
 * (Hook) genutzt, damit ein Modal-Close pending Requests abbrechen kann.
 */
export async function fetchMailDetail(
  id: string,
  opts: FetchMailDetailOpts = {},
): Promise<MailDetail> {
  if (!id) throw new Error("Parameter 'id' ist erforderlich.");
  const url = `/api/microsoft/mail-detail?id=${encodeURIComponent(id)}`;
  return await fetchJson<MailDetail>(url, {
    method: "GET",
    signal: opts.signal,
  });
}

/**
 * Mail senden – oder als Reply, wenn `inReplyTo` gesetzt ist.
 * - Attachments im Reply-Pfad lehnt das Backend ab (MVP).
 * - Rate-Limit serverseitig: 30 Sends / Stunde / User.
 */
export async function sendMail(payload: SendMailPayload): Promise<SendMailResult> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload fehlt.");
  }
  const subject = (payload.subject ?? "").trim();
  if (!subject) throw new Error("Feld 'subject' ist erforderlich.");
  const html = typeof payload.html === "string" ? payload.html : "";
  if (!html.trim()) throw new Error("Feld 'html' ist erforderlich.");
  if (!Array.isArray(payload.to) || payload.to.length === 0) {
    throw new Error("Mindestens ein 'to'-Empfaenger erforderlich.");
  }
  const body: SendMailPayload = {
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject,
    html,
    attachments: payload.attachments,
    inReplyTo: payload.inReplyTo,
    documentContext: payload.documentContext,
  };
  return await fetchJson<SendMailResult>(`/api/microsoft/mail-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Attachments ────────────────────────────────────────────────────────
//
// Der Attachment-Endpoint braucht einen Bearer-Token – ein direktes
// <a href> reicht also nicht. Wir bauen eine URL (fuer QA/Debug-Logs)
// UND stellen einen fetchAttachment()-Helfer bereit, der die Datei via
// XHR/fetch mit Bearer laedt. Das Ergebnis kann per URL.createObjectURL
// im Browser angezeigt oder heruntergeladen werden.

/**
 * Erzeugt die relative URL zum Attachment-Endpoint. NICHT direkt in einem
 * <a href> verwendbar (Bearer fehlt) – vor allem fuer Logs / QA nuetzlich.
 * Der aufrufende Code sollte `fetchAttachment()` verwenden und aus dem
 * Blob eine ObjectURL erstellen.
 */
export function attachmentDownloadUrl(
  messageId: string,
  attachmentId: string,
  mode: "download" | "inline" = "download",
): string {
  const qs = new URLSearchParams();
  qs.set("messageId", messageId);
  qs.set("attachmentId", attachmentId);
  qs.set("mode", mode === "inline" ? "inline" : "download");
  return `/api/microsoft/mail-attachment?${qs.toString()}`;
}

/**
 * Laedt einen Anhang als Blob (inkl. Bearer). Wirft "Nicht angemeldet"
 * bei 401 und weitere Backend-Fehler mit dem JSON-error-Feld als Message.
 */
export async function fetchAttachment(
  messageId: string,
  attachmentId: string,
  mode: "download" | "inline" = "download",
): Promise<Blob> {
  if (!messageId) throw new Error("Parameter 'messageId' ist erforderlich.");
  if (!attachmentId) throw new Error("Parameter 'attachmentId' ist erforderlich.");
  const headers = await authHeaders();
  const url = attachmentDownloadUrl(messageId, attachmentId, mode);
  const r = await fetch(url, { method: "GET", headers });
  if (r.status === 401) throw new Error("Nicht angemeldet");
  if (!r.ok) {
    // Fehler-Payload ist JSON ({ error: "..." }); der Attachment-Erfolgspfad
    // liefert dagegen den Datei-Bytestream mit Content-Type des Anhangs.
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j && typeof j === "object" && "error" in j && (j as { error: unknown }).error) {
        msg = String((j as { error: unknown }).error);
      }
    } catch {
      /* Response war kein JSON – Fallback bleibt HTTP <code> */
    }
    throw new Error(msg);
  }
  return await r.blob();
}
