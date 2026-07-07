// ============================================================
// B4Y SuperAPP – Microsoft Graph Mail Attachment
// ------------------------------------------------------------
// GET /api/microsoft/mail-attachment?messageId=<mid>&attachmentId=<aid>&mode=download|inline
//
// Streamt einen einzelnen Mail-Anhang aus Microsoft Graph an den
// Client durch. Es wird NICHTS auf der Server-Disk persistiert –
// der base64-kodierte contentBytes-Payload aus Graph wird in Memory
// zu einem Buffer decodiert und direkt in die Response geschrieben.
//
// Response-Header:
//   • Content-Type:        <attachment.contentType>
//   • Content-Disposition: inline|attachment; filename="<name>"
//   • Content-Length:      <buffer.byteLength>
//
// Sicherheits-Hinweise:
//   • mode=inline wird nur fuer Whitelist-MIME-Prefixe erlaubt
//     (image/*, application/pdf). Alles andere wird als attachment
//     ausgeliefert, damit Browser keinen aktiven Inhalt rendern.
//   • Dateinamen werden auf ASCII-Sicherheit trivial gesaeubert
//     (keine CR/LF, keine Anfuehrungszeichen), zusaetzlich RFC 5987
//     filename*=UTF-8''… fuer Nicht-ASCII-Zeichen.
//   • Der Attachment-Endpoint liefert von Graph i.d.R. Datentypen
//     "fileAttachment" (mit contentBytes). itemAttachment/reference-
//     Attachment werden abgelehnt (415).
//
// Auth: User-Bearer-JWT (Supabase). Rate-Limit 60 req / 60s / User.
// ============================================================

import { createClient } from "@supabase/supabase-js";

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

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://xyhgckqxowqnzjtoblfs.supabase.co";

// MIME-Prefix-Whitelist fuer mode=inline. Alles andere → attachment.
const INLINE_MIME = ["image/", "application/pdf"];
// SVG kann inline <script> enthalten → XSS-Vektor. Explizit ausschliessen,
// obwohl "image/" es sonst zulassen wuerde. Andere image/* (jpeg/png/gif/
// webp) sind reine Bilddaten und im iframe-sandbox harmlos.
const INLINE_DENY = ["image/svg+xml", "image/svg"];

// Guard: absurd grosse Attachments blocken (Graph liefert bis 150 MB;
// fuer den Preview-Pfad reichen wir nur bis ~25 MB durch).
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Service-Role-Client (Singleton pro Cold-Start). */
let _adminSingleton = null;
function getAdminClient() {
  if (_adminSingleton) return _adminSingleton;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY fehlt – mail-attachment benoetigt Service-Role.",
    );
  }
  _adminSingleton = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminSingleton;
}

/**
 * Aktive Organisation des Users lesen (public.memberships).
 * Konvention der App (siehe microsoft-callback.js).
 */
async function resolveOrgId(admin, userId) {
  const { data } = await admin
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.organization_id || null;
}

/** Ist der MIME-Typ fuer Inline-Anzeige erlaubt? */
function isInlineAllowed(mime) {
  if (!mime || typeof mime !== "string") return false;
  const lower = mime.toLowerCase();
  if (INLINE_DENY.some((deny) => lower.startsWith(deny))) return false;
  return INLINE_MIME.some((p) => lower.startsWith(p));
}

/**
 * Saeubert einen Dateinamen fuer Content-Disposition:
 *  • entfernt CR/LF/NUL (Header-Injection),
 *  • ersetzt Anfuehrungszeichen und Backslash,
 *  • kuerzt auf 200 Zeichen (Graph erlaubt bis 255).
 */
