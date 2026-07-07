-- ============================================================
-- B4Y SuperAPP – Migration 0117
-- Anfragen (Inbound Requests) – Posteingang für eingehende Anliegen
-- ------------------------------------------------------------
-- Zweck:
--   Zentrale, mandantenfähige Erfassung aller eingehenden Anfragen
--   ("Posteingang"), egal über welchen Kanal sie hereinkommen:
--     - phone_fonio  (Wiener KI-Telefonassistent fonio.ai, Post-Call-Webhook)
--     - website_form (Kontaktformular)
--     - email        (Inbox-Funneling)
--     - manual       (Mitarbeiter trägt händisch ein)
--     - instagram / facebook / whatsapp / other (Social-Channels für später)
--
--   WICHTIG (User-Anforderung): ALLE Fonio-Anrufe MÜSSEN sichtbar sein,
--   auch info_only / spam / fehlanruf. Die UI filtert später anhand
--   status / ai_classification (nicht durch Verwerfen am Ingest).
--
-- Lifecycle:
--   neu → in_arbeit → qualifiziert → kontakt_erstellt
--                                  → abgewiesen / archiviert
--
--   Beim Wechsel auf "kontakt_erstellt" mit gesetztem related_contact_id
--   wird converted_to_contact_at automatisch vom Updated-At-Trigger gesetzt.
--
-- Idempotenz:
--   * CREATE TABLE IF NOT EXISTS
--   * CREATE INDEX IF NOT EXISTS
--   * Trigger/Policies DROP+CREATE
--   * UNIQUE-Constraint (org, source, source_ref) WHERE source_ref IS NOT NULL
--     idempotent via guarded DO-Block.
--
-- Mandantenfähigkeit (Post-0063-Standard):
--   * organization_id NOT NULL DEFAULT public.current_org_id()
--   * RESTRICTIVE Policy ohne `or organization_id is null`.
-- ============================================================

-- ============================================================
-- 1) Tabelle: anfragen
-- ============================================================
create table if not exists public.anfragen (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,

  -- ── Quelle / Eingangskanal ─────────────────────────────────
  source text not null
    check (source in (
      'phone_fonio',
      'website_form',
      'email',
      'manual',
      'instagram',
      'facebook',
      'whatsapp',
      'other'
    )),

  -- Externe ID (z.B. Fonio call_id) für Webhook-Idempotenz.
  -- NULL für manuell erfasste Anfragen.
  source_ref text,

  -- ── Status / Bearbeitung ───────────────────────────────────
  status text not null default 'neu'
    check (status in (
      'neu',
      'in_arbeit',
      'qualifiziert',
      'kontakt_erstellt',
      'abgewiesen',
      'archiviert'
    )),

  assigned_to uuid references auth.users(id) on delete set null,

  -- ── Anrufer-/Absender-Stammdaten (Snapshot, nicht normalisiert) ─
  caller_name    text,
  caller_phone   text,
  caller_email   text,
  caller_address text,

  -- ── Inhalt ─────────────────────────────────────────────────
  subject     text,
  description text,

  -- ── Telefon-spezifische Felder (phone_fonio) ───────────────
  transcript       text,
  audio_url        text,
  duration_seconds integer,
  call_direction   text
    check (call_direction is null or call_direction in ('inbound', 'outbound')),
  call_started_at  timestamptz,
  call_ended_at    timestamptz,

  -- ── KI-Anreicherung (Fonio liefert das, manual kann es leer lassen) ─
  ai_summary text,

  ai_classification text
    check (ai_classification is null or ai_classification in (
      'interessent',
      'kunde_bestand',
      'spam',
      'termine_anfrage',
      'reklamation',
      'info_only',
      'rueckruf_gewuenscht',
      'fehlanruf',
      'sonstiges'
    )),

  ai_priority text
    check (ai_priority is null or ai_priority in ('hoch', 'mittel', 'niedrig')),

  -- Strukturierte Extraktion (Fonio extractionData o.ä.)
  ai_extracted_data jsonb not null default '{}'::jsonb,

  -- ── Verknüpfungen (nachgelagert, wenn qualifiziert/konvertiert) ─
  related_contact_id uuid references public.contacts(id) on delete set null,
  related_project_id uuid references public.projects(id) on delete set null,

  -- Zeitpunkt der Konvertierung in einen Kontakt (vom Trigger gesetzt).
  converted_to_contact_at timestamptz,

  -- ── Audit / Rohdaten ───────────────────────────────────────
  raw_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2) Spalten-/Tabellen-Kommentare
