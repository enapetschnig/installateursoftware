// ============================================================
// B4Y SuperAPP – KI Spracheingabe → Text (Vercel Serverless Function)
// OpenAI Speech-to-Text (gpt-4o-transcribe, Fallback whisper-1).
// Der OpenAI-Key liegt AUSSCHLIESSLICH serverseitig (OPENAI_API_KEY env).
// Auth über Supabase-JWT; mandantenfähig; Nutzung wird protokolliert.
// ============================================================
import { checkRateLimit } from "../_lib/security.js";

export const config = { maxDuration: 30 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://xyhgckqxowqnzjtoblfs.supabase.co";
// anon/publishable Key ist bewusst öffentlich (nur zum Validieren des User-Tokens nötig)
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_akH66S1-i4WaHAbVrCd50A_qd7OrwfD";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MAX_BYTES = 24 * 1024 * 1024; // OpenAI-Limit 25 MB – etwas darunter
const ALLOWED = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/m4a"];

// Fachbegriffe – verbessern die Erkennung im Bau-/Geschäftskontext (de-AT/de-DE)
const DOMAIN_PROMPT =
  "Geschäftskontext Bau und Handwerk in Österreich/Deutschland. Begriffe: Angebot, Auftrag, Rechnung, " +
  "Leistungsverzeichnis, Regie, Pauschalangebot, Nachtrag, Projekt, Kunde, Baustelle, Mitarbeiter, Dokument, Gewerk, Kalkulation.";

async function verifyUser(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch { return null; }
}

async function logUsage(row) {
  if (!SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage_logs`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json", Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch { /* Logging ist best-effort */ }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Nur POST erlaubt." }); return; }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await verifyUser(token);
  if (!user) { res.status(401).json({ error: "Nicht angemeldet." }); return; }
  if (!checkRateLimit(user.id)) { res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." }); return; }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch { body = null; }
  const audioB64 = body && body.audio;
  const mimeType = (body && body.mimeType) || "audio/webm";
  const route = (body && body.route) || null;
  const contextType = (body && body.context_type) || null;
  if (!audioB64 || typeof audioB64 !== "string") { res.status(400).json({ error: "Feld 'audio' (base64) fehlt." }); return; }

  const baseMime = mimeType.split(";")[0].trim();
  if (!ALLOWED.includes(baseMime)) { res.status(415).json({ error: "Audioformat nicht unterstützt." }); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "Spracheingabe ist noch nicht verbunden (OPENAI_API_KEY fehlt)." }); return; }

  let buffer;
  try { buffer = Buffer.from(audioB64, "base64"); } catch { res.status(400).json({ error: "Audio konnte nicht gelesen werden." }); return; }
  if (!buffer.length) { res.status(400).json({ error: "Leere Audiodaten." }); return; }
  if (buffer.length > MAX_BYTES) { res.status(413).json({ error: "Die Aufnahme ist zu lang. Bitte kürzer sprechen." }); return; }

  const ext = baseMime.includes("mp4") || baseMime.includes("m4a") ? "mp4"
    : baseMime.includes("mpeg") ? "mp3" : baseMime.includes("wav") ? "wav"
    : baseMime.includes("ogg") ? "ogg" : "webm";

  async function transcribe(model) {
    const fd = new FormData();
    fd.append("file", new Blob([buffer], { type: baseMime }), `audio.${ext}`);
    fd.append("model", model);
    fd.append("language", "de");
    fd.append("prompt", DOMAIN_PROMPT);
    fd.append("response_format", "json");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fd,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  try {
    const primary = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
    let result = await transcribe(primary);
    let usedModel = primary;
    if (!result.ok && primary !== "whisper-1") {
      // Fallback auf whisper-1 (breitere Verfügbarkeit)
      result = await transcribe("whisper-1");
      usedModel = "whisper-1";
    }
    if (!result.ok) {
      const msg = result.data?.error?.message || `Transkription fehlgeschlagen (HTTP ${result.status}).`;
      await logUsage({ user_id: user.id, action_type: "transcription", model: usedModel, provider: "openai", success: false, error: msg.slice(0, 300), route, context_type: contextType });
      res.status(502).json({ error: "Die Spracheingabe konnte nicht verarbeitet werden." });
      return;
    }
    const text = (result.data?.text || "").trim();
    await logUsage({
      user_id: user.id, action_type: "transcription", model: usedModel, provider: "openai",
      output_length: text.length, success: true, route, context_type: contextType,
    });
    if (!text) { res.status(200).json({ text: "", warning: "Ich konnte leider keinen Text erkennen. Bitte nochmal versuchen." }); return; }
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: "Die Spracheingabe konnte nicht verarbeitet werden." });
  }
}
