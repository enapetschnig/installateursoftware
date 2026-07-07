// ============================================================
// B4Y SuperAPP – Microsoft Graph Mail Send
// ------------------------------------------------------------
// POST /api/microsoft/mail-send
//
// Sendet eine E-Mail via Microsoft-Graph (/me/sendMail) mit dem
// verbundenen Microsoft-365-Konto des eingeloggten Users. Schreibt
// nach jedem Sende-Versuch (Erfolg oder Fehler) einen Audit-Log-
// Eintrag nach `microsoft_mail_audit_log`.
//
// Body (JSON):
//   {
//     to:            [{name?, address}],           // Pflicht, min 1
//     cc?:           [{name?, address}],
//     bcc?:          [{name?, address}],
//     subject:       string,                       // Pflicht
//     html:          string,                       // HTML-Body, Pflicht
//     attachments?:  [{name, mime, base64}],       // Optional
//     inReplyTo?:    string,                       // Graph message-id → /reply
//     documentContext?: {
//       kind: "offer" | "order" | "invoice",
//       id:   <uuid>
//     }
//   }
//
// Response:
//   200 { ok: true, sentAt }        – Mail wurde an Graph uebergeben.
//   400 – Validierung fehlgeschlagen
//   401 – nicht angemeldet
//   404 – kein Microsoft-Konto verbunden / keine Organisation
//   429 – Rate-Limit ueberschritten (30/Stunde/User)
//   502 – Graph-Fehler
//   500 – Interner Fehler
//
// Sicherheit / Konventionen:
//   • Token liegen verschluesselt in `microsoft_oauth_tokens`; der Klartext
//     verlaesst NIE die Server-Runtime (kein Logging, kein Response-Body).
//   • Audit-Log-Insert nutzt Service-Role (RLS-Kontext ist im Handler nicht
//     unbedingt derselbe wie das aktive Org des Users – wir setzen org_id
//     explizit, siehe memberships-Lookup unten).
//   • Rate-Limit: 30 Sende-Vorgaenge / Stunde / User (in-memory, pro Instanz).
//   • Reply-Pfad (`inReplyTo`) nutzt POST /me/messages/{id}/reply mit
//     `comment` (HTML) – Threading-Erhalt via conversationId. Attachments
//     werden im Reply-Pfad NICHT unterstuetzt (das Graph-API verlangt
//     hierfuer ein 3-Schritt-Flow: createReply → update → send; im MVP
//     bewusst rausgehalten; wird als 400 zurueckgewiesen).
//   • Max 50 Empfaenger insgesamt (to+cc+bcc); jeder Attachment <=4 MB,
//     Summe <=25 MB – Graph selbst erlaubt bis 4 MB pro Datei ohne
//     Upload-Session; groessere Attachments sind ausserhalb MVP.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { bearerFromRequest, verifyUser, checkRateLimit } from "../_lib/security.js";
import { getGraphAccessToken } from "../_lib/microsoft-graph.js";
import { logSafe } from "../_lib/safe-log.js";

export const config = { maxDuration: 30 };

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 3_600_000;

const MAX_RECIPIENTS_TOTAL = 50;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4 MB pro Datei
const MAX_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB gesamt
const MAX_SUBJECT_LEN = 998; // RFC 5322 header-line hard limit
const MAX_HTML_BYTES = 1 * 1024 * 1024; // 1 MB HTML-Body – reicht auch fuer Angebote mit inline Text
const BODY_PREVIEW_MAX = 500;

const EMAIL_RE = /.+@.+\..+/;
const ALLOWED_DOC_KINDS = new Set(["offer", "order", "invoice"]);

// ── Supabase-Admin-Singleton (Service-Role, fuer Memberships + Audit-Log)
let _adminSingleton = null;
function getAdminClient() {
  if (_adminSingleton) return _adminSingleton;
  const url = process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY fehlt – mail-send benoetigt Service-Role fuer Audit-Log."
    );
  }
  _adminSingleton = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminSingleton;
}

// ── Body-Parsing (Vercel liefert je nach Content-Type mal Objekt, mal String)
function parseBody(req) {
  if (req.body == null) return null;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  if (typeof req.body === "object") return req.body;
  return null;
}

// ── Empfaenger-Normalisierung + Validierung
function normalizeRecipients(list) {
  if (list == null) return { list: [], invalid: null };
  if (!Array.isArray(list)) return { list: [], invalid: "not_array" };
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") return { list: [], invalid: "entry_not_object" };
    const address = typeof raw.address === "string" ? raw.address.trim() : "";
    if (!address) return { list: [], invalid: "missing_address" };
    if (!EMAIL_RE.test(address)) return { list: [], invalid: `invalid_email:${address}` };
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 200) : "";
    out.push(name ? { name, address } : { address });
  }
  return { list: out, invalid: null };
}

