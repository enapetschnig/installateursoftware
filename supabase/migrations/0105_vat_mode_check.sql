-- ============================================================
-- 0105 – CHECK-Constraint für vat_mode (Härtung, Codex-Finding PR #98)
-- ------------------------------------------------------------
-- vat_mode wurde in 0104 als freier text angelegt. Damit direkte API-/SQL-Zugriffe
-- keine ungültigen Werte schreiben können, wird der Wertebereich serverseitig auf
-- 'standard' | 'par19' eingeschränkt. Additiv, datenbewahrend (Bestand ist bereits
-- gültig durch den 0104-Backfill). Idempotent über DO-Block.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['offers','orders','invoices','sub_orders'] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = ('public.' || t)::regclass
        and conname = t || '_vat_mode_check'
    ) then
      execute format(
        'alter table public.%I add constraint %I check (vat_mode in (''standard'',''par19''))',
        t, t || '_vat_mode_check'
      );
    end if;
  end loop;
end $$;
