// ============================================================
// B4Y SuperAPP – Microsoft OAuth Callback
// ------------------------------------------------------------
// GET /api/auth/microsoft-callback?code=...&state=...
//
// Empfaengt den Redirect von Microsoft nach erfolgreichem User-Consent.
// Verifiziert state-Cookie (HMAC), tauscht den code gegen ein Token-
// Paar, validiert das id_token (iss, aud, nonce, tid), verschluesselt
// die Tokens und speichert sie in microsoft_oauth_tokens.
//
// Fluss:
//   1. Cookie lesen + HMAC-Signature-Check (timingSafeEqual)
//   2. state aus Query mit state aus Cookie vergleichen
//   3. POST an /token mit code + code_verifier
//   4. id_token validieren (iss, aud, nonce, tid non-empty)
//   5. encryptToken(access_token) + encryptToken(refresh_token)
//   6. UPSERT in microsoft_oauth_tokens via Service-Role
//      (RLS-Kontext hier fehlt, User-ID kommt aus Cookie)
//   7. Cookie loeschen, 302 zu /app/einstellungen?tab=integrationen&connected=ok
//
// Sicherheits-Hinweise:
//   * Kein Datenleak in URL-Query: Access-Token verlaesst NIE die HTTPS-
//     Response-Grenze der Vercel-Function. Der Client sieht nur den Redirect.
//   * Bei Fehlern immer generischen ?connected=fail-Redirect, nie technische
//     Details im User-facing URL (koennte in History/Analytics landen).
// ============================================================

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { encryptToken } from "../_lib/encryption.js";
import { logSafe } from "../_lib/safe-log.js";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const JWKS_URL =
  "https://login.microsoftonline.com/common/discovery/v2.0/keys";
const COOKIE_NAME = "b4y_oauth_state";
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";

// Wohin wir den Browser nach Erfolg/Fehler zurueckwerfen.
const SETTINGS_INTEGRATIONS_URL = "/app/einstellungen?tab=integrationen";
const SUCCESS_URL = `${SETTINGS_INTEGRATIONS_URL}&connected=ok`;
const FAIL_URL = `${SETTINGS_INTEGRATIONS_URL}&connected=fail`;

const COOKIE_MAX_AGE_SECONDS = 300;

// ── Helper ───────────────────────────────────────────────────
function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

