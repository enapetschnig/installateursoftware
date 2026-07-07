// ============================================================
// B4Y SuperAPP – Anfrage KI-Enrichment
// ------------------------------------------------------------
// POST /api/anfragen/enrich  Body: { id: "<anfrage-uuid>" }
//
// Klassifiziert eine Anfrage anhand des Transkripts via OpenAI:
//   - ai_classification (interessent / spam / termine_anfrage / …)
//   - ai_priority (hoch / mittel / niedrig)
//   - ai_summary (1-2 Saetze)
//   - subject (Betreff, nur wenn aktuell leer)
//   - caller_name / caller_address / caller_email (nur wenn leer)
//   - ai_extracted_data merge {gewerk, wunschtermin, dringlichkeit, rueckruf}
//
// Auth: zwei Pfade –
//   1) Service-Role-Bearer im Header → intern (vom Webhook fire-and-forget)
//   2) User-Bearer → manueller Trigger aus der UI (Re-Enrich Button)
//
// OpenAI:
//   model = gpt-4o-mini, response_format = json_object, temp 0.2
// ============================================================

import { createClient } from "@supabase/supabase-js";

import { bearerFromRequest, verifyUser } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

export const config = { maxDuration: 30 };

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";

const ALLOWED_CLASSIFICATIONS = new Set([
  "interessent",
  "kunde_bestand",
  "spam",
  "termine_anfrage",
  "reklamation",
  "info_only",
  "rueckruf_gewuenscht",
  "fehlanruf",
  "sonstiges",
]);
const ALLOWED_PRIORITIES = new Set(["hoch", "mittel", "niedrig"]);

const SYSTEM_PROMPT =
  "Du analysierst Telefongespraeche fuer einen Elektro-/Bau-/Handwerksbetrieb in Oesterreich. " +
  "Antworte AUSSCHLIESSLICH mit gueltigem JSON nach folgendem Schema (keine Erklaerung, kein Markdown):\n" +
  "{\n" +
  '  "classification": "interessent | kunde_bestand | spam | termine_anfrage | reklamation | info_only | rueckruf_gewuenscht | fehlanruf | sonstiges",\n' +
  '  "priority": "hoch | mittel | niedrig",\n' +
  '  "summary": "ein bis zwei Saetze auf Deutsch, was der Anrufer will",\n' +
  '  "subject": "max 60 Zeichen Betreff",\n' +
  '  "caller_name": "Vor und Nachname falls genannt, sonst null",\n' +
  '  "caller_address": "Ort/Adresse falls genannt, sonst null",\n' +
  '  "caller_email": "Email falls genannt, sonst null",\n' +
  '  "gewerk": "Elektriker | Installateur | Maler | Bau | Schlosser | Sonstiges oder null",\n' +
  '  "wunschtermin": "freitext oder ISO-Datum YYYY-MM-DD oder null",\n' +
  '  "dringlichkeit": "hoch | mittel | niedrig",\n' +
  '  "rueckruf_bevorzugt": "vormittags | nachmittags | abend | null"\n' +
  "}\n" +
  "Regeln: " +
  '"dringend"/"sofort"/"Notfall" => priority="hoch", dringlichkeit="hoch". ' +
  '"Terminvereinbarung"/"Rueckruf gewuenscht" => classification entsprechend. ' +
  "Spam erkennen: Werbung, automatische Anrufe ohne Anliegen, falsche Nummer. " +
  "Fehlanruf = sehr kurzer Anruf ohne Gespraech.";

let _adminSingleton = null;
function getAdminClient() {
  if (_adminSingleton) return _adminSingleton;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt");
  _adminSingleton = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminSingleton;
}

export function __setSupabaseClientForTests(client) {
  _adminSingleton = client;
}
export function __resetSupabaseClientForTests() {
  _adminSingleton = null;
}

// Injizierbarer Hook fuer OpenAI-Mocks im Test.
let _openAiOverride = null;
export function __setOpenAiCallForTests(fn) {
  _openAiOverride = fn;
}
export function __resetOpenAiCallForTests() {
  _openAiOverride = null;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === "string" && UUID_REGEX.test(s);
}

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

/**
 * Versucht ein JSON-Objekt aus der LLM-Antwort zu extrahieren. Erlaubt
 * sowohl reines JSON als auch in Markdown gewrapptes JSON, fuer Sicherheit
 * falls model_format nicht greift.
 */
