// ============================================================
// Tests fuer api/anfragen/create.js
// ------------------------------------------------------------
// fetch wird gemockt. Reihenfolge:
//   1) verifyUser → GET /auth/v1/user
//   2) Insert anfragen (POST /rest/v1/anfragen)
//   3) Insert anfrage_events (POST /rest/v1/anfrage_events)
//
// Wichtig: checkRateLimit() teilt sich eine modul-globale Map ueber alle
// Tests. Wir nutzen pro Test eine unique User-ID, um Cross-Test-Effekte
// zu vermeiden.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./create.js";

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

function makeReq({ body = {}, headers = {}, method = "POST" } = {}) {
  return {
    method,
    body,
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

let userCounter = 0;
function makeUserResponse() {
  // unique pro Test → kein Cross-Test-RateLimit
  userCounter++;
  return makeResponse(200, { id: `user-create-${userCounter}-${Date.now()}` });
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

describe("anfragen/create – Method & Auth", () => {
  it("liefert 405 bei nicht-POST", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(405);
    expect(res._state.headers.Allow).toBe("POST");
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
    const req = makeReq({ body: { subject: "Test" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(401);
  });
});

describe("anfragen/create – Validierung", () => {
  it("liefert 400, wenn kein Body", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeUserResponse());
    const req = makeReq({ body: null });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(400);
  });

  it("liefert 400 bei leerem subject", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeUserResponse());
    const req = makeReq({ body: { subject: "   " } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/subject/i);
  });

  it("liefert 400 bei fehlendem subject", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeUserResponse());
    const req = makeReq({ body: { description: "ohne Betreff" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(400);
  });

  it("parst JSON-Body als String", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeUserResponse())
      .mockResolvedValueOnce(
        makeResponse(201, [
          { id: "11111111-2222-4333-8444-555555555555", created_at: "now" },
        ]),
      )
      .mockResolvedValueOnce(makeResponse(201, null));
    const req = makeReq({ body: JSON.stringify({ subject: "Hallo" }) });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(200);
    expect(res._state.body.ok).toBe(true);
  });

  it("ignoriert kaputtes JSON und liefert 400", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeUserResponse());
    const req = makeReq({ body: "{not json" });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(400);
  });
});

