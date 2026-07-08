// ============================================================
// Installateur SuperAPP – E-Mail-Poller (smartes KI-Postfach)
// ------------------------------------------------------------
// Holt ungelesene E-Mails per IMAP, lässt sie von der KI klassifizieren
// und routet sie:
//   • kundenanfrage → public.anfragen (source='email') → Posteingang + Startseite
//   • rechnung      → bleibt in incoming_mails als Eingangsrechnungs-Kandidat
//                     (Buchhaltungsmodul, Phase 2 übernimmt sie)
//   • angebot/spam/sonstiges → nur Log (incoming_mails)
//
// Jede Mail landet immer als Zeile in incoming_mails (Idempotenz über
// message_id). Verarbeitete Mails werden im Postfach als \Seen markiert
// (User-Wunsch). Fehlgeschlagene bleiben ungelesen → nächster Lauf retryt.
//
// Aufruf-Wege:
//   1) Vercel Cron (GET, Header Authorization: Bearer <CRON_SECRET>)
//   2) Manuell aus der App ("Jetzt abrufen", POST, User-JWT)
//
// Konfiguration (ENV, nie im Repo): MAIL_IMAP_HOST/PORT/SECURE, MAIL_USER,
//   MAIL_PASSWORD, OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//   optional MAIL_DEFAULT_ORG_ID / FONIO_DEFAULT_ORG_ID.
// ============================================================
import { createClient } from "@supabase/supabase-js";

import { bearerFromRequest, verifyUser } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";
import { mailConfigured, pollMailbox } from "../_lib/mail-imap.js";
import { classifyMail } from "../_lib/mail-ai.js";

export const config = { maxDuration: 60 };

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://xyhgckqxowqnzjtoblfs.supabase.co";

// ── Supabase Service-Role-Client (Poller kennt keine User-Session) ──
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

// ── Auth: Cron-Secret ODER User-JWT ────────────────────────
async function authorize(req) {
  const presented = bearerFromRequest(req);
  const cronSecret = process.env.CRON_SECRET || process.env.MAIL_POLL_SECRET || "";
  if (presented && cronSecret && presented === cronSecret) {
    return { kind: "cron" };
  }
  if (presented) {
    const user = await verifyUser(presented);
    if (user) return { kind: "user", user };
  }
  return null;
}

// ── Default-Organisation ermitteln (Einzelmandant-tauglich) ──
let _cachedOrgId = null;
async function resolveOrgId(admin) {
  const env = process.env.MAIL_DEFAULT_ORG_ID || process.env.FONIO_DEFAULT_ORG_ID;
  if (typeof env === "string" && env.trim()) return env.trim();
  if (_cachedOrgId) return _cachedOrgId;
  const { data } = await admin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  _cachedOrgId = data?.id || null;
  return _cachedOrgId;
}

// ── Idempotenz: bestehende incoming_mails-Zeile finden ─────
async function findIncomingMail(admin, orgId, mail) {
  if (mail.messageId) {
    const { data } = await admin
      .from("incoming_mails")
      .select("id, status, mail_class, ai_processed_at, anfrage_id")
      .eq("organization_id", orgId)
      .eq("message_id", mail.messageId)
      .maybeSingle();
    if (data) return data;
  }
  if (mail.uid != null && mail.uidValidity != null) {
    const { data } = await admin
      .from("incoming_mails")
      .select("id, status, mail_class, ai_processed_at, anfrage_id")
      .eq("organization_id", orgId)
      .eq("mailbox", mail.mailbox || "INBOX")
      .eq("imap_uidvalidity", mail.uidValidity)
      .eq("imap_uid", mail.uid)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

function idempotencyRef(mail) {
  return mail.messageId || `imap:${mail.uidValidity ?? "x"}:${mail.uid ?? "x"}`;
}

function snippet(text, len = 280) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > len ? t.slice(0, len) + "…" : t;
}

// ── incoming_mails anlegen/aktualisieren ───────────────────
async function upsertIncomingMail(admin, orgId, mail, triage, existing) {
  const row = {
    organization_id: orgId,
    mailbox: mail.mailbox || "INBOX",
    message_id: mail.messageId || null,
    imap_uid: mail.uid ?? null,
    imap_uidvalidity: mail.uidValidity ?? null,
    from_email: mail.from?.email || null,
    from_name: mail.from?.name || null,
    to_email: mail.to?.email || null,
    subject: mail.subject || null,
    received_at: mail.date || null,
    body_text: String(mail.text || "").slice(0, 20000) || null,
    body_snippet: snippet(mail.text),
    has_attachments: (mail.attachments || []).length > 0,
    attachments: mail.attachments || [],
    mail_class: triage.mail_class,
    ai_summary: triage.summary || null,
    ai_extracted_data: buildExtracted(triage),
    ai_processed_at: new Date().toISOString(),
    status: "neu",
  };
  if (existing?.id) {
    const { error: updErr } = await admin.from("incoming_mails").update(row).eq("id", existing.id);
    if (updErr) throw new Error(`incoming_mails update: ${updErr.message}`);
    return existing.id;
  }
  const { data, error } = await admin
    .from("incoming_mails")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`incoming_mails insert: ${error.message}`);
  return data.id;
}

