-- 0111: Rolle "Gesellschafter" (Vollzugriff) je Organisation – idempotent, additiv.
-- Zusätzlich: user_roles mit organization_id IS NULL migrationssicher normalisieren
-- (Ursache für Duplicate-Key beim Rollenwechsel, weil RESTRICTIVE org_isolation die
-- Zeile sonst unsichtbar/undeletebar macht). Keine destruktiven Eingriffe.

-- 1) Gesellschafter-Rolle je Organisation anlegen, falls noch nicht vorhanden.
insert into public.roles
  (key, name, description, is_system, is_admin, active, organization_id,
   see_archived, see_deleted, restore_deleted, default_project_scope)
select 'gesellschafter', 'Gesellschafter',
       'Vollzugriff (Eigentümer/Gesellschafter)', true, true, true, o.id,
       true, true, true, 'all'
from public.organizations o
where not exists (
  select 1 from public.roles r
  where r.key = 'gesellschafter' and r.organization_id = o.id
);

-- 2) Falls eine Gesellschafter-Rolle bereits existiert: nur fehlende/inkonsistente
--    Pflicht-Eigenschaften korrigieren (Vollzugriff + aktiv), Rest unverändert lassen.
update public.roles
set is_admin = true, active = true
where key = 'gesellschafter' and (is_admin = false or active = false);

-- 3) Bestehende user_roles ohne organization_id normalisieren (Membership-Org, sonst Rollen-Org).
update public.user_roles ur
set organization_id = coalesce(
  (select m.organization_id from public.memberships m where m.user_id = ur.user_id limit 1),
  (select r.organization_id from public.roles r where r.id = ur.role_id)
)
where ur.organization_id is null;
