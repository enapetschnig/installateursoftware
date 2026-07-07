// ============================================================
// Tests fuer api/anfragen/list.js
// ------------------------------------------------------------
// Wir mocken globalThis.fetch so, dass JEDER Aufruf eine eigene
// Response liefert. verifyUser ruft GET /auth/v1/user, danach folgt
// der eigentliche GET /rest/v1/anfragen?...
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./list.js";

/** Baut eine Fake-Response, kompatibel mit fetch (.ok/.status/.json/.text/.headers.get). */
function makeResponse(status, body, headers = {}) {
  const hMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n) => hMap.get(String(n).toLowerCase()) || null },
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body || {}),
  };
}

/** Minimaler Express/Vercel-Request. */
function makeReq({ query = {}, headers = {} } = {}) {
  return {
    method: "GET",
    query,
    headers: {
      authorization: "Bearer test-jwt",
      ...headers,
    },
  };
}

/** Minimaler Express/Vercel-Response, der status/json sammelt. */
function makeRes() {
  /** @type {{status:number|null,body:any,headers:Record<string,string>}} */
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

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const USER_OK = makeResponse(200, { id: "u-1", email: "x@y.z" });

describe("anfragen/list – Auth", () => {
  it("liefert 405 bei nicht-GET", async () => {
    const req = makeReq();
    req.method = "POST";
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(405);
    expect(res._state.headers.Allow).toBe("GET");
  });

  it("liefert 401 ohne Bearer-Token", async () => {
    // verifyUser ruft mit leerem Token -> wir mocken trotzdem das fetch
    // (security.js liefert direkt null zurueck, ohne Netz-Call).
    const req = makeReq({ headers: { authorization: "" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("liefert 401, wenn /auth/v1/user 401 liefert", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeResponse(401, {}));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(401);
  });
});

describe("anfragen/list – Erfolgsfall", () => {
  it("liefert rows + total_count und nutzt count=exact via Content-Range", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK) // verifyUser
      .mockResolvedValueOnce(
        makeResponse(
          200,
          [
            { id: "a-1", source: "phone_fonio", status: "neu" },
            { id: "a-2", source: "manual", status: "neu" },
          ],
          { "content-range": "0-1/42" },
        ),
      );

    const req = makeReq({ query: { limit: "2" } });
    const res = makeRes();
    await handler(req, res);

    expect(res._state.status).toBe(200);
    expect(res._state.body.rows).toHaveLength(2);
    expect(res._state.body.total_count).toBe(42);

    // Pruefen, dass beim Supabase-Call der USER-Bearer (nicht Service-Role)
    // gesetzt war und Prefer: count=exact + Range mit 0-1.
    const [url, init] = globalThis.fetch.mock.calls[1];
    expect(String(url)).toContain("/rest/v1/anfragen?");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(init.headers.Prefer).toBe("count=exact");
    expect(init.headers.Range).toBe("0-1");
  });

  it("akzeptiert source=phone_fonio und filtert per source=eq.phone_fonio", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(200, [], { "content-range": "0-0/0" }),
      );
    const req = makeReq({ query: { source: "phone_fonio" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(200);
    const [url] = globalThis.fetch.mock.calls[1];
    expect(String(url)).toContain("source=eq.phone_fonio");
  });

  it("ignoriert unbekannte sources (z. B. 'evil') – Whitelist", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(200, [], { "content-range": "0-0/0" }),
      );
    const req = makeReq({ query: { source: "evil" } });
    const res = makeRes();
    await handler(req, res);
    const [url] = globalThis.fetch.mock.calls[1];
    expect(String(url)).not.toContain("source=eq.evil");
  });

  it("akzeptiert status=neu und filtert per status=eq.neu", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(200, [], { "content-range": "0-0/0" }),
      );
    const req = makeReq({ query: { status: "neu" } });
    const res = makeRes();
    await handler(req, res);
    const [url] = globalThis.fetch.mock.calls[1];
    expect(String(url)).toContain("status=eq.neu");
  });

  it("baut bei search eine or=(...)-Klausel ueber subject/description/caller_*", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(200, [], { "content-range": "0-0/0" }),
      );
    const req = makeReq({ query: { search: "Maier" } });
    const res = makeRes();
    await handler(req, res);
    const [url] = globalThis.fetch.mock.calls[1];
    const s = String(url);
    expect(s).toContain("or=");
    expect(s).toContain("subject.ilike.*Maier*");
    expect(s).toContain("description.ilike.*Maier*");
    expect(s).toContain("caller_name.ilike.*Maier*");
  });

  it("entfernt PostgREST-Sonderzeichen aus search (Komma/Klammern/*)", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(200, [], { "content-range": "0-0/0" }),
      );
    const req = makeReq({ query: { search: "foo,bar(baz)*x" } });
    const res = makeRes();
    await handler(req, res);
    const [url] = globalThis.fetch.mock.calls[1];
    const s = String(url);
    expect(s).not.toContain("foo%2C");
    expect(s).not.toContain("%28baz%29");
    expect(s).not.toContain("%2A");
  });

  it("clamped Limit ueber MAX_LIMIT auf 200", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(200, [], { "content-range": "0-0/0" }),
      );
    const req = makeReq({ query: { limit: "9999" } });
    const res = makeRes();
    await handler(req, res);
    const [, init] = globalThis.fetch.mock.calls[1];
    // 0-199 fuer 200 Zeilen
    expect(init.headers.Range).toBe("0-199");
  });

  it("akzeptiert offset und setzt Range entsprechend", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(200, [], { "content-range": "50-99/120" }),
      );
    const req = makeReq({ query: { offset: "50", limit: "50" } });
    const res = makeRes();
    await handler(req, res);
    const [, init] = globalThis.fetch.mock.calls[1];
    expect(init.headers.Range).toBe("50-99");
    expect(res._state.body.total_count).toBe(120);
  });
});

describe("anfragen/list – Edge-Cases", () => {
  it("setzt total_count=0 bei 416 Range Not Satisfiable", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(416, "", { "content-range": "*/7" }),
      );
    const req = makeReq({ query: { offset: "1000" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(200);
    expect(res._state.body.rows).toEqual([]);
    expect(res._state.body.total_count).toBe(7);
  });

  it("liefert 502 bei Supabase-500", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(makeResponse(500, { message: "boom" }));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(502);
  });

  it("faellt auf rows.length zurueck, wenn Content-Range fehlt", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(makeResponse(200, [{ id: "x" }, { id: "y" }]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(200);
    expect(res._state.body.total_count).toBe(2);
  });

  it("liefert 500 bei Netzwerk-Fehler im REST-Call", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockRejectedValueOnce(new Error("ECONNRESET"));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(500);
  });
});