function safeParseJson(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Versuche erstes { ... } Match
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function callOpenAi(transcript, callerHints) {
  if (_openAiOverride) return _openAiOverride(transcript, callerHints);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY fehlt");

  const userPrompt =
    (callerHints
      ? `Anrufer-Hinweise (bereits bekannt): ${callerHints}\n\n`
      : "") + `Transkript:\n${transcript}`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`openai_http_${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  const parsed = safeParseJson(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("openai_invalid_json");
  }
  return parsed;
}

function normalizeAi(parsed) {
  const out = {};
  if (typeof parsed.classification === "string") {
    const c = parsed.classification.toLowerCase().trim();
    if (ALLOWED_CLASSIFICATIONS.has(c)) out.classification = c;
  }
  if (typeof parsed.priority === "string") {
    const p = parsed.priority.toLowerCase().trim();
    if (ALLOWED_PRIORITIES.has(p)) out.priority = p;
  }
  if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
    out.summary = parsed.summary.trim().slice(0, 1000);
  }
  if (typeof parsed.subject === "string" && parsed.subject.trim().length > 0) {
    out.subject = parsed.subject.trim().slice(0, 200);
  }
  for (const k of ["caller_name", "caller_address", "caller_email"]) {
    const v = parsed[k];
    if (typeof v === "string" && v.trim().length > 0) {
      out[k] = v.trim().slice(0, 200);
    }
  }
  const extracted = {};
  for (const k of [
    "gewerk",
    "wunschtermin",
    "dringlichkeit",
    "rueckruf_bevorzugt",
  ]) {
    const v = parsed[k];
    if (v == null) continue;
    if (typeof v === "string" && v.trim().length > 0) {
      extracted[k] = v.trim();
    }
  }
  out.extracted = extracted;
  return out;
}

async function authorize(req) {
  // Pfad 1: Internal Service-Role Bearer (vom Webhook).
  const presented = bearerFromRequest(req);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (presented && serviceKey && presented === serviceKey) {
    return { kind: "internal" };
  }
  // Pfad 2: User-JWT.
  if (presented) {
    const user = await verifyUser(presented);
    if (user) return { kind: "user", user };
  }
  return null;
}

export default async function handler(req, res) {
  const started = Date.now();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Nur POST erlaubt." });
    return;
  }

  const auth = await authorize(req);
  if (!auth) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }

  const body = parseBody(req);
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!isUuid(id)) {
    res.status(400).json({ error: "Parameter 'id' (UUID) ist erforderlich." });
    return;
  }

  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    logSafe({
      action: "anfragen.enrich",
      status: "error",
      error: e?.message || "supabase init failed",
    });
    res.status(500).json({ error: "Backend nicht konfiguriert." });
    return;
  }

  // Anfrage laden.
  const aRes = await admin
    .from("anfragen")
    .select(
      "id, organization_id, transcript, caller_name, caller_email, caller_address, subject, ai_extracted_data",
    )
    .eq("id", id)
    .maybeSingle();

  if (aRes.error || !aRes.data) {
    logSafe({
      action: "anfragen.enrich",
      status: "error",
      error: aRes.error?.message || "anfrage not found",
      extra: { id },
    });
    res.status(404).json({ error: "Anfrage nicht gefunden." });
    return;
  }

  const anfrage = aRes.data;
  const transcript = (anfrage.transcript || "").trim();
  if (transcript.length === 0) {
    logSafe({
      action: "anfragen.enrich",
      status: "ok",
      extra: { id, skipped: "empty_transcript" },
    });
    res.status(200).json({ ok: true, skipped: "empty_transcript" });
    return;
  }

  // Kompakte Hinweise (helfen dem Modell ohne ihm Daten zu suggerieren).
  const hints = [];
  if (anfrage.caller_name) hints.push(`Name aus Webhook: ${anfrage.caller_name}`);
  if (anfrage.caller_email) hints.push(`Email aus Webhook: ${anfrage.caller_email}`);
  if (anfrage.caller_address)
    hints.push(`Adresse aus Webhook: ${anfrage.caller_address}`);
  const callerHints = hints.length > 0 ? hints.join(", ") : "";

  // OpenAI-Call.
  let parsed;
  try {
    parsed = await callOpenAi(transcript, callerHints);
  } catch (e) {
    logSafe({
      action: "anfragen.enrich",
      status: "error",
      error: e?.message || "openai failed",
      extra: { id },
    });
    res.status(502).json({ error: "KI-Klassifizierung fehlgeschlagen." });
    return;
  }

  const norm = normalizeAi(parsed);

  // Update bauen: subject/caller_* nur fuellen wenn aktuell leer.
  const update = { updated_at: new Date().toISOString() };
  if (norm.classification) update.ai_classification = norm.classification;
  if (norm.priority) update.ai_priority = norm.priority;
  if (norm.summary) update.ai_summary = norm.summary;
  if (norm.subject && !anfrage.subject) update.subject = norm.subject;
  for (const k of ["caller_name", "caller_email", "caller_address"]) {
    if (norm[k] && !anfrage[k]) update[k] = norm[k];
  }
  const mergedExtracted = {
    ...(anfrage.ai_extracted_data && typeof anfrage.ai_extracted_data === "object"
      ? anfrage.ai_extracted_data
      : {}),
    ...norm.extracted,
  };
  update.ai_extracted_data = mergedExtracted;

  const upd = await admin
    .from("anfragen")
    .update(update)
    .eq("id", id)
    .select("id")
    .single();

  if (upd.error) {
    logSafe({
      action: "anfragen.enrich",
      status: "error",
      error: upd.error.message,
      extra: { id },
    });
    res.status(502).json({ error: "Update fehlgeschlagen." });
    return;
  }

  // Audit-Event (best-effort).
  try {
    await admin.from("anfrage_events").insert({
      organization_id: anfrage.organization_id,
      anfrage_id: id,
      event_type: "ai_classified",
      payload: {
        classification: norm.classification ?? null,
        priority: norm.priority ?? null,
        actor: auth.kind,
      },
    });
  } catch {
    /* ignore */
  }

  logSafe({
    action: "anfragen.enrich",
    status: "ok",
    durationMs: Date.now() - started,
    extra: {
      id,
      classification: norm.classification ?? "none",
      priority: norm.priority ?? "none",
      actor: auth.kind,
    },
  });

  res.status(200).json({
    ok: true,
    classification: norm.classification ?? null,
    priority: norm.priority ?? null,
    summary: norm.summary ?? null,
    subject: norm.subject ?? null,
  });
}
