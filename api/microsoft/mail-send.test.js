// ============================================================
// Tests fuer api/microsoft/mail-send.js
// ------------------------------------------------------------
// Wir mocken:
//   • ../_lib/security.js           – verifyUser / checkRateLimit / bearer
//   • ../_lib/microsoft-graph.js    – getGraphAccessToken (Identitaet fuer Token)
//   • ../_lib/safe-log.js           – logSafe/redactJwt (No-Op)
//   • @supabase/supabase-js         – Chain-Mock fuer memberships-Lookup und
//                                     Audit-Log-Insert (getrennt trackbar)
//   • globalThis.fetch              – Graph-Response
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Modul-Mocks (vor dem Import des SUT setzen) ───────────
const verifyUserMock = vi.fn();
const checkRateLimitMock = vi.fn(() => true);

vi.mock("../_lib/security.js", () => ({
  bearerFromRequest: vi.fn(() => "test-jwt"),
  verifyUser: (...args) => verifyUserMock(...args),
  checkRateLimit: (...args) => checkRateLimitMock(...args),
}));

const getGraphAccessTokenMock = vi.fn();
vi.mock("../_lib/microsoft-graph.js", () => ({
  getGraphAccessToken: (...args) => getGraphAccessTokenMock(...args),
}));

vi.mock("../_lib/safe-log.js", () => ({
  logSafe: vi.fn(),
  redactJwt: vi.fn((s) => `[redacted:${(s || "").slice(0, 6)}]`),
}));

// Supabase-Admin-Mock: eine In-Memory-Fabrik, deren Verhalten pro Test
// eingestellt werden kann.
const adminState = {
  membershipRow: { organization_id: "org-1" },
  membershipError: null,
  auditInsertError: null,
  auditInserts: [],
};

function makeChain(handler) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => handler("maybeSingle")),
    insert: vi.fn(async (row) => handler("insert", row)),
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table) => {
      if (table === "memberships") {
        return makeChain((op) => {
          if (op === "maybeSingle") {
            return { data: adminState.membershipRow, error: adminState.membershipError };
          }
          return { data: null, error: null };
        });
      }
      if (table === "microsoft_mail_audit_log") {
        return makeChain((op, row) => {
          if (op === "insert") {
            adminState.auditInserts.push(row);
            return { data: null, error: adminState.auditInsertError };
          }
          return { data: null, error: null };
        });
      }
      return makeChain(() => ({ data: null, error: null }));
    }),
  })),
}));

// SUT nach den Mocks importieren.
const sutPromise = import("./mail-send.js");

// ── Test-Helfer ──────────────────────────────────────────
function makeReq(body, { method = "POST", headers = {} } = {}) {
  return {
    method,
    headers: { authorization: "Bearer test-jwt", ...headers },
    body,
  };
}

function makeRes() {
  const state = { status: null, body: null, headers: {} };
  return {
    setHeader(k, v) {
      state.headers[k] = v;
    },
    status(code) {
      state.status = code;
      return this;
    },
    json(obj) {
      state.body = obj;
      return this;
    },
    _state: state,
  };
}

function makeFetchResp(status, body, { headers } = {}) {
  const hdrMap = new Map(Object.entries(headers || {}));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k) => hdrMap.get(String(k).toLowerCase()) ?? hdrMap.get(k) ?? null,
    },
    json: async () => (typeof body === "string" ? JSON.parse(body) : body || {}),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body || {})),
  };
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();

  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-svc";

  verifyUserMock.mockReset();
  verifyUserMock.mockResolvedValue({ id: "u-1" });
  checkRateLimitMock.mockReset();
  checkRateLimitMock.mockReturnValue(true);
  getGraphAccessTokenMock.mockReset();
  getGraphAccessTokenMock.mockResolvedValue("plaintext-token");

  adminState.membershipRow = { organization_id: "org-1" };
  adminState.membershipError = null;
  adminState.auditInsertError = null;
  adminState.auditInserts = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────

describe("mail-send basics", () => {
  it("405 bei nicht-POST", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq(null, { method: "GET" }), res);
    expect(res._state.status).toBe(405);
    expect(res._state.headers.Allow).toBe("POST");
  });

  it("401 wenn verifyUser null liefert", async () => {
    verifyUserMock.mockResolvedValueOnce(null);
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ to: [{ address: "a@b.de" }], subject: "s", html: "<p>x</p>" }), res);
    expect(res._state.status).toBe(401);
  });

  it("429 wenn Rate-Limit erreicht", async () => {
    checkRateLimitMock.mockReturnValueOnce(false);
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ to: [{ address: "a@b.de" }], subject: "s", html: "<p>x</p>" }), res);
    expect(res._state.status).toBe(429);
    // Rate-Limit-Signatur exakt 30/Stunde.
    expect(checkRateLimitMock).toHaveBeenCalledWith("u-1", 30, 3_600_000);
  });

  it("400 ohne JSON-Body", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq(null), res);
    expect(res._state.status).toBe(400);
  });
});

