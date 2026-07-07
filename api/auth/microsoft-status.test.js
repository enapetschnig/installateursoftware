// ============================================================
// Tests fuer api/auth/microsoft-status.js
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./microsoft-status.js";

function makeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body || {})),
  };
}

function makeReq({ method = "GET", headers = {}, query = {} } = {}) {
  return {
    method,
    query,
    headers: { authorization: "Bearer test-jwt", ...headers },
  };
}

function makeRes() {
  const state = { status: null, body: null, headers: {} };
  return {
    setHeader(k, v) { state.headers[k] = v; },
    status(code) { state.status = code; return this; },
    json(obj) { state.body = obj; return this; },
    _state: state,
  };
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("microsoft-status", () => {
  it("405 bei nicht-GET", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "POST" }), res);
    expect(res._state.status).toBe(405);
  });

  it("401 ohne gueltigen Bearer", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeResponse(401, { msg: "no" }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(401);
  });

  it("connected:false wenn keine Row", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" })) // verifyUser
      .mockResolvedValueOnce(makeResponse(200, [])); // rest select
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(200);
    expect(res._state.body).toEqual({ connected: false });
  });

  it("connected:true mit Metadaten wenn Row existiert", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" }))
      .mockResolvedValueOnce(
        makeResponse(200, [
          {
            microsoft_user_id: "user@example.com",
            microsoft_tenant_id: "tenant-x",
            expires_at: "2026-07-01T12:00:00Z",
            scopes: ["Mail.Read", "Mail.Send"],
            is_active: true,
          },
        ]),
      );
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(200);
    expect(res._state.body.connected).toBe(true);
    expect(res._state.body.microsoft_user_id).toBe("user@example.com");
    expect(res._state.body.scopes).toEqual(["Mail.Read", "Mail.Send"]);
  });

  it("degradiert bei HTTP-Fehler auf connected:false + degraded:true", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" }))
      .mockResolvedValueOnce(makeResponse(500, { error: "boom" }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(200);
    expect(res._state.body.connected).toBe(false);
    expect(res._state.body.degraded).toBe(true);
  });
});
