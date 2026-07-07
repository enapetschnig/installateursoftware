-- ============================================================
-- Mandantenfähigkeit Phase 1/2: organization_id additiv
-- Spalte + Backfill auf Default-Org + DEFAULT current_org_id() + Index
-- (noch keine RLS-Änderung; nicht brechend)
-- ============================================================
do $$
declare
  t text;
  orgid uuid := (select id from public.organizations where slug = 'bau4you');
  tbls text[] := array[
    'contacts','projects','project_log','catalog_items','offers','invoices','invoice_offers',
    'invoice_items','time_entries','tasks','automations','project_media','calc_audit_log',
    'trades','hourly_rates','articles','services','service_components','units','contact_persons',
    'project_participants','project_appointments','project_checklists','project_checklist_items',
    'number_ranges','orders','order_items','text_blocks','document_templates','media_categories',
    'project_types','project_statuses','company_settings','mail_templates','employees',
    'buak_calendar','document_types','documents','offer_display_settings','offer_types',
    'document_subtypes','roles','role_permissions','role_scopes','user_roles','user_access',
    'user_permission_overrides','user_scope_overrides','perm_audit_log'
  ];
begin
  foreach t in array tbls loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists organization_id uuid', t);
    execute format('update public.%I set organization_id = %L where organization_id is null', t, orgid);
    execute format('alter table public.%I alter column organization_id set default public.current_org_id()', t);
    execute format('create index if not exists %I on public.%I (organization_id)', 'idx_' || t || '_org', t);
  end loop;
end $$;
