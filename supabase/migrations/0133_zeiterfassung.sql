-- ============================================================
-- Installateursoftware – Migration 0133: Ist-Zeiterfassung
--
-- Baut die Mitarbeiter-Zeiterfassung (Vorbild monti.pro) auf dem
-- vorhandenen Soll-Stunden-Fundament (work_time_models, employees.
-- week_short/week_long, Firmen-Arbeitskalender) auf:
--  * time_entries: Von–Bis + Pause, Arbeitsort, Eintragsart
--    (Arbeit/Urlaub/Krankenstand/ZA/…), Freigabe-Workflow,
--    Admin-Nachtrag-Audit. employee_id verweist ab jetzt auf
--    public.employees(id) (vorher Alt-Semantik auth.uid()).
--  * Zeitkonto (time_accounts + time_account_transactions) mit
--    transaktionaler Buchung über RPC za_book (Audit-Trail).
--  * Urlaub (leave_balances + leave_requests).
--  * Betriebs-/Feiertage (company_holidays) inkl. österreichischer
--    Feiertage 2026–2030 als Seed (je Mandant änderbar).
-- RLS: Modul time_tracking (Admin/Büro) + Eigene-Einträge-Zweig für
-- Monteure (employees.auth_user_id = auth.uid()). Idempotent.
-- ============================================================

-- ---------- 1) time_entries erweitern ----------
alter table public.time_entries alter column employee_id drop default;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'time_entries_employee_id_fkey' and conrelid = 'public.time_entries'::regclass
  ) then
    alter table public.time_entries
      add constraint time_entries_employee_id_fkey
      foreign key (employee_id) references public.employees(id) on delete set null;
  end if;
end $$;

alter table public.time_entries
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists pause_minutes integer not null default 0,
  add column if not exists location_type text not null default 'baustelle',
  add column if not exists entry_kind text not null default 'arbeit',
  add column if not exists approved boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists nachgetragen_von uuid references auth.users(id) on delete set null,
  add column if not exists nachgetragen_am timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'time_entries_location_type_check') then
    alter table public.time_entries add constraint time_entries_location_type_check
      check (location_type in ('baustelle','werkstatt','buero','sonstig'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_entries_entry_kind_check') then
    alter table public.time_entries add constraint time_entries_entry_kind_check
      check (entry_kind in ('arbeit','urlaub','krankenstand','feiertag','zeitausgleich','weiterbildung','betriebsurlaub','sonstig'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_entries_time_order_check') then
    alter table public.time_entries add constraint time_entries_time_order_check
      check (start_time is null or end_time is null or end_time > start_time);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_entries_pause_check') then
    alter table public.time_entries add constraint time_entries_pause_check check (pause_minutes >= 0);
  end if;
end $$;

create index if not exists idx_time_entries_employee_date on public.time_entries (employee_id, work_date);
create index if not exists idx_time_entries_project_date on public.time_entries (project_id, work_date);

drop trigger if exists time_entries_touch on public.time_entries;
create trigger time_entries_touch before update on public.time_entries
  for each row execute function public.b4y_touch_updated_at();

-- Eigene-Einträge-Zweig in den RLS-Policies ergänzen:
-- Monteure ohne globale time_tracking-Rechte verwalten ihre eigenen,
-- noch nicht freigegebenen Einträge selbst.
drop policy if exists "sel" on public.time_entries;
create policy "sel" on public.time_entries for select to authenticated
  using (
    b4y_is_admin(auth.uid())
    or b4y_has_permission(auth.uid(), 'time_tracking', 'view')
    or employee_id in (select id from public.employees where auth_user_id = auth.uid())
  );
drop policy if exists "ins" on public.time_entries;
create policy "ins" on public.time_entries for insert to authenticated
  with check (
    b4y_is_admin(auth.uid())
    or b4y_has_permission(auth.uid(), 'time_tracking', 'create')
    or employee_id in (select id from public.employees where auth_user_id = auth.uid())
  );
drop policy if exists "upd" on public.time_entries;
create policy "upd" on public.time_entries for update to authenticated
  using (
    b4y_is_admin(auth.uid())
    or b4y_has_permission(auth.uid(), 'time_tracking', 'edit')
    or (approved = false and employee_id in (select id from public.employees where auth_user_id = auth.uid()))
  )
  with check (
    b4y_is_admin(auth.uid())
    or b4y_has_permission(auth.uid(), 'time_tracking', 'edit')
    or (approved = false and employee_id in (select id from public.employees where auth_user_id = auth.uid()))
  );
drop policy if exists "del" on public.time_entries;
create policy "del" on public.time_entries for delete to authenticated
  using (
    b4y_is_admin(auth.uid())
    or b4y_has_permission(auth.uid(), 'time_tracking', 'delete')
    or (approved = false and employee_id in (select id from public.employees where auth_user_id = auth.uid()))
  );

-- ---------- 2) Zeitkonto (ZA) ----------
create table if not exists public.time_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  balance_hours numeric not null default 0,
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_account_transactions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  changed_by uuid default auth.uid() references auth.users(id) on delete set null,
  change_type text not null,          -- 'gutschrift' | 'abzug' | 'za_abzug' | 'za_storno' | 'korrektur'
  hours numeric not null,
  balance_before numeric not null,
  balance_after numeric not null,
  reason text,
  reference_id uuid,                  -- z. B. time_entries.id des ZA-Tags
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_ta_tx_employee on public.time_account_transactions (employee_id, created_at desc);

-- ---------- 3) Urlaub ----------
create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  year integer not null,
  total_days numeric not null default 25,
  used_days numeric not null default 0,
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, year)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days numeric not null default 0,
  type text not null default 'urlaub',    -- 'urlaub' | 'zeitausgleich' | 'sonderurlaub' | 'unbezahlt'
  status text not null default 'beantragt', -- 'beantragt' | 'genehmigt' | 'abgelehnt' | 'storniert'
  notizen text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ---------- 4) Betriebs-/Feiertage ----------
