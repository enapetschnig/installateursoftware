-- Zentrale Ausblendung soft-gelöschter Dokumente: restriktive SELECT-Policy.
-- Wirkt automatisch in ALLEN Lese-Abfragen (Listen, Projekt, Dashboard, Auswertungen, Suche),
-- ohne jede Query einzeln anpassen zu müssen. UPDATE/INSERT bleiben unberührt,
-- damit das Soft-Delete (deleted_at setzen) weiter funktioniert.
-- Editoren laden per id → gelöschte Zeile ist dann nicht sichtbar (null) → „nicht verfügbar".

do $$
declare t text;
begin
  foreach t in array array['offers','orders','invoices','documents'] loop
    execute format('drop policy if exists hide_soft_deleted on public.%I', t);
    execute format(
      'create policy hide_soft_deleted on public.%I as restrictive for select to authenticated using (deleted_at is null)',
      t);
  end loop;
end $$;
