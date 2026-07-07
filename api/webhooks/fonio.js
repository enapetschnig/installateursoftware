// ============================================================
// B4Y SuperAPP – Fonio.ai Post-Call Webhook
// ------------------------------------------------------------
// Empfaengt Post-Call-Webhooks von Fonio.ai (Wiener KI-Telefon-
// assistent) und persistiert jeden Anruf in der `anfragen`-Tabelle.
//
// WICHTIG (User-Constraint):
//   ALLE Anrufe werden gespeichert – auch info_only/spam. Klassifikation
//   und Filterung passiert spaeter im UI ueber `status`/`classification`.
//
// Authentifizierung:
//   Bearer-Token im Authorization-Header gegen FONIO_WEBHOOK_SECRET.
//   Vergleich via crypto.timingSafeEqual (timing-safe).
//   Fonio bietet aktuell keinen nativen HMAC-Signatur-Header.
//
// Org-Mapping:
//   1. Header `X-Fonio-Org-Id` (zukunftssicher fuer Multi-Tenant)
//   2. Fallback: ENV `FONIO_DEFAULT_ORG_ID`
//   (Aktuell ist nur die Baranowski-Org angebunden.)
//
// Idempotenz:
//   Upsert auf (organization_id, source, source_ref) – derselbe
//   Fonio-Call landet bei Wiederholungs-Webhooks in derselben Row.
//
// Logging:
//   logSafe() – KEINE Bodies, Tokens oder Transkripte im Log.
//
// Der Endpunkt ist OEFFENTLICH (kein Supabase-User-JWT). Schutz nur
// ueber das Shared-Secret. Daher: niemals Details in Error-Responses
// preisgeben.
// ============================================================

import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { logSafe } from "../_lib/safe-log.js";

export const config = { maxDuration: 30 };

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";

// ── Helfer ─────────────────────────────────────────────────

/** Extrahiert das Bearer-Token aus dem Authorization-Header. */
function extractBearer(req) {
  const raw = req && req.headers ? req.headers.authorization || req.headers.Authorization : "";
  if (typeof raw !== "string" || raw.length === 0) return "";
  return raw.replace(/^Bearer\s+/i, "").trim();
}

/**
 * Timing-safer String-Vergleich. Liefert false bei Laengen-Mismatch
 * (bewusst – unterschiedliche Laenge ist hier keine Geheimnis-Information).
 */
function timingSafeStrEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Parst den Request-Body robust – akzeptiert Object oder JSON-String. */
function parseBody(req) {
  if (!req) return null;
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length > 0) {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

/** Org-ID aus Request ermitteln: Header > ENV-Default. */
function resolveOrgId(req) {
  const h = req && req.headers ? req.headers["x-fonio-org-id"] || req.headers["X-Fonio-Org-Id"] : null;
  if (typeof h === "string" && h.length > 0) return h.trim();
  const env = process.env.FONIO_DEFAULT_ORG_ID;
  return typeof env === "string" && env.length > 0 ? env.trim() : null;
}

/**
 * Normalisiert das Transkript zu einem String.
 * Fonio liefert je nach Plan/Config:
 *   • `transcript`: Array von {role,text,timestamp}
 *   • `formattedTranscript`: bereits formatierter String
 *   • beides oder keines
 */
function normalizeTranscript(payload) {
  if (typeof payload.transcript === "string") return payload.transcript;
  if (typeof payload.formattedTranscript === "string") return payload.formattedTranscript;
  if (Array.isArray(payload.transcript)) {
    try {
      return JSON.stringify(payload.transcript);
    } catch {
      return "";
    }
  }
  return "";
}

/** Erstes nicht-leeres String-Feld aus einer Liste von Kandidaten. */
function firstNonEmptyString(...candidates) {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

/** ISO-Timestamp oder null. */
function asIso(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

/**
 * Normalisiert Direction-Werte auf unseren CHECK-Constraint.
 * Fonio sendet z.B. "sip_inbound" / "sip_outbound" — DB erlaubt aber nur
 * "inbound" / "outbound" (oder NULL).
 */
function normalizeDirection(value) {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase().trim();
  if (v.includes("outbound") || v === "out") return "outbound";
  if (v.includes("inbound") || v === "in") return "inbound";
  return null;
}

/** Finite Zahl oder null. */
function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Mappt das Fonio-Payload auf eine `anfragen`-Row.
 * Wird auch von Tests direkt aufgerufen.
 *
 * @param {Record<string, any>} payload
 * @param {string} orgId
 * @returns {Record<string, any>}
 */
/**
 * Verbindet first/last Name aus Fonio-Contact-Extraktion zu einem
 * Anzeige-Namen. Beide leer → null.
 */
function joinFullName(first, last) {
  const parts = [first, last]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Fonio liefert phoneNumbers/emails als Array ODER String. Wir nehmen den
 * ersten nicht-leeren Eintrag fuer die DB-Spalte; den Rest behaelt das
 * raw_payload/ai_extracted_data fuer Audit.
 */
function firstFromArrayOrString(v) {
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string" && item.trim().length > 0) return item.trim();
    }
    return null;
  }
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

export function buildAnfrageRow(payload, orgId) {
  // Fonio-Webhook-Felder (2026 UI): conversationId / personNumber / agentNumber /
  // direction / startTimestamp / conversationLink / formattedTranscript +
  // fonio.contact.* (firstName, lastName, organization, phoneNumbers, emails).
  // Plus context.* fuer outbound-Calls (Variables aus Outbound-API).
  // Backwards-compat: alte Outbound-Felder (id/fromNumber/audioLink/extractionData)
  // werden weiterhin akzeptiert.
  const extraction = (payload && payload.extractionData) || {};
  const context = (payload && payload.context) || {};
  const summary = typeof payload.summary === "string" ? payload.summary : null;

  // Caller-Name: bevorzugt aus Fonio's Contact-Extraktion, fallback auf alte Felder.
  const callerFullName = joinFullName(payload.callerFirstName, payload.callerLastName);
  const caller_name = firstNonEmptyString(
    callerFullName,
    extraction.kunde_name,
    context.kunde_name,
  );

  const caller_phone = firstNonEmptyString(
    firstFromArrayOrString(payload.callerPhones),
    payload.personNumber,
    payload.fromNumber,
    extraction.telefon,
    context.telefon,
  );

  const caller_email = firstNonEmptyString(
    firstFromArrayOrString(payload.callerEmails),
    extraction.email,
    context.email,
  );

  const caller_address = firstNonEmptyString(
    payload.callerOrganization,
    extraction.adresse,
    context.adresse,
  );

  // source_ref fuer Idempotenz: conversationId (neuer Webhook) oder id (legacy).
  const sourceRefValue = payload.conversationId ?? payload.id;
  const source_ref = sourceRefValue == null ? null : String(sourceRefValue);

  const subjectFromExtraction = firstNonEmptyString(extraction.anliegen, context.anliegen);
  const subject =
    subjectFromExtraction ?? (summary ? summary.slice(0, 200) : null);

  // ai_extracted_data merged Fonio-Contact-Extraktion + Outbound-extractionData.
  const aiExtracted = {
    ...(extraction && typeof extraction === "object" ? extraction : {}),
    ...(payload.callerFirstName ? { callerFirstName: payload.callerFirstName } : {}),
    ...(payload.callerLastName ? { callerLastName: payload.callerLastName } : {}),
    ...(payload.callerOrganization ? { callerOrganization: payload.callerOrganization } : {}),
    ...(payload.callerPhones ? { callerPhones: payload.callerPhones } : {}),
    ...(payload.callerEmails ? { callerEmails: payload.callerEmails } : {}),
    ...(payload.agentName ? { agentName: payload.agentName } : {}),
    ...(payload.companyName ? { companyName: payload.companyName } : {}),
  };

  // audio_url: Fonio liefert eher einen "conversationLink" (Fonio-UI-Link mit
  // Audio+Transcript) statt einer direkten Audio-URL. Wir speichern den Link
  // im audio_url-Feld – das UI rendert ihn als "Aufnahme oeffnen"-Button.
  const audio_url = firstNonEmptyString(payload.conversationLink, payload.audioLink);

  return {
    organization_id: orgId,
    source: "phone_fonio",
    source_ref,
    status: "neu",
    caller_name,
    caller_phone,
    caller_email,
    caller_address,
    subject,
    description: summary,
    transcript: normalizeTranscript(payload),
    audio_url,
    duration_seconds: asNumber(payload.duration),
    // Fonio sendet "sip_inbound" / "sip_outbound" — wir normalisieren auf
    // unseren CHECK-Constraint ("inbound"/"outbound") und merken die
    // Detail-Variante im raw_payload + ai_extracted_data.
    call_direction: normalizeDirection(payload.direction),
    call_started_at: asIso(payload.startTimestamp),
    call_ended_at: asIso(payload.endTimestamp),
    ai_summary: summary,
    ai_extracted_data: aiExtracted,
    raw_payload: payload,
  };
}

// ── Supabase Admin-Client (injectable fuer Tests) ──────────

let _adminSingleton = null;

/**
 * Liefert einen Supabase-Service-Role-Client. Fuer Tests kann via
 * __setSupabaseClientForTests() ein Mock injiziert werden.
 */
function getAdminClient() {
  if (_adminSingleton) return _adminSingleton;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt – Fonio-Webhook braucht Service-Role.");
  }
  _adminSingleton = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminSingleton;
}

/** Nur fuer Tests: injiziert einen Mock-Client. */
export function __setSupabaseClientForTests(client) {
  _adminSingleton = client;
}

/** Nur fuer Tests: setzt den Singleton zurueck. */
export function __resetSupabaseClientForTests() {
  _adminSingleton = null;
}

// ── Handler ────────────────────────────────────────────────

export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // 1) Bearer-Auth – timing-safe.
  const expected = process.env.FONIO_WEBHOOK_SECRET || "";
  if (!expected) {
    // Keine Konfiguration → fail closed; KEINE Details rausgeben.
    logSafe({
      action: "fonio-webhook",
      status: "error",
      error: "FONIO_WEBHOOK_SECRET not configured",
    });
    // DIAGNOSTIC: 200 zurueck damit Fonio nicht "Fehlgeschlagen" anzeigt.
    res.status(200).json({ ok: false, reason: "auth-failed" });
    return;
  }
  const presented = extractBearer(req);
  if (!presented || !timingSafeStrEqual(presented, expected)) {
    logSafe({
      action: "fonio-webhook",
      status: "error",
      error: "invalid bearer token",
    });
    // DIAGNOSTIC: 200 zurueck damit Fonio nicht "Fehlgeschlagen" anzeigt.
    res.status(200).json({ ok: false, reason: "auth-failed" });
    return;
  }

  // 2) Body parsen.
  const payload = parseBody(req);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    logSafe({
      action: "fonio-webhook",
      status: "error",
      error: "invalid or missing JSON body",
    });
    // DIAGNOSTIC: 200 zurueck damit Fonio nicht "Fehlgeschlagen" anzeigt.
    res.status(200).json({ ok: false, reason: "invalid-json" });
    return;
  }
  // ID-Validation: Fonio-Webhook nutzt conversationId,
  // Outbound-API nutzt id - wir akzeptieren beide.
  const callRefForValidation = payload.conversationId ?? payload.id;
  if (typeof callRefForValidation !== "string" || callRefForValidation.length === 0) {
    logSafe({
      action: "fonio-webhook",
      status: "error",
      error: "missing call id (need conversationId or id)",
    });
    // DIAGNOSTIC: 200 zurueck damit Fonio nicht "Fehlgeschlagen" anzeigt.
    res.status(200).json({ ok: false, reason: "missing-call-id" });
    return;
  }

  // 3) Org-Mapping.
  const orgId = resolveOrgId(req);
  if (!orgId) {
    logSafe({
      action: "fonio-webhook",
      status: "error",
      error: "no org id (header missing and FONIO_DEFAULT_ORG_ID unset)",
    });
    // DIAGNOSTIC: 200 zurueck damit Fonio nicht "Fehlgeschlagen" anzeigt.
    res.status(200).json({ ok: false, reason: "no-org" });
    return;
  }

  // 4) Supabase-Client besorgen.
  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    logSafe({
      action: "fonio-webhook",
      status: "error",
      orgId,
      error: e && e.message ? e.message : "supabase init failed",
    });
    // DIAGNOSTIC: 200 zurueck damit Fonio nicht "Fehlgeschlagen" anzeigt.
    res.status(200).json({ ok: false, reason: "upsert-error" });
    return;
  }

  // 5) Upsert in anfragen (Idempotenz ueber org+source+source_ref).
  const row = buildAnfrageRow(payload, orgId);

  /** @type {{ data: any, error: any }} */
  let upsertRes;
  try {
    upsertRes = await admin
      .from("anfragen")
      .upsert(row, { onConflict: "organization_id,source,source_ref" })
      .select("id")
      .single();
  } catch (e) {
    logSafe({
      action: "fonio-webhook",
      status: "error",
      orgId,
      error: e && e.message ? e.message : "upsert threw",
      extra: { source_ref: callRefForValidation },
    });
    // DIAGNOSTIC: 200 zurueck damit Fonio nicht "Fehlgeschlagen" anzeigt.
    res.status(200).json({ ok: false, reason: "upsert-error" });
    return;
  }

  if (upsertRes.error || !upsertRes.data || !upsertRes.data.id) {
    logSafe({
      action: "fonio-webhook",
      status: "error",
      orgId,
      error:
        upsertRes.error && upsertRes.error.message
          ? upsertRes.error.message
          : "upsert returned no row",
      extra: { source_ref: callRefForValidation },
    });
    // DIAGNOSTIC: 200 zurueck damit Fonio nicht "Fehlgeschlagen" anzeigt.
    res.status(200).json({ ok: false, reason: "upsert-error" });
    return;
  }

  const anfrageId = upsertRes.data.id;

  // 6) Fire-and-forget: KI-Enrichment im Hintergrund triggern.
  //    Wir warten NICHT auf den OpenAI-Call (Fonio-Webhook hat enges
  //    Timeout-Budget). Eigener Endpoint, eigene Function-Instanz.
  if (row.transcript && row.transcript.length > 0) {
    const enrichUrl = process.env.ANFRAGEN_ENRICH_URL
      || (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/anfragen/enrich`
        : "https://b4y-superapp.vercel.app/api/anfragen/enrich");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (serviceKey) {
      // Best-effort, kein await, kein Throw — Fehler wandern in logSafe.
      fetch(enrichUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: anfrageId }),
      }).catch((e) => {
        logSafe({
          action: "fonio-webhook-enrich-trigger",
          status: "error",
          orgId,
          error: e?.message || "fetch failed",
          extra: { anfrage_id: anfrageId },
        });
      });
    }
  }

  // 7) Event-Log (best-effort: ein Fehler hier darf den Webhook nicht
  //    fehlschlagen lassen – Fonio wuerde sonst retryen und wir haetten
  //    Duplikate auf der Ereignis-Spur).
  try {
    const ev = await admin.from("anfrage_events").insert({
      organization_id: orgId,
      anfrage_id: anfrageId,
      event_type: "created",
      payload: { source: "phone_fonio" },
    });
    if (ev && ev.error) {
      logSafe({
        action: "fonio-webhook-event",
        status: "error",
        orgId,
        error: ev.error.message || "event insert failed",
        extra: { anfrage_id: anfrageId, source_ref: callRefForValidation },
      });
    }
  } catch (e) {
    logSafe({
      action: "fonio-webhook-event",
      status: "error",
      orgId,
      error: e && e.message ? e.message : "event insert threw",
      extra: { anfrage_id: anfrageId, source_ref: callRefForValidation },
    });
  }

  // 8) Erfolg.
  logSafe({
    action: "fonio-webhook",
    status: "ok",
    orgId,
    durationMs: Date.now() - startedAt,
    extra: { anfrage_id: anfrageId, source_ref: callRefForValidation },
  });

  res.status(200).json({ ok: true, id: anfrageId });
}