-- ============================================================
comment on table public.anfragen is
  'Posteingang für alle eingehenden Anfragen (phone_fonio, website_form, email, manual, social). Mandantenfähig (Post-0063). Auch Spam/Info/Fehlanrufe werden persistiert – UI filtert via status/ai_classification.';

comment on column public.anfragen.organization_id is
  'Mandanten-ID (mandantenfähige Isolation via RESTRICTIVE Policy + current_org_id()).';
comment on column public.anfragen.source is
  'Eingangskanal. Aktuell aktiv: phone_fonio, manual. website_form/email/social vorbereitet.';
comment on column public.anfragen.source_ref is
  'Externe Referenz-ID des Quellsystems (z.B. Fonio call_id). Für Webhook-Idempotenz – siehe UNIQUE (organization_id, source, source_ref).';
comment on column public.anfragen.status is
  'Lifecycle: neu → in_arbeit → qualifiziert → kontakt_erstellt | abgewiesen | archiviert.';
comment on column public.anfragen.assigned_to is
  'Optionaler Bearbeiter (auth.users.id). NULL = unzugewiesen.';
comment on column public.anfragen.caller_name is
  'Name des Anrufers/Absenders (Snapshot, kein FK – Roh-Lead vor Kontakt-Anlage).';
comment on column public.anfragen.caller_phone is
  'Telefonnummer des Anrufers/Absenders (Snapshot, E.164 empfohlen).';
comment on column public.anfragen.caller_email is
  'E-Mail-Adresse des Anrufers/Absenders (Snapshot).';
comment on column public.anfragen.caller_address is
  'Adress-Freitext des Anrufers/Absenders (Snapshot).';
comment on column public.anfragen.subject is
  'Kurzbetreff der Anfrage (z.B. "Dachreparatur Anfrage").';
comment on column public.anfragen.description is
  'Freitext-Beschreibung der Anfrage. Bei Telefon: Zusammenfassung des Anliegens.';
comment on column public.anfragen.transcript is
  'Volltranskript bei phone_fonio (Whisper-Output von Fonio).';
comment on column public.anfragen.audio_url is
  'URL zur Anruf-Audio-Datei (Fonio-Hosting oder eigenes Storage).';
comment on column public.anfragen.duration_seconds is
  'Anrufdauer in Sekunden (nur phone_fonio).';
comment on column public.anfragen.call_direction is
  'Anrufrichtung: inbound (Standard für Fonio) / outbound. NULL bei non-phone-Quellen.';
comment on column public.anfragen.call_started_at is
  'Anrufbeginn (UTC). NULL bei non-phone-Quellen.';
comment on column public.anfragen.call_ended_at is
  'Anrufende (UTC). NULL bei non-phone-Quellen.';
comment on column public.anfragen.ai_summary is
  'KI-generierte Zusammenfassung der Anfrage (Fonio liefert sie post-call).';
comment on column public.anfragen.ai_classification is
  'KI-Klassifikation. Auch spam/info_only/fehlanruf werden persistiert (User-Anforderung: alle Anrufe sichtbar).';
comment on column public.anfragen.ai_priority is
  'KI-Priorität: hoch/mittel/niedrig. NULL = keine KI-Bewertung.';
comment on column public.anfragen.ai_extracted_data is
  'Strukturierte KI-Extraktion (Fonio extractionData o.ä.) – frei strukturierbar.';
