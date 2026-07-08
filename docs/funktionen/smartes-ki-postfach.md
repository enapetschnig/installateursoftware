# Smartes KI-Postfach (E-Mail-Eingang → KI-Triage)
> Holt eingehende E-Mails per IMAP ab, lässt **jede** Mail von der KI lesen und ordnet sie automatisch zu: Kundenanfragen landen im **Posteingang „Anfragen"** und auf der **Startseite**, Eingangsrechnungen werden für die **Buchhaltung** vorbereitet.

## Für Anwender

**Was kann die Funktion?**
Das Firmenpostfach (z. B. `software@…`) wird automatisch überwacht. Jede neue E-Mail wird von der KI gelesen und eingeordnet:
- **Kundenanfrage** (Anfrage, Terminwunsch, Angebot erbeten, Reklamation, Rückruf) → erscheint sofort unter **Anfragen** und als Karte **„Neue Anfragen"** auf der **Startseite** – jeweils mit **KI-Kurzzusammenfassung**, erkannter Priorität und Absenderdaten.
- **Eingangsrechnung** (ein Lieferant stellt dem Betrieb etwas in Rechnung) → wird erkannt, Lieferant/Rechnungsnummer/Betrag/Fälligkeit/IBAN werden vorab extrahiert und für das **Buchhaltungsmodul** bereitgestellt (Ausbau in Phase 2).
- **Angebot vom Lieferant / Spam / Sonstiges** → wird protokolliert, aber nicht weitergeleitet.

**Bedienung**
- Läuft **automatisch** im Hintergrund (geplanter Abruf alle ~15 Min über Vercel Cron).
- **Manuell**: auf der Seite **Anfragen** oben rechts **„Postfach abrufen"** klicken → holt sofort neue Mails und ordnet sie ein. Eine kurze Rückmeldung nennt, wie viele Mails verarbeitet und wie sie verteilt wurden.
- Verarbeitete Mails werden im Postfach als **gelesen** markiert (so sieht man, was die App schon bearbeitet hat). Es wird **nichts gelöscht oder verschoben**.

**Wichtige Einstellungen (pro Firma)**
Postfach-Zugang (IMAP/SMTP-Host, Benutzer, Passwort) sowie KI-Schlüssel liegen als **Umgebungsvariablen** (nie im Code). Die Zuordnungs-Logik ist mandantenneutral – jede Firma kann ihr eigenes Postfach anbinden.

## Technik

**Ablauf (Pipeline)**
IMAP (ungelesene Mails) → `mailparser` → **KI-Klassifizierung** (eine OpenAI-Anfrage je Mail) → `incoming_mails` (Roh-/Audit-Log, Idempotenz) → bei Kundenanfrage zusätzlich `anfragen` (source=`email`) → Mail als `\Seen` markieren.

**Serverless-Funktionen & Libs**
- `api/mail/poll.js` – Orchestrator (Endpoint). Auth: **Cron-Secret** (`CRON_SECRET`, Vercel Cron) **oder** User-JWT (manueller Button). `maxDuration: 60`.
- `api/_lib/mail-imap.js` – IMAP via **imapflow**: `pollMailbox({limit,onMail})` holt ungelesene Mails, parst sie, markiert **nach erfolgreicher Verarbeitung** als gelesen (Fehler → bleibt ungelesen, nächster Lauf retryt). Nicht-destruktiv (kein Löschen/Verschieben). Zusätzlich `mailboxStatus()`.
- `api/_lib/mail-ai.js` – `classifyMail(mail)`: eine OpenAI-Anfrage (`gpt-4o-mini`, `response_format=json_object`) liefert `mail_class` + Zusammenfassung + Anfrage-/Rechnungsfelder, alles validiert/normalisiert.
- Frontend-Client: `src/lib/mail.ts` (`pollInbox()`, `summarizePoll()`).

