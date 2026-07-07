-- 0127_reset_keep_contacts.sql
-- ------------------------------------------------------------------------------
-- Datenreset überarbeitet (ersetzt die Funktionen aus 0125 per create or replace;
-- KEINE automatische Datenlöschung – diese Migration ändert nur Funktionen):
--   NEU: Kontakte, Lieferanten, Subunternehmer und Ansprechpartner BLEIBEN ERHALTEN.
--   Gelöscht werden nur Projekte + alle Projekt-Kinder sowie alle Dokumente/Belege
--   + Dokumentketten der aktuellen Organisation.
--   Nummernkreise: Option setzt jetzt auch den Projekt-Kreis auf 1 (alle Projekte
--   werden gelöscht); NUR die Kontakt-Kreise (kunde, lieferant, subunternehmer,
--   ansprechpartner, sonstige) bleiben unverändert – die vergebenen Kontaktnummern
--   existieren weiter, ein Reset würde Kollisionen erzeugen.
--   Lücken geschlossen (Live-FK-Inventar 2026-07-06): projektbezogene time_entries,
--   planning_events und automation_runs haben ON DELETE SET NULL und würden sonst
--   verwaist zurückbleiben; project_signatures/tasks cascaden zwar, werden aber
--   explizit gelöscht und in der Vorschau gezählt.
--   Bewusst NICHT gelöscht (Referenzen werden per FK genullt): anfragen (Kontakt-
--   Posteingang), voice_transcripts + microsoft_mail_audit_log (Audit-Trails).
-- Sicherheit unverändert: security definer, org-scoped (current_org_id), Admin-Gate,
-- Bestätigung 'RESET', eine Transaktion (Rollback bei Fehler).

-- Dry-Run: Zähler der zu löschenden Daten + Info-Block, was erhalten bleibt.
create or replace function public.reset_test_data_preview()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Keine Organisation im Kontext.'; end if;
  return jsonb_build_object(
    'projects',         (select count(*) from public.projects         where organization_id = v_org),
    'offers',           (select count(*) from public.offers           where organization_id = v_org),
    'orders',           (select count(*) from public.orders           where organization_id = v_org),
    'sub_orders',       (select count(*) from public.sub_orders       where organization_id = v_org),
    'invoices',         (select count(*) from public.invoices         where organization_id = v_org),
    'documents',        (select count(*) from public.documents        where organization_id = v_org),
    'project_media',    (select count(*) from public.project_media    where organization_id = v_org),
    'project_log',      (select count(*) from public.project_log      where organization_id = v_org),
    'project_appointments', (select count(*) from public.project_appointments where organization_id = v_org),
    'project_meetings', (select count(*) from public.project_meetings where project_id in (select id from public.projects where organization_id = v_org)),
    'tasks',            (select count(*) from public.tasks            where project_id in (select id from public.projects where organization_id = v_org)),
    'time_entries',     (select count(*) from public.time_entries     where project_id in (select id from public.projects where organization_id = v_org)),
    'planning_events',  (select count(*) from public.planning_events  where project_id in (select id from public.projects where organization_id = v_org)),
    -- Bleibt erhalten (nur zur Anzeige, wird NICHT gelöscht):
    'kept_contacts',        (select count(*) from public.contacts        where organization_id = v_org),
    'kept_contact_persons', (select count(*) from public.contact_persons where organization_id = v_org)
  );
end $$;

-- Ausführung. p_confirm muss exakt 'RESET' sein.
-- p_reset_number_ranges = true → Projekt- UND Dokument-Nummernkreise auf 1;
-- Kontakt-Kreise (kunde/lieferant/subunternehmer/ansprechpartner/sonstige) bleiben.
create or replace function public.reset_test_data(p_confirm text, p_reset_number_ranges boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_before jsonb;
begin
  if v_org is null then raise exception 'Keine Organisation im Kontext.'; end if;
  if coalesce(p_confirm, '') <> 'RESET' then
    raise exception 'Bestätigung fehlt (erwartet: RESET).';
  end if;
  -- Nur Administratoren (Rolle mit is_admin) dürfen zurücksetzen.
  if not exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and coalesce(r.is_admin, false) = true
  ) then
    raise exception 'Nur Administratoren dürfen den Datenreset ausführen.';
  end if;

  v_before := public.reset_test_data_preview();

  -- 1) Beleg-Positionen / Verknüpfungen (Kinder zuerst; cascaden zwar, explizit = deterministisch).
  delete from public.order_items      where organization_id = v_org;
  delete from public.invoice_items    where organization_id = v_org;
  delete from public.invoice_offers   where organization_id = v_org;
  delete from public.sub_order_items  where sub_order_id in (select id from public.sub_orders where organization_id = v_org);

  -- 2) Versions-/Audit-Daten (kein FK – generisch source_table/source_id; immutable RLS,
  --    security definer als Owner kommt durch).
  delete from public.document_versions  where organization_id = v_org;
  delete from public.document_audit_log where organization_id = v_org;

  -- 3) Belege / Dokumente (Reihenfolge wahrt die Beleg-Kette).
  delete from public.invoices    where organization_id = v_org;
  delete from public.sub_orders  where organization_id = v_org;
  delete from public.orders      where organization_id = v_org;
  delete from public.offers      where organization_id = v_org;
  delete from public.documents   where organization_id = v_org;

  -- 4) Projekt-Kinder. FKs mit ON DELETE SET NULL würden verwaiste Zeilen hinterlassen
  --    (time_entries/planning_events/automation_runs) → explizit projektbezogen löschen.
  delete from public.project_checklist_items where organization_id = v_org;
  delete from public.project_checklists      where organization_id = v_org;
  delete from public.project_appointments    where organization_id = v_org;
  delete from public.project_participants    where organization_id = v_org;
  delete from public.project_media           where organization_id = v_org;
  delete from public.project_log             where organization_id = v_org;
  delete from public.project_meetings        where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.project_signatures      where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.tasks                   where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.time_entries            where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.planning_events         where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.automation_runs         where project_id in (select id from public.projects where organization_id = v_org);

  -- 5) Projekte. Kontakte + Ansprechpartner bleiben ERHALTEN (Referenzen aus
  --    gelöschten Belegen zeigen ohnehin nicht mehr auf sie; projects.contact_id
  --    verschwindet mit dem Projekt).
  delete from public.projects where organization_id = v_org;

  -- 6) Optional: Projekt- und Dokument-Nummernkreise auf 1. NUR Kontakt-Kreise bleiben,
  --    weil die Kontakte (und deren vergebene Nummern) bestehen bleiben.
  if p_reset_number_ranges then
    update public.number_ranges
      set next_number = 1, updated_at = now()
      where organization_id = v_org
        and lower(doc_type) not in ('kunde','lieferant','subunternehmer','ansprechpartner','sonstige')
        and next_number <> 1;
  end if;

  return jsonb_build_object('ok', true, 'organization_id', v_org, 'deleted', v_before,
    'number_ranges_reset', p_reset_number_ranges);
end $$;

revoke all on function public.reset_test_data_preview() from public;
revoke all on function public.reset_test_data(text, boolean) from public;
grant execute on function public.reset_test_data_preview() to authenticated;
grant execute on function public.reset_test_data(text, boolean) to authenticated;

notify pgrst, 'reload schema';
