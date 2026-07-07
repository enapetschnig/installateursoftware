// ============================================================
// B4Y SuperAPP – Microsoft Mail: Inbox-Liste (Vercel Serverless)
// ------------------------------------------------------------
// GET /api/microsoft/mail-list?top=25&skip=0&folder=inbox&search=<q>
//
// Laedt Nachrichten aus einem Microsoft-365-Mailfolder (Default: Inbox)
// ueber Microsoft Graph v1.0. Multi-Tenant-Isolation und Auth-Handling
// laufen ueber die vorhandenen Helper (_lib/security, _lib/microsoft-graph).
//
// Auth: User-Bearer im Authorization-Header (Supabase-JWT).
// Rate-Limit: 60 Aufrufe / Minute / User (In-Memory pro Serverless-Instanz).
//
// Response:
//   200 { messages: [...], nextLink: "https://..."|null, total: number|null }
//   400 { error: "..." }  – ungueltige Query-Parameter (defensiv, i. d. R.
//                            werden Werte geklemmt / defaultet)
//   401 { error: "Nicht angemeldet." }
//   404 { error: "..." }  – kein Membership-Eintrag
//   429 { error: "..." }  – lokales Rate-Limit erreicht
//   502 { error: "..." }  – Microsoft-Verbindung / Graph-Fehler
//   503 { error: "..." }  – Graph 429 nach Retries: Client soll spaeter retry
//   500 { error: "..." }  – interner Fehler
//
// Wichtige Design-Entscheidungen:
//   • Wir nutzen NICHT graphFetch() aus microsoft-graph.js, weil wir hier
//     ein enger definiertes Retry-Verhalten wollen (max 2 Retries fuer 429
//     mit Retry-After, danach 503) und 401 explizit als Token-Invalidierung
//     behandeln (Row deaktivieren + 502 an Client, damit die UI zum
//     erneuten Verbinden auffordert).
//   • search wird vor der Uebergabe an $filter escaped (einfache Quotes
//     verdoppeln = OData-Konvention) und laengenbegrenzt.
//   • getGraphAccessToken() liefert bereits ein frisch gerefreshtes Token
//     und deaktiviert bei invalid_grant die Row – wir muessen hier also
//     lediglich auf den Throw reagieren.
// ============================================================

import { createClient } from "@supabase/supabase-js";

import { bearerFromRequest, verifyUser, checkRateLimit } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";
import { getGraphAccessToken } from "../_lib/microsoft-graph.js";

export const config = { maxDuration: 15 };

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://xyhgckqxowqnzjtoblfs.supabase.co";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Whitelist erlaubter Ordner-Namen fuer /mailFolders/{name}/messages.
// Graph akzeptiert diese "well-known folder names" ohne Escaping.
const ALLOWED_FOLDERS = new Set([
  "inbox",
  "sentitems",
  "drafts",
  "deleteditems",
  "archive",
  "junkemail",
  "outbox",
]);

const DEFAULT_TOP = 25;
const MAX_TOP = 100;
const MAX_SEARCH_LEN = 200;

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const MAX_GRAPH_429_RETRIES = 2;
const RETRY_AFTER_FALLBACK_MS = 1_000;
const MAX_RETRY_AFTER_MS = 10_000;

// ── Dependency-Injection fuer Tests ────────────────────────
let _adminSingleton = null;
let _getAccessTokenOverride = null;
let _getOrgIdOverride = null;

function getAdminClient() {
  if (_adminSingleton) return _adminSingleton;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt");
  _adminSingleton = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminSingleton;
}

/**
 * Test-Hook: erlaubt das Injizieren von getAccessToken / getOrgId / supabase-Client.
 * Alle Felder sind optional; ein Reset via __setDeps({}) stellt die Defaults wieder her.
 */
export function __setDeps({ getAccessToken, getOrgId, supabase } = {}) {
  _getAccessTokenOverride = typeof getAccessToken === "function" ? getAccessToken : null;
  _getOrgIdOverride = typeof getOrgId === "function" ? getOrgId : null;
  _adminSingleton = supabase || null;
}

// ── Helpers ────────────────────────────────────────────────

