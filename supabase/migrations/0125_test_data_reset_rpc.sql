-- 0125_test_data_reset_rpc.sql
-- ------------------------------------------------------------------------------
-- Admin-sicherer, mandantenfähiger Testdaten-Reset als RPC (statt Einmal-Skript 0090).
-- Löscht NUR die aktuelle Organisation (current_org_id) und NUR Bewegungsdaten:
--   Kontakte (Kunden/Lieferanten/Sub/Ansprechpartner), Projekte + Projekt-Kinder,
--   alle Dokumente/Belege + Dokumentketten (offers/orders/sub_orders/invoices/documents
--   inkl. Positionen/Links/Versionen/Audit).
-- BLEIBT ERHALTEN: Mitarbeiter, Rollen/Rechte, Firmeneinstellungen, Signaturen, Stammdaten
--   (Leistungen/Artikel/Preise), Dokumentarten, Nummernkreise (optional zurücksetzbar),
--   Storage-Dateien (werden NICHT von der DB-Funktion gelöscht).
-- Sicherheit: security definer + interne Admin-Prüfung; läuft als eine Transaktion
--   (bei Fehler vollständiger Rollback → keine Teil-Löschung). Bestätigung/„RESET"-Eingabe
--   und Dry-Run-Anzeige erfolgen im Frontend.

-- Dry-Run: Anzahl der betroffenen Datensätze der aktuellen Org (löscht nichts).
create or replace function public.reset_test_data_preview()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Keine Organisation im Kontext.'; end if;
  return jsonb_build_object(
    'contacts',        (select count(*) from public.contacts        where organization_id = v_org),
    'contact_persons', (select count(*) from public.contact_persons where organization_id = v_org),
    'projects',        (select count(*) from public.projects        where organization_id = v_org),
    'offers',          (select count(*) from public.offers          where organization_id = v_org),
    'orders',          (select count(*) from public.orders          where organization_id = v_org),
    'sub_orders',      (select count(*) from public.sub_orders      where organization_id = v_org),
    'invoices',        (select count(*) from public.invoices        where organization_id = v_org),
    'documents',       (select count(*) from public.documents       where organization_id = v_org)
  );
end $$;

-- Ausführung des Resets. p_confirm muss exakt 'RESET' sein (zusätzliche Sicherung).
-- p_reset_number_ranges = true → Dokument-Nummernkreise (nicht Stammdaten-Kreise) auf 1.
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
  -- Nur Administratoren (Rolle mit is_admin) der eigenen Org dürfen zurücksetzen.
  if not exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and coalesce(r.is_admin, false) = true
  ) then
    raise exception 'Nur Administratoren dürfen den Datenreset ausführen.';
  end if;

  v_before := public.reset_test_data_preview();

  -- 1) Beleg-Positionen / Verknüpfungen (Kinder zuerst).
  delete from public.order_items      where organization_id = v_org;
  delete from public.invoice_items    where organization_id = v_org;
  delete from public.invoice_offers   where organization_id = v_org;
  delete from public.sub_order_items  where sub_order_id in (select id from public.sub_orders where organization_id = v_org);

  -- 2) Versions-/Audit-Daten (immutable RLS; security definer als Owner umgeht sie).
  delete from public.document_versions  where organization_id = v_org;
  delete from public.document_audit_log where organization_id = v_org;

  -- 3) Belege / Dokumente (Reihenfolge wahrt die Beleg-Kette).
  delete from public.invoices    where organization_id = v_org;
  delete from public.sub_orders  where organization_id = v_org;
  delete from public.orders      where organization_id = v_org;
  delete from public.offers      where organization_id = v_org;
  delete from public.documents   where organization_id = v_org;

  -- 4) Projekt-Kinder (project_meetings cascadet Kinder; per project_id gescoped).
  delete from public.project_checklist_items where organization_id = v_org;
  delete from public.project_checklists      where organization_id = v_org;
  delete from public.project_appointments    where organization_id = v_org;
  delete from public.project_participants    where organization_id = v_org;
  delete from public.project_media           where organization_id = v_org;
  delete from public.project_log             where organization_id = v_org;
  delete from public.project_meetings        where project_id in (select id from public.projects where organization_id = v_org);

  -- 5) Kontakt-Kinder.
  delete from public.contact_persons where organization_id = v_org;

  -- 6) Eltern.
  delete from public.projects where organization_id = v_org;
  delete from public.contacts where organization_id = v_org;

  -- 7) Optional: Dokument-Nummernkreise zurücksetzen (Stammdaten-/Kontakt-Kreise bleiben).
  if p_reset_number_ranges then
    update public.number_ranges
      set next_number = 1, updated_at = now()
      where organization_id = v_org
        and lower(doc_type) not in ('kunde','lieferant','subunternehmer','ansprechpartner','sonstige','projekt')
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
