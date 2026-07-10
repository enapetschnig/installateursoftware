-- ============================================================
-- Installateur SuperAPP – Migration 0152
-- Katalog-Schreibrechte: nur Admin / settings.company-edit
-- ------------------------------------------------------------
-- Befund (Review 2026-07-10): Die Katalogtabellen hatten seit 0144 eine
-- permissive FOR-ALL-Policy (`_app_all`, using true) – JEDER eingeloggte
-- Org-Benutzer konnte per direktem PostgREST-Call Katalogdaten ändern,
-- inkl. sender_domains (Migr. 0151), die steuern, wessen Preis-Mails
-- automatisch angewendet werden. Das UI-Gating (canManage) ist nur Kosmetik.
--
-- Fix nach dem company_settings-Muster (Baseline "mod"/"sel"):
--   * Lesen: alle authentifizierten Org-Mitglieder (Angebots-/Positionssuche)
--   * Schreiben: b4y_is_admin ODER b4y_has_permission('settings.company','edit')
--   * Die restriktive `_org_isolation`-Policy (0146) bleibt unverändert.
-- Service-Role (Import-Skript, Mail-Poller) umgeht RLS ohnehin.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['supplier_catalogs','supplier_catalog_items','catalog_discounts','catalog_groups','catalog_metal_rates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_sel', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), ''settings.company'', ''edit''))
         with check (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), ''settings.company'', ''edit''))',
      t || '_mod', t);
  end loop;
end $$;
