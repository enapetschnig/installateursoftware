// ============================================================
// B4Y SuperAPP – Anfrage → Kontakt konvertieren
// ------------------------------------------------------------
// POST /api/anfragen/convert
// Body:
//   {
//     anfrage_id: "<uuid>",
//     customer_type?: "privat" | "firma",        // default "privat"
//     type?: "kunde" | "lieferant" | "subunternehmer",  // default "kunde"
//     salutation?: "herr" | "frau" | null,
//     first_name?, last_name?, company?, email?, phone?, mobile?,
//     street?, zip?, city?, country?, notes?
//   }
//
// Auth: User-Bearer (RLS greift).
//
// Fluss:
//   1. verifyUser + valid Bearer
//   2. Lade Anfrage via User-Token (RLS, 404 wenn fremde Org)
//   3. Wenn schon konvertiert: 409
//   4. Hole next contact_number aus RPC next_document_number(p_doc_type:"kunde")
//   5. Insert contacts via User-Token
//   6. Update anfragen.related_contact_id + status="kontakt_erstellt" via User-Token
//      (Trigger setzt converted_to_contact_at auto)
//   7. Audit-Event "contact_linked" + "converted"
//   8. Return {ok, contact_id, contact_number}
// ============================================================

import { bearerFromRequest, verifyUser } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

export const config = { maxDuration: 15 };

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://xyhgckqxowqnzjtoblfs.supabase.co";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_akH66S1-i4WaHAbVrCd50A_qd7OrwfD";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_TYPE = new Set(["kunde", "lieferant", "subunternehmer"]);
const ALLOWED_CUSTOMER_TYPE = new Set(["privat", "firma"]);
const ALLOWED_SALUTATION = new Set(["herr", "frau"]);

function parseBody(req) {
  if (req && req.body && typeof req.body === "object") return req.body;
  if (typeof req?.body === "string" && req.body.length > 0) {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

function cleanStr(v, maxLen = 200) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, maxLen);
}

