// ============================================================
// B4Y SuperAPP – Anfragen-Detail (Vercel Serverless Function)
// ------------------------------------------------------------
// GET /api/anfragen/detail?id=<uuid>
//
// Liefert eine einzelne Anfrage inkl. ihrer Event-Log-Eintraege.
// Auth: Supabase-JWT (User-Bearer) – RLS erzwingt Multi-Tenant-Isolation
// (org_isolation RESTRICTIVE, siehe Migrationen 0063+).
//
// Returns: { anfrage: {...}, events: [...] }
// Status-Codes:
//   400 – fehlender oder ungueltiger `id`-Parameter
//   401 – nicht angemeldet
//   404 – Anfrage existiert nicht / kein Zugriff (RLS-Filter blockiert)
//   502 – Supabase-Backend-Fehler
// ------------------------------------------------------------
// Hinweis zu Joins: wir laden zwei separate REST-Requests statt eines
// embedded selects, weil PostgREST mit dem User-Bearer fuer `anfrage_events`
// eine eigene RLS-Pruefung macht und die Fehlerdiagnose so deutlich
// einfacher ist.
// ============================================================

import { bearerFromRequest, verifyUser } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_SI2t5XGM8ftCbPiav3-HPA_XC26KXtg";

// RFC4122-Kompatibel (inkl. Versionen 1-5). Wir sind hier streng, weil ein
// nicht-validierter String unbeabsichtigt PostgREST-Operatoren triggern
// koennte (z. B. ein Komma oder ein `.`).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === "string" && UUID_REGEX.test(s);
}

async function sbGet(path, token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  return r;
}

export default async function handler(req, res) {
  const started = Date.now();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Nur GET erlaubt." });
    return;
  }

  const token = bearerFromRequest(req);
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }

  const id = req.query && typeof req.query.id === "string" ? req.query.id : "";
  if (!isUuid(id)) {
    res.status(400).json({ error: "Parameter 'id' (UUID) ist erforderlich." });
    return;
  }

  try {
    // ── Anfrage laden ──────────────────────────────────────
    const anfrageSelect =
      "id,source,source_ref,status,ai_classification,ai_priority,ai_summary,ai_extracted_data," +
      "subject,description,transcript,audio_url," +
      "caller_name,caller_phone,caller_email,caller_address," +
      "duration_seconds,call_direction,call_started_at,call_ended_at," +
      "assigned_to,related_contact_id,related_project_id,converted_to_contact_at," +
      "organization_id,created_at,updated_at";
    const anfrageRes = await sbGet(
      `anfragen?select=${anfrageSelect}&id=eq.${encodeURIComponent(id)}&limit=1`,
      token,
    );
    if (!anfrageRes.ok) {
      const txt = (await anfrageRes.text().catch(() => "")).slice(0, 400);
      logSafe({
        userId: user.id,
        action: "anfragen.detail",
        status: "error",
        durationMs: Date.now() - started,
        error: `supabase_http_${anfrageRes.status}: ${txt}`,
        extra: { http: anfrageRes.status, stage: "anfrage" },
      });
      res.status(502).json({ error: "Anfrage konnte nicht geladen werden." });
      return;
    }
    const anfrageRows = await anfrageRes.json().catch(() => []);
    if (!Array.isArray(anfrageRows) || anfrageRows.length === 0) {
      // Entweder existiert die Anfrage nicht, oder RLS hat sie ausgeblendet –
      // beides liefern wir als 404, um keine Information ueber Existenz preiszugeben.
      logSafe({
        userId: user.id,
        action: "anfragen.detail",
        status: "ok",
        durationMs: Date.now() - started,
        extra: { found: false },
      });
      res.status(404).json({ error: "Anfrage nicht gefunden." });
      return;
    }
    const anfrage = anfrageRows[0];

    // ── Events laden (chronologisch aufsteigend) ───────────
    const eventsSelect =
      "id,anfrage_id,event_type,payload,actor_user_id,created_at";
    const eventsRes = await sbGet(
      `anfrage_events?select=${eventsSelect}&anfrage_id=eq.${encodeURIComponent(
        id,
      )}&order=created_at.asc`,
      token,
    );
    let events = [];
    if (eventsRes.ok) {
      const j = await eventsRes.json().catch(() => []);
      if (Array.isArray(j)) events = j;
    } else {
      // Anfrage selbst wurde gefunden – Event-Fehler ist nicht fatal,
      // wir loggen ihn aber, weil eine fehlende Audit-Spur auffallen muss.
      const txt = (await eventsRes.text().catch(() => "")).slice(0, 400);
      logSafe({
        userId: user.id,
        action: "anfragen.detail",
        status: "error",
        durationMs: Date.now() - started,
        error: `events_http_${eventsRes.status}: ${txt}`,
        extra: { http: eventsRes.status, stage: "events" },
      });
    }

    logSafe({
      userId: user.id,
      action: "anfragen.detail",
      status: "ok",
      durationMs: Date.now() - started,
      extra: { found: true, events: events.length, source: anfrage.source || "" },
    });

    res.status(200).json({ anfrage, events });
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "anfragen.detail",
      status: "error",
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "Anfrage konnte nicht geladen werden." });
  }
}
