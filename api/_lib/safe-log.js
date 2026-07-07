// ============================================================
// B4Y SuperAPP – Sicheres strukturiertes Logging
// ------------------------------------------------------------
// Zweck: Produktions-Logs schreiben, ohne Tokens / Email-Bodies /
// sonstige PII (Mailadressen-Inhalte, OAuth-Tokens, Geheimnisse)
// ungewollt nach stdout (= Vercel-Logs) zu schreiben.
//
// Hauptfunktionen:
//   logSafe(opts) → schreibt ein JSON-Objekt via console.log
//   redactJwt(s)  → ersetzt JWT-artige Substrings durch [REDACTED-JWT]
//
// Designentscheidungen:
//   • Field-Whitelist + Key-Denylist auf `extra`. Niemals Komplettobjekte
//     mit unbekannten Feldern reinlassen.
//   • Strings >1000 Zeichen oder mit JWT-Prefix `eyJ` werden komplett
//     redacted (nicht nur gekürzt) – ein gekürztes JWT ist immer noch
//     gefährlich für Logs.
//   • Strings 200–1000 Zeichen werden auf 200 Zeichen + Marker gekürzt.
//   • Action/Error-Felder werden ebenfalls durch redactJwt() gefiltert.
//
// Der Ordner `_lib` (Unterstrich) wird von Vercel NICHT als Route behandelt.
// ============================================================

const MAX_EXTRA_STRING_LEN = 200;
const HARD_REDACT_LEN = 1000;
const TRUNCATION_MARKER = "…[truncated]";
const REDACT_MARKER = "[REDACTED]";
const JWT_REDACT_MARKER = "[REDACTED-JWT]";

// Verbotene Keys (case-insensitive Substring-Match) für `extra`.
const FORBIDDEN_KEY_SUBSTRINGS = [
  "token",
  "password",
  "secret",
  "jwt",
  "bearer",
  "body",
  "content",
  "html",
];

// JWT-Pattern: drei Base64URL-Segmente getrennt durch '.', führendes "eyJ"
// (das ist die Base64URL-Repräsentation von '{"' am Anfang eines JWT-Headers).
const JWT_REGEX = /eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/g;

/**
 * Ersetzt alle JWT-artigen Substrings in `text` mit [REDACTED-JWT].
 * Nicht-Strings werden unverändert zurückgegeben.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function redactJwt(text) {
  if (typeof text !== "string") {
    return text === undefined || text === null ? "" : String(text);
  }
  return text.replace(JWT_REGEX, JWT_REDACT_MARKER);
}

/**
 * Prüft, ob ein Key in `extra` verboten ist (case-insensitive, Substring).
 * @param {string} key
 */
function isForbiddenKey(key) {
  const lower = key.toLowerCase();
  return FORBIDDEN_KEY_SUBSTRINGS.some((bad) => lower.includes(bad));
}

/**
 * Sanitisiert einen einzelnen extra-Wert.
 * Erlaubt: string (gekürzt/redacted), number (finite), boolean.
 * Alles andere → null (wird vom Aufrufer ausgefiltert).
 *
 * @param {unknown} value
 * @returns {string|number|boolean|null}
 */
function sanitizeExtraValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    // 1. JWT-Pattern → komplett redacten
    if (value.startsWith("eyJ")) return REDACT_MARKER;
    // 2. Sehr lange Strings → komplett redacten (nicht nur kürzen)
    if (value.length > HARD_REDACT_LEN) return REDACT_MARKER;
    // 3. JWTs irgendwo im Text → JWT-Substrings ersetzen
    let cleaned = redactJwt(value);
    // 4. Auf MAX_EXTRA_STRING_LEN kürzen
    if (cleaned.length > MAX_EXTRA_STRING_LEN) {
      cleaned = cleaned.slice(0, MAX_EXTRA_STRING_LEN) + TRUNCATION_MARKER;
    }
    return cleaned;
  }
  return null;
}

/**
 * Wendet Key-Denylist + Value-Whitelist auf das extra-Objekt an.
 * @param {Record<string, unknown>|undefined} extra
 * @returns {Record<string, string|number|boolean>}
 */
function sanitizeExtra(extra) {
  /** @type {Record<string, string|number|boolean>} */
  const out = {};
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return out;

  for (const [key, raw] of Object.entries(extra)) {
    if (typeof key !== "string" || key.length === 0) continue;
    if (isForbiddenKey(key)) continue;
    const v = sanitizeExtraValue(raw);
    if (v === null) continue;
    out[key] = v;
  }
  return out;
}

/**
 * Strukturiertes Log via console.log (JSON in einer Zeile).
 *
 * @param {{
 *   userId?: string,
 *   orgId?: string,
 *   action: string,
 *   status: "ok"|"error"|"pending",
 *   durationMs?: number,
 *   error?: string,
 *   extra?: Record<string, string|number|boolean>
 * }} opts
 */
export function logSafe(opts) {
  const o = opts && typeof opts === "object" ? opts : {};

  const action = typeof o.action === "string" && o.action.length > 0 ? o.action : "unknown";
  const status =
    o.status === "ok" || o.status === "error" || o.status === "pending" ? o.status : "ok";

  const record = {
    ts: new Date().toISOString(),
    level: "info",
    action: redactJwt(action),
    status,
  };

  if (typeof o.userId === "string" && o.userId.length > 0) {
    record.userId = o.userId.length > 200 ? REDACT_MARKER : o.userId;
  }
  if (typeof o.orgId === "string" && o.orgId.length > 0) {
    record.orgId = o.orgId.length > 200 ? REDACT_MARKER : o.orgId;
  }
  if (typeof o.durationMs === "number" && Number.isFinite(o.durationMs)) {
    record.durationMs = o.durationMs;
  }
  if (typeof o.error === "string" && o.error.length > 0) {
    // Errors koennen JWTs enthalten (z.B. aus stack traces) → redacten.
    let err = redactJwt(o.error);
    if (err.length > HARD_REDACT_LEN) {
      err = err.slice(0, HARD_REDACT_LEN) + TRUNCATION_MARKER;
    }
    record.error = err;
  }

  const safeExtra = sanitizeExtra(o.extra);
  for (const [k, v] of Object.entries(safeExtra)) {
    // Reservierte Top-Level-Keys nicht überschreiben.
    if (k in record) continue;
    record[k] = v;
  }

  // Eine Zeile pro Log – Vercel-/CloudWatch-freundlich.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
}