function parseIntOr(v, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Escaped einen Suchstring fuer OData $filter (contains(...)):
 *  • Nur druckbare Zeichen (Steuerzeichen raus).
 *  • Einfache Quotes werden gemaess OData-Konvention verdoppelt.
 *  • Maximale Laenge MAX_SEARCH_LEN.
 */
function sanitizeSearch(s) {
  if (typeof s !== "string") return "";
  // Steuerzeichen und Backslash raus, damit auch versehentliche URL-
  // Segmente/Injection nicht durchschlagen.
  const cleaned = s
    .replace(/[\x00-\x1F\x7F\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LEN);
  return cleaned;
}

function odataEscape(s) {
  return String(s).replace(/'/g, "''");
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const s = String(headerValue).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    return Math.min(parseInt(s, 10) * 1000, MAX_RETRY_AFTER_MS);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    return Math.min(Math.max(0, t - Date.now()), MAX_RETRY_AFTER_MS);
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

/**
 * Loest die organization_id fuer einen User aus `memberships`.
 * Liefert null, wenn der User in keiner Organisation ist.
 */
async function resolveOrgId(admin, userId) {
  if (_getOrgIdOverride) return _getOrgIdOverride(userId);
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

/**
 * Deaktiviert die Microsoft-OAuth-Row bei 401 vom Graph.
 * Wir setzen is_active=false, erhoehen error_count und schreiben eine
 * Notiz. Bei fehlgeschlagenem Update loggen wir best-effort – der Client
 * bekommt trotzdem 502 und die naechste Anmeldung repariert den Zustand.
 */
async function deactivateTokenRow(admin, userId, orgId, reason) {
  try {
    // Zuerst error_count lesen (best-effort – wenn das failt, setzen wir 1).
    const { data: row } = await admin
      .from("microsoft_oauth_tokens")
      .select("id, error_count")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!row?.id) return;
    await admin
      .from("microsoft_oauth_tokens")
      .update({
        is_active: false,
        error_count: (row.error_count || 0) + 1,
        last_error_message: String(reason || "graph_401").slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  } catch (e) {
    logSafe({
      userId,
      orgId,
      action: "ms.mail.list.deactivate_failed",
      status: "error",
      error: e?.message || String(e),
    });
  }
}

/**
 * Fetch mit gezieltem Retry-Verhalten fuer den Graph-Call:
 *  • Bei 429 → Retry-After honorieren, max MAX_GRAPH_429_RETRIES.
 *  • Bei allen anderen Statuscodes → Response unveraendert zurueckgeben.
 */
async function fetchWithGraph429Retries(url, headers) {
  let lastResp = null;
  for (let attempt = 0; attempt <= MAX_GRAPH_429_RETRIES; attempt += 1) {
    const resp = await fetch(url, { method: "GET", headers });
    lastResp = resp;
    if (resp.status !== 429) return resp;
    if (attempt >= MAX_GRAPH_429_RETRIES) return resp;
    const retryAfterMs =
      parseRetryAfterMs(
        resp.headers && resp.headers.get
          ? resp.headers.get("Retry-After") || resp.headers.get("retry-after")
          : null,
      ) ?? RETRY_AFTER_FALLBACK_MS;
    await sleep(retryAfterMs);
  }
  return lastResp;
}

/**
 * Mappt eine Graph-Message auf das schmalere Client-Schema.
 */
function mapMessage(m) {
  if (!m || typeof m !== "object") return null;
  return {
    id: m.id ?? null,
    subject: typeof m.subject === "string" ? m.subject : "",
    from:
      m.from && typeof m.from === "object"
        ? {
            emailAddress: {
              name: m.from.emailAddress?.name ?? null,
              address: m.from.emailAddress?.address ?? null,
            },
          }
        : null,
    receivedDateTime: m.receivedDateTime ?? null,
    isRead: !!m.isRead,
    hasAttachments: !!m.hasAttachments,
    bodyPreview: typeof m.bodyPreview === "string" ? m.bodyPreview : "",
    importance: typeof m.importance === "string" ? m.importance : "normal",
  };
}

// ── Handler ────────────────────────────────────────────────

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

  if (!checkRateLimit(user.id, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    logSafe({
      userId: user.id,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: "rate_limit_exceeded",
    });
    res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
    return;
  }

  // ── Query-Parameter ─────────────────────────────────────
  const q = req.query || {};
  const top = parseIntOr(q.top, DEFAULT_TOP, { min: 1, max: MAX_TOP });
  const skip = parseIntOr(q.skip, 0, { min: 0 });
  const folderRaw = typeof q.folder === "string" ? q.folder.toLowerCase() : "inbox";
  const folder = ALLOWED_FOLDERS.has(folderRaw) ? folderRaw : "inbox";
  const search = sanitizeSearch(q.search);

  // ── Admin-Client + Org-Lookup ───────────────────────────
  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: e?.message || "supabase init failed",
    });
    res.status(500).json({ error: "Backend nicht konfiguriert." });
    return;
  }

  let orgId;
  try {
    orgId = await resolveOrgId(admin, user.id);
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: e?.message || "membership lookup failed",
    });
    res.status(500).json({ error: "Organisation konnte nicht ermittelt werden." });
    return;
  }
  if (!orgId) {
    logSafe({
      userId: user.id,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: "no_membership",
    });
    res.status(404).json({ error: "Keine Organisation fuer diesen Benutzer gefunden." });
    return;
  }

  // ── Access-Token ─────────────────────────────────────────
  let accessToken;
  try {
    accessToken = _getAccessTokenOverride
      ? await _getAccessTokenOverride(user.id, orgId)
      : await getGraphAccessToken(user.id, orgId, admin);
  } catch (e) {
    const code = e?.code;
    // Reconnect-worthy Codes: der User muss wieder durch den OAuth-Flow.
    // Frontend erkennt das an 401 und leitet in den Verbinden-Flow.
    // Analog zu mail-detail.js + mail-attachment.js — konsistentes Verhalten
    // ueber alle Mail-Endpoints.
    const isReconnectNeeded =
      code === "not_connected" ||
      code === "inactive" ||
      code === "no_token" ||
      e?.fatal;

    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: e?.message || String(e),
      extra: { stage: "get_token", code: code || null, reconnect: isReconnectNeeded },
    });

    if (isReconnectNeeded) {
      res.status(401).json({
        error: "Microsoft-Verbindung ungueltig. Bitte in den Einstellungen neu verbinden.",
        code: "reconnect_required",
      });
      return;
    }
    // Sonstige Fehler (Netzwerk zu Azure-Token-Endpoint, transient) → 502
    res.status(502).json({
      error: "Microsoft Graph nicht erreichbar. Bitte kurz warten und erneut versuchen.",
    });
    return;
  }

  // ── Graph-Request bauen ─────────────────────────────────
  // $select whitelistet die Felder, damit der Payload klein bleibt.
  const selectFields = [
    "id",
    "subject",
    "from",
    "toRecipients",
    "receivedDateTime",
    "isRead",
    "hasAttachments",
    "bodyPreview",
    "importance",
  ].join(",");

  const params = new URLSearchParams();
  params.set("$top", String(top));
  params.set("$skip", String(skip));
  params.set("$select", selectFields);
  // Konsistente Reihenfolge – neueste zuerst.
  params.set("$orderby", "receivedDateTime desc");
  // Anzahl aller Elemente im Ordner (fuer die UI-Paginierung nuetzlich).
  params.set("$count", "true");

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    // ConsistencyLevel ist fuer $count/$search Pflicht.
    ConsistencyLevel: "eventual",
  };

  if (search) {
    const escaped = odataEscape(search);
    // Beide Felder sind schnell filterbar – contains() ist OData-konform.
    params.set(
      "$filter",
      `contains(subject,'${escaped}') or contains(bodyPreview,'${escaped}')`,
    );
  }

  const url = `${GRAPH_BASE}/me/mailFolders/${folder}/messages?${params.toString()}`;

  // ── Fetch mit 429-Retry ─────────────────────────────────
  let graphResp;
  try {
    graphResp = await fetchWithGraph429Retries(url, headers);
  } catch (e) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: e?.message || String(e),
      extra: { stage: "graph_fetch" },
    });
    res.status(502).json({ error: "Microsoft Graph nicht erreichbar." });
    return;
  }

  if (graphResp.status === 429) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: "graph_rate_limited",
      extra: { folder },
    });
    res.status(503).json({
      error: "Microsoft Graph ist ueberlastet. Bitte in Kuerze erneut versuchen.",
    });
    return;
  }

  if (graphResp.status === 401) {
    // Token ist ungueltig / widerrufen – Row deaktivieren, UI muss neu verbinden.
    await deactivateTokenRow(admin, user.id, orgId, "graph_401");
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: "graph_401",
      extra: { folder },
    });
    res.status(502).json({
      error: "Microsoft-Verbindung getrennt oder ungueltig. Bitte neu verbinden.",
    });
    return;
  }

  if (!graphResp.ok) {
    const errText = (await graphResp.text().catch(() => "")).slice(0, 300);
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: `graph_http_${graphResp.status}`,
      extra: { folder, snippet: errText },
    });
    res.status(502).json({ error: "Mails konnten nicht geladen werden." });
    return;
  }

  // ── Antwort parsen ──────────────────────────────────────
  let payload;
  try {
    payload = await graphResp.json();
  } catch (e) {
    logSafe({
      userId: user.id,
      orgId,
      action: "ms.mail.list",
      status: "error",
      durationMs: Date.now() - started,
      error: e?.message || "graph_json_parse_failed",
    });
    res.status(502).json({ error: "Ungueltige Antwort von Microsoft Graph." });
    return;
  }

  const value = Array.isArray(payload?.value) ? payload.value : [];
  const messages = value.map(mapMessage).filter((m) => m && m.id);
  const nextLink =
    typeof payload?.["@odata.nextLink"] === "string"
      ? payload["@odata.nextLink"]
      : null;
  const total =
    typeof payload?.["@odata.count"] === "number" ? payload["@odata.count"] : null;

  logSafe({
    userId: user.id,
    orgId,
    action: "ms.mail.list",
    status: "ok",
    durationMs: Date.now() - started,
    extra: {
      folder,
      count: messages.length,
      top,
      skip,
      has_search: search.length > 0,
      has_next: !!nextLink,
      total: total ?? -1,
    },
  });

  res.status(200).json({ messages, nextLink, total });
}