comment on column public.anfragen.related_contact_id is
  'Optional verknüpfter Kontakt (FK contacts). Wird gesetzt sobald aus Anfrage ein Kontakt entstanden ist.';
comment on column public.anfragen.related_project_id is
  'Optional verknüpftes Projekt (FK projects). Falls Anfrage konkret zu einem existierenden Projekt gehört.';
comment on column public.anfragen.converted_to_contact_at is
  'Zeitpunkt der Konvertierung in einen Kontakt – wird vom Trigger automatisch gesetzt, wenn status=kontakt_erstellt + related_contact_id gefüllt.';
comment on column public.anfragen.raw_payload is
  'Vollständiger Webhook-Body / Roh-Eingabe der Quelle (Audit-Trail, nie löschen).';
comment on column public.anfragen.created_at is
  'Erstellungszeitpunkt (UTC). Bei Fonio = Zeitpunkt der Webhook-Verarbeitung, nicht des Anrufs.';
comment on column public.anfragen.updated_at is
  'Letzte Änderung (UTC), via Trigger automatisch gesetzt.';

-- ============================================================
-- 3) UNIQUE-Constraint für Webhook-Idempotenz
-- ------------------------------------------------------------
-- Partial-Unique-Index: nur wenn source_ref gesetzt ist
-- (manual-Anfragen haben kein source_ref und sind nicht eindeutig).
-- Implementiert als UNIQUE INDEX, idempotent via IF NOT EXISTS.
-- ============================================================
create unique index if not exists anfragen_org_source_ref_uk
  on public.anfragen (organization_id, source, source_ref)
  where source_ref is not null;

-- ============================================================
-- 4) Indices
-- ============================================================
create index if not exists idx_anfragen_org_created
  on public.anfragen (organization_id, created_at desc);

create index if not exists idx_anfragen_org_status
  on public.anfragen (organization_id, status);

create index if not exists idx_anfragen_source
  on public.anfragen (source);

create index if not exists idx_anfragen_assigned_to
  on public.anfragen (assigned_to)
  where assigned_to is not null;

create index if not exists idx_anfragen_related_contact
  on public.anfragen (related_contact_id)
  where related_contact_id is not null;

create index if not exists idx_anfragen_org_ai_classification
  on public.anfragen (organization_id, ai_classification)
  where ai_classification is not null;

-- ============================================================
-- 5) Updated-At-Trigger + Auto-Set von converted_to_contact_at
-- ------------------------------------------------------------
-- Best-Practice gemäß 0085 / 0114:
--   * security invoker
--   * explizit gepinnter search_path = pg_catalog, public
-- Zusatz-Logik: Wenn status auf 'kontakt_erstellt' wechselt und ein
-- related_contact_id gesetzt ist, wird converted_to_contact_at gesetzt,
-- sofern es noch NULL ist (idempotent – kein Überschreiben).
-- ============================================================
create or replace function public.tg_anfragen_touch()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();

  if new.status = 'kontakt_erstellt'
     and new.related_contact_id is not null
     and new.converted_to_contact_at is null then
    new.converted_to_contact_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_anfragen_touch on public.anfragen;
create trigger trg_anfragen_touch
  before insert or update on public.anfragen
  for each row execute function public.tg_anfragen_touch();

-- ============================================================
-- 6) Row-Level-Security (Post-0063-Standard)
-- ------------------------------------------------------------
-- Permissive Policy: app_all (using true, with check true).
-- Restrictive Policy: organization_id = current_org_id()
--   – ohne `or organization_id is null` (Post-0063).
-- ============================================================
alter table public.anfragen enable row level security;

drop policy if exists anfragen_app_all on public.anfragen;
create policy anfragen_app_all
  on public.anfragen
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists anfragen_org_isolation on public.anfragen;
create policy anfragen_org_isolation
  on public.anfragen
  as restrictive
  for all to authenticated
  using  (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
