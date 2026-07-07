-- 0112: b4y_has_permission reparieren. Die in Migr. 0106 entfernte Tabelle
-- user_permission_overrides wurde in der Funktion noch referenziert → für Nicht-Admins
-- brach jede RLS-Prüfung über b4y_has_permission (Admins funktionierten nur durch
-- OR-Short-Circuit). Jetzt rein rollenbasiert (konsistent mit rechte-rollen.md).
create or replace function public.b4y_has_permission(uid uuid, p_module text, p_action text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.b4y_is_admin(uid) then true
    when exists (
      select 1 from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      where ur.user_id = uid and rp.module_key = p_module
        and rp.action = p_action and rp.allowed = true
    ) then true
    else false
  end;
$function$;
