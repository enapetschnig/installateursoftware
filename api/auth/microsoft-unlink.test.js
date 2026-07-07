// ============================================================
// Tests fuer api/auth/microsoft-unlink.js
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./microsoft-unlink.js";

function makeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body || {})),
  };
}

function makeReq({ method = "POST", headers = {} } = {}) {
  return {
    method,
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

describe("microsoft-unlink", () => {
  it("405 bei nicht-POST", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "GET" }), res);
    expect(res._state.status).toBe(405);
  });

  it("401 ohne gueltigen Bearer", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeResponse(401, { msg: "no" }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(401);
  });

  it("200 ok bei erfolgreichem PATCH", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" })) // verifyUser
      .mockResolvedValueOnce(makeResponse(204, "")); // PATCH
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(200);
    expect(res._state.body).toEqual({ ok: true });
  });

  it("502 wenn PATCH scheitert", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" }))
      .mockResolvedValueOnce(makeResponse(500, "server error"));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(502);
  });
});
