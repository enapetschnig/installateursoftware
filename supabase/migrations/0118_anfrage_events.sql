-- ============================================================
-- B4Y SuperAPP – Migration 0118
-- Anfrage-Events – append-only Activity-Log pro Anfrage
-- ------------------------------------------------------------
-- Zweck:
--   Unveränderlicher Audit-Trail aller Ereignisse einer Anfrage
--   (siehe 0117_anfragen.sql). Wird parallel zum Status-Lifecycle gepflegt
--   und dient als Grundlage für die Anfragen-Detail-Timeline im UI.
--
-- Event-Typen:
--   created          Anfrage angelegt (Webhook-Ingest oder manuell).
--   status_changed   Status-Übergang (from_value → to_value).
--   assigned         Bearbeiter zugewiesen / neu zugewiesen.
--   note             Manuelle Notiz eines Bearbeiters.
--   ai_classified    KI-Klassifikation eingetragen / aktualisiert.
--   contact_linked   related_contact_id verknüpft.
--   project_linked   related_project_id verknüpft.
--   converted        Anfrage in Kontakt konvertiert (status=kontakt_erstellt).
--   rejected         Anfrage abgewiesen.
--   reopened         Reaktivierung aus abgewiesen/archiviert.
--   audio_played     Audio-Datei (Fonio) wurde angehört (Compliance/Audit).
--
-- Append-only Semantik:
--   * Kein updated_at, kein UPDATE-Trigger.
--   * UPDATE/DELETE werden NICHT durch DB-Constraints blockiert, da
--     Admin-Korrekturen möglich bleiben sollen; das UI schreibt jedoch
--     ausschließlich INSERTs.
--
-- Mandantenfähigkeit (Post-0063-Standard):
--   * organization_id NOT NULL DEFAULT public.current_org_id()
--   * RESTRICTIVE Policy ohne `or organization_id is null`.
--
-- Idempotenz:
--   * CREATE TABLE / INDEX IF NOT EXISTS
--   * Policies DROP+CREATE
-- ============================================================

-- ============================================================
-- 1) Tabelle: anfrage_events
-- ============================================================
create table if not exists public.anfrage_events (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,

  anfrage_id uuid not null
    references public.anfragen(id) on delete cascade,

  created_by uuid default auth.uid()
    references auth.users(id) on delete set null,

  event_type text not null
    check (event_type in (
      'created',
      'status_changed',
      'assigned',
      'note',
      'ai_classified',
      'contact_linked',
      'project_linked',
      'converted',
      'rejected',
      'reopened',
      'audio_played'
    )),

  -- Diff-Felder (Klartext) – z.B. status_changed: from='neu', to='in_arbeit'.
  from_value text,
  to_value   text,

  -- Freitext-Kommentar (insb. event_type='note').
  note text,

  -- Strukturierter Zusatzinhalt (z.B. KI-Score, alter Assignee, etc.).
  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- ============================================================
-- 2) Kommentare
-- ============================================================
comment on table public.anfrage_events is
  'Append-only Activity-Log für Anfragen (siehe 0117_anfragen). Grundlage für die Detail-Timeline im UI. UPDATE/DELETE sind technisch erlaubt (Admin-Korrektur), das UI schreibt jedoch nur INSERTs.';

comment on column public.anfrage_events.organization_id is
  'Mandanten-ID (Post-0063-Isolation). Wird beim Insert per Default aus current_org_id() befüllt.';
comment on column public.anfrage_events.anfrage_id is
  'FK auf die betroffene Anfrage. ON DELETE CASCADE – Events teilen das Lifetime der Anfrage.';
comment on column public.anfrage_events.created_by is
  'Auslöser des Events (auth.users.id). NULL = System-Event (z.B. Webhook-Ingest).';
comment on column public.anfrage_events.event_type is
  'Event-Klassifikation. Siehe Migrations-Kommentar oben für die vollständige Liste.';
comment on column public.anfrage_events.from_value is
  'Alter Wert (z.B. vorheriger Status bei status_changed oder vorheriger Assignee bei assigned).';
comment on column public.anfrage_events.to_value is
  'Neuer Wert (z.B. neuer Status bei status_changed oder neuer Assignee bei assigned).';
comment on column public.anfrage_events.note is
  'Freitext-Kommentar des Bearbeiters – primär für event_type=note.';
comment on column public.anfrage_events.payload is
  'Strukturierte Zusatzdaten (z.B. KI-Score, Linked-IDs, Audio-Player-Position).';
comment on column public.anfrage_events.created_at is
  'Zeitpunkt des Events (UTC, unveränderlich).';

-- ============================================================
-- 3) Indices
-- ============================================================
-- Timeline-Query: alle Events einer Anfrage, neueste zuerst.
create index if not exists idx_anfrage_events_anfrage_created
  on public.anfrage_events (anfrage_id, created_at desc);

-- Org-weiter Activity-Stream (z.B. Dashboard "letzte Aktivitäten").
create index if not exists idx_anfrage_events_org_created
  on public.anfrage_events (organization_id, created_at desc);

-- ============================================================
-- 4) Row-Level-Security (Post-0063-Standard)
-- ============================================================
alter table public.anfrage_events enable row level security;

drop policy if exists anfrage_events_app_all on public.anfrage_events;
create policy anfrage_events_app_all
  on public.anfrage_events
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists anfrage_events_org_isolation on public.anfrage_events;
create policy anfrage_events_org_isolation
  on public.anfrage_events
  as restrictive
  for all to authenticated
  using  (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