function safeAsciiFilename(name) {
  const base = String(name || "attachment").replace(/[\r\n\0"\\]/g, "_");
  const trimmed = base.trim() || "attachment";
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

/** RFC 5987 – filename* mit UTF-8 fuer Nicht-ASCII-Zeichen. */
function rfc5987(name) {
  return "UTF-8''" + encodeURIComponent(String(name || "attachment"));
}

/** Query-Value robust zu String zwingen (Vercel liefert manchmal Arrays). */
function q(v) {
  if (Array.isArray(v)) return v[0];
  if (v === undefined || v === null) return "";
  return String(v);
}

/**
 * Sehr grobe Validierung fuer Graph-IDs: nur URL-sichere Zeichen zulassen.
 * Graph liefert Base64URL-artige IDs, aehnlich beim Attachment.
 * "." und "/" verbieten wir explizit, damit keine Pfad-Injektion moeglich
 * ist ("../evil"). "=" und "+" sind fuer Base64-Padding erlaubt.
 */
function validGraphId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_\-=+]{1,4096}$/.test(id);
}

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

  const query = req.query || {};
  const messageId = q(query.messageId);
  const attachmentId = q(query.attachmentId);
  const modeRaw = q(query.mode).toLowerCase();
  const mode = modeRaw === "inline" ? "inline" : "download";

  if (!messageId) {
    res.status(400).json({ error: "messageId erforderlich." });
    return;
  }
  if (!attachmentId) {
    res.status(400).json({ error: "attachmentId erforderlich." });
    return;
  }
  if (!validGraphId(messageId) || !validGraphId(attachmentId)) {
    res.status(400).json({ error: "Ungueltige Graph-ID." });
    return;
  }

  if (!checkRateLimit(user.id, 60, 60_000)) {
    res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
    return;
  }

  // Admin-Client + Org-Aufloesung (fuer Token-Lookup).
  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.mail.attachment",
      status: "error",
      error: e?.message || String(e),
    });
    res.status(500).json({ error: "Serverkonfiguration fehlt." });
    return;
  }

  let orgId;
  try {
    orgId = await resolveOrgId(admin, user.id);
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.mail.attachment",
      status: "error",
      error: `org_lookup: ${e?.message || e}`,
    });
    res.status(500).json({ error: "Organisation konnte nicht ermittelt werden." });
    return;
  }
  if (!orgId) {
    res.status(400).json({ error: "Keine aktive Organisation zugeordnet." });
    return;
  }

  // Access-Token besorgen (proaktives Refresh im Helper).
  let accessToken;
  try {
    accessToken = await getGraphAccessToken(user.id, orgId, admin);
  } catch (e) {
    const code = String(e?.code || "");
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: code || e?.message || String(e),
    });
    if (
      code === "not_connected" ||
      code === "inactive" ||
      code === "no_token" ||
      code === "invalid_grant" ||
      e?.fatal
    ) {
      res.status(401).json({
        error:
          "Microsoft-Konto nicht (mehr) verbunden – bitte erneut verbinden.",
      });
      return;
    }
    res
      .status(502)
      .json({ error: "Microsoft-Graph nicht erreichbar (Token)." });
    return;
  }

  // Graph-Aufruf: JSON mit contentBytes (base64) fuer fileAttachment.
  const path = `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  let graphResp;
  try {
    graphResp = await graphFetch(accessToken, path, { method: "GET" });
  } catch (e) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: `graph_fetch: ${e?.message || e}`,
    });
    res.status(502).json({ error: "Microsoft-Graph nicht erreichbar." });
    return;
  }

  if (graphResp.status === 404) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: "not_found",
      durationMs: Date.now() - started,
    });
    res.status(404).json({ error: "Anhang nicht gefunden." });
    return;
  }

  if (graphResp.status === 401) {
    // Row deaktivieren – Token vermutlich revoked.
    try {
      await admin
        .from("microsoft_oauth_tokens")
        .update({
          is_active: false,
          last_error_message: "Graph 401 auf Attachment – Token revoked?",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("organization_id", orgId);
    } catch {
      /* best-effort */
    }
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: "graph_401",
      durationMs: Date.now() - started,
    });
    res
      .status(502)
      .json({ error: "Microsoft-Autorisierung abgelaufen. Bitte neu verbinden." });
    return;
  }

  if (!graphResp.ok) {
    let msg = `http_${graphResp.status}`;
    try {
      const j = await graphResp.json();
      if (j?.error?.code) msg = String(j.error.code);
    } catch {
      /* ignore */
    }
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: msg,
      extra: { http_status: graphResp.status },
      durationMs: Date.now() - started,
    });
    res.status(502).json({ error: "Anhang konnte nicht geladen werden." });
    return;
  }

  // Parse Graph-JSON.
  let payload = null;
  try {
    payload = await graphResp.json();
  } catch (e) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: `parse: ${e?.message || e}`,
    });
    res.status(502).json({ error: "Ungueltige Antwort von Microsoft." });
    return;
  }

  const odataType = String(payload?.["@odata.type"] || "").toLowerCase();
  const contentBytes = payload?.contentBytes;
  const name = payload?.name || "attachment";
  const contentType = payload?.contentType || "application/octet-stream";
  const declaredSize = Number(payload?.size) || 0;

  // Nur fileAttachment: item-/referenceAttachment ohne inline-Body ablehnen.
  if (
    (odataType && !odataType.includes("fileattachment")) ||
    typeof contentBytes !== "string" ||
    contentBytes.length === 0
  ) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: "unsupported_attachment_type",
      extra: { odata: odataType || "unknown" },
    });
    res.status(415).json({
      error: "Anhangtyp wird nicht unterstuetzt (nur Datei-Anhaenge).",
    });
    return;
  }

  // Groessen-Guard (grobe Vor-Pruefung anhand size aus Graph).
  if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: "too_large",
      extra: { size: declaredSize },
    });
    res.status(413).json({ error: "Anhang ist zu gross." });
    return;
  }

  let buffer;
  try {
    buffer = Buffer.from(contentBytes, "base64");
  } catch (e) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: `decode: ${e?.message || e}`,
    });
    res.status(502).json({ error: "Anhang-Dekodierung fehlgeschlagen." });
    return;
  }

  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.attachment",
      status: "error",
      error: "too_large_decoded",
      extra: { size: buffer.byteLength },
    });
    res.status(413).json({ error: "Anhang ist zu gross." });
    return;
  }

  // Inline-Modus nur fuer sichere MIME-Prefixes zulassen.
  const effectiveMode =
    mode === "inline" && isInlineAllowed(contentType) ? "inline" : "attachment";

  const asciiName = safeAsciiFilename(name);
  const disposition =
    `${effectiveMode}; filename="${asciiName}"; ` +
    `filename*=${rfc5987(name)}`;

  // Anti-Caching – der Endpoint ist user-spezifisch und darf nicht in
  // Zwischen-Proxys landen.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", disposition);
  res.setHeader("Content-Length", String(buffer.byteLength));
  res.status(200);

  logSafe({
    userId: user.id,
    orgId,
    action: "ms.mail.attachment",
    status: "ok",
    durationMs: Date.now() - started,
    extra: {
      size: buffer.byteLength,
      mode: effectiveMode,
      // MIME kann PII enthalten? Nein - reine Type-Info, ok.
      mime: contentType.slice(0, 100),
    },
  });

  // end(buffer) → Vercel/Node schreibt Body und schliesst Connection.
  res.end(buffer);
}

export const config = { maxDuration: 30 };
