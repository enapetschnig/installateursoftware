// ============================================================
// B4Y SuperAPP – Anfrage manuell anlegen (Vercel Serverless Function)
// ------------------------------------------------------------
// POST /api/anfragen/create
// Body (JSON):
//   {
//     caller_name?:    string,
//     caller_phone?:   string,
//     caller_email?:   string,
//     caller_address?: string,
//     subject:         string,   // PFLICHT, max 200
//     description?:    string    // max 4000
//   }
//
// Verhalten:
//   • Auth via verifyUser (Supabase-JWT)
//   • Rate-Limit: max 30/min/User (in-memory, pro Serverless-Instanz)
//   • Insert in `anfragen` mit source="manual", source_ref=null, status="neu"
//   • Insert in `anfrage_events` mit event_type="created",
//     payload={source:"manual", actor:"user"}
//   • Beide Inserts mit User-Bearer → RLS / current_org_id() greift,
//     d.h. organization_id wird per Default-Trigger gesetzt (Phase 0/1).
//
// Returns: { ok: true, id, created_at }
// Status-Codes:
//   400 – Validierungsfehler (kein subject, falscher Content-Type, …)
//   401 – nicht angemeldet
//   429 – Rate-Limit ueberschritten
//   502 – Supabase-Fehler
// ------------------------------------------------------------
// Sicherheit:
//   • Keine Service-Role auf Insert-Pfad – RLS soll fuer manuelle Anlagen
//     identisch zur UI greifen (keine Privilegien-Eskalation).
//   • Strict Input-Length-Limits gegen DB-Bloat / Log-Bloat.
//   • Event-Insert ist "best-effort" und wird NIE den Erfolg der Anfrage
//     umkehren – die Anfrage selbst ist die Source-of-Truth. Wenn das
//     Audit-Log fehlschlaegt, wird das geloggt (und der Endpoint
//     liefert trotzdem 200, weil der User die Anfrage sehen will).
// ============================================================

import { bearerFromRequest, verifyUser, checkRateLimit } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_SI2t5XGM8ftCbPiav3-HPA_XC26KXtg";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const LIMITS = {
  caller_name: 200,
  caller_phone: 60,
  caller_email: 320, // RFC 5321: max 254, aber wir lassen Luft fuer Display-Form
  caller_address: 400,
  subject: 200,
  description: 4000,
};

function cleanStr(v, max) {
  if (typeof v !== "string") return "";
  // Null-Bytes werden von Postgres-Text-Spalten abgelehnt → entfernen.
  // split/join statt einer no-control-regex, weil ESLint sonst warnt.
  // Trim + Laengen-Cap; Zeilenumbrueche in description bleiben erhalten.
  const s = v.split("\u0000").join("").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function parseBody(req) {
  if (req.body == null) return null;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  if (typeof req.body === "object") return req.body;
  return null;
}

async function sbInsert(path, token, row, { preferReturn = "representation" } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: `return=${preferReturn}`,
    },
    body: JSON.stringify(row),
  });
  return r;
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

  if (!checkRateLimit(user.id, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    logSafe({
      userId: user.id,
      action: "anfragen.create",
      status: "error",
      durationMs: Date.now() - started,
      error: "rate_limited",
    });
    res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
    return;
  }

  const body = parseBody(req);
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "JSON-Body erforderlich." });
    return;
  }

  // ── Validierung & Normalisierung ──────────────────────────
  const subject = cleanStr(body.subject, LIMITS.subject);
  if (!subject) {
    res.status(400).json({ error: "Feld 'subject' ist erforderlich." });
    return;
  }

  const description = cleanStr(body.description, LIMITS.description);
  const caller_name = cleanStr(body.caller_name, LIMITS.caller_name);
  const caller_phone = cleanStr(body.caller_phone, LIMITS.caller_phone);
  const caller_email = cleanStr(body.caller_email, LIMITS.caller_email);
  const caller_address = cleanStr(body.caller_address, LIMITS.caller_address);

  // ── Anfrage anlegen (RLS greift via User-Bearer) ──────────
  const row = {
    source: "manual",
    source_ref: null,
    status: "neu",
    subject,
    description: description || null,
    caller_name: caller_name || null,
    caller_phone: caller_phone || null,
    caller_email: caller_email || null,
    caller_address: caller_address || null,
  };

  try {
    const r = await sbInsert("anfragen", token, row);
    if (!r.ok) {
      const txt = (await r.text().catch(() => "")).slice(0, 400);
      logSafe({
        userId: user.id,
        action: "anfragen.create",
        status: "error",
        durationMs: Date.now() - started,
        error: `supabase_http_${r.status}: ${txt}`,
        extra: { http: r.status, stage: "anfrage" },
      });
      res.status(502).json({ error: "Anfrage konnte nicht angelegt werden." });
      return;
    }

    const inserted = await r.json().catch(() => null);
    const created = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!created || !created.id) {
      logSafe({
        userId: user.id,
        action: "anfragen.create",
        status: "error",
        durationMs: Date.now() - started,
        error: "no_id_returned",
      });
      res.status(502).json({ error: "Anfrage konnte nicht angelegt werden." });
      return;
    }

    // ── Event-Log (best-effort, blockiert Erfolg NICHT) ─────
    try {
      const evRes = await sbInsert(
        "anfrage_events",
        token,
        {
          anfrage_id: created.id,
          event_type: "created",
          payload: { source: "manual", actor: "user" },
        },
        { preferReturn: "minimal" },
      );
      if (!evRes.ok) {
        const txt = (await evRes.text().catch(() => "")).slice(0, 400);
        logSafe({
          userId: user.id,
          action: "anfragen.create",
          status: "error",
          durationMs: Date.now() - started,
          error: `event_http_${evRes.status}: ${txt}`,
          extra: { http: evRes.status, stage: "event" },
        });
      }
    } catch (eEv) {
      logSafe({
        userId: user.id,
        action: "anfragen.create",
        status: "error",
        durationMs: Date.now() - started,
        error: eEv instanceof Error ? eEv.message : String(eEv),
        extra: { stage: "event" },
      });
    }

    logSafe({
      userId: user.id,
      action: "anfragen.create",
      status: "ok",
      durationMs: Date.now() - started,
      extra: { source: "manual" },
    });

    res.status(200).json({
      ok: true,
      id: created.id,
      created_at: created.created_at || null,
    });
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "anfragen.create",
      status: "error",
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "Anfrage konnte nicht angelegt werden." });
  }
}