function buildExtracted(triage) {
  const ex = {};
  if (triage.gewerk) ex.gewerk = triage.gewerk;
  if (triage.wunschtermin) ex.wunschtermin = triage.wunschtermin;
  if (triage.address) ex.address = triage.address;
  if (triage.sender_phone) ex.phone = triage.sender_phone;
  if (triage.mail_class === "rechnung" && triage.invoice) {
    ex.invoice = triage.invoice;
  }
  return ex;
}

// ── Kundenanfrage → public.anfragen (idempotent) ───────────
async function createAnfrageFromMail(admin, orgId, mail, triage) {
  const ref = idempotencyRef(mail);
  const row = {
    organization_id: orgId,
    source: "email",
    source_ref: ref,
    status: "neu",
    caller_name: triage.sender_name || mail.from?.name || null,
    caller_email: triage.sender_email || mail.from?.email || null,
    caller_phone: triage.sender_phone || null,
    caller_address: triage.address || null,
    subject: (triage.subject || mail.subject || "(ohne Betreff)").slice(0, 200),
    description: triage.summary || snippet(mail.text, 1000) || null,
    // Voller Text im transcript → ermöglicht manuelles Re-Enrich in der UI.
    transcript: String(mail.text || "").slice(0, 20000) || null,
    ai_summary: triage.summary || null,
    ai_classification: triage.anfrage_class || null,
    ai_priority: triage.priority || null,
    ai_extracted_data: {
      ...buildExtracted(triage),
      source: "email",
      from_email: mail.from?.email || null,
      subject: mail.subject || null,
      attachments: mail.attachments || [],
    },
    raw_payload: {
      messageId: mail.messageId || null,
      from: mail.from || null,
      to: mail.to || null,
      subject: mail.subject || null,
      date: mail.date || null,
      hasHtml: mail.hasHtml || false,
      attachments: mail.attachments || [],
      mailbox: mail.mailbox || "INBOX",
      uid: mail.uid ?? null,
    },
  };
  const { data, error } = await admin
    .from("anfragen")
    .upsert(row, { onConflict: "organization_id,source,source_ref" })
    .select("id")
    .single();
  if (error) throw new Error(`anfragen upsert: ${error.message}`);

  // Audit-Event (best-effort).
  try {
    await admin.from("anfrage_events").insert({
      organization_id: orgId,
      anfrage_id: data.id,
      event_type: "created",
      note: "Aus E-Mail erstellt (smartes KI-Postfach)",
      payload: {
        source: "email",
        mail_class: triage.mail_class,
        classification: triage.anfrage_class,
        priority: triage.priority,
      },
    });
  } catch {
    /* ignore */
  }
  return data.id;
}

// ── Eingangsrechnung → public.eingangsrechnungen (idempotent) ──
const BELEGE_BUCKET = "belege";
const MAX_BELEG_BYTES = 25 * 1024 * 1024;

// Muss zur Bucket-Allowlist (Migration 0142) passen.
const ALLOWED_BELEG_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
]);
const EXT_MIME = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
};

/**
 * Ermittelt einen für den 'belege'-Bucket erlaubten Content-Type. Priorität:
 * gültiger contentType → sonst aus Dateiendung ableiten. null = überspringen.
 * (Viele Rechnungs-PDFs kommen als application/octet-stream; die Endung rettet sie.)
 */
function resolveBelegContentType(filename, contentType) {
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_BELEG_MIME.has(ct)) return ct;
  const ext = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext && EXT_MIME[ext] ? EXT_MIME[ext] : null;
}

