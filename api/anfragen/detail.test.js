// ============================================================
// Tests fuer api/anfragen/detail.js
// ------------------------------------------------------------
// fetch wird gemockt. Reihenfolge: verifyUser → anfragen-select → events-select.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./detail.js";

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

function makeReq({ query = {}, headers = {}, method = "GET" } = {}) {
  return {
    method,
    query,
    headers: { authorization: "Bearer test-jwt", ...headers },
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

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const USER_OK = makeResponse(200, { id: "u-1" });
const VALID_UUID = "11111111-2222-4333-8444-555555555555";

describe("anfragen/detail – Auth & Validierung", () => {
  it("liefert 405 bei nicht-GET", async () => {
    const req = makeReq({ method: "POST" });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(405);
  });

  it("liefert 401 ohne Bearer", async () => {
    const req = makeReq({ headers: { authorization: "" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("liefert 401, wenn verifyUser 401 liefert", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeResponse(401, {}));
    const req = makeReq({ query: { id: VALID_UUID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(401);
  });

  it("liefert 400, wenn id fehlt", async () => {
    globalThis.fetch.mockResolvedValueOnce(USER_OK);
    const req = makeReq({ query: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(400);
  });

  it("liefert 400 bei nicht-UUID-Wert (z. B. SQL-injection-Versuch)", async () => {
    globalThis.fetch.mockResolvedValueOnce(USER_OK);
    const req = makeReq({ query: { id: "not-a-uuid;DROP" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(400);
  });
});

describe("anfragen/detail – Erfolg", () => {
  it("liefert { anfrage, events } und nutzt USER-Bearer", async () => {
    const anfrage = {
      id: VALID_UUID,
      source: "fonio",
      status: "neu",
      subject: "Anfrage",
    };
    const events = [
      { id: "e1", anfrage_id: VALID_UUID, event_type: "created" },
      { id: "e2", anfrage_id: VALID_UUID, event_type: "classified" },
    ];

    globalThis.fetch
      .mockResolvedValueOnce(USER_OK) // verifyUser
      .mockResolvedValueOnce(makeResponse(200, [anfrage])) // anfragen
      .mockResolvedValueOnce(makeResponse(200, events)); // anfrage_events

    const req = makeReq({ query: { id: VALID_UUID } });
    const res = makeRes();
    await handler(req, res);

    expect(res._state.status).toBe(200);
    expect(res._state.body.anfrage.id).toBe(VALID_UUID);
    expect(res._state.body.events).toHaveLength(2);

    // Beide REST-Calls nutzen den USER-Bearer
    const auth1 = globalThis.fetch.mock.calls[1][1].headers.Authorization;
    const auth2 = globalThis.fetch.mock.calls[2][1].headers.Authorization;
    expect(auth1).toBe("Bearer test-jwt");
    expect(auth2).toBe("Bearer test-jwt");

    // events werden chronologisch aufsteigend geladen
    expect(String(globalThis.fetch.mock.calls[2][0])).toContain(
      "order=created_at.asc",
    );
  });

  it("liefert 404, wenn Anfrage nicht existiert / RLS sie blockt", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(makeResponse(200, []));
    const req = makeReq({ query: { id: VALID_UUID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(404);
  });

  it("liefert events=[] (best-effort), wenn der Event-Call fehlschlaegt", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(
        makeResponse(200, [{ id: VALID_UUID, source: "manual" }]),
      )
      .mockResolvedValueOnce(makeResponse(500, { message: "boom" }));
    const req = makeReq({ query: { id: VALID_UUID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(200);
    expect(res._state.body.anfrage.id).toBe(VALID_UUID);
    expect(res._state.body.events).toEqual([]);
  });
});

describe("anfragen/detail – Backend-Fehler", () => {
  it("liefert 502, wenn der Anfragen-Select scheitert", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockResolvedValueOnce(makeResponse(500, { message: "boom" }));
    const req = makeReq({ query: { id: VALID_UUID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(502);
  });

  it("liefert 500 bei Netzwerk-Fehler", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(USER_OK)
      .mockRejectedValueOnce(new Error("ECONNRESET"));
    const req = makeReq({ query: { id: VALID_UUID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(500);
  });
});