function parseCookieHeader(rawHeader) {
  const out = {};
  if (typeof rawHeader !== "string" || rawHeader.length === 0) return out;
  for (const part of rawHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Verifiziert das signierte state-Cookie. Wirft bei Mismatch. Liefert das
 * geparste Payload {state, codeVerifier, userId, nonce, ts} bei Erfolg.
 */
function verifyCookie(cookieValue, secret) {
  if (typeof cookieValue !== "string" || cookieValue.length === 0) {
    throw new Error("cookie empty");
  }
  const idx = cookieValue.lastIndexOf(".");
  if (idx < 0) throw new Error("cookie malformed");
  const dataB64 = cookieValue.slice(0, idx);
  const sigB64 = cookieValue.slice(idx + 1);

  const expected = createHmac("sha256", secret).update(dataB64).digest();
  const provided = fromBase64Url(sigB64);
  if (expected.length !== provided.length) {
    throw new Error("cookie sig length mismatch");
  }
  if (!timingSafeEqual(expected, provided)) {
    throw new Error("cookie sig invalid");
  }

  const jsonBuf = fromBase64Url(dataB64);
  let payload;
  try {
    payload = JSON.parse(jsonBuf.toString("utf8"));
  } catch (e) {
    throw new Error("cookie json invalid");
  }

  if (
    !payload ||
    typeof payload.state !== "string" ||
    typeof payload.codeVerifier !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.ts !== "number"
  ) {
    throw new Error("cookie payload schema");
  }
  // Cookie-Age gegen Server-Uhr gegenchecken (Client kann Cookie zwar nicht
  // manipulieren, aber ein alter Wert ist auch nicht mehr gueltig).
  if (Date.now() - payload.ts > COOKIE_MAX_AGE_SECONDS * 1000 + 30_000) {
    throw new Error("cookie expired");
  }

  return payload;
}

/**
 * Dekodiert die drei Segmente eines JWT und liefert Header + Claims.
 * Verifiziert die Signatur NICHT — diese Funktion nur zum Auslesen von
 * nonce, iss, aud etc. Signatur-Check laeuft separat (JWKS).
 */
function decodeJwtSegments(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("id_token malformed");
  const header = JSON.parse(fromBase64Url(parts[0]).toString("utf8"));
  const claims = JSON.parse(fromBase64Url(parts[1]).toString("utf8"));
  return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, sigB64: parts[2] };
}

// JWKS-Cache (pro Function-Instanz) — Keys rotieren selten.
let _jwksCache = null;
let _jwksFetchedAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h

async function fetchJwks() {
  const now = Date.now();
  if (_jwksCache && now - _jwksFetchedAt < JWKS_TTL_MS) return _jwksCache;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error(`jwks fetch failed: HTTP ${r.status}`);
  const body = await r.json();
  _jwksCache = body;
  _jwksFetchedAt = now;
  return _jwksCache;
}

/**
 * Verifiziert das id_token vollstaendig:
 *   - Signatur gegen Microsoft-JWKS (RS256 nur)
 *   - iss beginnt mit "https://login.microsoftonline.com/"
 *   - aud === AZURE_CLIENT_ID
 *   - nonce === Cookie-nonce
 *   - tid ist non-empty
 *   - exp in der Zukunft, iat in der Vergangenheit (Skew 60s)
 */
async function verifyIdToken(idToken, expectedNonce, expectedAud) {
  const { header, claims, signingInput, sigB64 } = decodeJwtSegments(idToken);
  if (header.alg !== "RS256") throw new Error("id_token alg not RS256");
  if (!header.kid) throw new Error("id_token missing kid");

  const jwks = await fetchJwks();
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) throw new Error(`id_token kid ${header.kid} not in JWKS`);

  // JWK → PEM via Node Crypto's KeyObject.
  const { createPublicKey, verify } = await import("node:crypto");
  const pubKey = createPublicKey({ key: jwk, format: "jwk" });
  const sigBytes = fromBase64Url(sigB64);
  const ok = verify(
    "RSA-SHA256",
    Buffer.from(signingInput, "ascii"),
    pubKey,
    sigBytes,
  );
  if (!ok) throw new Error("id_token signature invalid");

  if (
    typeof claims.iss !== "string" ||
    !claims.iss.startsWith("https://login.microsoftonline.com/")
  ) {
    throw new Error(`id_token iss unexpected: ${claims.iss}`);
  }
  if (claims.aud !== expectedAud) {
    throw new Error("id_token aud mismatch");
  }
  if (claims.nonce !== expectedNonce) {
    throw new Error("id_token nonce mismatch");
  }
  if (typeof claims.tid !== "string" || claims.tid.length === 0) {
    throw new Error("id_token tid missing");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (typeof claims.exp !== "number" || claims.exp + skew < nowSec) {
    throw new Error("id_token expired");
  }
  if (typeof claims.iat === "number" && claims.iat - skew > nowSec) {
    throw new Error("id_token iat in future");
  }

  return claims;
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  const started = Date.now();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Nur GET erlaubt." });
    return;
  }

  const cookieSecret = process.env.OAUTH_COOKIE_KEY || "";
  const clientId = process.env.AZURE_CLIENT_ID || "";
  const clientSecret = process.env.AZURE_CLIENT_SECRET || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || "";
  if (!cookieSecret || !clientId || !clientSecret || !serviceKey || !redirectUri) {
    logSafe({
      action: "ms.oauth.callback",
      status: "error",
      error: "config missing",
    });
    res.status(302).setHeader("Location", FAIL_URL + "&reason=config").end();
    return;
  }

  // 1) Cookie lesen + verifizieren
  const cookies = parseCookieHeader(req.headers.cookie || "");
  let cookiePayload;
  try {
    cookiePayload = verifyCookie(cookies[COOKIE_NAME] || "", cookieSecret);
  } catch (e) {
    logSafe({
      action: "ms.oauth.callback",
      status: "error",
      error: `cookie: ${e?.message || e}`,
    });
    res.status(302).setHeader("Location", FAIL_URL + "&reason=state").end();
    return;
  }

  // Cookie sofort loeschen — auch bei Fehlern (unten). Wir schreiben den
  // Set-Cookie-Header am Ende in der Response.
  const clearCookie = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

  // 2) state-Vergleich
  const stateFromQuery =
    req && req.query && typeof req.query.state === "string" ? req.query.state : "";
  const stateCookie = cookiePayload.state;
  if (!stateFromQuery || stateFromQuery !== stateCookie) {
    logSafe({
      action: "ms.oauth.callback",
      status: "error",
      error: "state mismatch",
    });
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=state")
      .end();
    return;
  }

  // Query-Fehler-Handling (User hat abgelehnt oder Azure lehnt ab)
  if (req.query && typeof req.query.error === "string") {
    logSafe({
      userId: cookiePayload.userId,
      action: "ms.oauth.callback",
      status: "error",
      error: `azure_error: ${req.query.error}`,
    });
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=denied")
      .end();
    return;
  }

  const code = req && req.query && typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=nocode")
      .end();
    return;
  }

  // 3) Token-Exchange
  let tokenData;
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: cookiePayload.codeVerifier,
    });
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    tokenData = await r.json().catch(() => ({}));
    if (!r.ok) {
      logSafe({
        userId: cookiePayload.userId,
        action: "ms.oauth.callback",
        status: "error",
        error: `token_http_${r.status}: ${String(tokenData?.error || "").slice(0, 80)}`,
      });
      res
        .status(302)
        .setHeader("Set-Cookie", clearCookie)
        .setHeader("Location", FAIL_URL + "&reason=token")
        .end();
      return;
    }
  } catch (e) {
    logSafe({
      action: "ms.oauth.callback",
      status: "error",
      error: `token fetch: ${e?.message || e}`,
    });
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=network")
      .end();
    return;
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const idToken = tokenData.id_token;
  const expiresIn = Number(tokenData.expires_in) || 3600;
  const scopesGranted =
    typeof tokenData.scope === "string" && tokenData.scope.length > 0
      ? tokenData.scope.split(/\s+/).filter(Boolean)
      : [];

  if (!accessToken || !idToken) {
    logSafe({
      userId: cookiePayload.userId,
      action: "ms.oauth.callback",
      status: "error",
      error: "token response missing access/id_token",
    });
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=token")
      .end();
    return;
  }

  // 4) id_token validieren
  let idClaims;
  try {
    idClaims = await verifyIdToken(idToken, cookiePayload.nonce, clientId);
  } catch (e) {
    logSafe({
      userId: cookiePayload.userId,
      action: "ms.oauth.callback",
      status: "error",
      error: `id_token: ${e?.message || e}`,
    });
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=idtoken")
      .end();
    return;
  }

  const microsoftUserId =
    idClaims.preferred_username || idClaims.upn || idClaims.email || idClaims.sub;
  const microsoftTenantId = idClaims.tid;

  // 5) Tokens verschluesseln
  let accessTokenEnc, refreshTokenEnc;
  try {
    accessTokenEnc = await encryptToken(accessToken);
    refreshTokenEnc = refreshToken ? await encryptToken(refreshToken) : null;
  } catch (e) {
    logSafe({
      userId: cookiePayload.userId,
      action: "ms.oauth.callback",
      status: "error",
      error: `encrypt: ${e?.message || e}`,
    });
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=encrypt")
      .end();
    return;
  }

  // 6) UPSERT via Service-Role (RLS-Kontext im Callback nicht verfuegbar).
  //    Wir lesen zuerst die current_org_id des Users aus profiles / user_
  //    memberships — Vermutung des Plans ist, dass das ueber current_org_id()
  //    als SQL-Function laeuft. Da wir hier ohne User-JWT sind, ermitteln
  //    wir die org_id durch einen kleinen RPC-Call mit setzem role via
  //    Service-Role: SELECT org_id FROM user_active_org WHERE user_id = ?
  //    Falls es keine Tabelle gibt, faellt der Insert-Default auf NULL —
  //    das ist der Bug, den wir vermeiden wollen.
  //
  //    Vereinfachung: wir setzen organization_id explizit ueber eine
  //    Query gegen `user_organization_memberships` (Konvention der App).
  const admin = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Aktive Org des Users ermitteln. Die App nutzt public.memberships
  // (siehe current_org_id() SQL-Function: SELECT organization_id FROM
  // public.memberships WHERE user_id = auth.uid() LIMIT 1).
  let orgId = null;
  try {
    const { data } = await admin
      .from("memberships")
      .select("organization_id")
      .eq("user_id", cookiePayload.userId)
      .limit(1)
      .maybeSingle();
    if (data?.organization_id) orgId = data.organization_id;
  } catch {
    /* fall-through */
  }
  if (!orgId) {
    logSafe({
      userId: cookiePayload.userId,
      action: "ms.oauth.callback",
      status: "error",
      error: "no org_id for user",
    });
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=noorg")
      .end();
    return;
  }

  const expiresAtIso = new Date(Date.now() + expiresIn * 1000).toISOString();

  try {
    const { error } = await admin
      .from("microsoft_oauth_tokens")
      .upsert(
        {
          organization_id: orgId,
          user_id: cookiePayload.userId,
          microsoft_user_id: String(microsoftUserId || ""),
          microsoft_tenant_id: microsoftTenantId,
          access_token_enc: accessTokenEnc,
          refresh_token_enc: refreshTokenEnc,
          kek_version: 1,
          expires_at: expiresAtIso,
          scopes: scopesGranted,
          last_refreshed_at: new Date().toISOString(),
          is_active: true,
          error_count: 0,
          last_error_message: null,
        },
        { onConflict: "organization_id,user_id" },
      );
    if (error) throw new Error(error.message || "upsert failed");
  } catch (e) {
    logSafe({
      userId: cookiePayload.userId,
      action: "ms.oauth.callback",
      status: "error",
      error: `upsert: ${e?.message || e}`,
    });
    res
      .status(302)
      .setHeader("Set-Cookie", clearCookie)
      .setHeader("Location", FAIL_URL + "&reason=db")
      .end();
    return;
  }

  logSafe({
    userId: cookiePayload.userId,
    action: "ms.oauth.callback",
    status: "ok",
    durationMs: Date.now() - started,
    extra: { microsoft_tenant_id: microsoftTenantId, scopes: scopesGranted.length },
  });

  res
    .status(302)
    .setHeader("Set-Cookie", clearCookie)
    .setHeader("Location", SUCCESS_URL)
    .end();
}

export const __internals = {
  verifyCookie,
  decodeJwtSegments,
  parseCookieHeader,
  SUCCESS_URL,
  FAIL_URL,
};