/** Belege additiv per Pfad zusammenführen (kein Verlust manuell ergänzter Belege). */
function mergeBelegeByPath(existing, added) {
  const seen = new Set((existing || []).map((b) => b?.path).filter(Boolean));
  const out = [...(existing || [])];
  for (const b of added || []) {
    if (b?.path && !seen.has(b.path)) { seen.add(b.path); out.push(b); }
  }
  return out;
}

function safeFileName(n) {
  return (
    String(n || "beleg")
      .replace(/[/\\]/g, "_")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 120) || "beleg"
  );
}

/** Lieferant aus dem KI-Namen auflösen – nur bei GENAU einem Treffer verknüpfen. */
async function resolveSupplier(admin, orgId, name) {
  const n = String(name || "").trim();
  if (n.length < 3) return null;
  const esc = n.replace(/[%,()]/g, " ").trim();
  if (!esc) return null;
  const { data } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("type", "lieferant")
    .ilike("company", `%${esc}%`)
    .limit(2);
  return data && data.length === 1 ? data[0].id : null;
}

/** Legt (idempotent) eine Eingangsrechnung aus einer Rechnungs-Mail an. */
async function createEingangsrechnungFromMail(admin, orgId, mail, triage, mailRowId) {
  // Idempotenz: höchstens EINE Eingangsrechnung je Herkunfts-Mail.
  const { data: ex } = await admin
    .from("eingangsrechnungen")
    .select("id")
    .eq("organization_id", orgId)
    .eq("incoming_mail_id", mailRowId)
    .maybeSingle();
  if (ex?.id) return ex.id;

  const inv = triage.invoice && typeof triage.invoice === "object" ? triage.invoice : {};
  const supplierName = inv.supplier_name || mail.from?.name || mail.from?.email || null;
  const supplierContactId = supplierName ? await resolveSupplier(admin, orgId, supplierName) : null;

  const row = {
    organization_id: orgId,
    supplier_contact_id: supplierContactId,
    supplier_name: supplierName,
    invoice_number: inv.invoice_number || null,
    invoice_date: inv.invoice_date || null,
    due_date: inv.due_date || null,
    gross: typeof inv.amount_gross === "number" ? inv.amount_gross : null,
    currency: inv.currency || "EUR",
    iban: inv.iban || null,
    status: "offen",
    source: "email",
    incoming_mail_id: mailRowId,
    ai_extracted_data: inv,
    notes: triage.summary || null,
  };
  // received_date nur setzen, wenn die Mail ein Datum hat (sonst DB-Default current_date).
  if (mail.date) row.received_date = String(mail.date).slice(0, 10);

  const { data, error } = await admin
    .from("eingangsrechnungen")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`eingangsrechnungen insert: ${error.message}`);
  return data.id;
}

/** Lädt PDF-/Bild-Anhänge (Belege) in den 'belege'-Bucket. Pfad org-isoliert. */
async function uploadBelege(admin, orgId, erId, mail) {
  const raws = Array.isArray(mail.rawAttachments) ? mail.rawAttachments : [];
  const out = [];
  for (let i = 0; i < raws.length; i++) {
    const a = raws[i];
    const buf = a?.content;
    if (!Buffer.isBuffer(buf) || buf.byteLength === 0 || buf.byteLength > MAX_BELEG_BYTES) continue;
    // Inline-Grafiken (Logo/Signatur im HTML-Body) NICHT als Beleg übernehmen.
    if (a?.related === true || a?.contentDisposition === "inline") continue;
    const filename = a?.filename || `beleg-${i + 1}`;
    // Content-Type auf die Bucket-Allowlist normalisieren (octet-stream-PDFs retten,
    // Nicht-Beleg-Typen überspringen).
    const contentType = resolveBelegContentType(filename, a?.contentType);
    if (!contentType) continue;
    // Deterministischer Pfad (Index) + upsert → Retry überschreibt statt zu duplizieren.
    const path = `${orgId}/eingangsrechnungen/${erId}/${i}-${safeFileName(filename)}`;
    const { error } = await admin.storage
      .from(BELEGE_BUCKET)
      .upload(path, buf, { contentType, upsert: true });
    if (error) {
      logSafe({ action: "mail.poll.beleg", status: "error", error: error.message });
      continue;
    }
    out.push({
      path,
      filename,
      content_type: contentType,
      size: buf.byteLength,
      uploaded_at: new Date().toISOString(),
    });
  }
  return out;
}

// ── Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  const started = Date.now();
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Nur GET/POST erlaubt." });
    return;
  }

  const auth = await authorize(req);
  if (!auth) {
    res.status(401).json({ error: "Nicht autorisiert." });
    return;
  }

  if (!mailConfigured()) {
    res.status(200).json({ ok: false, reason: "not_configured", fetched: 0, message: "Postfach ist noch nicht verbunden (MAIL_* fehlen)." });
    return;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ ok: false, reason: "backend", message: "Backend nicht konfiguriert." });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.status(200).json({ ok: false, reason: "no_openai", message: "KI ist nicht verbunden (OPENAI_API_KEY fehlt)." });
    return;
  }

  let admin;
  let orgId;
  try {
    admin = getAdminClient();
    orgId = await resolveOrgId(admin);
  } catch (e) {
    logSafe({ action: "mail.poll", status: "error", error: e?.message || "init failed" });
    res.status(500).json({ ok: false, message: "Backend-Fehler." });
    return;
  }
  if (!orgId) {
    res.status(500).json({ ok: false, message: "Keine Organisation gefunden." });
    return;
  }

  const limit = Math.min(Math.max(Number(req.query?.limit) || 25, 1), 50);
  const routed = { kundenanfrage: 0, rechnung: 0, angebot: 0, spam: 0, sonstiges: 0 };

  const onMail = async (mail) => {
    const existing = await findIncomingMail(admin, orgId, mail);
    if (existing && existing.status === "verarbeitet") return true; // schon erledigt → seen

    let triage;
    let mailRowId = existing?.id || null;
    try {
      triage = await classifyMail(mail);
      mailRowId = await upsertIncomingMail(admin, orgId, mail, triage, existing);

      let anfrageId = existing?.anfrage_id || null;
      if (triage.mail_class === "kundenanfrage" && !anfrageId) {
        anfrageId = await createAnfrageFromMail(admin, orgId, mail, triage);
      }

      // Eingangsrechnung → direkt ins Buchhaltungsmodul (inkl. Beleg-PDF).
      if (triage.mail_class === "rechnung") {
        const erId = await createEingangsrechnungFromMail(admin, orgId, mail, triage, mailRowId);
        const uploaded = await uploadBelege(admin, orgId, erId, mail);
        if (uploaded.length) {
          // Bestehende Belege additiv mergen (Reprocess/manuelle Belege nicht überschreiben).
          const { data: cur } = await admin
            .from("eingangsrechnungen").select("belege").eq("id", erId).maybeSingle();
          const merged = mergeBelegeByPath(cur?.belege || [], uploaded);
          const { error: erErr } = await admin
            .from("eingangsrechnungen").update({ belege: merged }).eq("id", erId);
          if (erErr) throw new Error(`eingangsrechnungen belege: ${erErr.message}`);
          // incoming_mails.attachments mit Storage-Pfaden anreichern (Audit/Nachvollzug).
          const { error: imErr } = await admin
            .from("incoming_mails").update({ attachments: uploaded }).eq("id", mailRowId);
          if (imErr) throw new Error(`incoming_mails attachments: ${imErr.message}`);
        }
      }

      const { error: statusErr } = await admin
        .from("incoming_mails")
        .update({
          status: "verarbeitet",
          anfrage_id: anfrageId,
        })
        .eq("id", mailRowId);
      if (statusErr) throw new Error(`incoming_mails verarbeitet: ${statusErr.message}`);

      routed[triage.mail_class] = (routed[triage.mail_class] || 0) + 1;
      return true; // Erfolg → als gelesen markieren
    } catch (e) {
      // Fehler festhalten (sichtbar), Mail ungelesen lassen (Retry nächster Lauf).
      try {
        if (mailRowId) {
          await admin
            .from("incoming_mails")
            .update({ status: "fehler", error: String(e?.message || e).slice(0, 500) })
            .eq("id", mailRowId);
        }
      } catch {
        /* ignore */
      }
      throw e;
    }
  };

  try {
    const summary = await pollMailbox({ limit, onMail });
    logSafe({
      action: "mail.poll",
      status: "ok",
      durationMs: Date.now() - started,
      extra: { actor: auth.kind, ...summary, routed },
    });
    res.status(200).json({ ok: true, ...summary, routed });
  } catch (e) {
    logSafe({ action: "mail.poll", status: "error", error: e?.message || "poll failed" });
    res.status(502).json({ ok: false, message: "Abruf fehlgeschlagen. Bitte später erneut versuchen." });
  }
}
