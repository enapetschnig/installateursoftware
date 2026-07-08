-- ============================================================
-- Installateur SuperAPP – Migration 0140
-- Eingehende E-Mails (Smartes KI-Postfach) – durables Mail-Log
-- ------------------------------------------------------------
-- Zweck:
--   Zentraler, mandantenfähiger Rohspeicher ALLER per IMAP abgeholten
--   E-Mails (software@… Postfach). Jede Mail wird genau EINMAL verarbeitet
--   (Idempotenz über message_id) und von der KI klassifiziert:
--     - kundenanfrage → wird zusätzlich in public.anfragen angelegt
--                       (source='email') und erscheint im Posteingang +
--                       auf der Startseite (smartes KI-Postfach).
--     - rechnung      → bleibt hier als Eingangsrechnungs-Kandidat liegen
--                       und wird in Phase 2 vom Buchhaltungsmodul übernommen.
--     - angebot / spam / sonstiges → nur Log, keine Weiterleitung.
--
--   WICHTIG: Diese Tabelle ist die EINE Quelle der Wahrheit dafür, welche
--   Mail bereits abgeholt/verarbeitet wurde. Der IMAP-Poller darf niemals
--   dieselbe Mail doppelt in anfragen/Buchhaltung schreiben – der
--   UNIQUE(organization_id, message_id) + upsert(onConflict) garantiert das.
--
-- Mandantenfähigkeit:
--   organization_id NOT NULL DEFAULT public.current_org_id(); Insert läuft
--   serverseitig über Service-Role (IMAP-Poller kennt keine User-Session),
--   daher wird organization_id beim Insert explizit gesetzt.
--
-- RLS (Post-0063-Standard, exakt wie public.anfragen):
--   permissive  incoming_mails_app_all      (authenticated, using/check true)
--   restrictive incoming_mails_org_isolation (organization_id = current_org_id())
-- ============================================================

-- ── 1) Tabelle ─────────────────────────────────────────────
create table if not exists public.incoming_mails (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.current_org_id()
                      references public.organizations(id) on delete cascade,

  -- IMAP-/RFC-Identität (Idempotenz)
  mailbox           text not null default 'INBOX',
  message_id        text,                 -- RFC5322 Message-ID (Idempotenz-Schlüssel)
  imap_uid          bigint,               -- IMAP UID (nur Referenz/Debug)
  imap_uidvalidity  bigint,               -- UIDVALIDITY zur UID (nur Referenz)

  -- Kopf-/Absenderdaten
  from_email        text,
  from_name         text,
  to_email          text,
  subject           text,
  received_at       timestamptz,          -- Date-Header der Mail

  -- Inhalt (Text bewusst begrenzt gespeichert – kein Voll-HTML)
  body_text         text,
  body_snippet      text,
  has_attachments   boolean not null default false,
  attachments       jsonb not null default '[]'::jsonb,   -- [{filename,contentType,size}]

  -- KI-Triage (Mail-Ebene)
  mail_class        text,                 -- kundenanfrage | rechnung | angebot | spam | sonstiges
  ai_summary        text,
  ai_extracted_data jsonb not null default '{}'::jsonb,
  ai_processed_at   timestamptz,

  -- Verknüpfung / Verarbeitungsstatus
  anfrage_id        uuid references public.anfragen(id) on delete set null,
  status            text not null default 'neu',   -- neu | verarbeitet | fehler | ignoriert
  error             text,

  raw_headers       jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint incoming_mails_mail_class_check check (
    mail_class is null or mail_class = any (array[
      'kundenanfrage','rechnung','angebot','spam','sonstiges'
    ])
  ),
  constraint incoming_mails_status_check check (
    status = any (array['neu','verarbeitet','fehler','ignoriert'])
  )
);

comment on table public.incoming_mails is
  'Rohspeicher aller per IMAP abgeholten E-Mails (smartes KI-Postfach). Idempotenz über UNIQUE(organization_id,message_id). Kundenanfragen werden nach public.anfragen weitergeleitet, Rechnungen in Phase 2 vom Buchhaltungsmodul übernommen.';
comment on column public.incoming_mails.organization_id is
  'Mandanten-ID. Beim Service-Role-Insert vom Poller explizit gesetzt (Default current_org_id() nur für App-Kontext).';
comment on column public.incoming_mails.message_id is
  'RFC5322 Message-ID – Idempotenz-Schlüssel. Verhindert Doppelverarbeitung derselben Mail.';
comment on column public.incoming_mails.mail_class is
  'KI-Klassifizierung auf Mail-Ebene: kundenanfrage → anfragen; rechnung → Buchhaltung (Phase 2); angebot/spam/sonstiges → nur Log.';
comment on column public.incoming_mails.anfrage_id is
  'Gesetzt, sobald aus dieser Mail eine Anfrage (public.anfragen) erzeugt wurde.';

-- ── 2) Idempotenz + Indizes ────────────────────────────────
-- Doppelverarbeitung ausschließen: eine Message-ID je Mandant nur einmal.
-- (Mails ohne Message-ID sind selten; für diese greift der Poller auf
--  imap_uid+uidvalidity als Fallback-Schlüssel zurück.)
create unique index if not exists incoming_mails_org_msgid_uq
  on public.incoming_mails (organization_id, message_id)
  where message_id is not null;

create unique index if not exists incoming_mails_org_uid_uq
  on public.incoming_mails (organization_id, mailbox, imap_uidvalidity, imap_uid)
  where message_id is null and imap_uid is not null;

create index if not exists incoming_mails_org_created_idx
  on public.incoming_mails (organization_id, created_at desc);
create index if not exists incoming_mails_org_class_idx
  on public.incoming_mails (organization_id, mail_class);
create index if not exists incoming_mails_org_status_idx
  on public.incoming_mails (organization_id, status);

-- ── 3) updated_at-Touch ────────────────────────────────────
create or replace function public.tg_incoming_mails_touch()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_incoming_mails_touch on public.incoming_mails;
create trigger trg_incoming_mails_touch
  before update on public.incoming_mails
  for each row execute function public.tg_incoming_mails_touch();

-- ── 4) Row-Level-Security (Post-0063-Standard, wie public.anfragen) ──
alter table public.incoming_mails enable row level security;

drop policy if exists incoming_mails_app_all on public.incoming_mails;
create policy incoming_mails_app_all
  on public.incoming_mails
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists incoming_mails_org_isolation on public.incoming_mails;
create policy incoming_mails_org_isolation
  on public.incoming_mails
  as restrictive
  for all to authenticated
  using  (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

grant select, insert, update on public.incoming_mails to authenticated;
