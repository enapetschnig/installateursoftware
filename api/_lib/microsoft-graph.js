// ============================================================
// B4Y SuperAPP – Microsoft-Graph-Helper (Vercel Serverless)
// ------------------------------------------------------------
// Liefert einen authentifizierten Graph-Client für eingebundene
// Microsoft-365-Konten (Multi-Tenant: "Accounts in any organizational
// directory"). Token werden verschlüsselt in `microsoft_oauth_tokens`
// abgelegt (KEK aus Vercel-Env, libsodium in ./encryption); dieser
// Helper kümmert sich um:
//
//   • Auslesen + Entschlüsseln des gespeicherten Tokens (RLS via
//     Service-Role-Client; Aufrufer ist serverseitig).
//   • Proaktives Refresh (60-Sekunden-Schwelle vor expires_at).
//   • Fehlerbehandlung beim Refresh (invalid_grant → is_active=false,
//     error_count++, last_error_message; weitere Fehler werden ohne
//     Deaktivierung gezählt).
//   • Robustes Aufrufen von graph.microsoft.com (Retry bei 429 mit
//     Retry-After, Retry bei 5xx mit Exponential Backoff – jeweils
//     max. 3 Wiederholungen).
//
// SICHERHEIT
//  • Klartext-Tokens verlassen NIE die DB; Persistenz nur über
//    encryptToken() aus ./encryption (libsodium secretbox + KEK).
//  • Logs gehen ausschließlich über ./safe-log → logSafe()/redactJwt(),
//    damit niemals Bearer-Token im Log landen.
//  • Verwendet AZURE_CLIENT_ID / AZURE_CLIENT_SECRET aus den Vercel-
//    Environment-Variablen. Beide müssen serverseitig hinterlegt sein.
//
// HINWEISE
//  • Tabelle `microsoft_oauth_tokens` (Migration 0114): one row pro
//    (user_id, organization_id) – Felder u. a. access_token_enc,
//    refresh_token_enc, expires_at (timestamptz), is_active (bool),
//    error_count (int), last_error_message (text), updated_at.
//  • Scopes: offline_access Mail.Read Mail.Send User.Read openid
//    profile email (siehe Connect-Endpoint). Beim Refresh werden
//    dieselben Scopes erneut angefragt, damit das Refresh-Token
//    rotieren kann.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { encryptToken, decryptToken } from "./encryption.js";
import { logSafe, redactJwt } from "./safe-log.js";

// ── Konstanten ─────────────────────────────────────────────
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const TOKEN_TABLE = "microsoft_oauth_tokens";

/** Refresh-Schwelle: bei < 60 s Restlaufzeit proaktiv erneuern. */
const REFRESH_THRESHOLD_MS = 60_000;

/** Microsoft-Graph-Scopes – müssen mit dem Connect-Flow übereinstimmen. */
const GRAPH_SCOPES =
  "offline_access Mail.Read Mail.Send User.Read openid profile email";

/** Maximale Retry-Versuche bei 429/5xx (zusätzlich zum ersten Versuch). */
const MAX_RETRIES = 3;

/** Basis für Exponential Backoff (5xx) in Millisekunden. */
const BACKOFF_BASE_MS = 2_000;

/** Obergrenze, um zu vermeiden, dass ein bösartiger Retry-After uns blockiert. */
const MAX_RETRY_AFTER_MS = 30_000;

// ── Service-Role-Client (Singleton pro Cold-Start) ─────────
let _adminSingleton = null;

/**
 * Liefert einen Supabase-Admin-Client (Service-Role). Wird nur als
 * Fallback verwendet, falls der Caller keinen eigenen Client mitbringt.
 * Im Produktivpfad sollte der Aufrufer den Admin-Client injizieren
 * (bessere Testbarkeit und konsistente Header).
 */
function getAdminClient() {
  if (_adminSingleton) return _adminSingleton;
  const url =
    process.env.VITE_SUPABASE_URL ||
    "https://pqwcpgmsutpbuvdzslbc.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY fehlt – Microsoft-Graph-Helper benötigt Service-Role.",
    );
  }
  _adminSingleton = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminSingleton;
}

/**
 * Promise-basiertes Sleep – als eigene Funktion, damit Tests sie über
 * `vi.spyOn(globalThis, 'setTimeout')` oder Fake-Timer steuern können.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

/**
 * Parst den Retry-After-Header (RFC 7231: Sekunden oder HTTP-Datum).
 * Liefert Millisekunden, oder null, wenn nicht parsebar.
 */
function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const s = String(headerValue).trim();
  if (!s) return null;
  // Variante 1: Ganzzahl-Sekunden.
  if (/^\d+$/.test(s)) {
    return Math.min(parseInt(s, 10) * 1000, MAX_RETRY_AFTER_MS);
  }
  // Variante 2: HTTP-Datum.
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    return Math.min(Math.max(0, t - Date.now()), MAX_RETRY_AFTER_MS);
  }
  return null;
}

