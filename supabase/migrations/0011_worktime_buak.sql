-- ============================================================
-- B4Y SuperAPP – Migration 0011
-- Tagesstunden je Wochentag (kurze/lange Woche) am Mitarbeiter +
-- BUAK-Kalender (Wochenart pro KW, Quelle für kurz/lang). Idempotent.
-- ============================================================

-- Tagesstunden-Modelle als JSONB: { mon,tue,wed,thu,fri,sat,sun }
alter table public.employees add column if not exists week_short jsonb not null default '{}'::jsonb;
alter table public.employees add column if not exists week_long  jsonb not null default '{}'::jsonb;

-- Standard-Bundesland Wien (gilt für neue Datensätze)
alter table public.employees alter column work_state set default 'Wien';

-- ---------- BUAK-Kalender ----------
create table if not exists public.buak_calendar (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  week int not null,                  -- Kalenderwoche (ISO)
  date_from date,
  date_to date,
  week_type text not null default 'neutral'
    check (week_type in ('kurz','lang','neutral','frei')),
  soll_bau numeric,                   -- Sollstunden Bau
  soll_maler numeric,                 -- Sollstunden Maler und Anstreicher
  note text,
  source text,                        -- Quelle / Importdatei
  updated_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, week)
);
create index if not exists idx_buak_year on public.buak_calendar(year);

alter table public.buak_calendar enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='buak_calendar' and policyname='app_all') then
    create policy app_all on public.buak_calendar for all to authenticated using (true) with check (true);
  end if;
end $$;

drop trigger if exists trg_touch_buak on public.buak_calendar;
create trigger trg_touch_buak before update on public.buak_calendar
  for each row execute function public.b4y_touch_updated_at();
