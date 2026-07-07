// ────────────────────────────────────────────────────────────────────────────
//  mailClient – Tests (Vitest)
//
//  Wir testen den duennen Fetch-Wrapper gegen die Backend-Endpunkte
//  (api/microsoft/mail-*). Der supabase-Client wird via vi.mock stubbed,
//  sodass authHeaders() ohne echte Session einen Bearer liefert.
//
//  Geprueft wird:
//   1. listMail baut die URL korrekt (folder mapping, top/skip/search).
//   2. listMail wirft "Nicht angemeldet" bei 401.
//   3. getMail encoded die id und deserialisiert das JSON.
//   4. sendMail POSTet Payload als JSON-String mit Content-Type.
//   5. sendMail Client-seitige Validierung (subject/html/to).
//   6. attachmentDownloadUrl liefert erwartete Query.
//   7. fetchAttachment gibt Blob zurueck und wirft bei !ok mit JSON-error.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// supabase-Client muss VOR dem Import des Moduls unter Test gestubbed sein.
vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      // Default: gueltige Session. Einzelne Tests koennen das ueberschreiben.
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "test-token" } },
      })),
    },
  },
}));

import { supabase } from "../supabase";
import {
  listMail,
  getMail,
  sendMail,
  attachmentDownloadUrl,
  fetchAttachment,
  type MailListResult,
  type MailDetail,
} from "./mailClient";

// ── Helpers ──────────────────────────────────────────────────────────────

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
  } as unknown as Response;
}

function blobResponse(
  blob: Blob,
  init: { status?: number } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => blob,
    json: async () => ({}),
  } as unknown as Response;
}

/**
 * Installiert eine fetch-Stub-Sequenz auf globalThis. Gibt einen `calls`
 * Array + Restore-Handle zurueck. Wir stubben `global.fetch`, weil der
 * Client die globale fetch-Referenz nutzt (kein Dependency-Injection).
 */
function stubFetch(responses: Response[]): {
  calls: CapturedCall[];
  restore: () => void;
} {
  const calls: CapturedCall[] = [];
  let i = 0;
  const orig = globalThis.fetch;
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const r = responses[i++];
    if (!r) throw new Error(`Test-Mock: keine Response fuer Call ${i}`);
    return r;
  });
  globalThis.fetch = impl as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

