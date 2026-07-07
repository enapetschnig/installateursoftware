// ============================================================
// Tests fuer api/auth/microsoft-callback.js
// ============================================================

import { afterEach, describe, expect, it } from "vitest";
import handler, { __internals } from "./microsoft-callback.js";

function makeReq({ method = "GET", headers = {}, query = {} } = {}) {
  return { method, headers, query };
}

function makeRes() {
  const state = {
    status: null,
    headers: {},
    body: null,
    endCalled: false,
  };
  const res = {
    setHeader(k, v) {
      state.headers[k] = v;
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

const ENV_KEYS = [
  "OAUTH_COOKIE_KEY",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MICROSOFT_REDIRECT_URI",
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("microsoft-callback Redirects", () => {
  it("nutzt den App-Einstellungen-Pfad fuer Erfolg und Fehler", () => {
    expect(__internals.SUCCESS_URL).toBe(
      "/app/einstellungen?tab=integrationen&connected=ok",
    );
    expect(__internals.FAIL_URL).toBe(
      "/app/einstellungen?tab=integrationen&connected=fail",
    );
  });

  it("redirectet Konfigurationsfehler auf /app/einstellungen", async () => {
    for (const key of ENV_KEYS) delete process.env[key];

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._state.status).toBe(302);
    expect(res._state.headers["Location"]).toBe(
      "/app/einstellungen?tab=integrationen&connected=fail&reason=config",
    );
    expect(res._state.endCalled).toBe(true);
  });

  it("redirectet State-Fehler auf /app/einstellungen", async () => {
    process.env.OAUTH_COOKIE_KEY = "cookie-secret";
    process.env.AZURE_CLIENT_ID = "client-id";
    process.env.AZURE_CLIENT_SECRET = "client-secret";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.MICROSOFT_REDIRECT_URI =
      "https://b4y-superapp.app/api/auth/microsoft-callback";

    const res = makeRes();
    await handler(makeReq({ query: { state: "wrong" } }), res);

    expect(res._state.status).toBe(302);
    expect(res._state.headers["Location"]).toBe(
      "/app/einstellungen?tab=integrationen&connected=fail&reason=state",
    );
    expect(res._state.endCalled).toBe(true);
  });
});
