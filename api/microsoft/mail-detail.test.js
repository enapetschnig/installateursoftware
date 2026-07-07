// ============================================================
// Tests fuer api/microsoft/mail-detail.js
// ------------------------------------------------------------
// Wir mocken:
//   • ../_lib/security.js       – bearerFromRequest/verifyUser/checkRateLimit
//   • ../_lib/microsoft-graph.js – getGraphAccessToken/graphFetch
//   • ../_lib/safe-log.js       – logSafe (No-Op)
//   • @supabase/supabase-js     – admin-Chain (memberships-Lookup)
//
// Geprueft:
//   1. 405 bei nicht-GET
//   2. 401 ohne Bearer / ungueltigem User
//   3. 400 wenn id fehlt
//   4. 429 wenn Rate-Limit ueberschritten
//   5. 404 wenn Graph 404 liefert
//   6. 401 wenn Graph 401/403 liefert (Token invalid)
//   7. 502 bei sonstigen Graph-Fehlern
//   8. 200 mit korrekt gemappter Message + Attachments (Body 1:1)
//   9. 401 wenn Microsoft-Konto nicht verbunden
//  10. 401 wenn keine Membership existiert
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Modul-Mocks (VOR dem SUT-Import setzen) ────────────────
const securityMock = vi.hoisted(() => ({
  bearerFromRequest: vi.fn((req) =>
    (req.headers?.authorization || "").replace(/^Bearer\s+/i, ""),
  ),
  verifyUser: vi.fn(),
  checkRateLimit: vi.fn(() => true),
}));

vi.mock("../_lib/security.js", () => securityMock);

vi.mock("../_lib/safe-log.js", () => ({
  logSafe: vi.fn(),
  redactJwt: vi.fn((s) => `[redacted:${(s || "").slice(0, 6)}]`),
}));

const graphMock = vi.hoisted(() => ({
  getGraphAccessToken: vi.fn(),
  graphFetch: vi.fn(),
}));

vi.mock("../_lib/microsoft-graph.js", () => graphMock);

// memberships-Lookup: wir bauen einen chainable Admin-Client, dessen
// maybeSingle() das (org_id, error)-Ergebnis liefert.
const membershipState = { orgId: "org-1", error: null };
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: vi.fn(() => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({
          data: membershipState.orgId
            ? { organization_id: membershipState.orgId }
            : null,
          error: membershipState.error,
        })),
      };
      return {
        from: vi.fn(() => chain),
      };
    }),
  };
});

// ── Helper ────────────────────────────────────────────────

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
    end() {
      return this;
    },
    _state: state,
  };
}

