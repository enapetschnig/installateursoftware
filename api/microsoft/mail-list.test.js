// ============================================================
// Tests fuer api/microsoft/mail-list.js
// ------------------------------------------------------------
// Wir mocken globalThis.fetch (fuer verifyUser + Graph-Call) und
// injizieren getAccessToken / getOrgId / supabase-Client ueber __setDeps.
// checkRateLimit ist in-memory und wird nicht mockbar – der 429-Test
// wird deshalb bewusst nicht abgedeckt (siehe Auftragsnotiz).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler, { __setDeps } from "./mail-list.js";

function makeResponse(status, body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return h.get(String(name).toLowerCase()) ?? null;
      },
    },
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

// Minimaler Supabase-Admin-Mock, damit deactivateTokenRow keine Exceptions
// wirft, falls ein Test den 401-Pfad triggert.
function makeAdminMock() {
  const calls = { tokenUpdate: null };
  return {
    calls,
    client: {
      from(table) {
        if (table === "microsoft_oauth_tokens") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        maybeSingle: async () => ({
                          data: { id: "row-1", error_count: 0 },
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
            update(payload) {
              calls.tokenUpdate = payload;
              return {
                eq: async () => ({ error: null }),
              };
            },
          };
        }
        // memberships etc. werden ueber __setDeps({getOrgId}) umgangen.
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return { maybeSingle: async () => ({ data: null, error: null }) };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  __setDeps({});
  vi.restoreAllMocks();
});

describe("microsoft/mail-list", () => {
  it("405 bei nicht-GET", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "POST" }), res);
    expect(res._state.status).toBe(405);
    expect(res._state.headers.Allow).toBe("GET");
  });

  it("401 ohne gueltigen Bearer", async () => {
    // verifyUser ruft /auth/v1/user – 401 zurueckgeben.
    globalThis.fetch.mockResolvedValueOnce(makeResponse(401, { msg: "no" }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(401);
    expect(res._state.body).toEqual({ error: "Nicht angemeldet." });
  });

  it("404 wenn keine Organisation (memberships leer)", async () => {
    // verifyUser ok, aber getOrgId liefert null.
    globalThis.fetch.mockResolvedValueOnce(makeResponse(200, { id: "user-1" }));
    __setDeps({
      supabase: makeAdminMock().client,
      getOrgId: async () => null,
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(404);
    expect(res._state.body.error).toMatch(/Organisation/);
  });

  it("401 mit reconnect_required wenn Token invalid/nicht verbunden", async () => {
    // Reconnect-worthy Codes (not_connected/inactive/no_token/fatal) → 401,
    // damit das Frontend den User in den Verbinden-Flow leitet.
    globalThis.fetch.mockResolvedValueOnce(makeResponse(200, { id: "user-1" }));
    __setDeps({
      supabase: makeAdminMock().client,
      getOrgId: async () => "org-1",
      getAccessToken: async () => {
        const err = new Error("Microsoft-Konto nicht verbunden");
        err.code = "not_connected";
        throw err;
      },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(401);
    expect(res._state.body.code).toBe("reconnect_required");
    expect(res._state.body.error).toMatch(/neu verbinden/);
  });

  it("502 bei transientem Token-Endpoint-Fehler (kein reconnect-Code)", async () => {
    // Netzwerk-Ausfall zum Azure-Token-Endpoint / anderer nicht-fataler Fehler
    // → 502, damit der User es einfach nochmal versucht.
    globalThis.fetch.mockResolvedValueOnce(makeResponse(200, { id: "user-1" }));
    __setDeps({
      supabase: makeAdminMock().client,
      getOrgId: async () => "org-1",
      getAccessToken: async () => {
        throw new Error("ECONNRESET");
      },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(502);
  });

  it("Erfolg: liefert messages-Array + nextLink + total", async () => {
    globalThis.fetch
      // 1) verifyUser
      .mockResolvedValueOnce(makeResponse(200, { id: "user-1" }))
      // 2) Graph-Call
      .mockResolvedValueOnce(
        makeResponse(200, {
          value: [
            {
              id: "AAA",
              subject: "Angebot 2026",
              from: { emailAddress: { name: "Kunde", address: "k@example.com" } },
              toRecipients: [
                { emailAddress: { name: "Me", address: "me@firma.at" } },
              ],
              receivedDateTime: "2026-07-01T09:00:00Z",
              isRead: false,
              hasAttachments: true,
              bodyPreview: "Hallo, koennen Sie...",
              importance: "high",
            },
            {
              id: "BBB",
              subject: "Rueckfrage",
              from: { emailAddress: { name: "B", address: "b@example.com" } },
              toRecipients: [],
              receivedDateTime: "2026-06-30T14:20:00Z",
              isRead: true,
              hasAttachments: false,
              bodyPreview: "Danke!",
              importance: "normal",
            },
          ],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=25",
          "@odata.count": 137,
        }),
      );

    __setDeps({
      supabase: makeAdminMock().client,
      getOrgId: async () => "org-1",
      getAccessToken: async () => "graph-access-token",
    });

    const res = makeRes();
    await handler(makeReq({ query: { top: "25", skip: "0", folder: "inbox" } }), res);

    expect(res._state.status).toBe(200);
    expect(Array.isArray(res._state.body.messages)).toBe(true);
    expect(res._state.body.messages).toHaveLength(2);
    expect(res._state.body.messages[0].id).toBe("AAA");
    expect(res._state.body.messages[0].subject).toBe("Angebot 2026");
    expect(res._state.body.messages[0].from.emailAddress.address).toBe(
      "k@example.com",
    );
    expect(res._state.body.messages[0].hasAttachments).toBe(true);
    expect(res._state.body.messages[0].importance).toBe("high");
    expect(res._state.body.nextLink).toContain("skip=25");
    expect(res._state.body.total).toBe(137);

    // Der Graph-Fetch soll die richtige URL + Header nutzen.
    const graphCall = globalThis.fetch.mock.calls[1];
    expect(graphCall[0]).toContain("/me/mailFolders/inbox/messages");
    expect(graphCall[0]).toContain("%24top=25");
    expect(graphCall[0]).toContain("%24orderby=receivedDateTime+desc");
    expect(graphCall[1].headers.Authorization).toBe("Bearer graph-access-token");
    expect(graphCall[1].headers.ConsistencyLevel).toBe("eventual");
  });

  it("mapt search auf $filter mit escaped OData-Quotes", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "user-1" }))
      .mockResolvedValueOnce(
        makeResponse(200, { value: [], "@odata.count": 0 }),
      );

    __setDeps({
      supabase: makeAdminMock().client,
      getOrgId: async () => "org-1",
      getAccessToken: async () => "tok",
    });

    const res = makeRes();
    await handler(
      makeReq({ query: { search: "O'Brien Rechnung" } }),
      res,
    );

    expect(res._state.status).toBe(200);
    const graphUrl = globalThis.fetch.mock.calls[1][0];
    // Einzelnes ' wird zu '' (URL-encoded: %27%27).
    expect(graphUrl).toContain("%24filter=");
    expect(graphUrl).toContain("O%27%27Brien");
  });

  it("502 wenn Graph 401 liefert (Token invalidiert)", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "user-1" }))
      .mockResolvedValueOnce(makeResponse(401, { error: "InvalidAuthenticationToken" }));

    const admin = makeAdminMock();
    __setDeps({
      supabase: admin.client,
      getOrgId: async () => "org-1",
      getAccessToken: async () => "tok",
    });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._state.status).toBe(502);
    expect(res._state.body.error).toMatch(/Microsoft-Verbindung/);
    // Token-Row wurde deaktiviert.
    expect(admin.calls.tokenUpdate).toBeTruthy();
    expect(admin.calls.tokenUpdate.is_active).toBe(false);
  });

  it("503 wenn Graph 429 nach Retries weiter 429 zurueckliefert", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "user-1" }))
      // 3x 429 (initial + 2 retries)
      .mockResolvedValueOnce(makeResponse(429, {}, { "Retry-After": "0" }))
      .mockResolvedValueOnce(makeResponse(429, {}, { "Retry-After": "0" }))
      .mockResolvedValueOnce(makeResponse(429, {}, { "Retry-After": "0" }));

    __setDeps({
      supabase: makeAdminMock().client,
      getOrgId: async () => "org-1",
      getAccessToken: async () => "tok",
    });

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._state.status).toBe(503);
  });

  it("unbekannter Ordner faellt auf 'inbox' zurueck", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "user-1" }))
      .mockResolvedValueOnce(
        makeResponse(200, { value: [], "@odata.count": 0 }),
      );

    __setDeps({
      supabase: makeAdminMock().client,
      getOrgId: async () => "org-1",
      getAccessToken: async () => "tok",
    });

    const res = makeRes();
    await handler(makeReq({ query: { folder: "; drop table --" } }), res);
    expect(res._state.status).toBe(200);
    const graphUrl = globalThis.fetch.mock.calls[1][0];
    expect(graphUrl).toContain("/me/mailFolders/inbox/messages");
  });

  it("top wird auf 1..100 geklemmt (default 25)", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "user-1" }))
      .mockResolvedValueOnce(
        makeResponse(200, { value: [], "@odata.count": 0 }),
      );

    __setDeps({
      supabase: makeAdminMock().client,
      getOrgId: async () => "org-1",
      getAccessToken: async () => "tok",
    });

    const res = makeRes();
    // Absurde Werte: 9999 (soll auf 100 gekappt werden)
    await handler(makeReq({ query: { top: "9999" } }), res);
    expect(res._state.status).toBe(200);
    const graphUrl = globalThis.fetch.mock.calls[1][0];
    expect(graphUrl).toContain("%24top=100");
  });
});
