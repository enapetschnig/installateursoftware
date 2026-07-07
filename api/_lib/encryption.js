// ============================================================
// B4Y SuperAPP – Token-Verschlüsselung (libsodium XChaCha20-Poly1305)
// ------------------------------------------------------------
// Zweck:
//   OAuth-Tokens (z. B. Microsoft Graph access_token / refresh_token)
//   werden VOR dem DB-Insert verschlüsselt und beim Lesen entschlüsselt.
//   Das KEK (Key Encryption Key) liegt ausschließlich in Vercel-Env
//   (process.env.MS_TOKEN_KEK_V<n>), niemals in der Datenbank.
//
// Algorithmus:
//   XChaCha20-Poly1305 via libsodium IETF-AEAD
//   (crypto_aead_xchacha20poly1305_ietf_encrypt/_decrypt). 24-Byte
//   Nonce (random), 32-Byte Key, authentisches AEAD (Poly1305-Tag im
//   Ciphertext angehängt). Identische Sicherheits-Eigenschaften wie
//   die Sumo-Variante `secretbox_xchacha20poly1305_easy`, aber in der
//   Standard-`libsodium-wrappers`-Distribution enthalten.
//
// String-Format (DB-friendly, ASCII-only):
//   base64(nonce) ":" base64(ciphertext) ":v" <kekVersion>
//   Beispiel: "AbC...XYZ:DEF...123:v1"
//
// Key-Rotation:
//   Mehrere KEKs koexistieren (MS_TOKEN_KEK_V1, MS_TOKEN_KEK_V2, …).
//   `decryptToken` nutzt die im Ciphertext kodierte Version,
//   `encryptToken` defaultet auf v1, kann aber explizit auf neue
//   Version umgestellt werden (für Background-Migrationen).
//
// Achtung:
//   Der Ordner `_lib` (Unterstrich) wird von Vercel NICHT als Route behandelt.
// ============================================================

import sodium from "libsodium-wrappers";

// ──────────────────────────────────────────────────────────────
// libsodium-Initialisierung (einmalig, gecached)
// ──────────────────────────────────────────────────────────────

/** @type {Promise<void> | null} */
let sodiumReadyPromise = null;

/**
 * Stellt sicher, dass libsodium initialisiert ist.
 * Mehrfachaufrufe sind sicher und teilen sich dasselbe Promise.
 * @returns {Promise<void>}
 */
async function ensureSodiumReady() {
  if (sodiumReadyPromise === null) {
    sodiumReadyPromise = sodium.ready;
  }
  await sodiumReadyPromise;
}

// ──────────────────────────────────────────────────────────────
// KEK-Cache (decodete 32-Byte-Keys pro Version)
// ──────────────────────────────────────────────────────────────

/** @type {Map<number, Uint8Array>} */
const kekCache = new Map();

/**
 * Lädt den 32-Byte-KEK für die angegebene Version aus process.env.
 * Erwartet Base64-encoded 32 Bytes in MS_TOKEN_KEK_V<version>.
 *
 * @param {number} version  KEK-Version (>= 1)
 * @returns {Uint8Array}    32-Byte-Schlüssel
 * @throws {Error}          wenn Env-Var fehlt oder Key-Länge ungültig ist
 */
function loadKek(version) {
  const cached = kekCache.get(version);
  if (cached) return cached;

  const envName = `MS_TOKEN_KEK_V${version}`;
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`KEK not configured: ${envName}`);
  }

  /** @type {Uint8Array} */
  let key;
  try {
    // Base64-Decoding via Buffer (Node 18+).
    key = new Uint8Array(Buffer.from(raw, "base64"));
  } catch (err) {
    throw new Error(`KEK invalid base64 for ${envName}: ${err?.message || err}`);
  }

  if (key.length !== 32) {
    throw new Error(
      `KEK invalid length for ${envName}: expected 32 bytes, got ${key.length}`,
    );
  }

  kekCache.set(version, key);
  return key;
}

// ──────────────────────────────────────────────────────────────
// Konstanten
// ──────────────────────────────────────────────────────────────

/** XChaCha20-Poly1305 Nonce-Länge in Bytes. */
const NONCE_BYTES = 24;

// ──────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────

/**
 * Verschlüsselt einen Klartext-String mit XChaCha20-Poly1305.
 *
 * @param {string} plaintext         Klartext-Token (UTF-8). Leerer String ist erlaubt.
 * @param {number} [kekVersion=1]    KEK-Version, deren Env-Var verwendet wird.
 * @returns {Promise<string>}        Ciphertext im Format
 *                                   `base64(nonce):base64(ct):v<version>`.
 * @throws {Error}                   wenn der KEK nicht konfiguriert/ungültig ist
 *                                   oder die Eingabe kein String ist.
 *
 * @example
 *   const ct = await encryptToken("ya29.a0…");
 *   // → "Nf+…==:7Hx…:v1"
 */