beforeEach(() => {
  // Default-Session pro Test wieder herstellen (Test 2 aendert sie).
  (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: { session: { access_token: "test-token" } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. listMail ──────────────────────────────────────────────────────────

describe("listMail", () => {
  it("builds URL with folder/top/skip/search and returns parsed result", async () => {
    const payload: MailListResult = {
      messages: [
        {
          id: "AAA",
          subject: "Hi",
          from: { emailAddress: { name: "Max", address: "max@example.com" } },
          receivedDateTime: "2026-01-01T00:00:00Z",
          isRead: false,
          hasAttachments: false,
          bodyPreview: "Preview",
          importance: "normal",
        },
      ],
      nextLink: null,
      total: 1,
    };
    const { calls, restore } = stubFetch([jsonResponse(payload)]);
    try {
      const result = await listMail({
        folder: "sent",
        top: 10,
        skip: 20,
        search: "invoice",
      });

      expect(result).toEqual(payload);
      expect(calls).toHaveLength(1);
      // Backend erwartet Graph-Wellknown "sentitems".
      expect(calls[0].url).toContain("/api/microsoft/mail-list?");
      expect(calls[0].url).toContain("folder=sentitems");
      expect(calls[0].url).toContain("top=10");
      expect(calls[0].url).toContain("skip=20");
      expect(calls[0].url).toContain("search=invoice");
      expect(calls[0].init.method).toBe("GET");
      // Bearer wurde gesetzt.
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
    } finally {
      restore();
    }
  });

  it("throws 'Nicht angemeldet' when session is missing", async () => {
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { session: null },
    });
    // Kein fetch-Stub noetig – der Auth-Check muss vorher fehlschlagen.
    await expect(listMail({})).rejects.toThrow(/Nicht angemeldet/);
  });

  it("throws 'Nicht angemeldet' on 401 response from backend", async () => {
    const { restore } = stubFetch([
      jsonResponse({ error: "Nicht angemeldet." }, { ok: false, status: 401 }),
    ]);
    try {
      await expect(listMail({})).rejects.toThrow(/Nicht angemeldet/);
    } finally {
      restore();
    }
  });

  it("propagates backend error message on non-401 failures", async () => {
    const { restore } = stubFetch([
      jsonResponse(
        { error: "Microsoft Graph nicht erreichbar." },
        { ok: false, status: 502 },
      ),
    ]);
    try {
      await expect(listMail({})).rejects.toThrow(
        /Microsoft Graph nicht erreichbar/,
      );
    } finally {
      restore();
    }
  });

  it("omits query string when no opts are provided", async () => {
    const { calls, restore } = stubFetch([
      jsonResponse({ messages: [], nextLink: null, total: 0 }),
    ]);
    try {
      await listMail();
      expect(calls[0].url).toBe("/api/microsoft/mail-list");
    } finally {
      restore();
    }
  });
});

// ── 2. getMail ───────────────────────────────────────────────────────────

describe("getMail", () => {
  it("encodes the id and returns detail payload", async () => {
    const detail: MailDetail = {
      id: "abc/xyz==",
      subject: "Hallo",
      from: null,
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      receivedDateTime: null,
      sentDateTime: null,
      isRead: true,
      hasAttachments: false,
      importance: "normal",
      conversationId: null,
      body: { contentType: "text", content: "" },
      attachments: [],
    };
    const { calls, restore } = stubFetch([jsonResponse(detail)]);
    try {
      const r = await getMail("abc/xyz==");
      expect(r).toEqual(detail);
      // "/" und "=" muessen im Query-Param encoded sein.
      expect(calls[0].url).toBe(
        "/api/microsoft/mail-detail?id=abc%2Fxyz%3D%3D",
      );
    } finally {
      restore();
    }
  });

  it("throws when id is missing", async () => {
    await expect(getMail("")).rejects.toThrow(/id/);
  });
});

// ── 3. sendMail ──────────────────────────────────────────────────────────

describe("sendMail", () => {
  const validPayload = {
    to: [{ address: "kunde@example.com", name: "Kunde" }],
    subject: "Angebot",
    html: "<p>Hallo</p>",
  };

  it("POSTs JSON payload with Content-Type", async () => {
    const { calls, restore } = stubFetch([
      jsonResponse({ ok: true, sentAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    try {
      const r = await sendMail(validPayload);
      expect(r).toEqual({ ok: true, sentAt: "2026-01-01T00:00:00.000Z" });
      expect(calls[0].url).toBe("/api/microsoft/mail-send");
      expect(calls[0].init.method).toBe("POST");
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers.Authorization).toBe("Bearer test-token");
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.subject).toBe("Angebot");
      expect(body.html).toBe("<p>Hallo</p>");
      expect(body.to).toEqual([
        { address: "kunde@example.com", name: "Kunde" },
      ]);
    } finally {
      restore();
    }
  });

  it("rejects payload with empty subject", async () => {
    await expect(
      sendMail({ ...validPayload, subject: "   " }),
    ).rejects.toThrow(/subject/);
  });

  it("rejects payload with empty html", async () => {
    await expect(
      sendMail({ ...validPayload, html: "" }),
    ).rejects.toThrow(/html/);
  });

  it("rejects payload without at least one 'to' recipient", async () => {
    await expect(
      sendMail({ ...validPayload, to: [] }),
    ).rejects.toThrow(/to/);
  });

  it("surfaces backend error message on failure", async () => {
    const { restore } = stubFetch([
      jsonResponse(
        { error: "Sende-Limit erreicht. Bitte spaeter erneut versuchen." },
        { ok: false, status: 429 },
      ),
    ]);
    try {
      await expect(sendMail(validPayload)).rejects.toThrow(/Sende-Limit/);
    } finally {
      restore();
    }
  });
});

// ── 4. attachmentDownloadUrl ─────────────────────────────────────────────

describe("attachmentDownloadUrl", () => {
  it("builds URL with messageId, attachmentId and default mode=download", () => {
    const url = attachmentDownloadUrl("MID", "AID");
    expect(url).toContain("/api/microsoft/mail-attachment?");
    expect(url).toContain("messageId=MID");
    expect(url).toContain("attachmentId=AID");
    expect(url).toContain("mode=download");
  });

  it("supports mode=inline", () => {
    const url = attachmentDownloadUrl("MID", "AID", "inline");
    expect(url).toContain("mode=inline");
  });
});

// ── 5. fetchAttachment ───────────────────────────────────────────────────

describe("fetchAttachment", () => {
  it("returns a Blob on success and sends Bearer", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const { calls, restore } = stubFetch([blobResponse(blob)]);
    try {
      const result = await fetchAttachment("MID", "AID", "download");
      expect(result).toBe(blob);
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
      expect(calls[0].url).toContain("mode=download");
    } finally {
      restore();
    }
  });

  it("throws 'Nicht angemeldet' on 401", async () => {
    const { restore } = stubFetch([
      jsonResponse({ error: "Nicht angemeldet." }, { ok: false, status: 401 }),
    ]);
    try {
      await expect(fetchAttachment("MID", "AID")).rejects.toThrow(
        /Nicht angemeldet/,
      );
    } finally {
      restore();
    }
  });

  it("throws backend error on 404", async () => {
    const { restore } = stubFetch([
      jsonResponse(
        { error: "Anhang nicht gefunden." },
        { ok: false, status: 404 },
      ),
    ]);
    try {
      await expect(fetchAttachment("MID", "AID")).rejects.toThrow(
        /Anhang nicht gefunden/,
      );
    } finally {
      restore();
    }
  });

  it("throws when messageId or attachmentId missing", async () => {
    await expect(fetchAttachment("", "AID")).rejects.toThrow(/messageId/);
    await expect(fetchAttachment("MID", "")).rejects.toThrow(/attachmentId/);
  });
});