create table if not exists public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  bezeichnung text not null default 'Betriebsurlaub',
  kind text not null default 'feiertag' check (kind in ('feiertag','betriebsurlaub')),
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, datum)
);

-- Österreichische gesetzliche Feiertage 2026–2030 (Seed, je Mandant editierbar)
insert into public.company_holidays (datum, bezeichnung, kind, organization_id)
select d.datum::date, d.bezeichnung, 'feiertag',
       (select id from public.organizations order by created_at asc limit 1)
  from (values
    ('2026-01-01','Neujahr'),('2026-01-06','Heilige Drei Könige'),('2026-04-06','Ostermontag'),
    ('2026-05-01','Staatsfeiertag'),('2026-05-14','Christi Himmelfahrt'),('2026-05-25','Pfingstmontag'),
    ('2026-06-04','Fronleichnam'),('2026-08-15','Mariä Himmelfahrt'),('2026-10-26','Nationalfeiertag'),
    ('2026-11-01','Allerheiligen'),('2026-12-08','Mariä Empfängnis'),('2026-12-25','Christtag'),('2026-12-26','Stefanitag'),
    ('2027-01-01','Neujahr'),('2027-01-06','Heilige Drei Könige'),('2027-03-29','Ostermontag'),
    ('2027-05-01','Staatsfeiertag'),('2027-05-06','Christi Himmelfahrt'),('2027-05-17','Pfingstmontag'),
    ('2027-05-27','Fronleichnam'),('2027-08-15','Mariä Himmelfahrt'),('2027-10-26','Nationalfeiertag'),
    ('2027-11-01','Allerheiligen'),('2027-12-08','Mariä Empfängnis'),('2027-12-25','Christtag'),('2027-12-26','Stefanitag'),
    ('2028-01-01','Neujahr'),('2028-01-06','Heilige Drei Könige'),('2028-04-17','Ostermontag'),
    ('2028-05-01','Staatsfeiertag'),('2028-05-25','Christi Himmelfahrt'),('2028-06-05','Pfingstmontag'),
    ('2028-06-15','Fronleichnam'),('2028-08-15','Mariä Himmelfahrt'),('2028-10-26','Nationalfeiertag'),
    ('2028-11-01','Allerheiligen'),('2028-12-08','Mariä Empfängnis'),('2028-12-25','Christtag'),('2028-12-26','Stefanitag'),
    ('2029-01-01','Neujahr'),('2029-01-06','Heilige Drei Könige'),('2029-04-02','Ostermontag'),
    ('2029-05-01','Staatsfeiertag'),('2029-05-10','Christi Himmelfahrt'),('2029-05-21','Pfingstmontag'),
    ('2029-05-31','Fronleichnam'),('2029-08-15','Mariä Himmelfahrt'),('2029-10-26','Nationalfeiertag'),
    ('2029-11-01','Allerheiligen'),('2029-12-08','Mariä Empfängnis'),('2029-12-25','Christtag'),('2029-12-26','Stefanitag'),
    ('2030-01-01','Neujahr'),('2030-01-06','Heilige Drei Könige'),('2030-04-22','Ostermontag'),
    ('2030-05-01','Staatsfeiertag'),('2030-05-30','Christi Himmelfahrt'),('2030-06-10','Pfingstmontag'),
    ('2030-06-20','Fronleichnam'),('2030-08-15','Mariä Himmelfahrt'),('2030-10-26','Nationalfeiertag'),
    ('2030-11-01','Allerheiligen'),('2030-12-08','Mariä Empfängnis'),('2030-12-25','Christtag'),('2030-12-26','Stefanitag')
  ) as d(datum, bezeichnung)
on conflict (organization_id, datum) do nothing;