function toGraphRecipients(list) {
  return list.map((r) =>
    r.name
      ? { emailAddress: { name: r.name, address: r.address } }
      : { emailAddress: { address: r.address } }
  );
}

// ── Attachment-Validierung (base64 → byte length ohne Decoding-Cost)
function base64ByteLength(b64) {
  if (typeof b64 !== "string" || b64.length === 0) return 0;
  const s = b64.replace(/\s+/g, "");
  // Padding zaehlen: jedes "=" ist ein fehlendes byte am Ende.
  let pad = 0;
  if (s.endsWith("==")) pad = 2;
  else if (s.endsWith("=")) pad = 1;
  return Math.floor((s.length * 3) / 4) - pad;
}

function validateAttachments(attachments) {
  if (attachments == null) return { list: [], invalid: null };
  if (!Array.isArray(attachments)) return { list: [], invalid: "attachments_not_array" };
  const out = [];
  let total = 0;
  for (const a of attachments) {
    if (!a || typeof a !== "object") return { list: [], invalid: "attachment_not_object" };
    const name = typeof a.name === "string" ? a.name.trim() : "";
    const mime = typeof a.mime === "string" ? a.mime.trim() : "";
    const base64 = typeof a.base64 === "string" ? a.base64 : "";
    if (!name || !mime || !base64) return { list: [], invalid: "attachment_incomplete" };
    // Grobe Base64-Sanity: nur base64-Zeichen (inkl. Padding + Whitespace).
    if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
      return { list: [], invalid: "attachment_not_base64" };
    }
    const size = base64ByteLength(base64);
    if (size <= 0) return { list: [], invalid: "attachment_empty" };
    if (size > MAX_ATTACHMENT_BYTES) {
      return { list: [], invalid: `attachment_too_large:${name}` };
    }
    total += size;
    if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
      return { list: [], invalid: "attachments_total_too_large" };
    }
    out.push({ name: name.slice(0, 250), mime: mime.slice(0, 200), base64: base64.replace(/\s+/g, "") });
  }
  return { list: out, invalid: null };
}

// ── HTML → Preview (max 500 Zeichen, Tags gestrippt, whitespace normalisiert)
function makeBodyPreview(html) {
  if (typeof html !== "string" || !html) return null;
  const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return null;
  return stripped.slice(0, BODY_PREVIEW_MAX);
}

// ── Memberships → aktive org_id fuer den User
async function loadOrgId(admin, userId) {
  const { data, error } = await admin
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`memberships read failed: ${error.message || String(error)}`);
  }
  return data?.organization_id || null;
}

// ── Audit-Log Insert (best-effort, Fehler werden nur geloggt)
async function insertAudit(admin, row) {
  try {
    const { error } = await admin.from("microsoft_mail_audit_log").insert(row);
    if (error) {
      logSafe({
        userId: row.user_id,
        action: "ms.mail.audit_insert",
        status: "error",
        error: error.message || String(error),
      });
    }
  } catch (e) {
    logSafe({
      userId: row.user_id,
      action: "ms.mail.audit_insert",
      status: "error",
      error: e?.message || String(e),
    });
  }
}

// ── Graph-Message aus Body-Parametern bauen (ohne inReplyTo)
function buildGraphMessage({ subject, html, toList, ccList, bccList, attachments }) {
  const message = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: toGraphRecipients(toList),
  };
  if (ccList.length > 0) message.ccRecipients = toGraphRecipients(ccList);
  if (bccList.length > 0) message.bccRecipients = toGraphRecipients(bccList);
  if (attachments.length > 0) {
    message.attachments = attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.mime,
      contentBytes: a.base64,
    }));
  }
  return message;
}

