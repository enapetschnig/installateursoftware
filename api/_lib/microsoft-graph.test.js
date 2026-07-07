// ============================================================
// Tests für api/_lib/microsoft-graph.js
// ------------------------------------------------------------
// Wir mocken:
//   • globalThis.fetch        – Microsoft-Graph- und Token-Endpoint
//   • ./encryption.js         – encrypt-/decryptToken (Identitäts-Mock)
//   • ./safe-log.js           – logSafe/redactJwt (No-Op)
//   • supabaseAdmin           – minimaler Chain-Mock von select/eq/update
//   • setTimeout (Fake-Timer) – damit Retry-Sleeps deterministisch sind
//
// Geprüfte Szenarien:
//   1. Token expired              → refresh-Call wird ausgelöst
//   2. Token < 60s Restlaufzeit    → proaktiver Refresh
//   3. 429 mit Retry-After=2       → ein Retry, dann Erfolg
//   4. 500                         → ein Retry, dann Erfolg (Exponential)
//   5. invalid_grant beim Refresh  → is_active=false, error_count++, Throw
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Modul-Mocks (vor dem Import des SUT setzen!) ───────────
vi.mock("../../api/_lib/encryption.js", () => ({
  encryptToken: vi.fn(async (s) => `enc(${s})`),
  decryptToken: vi.fn(async (s) =>
    typeof s === "string" && s.startsWith("enc(") && s.endsWith(")")
      ? s.slice(4, -1)
      : s,
  ),
}));
vi.mock("../../api/_lib/safe-log.js", () => ({
  logSafe: vi.fn(),
  redactJwt: vi.fn((s) => `[redacted:${(s || "").slice(0, 6)}]`),
}));
// Vitest löst relative Specifier aus Sicht der Testdatei auf;
// das SUT selbst importiert "./encryption.js" / "./safe-log.js".
// Daher mocken wir BEIDE Pfade (relativ zum SUT und absolut).
vi.mock("./encryption.js", () => ({
  encryptToken: vi.fn(async (s) => `enc(${s})`),
  decryptToken: vi.fn(async (s) =>
    typeof s === "string" && s.startsWith("enc(") && s.endsWith(")")
      ? s.slice(4, -1)
      : s,
  ),
}));
vi.mock("./safe-log.js", () => ({
  logSafe: vi.fn(),
  redactJwt: vi.fn((s) => `[redacted:${(s || "").slice(0, 6)}]`),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    /* unused: Tests injizieren ihren eigenen Admin-Client */
  })),
}));

// SUT erst nach den Mocks importieren (dynamic import).
const sutPromise = import("./microsoft-graph.js");

// ── Helfer ────────────────────────────────────────────────

/**
 * Baut einen minimalen Supabase-Admin-Client-Mock, dessen Methoden
 * chainable sind (.from().select().eq().eq().maybeSingle() und .update().eq()).
 *
 * @param {object} opts
 * @param {object|null} opts.row     row die maybeSingle() liefert
 * @param {object|null} opts.error   error den select/update liefert
 */
function makeAdminMock({ row = null, error = null } = {}) {
  const updates = [];

  const selectChain = {
    select: vi.fn(() => selectChain),
    eq: vi.fn(() => selectChain),
    maybeSingle: vi.fn(async () => ({ data: row, error })),
  };

  const updateChain = {
    update: vi.fn((patch) => {
      updates.push({ patch, eqs: [] });
      return updateChain;
    }),
    eq: vi.fn(async (col, val) => {
      const last = updates[updates.length - 1];
      if (last) last.eqs.push({ col, val });
      return { data: null, error };
    }),
  };

  const admin = {
    from: vi.fn(() => ({
      select: selectChain.select,
      update: updateChain.update,
    })),
    __updates: updates,
    __selectChain: selectChain,
    __updateChain: updateChain,
  };
  return admin;
}

/**
 * Erzeugt eine fetch-mock Response.
 */
function makeResponse(status, body, headers = {}) {
  const hMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => hMap.get(String(name).toLowerCase()) || null,
    },
    json: async () => body,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body || {}),
  };
}

