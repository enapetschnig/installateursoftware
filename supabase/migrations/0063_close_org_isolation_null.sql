-- ============================================================
-- B4Y SuperAPP – Migration 0063
-- Fund F-12: `OR organization_id IS NULL` in den restriktiven
-- `org_isolation`-Policies schließen (NULL-org-Zeilen waren für ALLE
-- Mandanten sichtbar/änderbar – bewusste Single-Tenant-Übergangslösung).
--
-- Sicher & idempotent: Läuft NUR, solange genau EINE Organisation existiert
-- (aktueller Single-Tenant-Zustand). Sobald echter Mehrmandantenbetrieb
-- aktiv ist (mehrere Orgs), wird die Migration übersprungen, weil dann
-- NULL-Zeilen nicht pauschal einer Org zugeordnet werden dürfen – das muss
-- dann gezielt pro Datensatz erfolgen.
--
-- Ablauf je betroffener Tabelle (alle mit `org_isolation`-Policy):
--   1. DEFAULT current_org_id() sicherstellen (Inserts setzen org weiter automatisch),
--   2. verbleibende NULL-organization_id auf die einzige Org backfillen,
--   3. org_isolation OHNE die NULL-Klausel neu anlegen.
-- ============================================================
do $$
declare
  rec record;
  org_count int;
  the_org uuid;
begin
  select count(*) into org_count from public.organizations;
  if org_count <> 1 then
    raise notice 'F-12 übersprungen: % Organisationen vorhanden (Single-Tenant-Voraussetzung nicht erfüllt). NULL-org-Zeilen müssen pro Datensatz zugeordnet werden.', org_count;
    return;
  end if;
  select id into the_org from public.organizations limit 1;

  -- NUR Tabellen mit org_isolation-Policy, die AUCH eine organization_id-Spalte haben.
  -- (Manche Tabellen wie ai_settings tragen eine org_isolation-Policy ohne
  -- organization_id-Spalte – diese werden NICHT angefasst.)
  for rec in
    select distinct p.tablename
    from pg_policies p
    where p.schemaname = 'public' and p.policyname = 'org_isolation'
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = p.tablename
          and c.column_name = 'organization_id'
      )
  loop
    -- 1) DEFAULT absichern (idempotent)
    execute format('alter table public.%I alter column organization_id set default public.current_org_id()', rec.tablename);
    -- 2) verbliebene NULLs backfillen
    execute format('update public.%I set organization_id = %L where organization_id is null', rec.tablename, the_org);
    -- 3) Policy ohne NULL-Klausel neu anlegen
    execute format('drop policy if exists org_isolation on public.%I', rec.tablename);
    execute format(
      'create policy org_isolation on public.%I as restrictive for all to authenticated '
      || 'using (organization_id = public.current_org_id()) '
      || 'with check (organization_id = public.current_org_id())', rec.tablename);
  end loop;
end $$;
