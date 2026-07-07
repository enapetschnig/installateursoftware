-- ============================================================
-- Flexibles Arbeitszeitkalender-System (mandantenfähig, nicht BUAK-fix)
-- ============================================================
create table if not exists public.company_work_calendar_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,
  year int not null,
  work_time_model text not null default 'buak_auto',
  short_week_hours numeric,
  long_week_hours numeric,
  fixed_weekly_hours numeric,
  default_daily_hours numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, year)
);
create index if not exists idx_wcs_org_year on public.company_work_calendar_settings(organization_id, year);

create table if not exists public.company_work_day_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,
  year int not null,
  weekday int not null,
  is_working_day boolean not null default true,
  target_hours numeric,
  start_time text,
  end_time text,
  break_minutes int,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, year, weekday)
);
create index if not exists idx_wdr_org_year on public.company_work_day_rules(organization_id, year);

alter table public.buak_calendar add column if not exists target_hours numeric;

alter table public.company_work_calendar_settings enable row level security;
alter table public.company_work_day_rules enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='company_work_calendar_settings' and policyname='sel') then
    create policy "sel" on public.company_work_calendar_settings for select to authenticated using (organization_id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='company_work_calendar_settings' and policyname='mod') then
    create policy "mod" on public.company_work_calendar_settings for all to authenticated
      using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='company_work_day_rules' and policyname='sel') then
    create policy "sel" on public.company_work_day_rules for select to authenticated using (organization_id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='company_work_day_rules' and policyname='mod') then
    create policy "mod" on public.company_work_day_rules for all to authenticated
      using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
  end if;
end $$;
