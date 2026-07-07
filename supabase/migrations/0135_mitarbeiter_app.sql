-- ============================================================
-- Installateursoftware – Migration 0135: Mitarbeiter-App-Modul
--
-- Eigenes Rechte-Modul 'mitarbeiter_app' als Ein-/Ausschalter für
-- den mobilen Mitarbeiter-Bereich (/m): Fotos auf Projekte hochladen,
-- Regieberichte erstellen, Stunden schreiben. Monteure/Bauleitung/
-- Techniker erhalten den Bereich standardmäßig; zusätzlich Upload-
-- Rechte für Projektfotos. Alles je Rolle in den Einstellungen
-- änderbar. Idempotent.
-- ============================================================

insert into public.permission_modules (key, label, group_key, actions, supports_scope, is_system, active, sort_order)
select 'mitarbeiter_app', 'Mitarbeiter-App', 'mitarbeiter', array['view'], false, true, true,
       coalesce((select max(sort_order) + 1 from public.permission_modules where group_key = 'mitarbeiter'), 99)
 where not exists (select 1 from public.permission_modules where key = 'mitarbeiter_app');

-- Mitarbeiter-Rollen: Zugang zur Mitarbeiter-App
insert into public.role_permissions (role_id, module_key, action, allowed, organization_id)
select r.id, 'mitarbeiter_app', 'view', true, r.organization_id
  from public.roles r
 where r.key in ('monteur','bauleitung','techniker')
   and not exists (select 1 from public.role_permissions rp
                    where rp.role_id = r.id and rp.module_key = 'mitarbeiter_app' and rp.action = 'view');

-- Fotos auf zugewiesene Projekte hochladen (falls noch nicht erlaubt)
insert into public.role_permissions (role_id, module_key, action, allowed, organization_id)
select r.id, m.module_key, m.action, true, r.organization_id
  from public.roles r
  cross join (values
    ('media.photos', 'view'), ('media.photos', 'upload'),
    ('media.videos', 'view'), ('media.videos', 'upload'),
    ('projects', 'view'),
    ('time_tracking', 'view'), ('time_tracking', 'create'), ('time_tracking', 'edit')
  ) as m(module_key, action)
 where r.key in ('monteur','bauleitung','techniker')
   and exists (select 1 from public.permission_modules pm where pm.key = m.module_key)
   and not exists (select 1 from public.role_permissions rp
                    where rp.role_id = r.id and rp.module_key = m.module_key and rp.action = m.action);
