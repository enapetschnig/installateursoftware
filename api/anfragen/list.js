// ============================================================
// B4Y SuperAPP – Anfragen-Liste (Vercel Serverless Function)
// ------------------------------------------------------------
// GET /api/anfragen/list?status=&source=&search=&limit=&offset=
//
// Listet Anfragen (Voice-/Manual-/Fonio-Pipeline) fuer den eingeloggten
// User. Multi-Tenant-Isolation und Sichtbarkeit werden vollstaendig durch
// Supabase RLS erzwungen – wir nutzen bewusst den USER-Bearer-Token
// (NICHT die Service-Role-Key) als Authorization fuer den REST-Call.
//
// Anforderungen aus dem Projekt:
//   • Quellen aktuell: nur "fonio" und "manual" (UI-Filter)
//   • ALLE Fonio-Anrufe sind sichtbar – das Filtern nach status/classification
//     passiert ausschliesslich client-seitig in der UI; die API liefert alles,
//     was RLS erlaubt.
//
// Returns: { rows: [...], total_count }
// ------------------------------------------------------------
// Sicherheits-Layer:
//   1) verifyUser   – nur valide Supabase-JWT
//   2) RLS          – Supabase erzwingt org_isolation (RESTRICTIVE-Policy,
//                     siehe Migration 0063 ff.)
//   3) safe-log     – kein JWT/PII landet je in den Logs
// ============================================================

import { bearerFromRequest, verifyUser } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_SI2t5XGM8ftCbPiav3-HPA_XC26KXtg";

// Whitelist erlaubter Quellen — muss exakt zum CHECK-Constraint in
// Migration 0117 passen.
const ALLOWED_SOURCES = new Set([
  "phone_fonio",
  "website_form",
  "email",
  "manual",
  "instagram",
  "facebook",
  "whatsapp",
  "other",
]);

// Whitelist erlaubter Status — exakt zum CHECK-Constraint in Migration 0117.
const ALLOWED_STATUS = new Set([
  "neu",
  "in_arbeit",
  "qualifiziert",
  "kontakt_erstellt",
  "abgewiesen",
  "archiviert",
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SEARCH_LEN = 120;

// PostgREST-Sonderzeichen, die in einem `ilike.*…*`-Pattern Probleme machen
// (Komma trennt Filter, Klammern wechseln Gruppen, * ist Wildcard) – wir
// schneiden sie raus, statt zu escapen, weil die UI hier nur freie Volltext-
// Suche braucht.
function sanitizeSearch(s) {
  return String(s || "")
    .replace(/[%,()*\\]/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LEN);
}

function parseIntOr(v, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// PostgREST-Antwort: total_count steht im `Content-Range`-Header,
// Format: "0-49/123". Bei "*" als Gesamtzahl liefern wir null.
function parseTotalCount(contentRange) {
  if (typeof contentRange !== "string") return null;
  const idx = contentRange.lastIndexOf("/");
  if (idx < 0) return null;
  const tail = contentRange.slice(idx + 1).trim();
  if (tail === "*" || tail === "") return null;
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : null;
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

  // ── Query-Parameter aufbereiten ───────────────────────────
  const q = req.query || {};
  const status = typeof q.status === "string" && ALLOWED_STATUS.has(q.status)
    ? q.status
    : null;
  const source = typeof q.source === "string" && ALLOWED_SOURCES.has(q.source)
    ? q.source
    : null;
  const search = sanitizeSearch(q.search);
  const limit = parseIntOr(q.limit, DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT });
  const offset = parseIntOr(q.offset, 0, { min: 0 });

  // ── Supabase-REST-URL bauen (USER-Bearer → RLS greift) ────
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,source,source_ref,status,ai_classification,ai_priority,subject,description," +
      "caller_name,caller_phone,caller_email,caller_address," +
      "duration_seconds,call_direction,call_started_at,call_ended_at,audio_url," +
      "organization_id,created_at,updated_at",
  );
  params.set("order", "created_at.desc");
  // Limit/Offset werden zusaetzlich per Range-Header gesetzt (siehe unten),
  // PostgREST akzeptiert beides; wir nehmen Header, weil dann
  // Prefer: count=exact die Gesamtzahl liefert.

  if (status) params.append("status", `eq.${status}`);
  if (source) params.append("source", `eq.${source}`);

  if (search) {
    // Volltextsuche ueber freie Felder. Der `or=(...)`-Operator von
    // PostgREST verlangt Kommas zwischen den Klauseln – sanitizeSearch hat
    // Kommas/Klammern aus dem User-Input bereits entfernt.
    const term = encodeURIComponent(search);
    const parts = [
      `subject.ilike.*${term}*`,
      `description.ilike.*${term}*`,
      `caller_name.ilike.*${term}*`,
      `caller_phone.ilike.*${term}*`,
      `caller_email.ilike.*${term}*`,
    ];
    params.append("or", `(${parts.join(",")})`);
  }

  const url = `${SUPABASE_URL}/rest/v1/anfragen?${params.toString()}`;
  const rangeFrom = offset;
  const rangeTo = offset + limit - 1;

  try {
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // count=exact → PostgREST liefert exakten total_count im Content-Range.
        // Bei sehr grossen Tabellen kann man spaeter auf "planned" wechseln.
        Prefer: "count=exact",
        Range: `${rangeFrom}-${rangeTo}`,
        "Range-Unit": "items",
      },
    });

    if (!r.ok) {
      // 416 ("Range Not Satisfiable") tritt auf, wenn offset jenseits der
      // tatsaechlichen Zeilenzahl liegt. PostgREST liefert dann z. B.
      // Content-Range: */7 → total_count=7, rows=[].
      if (r.status === 416) {
        const total = parseTotalCount(r.headers.get("content-range"));
        logSafe({
          userId: user.id,
          action: "anfragen.list",
          status: "ok",
          durationMs: Date.now() - started,
          extra: { rows: 0, total_count: total ?? 0, offset, limit },
        });
        res.status(200).json({ rows: [], total_count: total ?? 0 });
        return;
      }
      const errText = (await r.text().catch(() => "")).slice(0, 400);
      logSafe({
        userId: user.id,
        action: "anfragen.list",
        status: "error",
        durationMs: Date.now() - started,
        error: `supabase_http_${r.status}: ${errText}`,
        extra: { http: r.status },
      });
      res.status(502).json({ error: "Anfragen konnten nicht geladen werden." });
      return;
    }

    const rows = await r.json().catch(() => []);
    const total = parseTotalCount(r.headers.get("content-range")) ?? rows.length;

    logSafe({
      userId: user.id,
      action: "anfragen.list",
      status: "ok",
      durationMs: Date.now() - started,
      extra: {
        rows: Array.isArray(rows) ? rows.length : 0,
        total_count: total,
        offset,
        limit,
        has_search: search.length > 0,
        has_status: status != null,
        has_source: source != null,
      },
    });

    res.status(200).json({
      rows: Array.isArray(rows) ? rows : [],
      total_count: total,
    });
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "anfragen.list",
      status: "error",
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "Anfragen konnten nicht geladen werden." });
  }
}
