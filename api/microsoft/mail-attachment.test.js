// ============================================================
// Tests fuer api/microsoft/mail-attachment.js
// ------------------------------------------------------------
// Wir mocken:
//   • ../_lib/security.js         – bearerFromRequest / verifyUser / checkRateLimit
//   • ../_lib/safe-log.js         – logSafe (No-Op)
//   • ../_lib/microsoft-graph.js  – getGraphAccessToken / graphFetch
//   • @supabase/supabase-js       – createClient (Chain-Mock)
//
// Getestet:
//   1. 405 non-GET
//   2. 401 ohne User
//   3. 400 ohne messageId
//   4. 400 ohne attachmentId
//   5. 429 wenn Rate-Limit
//   6. 200 – erfolgreiches Streaming, Buffer + Header korrekt
//   7. mode=inline nur bei image/pdf, sonst attachment (Whitelist)
//   8. Graph 404 → 404
//   9. Graph 401 → 502 + Row deaktivieren
//  10. Nicht-fileAttachment → 415
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Modul-Mocks (vor SUT-Import setzen) ────────────────────
const rateLimitFlag = { allow: true };
const userState = { user: { id: "u-1" } };

vi.mock("../_lib/security.js", () => ({
  bearerFromRequest: vi.fn(() => "test-jwt"),
  verifyUser: vi.fn(async () => userState.user),
  checkRateLimit: vi.fn(() => rateLimitFlag.allow),
}));

vi.mock("../_lib/safe-log.js", () => ({
  logSafe: vi.fn(),
  redactJwt: vi.fn((s) => s),
}));

const graphState = {
  token: "access-xyz",
  tokenError: null,
  fetchImpl: null, // (path, init) => Response-like
};

vi.mock("../_lib/microsoft-graph.js", () => ({
  getGraphAccessToken: vi.fn(async () => {
    if (graphState.tokenError) throw graphState.tokenError;
    return graphState.token;
  }),
  graphFetch: vi.fn(async (token, path, init) => {
    if (!graphState.fetchImpl) {
      throw new Error("graphFetch mock not configured");
    }
    return graphState.fetchImpl(path, init);
  }),
}));

// createClient-Mock: chainable Admin-Client.
const adminUpdates = [];
const adminState = { orgId: "org-1", membershipsError: null };

function makeAdmin() {
  const state = { table: null, patch: null, filters: [] };

  const api = {
    from: vi.fn((table) => {
      state.table = table;
      state.patch = null;
      state.filters = [];
      return api;
    }),
    select: vi.fn(() => api),
    update: vi.fn((patch) => {
      state.patch = patch;
      return api;
    }),
    eq: vi.fn((col, val) => {
      state.filters.push([col, val]);
      return api;
    }),
    limit: vi.fn(() => api),
    maybeSingle: vi.fn(async () => {
      if (adminState.membershipsError) throw adminState.membershipsError;
      if (state.table === "memberships") {
        return { data: adminState.orgId ? { organization_id: adminState.orgId } : null, error: null };
      }
      return { data: null, error: null };
    }),
    then: undefined,
  };

  // Fuer den Deaktivierungs-Update wird kein .then/await gebraucht:
  // update().eq().eq() gibt api zurueck; wir „resolven" indem der Test
  // .catch(...) direkt aufruft. Wir capturen den letzten update-Aufruf.
  const originalUpdate = api.update;
  api.update = vi.fn((patch) => {
    adminUpdates.push({ patch, table: state.table });
    return originalUpdate(patch);
  });

  return api;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => makeAdmin()),
}));

// Env setzen bevor SUT importiert wird.
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

// SUT dynamisch importieren (nach Mocks!).
const sutPromise = import("./mail-attachment.js");

// ── Test-Helper ─────────────────────────────────────────────
function makeReq({ method = "GET", query = {}, headers = {} } = {}) {
  return {
    method,
    query,
    headers: { authorization: "Bearer test-jwt", ...headers },
  };
}

function makeRes() {
  const state = {
    status: null,
    body: null,
    endedBuffer: null,
    headers: {},
  };
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
    end(buf) {
      state.endedBuffer = buf;
      return this;
    },
    _state: state,
  };
}

