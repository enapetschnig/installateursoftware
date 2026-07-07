// ============================================================
// Tests fuer api/_lib/safe-log.js
// ------------------------------------------------------------
// Wir kapern console.log um die strukturierten Log-Zeilen einzusammeln
// und pruefen, dass nichts Sensibles durchrutscht.
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { logSafe, redactJwt } from "./safe-log.js";

/** @type {string[]} */
let captured;
/** @type {import("vitest").MockInstance | null} */
let spy;

beforeEach(() => {
  captured = [];
  spy = vi.spyOn(console, "log").mockImplementation((...args) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  });
});

afterEach(() => {
  spy?.mockRestore();
  spy = null;
});

/** Bequemes Parsen der ersten gecapturten Log-Zeile als JSON. */
function parseFirst() {
  expect(captured.length, "expected at least one console.log line").toBeGreaterThanOrEqual(1);
  return JSON.parse(captured[0]);
}

describe("redactJwt", () => {
  it("ersetzt JWT-Substrings durch [REDACTED-JWT]", () => {
    const sample =
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc123_-XYZ failed";
    const out = redactJwt(sample);
    expect(out).toContain("[REDACTED-JWT]");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("ersetzt mehrere JWTs in einem String", () => {
    const a = "eyJabc.eyJdef.ghi";
    const b = "eyJxyz.eyJpqr.stu";
    const out = redactJwt(`token1=${a} token2=${b}`);
    const matches = out.match(/\[REDACTED-JWT\]/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(out).not.toContain("eyJabc");
    expect(out).not.toContain("eyJxyz");
  });

  it("laesst harmlose Strings unveraendert", () => {
    expect(redactJwt("hello world")).toBe("hello world");
    expect(redactJwt("")).toBe("");
  });

  it("gibt fuer Nicht-Strings einen leeren / gecasteten String zurueck", () => {
    expect(redactJwt(undefined)).toBe("");
    expect(redactJwt(null)).toBe("");
    expect(redactJwt(42)).toBe("42");
  });
});

describe("logSafe – Grundverhalten", () => {
  it("produziert validen JSON mit den Pflichtfeldern", () => {
    logSafe({
      userId: "user-1",
      orgId: "org-1",
      action: "ms_graph.send",
      status: "ok",
      durationMs: 123,
    });

    const rec = parseFirst();
    expect(rec.action).toBe("ms_graph.send");
    expect(rec.status).toBe("ok");
    expect(rec.userId).toBe("user-1");
    expect(rec.orgId).toBe("org-1");
    expect(rec.durationMs).toBe(123);
    expect(rec.level).toBe("info");
    expect(typeof rec.ts).toBe("string");
    // ISO-8601 Plausibilitaet
    expect(Number.isFinite(new Date(rec.ts).getTime())).toBe(true);
  });

  it("akzeptiert nur die drei erlaubten status-Werte, sonst fallback 'ok'", () => {
    logSafe({ action: "x", status: /** @type any */ ("weird") });
    const rec = parseFirst();
    expect(rec.status).toBe("ok");
  });

  it("erlaubt extra-Felder mit primitiven Typen", () => {
    logSafe({
      action: "x",
      status: "ok",
      extra: { count: 7, ok: true, label: "hello" },
    });
    const rec = parseFirst();
    expect(rec.count).toBe(7);
    expect(rec.ok).toBe(true);
    expect(rec.label).toBe("hello");
  });
});

describe("logSafe – Field-Whitelist & Denylist", () => {
  it("filtert extra.body raus", () => {
    logSafe({
      action: "ms_graph.send",
      status: "ok",
      extra: { body: "<html>secret email body</html>", subject: "Re: Hi" },
    });
    const rec = parseFirst();
    expect(rec.body).toBeUndefined();
    expect(rec.subject).toBe("Re: Hi");
  });

  it("filtert extra.token raus (case-insensitive)", () => {
    logSafe({
      action: "ms_graph.send",
      status: "ok",
      extra: {
        token: "abc",
        Token: "def",
        ACCESS_TOKEN: "ghi",
        refresh_token: "jkl",
        ok: true,
      },
    });
    const rec = parseFirst();
    expect(rec.token).toBeUndefined();
    expect(rec.Token).toBeUndefined();
    expect(rec.ACCESS_TOKEN).toBeUndefined();
    expect(rec.refresh_token).toBeUndefined();
    expect(rec.ok).toBe(true);
  });

  it("filtert weitere verbotene Keys: password, secret, jwt, bearer, content, html", () => {
    logSafe({
      action: "x",
      status: "ok",
      extra: {
        password: "p",
        client_secret: "s",
        jwt: "j",
        bearerHeader: "b",
        contentType: "ct",
        htmlBody: "h",
        safe: "yes",
      },
    });
    const rec = parseFirst();
    expect(rec.password).toBeUndefined();
    expect(rec.client_secret).toBeUndefined();
    expect(rec.jwt).toBeUndefined();
    expect(rec.bearerHeader).toBeUndefined();
    expect(rec.contentType).toBeUndefined();
    expect(rec.htmlBody).toBeUndefined();
    expect(rec.safe).toBe("yes");
  });

  it("verwirft Werte, die als JWT aussehen (Prefix 'eyJ')", () => {
    logSafe({
      action: "x",
      status: "ok",
      extra: { foo: "eyJabc.def.ghi", bar: "ok" },
    });
    const rec = parseFirst();
    // foo wird zu [REDACTED] (komplett ersetzt, nicht entfernt)
    expect(rec.foo).toBe("[REDACTED]");
    expect(rec.bar).toBe("ok");
  });

  it("verwirft komplette Strings > 1000 Zeichen", () => {
    const huge = "a".repeat(1500);
    logSafe({
      action: "x",
      status: "ok",
      extra: { foo: huge, bar: "ok" },
    });
    const rec = parseFirst();
    expect(rec.foo).toBe("[REDACTED]");
    expect(rec.bar).toBe("ok");
  });

  it("ignoriert Nicht-Primitive (Objekte, Arrays, null, undefined)", () => {
    logSafe({
      action: "x",
      status: "ok",
      extra: {
        obj: /** @type any */ ({ nested: 1 }),
        arr: /** @type any */ ([1, 2, 3]),
        nul: /** @type any */ (null),
        und: /** @type any */ (undefined),
        keep: 5,
      },
    });
    const rec = parseFirst();
    expect(rec.obj).toBeUndefined();
    expect(rec.arr).toBeUndefined();
    expect(rec.nul).toBeUndefined();
    expect(rec.und).toBeUndefined();
    expect(rec.keep).toBe(5);
  });

  it("ueberschreibt keine reservierten Top-Level-Keys via extra", () => {
    logSafe({
      action: "real_action",
      status: "ok",
      extra: {
        action: "spoofed",
        status: "error",
        ts: "1999-01-01",
        level: "panic",
        userId: "evil",
      },
    });
    const rec = parseFirst();
    expect(rec.action).toBe("real_action");
    expect(rec.status).toBe("ok");
    expect(rec.level).toBe("info");
    // ts wurde nicht durch extra ueberschrieben
    expect(rec.ts).not.toBe("1999-01-01");
  });
});

describe("logSafe – String-Kuerzung", () => {
  it("kuerzt Strings zwischen 200 und 1000 Zeichen mit Marker", () => {
    const mid = "x".repeat(500);
    logSafe({
      action: "x",
      status: "ok",
      extra: { note: mid },
    });
    const rec = parseFirst();
    expect(typeof rec.note).toBe("string");
    // 200 Zeichen Inhalt + Truncation-Marker
    expect(rec.note.length).toBeLessThan(mid.length);
    expect(rec.note.length).toBeLessThanOrEqual(200 + 32);
    expect(rec.note.startsWith("x".repeat(200))).toBe(true);
    expect(rec.note).toContain("truncated");
  });

  it("laesst Strings <= 200 Zeichen unveraendert", () => {
    const short = "x".repeat(200);
    logSafe({
      action: "x",
      status: "ok",
      extra: { note: short },
    });
    const rec = parseFirst();
    expect(rec.note).toBe(short);
  });
});

describe("logSafe – Error-Redaction", () => {
  it("redacted JWTs in error-Strings", () => {
    const err =
      "AuthError: invalid token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature_-here at line 42";
    logSafe({
      action: "ms_graph.refresh",
      status: "error",
      error: err,
    });
    const rec = parseFirst();
    expect(rec.error).toContain("[REDACTED-JWT]");
    expect(rec.error).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(rec.error).toContain("AuthError");
  });

  it("kuerzt sehr lange error-Strings (>1000 Zeichen)", () => {
    const longErr = "boom ".repeat(500); // 2500 Zeichen
    logSafe({
      action: "x",
      status: "error",
      error: longErr,
    });
    const rec = parseFirst();
    expect(rec.error.length).toBeLessThanOrEqual(1000 + 32);
    expect(rec.error).toContain("truncated");
  });
});
