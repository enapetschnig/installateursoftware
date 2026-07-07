-- ============================================================
-- Mandantenfähigkeit Phase 3: Mandanten-Isolation via RESTRICTIVE RLS
-- AND-verknüpft mit bestehenden Rechte-Policies (diese bleiben unberührt).
-- Solange nur eine Org existiert, ist dies für die Live-App transparent.
-- ============================================================
do $$
declare
  t text;
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
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='org_isolation') then
      execute format(
        'create policy "org_isolation" on public.%I as restrictive for all to authenticated '
        || 'using (organization_id = public.current_org_id() or organization_id is null) '
        || 'with check (organization_id = public.current_org_id() or organization_id is null)', t);
    end if;
  end loop;
end $$;
