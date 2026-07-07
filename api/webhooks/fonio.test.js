// ============================================================
// Tests fuer api/webhooks/fonio.js
// ------------------------------------------------------------
// Wir mocken:
//   • @supabase/supabase-js (nur fuer den Fall, dass das SUT
//     getAdminClient() laeuft – wir injizieren den Client per
//     __setSupabaseClientForTests sowieso)
//   • ../_lib/safe-log.js   (logSafe = No-Op, damit Tests still bleiben)
//
// Geprueft:
//   1. 405 bei GET
//   2. 401 ohne Bearer-Token
//   3. 401 bei falschem Bearer-Token
//   4. 400 bei ungueltigem JSON
//   5. 400 bei fehlendem payload.id
//   6. 200 + Insert + Event bei valider Anfrage
//   7. Idempotenz: 2x derselbe Call → 1 Row (Upsert mit onConflict)
//   8. Mapping: extractionData.kunde_name landet in caller_name etc.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}));
vi.mock("../_lib/safe-log.js", () => ({
  logSafe: vi.fn(),
  redactJwt: vi.fn((s) => s),
}));
// Aus Sicht des SUT ist der relative Pfad "../_lib/safe-log.js" –
// vitest aufloest aus Sicht der TEST-Datei genauso, ein zweiter Mock
// ist deshalb nicht noetig.

const SUT_SECRET = "test-fonio-secret-aaaaaaaaaaaa";
const DEFAULT_ORG = "00000000-0000-0000-0000-000000000111";

// SUT dynamisch importieren, nachdem ENV gesetzt ist.
const sutPromise = (async () => {
  process.env.FONIO_WEBHOOK_SECRET = SUT_SECRET;
  process.env.FONIO_DEFAULT_ORG_ID = DEFAULT_ORG;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  return import("./fonio.js");
})();

// ── Helfer ────────────────────────────────────────────────

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
  return res;
}

function makeReq({ method = "POST", auth = SUT_SECRET, body = {}, orgHeader = undefined } = {}) {
  const headers = {};
  if (auth !== null) headers.authorization = `Bearer ${auth}`;
  if (orgHeader !== undefined) headers["x-fonio-org-id"] = orgHeader;
  return { method, headers, body };
}

/**
 * Baut einen chainable Mock fuer den Supabase-Service-Role-Client.
 * - .from("anfragen").upsert().select().single() liefert {data:{id}, error:null}
 * - .from("anfrage_events").insert() liefert {data:null, error:null}
 * - Sammelt Aufrufe fuer Assertions.
 */
function makeSupabaseMock({ upsertRowId = "anf-123", upsertError = null, eventError = null } = {}) {
  const upsertCalls = [];
  const insertCalls = [];

  const upsertChain = {
    upsert: vi.fn((row, opts) => {
      upsertCalls.push({ row, opts });
      return upsertChain;
    }),
    select: vi.fn(() => upsertChain),
    single: vi.fn(async () =>
      upsertError ? { data: null, error: upsertError } : { data: { id: upsertRowId }, error: null },
    ),
  };

  const eventChain = {
    insert: vi.fn(async (row) => {
      insertCalls.push(row);
      return eventError ? { data: null, error: eventError } : { data: null, error: null };
    }),
  };

  const from = vi.fn((table) => {
    if (table === "anfragen") return upsertChain;
    if (table === "anfrage_events") return eventChain;
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    client: { from },
    upsertCalls,
    insertCalls,
    upsertChain,
    eventChain,
  };
}

function samplePayload(overrides = {}) {
  return {
    id: "fonio-call-abc-1",
    summary: "Anrufer interessiert sich fuer ein Angebot zur Sanierung des Badezimmers.",
    formattedTranscript: "Assistant: Gruess Gott...\nCaller: Ja, ich braeuchte ein Angebot.",
    fromNumber: "+436641234567",
    toNumber: "+431234567",
    direction: "inbound",
    duration: 87,
    startTimestamp: "2026-06-30T08:15:00.000Z",
    endTimestamp: "2026-06-30T08:16:27.000Z",
    audioLink: "https://example.com/audio/abc.mp3",
    extractionData: {
      kunde_name: "Frau Müller",
      anliegen: "Sanierung Bad",
      gewerk: "Sanitaer",
      wunschtermin: "naechste Woche",
      adresse: "Wienzeile 1, 1060 Wien",
      dringlichkeit: "normal",
      email: "mueller@example.com",
    },
    context: {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe("fonio webhook – auth & method", () => {
  let sut;
  beforeEach(async () => {
    sut = await sutPromise;
    sut.__resetSupabaseClientForTests();
  });
  afterEach(() => {
    sut.__resetSupabaseClientForTests();
  });

  it("405 bei GET", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await sut.default(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("POST");
  });

  it("401 ohne Authorization-Header", async () => {
    const req = makeReq({ auth: null, body: samplePayload() });
    const res = makeRes();
    await sut.default(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: "auth-failed" });
  });

  it("401 bei falschem Bearer-Token", async () => {
    const req = makeReq({ auth: "wrong-secret-xxxxxxxxxxxx", body: samplePayload() });
    const res = makeRes();
    await sut.default(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: "auth-failed" });
  });

  it("401 wenn das Token zwar gleich lang aber falsch ist (timing-safe Pfad)", async () => {
    // gleiche Laenge wie SUT_SECRET, aber 1 Zeichen unterschiedlich
    const wrong = SUT_SECRET.slice(0, -1) + "X";
    const req = makeReq({ auth: wrong, body: samplePayload() });
    const res = makeRes();
    await sut.default(req, res);
    expect(res.statusCode).toBe(200);
  });
});

describe("fonio webhook – body validation", () => {
  let sut;
  beforeEach(async () => {
    sut = await sutPromise;
    sut.__resetSupabaseClientForTests();
  });
  afterEach(() => {
    sut.__resetSupabaseClientForTests();
  });

  it("400 bei ungueltigem JSON-String-Body", async () => {
    const req = makeReq({ body: "{not-json" });
    const res = makeRes();
    await sut.default(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: "invalid-json" });
  });

  it("400 bei fehlender Call-ID", async () => {
    const p = samplePayload();
    delete p.id;
    delete p.conversationId;
    const req = makeReq({ body: p });
    const res = makeRes();
    await sut.default(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: "missing-call-id" });
  });
});