-- ---------- 5) RLS ----------
alter table public.time_accounts enable row level security;
alter table public.time_account_transactions enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
alter table public.company_holidays enable row level security;

do $$
declare t text;
begin
  foreach t in array array['time_accounts','time_account_transactions','leave_balances','leave_requests','company_holidays'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='org_isolation') then
      execute format(
        'create policy "org_isolation" on public.%I as restrictive for all to authenticated
           using (organization_id = current_org_id() or organization_id is null)
           with check (organization_id = current_org_id() or organization_id is null)', t);
    end if;
  end loop;
end $$;

-- Zeitkonto/Urlaub: sehen = Admin/Modul ODER eigener Datensatz; schreiben = Admin/Modul
do $$
declare t text;
begin
  foreach t in array array['time_accounts','time_account_transactions','leave_balances'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='sel') then
      execute format(
        'create policy "sel" on public.%I for select to authenticated using (
           b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), ''time_tracking'', ''view'')
           or employee_id in (select id from public.employees where auth_user_id = auth.uid()))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='mod') then
      execute format(
        'create policy "mod" on public.%I for all to authenticated using (
           b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), ''time_tracking'', ''edit''))
         with check (
           b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), ''time_tracking'', ''edit''))', t);
    end if;
  end loop;
end $$;

-- Urlaubsanträge: Mitarbeiter legt eigene an und sieht eigene; Admin/Modul verwaltet
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leave_requests' and policyname='sel') then
    create policy "sel" on public.leave_requests for select to authenticated using (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'view')
      or employee_id in (select id from public.employees where auth_user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leave_requests' and policyname='ins') then
    create policy "ins" on public.leave_requests for insert to authenticated with check (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'edit')
      or (status = 'beantragt' and employee_id in (select id from public.employees where auth_user_id = auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leave_requests' and policyname='mod') then
    create policy "mod" on public.leave_requests for update to authenticated using (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'edit')
      or (status = 'beantragt' and employee_id in (select id from public.employees where auth_user_id = auth.uid())))
    with check (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'edit')
      or (status in ('beantragt','storniert') and employee_id in (select id from public.employees where auth_user_id = auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leave_requests' and policyname='del') then
    create policy "del" on public.leave_requests for delete to authenticated using (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'delete')
      or (status = 'beantragt' and employee_id in (select id from public.employees where auth_user_id = auth.uid())));
  end if;
end $$;

-- Feiertage: alle lesen, Verwaltung über Modul time_tracking/Einstellungen
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_holidays' and policyname='sel') then
    create policy "sel" on public.company_holidays for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_holidays' and policyname='mod') then
    create policy "mod" on public.company_holidays for all to authenticated using (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'edit'))
    with check (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'edit'));
  end if;
end $$;

-- ---------- 6) RPC: transaktionale Zeitkonto-Buchung ----------
create or replace function public.za_book(
  p_employee_id uuid,
  p_hours numeric,               -- positiv = Gutschrift, negativ = Abzug
  p_change_type text,
  p_reason text default null,
  p_reference_id uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
  v_own boolean;
begin
  v_own := exists (select 1 from employees e where e.id = p_employee_id and e.auth_user_id = auth.uid());
  if not (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'edit') or v_own) then
    raise exception 'Keine Berechtigung für Zeitkonto-Buchungen';
  end if;
  -- Selbstbuchung nur für ZA-Abzug/Storno des eigenen Kontos
  if v_own and not (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'edit')) then
    if p_change_type not in ('za_abzug','za_storno') then
      raise exception 'Nur Zeitausgleich-Buchungen am eigenen Konto erlaubt';
    end if;
  end if;

  insert into time_accounts (employee_id, organization_id)
  values (p_employee_id, (select organization_id from employees where id = p_employee_id))
  on conflict (employee_id) do nothing;

  select balance_hours into v_before from time_accounts where employee_id = p_employee_id for update;
  v_after := coalesce(v_before, 0) + p_hours;
  if p_change_type = 'za_abzug' and v_after < 0 then
    raise exception 'Zeitkonto-Guthaben reicht nicht aus (Stand: % h)', coalesce(v_before, 0);
  end if;

  update time_accounts set balance_hours = v_after, updated_at = now() where employee_id = p_employee_id;
  insert into time_account_transactions
    (employee_id, changed_by, change_type, hours, balance_before, balance_after, reason, reference_id, organization_id)
  values
    (p_employee_id, auth.uid(), p_change_type, p_hours, coalesce(v_before, 0), v_after, p_reason, p_reference_id,
     (select organization_id from employees where id = p_employee_id));
  return v_after;
end;
$$;

revoke execute on function public.za_book(uuid, numeric, text, text, uuid) from anon;

-- updated_at-Trigger
do $$
declare t text;
begin
  foreach t in array array['time_accounts','leave_balances','leave_requests'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.b4y_touch_updated_at()', t, t);
  end loop;
end $$;