**Frontend**
- **Anfragen** (`src/pages/Anfragen.tsx`): Button **„Postfach abrufen"**; E-Mail-Anfragen erscheinen mit Quelle-Badge „E-Mail" (Filter/Quelle bereits vorhanden).
- **Startseite** (`src/pages/Dashboard.tsx`): Karte **„Neue Anfragen"** (neueste 5 offene Anfragen mit KI-Zusammenfassung, Quelle, Priorität) + Zähler-Chip im Kopf. Lädt defensiv (bricht das Dashboard bei Fehler nicht ab).

**Datenbank**
- **`public.incoming_mails`** (Migration `0140_incoming_mails.sql`) – durables Log **aller** abgeholten Mails. Felder u. a.: `organization_id`, `mailbox`, `message_id`, `imap_uid`, `imap_uidvalidity`, `from_email`, `from_name`, `to_email`, `subject`, `received_at`, `body_text`, `body_snippet`, `has_attachments`, `attachments` (jsonb), `mail_class` (`kundenanfrage|rechnung|angebot|spam|sonstiges`), `ai_summary`, `ai_extracted_data` (jsonb), `ai_processed_at`, `anfrage_id`, `status` (`neu|verarbeitet|fehler|ignoriert`), `error`. **Idempotenz**: UNIQUE `(organization_id, message_id)` (Fallback UNIQUE `(organization_id, mailbox, imap_uidvalidity, imap_uid)`). **RLS** wie `anfragen` (permissive `app_all` + restrictive `org_isolation` über `current_org_id()`).
- **`public.anfragen`** – Kundenanfragen aus Mails: `source='email'`, `source_ref` = Message-ID (Idempotenz über bestehendes UNIQUE `(organization_id, source, source_ref)`), `ai_summary`/`ai_classification`/`ai_priority`/`ai_extracted_data`, voller Mailtext im `transcript` (ermöglicht manuelles Re-Enrich). Siehe [rechte-rollen.md](rechte-rollen.md), [mandantenfaehigkeit.md](mandantenfaehigkeit.md).

**Umgebungsvariablen (ENV, nie im Repo)**
`MAIL_IMAP_HOST`, `MAIL_IMAP_PORT` (993), `MAIL_IMAP_SECURE` (Default true), `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` (465), `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (schützt den Cron-Endpoint), optional `MAIL_DEFAULT_ORG_ID`/`FONIO_DEFAULT_ORG_ID`, `OPENAI_CHAT_MODEL`.

**Zeitplan (Cron)**
`vercel.json` → `crons: [{ path: "/api/mail/poll", schedule: "*/15 * * * *" }]`. Hinweis: Auf **Vercel Hobby** laufen Crons nur ~1×/Tag – für nahezu-Echtzeit **Vercel Pro** nötig; unabhängig davon funktioniert der **manuelle** Button jederzeit.

**Erweitern**
- **Buchhaltung (umgesetzt)**: Mails mit `mail_class='rechnung'` erzeugen automatisch eine **Eingangsrechnung** (`public.eingangsrechnungen`, idempotent über `incoming_mail_id`); PDF-/Bild-Anhänge werden in den `belege`-Bucket geladen und verknüpft. Details: [buchhaltung.md](buchhaltung.md).
- **Anhänge**: `api/_lib/mail-imap.js` liefert `rawAttachments` (Buffer, nie ins JSONB); `api/mail/poll.js` `uploadBelege()` lädt PDFs/Bilder org-isoliert in `belege` (`<orgId>/eingangsrechnungen/<id>/...`).
- **Weitere Quellen**: die Anfrage-Struktur ist quellenneutral (`source`), neue Kanäle analog anbinden.

**Verknüpfungen**
[email.md](email.md) (separates Microsoft-365-Mailmodul zum manuellen Lesen/Senden), [ki-assistent-isabella.md](ki-assistent-isabella.md), [sicherheit.md](sicherheit.md), [uebersicht.md](uebersicht.md).
