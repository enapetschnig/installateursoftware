// ============================================================
// Tests fuer api/anfragen/convert.js
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./convert.js";

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

const VALID_ID = "11111111-1111-1111-8111-111111111111";

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("anfragen/convert", () => {
  it("405 bei nicht-POST", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "GET" }), res);
    expect(res._state.status).toBe(405);
  });

  it("401 ohne gueltigen Bearer", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeResponse(401, { msg: "no" }));
    const res = makeRes();
    await handler(makeReq({ body: { anfrage_id: VALID_ID } }), res);
    expect(res._state.status).toBe(401);
  });

  it("400 ohne anfrage_id", async () => {
    // verifyUser ok
    globalThis.fetch.mockResolvedValueOnce(makeResponse(200, { id: "u-1" }));
    const res = makeRes();
    await handler(makeReq({ body: {} }), res);
    expect(res._state.status).toBe(400);
  });

  it("400 wenn Privatkunde ohne Name", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeResponse(200, { id: "u-1" }));
    const res = makeRes();
    await handler(
      makeReq({ body: { anfrage_id: VALID_ID, customer_type: "privat" } }),
      res,
    );
    expect(res._state.status).toBe(400);
  });

  it("404 wenn Anfrage nicht gefunden", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" })) // verifyUser
      .mockResolvedValueOnce(makeResponse(200, [])); // empty anfrage

    const res = makeRes();
    await handler(
      makeReq({
        body: { anfrage_id: VALID_ID, customer_type: "privat", first_name: "Max" },
      }),
      res,
    );
    expect(res._state.status).toBe(404);
  });

  it("409 wenn Anfrage bereits konvertiert", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" }))
      .mockResolvedValueOnce(
        makeResponse(200, [
          {
            id: VALID_ID,
            organization_id: "org-1",
            status: "kontakt_erstellt",
            related_contact_id: "c-existing",
          },
        ]),
      );

    const res = makeRes();
    await handler(
      makeReq({
        body: { anfrage_id: VALID_ID, customer_type: "privat", first_name: "Max" },
      }),
      res,
    );
    expect(res._state.status).toBe(409);
    expect(res._state.body.contact_id).toBe("c-existing");
  });

  it("erfolgreicher Convert: Insert + Update + Events", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" })) // verifyUser
      .mockResolvedValueOnce(
        makeResponse(200, [
          { id: VALID_ID, organization_id: "org-1", status: "neu", related_contact_id: null },
        ]),
      ) // anfrage select
      .mockResolvedValueOnce(makeResponse(200, "K-0001")) // rpc next_document_number
      .mockResolvedValueOnce(
        makeResponse(201, [{ id: "c-new", contact_number: "K-0001" }]),
      ) // contacts insert
      .mockResolvedValueOnce(makeResponse(204, "")) // anfragen patch
      .mockResolvedValueOnce(makeResponse(201, "")) // event contact_linked
      .mockResolvedValueOnce(makeResponse(201, "")); // event converted

    const res = makeRes();
    await handler(
      makeReq({
        body: {
          anfrage_id: VALID_ID,
          customer_type: "privat",
          first_name: "Max",
          last_name: "Mustermann",
          phone: "+436641234567",
        },
      }),
      res,
    );
    expect(res._state.status).toBe(200);
    expect(res._state.body.ok).toBe(true);
    expect(res._state.body.contact_id).toBe("c-new");
    expect(res._state.body.contact_number).toBe("K-0001");
  });

  it("legt Kontakt auch ohne aktiven Nummernkreis an", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(200, { id: "u-1" }))
      .mockResolvedValueOnce(
        makeResponse(200, [
          { id: VALID_ID, organization_id: "org-1", status: "neu", related_contact_id: null },
        ]),
      )
      .mockResolvedValueOnce(makeResponse(500, "no number range")) // rpc failed
      .mockResolvedValueOnce(
        makeResponse(201, [{ id: "c-2", contact_number: null }]),
      )
      .mockResolvedValueOnce(makeResponse(204, ""))
      .mockResolvedValueOnce(makeResponse(201, ""))
      .mockResolvedValueOnce(makeResponse(201, ""));

    const res = makeRes();
    await handler(
      makeReq({
        body: {
          anfrage_id: VALID_ID,
          customer_type: "firma",
          company: "ACME GmbH",
        },
      }),
      res,
    );
    expect(res._state.status).toBe(200);
    expect(res._state.body.contact_id).toBe("c-2");
  });
});