export async function encryptToken(plaintext, kekVersion = 1) {
  if (typeof plaintext !== "string") {
    throw new Error("encryptToken: plaintext must be a string");
  }
  if (!Number.isInteger(kekVersion) || kekVersion < 1) {
    throw new Error(`encryptToken: invalid kekVersion ${kekVersion}`);
  }

  await ensureSodiumReady();
  const key = loadKek(kekVersion);

  // Frisches, zufälliges 24-Byte Nonce pro Verschlüsselung.
  const nonce = sodium.randombytes_buf(NONCE_BYTES);

  // Plaintext → Bytes (UTF-8). Leerer String ergibt Uint8Array(0); erlaubt.
  const ptBytes = sodium.from_string(plaintext);

  // AEAD ohne Associated Data (additional_data = null).
  const ctBytes = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    ptBytes,
    null, // additional_data
    null, // secret_nonce (immer null bei xchacha20poly1305-IETF)
    nonce,
    key,
  );

  // Base64 (Standard, nicht URL-safe) für DB-Persistenz.
  const nonceB64 = Buffer.from(nonce).toString("base64");
  const ctB64 = Buffer.from(ctBytes).toString("base64");

  return `${nonceB64}:${ctB64}:v${kekVersion}`;
}

/**
 * Entschlüsselt einen mit {@link encryptToken} erzeugten Ciphertext.
 *
 * @param {string} ciphertext        Format `base64(nonce):base64(ct):v<version>`.
 * @param {number} [kekVersion=1]    erwartete KEK-Version – muss zur im
 *                                   Ciphertext kodierten Version passen.
 * @returns {Promise<string>}        Klartext-Token (UTF-8).
 * @throws {Error}                   bei Format-/Versions-Mismatch, fehlendem
 *                                   KEK oder fehlgeschlagener AEAD-Prüfung.
 */
export async function decryptToken(ciphertext, kekVersion = 1) {
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    throw new Error("decryptToken: ciphertext must be a non-empty string");
  }
  if (!Number.isInteger(kekVersion) || kekVersion < 1) {
    throw new Error(`decryptToken: invalid kekVersion ${kekVersion}`);
  }

  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "decryptToken: invalid ciphertext format (expected 'nonce:ct:vN')",
    );
  }
  const [nonceB64, ctB64, versionTag] = parts;

  if (!versionTag || versionTag[0] !== "v") {
    throw new Error(
      `decryptToken: invalid version tag '${versionTag}' (expected 'v<number>')`,
    );
  }
  const embeddedVersion = Number.parseInt(versionTag.slice(1), 10);
  if (!Number.isInteger(embeddedVersion) || embeddedVersion < 1) {
    throw new Error(`decryptToken: invalid version tag '${versionTag}'`);
  }
  if (embeddedVersion !== kekVersion) {
    throw new Error(
      `decryptToken: kek_version mismatch (expected v${kekVersion}, got v${embeddedVersion})`,
    );
  }

  await ensureSodiumReady();
  const key = loadKek(kekVersion);

  /** @type {Uint8Array} */
  let nonce;
  /** @type {Uint8Array} */
  let ct;
  try {
    nonce = new Uint8Array(Buffer.from(nonceB64, "base64"));
    ct = new Uint8Array(Buffer.from(ctB64, "base64"));
  } catch (err) {
    throw new Error(
      `decryptToken: invalid base64 segments: ${err?.message || err}`,
    );
  }

  if (nonce.length !== NONCE_BYTES) {
    throw new Error(
      `decryptToken: invalid nonce length (expected ${NONCE_BYTES}, got ${nonce.length})`,
    );
  }

  /** @type {Uint8Array} */
  let ptBytes;
  try {
    ptBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, // secret_nonce (immer null)
      ct,
      null, // additional_data
      nonce,
      key,
    );
  } catch (err) {
    throw new Error(
      `decryptToken: authentication failed (wrong key or tampered ciphertext): ${err?.message || err}`,
    );
  }

  return sodium.to_string(ptBytes);
}

// ──────────────────────────────────────────────────────────────
// Test-Helpers (NICHT für Produktion verwenden)
// ──────────────────────────────────────────────────────────────

/**
 * Leert die KEK-Caches. Ausschließlich für Unit-Tests, um Env-Änderungen
 * zwischen Tests wirksam werden zu lassen.
 * @internal
 */
export function __resetKekCacheForTests() {
  kekCache.clear();
}