// ── Setup / Teardown ──────────────────────────────────────

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
  process.env.AZURE_CLIENT_ID = "test-client-id";
  process.env.AZURE_CLIENT_SECRET = "test-client-secret";

  // Fake-Timer: graphFetch() ruft intern sleep(ms) auf – mit
  // vi.runAllTimersAsync() lassen wir alle Timer durchlaufen und
  // bringen den Retry-Pfad deterministisch ans Ziel.
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────

describe("getGraphAccessToken", () => {
  it("refresht proaktiv, wenn das Token in < 60s abläuft", async () => {
    const { getGraphAccessToken } = await sutPromise;
    const expiresAt = new Date(Date.now() + 30_000).toISOString(); // 30s → < threshold
    const admin = makeAdminMock({
      row: {
        id: "row-1",
        user_id: "u1",
        organization_id: "o1",
        access_token_enc: "enc(old-access)",
        refresh_token_enc: "enc(refresh-1)",
        expires_at: expiresAt,
        is_active: true,
        error_count: 0,
        last_error_message: null,
      },
    });

    globalThis.fetch.mockResolvedValueOnce(
      makeResponse(
        200,
        {
          access_token: "new-access-xyz",
          refresh_token: "new-refresh-abc",
          expires_in: 3600,
        },
        { "Content-Type": "application/json" },
      ),
    );

    const token = await getGraphAccessToken("u1", "o1", admin);
    expect(token).toBe("new-access-xyz");

    // Es wurde der Microsoft-Token-Endpoint kontaktiert.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("client_id=test-client-id");
    // Refresh-Token wurde entschlüsselt mitgeschickt.
    expect(String(init.body)).toContain("refresh_token=refresh-1");

    // Update-Schreibvorgang wurde ausgeführt; is_active bleibt true, error_count=0.
    expect(admin.__updateChain.update).toHaveBeenCalledTimes(1);
    const patch = admin.__updateChain.update.mock.calls[0][0];
    expect(patch.is_active).toBe(true);
    expect(patch.error_count).toBe(0);
    expect(patch.access_token_enc).toBe("enc(new-access-xyz)");
    expect(patch.refresh_token_enc).toBe("enc(new-refresh-abc)");
  });

  it("liefert das gespeicherte Token zurück, wenn noch genügend Restlaufzeit besteht", async () => {
    const { getGraphAccessToken } = await sutPromise;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 min
    const admin = makeAdminMock({
      row: {
        id: "row-1",
        user_id: "u1",
        organization_id: "o1",
        access_token_enc: "enc(stored-access)",
        refresh_token_enc: "enc(refresh-1)",
        expires_at: expiresAt,
        is_active: true,
        error_count: 0,
      },
    });
    // Kein fetch erwartet.
    globalThis.fetch.mockRejectedValue(new Error("should not be called"));

    const token = await getGraphAccessToken("u1", "o1", admin);
    expect(token).toBe("stored-access");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("wirft, wenn das Konto deaktiviert ist (is_active=false)", async () => {
    const { getGraphAccessToken } = await sutPromise;
    const admin = makeAdminMock({
      row: {
        id: "row-1",
        user_id: "u1",
        organization_id: "o1",
        access_token_enc: "enc(stored-access)",
        refresh_token_enc: "enc(refresh-1)",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        is_active: false,
        error_count: 3,
      },
    });
    await expect(getGraphAccessToken("u1", "o1", admin)).rejects.toThrow(
      /deaktiviert/i,
    );
  });

  it("wirft, wenn überhaupt keine Row existiert", async () => {
    const { getGraphAccessToken } = await sutPromise;
    const admin = makeAdminMock({ row: null });
    await expect(getGraphAccessToken("u1", "o1", admin)).rejects.toThrow(
      /nicht verbunden/i,
    );
  });

  it("löst proaktiven Refresh aus, wenn expires_at bereits in der Vergangenheit liegt", async () => {
    const { getGraphAccessToken } = await sutPromise;
    const admin = makeAdminMock({
      row: {
        id: "row-x",
        user_id: "u1",
        organization_id: "o1",
        access_token_enc: "enc(old)",
        refresh_token_enc: "enc(r)",
        expires_at: new Date(Date.now() - 5_000).toISOString(),
        is_active: true,
        error_count: 0,
      },
    });
    globalThis.fetch.mockResolvedValueOnce(
      makeResponse(200, {
        access_token: "fresh",
        refresh_token: "r2",
        expires_in: 3600,
      }),
    );
    const token = await getGraphAccessToken("u1", "o1", admin);
    expect(token).toBe("fresh");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("refreshGraphToken – invalid_grant", () => {
  it("setzt is_active=false, erhöht error_count und wirft", async () => {
    const { refreshGraphToken } = await sutPromise;
    const admin = makeAdminMock();
    const row = {
      id: "row-2",
      user_id: "u2",
      organization_id: "o2",
      refresh_token_enc: "enc(stale-refresh)",
      error_count: 1,
    };

    globalThis.fetch.mockResolvedValueOnce(
      makeResponse(
        400,
        {
          error: "invalid_grant",
          error_description: "AADSTS70000: refresh token expired",
        },
        { "Content-Type": "application/json" },
      ),
    );

    await expect(refreshGraphToken(row, admin)).rejects.toThrow(
      /invalid_grant|refresh/i,
    );

    // update wurde mit is_active=false und error_count=2 aufgerufen.
    expect(admin.__updateChain.update).toHaveBeenCalledTimes(1);
    const patch = admin.__updateChain.update.mock.calls[0][0];
    expect(patch.is_active).toBe(false);
    expect(patch.error_count).toBe(2);
    expect(typeof patch.last_error_message).toBe("string");
    expect(patch.last_error_message.length).toBeGreaterThan(0);
  });
});

describe("graphFetch retry behaviour", () => {
  it("retried bei 429 mit Retry-After=2 und liefert dann 200", async () => {
    const { graphFetch } = await sutPromise;

    globalThis.fetch
      .mockResolvedValueOnce(
        makeResponse(429, { error: "throttled" }, { "Retry-After": "2" }),
      )
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const promise = graphFetch("access-xyz", "/me/messages");

    // Fake-Timer: nach 2 s sollte der zweite Versuch starten.
    // runAllTimersAsync() durchläuft den await sleep(2000) sicher.
    await vi.runAllTimersAsync();

    const resp = await promise;
    expect(resp.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // Zweiter Call hat denselben URL/Pfad.
    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/me/messages",
    );
    expect(globalThis.fetch.mock.calls[1][0]).toBe(
      "https://graph.microsoft.com/v1.0/me/messages",
    );
    // Auth-Header wurde injiziert.
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer access-xyz",
    );
  });

  it("retried bei 500 mit Exponential Backoff (2s) und liefert dann 200", async () => {
    const { graphFetch } = await sutPromise;

    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(500, { error: "server" }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const promise = graphFetch("access-xyz", "/users/me");

    await vi.runAllTimersAsync();

    const resp = await promise;
    expect(resp.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("gibt nach 3 Retries einen anhaltenden 500 zurück (kein Endlos-Loop)", async () => {
    const { graphFetch } = await sutPromise;

    // 1 initialer + 3 Retries = 4 Calls insgesamt.
    for (let i = 0; i < 4; i += 1) {
      globalThis.fetch.mockResolvedValueOnce(
        makeResponse(500, { error: "server" }),
      );
    }
    const promise = graphFetch("access-xyz", "/me/messages");
    await vi.runAllTimersAsync();
    const resp = await promise;

    expect(resp.status).toBe(500);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it("gibt einen 4xx-Status (außer 429) sofort zurück, ohne Retry", async () => {
    const { graphFetch } = await sutPromise;
    globalThis.fetch.mockResolvedValueOnce(
      makeResponse(403, { error: "forbidden" }),
    );
    const resp = await graphFetch("access-xyz", "/me/messages");
    expect(resp.status).toBe(403);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("__internal helpers", () => {
  it("parseRetryAfterMs akzeptiert Sekunden und kappt bei 30s", async () => {
    const { __internal } = await sutPromise;
    expect(__internal.parseRetryAfterMs("2")).toBe(2_000);
    expect(__internal.parseRetryAfterMs("0")).toBe(0);
    expect(__internal.parseRetryAfterMs("9999")).toBe(30_000);
    expect(__internal.parseRetryAfterMs("not-a-number")).toBeNull();
    expect(__internal.parseRetryAfterMs("")).toBeNull();
    expect(__internal.parseRetryAfterMs(null)).toBeNull();
  });
});
