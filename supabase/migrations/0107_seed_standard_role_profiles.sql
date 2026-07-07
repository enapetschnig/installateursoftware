-- ============================================================
-- B4Y SuperAPP – Migration 0107
-- Praxisnahe Standard-Rechteprofile für die umbenannten System-Rollen
-- ------------------------------------------------------------
-- Setzt sinnvolle Default-Rechte für: Arbeiter (bauleitung), Vorarbeiter (monteur),
-- Techniker (techniker), Büro (buero), Meister (vertrieb).
-- Unberührt bleiben: admin/geschaeftsfuehrer (Vollzugriff per is_admin),
-- nur_lesen (sinnvolle Nur-Lese-Rechte) und subunternehmer (bewusst minimal).
-- Idempotent: bestehende Rechte/Scopes dieser 5 Rollen werden zuerst entfernt.
-- organization_id wird je Rolle aus roles.organization_id übernommen (mandantensicher).
-- Hinweis: '*' in der Profiltabelle = alle definierten Aktionen des Moduls.
-- ============================================================

-- 1) Bestehende Rechte/Scopes der Zielrollen leeren ----------------------------
delete from public.role_permissions
where role_id in (select id from public.roles where key in ('bauleitung','monteur','techniker','buero','vertrieb'));
delete from public.role_scopes
where role_id in (select id from public.roles where key in ('bauleitung','monteur','techniker','buero','vertrieb'));