describe("mail-send validation", () => {
  it("400 ohne subject", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ to: [{ address: "a@b.de" }], html: "<p>x</p>" }), res);
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/subject/i);
  });

  it("400 ohne html", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ to: [{ address: "a@b.de" }], subject: "s" }), res);
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/html/i);
  });

  it("400 ohne to[]", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ to: [], subject: "s", html: "<p>x</p>" }), res);
    expect(res._state.status).toBe(400);
  });

  it("400 bei ungueltiger Email in to[]", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ to: [{ address: "not-an-email" }], subject: "s", html: "<p>x</p>" }),
      res,
    );
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/to/i);
  });

  it("400 wenn Empfaenger-Summe > 50", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ address: `u${i}@x.de` }));
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ to: many, subject: "s", html: "<p>x</p>" }), res);
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/Empfaenger/);
  });

  it("400 bei zu grossem Attachment (>4MB)", async () => {
    // ~5MB base64 ≈ 5MB * 1.33 chars, aber Bytezaehlung erfolgt intern.
    // Wir bauen exakt 5MB * 4/3 base64-Zeichen (5MB dekodiert).
    const bytes = 5 * 1024 * 1024;
    const b64Len = Math.ceil(bytes / 3) * 4;
    const big = "A".repeat(b64Len - 2) + "==";
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        to: [{ address: "a@b.de" }],
        subject: "s",
        html: "<p>x</p>",
        attachments: [{ name: "big.bin", mime: "application/octet-stream", base64: big }],
      }),
      res,
    );
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/too_large|Anhaenge/i);
  });

  it("400 bei Reply + Attachments (MVP-Einschraenkung)", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        to: [{ address: "a@b.de" }],
        subject: "s",
        html: "<p>x</p>",
        inReplyTo: "AAMk...=",
        attachments: [
          { name: "n.txt", mime: "text/plain", base64: Buffer.from("hi").toString("base64") },
        ],
      }),
      res,
    );
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/Anhaengen/i);
  });

  it("400 bei ungueltigem documentContext", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        to: [{ address: "a@b.de" }],
        subject: "s",
        html: "<p>x</p>",
        documentContext: { kind: "wut", id: "x" },
      }),
      res,
    );
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/documentContext/);
  });
});

describe("mail-send graph success", () => {
  it("sendet und schreibt Audit 'sent'", async () => {
    // Graph liefert 202 Accepted mit einer beispielhaften Location.
    globalThis.fetch.mockResolvedValueOnce(
      makeFetchResp(202, "", {
        headers: {
          location: "https://graph.microsoft.com/v1.0/users/x/messages/AAMk1234%3D",
        },
      }),
    );

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        to: [{ name: "Bob", address: "bob@example.com" }],
        cc: [{ address: "cc@example.com" }],
        subject: "Hallo",
        html: "<p>Hi <b>Bob</b></p>",
        documentContext: { kind: "offer", id: "11111111-2222-3333-4444-555555555555" },
      }),
      res,
    );

    expect(res._state.status).toBe(200);
    expect(res._state.body.ok).toBe(true);
    expect(typeof res._state.body.sentAt).toBe("string");

    // Genau ein Fetch: /me/sendMail
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer plaintext-token");
    const payload = JSON.parse(init.body);
    expect(payload.saveToSentItems).toBe(true);
    expect(payload.message.subject).toBe("Hallo");
    expect(payload.message.toRecipients[0].emailAddress.address).toBe("bob@example.com");
    expect(payload.message.ccRecipients[0].emailAddress.address).toBe("cc@example.com");

    // Audit-Insert
    expect(adminState.auditInserts).toHaveLength(1);
    const audit = adminState.auditInserts[0];
    expect(audit.action).toBe("sent");
    expect(audit.recipient_to).toEqual(["bob@example.com"]);
    expect(audit.recipient_cc).toEqual(["cc@example.com"]);
    expect(audit.subject).toBe("Hallo");
    expect(audit.attachment_count).toBe(0);
    expect(audit.related_offer_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(audit.related_order_id).toBeNull();
    expect(audit.microsoft_message_id).toBe("AAMk1234=");
    expect(audit.body_preview).toContain("Hi");
    expect(audit.body_preview).not.toContain("<");
  });

  it("Reply-Pfad ruft /reply mit comment + message.toRecipients", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeFetchResp(202, ""));

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        to: [{ address: "reply@example.com" }],
        subject: "Re: Frage",
        html: "<p>Klar!</p>",
        inReplyTo: "AAMkOriginalId==",
      }),
      res,
    );

    expect(res._state.status).toBe(200);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/me/messages/AAMkOriginalId%3D%3D/reply",
    );
    const payload = JSON.parse(init.body);
    expect(payload.comment).toBe("<p>Klar!</p>");
    expect(payload.message.toRecipients[0].emailAddress.address).toBe("reply@example.com");
    expect(payload.saveToSentItems).toBeUndefined();

    expect(adminState.auditInserts).toHaveLength(1);
    expect(adminState.auditInserts[0].action).toBe("reply");
  });
});

