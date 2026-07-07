-- 0077_global_project_statuses_and_project_start_at.sql
-- B4Y SuperAPP – Zentrale (globale) Projektstatus + Zuordnung je Projekttyp
--                + additive Spalte projects.start_at (Baubeginn mit Uhrzeit)
-- ----------------------------------------------------------------------------
-- Ziel (Task 5): Projektstatus werden global verwaltet (eigener Reiter), Projekttypen
-- können globale Status nur noch aktivieren/deaktivieren (nicht je Typ neu anlegen).
-- Mandantenfähig (organization_id), keine harten Werte.
-- DATENERHALT: projects.stage (Text-Label) bleibt unverändert; die alte Tabelle
-- public.project_statuses bleibt als Backup bestehen (wird nur nicht mehr beschrieben).

-- 1) Globale Status-Liste je Firma --------------------------------------------
create table if not exists public.project_statuses_global (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  label text not null,
  color text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, label)
);

alter table public.project_statuses_global enable row level security;

drop policy if exists psg_all on public.project_statuses_global;
create policy psg_all on public.project_statuses_global
  for all to authenticated using (true) with check (true);

drop policy if exists psg_org_isolation on public.project_statuses_global;
create policy psg_org_isolation on public.project_statuses_global
  as restrictive for all to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- 2) Zuordnung Status <-> Projekttyp (Aktiv-Flag + Sortierung je Typ) ----------
create table if not exists public.project_type_statuses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  project_type_id uuid not null references public.project_types(id) on delete cascade,
  status_id uuid not null references public.project_statuses_global(id) on delete cascade,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, project_type_id, status_id)
);

alter table public.project_type_statuses enable row level security;

drop policy if exists pts_all on public.project_type_statuses;
create policy pts_all on public.project_type_statuses
  for all to authenticated using (true) with check (true);

drop policy if exists pts_org_isolation on public.project_type_statuses;
create policy pts_org_isolation on public.project_type_statuses
  as restrictive for all to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- 3) Datenmigration: bestehende per-Typ-Status nach Label zusammenführen --------
--    a) Globale Status = distinct Labels je Organisation
--       (Sortierung = kleinster vorhandener sort_order, aktiv wenn irgendwo aktiv)
insert into public.project_statuses_global (organization_id, label, sort_order, active)
select ps.organization_id, ps.label, min(ps.sort_order), bool_or(ps.active)
from public.project_statuses ps
where ps.label is not null and btrim(ps.label) <> '' and ps.organization_id is not null
group by ps.organization_id, ps.label
on conflict (organization_id, label) do nothing;

--    b) Zuordnung je (Typ, Status) aus bestehenden project_statuses übernehmen
insert into public.project_type_statuses (organization_id, project_type_id, status_id, sort_order, active)
select ps.organization_id, ps.project_type_id, g.id, ps.sort_order, ps.active
from public.project_statuses ps
join public.project_statuses_global g
  on g.organization_id = ps.organization_id and g.label = ps.label
where ps.project_type_id is not null
on conflict (organization_id, project_type_id, status_id) do nothing;

-- 4) Additive Spalte: Baubeginn mit Uhrzeit (Datum bleibt in start_date erhalten)
alter table public.projects
  add column if not exists start_at timestamptz;

-- 5) Backfill start_at aus bestehendem start_date (nur wo leer; kein Datenverlust)
update public.projects
  set start_at = (start_date::timestamptz)
  where start_at is null and start_date is not null;
