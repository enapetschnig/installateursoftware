-- ============================================================
-- B4Y SuperAPP – Migration 0012
-- BUAK-Kalender: Import-/Herkunftsfelder + Status & Confidence.
-- Bestehende Daten bleiben erhalten. Idempotent.
-- ============================================================

alter table public.buak_calendar add column if not exists status text not null default 'gespeichert';
alter table public.buak_calendar add column if not exists confidence numeric;     -- 0..1
alter table public.buak_calendar add column if not exists source_url text;
alter table public.buak_calendar add column if not exists source_domain text;

-- week_type um 'unbekannt' erweitern (für unsichere Auslese)
alter table public.buak_calendar drop constraint if exists buak_calendar_week_type_check;
alter table public.buak_calendar add constraint buak_calendar_week_type_check
  check (week_type in ('kurz','lang','neutral','frei','unbekannt'));

update public.buak_calendar set status = 'gespeichert' where status is null;
