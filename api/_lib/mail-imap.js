// ============================================================
// Installateur SuperAPP – IMAP-Abholung (smartes KI-Postfach)
// ------------------------------------------------------------
// Holt ungelesene E-Mails per IMAP (imapflow) aus dem konfigurierten
// Postfach (software@…, kasserver/All-Inkl) und parst sie (mailparser).
//
// Sicherheit / Nicht-destruktiv:
//   • Es wird NUR gelesen. Mails werden NICHT gelöscht/verschoben.
//   • \Seen wird erst gesetzt, wenn der Aufrufer (Poller) die Mail
//     erfolgreich verarbeitet hat (onMail → truthy) – ein Fehler in
//     KI/DB lässt die Mail ungelesen, sie wird beim nächsten Lauf erneut
//     versucht (kein Datenverlust).
//
// Konfiguration ausschließlich über ENV (nie im Repo):
//   MAIL_IMAP_HOST, MAIL_IMAP_PORT (Default 993), MAIL_IMAP_SECURE
//   (Default true), MAIL_USER, MAIL_PASSWORD
// ============================================================
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/** Liest die Postfach-Konfiguration aus den Umgebungsvariablen. */
export function getMailConfig() {
  const host = (process.env.MAIL_IMAP_HOST || "").trim();
  const port = Number(process.env.MAIL_IMAP_PORT || 993);
  const user = (process.env.MAIL_USER || "").trim();
  const pass = process.env.MAIL_PASSWORD || "";
  const secure = String(process.env.MAIL_IMAP_SECURE ?? "true").toLowerCase() !== "false";
  return { host, port, user, pass, secure };
}

/** True, wenn IMAP grundsätzlich konfiguriert ist (Host+User+Passwort). */
export function mailConfigured() {
  const c = getMailConfig();
  return Boolean(c.host && c.user && c.pass);
}

/** Erste Absender-/Empfängeradresse aus einem mailparser-Adressobjekt. */
function firstAddr(addr) {
  const first = addr && Array.isArray(addr.value) ? addr.value[0] : null;
  return {
    name: (first && first.name ? String(first.name) : "").trim(),
    email: (first && first.address ? String(first.address) : "").trim().toLowerCase(),
  };
}

/** Parst eine RFC822-Quelle in ein normalisiertes Mail-Objekt. */
async function parseSource(source) {
  const parsed = await simpleParser(source);
  const from = firstAddr(parsed.from);
  const to = firstAddr(parsed.to);
  const text = String(parsed.text || "").trim();
  const subject = String(parsed.subject || "").trim();
  // rawAttachments behält den Node-Buffer (a.content) für den Upload in den
  // Belege-Bucket. attachments ist metadaten-only und geht in DB/JSONB/KI –
  // der Buffer darf dort NIE landen (würde die Zeile massiv aufblähen).
  const rawAttachments = (parsed.attachments || []).filter(
    (a) => a && (a.filename || a.contentType),
  );
  const attachments = rawAttachments.map((a) => ({
    filename: a.filename || "unbenannt",
    contentType: a.contentType || "application/octet-stream",
    size: Number(a.size || (a.content ? a.content.length : 0)) || 0,
  }));
  return {
    messageId: parsed.messageId ? String(parsed.messageId) : null,
    from,
    to,
    subject,
    date: parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime())
      ? parsed.date.toISOString()
      : null,
    text,
    hasHtml: Boolean(parsed.html),
    attachments,
    rawAttachments,
  };
}

/** Baut einen ImapFlow-Client aus der ENV-Konfiguration. */
function buildClient() {
  const cfg = getMailConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("MAIL_* Umgebungsvariablen fehlen (MAIL_IMAP_HOST/MAIL_USER/MAIL_PASSWORD).");
  }
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // Verbindungs-Timeouts defensiv setzen (Serverless-Funktion, max ~60s).
    socketTimeout: 45000,
    greetingTimeout: 15000,
    connectionTimeout: 15000,
  });
}

/**
 * Postfach-Status (leichtgewichtig) für den "Jetzt abrufen"-Button/Statuskarte.
 * Verbindet, öffnet INBOX read-only, liefert { ok, exists, unseen }.
 */
export async function mailboxStatus({ mailbox = "INBOX" } = {}) {
  const client = buildClient();
  await client.connect();
  try {
    const status = await client.status(mailbox, { messages: true, unseen: true });
    return {
      ok: true,
      exists: Number(status.messages || 0),
      unseen: Number(status.unseen || 0),
    };
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Holt ungelesene Mails und ruft für jede `onMail(mail)` auf.
 * Gibt onMail truthy zurück, wird die Mail als \Seen markiert (User-Wunsch:
 * "verarbeitete Mails als gelesen markieren"). Bei Fehler/false bleibt sie
 * ungelesen und wird beim nächsten Lauf erneut versucht.
 *
 * @param {object} opts
 * @param {number} [opts.limit=25]  Max. Mails pro Lauf (Serverless-Zeitbudget).
 * @param {(mail:object)=>Promise<boolean>|boolean} opts.onMail  Verarbeitungs-Callback.
 * @param {string} [opts.mailbox="INBOX"]
 * @returns {Promise<{fetched:number,processed:number,markedSeen:number,errors:number}>}
 */
export async function pollMailbox({ limit = 25, onMail, mailbox = "INBOX" } = {}) {
  if (typeof onMail !== "function") {
    throw new Error("pollMailbox: onMail-Callback ist erforderlich.");
  }
  const client = buildClient();
  const summary = { fetched: 0, processed: 0, markedSeen: 0, errors: 0 };

  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uidValidity =
        client.mailbox && client.mailbox.uidValidity != null
          ? Number(client.mailbox.uidValidity)
          : null;

      // Nur UNGELESENE Mails (nicht-destruktiv, keine Löschung/Verschiebung).
      const uids = await client.search({ seen: false }, { uid: true });
      const take = (Array.isArray(uids) ? uids : []).slice(0, Math.max(1, limit));

      for (const uid of take) {
        summary.fetched += 1;
        let mail;
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          mail = await parseSource(msg.source);
          mail.uid = Number(uid);
          mail.uidValidity = uidValidity;
          mail.mailbox = mailbox;
        } catch {
          summary.errors += 1;
          continue; // Parse-/Fetch-Fehler: Mail bleibt ungelesen, nächster Lauf versucht erneut.
        }

        let markSeen = false;
        try {
          markSeen = await onMail(mail);
          summary.processed += 1;
        } catch {
          summary.errors += 1;
          markSeen = false; // Verarbeitungsfehler → ungelesen lassen (Retry).
        }

        if (markSeen) {
          try {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            summary.markedSeen += 1;
          } catch {
            /* Flag-Setzen best-effort – kein Abbruch. */
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return summary;
}