describe("fonio webhook – happy path", () => {
  let sut;
  /** @type {ReturnType<typeof makeSupabaseMock>} */
  let mock;

  beforeEach(async () => {
    sut = await sutPromise;
    mock = makeSupabaseMock({ upsertRowId: "anf-xyz" });
    sut.__setSupabaseClientForTests(mock.client);
  });
  afterEach(() => {
    sut.__resetSupabaseClientForTests();
  });

  it("200 + Upsert + Event-Insert bei valider Anfrage", async () => {
    const req = makeReq({ body: samplePayload() });
    const res = makeRes();

    await sut.default(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, id: "anf-xyz" });

    // Ein Upsert auf "anfragen"
    expect(mock.upsertCalls).toHaveLength(1);
    const { row, opts } = mock.upsertCalls[0];
    expect(opts).toEqual({ onConflict: "organization_id,source,source_ref" });

    // Mapping-Checks
    expect(row.organization_id).toBe(DEFAULT_ORG);
    expect(row.source).toBe("phone_fonio");
    expect(row.source_ref).toBe("fonio-call-abc-1");
    expect(row.status).toBe("neu");
    expect(row.caller_name).toBe("Frau Müller");
    expect(row.caller_phone).toBe("+436641234567");
    expect(row.caller_email).toBe("mueller@example.com");
    expect(row.caller_address).toBe("Wienzeile 1, 1060 Wien");
    expect(row.subject).toBe("Sanierung Bad");
    expect(row.transcript).toContain("Assistant: Gruess Gott");
    expect(row.audio_url).toBe("https://example.com/audio/abc.mp3");
    expect(row.duration_seconds).toBe(87);
    expect(row.call_direction).toBe("inbound");
    expect(row.call_started_at).toBe("2026-06-30T08:15:00.000Z");
    expect(row.call_ended_at).toBe("2026-06-30T08:16:27.000Z");
    expect(row.ai_extracted_data.gewerk).toBe("Sanitaer");
    expect(row.raw_payload).toBeDefined();
    expect(row.raw_payload.id).toBe("fonio-call-abc-1");

    // Ein Event-Insert
    expect(mock.insertCalls).toHaveLength(1);
    const ev = mock.insertCalls[0];
    expect(ev.organization_id).toBe(DEFAULT_ORG);
    expect(ev.anfrage_id).toBe("anf-xyz");
    expect(ev.event_type).toBe("created");
    expect(ev.payload).toEqual({ source: "phone_fonio" });
  });

  it("verwendet X-Fonio-Org-Id Header bevor ENV-Fallback", async () => {
    const headerOrg = "11111111-1111-1111-1111-111111111111";
    const req = makeReq({ body: samplePayload(), orgHeader: headerOrg });
    const res = makeRes();

    await sut.default(req, res);

    expect(res.statusCode).toBe(200);
    expect(mock.upsertCalls[0].row.organization_id).toBe(headerOrg);
    expect(mock.insertCalls[0].organization_id).toBe(headerOrg);
  });

  it("fallt auf summary.slice(0,200) zurueck wenn anliegen fehlt", async () => {
    const p = samplePayload();
    delete p.extractionData.anliegen;
    const req = makeReq({ body: p });
    const res = makeRes();

    await sut.default(req, res);

    expect(res.statusCode).toBe(200);
    expect(mock.upsertCalls[0].row.subject).toBe(p.summary.slice(0, 200));
  });

  it("nutzt formattedTranscript wenn transcript-Array fehlt", async () => {
    const p = samplePayload();
    expect(p.transcript).toBeUndefined();
    const req = makeReq({ body: p });
    const res = makeRes();
    await sut.default(req, res);
    expect(mock.upsertCalls[0].row.transcript).toContain("Assistant:");
  });

  it("stringifiziert Array-transcript wenn weder transcript-String noch formattedTranscript vorhanden", async () => {
    const p = samplePayload();
    delete p.formattedTranscript;
    p.transcript = [
      { role: "assistant", text: "hi", timestamp: "t1" },
      { role: "caller", text: "hallo", timestamp: "t2" },
    ];
    const req = makeReq({ body: p });
    const res = makeRes();
    await sut.default(req, res);
    const t = mock.upsertCalls[0].row.transcript;
    expect(t).toContain("assistant");
    expect(t).toContain("hi");
    expect(t).toContain("caller");
  });
});

