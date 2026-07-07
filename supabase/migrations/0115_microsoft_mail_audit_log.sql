-- ============================================================
-- B4Y SuperAPP – Migration 0115
-- Microsoft Graph Mail: Audit-Log (Sende-Historie)
-- ------------------------------------------------------------
-- Persistiert jeden Mail-Sendevorgang via Microsoft Graph fuer Compliance,
-- Nachvollziehbarkeit und Org-Admin-Reporting. Mandantenfaehig
-- (organization_id NOT NULL DEFAULT current_org_id()) mit RESTRICTIVE
-- org_isolation gemaess Post-0063-Standard (KEINE NULL-Klausel).
--
-- DSGVO-Hinweis (wichtig):
--   - Der Mail-Body wird NIEMALS in dieser Tabelle persistiert.
--   - body_preview ist eine Vorschau auf max. 500 Zeichen (DSGVO-light)
--     und nur fuer Audit-/Recherche-Zwecke (z. B. "Welche Mail gehoert zu
--     diesem Angebot?"). Persistente Aufbewahrung des Originalbodys
--     erfolgt durch Microsoft Graph im Postausgang/Gesendete-Ordner des
--     Nutzers – nicht durch uns.
--   - recipient_to/cc/bcc enthalten reine Empfaenger-Adressen
--     (Roh-Werte aus der Sendeanfrage, ohne Display-Namen). Loesch-
--     wuensche koennen pro Zeile via DELETE umgesetzt werden.
--
-- RLS-Modell:
--   app_all (true/true) + RESTRICTIVE org_isolation auf organization_id.
--   Bewusst KEINE user_id-Einschraenkung: Org-Admin/Buchhaltung muessen
--   alle Sendungen ihrer Organisation einsehen koennen. Feinere Sicht-
--   barkeit (z. B. nur eigene Mails) wird auf der App-/Permission-Ebene
--   geregelt (siehe Migration 0078 email-Permission-Module).
--
-- Idempotenz: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS, analog
-- zu 0085 / 0114. Re-Run sicher.
-- ============================================================

create table if not exists public.microsoft_mail_audit_log (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default public.current_org_id()
                          references public.organizations(id) on delete cascade,
  user_id               uuid references auth.users(id) on delete set null,

  -- Art des Vorgangs. 'failed' wird auch dann eingetragen, wenn Graph
  -- einen Fehler liefert – fuer Debugging + Retry-Statistik.
  action                text not null
                          check (action in ('sent','failed','reply','forward')),

  -- Empfaenger-Listen (Roh-Adressen, kein Display-Name). Arrays statt
  -- jsonb fuer einfache SQL-Filterung (= ANY(...)).
  recipient_to          text[],
  recipient_cc          text[],
  recipient_bcc         text[],

  subject               text,

  -- DSGVO: Body-Vorschau auf max. 500 Zeichen begrenzt. Body selbst wird
  -- NIEMALS persistiert (siehe Header-Kommentar).
  body_preview          text
                          check (body_preview is null or length(body_preview) <= 500),

  attachment_count      int not null default 0,

  -- Microsoft Graph Message-ID des gesendeten Items (im Ordner
  -- 'Gesendete Objekte' des Postfachs); leer bei 'failed'.
  microsoft_message_id  text,

  -- Optionale Verknuepfungen zum Dokument-Kontext (Mail aus Angebot,
  -- Auftrag oder Rechnung heraus versandt). on delete set null, damit
  -- der Audit-Eintrag das Loeschen des Dokuments ueberlebt (Audit-Trail).
  related_offer_id      uuid references public.offers(id)   on delete set null,
  related_order_id      uuid references public.orders(id)   on delete set null,
  related_invoice_id    uuid references public.invoices(id) on delete set null,

  -- Fehlerdetails (nur bei action='failed'). Inhalt: Graph-API-Fehlertext
  -- oder lokale Validierungs-Message.
  error_message         text,

  -- End-to-End-Dauer in Millisekunden (App -> Graph -> 202 Accepted).
  duration_ms           int,

  sent_at               timestamptz not null default now()
);

-- ---------- Indices ----------
-- Listen-/Reporting-Index: Org-weit chronologisch absteigend.
create index if not exists idx_ms_mail_audit_org_sent
  on public.microsoft_mail_audit_log (organization_id, sent_at desc);

-- Partielle Indices fuer Doku-Bezug (typischer Use-Case: "alle Mails zu
-- diesem Angebot/Auftrag/Rechnung"). Partial spart Platz, da der
-- Grossteil keinen Bezug hat.
create index if not exists idx_ms_mail_audit_offer
  on public.microsoft_mail_audit_log (related_offer_id)
  where related_offer_id is not null;

create index if not exists idx_ms_mail_audit_order
  on public.microsoft_mail_audit_log (related_order_id)
  where related_order_id is not null;

create index if not exists idx_ms_mail_audit_invoice
  on public.microsoft_mail_audit_log (related_invoice_id)
  where related_invoice_id is not null;

-- ---------- RLS ----------
alter table public.microsoft_mail_audit_log enable row level security;

drop policy if exists microsoft_mail_audit_log_app_all on public.microsoft_mail_audit_log;
create policy microsoft_mail_audit_log_app_all
  on public.microsoft_mail_audit_log
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists microsoft_mail_audit_log_org_isolation on public.microsoft_mail_audit_log;
create policy microsoft_mail_audit_log_org_isolation
  on public.microsoft_mail_audit_log
  as restrictive
  for all to authenticated
  using       (organization_id = public.current_org_id())
  with check  (organization_id = public.current_org_id());

-- ---------- Kommentare (Self-Documenting Schema) ----------
comment on table public.microsoft_mail_audit_log is
  'Audit-Log aller via Microsoft Graph versendeten Mails (sent/failed/reply/forward). DSGVO: Body selbst wird NIEMALS gespeichert, nur body_preview (max. 500 Zeichen). Mandantenfaehig (org_isolation RESTRICTIVE). Sichtbarkeit org-weit (Org-Admin/Buchhaltung), feinere Filter via App-Permission-Layer.';

comment on column public.microsoft_mail_audit_log.organization_id is
  'Mandanten-Zuordnung (default current_org_id()). RESTRICTIVE Policy erzwingt Mandantentrennung.';
comment on column public.microsoft_mail_audit_log.user_id is
  'Absender (auth.users). Bei User-Loeschung NULL, Audit-Eintrag bleibt erhalten.';
comment on column public.microsoft_mail_audit_log.action is
  'Art des Vorgangs: sent (Erstversand), failed (Sendung fehlgeschlagen), reply (Antwort), forward (Weiterleitung).';
comment on column public.microsoft_mail_audit_log.recipient_to is
  'TO-Empfaenger (Roh-Adressen, ohne Display-Name).';
comment on column public.microsoft_mail_audit_log.recipient_cc is
  'CC-Empfaenger (Roh-Adressen, ohne Display-Name).';
comment on column public.microsoft_mail_audit_log.recipient_bcc is
  'BCC-Empfaenger (Roh-Adressen, ohne Display-Name).';
comment on column public.microsoft_mail_audit_log.subject is
  'Mail-Betreff (vollstaendig).';
comment on column public.microsoft_mail_audit_log.body_preview is
  'DSGVO-light Vorschau auf max. 500 Zeichen. Der vollstaendige Body wird NIEMALS persistiert; Originalbody liegt ausschliesslich im Microsoft-Graph-Postfach (Ordner "Gesendete Objekte") des Nutzers.';
comment on column public.microsoft_mail_audit_log.attachment_count is
  'Anzahl Anhaenge zum Sendezeitpunkt (keine Dateien gespeichert).';
comment on column public.microsoft_mail_audit_log.microsoft_message_id is
  'Microsoft Graph Message-ID des gesendeten Items im Postfach. NULL bei action=failed.';
comment on column public.microsoft_mail_audit_log.related_offer_id is
  'Optionaler Bezug zum Angebot, aus dessen Kontext die Mail versandt wurde. on delete set null = Audit-Eintrag ueberlebt das Loeschen des Angebots.';
comment on column public.microsoft_mail_audit_log.related_order_id is
  'Optionaler Bezug zum Auftrag, aus dessen Kontext die Mail versandt wurde. on delete set null = Audit-Eintrag ueberlebt das Loeschen des Auftrags.';
comment on column public.microsoft_mail_audit_log.related_invoice_id is
  'Optionaler Bezug zur Rechnung, aus deren Kontext die Mail versandt wurde. on delete set null = Audit-Eintrag ueberlebt das Loeschen der Rechnung.';
comment on column public.microsoft_mail_audit_log.error_message is
  'Fehlertext bei action=failed (Graph-API-Response oder lokale Validierung). Sonst NULL.';
comment on column public.microsoft_mail_audit_log.duration_ms is
  'End-to-End-Dauer des Sendevorgangs in Millisekunden (App-Request bis Graph-202).';
comment on column public.microsoft_mail_audit_log.sent_at is
  'Zeitpunkt des Sendeversuchs (default now()). Index-Spalte fuer chronologisches Reporting.';
