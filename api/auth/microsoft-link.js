// ============================================================
// B4Y SuperAPP – Microsoft OAuth Link (Start-Endpoint)
// ------------------------------------------------------------
// GET /api/auth/microsoft-link
//
// Startet den OAuth-Flow gegen Microsoft Entra:
//   1. verifyUser aus Supabase-JWT (Query-Param ?access_token=...
//      wegen Browser-Redirect; Alt-Route: Authorization-Header
//      falls per Fetch aufgerufen)
//   2. Generiert state (32 zufaellige Bytes) + PKCE code_verifier
//      (43-128 Zeichen, RFC 7636) + nonce fuer id_token-Binding
//   3. HMAC-signed Cookie `b4y_oauth_state` mit
//      {state, codeVerifier, userId, nonce, ts}
//      → SameSite=Lax, HttpOnly, Secure, Max-Age=300
//   4. 302 auf Microsoft /authorize mit code_challenge=S256,
//      Scopes, redirect_uri, response_mode=query, prompt=consent
//      (nur bei allererstem Consent — kann Frontend-Param steuern).
//
// Sicherheit:
//   * redirect_uri ist Server-Konstante MICROSOFT_REDIRECT_URI.
//     KEIN Query-Param → Open-Redirect blockiert.
//   * state, codeVerifier, nonce sind pro Request frisch (crypto.
//     randomBytes) und laufen nach 5 min ab.
//   * Cookie HMAC-signed via OAUTH_COOKIE_KEY (Env, 32-Byte
//     base64). Callback prueft Signatur strikt (timingSafeEqual).
// ============================================================

import { randomBytes, createHmac, createHash, timingSafeEqual } from "node:crypto";
import { bearerFromRequest, verifyUser } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

const AUTHORIZE_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

// Delegated Scopes — MUESSEN mit denen in microsoft-graph.js und der
// Azure-App-Registration uebereinstimmen. Explizit statt .default.
const SCOPES =
  "offline_access Mail.Read Mail.Send User.Read openid profile email";

const COOKIE_NAME = "b4y_oauth_state";
const COOKIE_MAX_AGE_SECONDS = 300;

/**
 * Base64URL-Encoding ohne Padding (RFC 7515 §2). Nutzen wir sowohl fuer
 * PKCE-code_challenge als auch fuer den state-Cookie-Payload.
 */
function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * PKCE code_challenge (RFC 7636 §4.2): S256(BASE64URL(SHA256(verifier))).
 * Der code_verifier ist bereits Base64URL-encoded, also nur der Hash noetig.
 */
function pkceChallenge(verifier) {
  const hash = createHash("sha256").update(verifier, "ascii").digest();
  return toBase64Url(hash);
}

/**
 * HMAC-signiert das Cookie-Payload. Rueckgabe im Format
 * base64url(json).base64url(hmac). Der Callback verifiziert beide Teile.
 */
function signCookie(payload, secret) {
  const json = JSON.stringify(payload);
  const dataB64 = toBase64Url(json);
  const hmac = createHmac("sha256", secret).update(dataB64).digest();
  const sigB64 = toBase64Url(hmac);
  return `${dataB64}.${sigB64}`;
}

/**
 * Loest das Query-Token aus. Wir akzeptieren beide Wege — Bearer-Header
 * (Fetch mit credentials) ODER access_token in der URL (klassischer
 * Browser-Redirect via <a href=...>). Der Frontend-Button wird typisch
 * href={"/api/auth/microsoft-link?access_token=" + token} bauen.
 */
async function resolveUser(req) {
  const headerToken = bearerFromRequest(req);
  if (headerToken) {
    const u = await verifyUser(headerToken);
    if (u) return u;
  }
  const qToken =
    req && req.query && typeof req.query.access_token === "string"
      ? req.query.access_token
      : "";
  if (qToken) {
    const u = await verifyUser(qToken);
    if (u) return u;
  }
  return null;
}

export default async function handler(req, res) {
  const started = Date.now();

  // Zwei Aufruf-Muster:
  //   * POST + Bearer-Header (bevorzugt, empfohlen): Frontend macht fetch(),
  //     erhaelt JSON {target, ...}, setzt window.location.href = target.
  //     Kein JWT in URL / Vercel-Logs / Browser-History; robust auch bei
  //     Corporate-Proxies / Ad-Blockern die lange Query-Params filtern.
  //   * GET + ?access_token=… (deprecated, Legacy): weiter unterstuetzt, weil
  //     evtl. Browser mit cached-Session zurueckkommen; Response ist 302 wie
  //     frueher.
  const method = req.method;
  const isPost = method === "POST";
  const isGet = method === "GET";
  if (!isPost && !isGet) {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Nur GET oder POST erlaubt." });
    return;
  }

  const cookieSecret = process.env.OAUTH_COOKIE_KEY || "";
  const clientId = process.env.AZURE_CLIENT_ID || "";
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || "";
  if (!cookieSecret || !clientId || !redirectUri) {
    logSafe({
      action: "ms.oauth.link",
      status: "error",
      error: "config missing (OAUTH_COOKIE_KEY / AZURE_CLIENT_ID / MICROSOFT_REDIRECT_URI)",
    });
    res.status(500).json({ error: "Microsoft-Anbindung nicht konfiguriert." });
    return;
  }

  const user = await resolveUser(req);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }

  // 32 Bytes → 43 Zeichen Base64URL, im PKCE-Verifier-Wertebereich (43-128).
  const state = toBase64Url(randomBytes(32));
  const codeVerifier = toBase64Url(randomBytes(32));
  const nonce = toBase64Url(randomBytes(16));
  const codeChallenge = pkceChallenge(codeVerifier);

  const payload = {
    state,
    codeVerifier,
    userId: user.id,
    nonce,
    ts: Date.now(),
  };
  const signedCookie = signCookie(payload, cookieSecret);

  // prompt=consent: bei POST aus Body, bei GET aus Query.
  const promptSrc = isPost
    ? (req.body && typeof req.body === "object" ? req.body.prompt : null) ??
      (typeof req.body === "string" ? tryParseJsonPrompt(req.body) : null)
    : req.query?.prompt;
  const forceConsent = String(promptSrc || "") === "consent";

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    nonce,
  });
  if (forceConsent) params.set("prompt", "consent");

  // Cookie: HttpOnly + Secure + SameSite=Lax (Lax notwendig damit der Callback
  // per Top-Level-Redirect das Cookie wieder mitschickt).
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${signedCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  );

  const target = `${AUTHORIZE_URL}?${params.toString()}`;

  logSafe({
    userId: user.id,
    action: "ms.oauth.link",
    status: "ok",
    durationMs: Date.now() - started,
    extra: { force_consent: forceConsent, method },
  });

  if (isPost) {
    // Bevorzugter Weg: JSON. Frontend macht window.location.href = target.
    res.status(200).json({ target });
    return;
  }
  // Legacy GET: 302 wie frueher.
  res.status(302).setHeader("Location", target).end();
}

/** Best-effort JSON-Body-Parsing (POST) — Vercel liefert body ggf. als String. */
function tryParseJsonPrompt(bodyStr) {
  try {
    const j = JSON.parse(bodyStr);
    return j?.prompt || null;
  } catch {
    return null;
  }
}

// Test-Exports (nicht fuer Produktion aufrufen).
export const __internals = { signCookie, pkceChallenge, toBase64Url };
