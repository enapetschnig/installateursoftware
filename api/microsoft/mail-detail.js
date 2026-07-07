// ============================================================
// B4Y SuperAPP – Microsoft-Graph Mail-Detail
// ------------------------------------------------------------
// GET /api/microsoft/mail-detail?id=<messageId>
//
// Liefert eine einzelne Nachricht aus dem Postfach des verbundenen
// Microsoft-365-Kontos inklusive Body und Metadaten der Anhaenge.
// Der Body wird 1:1 durchgereicht – HTML-Rendering + Sanitisierung
// findet clientseitig in einem sandboxed iframe statt.
//
// Auth: Supabase-User-JWT im Bearer. Die aktive Organization wird
// serverseitig aus `memberships` gelesen. Der Graph-Access-Token wird
// aus microsoft_oauth_tokens geladen (encrypted, ggf. proaktiv
// refreshed) und Klartext NUR zwischen graph.microsoft.com und dieser
// Function verwendet.
//
// Rate-Limit: 120 Requests / 60 s (haeufigeres Zugriffsmuster als
// die List-Ansicht, weil auch beim Blaettern durch die Threads mehrere
// Detail-Abrufe pro Minute anfallen).
//
// Status-Codes:
//   400 – id fehlt / leer
//   401 – kein/ungueltiger Bearer
//   403 – (Rate-Limit)
//   404 – Message existiert nicht / kein Zugriff (Graph 404)
//   502 – Graph-Backend-Fehler (5xx / Netzwerk)
//   500 – interner Fehler (Token/DB/Config)
// ============================================================

import {
  bearerFromRequest,
  verifyUser,
  checkRateLimit,
} from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";
import {
  getGraphAccessToken,
  graphFetch,
} from "../_lib/microsoft-graph.js";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://xyhgckqxowqnzjtoblfs.supabase.co";

// Service-Role-Client-Singleton pro Cold-Start (fuer memberships-Lookup und
// als admin-Injection in getGraphAccessToken).
let _adminSingleton = null;
function getAdminClient() {
  if (_adminSingleton) return _adminSingleton;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY fehlt – Mail-Detail benoetigt Service-Role fuer Token-Zugriff.",
    );
  }
  _adminSingleton = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminSingleton;
}

/**
 * Loest die active organization_id des Users ueber `memberships` auf.
 * Konsistent mit current_org_id() SQL-Function und microsoft-callback.js.
 */
async function resolveOrgId(admin, userId) {
  const { data, error } = await admin
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `memberships read failed: ${error.message || String(error)}`,
    );
  }
  return data?.organization_id || null;
}

/**
 * Mappt eine Graph-Message auf das App-Schema. Bewusst minimal – alles was
 * fuer die Detail-Ansicht (Header + Body + Anhaenge) noetig ist. Body wird
 * 1:1 durchgereicht (kein HTML-Stripping serverseitig).
 */
function mapMessage(m) {
  if (!m || typeof m !== "object") return null;

  const bodyContentType =
    String(m.body?.contentType || "").toLowerCase() === "html"
      ? "html"
      : "text";

  const attachments = Array.isArray(m.attachments)
    ? m.attachments.map((a) => ({
        id: a.id,
        name: a.name,
        size: typeof a.size === "number" ? a.size : Number(a.size) || 0,
        contentType: a.contentType || null,
        isInline: !!a.isInline,
      }))
    : [];

  return {
    id: m.id,
    subject: m.subject || "",
    from: m.from || null,
    toRecipients: Array.isArray(m.toRecipients) ? m.toRecipients : [],
    ccRecipients: Array.isArray(m.ccRecipients) ? m.ccRecipients : [],
    bccRecipients: Array.isArray(m.bccRecipients) ? m.bccRecipients : [],
    receivedDateTime: m.receivedDateTime || null,
    sentDateTime: m.sentDateTime || null,
    isRead: !!m.isRead,
    hasAttachments: !!m.hasAttachments,
    importance: m.importance || "normal",
    conversationId: m.conversationId || null,
    body: {
      contentType: bodyContentType,
      content: typeof m.body?.content === "string" ? m.body.content : "",
    },
    attachments,
  };
}