/**
 * Liefert millis bis expires_at; akzeptiert Date, Zahl (ms) oder ISO-String.
 */
function msUntil(expiresAt) {
  if (!expiresAt) return -Infinity;
  let t;
  if (expiresAt instanceof Date) t = expiresAt.getTime();
  else if (typeof expiresAt === "number") t = expiresAt;
  else t = Date.parse(String(expiresAt));
  if (Number.isNaN(t)) return -Infinity;
  return t - Date.now();
}

/**
 * Liest die aktive Token-Row für (userId, orgId).
 * @returns row | null
 */
async function loadTokenRow(supabaseAdmin, userId, orgId) {
  const { data, error } = await supabaseAdmin
    .from(TOKEN_TABLE)
    .select(
      "id, user_id, organization_id, access_token_enc, refresh_token_enc, expires_at, is_active, error_count, last_error_message",
    )
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `microsoft_oauth_tokens read failed: ${error.message || String(error)}`,
    );
  }
  return data || null;
}

/**
 * Markiert eine Token-Row als deaktiviert (z. B. bei invalid_grant).
 * Setzt is_active=false, erhöht error_count und schreibt last_error_message.
 */
async function markTokenInactive(supabaseAdmin, tokenRow, message) {
  const safeMsg = String(message || "").slice(0, 1000);
  const next = (tokenRow?.error_count || 0) + 1;
  try {
    await supabaseAdmin
      .from(TOKEN_TABLE)
      .update({
        is_active: false,
        error_count: next,
        last_error_message: safeMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tokenRow.id);
  } catch (e) {
    // Best-effort – Logging ist ausreichend, Caller bekommt den Throw.
    logSafe({
      action: "microsoft_graph.mark_inactive",
      status: "error",
      error: String(e?.message || e),
    });
  }
}

/**
 * Erhöht den Fehlerzähler, ohne das Token zu deaktivieren
 * (für transiente Fehler, die nicht direkt mit den Credentials zu tun haben).
 */
async function bumpTokenError(supabaseAdmin, tokenRow, message) {
  const safeMsg = String(message || "").slice(0, 1000);
  const next = (tokenRow?.error_count || 0) + 1;
  try {
    await supabaseAdmin
      .from(TOKEN_TABLE)
      .update({
        error_count: next,
        last_error_message: safeMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tokenRow.id);
  } catch (e) {
    logSafe({
      action: "microsoft_graph.bump_error",
      status: "error",
      error: String(e?.message || e),
    });
  }
}

/**
 * Speichert ein erfolgreich refresht-Token-Paar verschlüsselt in der DB
 * und setzt den Fehlerstatus zurück.
 */
async function persistRefreshedTokens(
  supabaseAdmin,
  tokenRow,
  accessToken,
  refreshToken,
  expiresAtIso,
) {
  const access_token_enc = await encryptToken(accessToken);
  // Wenn Microsoft kein neues Refresh-Token liefert, behalten wir das alte.
  const refresh_token_enc = refreshToken
    ? await encryptToken(refreshToken)
    : tokenRow.refresh_token_enc;

  const { error } = await supabaseAdmin
    .from(TOKEN_TABLE)
    .update({
      access_token_enc,
      refresh_token_enc,
      expires_at: expiresAtIso,
      is_active: true,
      error_count: 0,
      last_error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tokenRow.id);

  if (error) {
    throw new Error(
      `microsoft_oauth_tokens update failed: ${error.message || String(error)}`,
    );
  }
}

// ── Public API ─────────────────────────────────────────────

/**
 * Refresht ein gespeichertes Microsoft-Graph-Token über das Refresh-Token.
 * Aktualisiert die DB-Row (encrypted) und liefert das neue Klartext-Token
 * zurück. Bei invalid_grant wird die Row deaktiviert und der Fehler
 * geworfen – der Aufrufer muss den Benutzer zu einer erneuten
 * Autorisierung führen.
 *
 * @param {object} tokenRow       Row aus microsoft_oauth_tokens (mit id,
 *                                refresh_token_enc, error_count, …).
 * @param {object} supabaseAdmin  Supabase-Client mit Service-Role.
 * @returns {Promise<{access_token: string, refresh_token: string, expires_at: string}>}
 */
export async function refreshGraphToken(tokenRow, supabaseAdmin) {
  if (!tokenRow || !tokenRow.id) {
    throw new Error("refreshGraphToken: tokenRow fehlt oder unvollständig.");
  }
  if (!tokenRow.refresh_token_enc) {
    await markTokenInactive(
      supabaseAdmin,
      tokenRow,
      "Kein Refresh-Token vorhanden – erneutes Verbinden erforderlich.",
    );
    throw new Error(
      "Kein Refresh-Token vorhanden – erneutes Verbinden erforderlich.",
    );
  }

  const clientId = process.env.AZURE_CLIENT_ID || "";
  const clientSecret = process.env.AZURE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "AZURE_CLIENT_ID / AZURE_CLIENT_SECRET fehlen in der Vercel-Environment.",
    );
  }

  let refreshToken;
  try {
    refreshToken = await decryptToken(tokenRow.refresh_token_enc);
  } catch (e) {
    await markTokenInactive(
      supabaseAdmin,
      tokenRow,
      `Refresh-Token-Entschlüsselung fehlgeschlagen: ${String(e?.message || e)}`,
    );
    throw new Error("Refresh-Token konnte nicht entschlüsselt werden.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: GRAPH_SCOPES,
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  // Microsoft liefert bei Fehlern strukturierte JSON-Bodies.
  let payload = null;
  try {
    payload = await r.json();
  } catch {
    payload = null;
  }

  if (!r.ok) {
    const errCode = String(payload?.error || "").toLowerCase();
    const errDesc = String(
      payload?.error_description || payload?.error || `HTTP ${r.status}`,
    );
    // invalid_grant / interaction_required / consent_required → User muss neu autorisieren.
    const fatal =
      errCode === "invalid_grant" ||
      errCode === "interaction_required" ||
      errCode === "consent_required" ||
      errCode === "unauthorized_client";

    logSafe({
      action: "microsoft_graph.refresh",
      status: "error",
      userId: tokenRow.user_id,
      orgId: tokenRow.organization_id,
      error: errCode || `http_${r.status}`,
      extra: {
        http_status: r.status,
        fatal: !!fatal,
      },
    });

    if (fatal) {
      await markTokenInactive(supabaseAdmin, tokenRow, errDesc);
      const err = new Error(`Microsoft-Refresh fehlgeschlagen: ${errDesc}`);
      err.code = errCode || "invalid_grant";
      err.fatal = true;
      throw err;
    }
    await bumpTokenError(supabaseAdmin, tokenRow, errDesc);
    const err = new Error(`Microsoft-Refresh fehlgeschlagen: ${errDesc}`);
    err.code = errCode || `http_${r.status}`;
    throw err;
  }

  const access_token = String(payload?.access_token || "");
  const refresh_token = payload?.refresh_token
    ? String(payload.refresh_token)
    : null;
  // expires_in ist in Sekunden – Microsoft liefert üblicherweise 3600.
  const expiresInSec = Number(payload?.expires_in) || 3600;
  const expiresAtIso = new Date(Date.now() + expiresInSec * 1000).toISOString();

  if (!access_token) {
    await bumpTokenError(
      supabaseAdmin,
      tokenRow,
      "Refresh-Antwort ohne access_token.",
    );
    throw new Error("Refresh-Antwort ohne access_token.");
  }

  await persistRefreshedTokens(
    supabaseAdmin,
    tokenRow,
    access_token,
    refresh_token,
    expiresAtIso,
  );

  // Token-Vorschau bewusst NICHT geloggt; logSafe filtert Keys mit "token"
  // ohnehin aus dem extra-Block. redactJwt() ist nur als Safety-Net importiert.
  logSafe({
    action: "microsoft_graph.refresh",
    status: "ok",
    userId: tokenRow.user_id,
    orgId: tokenRow.organization_id,
    extra: {
      expires_at: expiresAtIso,
      // KEIN Token-Preview: Graph access_tokens sind opaque, kein garantiertes
      // JWT-Format → redactJwt greift nicht zuverlaessig und wuerde Klartext leaken.
      // Der Erfolg wird durch das Logging von expires_at hinreichend belegt.
    },
  });

  return {
    access_token,
    refresh_token: refresh_token || refreshToken,
    expires_at: expiresAtIso,
  };
}

/**
 * Liefert ein gültiges Microsoft-Graph-Access-Token für (userId, orgId).
 * Refresht proaktiv, wenn die Restlaufzeit unter 60 s liegt.
 *
 * @param {string} userId         auth.users.id des verbundenen Benutzers.
 * @param {string} orgId          organizations.id (Mandant).
 * @param {object} [supabaseAdmin] Optionaler Service-Role-Client (DI für Tests).
 * @returns {Promise<string>}     Klartext-Access-Token.
 */
export async function getGraphAccessToken(userId, orgId, supabaseAdmin) {
  if (!userId || !orgId) {
    throw new Error("getGraphAccessToken: userId und orgId sind erforderlich.");
  }
  const admin = supabaseAdmin || getAdminClient();
  const row = await loadTokenRow(admin, userId, orgId);

  if (!row) {
    const err = new Error(
      "Microsoft-Konto nicht verbunden – bitte zuerst im Bereich E-Mail verbinden.",
    );
    err.code = "not_connected";
    throw err;
  }
  if (row.is_active === false) {
    const err = new Error(
      "Microsoft-Konto ist deaktiviert – bitte erneut verbinden.",
    );
    err.code = "inactive";
    throw err;
  }
  if (!row.access_token_enc) {
    const err = new Error(
      "Microsoft-Konto hat kein gespeichertes Token – bitte erneut verbinden.",
    );
    err.code = "no_token";
    throw err;
  }

  // Proaktives Refresh, wenn < 60 s Restlaufzeit.
  if (msUntil(row.expires_at) < REFRESH_THRESHOLD_MS) {
    const refreshed = await refreshGraphToken(row, admin);
    return refreshed.access_token;
  }

  // Sonst: gespeichertes Token entschlüsseln und ausliefern.
  try {
    return await decryptToken(row.access_token_enc);
  } catch (e) {
    // Entschlüsselungsfehler → wir versuchen einen Refresh, sonst harter Fehler.
    logSafe({
      action: "microsoft_graph.access_decrypt_failed",
      status: "error",
      userId,
      orgId,
      error: String(e?.message || e),
    });
    const refreshed = await refreshGraphToken(row, admin);
    return refreshed.access_token;
  }
}

/**
 * Robuster Wrapper um `fetch` gegen graph.microsoft.com.
 *  • Setzt Authorization-Header automatisch.
 *  • Behandelt 429 (Retry-After) und 5xx (Exponential Backoff) mit
 *    bis zu MAX_RETRIES Versuchen.
 *  • Liefert die Response unverändert zurück – das Parsen (JSON/Stream)
 *    bleibt beim Aufrufer.
 *
 * @param {string} accessToken    Bearer-Access-Token (Klartext).
 * @param {string} path           Pfad ab /v1.0, z. B. "/me/messages".
 * @param {RequestInit} [init]    Standard-Fetch-Optionen (method, body, …).
 * @returns {Promise<Response>}
 */
export async function graphFetch(accessToken, path, init = {}) {
  if (!accessToken) {
    throw new Error("graphFetch: accessToken fehlt.");
  }
  if (!path || typeof path !== "string") {
    throw new Error("graphFetch: path fehlt oder ungültig.");
  }
  const url = path.startsWith("http")
    ? path
    : `${GRAPH_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  // Auth-Header injizieren, ohne Caller-Header zu überschreiben.
  const baseHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  const callerHeaders = init.headers || {};
  // Bei Body ohne explizites Content-Type setzen wir JSON nicht automatisch –
  // damit der Aufrufer multipart/binary unverändert nutzen kann.
  const headers = { ...baseHeaders, ...callerHeaders };

  let lastResp = null;
  let attempt = 0;
  // Erste Anfrage + bis zu MAX_RETRIES Wiederholungen.
  while (attempt <= MAX_RETRIES) {
    const resp = await fetch(url, { ...init, headers });
    lastResp = resp;

    // Erfolg oder Client-Fehler (außer 429) → direkt zurückgeben.
    if (resp.status < 400) return resp;
    if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
      return resp;
    }

    // 429 → Retry-After respektieren.
    if (resp.status === 429) {
      if (attempt >= MAX_RETRIES) return resp;
      const retryAfter =
        parseRetryAfterMs(resp.headers && resp.headers.get
          ? resp.headers.get("Retry-After") || resp.headers.get("retry-after")
          : null) ?? BACKOFF_BASE_MS;
      logSafe({
        action: "microsoft_graph.fetch_429",
        status: "pending",
        extra: {
          attempt: attempt + 1,
          retry_after_ms: retryAfter,
          path,
        },
      });
      await sleep(retryAfter);
      attempt += 1;
      continue;
    }

    // 5xx → exponentielles Backoff.
    if (resp.status >= 500) {
      if (attempt >= MAX_RETRIES) return resp;
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
      logSafe({
        action: "microsoft_graph.fetch_5xx",
        status: "pending",
        extra: {
          attempt: attempt + 1,
          delay_ms: delay,
          http_status: resp.status,
          path,
        },
      });
      await sleep(delay);
      attempt += 1;
      continue;
    }

    // Sollte unerreichbar sein.
    return resp;
  }
  return lastResp;
}

// Intern für Tests exportiert (nicht Teil der offiziellen API).
export const __internal = {
  parseRetryAfterMs,
  msUntil,
  GRAPH_BASE,
  TOKEN_URL,
  REFRESH_THRESHOLD_MS,
  MAX_RETRIES,
  BACKOFF_BASE_MS,
  GRAPH_SCOPES,
};
