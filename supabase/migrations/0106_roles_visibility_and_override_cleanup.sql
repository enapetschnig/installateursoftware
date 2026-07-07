-- ============================================================
-- B4Y SuperAPP – Migration 0106
-- Rechte-Vereinfachung: Sichtbarkeits-Flags rollenbasiert + ungenutzte Overrides entfernen
-- ------------------------------------------------------------
-- Hintergrund (Bestandsanalyse 2026-06-27):
--   • user_permission_overrides = 0 Zeilen, user_scope_overrides = 0 Zeilen → ungenutzt.
--   • user_access = 1 Zeile (Admin, alles "all/true").
-- Ziel: Sichtbarkeits-Flags (Archiviert/Gelöscht sehen, Wiederherstellen, Standard-Projekt-Scope)
--       werden rollenbasiert auf roles geführt; die vorhandene user_access-Zeile wird
--       datenbewahrend auf die Rolle(n) des Nutzers übernommen.
--       Die ungenutzten Override-Tabellen werden entfernt (ausdrücklich freigegeben).
-- Mandantenfähig: roles trägt bereits organization_id; neue Spalten erben die RLS von roles.
-- ============================================================

-- 1) Additive Spalten auf roles (rollenbasierte Sichtbarkeit/Scope) -------------
alter table public.roles
  add column if not exists see_archived         boolean not null default false,
  add column if not exists see_deleted          boolean not null default false,
  add column if not exists restore_deleted      boolean not null default false,
  add column if not exists default_project_scope text   not null default 'own';

-- Scope-Wertebereich absichern (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'roles_default_project_scope_chk'
  ) then
    alter table public.roles
      add constraint roles_default_project_scope_chk
      check (default_project_scope in ('none','own','assigned','department','all'));
  end if;
end $$;

-- 2) Vorhandene user_access-Daten datenbewahrend auf die Rolle(n) übernehmen -----
--    Mehrere Nutzer je Rolle → Flags werden ODER-verknüpft (großzügigster gewinnt).
with agg as (
  select ur.role_id,
         bool_or(ua.see_archived)    as see_archived,
         bool_or(ua.see_deleted)     as see_deleted,
         bool_or(ua.restore_deleted) as restore_deleted,
         max(ua.default_project_scope) as default_project_scope
  from public.user_access ua
  join public.user_roles  ur on ur.user_id = ua.user_id
  group by ur.role_id
)
update public.roles r set
  see_archived          = r.see_archived    or a.see_archived,
  see_deleted           = r.see_deleted     or a.see_deleted,
  restore_deleted       = r.restore_deleted or a.restore_deleted,
  default_project_scope = case
                            when a.default_project_scope in ('none','own','assigned','department','all')
                            then a.default_project_scope
                            else r.default_project_scope
                          end
from agg a
where a.role_id = r.id;

-- 3) Ungenutzte Override-Tabellen entfernen (freigegeben, 0 Datensätze) ----------
--    CASCADE entfernt zugehörige Policies/Trigger (trg_audit_user_perm_ovr,
--    trg_audit_user_scope_ovr) automatisch mit.
drop table if exists public.user_permission_overrides cascade;
drop table if exists public.user_scope_overrides      cascade;

-- Hinweis: public.user_access bleibt physisch erhalten (datenbewahrend, nicht mehr
-- als Rechtequelle genutzt). Eine spätere, ausdrücklich freigegebene Aufräum-Migration
-- kann sie entfernen, sobald sichergestellt ist, dass nichts mehr darauf zugreift.