describe("anfragen/create – Erfolg", () => {
  it("legt eine Anfrage mit source=manual, status=neu und nutzt USER-Bearer", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const created_at = "2026-06-30T10:00:00Z";
    globalThis.fetch
      .mockResolvedValueOnce(makeUserResponse())
      .mockResolvedValueOnce(makeResponse(201, [{ id, created_at }]))
      .mockResolvedValueOnce(makeResponse(201, null));

    const req = makeReq({
      body: {
        subject: "Wasserschaden Stiege",
        description: "Tropft seit gestern.",
        caller_name: "Maier",
        caller_phone: "+43 660 1234567",
        caller_email: "m@example.org",
        caller_address: "Hauptstr. 1, 1010 Wien",
      },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._state.status).toBe(200);
    expect(res._state.body).toEqual({ ok: true, id, created_at });

    // Check Insert-Body fuer anfragen
    const insertCall = globalThis.fetch.mock.calls[1];
    expect(String(insertCall[0])).toContain("/rest/v1/anfragen");
    expect(insertCall[1].headers.Authorization).toBe("Bearer test-jwt");
    expect(insertCall[1].headers.Prefer).toBe("return=representation");
    const insertedRow = JSON.parse(insertCall[1].body);
    expect(insertedRow.source).toBe("manual");
    expect(insertedRow.source_ref).toBeNull();
    expect(insertedRow.status).toBe("neu");
    expect(insertedRow.subject).toBe("Wasserschaden Stiege");
    expect(insertedRow.caller_name).toBe("Maier");

    // Check Event-Insert
    const eventCall = globalThis.fetch.mock.calls[2];
    expect(String(eventCall[0])).toContain("/rest/v1/anfrage_events");
    const eventRow = JSON.parse(eventCall[1].body);
    expect(eventRow.anfrage_id).toBe(id);
    expect(eventRow.event_type).toBe("created");
    expect(eventRow.payload).toEqual({ source: "manual", actor: "user" });
  });

  it("setzt unbefuellte Felder auf null statt leerem String", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef";
    globalThis.fetch
      .mockResolvedValueOnce(makeUserResponse())
      .mockResolvedValueOnce(makeResponse(201, [{ id, created_at: "now" }]))
      .mockResolvedValueOnce(makeResponse(201, null));

    const req = makeReq({ body: { subject: "Nur Betreff" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(200);

    const insertedRow = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(insertedRow.description).toBeNull();
    expect(insertedRow.caller_name).toBeNull();
    expect(insertedRow.caller_phone).toBeNull();
    expect(insertedRow.caller_email).toBeNull();
    expect(insertedRow.caller_address).toBeNull();
  });

  it("kuerzt zu lange Strings auf das Spaltenlimit", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01";
    globalThis.fetch
      .mockResolvedValueOnce(makeUserResponse())
      .mockResolvedValueOnce(makeResponse(201, [{ id, created_at: "now" }]))
      .mockResolvedValueOnce(makeResponse(201, null));

    const longSubject = "A".repeat(500);
    const req = makeReq({ body: { subject: longSubject } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(200);

    const insertedRow = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(insertedRow.subject.length).toBe(200);
  });

  it("liefert trotzdem 200, wenn Event-Insert scheitert (best-effort)", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02";
    globalThis.fetch
      .mockResolvedValueOnce(makeUserResponse())
      .mockResolvedValueOnce(makeResponse(201, [{ id, created_at: "now" }]))
      .mockResolvedValueOnce(makeResponse(500, { message: "boom" }));

    const req = makeReq({ body: { subject: "Test" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(200);
    expect(res._state.body.ok).toBe(true);
    expect(res._state.body.id).toBe(id);
  });
});

describe("anfragen/create – Backend-Fehler", () => {
  it("liefert 502, wenn Insert anfragen scheitert", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeUserResponse())
      .mockResolvedValueOnce(makeResponse(500, { message: "boom" }));

    const req = makeReq({ body: { subject: "Test" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(502);
  });

  it("liefert 502, wenn der Insert keine id liefert", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeUserResponse())
      .mockResolvedValueOnce(makeResponse(201, []));

    const req = makeReq({ body: { subject: "Test" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(502);
  });

  it("liefert 500 bei Netzwerk-Fehler", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeUserResponse())
      .mockRejectedValueOnce(new Error("ECONNRESET"));
    const req = makeReq({ body: { subject: "Test" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._state.status).toBe(500);
  });
});

describe("anfragen/create – Rate-Limit", () => {
  it("liefert 429 nach 30 Aufrufen innerhalb 1 Minute (pro User)", async () => {
    // Wir geben jedem verifyUser-Call DIE GLEICHE userId, damit alle 31 Calls
    // demselben Rate-Limit-Bucket zugeordnet werden.
    const fixedUser = makeResponse(200, { id: "u-rate-limit-fixed" });

    // 30 erfolgreiche Calls (verifyUser + Insert + Event), danach der 31. -> 429
    for (let i = 0; i < 30; i++) {
      globalThis.fetch
        .mockResolvedValueOnce(fixedUser)
        .mockResolvedValueOnce(
          makeResponse(201, [
            {
              id: `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee${(10 + i)
                .toString()
                .padStart(2, "0")}`,
              created_at: "now",
            },
          ]),
        )
        .mockResolvedValueOnce(makeResponse(201, null));
    }
    // 31. Aufruf: nur verifyUser, dann RateLimit-Stopp -> Insert sollte NICHT mehr aufgerufen werden
    globalThis.fetch.mockResolvedValueOnce(fixedUser);

    for (let i = 0; i < 30; i++) {
      const res = makeRes();
      await handler(makeReq({ body: { subject: `Call ${i}` } }), res);
      expect(res._state.status, `Call #${i + 1} sollte 200 sein`).toBe(200);
    }

    const fetchCallsBefore = globalThis.fetch.mock.calls.length;
    const res = makeRes();
    await handler(makeReq({ body: { subject: "Over" } }), res);
    expect(res._state.status).toBe(429);
    // Nach dem RateLimit-Hit darf ausser verifyUser kein weiterer fetch erfolgt sein
    expect(globalThis.fetch.mock.calls.length - fetchCallsBefore).toBe(1);
  });
});