function graphJsonResp(payload, { status = 200 } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

beforeEach(() => {
  rateLimitFlag.allow = true;
  userState.user = { id: "u-1" };
  graphState.token = "access-xyz";
  graphState.tokenError = null;
  graphState.fetchImpl = null;
  adminState.orgId = "org-1";
  adminState.membershipsError = null;
  adminUpdates.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────
describe("mail-attachment", () => {
  it("405 bei nicht-GET", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ method: "POST" }), res);
    expect(res._state.status).toBe(405);
    expect(res._state.headers["Allow"]).toBe("GET");
  });

  it("401 ohne gueltigen User", async () => {
    userState.user = null;
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ query: { messageId: "m1", attachmentId: "a1" } }),
      res,
    );
    expect(res._state.status).toBe(401);
  });

  it("400 ohne messageId", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ query: { attachmentId: "a1" } }), res);
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/messageId/);
  });

  it("400 ohne attachmentId", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(makeReq({ query: { messageId: "m1" } }), res);
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/attachmentId/);
  });

  it("429 wenn Rate-Limit ueberschritten", async () => {
    rateLimitFlag.allow = false;
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ query: { messageId: "m1", attachmentId: "a1" } }),
      res,
    );
    expect(res._state.status).toBe(429);
  });

  it("200 – erfolgreiches Streaming eines PDF (attachment-Modus)", async () => {
    const raw = Buffer.from("%PDF-1.4 hello");
    const b64 = raw.toString("base64");
    graphState.fetchImpl = () =>
      graphJsonResp({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "rechnung.pdf",
        contentType: "application/pdf",
        size: raw.byteLength,
        contentBytes: b64,
      });

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ query: { messageId: "m1", attachmentId: "a1" } }),
      res,
    );

    expect(res._state.status).toBe(200);
    expect(res._state.headers["Content-Type"]).toBe("application/pdf");
    expect(res._state.headers["Content-Disposition"]).toMatch(/^attachment;/);
    expect(res._state.headers["Content-Disposition"]).toMatch(/rechnung\.pdf/);
    expect(res._state.headers["Content-Length"]).toBe(String(raw.byteLength));
    expect(Buffer.isBuffer(res._state.endedBuffer)).toBe(true);
    expect(res._state.endedBuffer.equals(raw)).toBe(true);
  });

  it("mode=inline wird bei image/png akzeptiert", async () => {
    const raw = Buffer.from([137, 80, 78, 71]); // PNG-Magic
    graphState.fetchImpl = () =>
      graphJsonResp({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "logo.png",
        contentType: "image/png",
        size: raw.byteLength,
        contentBytes: raw.toString("base64"),
      });

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        query: { messageId: "m1", attachmentId: "a1", mode: "inline" },
      }),
      res,
    );
    expect(res._state.status).toBe(200);
    expect(res._state.headers["Content-Disposition"]).toMatch(/^inline;/);
  });

  it("mode=inline bei nicht-whitelisted MIME → attachment", async () => {
    const raw = Buffer.from("plain-text");
    graphState.fetchImpl = () =>
      graphJsonResp({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "notes.txt",
        contentType: "text/plain",
        size: raw.byteLength,
        contentBytes: raw.toString("base64"),
      });

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        query: { messageId: "m1", attachmentId: "a1", mode: "inline" },
      }),
      res,
    );
    expect(res._state.status).toBe(200);
    expect(res._state.headers["Content-Disposition"]).toMatch(/^attachment;/);
  });

  it("Graph 404 → 404 an Client", async () => {
    graphState.fetchImpl = () =>
      graphJsonResp({ error: { code: "ItemNotFound" } }, { status: 404 });

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ query: { messageId: "m1", attachmentId: "a1" } }),
      res,
    );
    expect(res._state.status).toBe(404);
  });

  it("Graph 401 → 502 + Token-Row deaktiviert", async () => {
    graphState.fetchImpl = () =>
      graphJsonResp({ error: { code: "InvalidAuthenticationToken" } }, { status: 401 });

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ query: { messageId: "m1", attachmentId: "a1" } }),
      res,
    );
    expect(res._state.status).toBe(502);
    // Es wurde ein update-Patch auf microsoft_oauth_tokens abgesetzt
    const deactivate = adminUpdates.find(
      (u) => u.table === "microsoft_oauth_tokens" && u.patch?.is_active === false,
    );
    expect(deactivate).toBeTruthy();
  });

  it("415 bei nicht-fileAttachment (z.B. itemAttachment)", async () => {
    graphState.fetchImpl = () =>
      graphJsonResp({
        "@odata.type": "#microsoft.graph.itemAttachment",
        name: "forwarded.eml",
        contentType: "message/rfc822",
        size: 100,
        contentBytes: null,
      });

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ query: { messageId: "m1", attachmentId: "a1" } }),
      res,
    );
    expect(res._state.status).toBe(415);
  });

  it("400 bei ungueltiger Graph-ID (Sonderzeichen)", async () => {
    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({
        query: { messageId: "../evil", attachmentId: "a1" },
      }),
      res,
    );
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/Graph-ID/);
  });

  it("401 bei getGraphAccessToken → not_connected", async () => {
    const err = new Error("nc");
    err.code = "not_connected";
    graphState.tokenError = err;

    const { default: handler } = await sutPromise;
    const res = makeRes();
    await handler(
      makeReq({ query: { messageId: "m1", attachmentId: "a1" } }),
      res,
    );
    expect(res._state.status).toBe(401);
  });
});
