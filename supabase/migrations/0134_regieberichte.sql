-- ============================================================
-- Installateursoftware – Migration 0134: Regieberichte
--
-- Arbeitsbericht mit Einsatzzeiten, Kundendaten (Snapshot +
-- optionale Verknüpfung), Material-Positionen (mit Einheit und
-- Einzelpreis für die spätere Verrechnung), beteiligten Mitarbeitern,
-- Fotos und Kundenunterschrift (Vorbild: holzbaulutz/monti.pro,
-- angepasst an B4Y-Architektur: organization_id, RBAC-Modul
-- 'regiestunden', zentrale Nummernkreise, employees statt auth-User).
-- Beteiligte Mitarbeiter erhalten automatisch Zeiteinträge über die
-- RPC regie_sync_time_entries (security definer, Berechtigung wird
-- innen geprüft). Idempotent.
-- ============================================================

-- ---------- 1) Tabellen ----------
create table if not exists public.regie_reports (
  id uuid primary key default gen_random_uuid(),
  report_number text,
  project_id uuid references public.projects(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  kunde_name text not null default '',
  kunde_strasse text,
  kunde_plz text,
  kunde_ort text,
  kunde_email text,
  kunde_telefon text,
  datum date not null default current_date,
  start_time time,
  end_time time,
  pause_minutes integer not null default 0,
  stunden numeric not null default 0,
  beschreibung text not null default '',
  notizen text,
  status text not null default 'offen' check (status in ('offen','unterschrieben','gesendet')),
  is_verrechnet boolean not null default false,
  unterschrift_kunde text,            -- Base64-Data-URL (SignaturePad)
  unterschrift_name text,
  unterschrift_am timestamptz,
  pdf_path text,
  pdf_gesendet_am timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_regie_reports_project on public.regie_reports (project_id);
create index if not exists idx_regie_reports_datum on public.regie_reports (datum desc);

create table if not exists public.regie_report_materials (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.regie_reports(id) on delete cascade,
  article_id uuid references public.articles(id) on delete set null,
  material text not null,
  menge numeric not null default 1,
  einheit text not null default 'Stk',
  einzelpreis numeric not null default 0,
  notizen text,
  sort_order integer not null default 0,
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.regie_report_workers (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.regie_reports(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  is_main boolean not null default false,
  hours numeric,                      -- null = Stunden des Berichts übernehmen
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (report_id, employee_id)
);

create table if not exists public.regie_report_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.regie_reports(id) on delete cascade,
  file_path text not null,            -- Bucket project-files, Pfad regie/<report_id>/…
  file_name text,
  organization_id uuid default current_org_id() references public.organizations(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Verknüpfung der automatisch erzeugten Zeiteinträge
alter table public.time_entries
  add column if not exists source_regie_report_id uuid references public.regie_reports(id) on delete cascade;
create index if not exists idx_time_entries_regie on public.time_entries (source_regie_report_id);

-- ---------- 2) Nummernkreis ----------
insert into public.number_ranges (doc_type, label, prefix, use_year, separator, min_digits, next_number, active, protected, organization_id)
select 'regiebericht', 'Regieberichte', 'RB', true, '-', 3, 1, true, true,
       (select id from public.organizations order by created_at asc limit 1)
 where not exists (select 1 from public.number_ranges where doc_type = 'regiebericht');

-- ---------- 3) RLS (Modul 'regiestunden' + Eigene-Berichte-Zweig) ----------
alter table public.regie_reports enable row level security;
alter table public.regie_report_materials enable row level security;
alter table public.regie_report_workers enable row level security;
alter table public.regie_report_photos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['regie_reports','regie_report_materials','regie_report_workers','regie_report_photos'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='org_isolation') then
      execute format(
        'create policy "org_isolation" on public.%I as restrictive for all to authenticated
           using (organization_id = current_org_id() or organization_id is null)
           with check (organization_id = current_org_id() or organization_id is null)', t);
    end if;
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='regie_reports' and policyname='sel') then
    create policy "sel" on public.regie_reports for select to authenticated using (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'regiestunden', 'view')
      or created_by = auth.uid()
      or exists (select 1 from public.regie_report_workers w
                   join public.employees e on e.id = w.employee_id
                  where w.report_id = regie_reports.id and e.auth_user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='regie_reports' and policyname='ins') then
    create policy "ins" on public.regie_reports for insert to authenticated with check (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'regiestunden', 'create')
      or created_by = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='regie_reports' and policyname='upd') then
    create policy "upd" on public.regie_reports for update to authenticated using (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'regiestunden', 'edit')
      or (created_by = auth.uid() and is_verrechnet = false))
    with check (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'regiestunden', 'edit')
      or (created_by = auth.uid() and is_verrechnet = false));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='regie_reports' and policyname='del') then
    create policy "del" on public.regie_reports for delete to authenticated using (
      b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'regiestunden', 'delete')
      or (created_by = auth.uid() and status = 'offen' and is_verrechnet = false));
  end if;
