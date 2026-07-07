-- ============================================================
-- B4Y SuperAPP – Migration 0009
-- Mitarbeiterverwaltung (Phase A): Personalstammdaten,
-- Anstellung, Lohngruppe. Sensible Daten (Bank/Steuer/Mailserver)
-- folgen verschlüsselt in Phase B.
-- Idempotent – mehrfach ausführbar.
-- ============================================================

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  -- optionale Verknüpfung zu einem App-Login (für Berechtigungen, Phase B)
  auth_user_id uuid references auth.users(id) on delete set null,

  -- ---------- Persönliches ----------
  salutation text,
  title text,
  first_name text not null,
  last_name text not null,
  birth_date date,
  email text not null,
  phone text,
  mobile text,
  street text,
  address_extra text,
  zip text,
  city text,
  country text not null default 'Österreich',
  photo_url text,
  notes_internal text,
  active boolean not null default true,

  -- ---------- Anstellung ----------
  entry_date date,
  exit_date date,
  employment_type text
    check (employment_type in ('vollzeit','teilzeit','geringfuegig','freier_dienstnehmer','praktikant')),
  position text,
  weekly_hours numeric,
  vacation_days_per_year numeric,
  probation_until date,
  notice_period text,
  supervisor_id uuid references public.employees(id) on delete set null,
  personnel_number text,
  work_state text
    check (work_state in ('Burgenland','Kärnten','Niederösterreich','Oberösterreich','Salzburg','Steiermark','Tirol','Vorarlberg','Wien')),
  worktime_model text
    check (worktime_model in ('standardwoche','buak','teilzeit','individuell')),

  -- ---------- Lohngruppe ----------
  wage_group text,
  collective_agreement text,
  hourly_wage_gross numeric,
  monthly_wage_gross numeric,
  overtime_rate numeric,
  surcharges text,
  wage_valid_from date,
  wage_note text,

  -- ---------- Meta ----------
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_employees_active on public.employees(active);
create index if not exists idx_employees_name on public.employees(last_name, first_name);

alter table public.employees enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='employees' and policyname='app_all') then
    create policy app_all on public.employees for all to authenticated using (true) with check (true);
  end if;
end $$;

drop trigger if exists trg_touch_employees on public.employees;
create trigger trg_touch_employees before update on public.employees
  for each row execute function public.b4y_touch_updated_at();