async function sbFetch(path, token, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function sbRpc(name, payload, token) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Nur POST erlaubt." });
    return;
  }

  const token = bearerFromRequest(req);
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }

  const body = parseBody(req);
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Ungueltiger Request-Body." });
    return;
  }

  const anfrageId = typeof body.anfrage_id === "string" ? body.anfrage_id : "";
  if (!UUID_REGEX.test(anfrageId)) {
    res.status(400).json({ error: "'anfrage_id' (UUID) ist erforderlich." });
    return;
  }

  const type = ALLOWED_TYPE.has(body.type) ? body.type : "kunde";
  const customerType = ALLOWED_CUSTOMER_TYPE.has(body.customer_type)
    ? body.customer_type
    : "privat";

  const first_name = cleanStr(body.first_name);
  const last_name = cleanStr(body.last_name);
  const company = cleanStr(body.company);
  const email = cleanStr(body.email);
  const phone = cleanStr(body.phone, 60);
  const mobile = cleanStr(body.mobile, 60);
  const street = cleanStr(body.street);
  const zip = cleanStr(body.zip, 20);
  const city = cleanStr(body.city);
  const country = cleanStr(body.country, 80);
  const notes = cleanStr(body.notes, 2000);
  const salutation = ALLOWED_SALUTATION.has(body.salutation) ? body.salutation : null;

  // Mindestens irgendein Namens-Hinweis muss vorhanden sein.
  if (customerType === "privat" && !first_name && !last_name) {
    res.status(400).json({ error: "Bei Privatkunde mindestens Vor- oder Nachname noetig." });
    return;
  }
  if (customerType === "firma" && !company) {
    res.status(400).json({ error: "Bei Firma ist 'company' Pflicht." });
    return;
  }

  // 1) Anfrage laden – RLS isoliert Mandanten automatisch (User-Token).
  const anfRes = await sbFetch(
    `anfragen?select=id,organization_id,status,related_contact_id&id=eq.${anfrageId}&limit=1`,
    token,
  );
  if (!anfRes.ok) {
    const t = (await anfRes.text().catch(() => "")).slice(0, 300);
    logSafe({
      userId: user.id,
      action: "anfragen.convert",
      status: "error",
      error: `anfrage_http_${anfRes.status}: ${t}`,
    });
    res.status(502).json({ error: "Anfrage konnte nicht geladen werden." });
    return;
  }
  const anfRows = await anfRes.json().catch(() => []);
  if (!Array.isArray(anfRows) || anfRows.length === 0) {
    res.status(404).json({ error: "Anfrage nicht gefunden." });
    return;
  }
  const anfrage = anfRows[0];
  if (anfrage.related_contact_id) {
    res.status(409).json({
      error: "Diese Anfrage ist bereits einem Kontakt zugeordnet.",
      contact_id: anfrage.related_contact_id,
    });
    return;
  }

  // 2) contact_number aus Nummernkreis holen.
  const numRpc = await sbRpc("next_document_number", { p_doc_type: "kunde" }, token);
  let contactNumber = null;
  if (numRpc.ok) {
    try {
      const parsed = await numRpc.json();
      if (typeof parsed === "string") contactNumber = parsed;
      else if (parsed && typeof parsed.next_document_number === "string") {
        contactNumber = parsed.next_document_number;
      }
    } catch {
      contactNumber = null;
    }
  }
  // contactNumber ist optional — manche Setups haben keinen aktiven Nummernkreis,
  // dann legen wir ohne Nummer an (Kontakt-Editor kann sie spaeter setzen).

  // 3) Insert Kontakt via User-Token (RLS setzt organization_id via default).
  const contactPayload = {
    type,
    customer_type: customerType,
    status: "aktiv",
    salutation,
    first_name,
    last_name,
    company,
    email,
    phone,
    mobile,
    street,
    zip,
    city,
    country: country ?? "Österreich",
    notes,
    contact_number: contactNumber,
  };

  const cRes = await sbFetch("contacts", token, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(contactPayload),
  });

  if (!cRes.ok) {
    const t = (await cRes.text().catch(() => "")).slice(0, 400);
    logSafe({
      userId: user.id,
      action: "anfragen.convert",
      status: "error",
      error: `contact_http_${cRes.status}: ${t}`,
    });
    res
      .status(502)
      .json({ error: "Kontakt konnte nicht angelegt werden.", detail: t.slice(0, 200) });
    return;
  }
  const cRows = await cRes.json().catch(() => []);
  const contact = Array.isArray(cRows) ? cRows[0] : cRows;
  if (!contact || !contact.id) {
    logSafe({
      userId: user.id,
      action: "anfragen.convert",
      status: "error",
      error: "contact insert returned no row",
    });
    res.status(502).json({ error: "Kontakt-Antwort leer." });
    return;
  }

  // 4) Update anfragen: related_contact_id + status="kontakt_erstellt".
  const updRes = await sbFetch(`anfragen?id=eq.${anfrageId}`, token, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      related_contact_id: contact.id,
      status: "kontakt_erstellt",
      converted_to_contact_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!updRes.ok) {
    const t = (await updRes.text().catch(() => "")).slice(0, 300);
    logSafe({
      userId: user.id,
      action: "anfragen.convert",
      status: "error",
      error: `anfrage_update_http_${updRes.status}: ${t}`,
    });
    // Kontakt wurde aber bereits angelegt — wir geben 207-aehnliche Antwort.
    res.status(207).json({
      ok: false,
      contact_id: contact.id,
      contact_number: contact.contact_number ?? null,
      warning: "Kontakt angelegt, aber Anfrage konnte nicht aktualisiert werden.",
    });
    return;
  }

  // 5) Audit-Events (best-effort).
  for (const ev of [
    {
      anfrage_id: anfrageId,
      event_type: "contact_linked",
      to_value: contact.id,
    },
    {
      anfrage_id: anfrageId,
      event_type: "converted",
      payload: {
        contact_id: contact.id,
        contact_number: contact.contact_number ?? null,
        type,
        customer_type: customerType,
      },
    },
  ]) {
    try {
      await sbFetch("anfrage_events", token, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(ev),
      });
    } catch {
      /* ignore */
    }
  }

  logSafe({
    userId: user.id,
    action: "anfragen.convert",
    status: "ok",
    durationMs: Date.now() - started,
    extra: { anfrage_id: anfrageId, contact_id: contact.id, type, customer_type: customerType },
  });

  res.status(200).json({
    ok: true,
    contact_id: contact.id,
    contact_number: contact.contact_number ?? null,
  });
}