end $$;

-- Untertabellen folgen dem Bericht (Zugriff über Bericht-Sichtbarkeit)
do $$
declare t text;
begin
  foreach t in array array['regie_report_materials','regie_report_workers','regie_report_photos'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='sel') then
      execute format(
        'create policy "sel" on public.%I for select to authenticated using (
           exists (select 1 from public.regie_reports r where r.id = %I.report_id))', t, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='mod') then
      execute format(
        'create policy "mod" on public.%I for all to authenticated using (
           exists (select 1 from public.regie_reports r where r.id = %I.report_id
                     and (b4y_is_admin(auth.uid())
                          or b4y_has_permission(auth.uid(), ''regiestunden'', ''edit'')
                          or (r.created_by = auth.uid() and r.is_verrechnet = false))))
         with check (
           exists (select 1 from public.regie_reports r where r.id = %I.report_id
                     and (b4y_is_admin(auth.uid())
                          or b4y_has_permission(auth.uid(), ''regiestunden'', ''edit'')
                          or (r.created_by = auth.uid() and r.is_verrechnet = false))))', t, t, t);
    end if;
  end loop;
end $$;

-- ---------- 4) Rechte-Seeds: Monteure/Bauleitung dürfen Regieberichte anlegen ----------
insert into public.role_permissions (role_id, module_key, action, allowed, organization_id)
select r.id, 'regiestunden', a.action, true, r.organization_id
  from public.roles r
  cross join (values ('view'), ('create'), ('edit')) as a(action)
 where r.key in ('monteur','bauleitung','techniker')
   and not exists (select 1 from public.role_permissions rp
                    where rp.role_id = r.id and rp.module_key = 'regiestunden' and rp.action = a.action);

insert into public.role_scopes (role_id, module_key, scope, organization_id)
select r.id, 'regiestunden', 'own', r.organization_id
  from public.roles r
 where r.key in ('monteur','bauleitung','techniker')
   and not exists (select 1 from public.role_scopes rs
                    where rs.role_id = r.id and rs.module_key = 'regiestunden');

-- ---------- 5) RPC: Zeiteinträge der Beteiligten synchronisieren ----------
create or replace function public.regie_sync_time_entries(p_report_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report regie_reports%rowtype;
  v_count integer := 0;
  v_worker record;
begin
  select * into v_report from regie_reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'Regiebericht nicht gefunden';
  end if;
  if not (b4y_is_admin(auth.uid())
          or b4y_has_permission(auth.uid(), 'regiestunden', 'edit')
          or v_report.created_by = auth.uid()) then
    raise exception 'Keine Berechtigung';
  end if;

  -- Alte automatisch erzeugte Einträge ersetzen
  delete from time_entries where source_regie_report_id = p_report_id;

  for v_worker in
    select w.employee_id, coalesce(w.hours, v_report.stunden) as hours
      from regie_report_workers w where w.report_id = p_report_id
  loop
    insert into time_entries
      (project_id, employee_id, work_date, hours, description,
       start_time, end_time, pause_minutes, location_type, entry_kind,
       source_regie_report_id, organization_id)
    values
      (v_report.project_id, v_worker.employee_id, v_report.datum, v_worker.hours,
       'Regiearbeit: ' || coalesce(nullif(v_report.report_number, ''), left(v_report.beschreibung, 80)),
       v_report.start_time, v_report.end_time, v_report.pause_minutes, 'baustelle', 'arbeit',
       p_report_id, v_report.organization_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.regie_sync_time_entries(uuid) from anon;

drop trigger if exists regie_reports_touch on public.regie_reports;
create trigger regie_reports_touch before update on public.regie_reports
  for each row execute function public.b4y_touch_updated_at();