// ── Header-Location extrahieren (best-effort microsoft_message_id).
//    Graph liefert bei /reply meistens keine Location, bei /sendMail ebenfalls nicht;
//    wir extrahieren defensiv fuer den Fall dass der Header doch mal da ist.
function extractMessageIdFromResponse(resp) {
  try {
    const loc =
      resp.headers && typeof resp.headers.get === "function"
        ? resp.headers.get("location") || resp.headers.get("Location")
        : null;
    if (!loc) return null;
    // Format: /v1.0/users/{id}/messages/{message-id}
    const m = /messages\/([^/?#]+)/.exec(loc);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const started = Date.now();

  // 1) Method
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Nur POST erlaubt." });
    return;
  }

  // 2) Auth
  const token = bearerFromRequest(req);
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }

  // 3) Rate-Limit
  if (!checkRateLimit(user.id, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    logSafe({
      userId: user.id,
      action: "ms.mail.send",
      status: "error",
      durationMs: Date.now() - started,
      error: "rate_limited",
    });
    res.status(429).json({ error: "Sende-Limit erreicht. Bitte spaeter erneut versuchen." });
    return;
  }

  // 4) Body-Parsing
  const body = parseBody(req);
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "JSON-Body erforderlich." });
    return;
  }

  // 5) Validierung
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) {
    res.status(400).json({ error: "Feld 'subject' ist erforderlich." });
    return;
  }
  if (subject.length > MAX_SUBJECT_LEN) {
    res.status(400).json({ error: "'subject' ist zu lang." });
    return;
  }

  const html = typeof body.html === "string" ? body.html : "";
  if (!html.trim()) {
    res.status(400).json({ error: "Feld 'html' ist erforderlich." });
    return;
  }
  // Byte-Laenge grob checken (utf8 upper bound ~ 4*length).
  if (html.length > MAX_HTML_BYTES) {
    res.status(400).json({ error: "HTML-Body ist zu gross." });
    return;
  }

  const toParsed = normalizeRecipients(body.to);
  if (toParsed.invalid) {
    res.status(400).json({ error: `Ungueltige 'to'-Empfaenger: ${toParsed.invalid}` });
    return;
  }
  if (toParsed.list.length === 0) {
    res.status(400).json({ error: "Mindestens ein 'to'-Empfaenger erforderlich." });
    return;
  }
  const ccParsed = normalizeRecipients(body.cc);
  if (ccParsed.invalid) {
    res.status(400).json({ error: `Ungueltige 'cc'-Empfaenger: ${ccParsed.invalid}` });
    return;
  }
  const bccParsed = normalizeRecipients(body.bcc);
  if (bccParsed.invalid) {
    res.status(400).json({ error: `Ungueltige 'bcc'-Empfaenger: ${bccParsed.invalid}` });
    return;
  }
  const totalRecipients =
    toParsed.list.length + ccParsed.list.length + bccParsed.list.length;
  if (totalRecipients > MAX_RECIPIENTS_TOTAL) {
    res.status(400).json({ error: `Zu viele Empfaenger (max ${MAX_RECIPIENTS_TOTAL}).` });
    return;
  }

  const inReplyTo = typeof body.inReplyTo === "string" ? body.inReplyTo.trim() : "";
  const isReply = !!inReplyTo;

  const attParsed = validateAttachments(body.attachments);
  if (attParsed.invalid) {
    res.status(400).json({ error: `Anhaenge ungueltig: ${attParsed.invalid}` });
    return;
  }
  if (isReply && attParsed.list.length > 0) {
    // MVP: Reply-Pfad ohne Attachments – bewusst dokumentiert.
    res.status(400).json({
      error:
        "Antworten mit Anhaengen werden derzeit nicht unterstuetzt. Bitte als neue Nachricht senden.",
    });
    return;
  }

  // documentContext (optional)
  let docContext = null;
  if (body.documentContext != null) {
    const dc = body.documentContext;
    if (
      !dc ||
      typeof dc !== "object" ||
      typeof dc.kind !== "string" ||
      typeof dc.id !== "string" ||
      !ALLOWED_DOC_KINDS.has(dc.kind) ||
      dc.id.length < 8
    ) {
      res.status(400).json({ error: "Ungueltiger documentContext." });
      return;
    }
    docContext = { kind: dc.kind, id: dc.id.trim() };
  }

  // 6) Org + Graph-Token laden
  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.mail.send",
      status: "error",
      error: e?.message || String(e),
    });
    res.status(500).json({ error: "Serverkonfiguration unvollstaendig." });
    return;
  }

  let orgId;
  try {
    orgId = await loadOrgId(admin, user.id);
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.mail.send",
      status: "error",
      error: e?.message || String(e),
    });
    res.status(500).json({ error: "Organisation konnte nicht ermittelt werden." });
    return;
  }
  if (!orgId) {
    res.status(404).json({ error: "Keine aktive Organisation gefunden." });
    return;
  }

  let accessToken;
  try {
    accessToken = await getGraphAccessToken(user.id, orgId, admin);
  } catch (e) {
    const code = e?.code || "no_token";
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.send",
      status: "error",
      error: `graph_token_${code}`,
    });
    // not_connected / inactive / no_token / invalid_grant → 404 (aus Client-Sicht).
    if (
      code === "not_connected" ||
      code === "inactive" ||
      code === "no_token" ||
      e?.fatal === true
    ) {
      res.status(404).json({ error: "Microsoft-Konto ist nicht verbunden." });
      return;
    }
    res.status(502).json({ error: "Microsoft-Anmeldung fehlgeschlagen." });
    return;
  }

  // 7) Graph-Request bauen + senden
  const url = isReply
    ? `${GRAPH_BASE}/me/messages/${encodeURIComponent(inReplyTo)}/reply`
    : `${GRAPH_BASE}/me/sendMail`;

  let graphBody;
  if (isReply) {
    // /reply: `comment` als HTML wird oben eingefuegt; `message` erlaubt
    // Recipient-Override.
    const replyMessage = {
      toRecipients: toGraphRecipients(toParsed.list),
    };
    if (ccParsed.list.length > 0) {
      replyMessage.ccRecipients = toGraphRecipients(ccParsed.list);
    }
    if (bccParsed.list.length > 0) {
      replyMessage.bccRecipients = toGraphRecipients(bccParsed.list);
    }
    graphBody = { comment: html, message: replyMessage };
  } else {
    graphBody = {
      message: buildGraphMessage({
        subject,
        html,
        toList: toParsed.list,
        ccList: ccParsed.list,
        bccList: bccParsed.list,
        attachments: attParsed.list,
      }),
      saveToSentItems: true,
    };
  }

  let graphResp;
  let graphErrText = null;
  try {
    graphResp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(graphBody),
    });
  } catch (e) {
    graphErrText = e?.message || String(e);
  }

  const durationMs = Date.now() - started;
  const bodyPreview = makeBodyPreview(html);
  const auditBase = {
    org_id: orgId,
    user_id: user.id,
    recipient_to: toParsed.list.map((r) => r.address),
    recipient_cc: ccParsed.list.length > 0 ? ccParsed.list.map((r) => r.address) : null,
    recipient_bcc:
      bccParsed.list.length > 0 ? bccParsed.list.map((r) => r.address) : null,
    subject: subject.slice(0, 500),
    body_preview: bodyPreview,
    attachment_count: attParsed.list.length,
    duration_ms: durationMs,
    related_offer_id: docContext?.kind === "offer" ? docContext.id : null,
    related_order_id: docContext?.kind === "order" ? docContext.id : null,
    related_invoice_id: docContext?.kind === "invoice" ? docContext.id : null,
    sent_at: new Date().toISOString(),
  };

  if (graphErrText || !graphResp) {
    await insertAudit(admin, {
      ...auditBase,
      action: "failed",
      microsoft_message_id: null,
      error_message: graphErrText || "graph_request_failed",
    });
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.send",
      status: "error",
      durationMs,
      error: graphErrText || "graph_request_failed",
    });
    res.status(502).json({ error: "Sendeversuch fehlgeschlagen." });
    return;
  }

  // Graph sendMail liefert 202 Accepted; /reply liefert 202. 200 dulden wir auch.
  if (graphResp.status !== 202 && graphResp.status !== 200) {
    let err = `http_${graphResp.status}`;
    try {
      const j = await graphResp.json();
      if (j?.error?.message) err = String(j.error.message).slice(0, 400);
    } catch {
      /* ignore */
    }
    await insertAudit(admin, {
      ...auditBase,
      action: "failed",
      microsoft_message_id: null,
      error_message: err,
    });
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.send",
      status: "error",
      durationMs,
      error: err,
      extra: { http_status: graphResp.status },
    });
    res.status(502).json({ error: "Microsoft-Graph hat den Sendevorgang abgelehnt." });
    return;
  }

  // 8) Erfolgs-Audit
  const microsoftMessageId = extractMessageIdFromResponse(graphResp);
  await insertAudit(admin, {
    ...auditBase,
    action: isReply ? "reply" : "sent",
    microsoft_message_id: microsoftMessageId,
    error_message: null,
  });

  logSafe({
    userId: user.id,
    orgId,
    action: "ms.mail.send",
    status: "ok",
    durationMs,
    extra: {
      recipients: totalRecipients,
      attachments: attParsed.list.length,
      reply: isReply,
    },
  });

  res.status(200).json({ ok: true, sentAt: auditBase.sent_at });
}

// Intern fuer Tests exportiert (nicht Teil der offiziellen API).
export const __internal = {
  base64ByteLength,
  normalizeRecipients,
  validateAttachments,
  makeBodyPreview,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_RECIPIENTS_TOTAL,
};