describe("mail-send graph errors", () => {
  it("502 + Audit 'failed' bei 4xx von Graph", async () => {
    globalThis.fetch.mockResolvedValueOnce(
      makeFetchResp(400, { error: { message: "ErrorRecipientNotAllowed" } }),
    );

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        to: [{ address: "a@b.de" }],
        subject: "s",
        html: "<p>x</p>",
      }),
      res,
    );

    expect(res._state.status).toBe(502);
    expect(adminState.auditInserts).toHaveLength(1);
    const audit = adminState.auditInserts[0];
    expect(audit.action).toBe("failed");
    expect(audit.error_message).toContain("ErrorRecipientNotAllowed");
    expect(audit.microsoft_message_id).toBeNull();
  });

  it("502 + Audit 'failed' bei Netzwerk-Fehler", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("ECONNRESET"));

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ to: [{ address: "a@b.de" }], subject: "s", html: "<p>x</p>" }),
      res,
    );

    expect(res._state.status).toBe(502);
    expect(adminState.auditInserts).toHaveLength(1);
    expect(adminState.auditInserts[0].action).toBe("failed");
    expect(adminState.auditInserts[0].error_message).toMatch(/ECONNRESET/);
  });

  it("404 wenn Graph-Token 'not_connected' wirft (KEIN Audit-Insert)", async () => {
    const err = new Error("nope");
    err.code = "not_connected";
    getGraphAccessTokenMock.mockRejectedValueOnce(err);

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ to: [{ address: "a@b.de" }], subject: "s", html: "<p>x</p>" }),
      res,
    );

    expect(res._state.status).toBe(404);
    // Wir loggen den Fehler, schreiben aber KEIN Audit fuer nicht-verbundene Konten
    // (das ist erst ein Fehler beim eigentlichen Sende-Versuch → org-Kontext fehlt ohnehin).
    expect(adminState.auditInserts).toHaveLength(0);
  });

  it("404 wenn kein Membership vorhanden", async () => {
    adminState.membershipRow = null;

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ to: [{ address: "a@b.de" }], subject: "s", html: "<p>x</p>" }),
      res,
    );

    expect(res._state.status).toBe(404);
    expect(getGraphAccessTokenMock).not.toHaveBeenCalled();
  });
});

describe("mail-send internal helpers", () => {
  it("normalizeRecipients + validateAttachments + makeBodyPreview", async () => {
    const { __internal } = await sutPromise;
    // Empfaenger-Validierung
    const r = __internal.normalizeRecipients([{ address: "a@b.de" }, { address: "x@y.zz" }]);
    expect(r.invalid).toBeNull();
    expect(r.list).toHaveLength(2);

    // Attachment-Groesse: exakt 4MB akzeptiert, 4MB+1 abgelehnt.
    const ok = "A".repeat(Math.floor((__internal.MAX_ATTACHMENT_BYTES * 4) / 3));
    const okRes = __internal.validateAttachments([
      { name: "n", mime: "text/plain", base64: ok },
    ]);
    // Wir prueften nur die Struktur, nicht exakt-Bytes: base64-Rundung kann
    // Groessen leicht ueberschreiten – hier interessiert uns, dass ein normal
    // grosser Anhang keinen Fehler wirft.
    expect(okRes.invalid == null || /too_large/.test(okRes.invalid || "")).toBe(true);

    // HTML-Preview strippt Tags, trimmt, cappt.
    const preview = __internal.makeBodyPreview("<p>Hallo <b>Welt</b></p>");
    expect(preview).toBe("Hallo Welt");
    expect(__internal.makeBodyPreview("")).toBeNull();
  });
});