function graphResp(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const SAMPLE_MESSAGE = {
  id: "AAMk-abc-123",
  subject: "Angebot Nr. 2026-042",
  from: {
    emailAddress: { name: "Max Muster", address: "max@example.com" },
  },
  toRecipients: [
    { emailAddress: { name: "Kunde", address: "kunde@example.com" } },
  ],
  ccRecipients: [
    { emailAddress: { name: "CC", address: "cc@example.com" } },
  ],
  bccRecipients: [],
  receivedDateTime: "2026-06-30T10:00:00Z",
  sentDateTime: "2026-06-30T09:59:00Z",
  isRead: false,
  hasAttachments: true,
  importance: "normal",
  conversationId: "conv-xyz",
  body: {
    contentType: "HTML",
    content: "<p>Sehr geehrte Damen und Herren</p>",
  },
  attachments: [
    {
      id: "att-1",
      name: "angebot.pdf",
      size: 12345,
      contentType: "application/pdf",
      isInline: false,
    },
    {
      id: "att-2",
      name: "logo.png",
      size: 800,
      contentType: "image/png",
      isInline: true,
    },
  ],
};

// ── Setup/Teardown ─────────────────────────────────────────

let handler;

beforeEach(async () => {
  vi.resetModules();

  securityMock.bearerFromRequest.mockReset();
  securityMock.bearerFromRequest.mockImplementation((req) =>
    (req.headers?.authorization || "").replace(/^Bearer\s+/i, ""),
  );
  securityMock.verifyUser.mockReset();
  securityMock.checkRateLimit.mockReset();
  securityMock.checkRateLimit.mockReturnValue(true);
  graphMock.getGraphAccessToken.mockReset();
  graphMock.graphFetch.mockReset();

  // Default: user OK, org OK, token OK, message OK.
  securityMock.verifyUser.mockResolvedValue({ id: "user-1" });
  graphMock.getGraphAccessToken.mockResolvedValue("access-abc");
  graphMock.graphFetch.mockResolvedValue(graphResp(200, SAMPLE_MESSAGE));
  membershipState.orgId = "org-1";
  membershipState.error = null;

  // Sicherstellen dass Service-Role-Key vorhanden ist.
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sr-test";

  ({ default: handler } = await import("./mail-detail.js"));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────

describe("mail-detail", () => {
  it("405 bei nicht-GET", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "POST", query: { id: "abc" } }), res);
    expect(res._state.status).toBe(405);
    expect(res._state.headers.Allow).toBe("GET");
  });

  it("401 ohne gueltigen User", async () => {
    securityMock.verifyUser.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(401);
    expect(res._state.body.error).toMatch(/Nicht angemeldet/i);
  });

  it("400 wenn id-Parameter fehlt", async () => {
    const res = makeRes();
    await handler(makeReq({ query: {} }), res);
    expect(res._state.status).toBe(400);
    expect(res._state.body.error).toMatch(/id/);
  });

  it("400 wenn id leer/whitespace", async () => {
    const res = makeRes();
    await handler(makeReq({ query: { id: "   " } }), res);
    expect(res._state.status).toBe(400);
  });

  it("429 wenn Rate-Limit ueberschritten", async () => {
    securityMock.checkRateLimit.mockReturnValueOnce(false);
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(429);
    // Bestaetigt: 120/60s Limit wurde tatsaechlich angefragt.
    expect(securityMock.checkRateLimit).toHaveBeenCalledWith(
      "user-1",
      120,
      60_000,
    );
  });

  it("401 wenn keine aktive Organisation", async () => {
    membershipState.orgId = null;
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(401);
    expect(res._state.body.error).toMatch(/Organisation/i);
  });

  it("401 wenn Microsoft-Konto nicht verbunden", async () => {
    const err = new Error("Microsoft-Konto nicht verbunden.");
    err.code = "not_connected";
    graphMock.getGraphAccessToken.mockRejectedValueOnce(err);
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(401);
    expect(res._state.body.error).toMatch(/nicht verbunden/i);
  });

  it("401 wenn Refresh-Token invalid (fatal)", async () => {
    const err = new Error("Microsoft-Refresh fehlgeschlagen: invalid_grant");
    err.code = "invalid_grant";
    err.fatal = true;
    graphMock.getGraphAccessToken.mockRejectedValueOnce(err);
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(401);
  });

  it("502 bei unbekanntem Token-Fehler", async () => {
    graphMock.getGraphAccessToken.mockRejectedValueOnce(
      new Error("Netzwerk kaputt"),
    );
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(502);
  });

  it("404 wenn Graph 404 zurueckgibt", async () => {
    graphMock.graphFetch.mockResolvedValueOnce(
      graphResp(404, { error: { code: "ItemNotFound" } }),
    );
    const res = makeRes();
    await handler(makeReq({ query: { id: "does-not-exist" } }), res);
    expect(res._state.status).toBe(404);
    expect(res._state.body.error).toMatch(/nicht gefunden/i);
  });

  it("401 wenn Graph 401 zurueckgibt (Token abgelaufen zwischen Refresh+Call)", async () => {
    graphMock.graphFetch.mockResolvedValueOnce(graphResp(401, { error: "x" }));
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(401);
  });

  it("502 wenn Graph 500 nach Retries liefert", async () => {
    graphMock.graphFetch.mockResolvedValueOnce(graphResp(500, { error: "boom" }));
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(502);
  });

  it("502 bei Graph-Netzwerk-Exception", async () => {
    graphMock.graphFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(502);
  });

  it("200: mapped message inkl. Attachments, body 1:1", async () => {
    const res = makeRes();
    await handler(makeReq({ query: { id: SAMPLE_MESSAGE.id } }), res);

    expect(res._state.status).toBe(200);
    const b = res._state.body;
    expect(b.id).toBe(SAMPLE_MESSAGE.id);
    expect(b.subject).toBe("Angebot Nr. 2026-042");
    expect(b.from).toEqual(SAMPLE_MESSAGE.from);
    expect(b.toRecipients).toHaveLength(1);
    expect(b.ccRecipients).toHaveLength(1);
    expect(b.bccRecipients).toEqual([]);
    expect(b.conversationId).toBe("conv-xyz");
    expect(b.isRead).toBe(false);
    expect(b.hasAttachments).toBe(true);
    // Body: contentType normalisiert auf lowercase, content 1:1 durchgereicht.
    expect(b.body.contentType).toBe("html");
    expect(b.body.content).toBe("<p>Sehr geehrte Damen und Herren</p>");
    // Attachments: alle Felder, isInline als bool.
    expect(b.attachments).toHaveLength(2);
    expect(b.attachments[0]).toEqual({
      id: "att-1",
      name: "angebot.pdf",
      size: 12345,
      contentType: "application/pdf",
      isInline: false,
    });
    expect(b.attachments[1].isInline).toBe(true);

    // Graph-Call: korrekter Pfad mit $expand=attachments.
    expect(graphMock.graphFetch).toHaveBeenCalledTimes(1);
    const [tok, path] = graphMock.graphFetch.mock.calls[0];
    expect(tok).toBe("access-abc");
    expect(path).toContain(`/me/messages/${encodeURIComponent(SAMPLE_MESSAGE.id)}`);
    expect(path).toContain("$expand=attachments");
    expect(path).toContain("id,name,size,contentType,isInline");
  });

  it("200: body wird bei fehlendem contentType auf 'text' gemapped", async () => {
    graphMock.graphFetch.mockResolvedValueOnce(
      graphResp(200, {
        ...SAMPLE_MESSAGE,
        body: { contentType: "Text", content: "Plain text body" },
        attachments: [],
        hasAttachments: false,
      }),
    );
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(200);
    expect(res._state.body.body.contentType).toBe("text");
    expect(res._state.body.body.content).toBe("Plain text body");
    expect(res._state.body.attachments).toEqual([]);
    expect(res._state.body.hasAttachments).toBe(false);
  });

  it("502 wenn Graph invalides JSON liefert", async () => {
    graphMock.graphFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("invalid json");
      },
    });
    const res = makeRes();
    await handler(makeReq({ query: { id: "abc" } }), res);
    expect(res._state.status).toBe(502);
  });

  it("id wird URL-encoded im Graph-Pfad", async () => {
    // Graph-IDs enthalten typischerweise '/', '=', '+' → muessen encoded werden.
    const trickyId = "AAMk/abc+def=ghi";
    graphMock.graphFetch.mockResolvedValueOnce(
      graphResp(200, { ...SAMPLE_MESSAGE, id: trickyId, attachments: [] }),
    );
    const res = makeRes();
    await handler(makeReq({ query: { id: trickyId } }), res);
    expect(res._state.status).toBe(200);
    const [, path] = graphMock.graphFetch.mock.calls[0];
    // Slash und '+' MUESSEN encoded sein (%2F, %2B, %3D), sonst bricht Graph.
    expect(path).toContain(encodeURIComponent(trickyId));
    expect(path).not.toContain("/abc+def=");
  });
});