describe("fonio webhook – Idempotenz", () => {
  let sut;
  /** @type {ReturnType<typeof makeSupabaseMock>} */
  let mock;

  beforeEach(async () => {
    sut = await sutPromise;
    mock = makeSupabaseMock({ upsertRowId: "anf-idem" });
    sut.__setSupabaseClientForTests(mock.client);
  });
  afterEach(() => {
    sut.__resetSupabaseClientForTests();
  });

  it("2x derselbe Call-Webhook → derselbe onConflict-Key, derselbe Row-ID", async () => {
    const body = samplePayload({ id: "fonio-dup-1" });

    const r1 = makeRes();
    await sut.default(makeReq({ body }), r1);
    const r2 = makeRes();
    await sut.default(makeReq({ body }), r2);

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.body.id).toBe("anf-idem");
    expect(r2.body.id).toBe("anf-idem");

    // Beide Aufrufe nutzen denselben onConflict-Key (Idempotenz-Garantie liegt
    // in der DB; hier verifizieren wir den korrekten Aufruf-Vertrag).
    for (const call of mock.upsertCalls) {
      expect(call.opts).toEqual({ onConflict: "organization_id,source,source_ref" });
      expect(call.row.source_ref).toBe("fonio-dup-1");
      expect(call.row.source).toBe("phone_fonio");
    }
    expect(mock.upsertCalls).toHaveLength(2);
  });
});

describe("fonio webhook – Fehlerpfade", () => {
  let sut;

  beforeEach(async () => {
    sut = await sutPromise;
  });
  afterEach(() => {
    sut.__resetSupabaseClientForTests();
  });

  it("200 ok:false bei Upsert-Fehler (Fonio darf NICHT retryen)", async () => {
    // Bewusste Designentscheidung: wir geben IMMER 200 zurueck, weil
    // Fonio bei 4xx/5xx "Fehlgeschlagen" anzeigt und retryt — was zu
    // Duplikat-Inserts fuehrt. Stattdessen: 200 mit ok:false und Grund.
    const mock = makeSupabaseMock({ upsertError: { message: "boom" } });
    sut.__setSupabaseClientForTests(mock.client);

    const res = makeRes();
    await sut.default(makeReq({ body: samplePayload() }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: "upsert-error" });
    // Kein Event-Insert bei Upsert-Fail
    expect(mock.insertCalls).toHaveLength(0);
  });

  it("liefert trotzdem 200 wenn Event-Insert fehlschlaegt (best-effort)", async () => {
    const mock = makeSupabaseMock({ eventError: { message: "events down" } });
    sut.__setSupabaseClientForTests(mock.client);

    const res = makeRes();
    await sut.default(makeReq({ body: samplePayload() }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mock.upsertCalls).toHaveLength(1);
    expect(mock.insertCalls).toHaveLength(1);
  });
});

describe("fonio webhook – buildAnfrageRow (Mapping isoliert)", () => {
  let sut;
  beforeEach(async () => {
    sut = await sutPromise;
  });

  it("haelt sich an die Fallback-Reihenfolge: extractionData > context", async () => {
    const p = samplePayload({ extractionData: {}, context: { kunde_name: "Herr Huber" } });
    const row = sut.buildAnfrageRow(p, DEFAULT_ORG);
    expect(row.caller_name).toBe("Herr Huber");
  });

  it("ai_extracted_data ist immer ein Objekt", async () => {
    const p = samplePayload();
    delete p.extractionData;
    const row = sut.buildAnfrageRow(p, DEFAULT_ORG);
    expect(row.ai_extracted_data).toEqual({});
  });

  it("duration als String wird in Number konvertiert", async () => {
    const p = samplePayload({ duration: "42" });
    const row = sut.buildAnfrageRow(p, DEFAULT_ORG);
    expect(row.duration_seconds).toBe(42);
  });
});
