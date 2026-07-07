// ============================================================
// Tests fuer api/auth/microsoft-link.js
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { __internals } from "./microsoft-link.js";

function makeReq({ method = "GET", headers = {}, query = {}, body = null } = {}) {
  return { method, headers, query, body };
}

function makeRes() {
  const state = {
    status: null,
    body: null,
    headers: {},
    setHeaderCalls: [],
    endCalled: false,
  };
  const res = {
    setHeader(k, v) {
      state.headers[k] = v;
      state.setHeaderCalls.push([k, v]);
      return res;
    },
    status(code) {
      state.status = code;
      return res;
    },
    json(obj) {
      state.body = obj;
      return res;
    },
    end() {
      state.endCalled = true;
      return res;
    },
    _state: state,
  };
  return res;
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
  process.env.AZURE_CLIENT_ID = "test-client-id";
  process.env.OAUTH_COOKIE_KEY = "dGVzdC1zZWNyZXQtMzItYnl0ZS1sb25nLWVub3VnaC10bw==";
  process.env.MICROSOFT_REDIRECT_URI = "https://example.com/api/auth/microsoft-callback";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("microsoft-link", () => {
  it("405 bei nicht-GET/POST (z.B. DELETE)", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "DELETE" }), res);
    expect(res._state.status).toBe(405);
    expect(res._state.headers["Allow"]).toBe("GET, POST");
  });

  it("500 bei fehlender Konfiguration", async () => {
    process.env.AZURE_CLIENT_ID = "";
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(500);
  });

  it("401 ohne Bearer", async () => {
    // verifyUser wird intern gerufen und ohne token instant null
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(401);
  });

  it("Legacy-GET: 302 mit Authorize-URL + Set-Cookie wenn Query-Token gueltig", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "u-1" }),
      text: async () => "",
    });
    const res = makeRes();
    await handler(makeReq({ query: { access_token: "valid-jwt" } }), res);

    expect(res._state.status).toBe(302);
    expect(res._state.headers["Location"]).toContain("login.microsoftonline.com");
    expect(res._state.headers["Location"]).toContain("code_challenge_method=S256");
    expect(res._state.headers["Set-Cookie"]).toContain("b4y_oauth_state=");
    expect(res._state.headers["Set-Cookie"]).toContain("HttpOnly");
    expect(res._state.headers["Set-Cookie"]).toContain("SameSite=Lax");
  });

  it("Legacy-GET: prompt=consent im Query wird ins Redirect uebernommen", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "u-1" }),
      text: async () => "",
    });
    const res = makeRes();
    await handler(
      makeReq({ query: { access_token: "valid-jwt", prompt: "consent" } }),
      res,
    );
    expect(res._state.headers["Location"]).toContain("prompt=consent");
  });

  it("Neu-POST: 200 JSON mit target + Set-Cookie wenn Bearer im Header", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "u-1" }),
      text: async () => "",
    });
    const res = makeRes();
    await handler(
      makeReq({
        method: "POST",
        headers: { authorization: "Bearer valid-jwt" },
        body: {},
      }),
      res,
    );

    expect(res._state.status).toBe(200);
    expect(res._state.body.target).toContain("login.microsoftonline.com");
    expect(res._state.body.target).toContain("code_challenge_method=S256");
    expect(res._state.headers["Set-Cookie"]).toContain("b4y_oauth_state=");
    expect(res._state.headers["Set-Cookie"]).toContain("HttpOnly");
  });

  it("Neu-POST: prompt=consent im JSON-Body wird uebernommen", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "u-1" }),
      text: async () => "",
    });
    const res = makeRes();
    await handler(
      makeReq({
        method: "POST",
        headers: { authorization: "Bearer valid-jwt" },
        body: { prompt: "consent" },
      }),
      res,
    );
    expect(res._state.body.target).toContain("prompt=consent");
  });
});

describe("microsoft-link __internals", () => {
  it("pkceChallenge liefert 43 Zeichen Base64URL", () => {
    const verifier = __internals.toBase64Url(Buffer.from("x".repeat(32)));
    const ch = __internals.pkceChallenge(verifier);
    expect(ch.length).toBe(43);
    expect(ch).not.toContain("=");
    expect(ch).not.toContain("+");
    expect(ch).not.toContain("/");
  });

  it("signCookie liefert data.sig-Format", () => {
    const c = __internals.signCookie({ state: "abc" }, "secret");
    expect(c.split(".").length).toBe(2);
  });
});