-- 2) Profile setzen -------------------------------------------------------------
with prof(rk, mk, acts, scp) as (
  values
  -- ===== ARBEITER (bauleitung) – minimal, nur zugewiesene Projekte =====
  ('bauleitung','dashboard','view',null),
  ('bauleitung','projects','view','assigned'),
  ('bauleitung','projects.notes','view,edit',null),
  ('bauleitung','time_tracking','view,create,edit','own'),
  ('bauleitung','tasks','view,edit','assigned'),
  ('bauleitung','meetings','view','assigned'),
  ('bauleitung','media.photos','view,upload,download','assigned'),
  ('bauleitung','media.videos','view,upload,download','assigned'),
  ('bauleitung','documents','view,download','assigned'),
  ('bauleitung','documents.plans','view,download','assigned'),

  -- ===== VORARBEITER (monteur) – Baustellenleitung, zugewiesene Projekte =====
  ('monteur','dashboard','view',null),
  ('monteur','projects','view,edit','assigned'),
  ('monteur','projects.notes','view,edit',null),
  ('monteur','projects.calc','view',null),
  ('monteur','time_tracking','view,create,edit','assigned'),
  ('monteur','tasks','view,create,edit,delete','assigned'),
  ('monteur','plantafel','view','assigned'),
  ('monteur','meetings','view,create,edit','assigned'),
  ('monteur','signatures','view,create','assigned'),
  ('monteur','contacts','view','all'),
  ('monteur','media.photos','view,upload,edit,download','assigned'),
  ('monteur','media.videos','view,upload,edit,download','assigned'),
  ('monteur','documents','view,upload,download,print','assigned'),
  ('monteur','documents.plans','view,upload,download,print','assigned'),
  ('monteur','documents.delivery_notes','view,upload,download','assigned'),

  -- ===== TECHNIKER – Planung/Einreichung/Kalkulation (lesend/erstellend) =====
  ('techniker','dashboard','view',null),
  ('techniker','projects','view,edit','assigned'),
  ('techniker','projects.notes','view,edit',null),
  ('techniker','projects.calc','view,edit',null),
  ('techniker','kalkulation','view,edit',null),
  ('techniker','kalkulation.articles','view',null),
  ('techniker','kalkulation.services','view',null),
  ('techniker','offers','view,create,edit','assigned'),
  ('techniker','contacts','view','all'),
  ('techniker','meetings','view,create,edit','assigned'),
  ('techniker','signatures','view,create','assigned'),
  ('techniker','time_tracking','view,create,edit','own'),
  ('techniker','tasks','view,create,edit','assigned'),
  ('techniker','media.photos','*','assigned'),
  ('techniker','media.videos','*','assigned'),
  ('techniker','documents','view,upload,edit,download,print','assigned'),
  ('techniker','documents.plans','*','assigned'),
  ('techniker','documents.submissions','*','assigned'),
  ('techniker','documents.contracts','view,upload,download,print','assigned'),
  ('techniker','documents.calc_docs','view,upload,edit,download,print','assigned'),

  -- ===== BÜRO – Backoffice: Kontakte, Belege, Dokumente, Buchhaltung =====
  ('buero','dashboard','view',null),
  ('buero','contacts','*','all'),
  ('buero','contacts.customers','*','all'),
  ('buero','contacts.suppliers','*','all'),
  ('buero','contacts.persons','*','all'),
  ('buero','contacts.notes','view,edit',null),
  ('buero','projects','view,create,edit,export,print','all'),
  ('buero','projects.notes','view,edit',null),
  ('buero','projects.calc','view',null),
  ('buero','projects.invoices','view',null),
  ('buero','offers','*','all'),
  ('buero','orders','*','all'),
  ('buero','invoices','*','all'),
  ('buero','nachtraege','*','all'),
  ('buero','regiestunden','*','all'),
  ('buero','documents','*','all'),
  ('buero','documents.plans','*','all'),
  ('buero','documents.submissions','*','all'),
  ('buero','documents.contracts','*','all'),
  ('buero','documents.invoices','*','all'),
  ('buero','documents.delivery_notes','*','all'),
  ('buero','documents.sub_offers','*','all'),
  ('buero','documents.calc_docs','*','all'),
  ('buero','documents.internal','*','all'),
  ('buero','documents.external','*','all'),
  ('buero','documents.internal_notes','*','all'),
  ('buero','media.photos','view,upload,edit,download,print','all'),
  ('buero','media.videos','view,upload,edit,download,print','all'),
  ('buero','media.categories','view,create,edit,delete',null),
  ('buero','email','view,create,share',null),
  ('buero','buchhaltung','view,create,edit,export,print','all'),
  ('buero','analytics','view',null),
  ('buero','analytics.open_offers','view',null),
  ('buero','analytics.open_invoices','view',null),
  ('buero','analytics.accounting','view',null),
  ('buero','analytics.export','view,export',null),
  ('buero','employees','view',null),
  ('buero','time_tracking','view,export','all'),
  ('buero','tasks','view,create,edit','all'),
  ('buero','plantafel','view,create,edit','all'),
  ('buero','meetings','view,create,edit,print','all'),
  ('buero','settings.company','view',null),
  ('buero','settings.number_ranges','*',null),
  ('buero','settings.document_types','*',null),
  ('buero','settings.project_statuses','*',null),
  ('buero','settings.project_templates','*',null),
  ('buero','settings.media_categories','*',null),

  -- ===== MEISTER (vertrieb) – breit operativ inkl. Vertrieb/Kalkulation,
  --       OHNE System-/Rechte-/Finanzadmin =====
  ('vertrieb','dashboard','view',null),
  ('vertrieb','contacts','*','all'),
  ('vertrieb','contacts.customers','*','all'),
  ('vertrieb','contacts.suppliers','*','all'),
  ('vertrieb','contacts.persons','*','all'),
  ('vertrieb','contacts.notes','view,edit',null),
  ('vertrieb','projects','view,create,edit,archive,export,print,share','all'),
  ('vertrieb','projects.notes','view,edit',null),
  ('vertrieb','projects.calc','view,edit',null),
  ('vertrieb','projects.invoices','view',null),
  ('vertrieb','kalkulation','*',null),
  ('vertrieb','kalkulation.trades','*',null),
  ('vertrieb','kalkulation.units','*',null),
  ('vertrieb','kalkulation.hourly_rates','*',null),
  ('vertrieb','kalkulation.articles','*',null),
  ('vertrieb','kalkulation.services','*',null),
  ('vertrieb','offers','*','all'),
  ('vertrieb','orders','*','all'),
  ('vertrieb','nachtraege','*','all'),
  ('vertrieb','regiestunden','*','all'),
  ('vertrieb','invoices','view,create,edit,export,print','all'),
  ('vertrieb','documents','*','all'),
  ('vertrieb','documents.plans','*','all'),
  ('vertrieb','documents.submissions','*','all'),
  ('vertrieb','documents.contracts','*','all'),
  ('vertrieb','documents.invoices','*','all'),
  ('vertrieb','documents.delivery_notes','*','all'),
  ('vertrieb','documents.sub_offers','*','all'),
  ('vertrieb','documents.calc_docs','*','all'),
  ('vertrieb','documents.internal','*','all'),
  ('vertrieb','documents.external','*','all'),
  ('vertrieb','documents.internal_notes','*','all'),
  ('vertrieb','media.photos','*','all'),
  ('vertrieb','media.videos','*','all'),
  ('vertrieb','media.categories','view,create,edit,delete',null),
  ('vertrieb','analytics','view',null),
  ('vertrieb','analytics.revenue','view',null),
  ('vertrieb','analytics.margin','view',null),
  ('vertrieb','analytics.profit','view',null),
  ('vertrieb','analytics.employee_performance','view',null),
  ('vertrieb','analytics.open_offers','view',null),
  ('vertrieb','analytics.open_invoices','view',null),
  ('vertrieb','analytics.project_costs','view',null),
  ('vertrieb','analytics.export','view,export',null),
  ('vertrieb','email','view,create,share',null),
  ('vertrieb','employees','view',null),
  ('vertrieb','time_tracking','view,export','all'),
  ('vertrieb','tasks','*','all'),
  ('vertrieb','plantafel','*','all'),
  ('vertrieb','meetings','*','all'),
  ('vertrieb','signatures','view,create,delete','all'),
  ('vertrieb','settings.company','view',null),
  ('vertrieb','settings.number_ranges','*',null),
  ('vertrieb','settings.document_types','*',null),
  ('vertrieb','settings.project_statuses','*',null),
  ('vertrieb','settings.project_templates','*',null),
  ('vertrieb','settings.media_categories','*',null)
),
ins_perms as (
  insert into public.role_permissions(role_id, module_key, action, allowed, organization_id)
  select r.id, p.mk, a, true, r.organization_id
  from prof p
  join public.roles r on r.key = p.rk
  join public.permission_modules m on m.key = p.mk and m.active
  cross join lateral unnest(
    case when p.acts = '*' then m.actions else string_to_array(p.acts, ',') end
  ) as a
  returning 1
)
insert into public.role_scopes(role_id, module_key, scope, organization_id)
select r.id, p.mk, p.scp, r.organization_id
from prof p
join public.roles r on r.key = p.rk
join public.permission_modules m on m.key = p.mk and m.active and m.supports_scope
where p.scp is not null;

-- 3) Projektart-Sichtbarkeit (projecttype.*) für operative Rollen --------------
insert into public.role_permissions(role_id, module_key, action, allowed, organization_id)
select r.id, m.key, 'view', true, r.organization_id
from public.roles r
join public.permission_modules m on m.active and m.key like 'projecttype.%'
where r.key in ('bauleitung','monteur','techniker','buero','vertrieb');

insert into public.role_scopes(role_id, module_key, scope, organization_id)
select r.id, m.key,
       case when r.key in ('buero','vertrieb') then 'all' else 'assigned' end,
       r.organization_id
from public.roles r
join public.permission_modules m on m.active and m.key like 'projecttype.%'
where r.key in ('bauleitung','monteur','techniker','buero','vertrieb');
