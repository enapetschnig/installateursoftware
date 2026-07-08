// ============================================================
// Installateur SuperAPP – KI-Triage für eingehende E-Mails
// ------------------------------------------------------------
// EINE OpenAI-Anfrage pro Mail klassifiziert auf Mail-Ebene und extrahiert
// je nach Klasse die passenden Felder:
//   • kundenanfrage → Betreff, Priorität, Anfrage-Subtyp (für public.anfragen),
//                     Absenderdaten, Gewerk/Wunschtermin.
//   • rechnung      → Lieferant, Rechnungsnr., Betrag, Datum, Fälligkeit, IBAN
//                     (Vorab-Extraktion für das Buchhaltungsmodul, Phase 2).
//
// Modell: gpt-4o-mini, response_format=json_object, temperature 0.2
// Key ausschließlich via OPENAI_API_KEY (ENV).
// ============================================================

// Anfrage-Subtypen exakt wie CHECK-Constraint in public.anfragen
// (anfragen_ai_classification_check) – KEINE eigenen Werte erfinden.
const ALLOWED_ANFRAGE_CLASS = new Set([
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
const ALLOWED_MAIL_CLASS = new Set([
  "kundenanfrage",
  "rechnung",
  "angebot",
  "spam",
  "sonstiges",
]);

const SYSTEM_PROMPT =
  "Du bist die Postfach-KI eines österreichischen Installateur-/Bad-Sanierungs-Betriebs. " +
  "Du liest eingehende E-Mails und ordnest sie ein. " +
  "Antworte AUSSCHLIESSLICH mit gültigem JSON nach diesem Schema (keine Erklärung, kein Markdown):\n" +
  "{\n" +
  '  "mail_class": "kundenanfrage | rechnung | angebot | spam | sonstiges",\n' +
  '  "summary": "1-2 Sätze auf Deutsch: worum geht es in der Mail",\n' +
  '  "subject": "kurzer Betreff max 80 Zeichen",\n' +
  '  "priority": "hoch | mittel | niedrig",\n' +
  '  "anfrage_class": "interessent | kunde_bestand | spam | termine_anfrage | reklamation | info_only | rueckruf_gewuenscht | sonstiges",\n' +
  '  "sender_name": "Name des Absenders falls erkennbar, sonst null",\n' +
  '  "sender_email": "E-Mail des Absenders falls im Text genannt, sonst null",\n' +
  '  "sender_phone": "Telefon falls genannt, sonst null",\n' +
  '  "address": "Ort/Adresse falls genannt, sonst null",\n' +
  '  "gewerk": "Installateur | Heizung | Bad | Elektrik | Fliesen | Sonstiges oder null",\n' +
  '  "wunschtermin": "Freitext oder ISO-Datum YYYY-MM-DD oder null",\n' +
  '  "invoice": {\n' +
  '    "supplier_name": "Lieferant/Aussteller oder null",\n' +
  '    "invoice_number": "Rechnungsnummer oder null",\n' +
  '    "amount_gross": "Bruttobetrag als Zahl oder null",\n' +
  '    "currency": "EUR oder anderer Code oder null",\n' +
  '    "invoice_date": "ISO-Datum YYYY-MM-DD oder null",\n' +
  '    "due_date": "ISO-Datum YYYY-MM-DD oder null",\n' +
  '    "iban": "IBAN oder null"\n' +
  "  }\n" +
  "}\n" +
  "Einordnung:\n" +
  "• kundenanfrage = ein (potenzieller) Kunde will etwas: Anfrage, Terminwunsch, Angebot erbeten, Reklamation, Rückruf.\n" +
  "• rechnung = eine EINGANGSrechnung an den Betrieb (Lieferant/Dienstleister stellt dem Betrieb etwas in Rechnung), oft mit PDF-Anhang, Rechnungsnummer, Betrag, IBAN/Zahlungsziel.\n" +
  "• angebot = ein LIEFERANT schickt dem Betrieb ein Angebot/Preisliste.\n" +
  "• spam = Werbung, Newsletter, Phishing, automatisierte Massenmail.\n" +
  "• sonstiges = alles andere (Behörde, interne Info, Bestätigungen).\n" +
  "Regeln: 'dringend'/'sofort'/'Notfall'/'Wasserschaden'/'kein Warmwasser' ⇒ priority='hoch'. " +
  "Nur bei mail_class='rechnung' das invoice-Objekt füllen, sonst alle invoice-Felder null. " +
  "anfrage_class nur sinnvoll bei kundenanfrage setzen, sonst 'sonstiges'.";

function safeParseJson(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function str(v, max = 200) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
}

function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // "1.234,56" (AT) oder "1234.56" tolerant parsen.
    const cleaned = v.replace(/[^\d,.-]/g, "");
    if (!cleaned) return null;
    let normalized = cleaned;
    if (cleaned.includes(",") && cleaned.includes(".")) {
      // Letztes Trennzeichen ist Dezimaltrenner.
      normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
    } else if (cleaned.includes(",")) {
      normalized = cleaned.replace(",", ".");
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isoDate(v) {
  const s = str(v, 40);
  if (!s) return null;
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Normalisiert die LLM-Antwort auf ein festes, validiertes Schema. */
function normalize(parsed) {
  const out = {};
  const mc = str(parsed?.mail_class, 30)?.toLowerCase();
  out.mail_class = mc && ALLOWED_MAIL_CLASS.has(mc) ? mc : "sonstiges";

  out.summary = str(parsed?.summary, 1000) || null;
  out.subject = str(parsed?.subject, 200) || null;

  const pr = str(parsed?.priority, 20)?.toLowerCase();
  out.priority = pr && ALLOWED_PRIORITIES.has(pr) ? pr : "mittel";

  const ac = str(parsed?.anfrage_class, 40)?.toLowerCase();
  out.anfrage_class = ac && ALLOWED_ANFRAGE_CLASS.has(ac) ? ac : "sonstiges";

  out.sender_name = str(parsed?.sender_name, 200);
  out.sender_email = str(parsed?.sender_email, 200);
  out.sender_phone = str(parsed?.sender_phone, 80);
  out.address = str(parsed?.address, 300);
  out.gewerk = str(parsed?.gewerk, 60);
  out.wunschtermin = str(parsed?.wunschtermin, 120);

  const inv = parsed?.invoice && typeof parsed.invoice === "object" ? parsed.invoice : {};
  out.invoice = {
    supplier_name: str(inv.supplier_name, 200),
    invoice_number: str(inv.invoice_number, 100),
    amount_gross: num(inv.amount_gross),
    currency: str(inv.currency, 10),
    invoice_date: isoDate(inv.invoice_date),
    due_date: isoDate(inv.due_date),
    iban: str(inv.iban, 40),
  };
  return out;
}

/** Testbarer Override-Hook für den OpenAI-Aufruf. */
let _openAiOverride = null;
export function __setOpenAiCallForTests(fn) {
  _openAiOverride = fn;
}
export function __resetOpenAiCallForTests() {
  _openAiOverride = null;
}

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
      temperature: 0.2,
      max_tokens: 600,
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
  if (!parsed || typeof parsed !== "object") throw new Error("openai_invalid_json");
  return parsed;
}

/**
 * Klassifiziert + extrahiert eine E-Mail.
 * @param {{subject?:string, from?:{name?:string,email?:string}, text?:string,
 *          attachments?:Array<{filename?:string,contentType?:string}>}} mail
 * @returns {Promise<object>} normalisiertes Triage-Ergebnis
 */
export async function classifyMail(mail) {
  const subject = String(mail?.subject || "").slice(0, 300);
  const fromName = mail?.from?.name || "";
  const fromEmail = mail?.from?.email || "";
  const attachments = Array.isArray(mail?.attachments) ? mail.attachments : [];
  const attachLine = attachments.length
    ? `Anhänge: ${attachments.map((a) => `${a.filename || "?"} (${a.contentType || "?"})`).join(", ")}`
    : "Anhänge: keine";
  // Body auf ~6000 Zeichen begrenzen (Kostenkontrolle).
  const body = String(mail?.text || "").slice(0, 6000);

  const userPrompt =
    `Absender: ${fromName ? fromName + " " : ""}<${fromEmail}>\n` +
    `Betreff: ${subject}\n` +
    `${attachLine}\n\n` +
    `Text:\n${body || "(kein Textinhalt)"}`;

  const parsed = await callOpenAi(userPrompt);
  return normalize(parsed);
}

// Für Tests / Wiederverwendung.
export { normalize as __normalizeForTests };