// Vercel-Serverless-Konfiguration.
export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Nur GET erlaubt." });
    return;
  }

  const token = bearerFromRequest(req);
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }

  // Pflicht-Parameter: id (Graph-Message-ID, opaque)
  const id = String((req.query && req.query.id) || "").trim();
  if (!id) {
    res.status(400).json({ error: "Parameter 'id' fehlt." });
    return;
  }

  // Rate-Limit vor jedem teuren Backend-Call.
  if (!checkRateLimit(user.id, 120, 60_000)) {
    logSafe({
      userId: user.id,
      action: "ms.mail.detail",
      status: "error",
      error: "rate_limited",
    });
    // 429 (nicht 403): das ist der korrekte HTTP-Code fuer Rate-Limit —
    // Frontend/Fetch-Clients erkennen ihn als "Retry-later"-Signal.
    res
      .status(429)
      .json({ error: "Zu viele Anfragen – bitte kurz warten." });
    return;
  }

  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.mail.detail",
      status: "error",
      error: e?.message || String(e),
    });
    res.status(500).json({ error: "Server-Konfiguration unvollstaendig." });
    return;
  }

  // Aktive Organization aufloesen.
  let orgId;
  try {
    orgId = await resolveOrgId(admin, user.id);
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.mail.detail",
      status: "error",
      error: e?.message || String(e),
    });
    res.status(500).json({ error: "Organisation konnte nicht ermittelt werden." });
    return;
  }
  if (!orgId) {
    res.status(401).json({ error: "Keine aktive Organisation gefunden." });
    return;
  }

  // Access-Token aus microsoft_oauth_tokens (ggf. proaktiv refresh).
  let accessToken;
  try {
    accessToken = await getGraphAccessToken(user.id, orgId, admin);
  } catch (e) {
    const code = e?.code || "";
    logSafe({
      userId: user.id,
      action: "ms.mail.detail",
      status: "error",
      error: code || e?.message || String(e),
    });
    // Fehlende/Inaktive Verbindung → 401 (User muss reconnecten).
    if (code === "not_connected" || code === "inactive" || code === "no_token") {
      res.status(401).json({ error: e.message });
      return;
    }
    // Fatale Refresh-Fehler → 401, damit UI Reconnect-Flow triggern kann.
    if (e?.fatal) {
      res.status(401).json({ error: e.message });
      return;
    }
    res
      .status(502)
      .json({ error: "Microsoft-Token konnte nicht bezogen werden." });
    return;
  }

  // Graph-Call: einzelne Message + Attachment-Metadaten (kein contentBytes).
  // encodeURIComponent auf id, damit ein '/' oder '=' in der Graph-ID
  // nicht als Pfad-Segment interpretiert wird.
  const encodedId = encodeURIComponent(id);
  const path =
    `/me/messages/${encodedId}` +
    `?$expand=attachments($select=id,name,size,contentType,isInline)`;

  let resp;
  try {
    resp = await graphFetch(accessToken, path, { method: "GET" });
  } catch (e) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.detail",
      status: "error",
      error: e?.message || String(e),
    });
    res.status(502).json({ error: "Microsoft-Graph nicht erreichbar." });
    return;
  }

  if (resp.status === 404) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.detail",
      status: "error",
      durationMs: Date.now() - started,
      error: "not_found",
      extra: { id },
    });
    res.status(404).json({ error: "Nachricht nicht gefunden." });
    return;
  }

  if (resp.status === 401 || resp.status === 403) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.detail",
      status: "error",
      error: `graph_${resp.status}`,
    });
    res.status(401).json({
      error: "Microsoft-Zugriff nicht mehr gueltig – bitte erneut verbinden.",
    });
    return;
  }

  if (!resp.ok) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.detail",
      status: "error",
      error: `graph_${resp.status}`,
    });
    res.status(502).json({ error: "Microsoft-Graph antwortete mit Fehler." });
    return;
  }

  let payload;
  try {
    payload = await resp.json();
  } catch (e) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.detail",
      status: "error",
      error: `parse_${e?.message || "invalid_json"}`,
    });
    res.status(502).json({ error: "Antwort von Microsoft-Graph ungueltig." });
    return;
  }

  const mapped = mapMessage(payload);
  if (!mapped) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.detail",
      status: "error",
      error: "empty_payload",
    });
    res.status(502).json({ error: "Leere Antwort von Microsoft-Graph." });
    return;
  }

  logSafe({
    userId: user.id,
    orgId,
    action: "ms.mail.detail",
    status: "ok",
    durationMs: Date.now() - started,
    extra: {
      has_attachments: mapped.hasAttachments,
      attachment_count: mapped.attachments.length,
      body_type: mapped.body.contentType,
    },
  });

  res.status(200).json(mapped);
}
