// ============================================================
// Unit-Tests für api/_lib/encryption.js
// ------------------------------------------------------------
// Deckt ab:
//   • Roundtrip encrypt→decrypt (ASCII, UTF-8, lang)
//   • KEK-Version-Mismatch wirft
//   • Fehlender KEK in Env wirft
//   • Leerer String wird unterstützt
//   • Verschiedene Tokens haben verschiedene Nonces (Randomness)
//   • Format-Robustheit (kaputter Ciphertext, falsche Nonce-Länge)
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptToken,
  decryptToken,
  __resetKekCacheForTests,
} from "./encryption.js";

/** Erzeugt einen base64-kodierten 32-Byte-Schlüssel (für Tests). */
function makeKekBase64(seed = 0) {
  const buf = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) buf[i] = (seed + i) & 0xff;
  return buf.toString("base64");
}

/**
 * Setzt eine Env-Var auf einen Wert (oder löscht sie, wenn value === undefined).
 * Liefert die Aufräum-Funktion.
 */
function setEnv(name, value) {
  const prev = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  };
}

// ──────────────────────────────────────────────────────────────

describe("encryption: encryptToken / decryptToken", () => {
  /** @type {Array<() => void>} */
  let cleanups = [];

  beforeEach(() => {
    __resetKekCacheForTests();
    cleanups = [];
    // Default-KEK v1 für die meisten Tests
    cleanups.push(setEnv("MS_TOKEN_KEK_V1", makeKekBase64(1)));
  });

  afterEach(() => {
    for (const fn of cleanups) fn();
    __resetKekCacheForTests();
  });

  it("roundtrip: ASCII-Token wird korrekt entschlüsselt", async () => {
    const plain = "ya29.a0AfH6SMBexampleAccessToken";
    const ct = await encryptToken(plain);
    expect(typeof ct).toBe("string");
    expect(ct.split(":")).toHaveLength(3);
    expect(ct.endsWith(":v1")).toBe(true);

    const back = await decryptToken(ct);
    expect(back).toBe(plain);
  });

  it("roundtrip: UTF-8/Sonderzeichen werden korrekt entschlüsselt", async () => {
    const plain = "Token mit ÄÖÜß und Emoji 🔐💡 + 中文";
    const ct = await encryptToken(plain);
    const back = await decryptToken(ct);
    expect(back).toBe(plain);
  });

  it("roundtrip: lange Tokens (>2 KB) funktionieren", async () => {
    const plain = "x".repeat(2048) + "🚀" + "y".repeat(1024);
    const ct = await encryptToken(plain);
    const back = await decryptToken(ct);
    expect(back).toBe(plain);
  });

  it("leerer String wird unterstützt", async () => {
    const ct = await encryptToken("");
    expect(ct.endsWith(":v1")).toBe(true);
    const back = await decryptToken(ct);
    expect(back).toBe("");
  });

  it("verschiedene Aufrufe erzeugen unterschiedliche Nonces (Randomness)", async () => {
    const plain = "stable-input";
    const a = await encryptToken(plain);
    const b = await encryptToken(plain);
    const c = await encryptToken(plain);

    // Komplette Ciphertexte müssen sich unterscheiden …
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);

    // … und insbesondere die Nonce-Segmente.
    const nonceA = a.split(":")[0];
    const nonceB = b.split(":")[0];
    const nonceC = c.split(":")[0];
    expect(nonceA).not.toBe(nonceB);
    expect(nonceB).not.toBe(nonceC);
    expect(nonceA).not.toBe(nonceC);

    // Aber alle entschlüsseln korrekt zurück.
    expect(await decryptToken(a)).toBe(plain);
    expect(await decryptToken(b)).toBe(plain);
    expect(await decryptToken(c)).toBe(plain);
  });

  it("kek_version-Mismatch beim Entschlüsseln wirft", async () => {
    // v2 zusätzlich konfigurieren
    cleanups.push(setEnv("MS_TOKEN_KEK_V2", makeKekBase64(2)));
    __resetKekCacheForTests();

    const ct = await encryptToken("secret", 2);
    expect(ct.endsWith(":v2")).toBe(true);

    // Aufruf mit erwartetem v1, Ciphertext ist aber v2 → muss werfen
    await expect(decryptToken(ct, 1)).rejects.toThrow(/kek_version mismatch/i);
  });

  it("fehlender KEK in Env wirft beim Verschlüsseln", async () => {
    // v3 ist nicht gesetzt
    await expect(encryptToken("x", 3)).rejects.toThrow(
      /KEK not configured: MS_TOKEN_KEK_V3/,
    );
  });

  it("fehlender KEK in Env wirft beim Entschlüsseln", async () => {
    // Verschlüsseln mit v1, dann v1 entfernen → Decrypt muss werfen
    const ct = await encryptToken("hello");
    cleanups.push(setEnv("MS_TOKEN_KEK_V1", undefined));
    __resetKekCacheForTests();

    await expect(decryptToken(ct, 1)).rejects.toThrow(
      /KEK not configured: MS_TOKEN_KEK_V1/,
    );
  });

  it("falsche kekVersion-Parameter werden abgelehnt", async () => {
    await expect(encryptToken("x", 0)).rejects.toThrow(/invalid kekVersion/i);
    await expect(encryptToken("x", -1)).rejects.toThrow(/invalid kekVersion/i);
    await expect(encryptToken("x", 1.5)).rejects.toThrow(/invalid kekVersion/i);
  });

  it("encryptToken lehnt Nicht-String-Plaintext ab", async () => {
    // @ts-expect-error – Laufzeit-Check
    await expect(encryptToken(null)).rejects.toThrow(/must be a string/);
    // @ts-expect-error – Laufzeit-Check
    await expect(encryptToken(undefined)).rejects.toThrow(/must be a string/);
    // @ts-expect-error – Laufzeit-Check
    await expect(encryptToken(123)).rejects.toThrow(/must be a string/);
  });

  it("decryptToken lehnt kaputtes Format ab", async () => {
    await expect(decryptToken("not-a-ciphertext")).rejects.toThrow(
      /invalid ciphertext format/i,
    );
    await expect(decryptToken("a:b")).rejects.toThrow(
      /invalid ciphertext format/i,
    );
    await expect(decryptToken("a:b:c:d")).rejects.toThrow(
      /invalid ciphertext format/i,
    );
    await expect(decryptToken("a:b:x1")).rejects.toThrow(
      /invalid version tag/i,
    );
    await expect(decryptToken("")).rejects.toThrow(/non-empty string/i);
  });

  it("decryptToken erkennt manipuliertes Ciphertext (AEAD-Auth)", async () => {
    const ct = await encryptToken("super-secret-token");
    const [nonceB64, ctB64, ver] = ct.split(":");

    // Letztes Byte des Ciphertext-Segments flippen.
    const ctBytes = Buffer.from(ctB64, "base64");
    ctBytes[ctBytes.length - 1] ^= 0x01;
    const tampered = `${nonceB64}:${ctBytes.toString("base64")}:${ver}`;

    await expect(decryptToken(tampered)).rejects.toThrow(
      /authentication failed/i,
    );
  });

  it("decryptToken erkennt falsche Nonce-Länge", async () => {
    const shortNonce = Buffer.alloc(10).toString("base64");
    const fakeCt = Buffer.alloc(32).toString("base64");
    await expect(
      decryptToken(`${shortNonce}:${fakeCt}:v1`),
    ).rejects.toThrow(/invalid nonce length/i);
  });

  it("entschlüsseln mit falschem KEK schlägt AEAD-Auth fehl", async () => {
    const ct = await encryptToken("payload");

    // KEK v1 gegen anderen Key tauschen → AEAD muss fehlschlagen.
    cleanups.push(setEnv("MS_TOKEN_KEK_V1", makeKekBase64(99)));
    __resetKekCacheForTests();

    await expect(decryptToken(ct)).rejects.toThrow(/authentication failed/i);
  });

  it("KEK mit falscher Länge wird abgelehnt", async () => {
    cleanups.push(
      setEnv("MS_TOKEN_KEK_V7", Buffer.alloc(16).toString("base64")),
    );
    __resetKekCacheForTests();
    await expect(encryptToken("x", 7)).rejects.toThrow(
      /KEK invalid length for MS_TOKEN_KEK_V7/,
    );
  });
});
