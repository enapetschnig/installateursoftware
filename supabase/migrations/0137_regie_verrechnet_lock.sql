-- ============================================================
-- Installateursoftware – Migration 0137: Regie-Verrechnet-Sperre (RLS)
--
-- Schließt eine Autorisierungslücke aus 0134: Nutzer mit
-- regiestunden/edit konnten JEDEN Regiebericht der Firma ändern –
-- auch bereits als verrechnet markierte. Analog zum bestehenden
-- Buchhaltungs-Lock (0027) wird die Bearbeitung verrechneter Berichte
-- jetzt auf Administratoren beschränkt (DB-seitig, nicht nur im UI).
--
-- Der Verrechnet-Umschalter bleibt möglich: die USING-Klausel wertet
-- die ALTE Zeile aus (noch is_verrechnet=false), die WITH-CHECK-Klausel
-- lässt den Übergang auf true zu. Ein späteres Ändern der dann
-- verrechneten Zeile ist für Nicht-Admins gesperrt. Idempotent.
-- ============================================================

-- ---------- regie_reports: UPDATE-Policy verschärfen ----------
drop policy if exists "upd" on public.regie_reports;
create policy "upd" on public.regie_reports for update to authenticated
  using (
    b4y_is_admin(auth.uid())
    or (b4y_has_permission(auth.uid(), 'regiestunden', 'edit') and is_verrechnet = false)
    or (created_by = auth.uid() and is_verrechnet = false)
  )
  with check (
    b4y_is_admin(auth.uid())
    or b4y_has_permission(auth.uid(), 'regiestunden', 'edit')
    or created_by = auth.uid()
  );

-- ---------- Untertabellen: Änderungen an verrechneten Berichten sperren ----------
do $$
declare t text;
begin
  foreach t in array array['regie_report_materials','regie_report_workers','regie_report_photos'] loop
    execute format('drop policy if exists "mod" on public.%I', t);
    execute format(
      'create policy "mod" on public.%I for all to authenticated using (
         exists (select 1 from public.regie_reports r where r.id = %I.report_id
                   and (b4y_is_admin(auth.uid())
                        or (b4y_has_permission(auth.uid(), ''regiestunden'', ''edit'') and r.is_verrechnet = false)
                        or (r.created_by = auth.uid() and r.is_verrechnet = false))))
       with check (
         exists (select 1 from public.regie_reports r where r.id = %I.report_id
                   and (b4y_is_admin(auth.uid())
                        or (b4y_has_permission(auth.uid(), ''regiestunden'', ''edit'') and r.is_verrechnet = false)
                        or (r.created_by = auth.uid() and r.is_verrechnet = false))))', t, t, t);
  end loop;
end $$;
