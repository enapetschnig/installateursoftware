// ============================================================
// Installateur SuperAPP – Marketing: KI-Textvorschlag für Social-Beiträge
// ------------------------------------------------------------
// POST /api/marketing/generate-post
//   Body: { topic, platform ("facebook"|"instagram"), tone, company?, length? }
//   → { title, content, hashtags[], best_time_hint }
//
// Echte Generierung über OpenAI (gpt-4o-mini, JSON-Modus). Auth: User-JWT.
// Es wird NICHTS veröffentlicht – nur ein Textvorschlag erzeugt.
// ============================================================
import { bearerFromRequest, verifyUser, checkRateLimit } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

export const config = { maxDuration: 30 };

const ALLOWED_PLATFORM = new Set(["facebook", "instagram"]);
const ALLOWED_TONE = new Set(["freundlich", "professionell", "locker", "werblich", "informativ"]);

const SYSTEM_PROMPT =
  "Du bist Social-Media-Redakteur für einen österreichischen Handwerksbetrieb (Bad-/Installationstechnik). " +
  "Du schreibst Beiträge, die echte Kunden ansprechen: konkret, ehrlich, ohne Werbefloskeln und ohne Übertreibung. " +
  "Antworte AUSSCHLIESSLICH mit gültigem JSON nach diesem Schema (keine Erklärung, kein Markdown):\n" +
  "{\n" +
  '  "title": "kurzer interner Titel, max 60 Zeichen",\n' +
  '  "content": "der fertige Beitragstext auf Deutsch, Absätze mit \\n getrennt",\n' +
  '  "hashtags": ["ohne Raute", "max 6", "kleingeschrieben"],\n' +
  '  "best_time_hint": "kurze Empfehlung wann posten, z. B. Di 18:00"\n' +
  "}\n" +
  "Regeln: Facebook = 3–6 Sätze, ruhiger Ton, gern eine konkrete Handlungsaufforderung. " +
  "Instagram = kürzer, bildhafter, Emojis sparsam (max 2). " +
  "Keine erfundenen Preise, Zahlen, Auszeichnungen oder Kundenstimmen. " +
  "Österreichisches Deutsch, Anrede 'Sie'.";

function parseBody(req) {
  if (req && req.body && typeof req.body === "object") return req.body;
  if (typeof req?.body === "string" && req.body.length > 0) {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function safeParseJson(text) {
  if (typeof text !== "string" || !text) return null;
  try { return JSON.parse(text.trim()); } catch { /* weiter */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Normalisiert die LLM-Antwort auf ein festes Schema. */
function normalize(parsed) {
  const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const tags = Array.isArray(parsed?.hashtags)
    ? parsed.hashtags
        .filter((t) => typeof t === "string" && t.trim())
        .map((t) => t.trim().replace(/^#/, "").toLowerCase().slice(0, 40))
        .slice(0, 6)
    : [];
  return {
    title: str(parsed?.title, 80) || "Neuer Beitrag",
    content: str(parsed?.content, 3000) || "",
    hashtags: tags,
    best_time_hint: str(parsed?.best_time_hint, 60),
  };
}

let _openAiOverride = null;
export function __setOpenAiCallForTests(fn) { _openAiOverride = fn; }
export function __resetOpenAiCallForTests() { _openAiOverride = null; }

async function callOpenAi(userPrompt) {
  if (_openAiOverride) return _openAiOverride(userPrompt);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY fehlt");
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`openai_http_${r.status}: ${t.slice(0, 160)}`);
  }
  const j = await r.json();
  const parsed = safeParseJson(j?.choices?.[0]?.message?.content);
  if (!parsed) throw new Error("openai_invalid_json");
  return parsed;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Nur POST erlaubt." });
    return;
  }

  const token = bearerFromRequest(req);
  const user = token ? await verifyUser(token) : null;
  if (!user) { res.status(401).json({ error: "Nicht angemeldet." }); return; }
  if (!checkRateLimit(user.id)) {
    res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "Die KI ist noch nicht verbunden (OPENAI_API_KEY fehlt)." });
    return;
  }

  const body = parseBody(req) || {};
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 500) : "";
  if (!topic) { res.status(400).json({ error: "Bitte ein Thema angeben." }); return; }

  const platform = ALLOWED_PLATFORM.has(body.platform) ? body.platform : "facebook";
  const tone = ALLOWED_TONE.has(body.tone) ? body.tone : "freundlich";
  const company = typeof body.company === "string" ? body.company.trim().slice(0, 120) : "";

  const userPrompt =
    `Plattform: ${platform}\nTonalität: ${tone}\n` +
    (company ? `Betrieb: ${company}\n` : "") +
    `Thema/Stichworte: ${topic}`;

  try {
    const parsed = await callOpenAi(userPrompt);
    const out = normalize(parsed);
    logSafe({ action: "marketing.generate-post", status: "ok", extra: { platform, tone } });
    res.status(200).json(out);
  } catch (e) {
    logSafe({ action: "marketing.generate-post", status: "error", error: e?.message || "openai failed" });
    res.status(502).json({ error: "Die KI konnte gerade keinen Vorschlag erstellen. Bitte erneut versuchen." });
  }
}
