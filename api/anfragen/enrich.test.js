// ============================================================
// Tests fuer api/anfragen/enrich.js
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler, {
  __setSupabaseClientForTests,
  __resetSupabaseClientForTests,
  __setOpenAiCallForTests,
  __resetOpenAiCallForTests,
} from "./enrich.js";

function makeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body || {})),
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
    setHeader(k, v) { state.headers[k] = v; },
    status(code) { state.status = code; return this; },
    json(obj) { state.body = obj; return this; },
    _state: state,
  };
}

// Supabase-Mock: hat .from(table).select|update|insert.
function makeSupabaseMock({
  anfrage = {
    id: "11111111-1111-1111-8111-111111111111",
    organization_id: "22222222-2222-2222-8222-222222222222",
    transcript: "agent: Hallo. user: Ich brauche einen Elektriker.",
    caller_name: null,
    caller_email: null,
    caller_address: null,
    subject: null,
    ai_extracted_data: {},
  },
  selectError = null,
  updateError = null,
} = {}) {
  const calls = { update: null, eventInsert: null };
  const client = {
    from(table) {
      if (table === "anfragen") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () =>
                    selectError
                      ? { data: null, error: selectError }
                      : { data: anfrage, error: null },
                };
              },
            };
          },
          update(payload) {
            calls.update = payload;
            return {
              eq() {
                return {
                  select() {
                    return {
                      single: async () =>
                        updateError
                          ? { data: null, error: updateError }
                          : { data: { id: anfrage.id }, error: null },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "anfrage_events") {
        return {
          insert: async (row) => {
            calls.eventInsert = row;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, calls };
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.OPENAI_API_KEY = "sk-test";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  __resetSupabaseClientForTests();
  __resetOpenAiCallForTests();
  vi.restoreAllMocks();
});

describe("anfragen/enrich", () => {
  it("405 bei nicht-POST", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "GET" }), res);
    expect(res._state.status).toBe(405);
  });

  it("401 ohne gueltigen Bearer", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeResponse(401, { msg: "no" }));
    const res = makeRes();
    await handler(makeReq({ body: { id: "11111111-1111-1111-8111-111111111111" } }), res);
    expect(res._state.status).toBe(401);
  });

  it("internal Service-Key Bearer wird akzeptiert (Webhook-Pfad)", async () => {
    const mock = makeSupabaseMock();
    __setSupabaseClientForTests(mock.client);
    __setOpenAiCallForTests(async () => ({
      classification: "interessent",
      priority: "hoch",
      summary: "Elektriker gesucht, dringend.",
      subject: "Elektriker dringend",
      caller_name: "Max Mustermann",
      gewerk: "Elektriker",
      dringlichkeit: "hoch",
    }));

    const res = makeRes();
    await handler(
      makeReq({
        body: { id: "11111111-1111-1111-8111-111111111111" },
        headers: { authorization: "Bearer service-test" },
      }),
      res,
    );

    expect(res._state.status).toBe(200);
    expect(res._state.body.classification).toBe("interessent");
    expect(res._state.body.priority).toBe("hoch");
    expect(mock.calls.update.ai_classification).toBe("interessent");
    expect(mock.calls.update.ai_priority).toBe("hoch");
    expect(mock.calls.update.subject).toBe("Elektriker dringend");
    expect(mock.calls.update.caller_name).toBe("Max Mustermann");
    expect(mock.calls.update.ai_extracted_data.gewerk).toBe("Elektriker");
    expect(mock.calls.eventInsert.event_type).toBe("ai_classified");
  });

  it("400 ohne gueltige UUID", async () => {
    // verifyUser muss erfolgreich sein:
    globalThis.fetch.mockResolvedValueOnce(makeResponse(200, { id: "u-1" }));
    const res = makeRes();
    await handler(makeReq({ body: { id: "not-a-uuid" } }), res);
    expect(res._state.status).toBe(400);
  });

  it("skipped wenn transcript leer", async () => {
    const mock = makeSupabaseMock({
      anfrage: {
        id: "11111111-1111-1111-8111-111111111111",
        organization_id: "22222222-2222-2222-8222-222222222222",
        transcript: "",
        caller_name: null,
        caller_email: null,
        caller_address: null,
        subject: null,
        ai_extracted_data: {},
      },
    });
    __setSupabaseClientForTests(mock.client);

    const res = makeRes();
    await handler(
      makeReq({
        body: { id: "11111111-1111-1111-8111-111111111111" },
        headers: { authorization: "Bearer service-test" },
      }),
      res,
    );

    expect(res._state.status).toBe(200);
    expect(res._state.body.skipped).toBe("empty_transcript");
  });

  it("502 bei OpenAI-Fehler", async () => {
    const mock = makeSupabaseMock();
    __setSupabaseClientForTests(mock.client);
    __setOpenAiCallForTests(async () => {
      throw new Error("openai_http_500");
    });

    const res = makeRes();
    await handler(
      makeReq({
        body: { id: "11111111-1111-1111-8111-111111111111" },
        headers: { authorization: "Bearer service-test" },
      }),
      res,
    );

    expect(res._state.status).toBe(502);
  });

  it("ueberschreibt existierendes subject NICHT", async () => {
    const mock = makeSupabaseMock({
      anfrage: {
        id: "11111111-1111-1111-8111-111111111111",
        organization_id: "22222222-2222-2222-8222-222222222222",
        transcript: "agent: hallo user: hi",
        caller_name: "Bestehend",
        caller_email: null,
        caller_address: null,
        subject: "Vorhandener Betreff",
        ai_extracted_data: { existing: "field" },
      },
    });
    __setSupabaseClientForTests(mock.client);
    __setOpenAiCallForTests(async () => ({
      classification: "interessent",
      priority: "mittel",
      summary: "Test",
      subject: "KI-Vorschlag",
      caller_name: "KI-Name",
      gewerk: "Maler",
    }));

    const res = makeRes();
    await handler(
      makeReq({
        body: { id: "11111111-1111-1111-8111-111111111111" },
        headers: { authorization: "Bearer service-test" },
      }),
      res,
    );

    expect(res._state.status).toBe(200);
    // subject + caller_name werden NICHT ueberschrieben:
    expect(mock.calls.update.subject).toBeUndefined();
    expect(mock.calls.update.caller_name).toBeUndefined();
    // ai_extracted_data merged:
    expect(mock.calls.update.ai_extracted_data.existing).toBe("field");
    expect(mock.calls.update.ai_extracted_data.gewerk).toBe("Maler");
  });
});
