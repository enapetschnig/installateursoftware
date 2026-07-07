-- Referenz Logbuch → Angebot (Historie bleibt, Link wird beim Löschen neutralisiert)
alter table public.project_log
  add column if not exists offer_id uuid references public.offers(id) on delete set null;

-- Einmaliges Cleanup: verwaiste, automatisch erzeugte Angebots-Logeinträge entfernen,
-- wenn das zugehörige Projekt keine Angebote mehr hat (Variante A für Test-/Entwurfsangebote).
delete from public.project_log pl
where pl.kind = 'angebot'
  and pl.offer_id is null
  and (pl.entry ilike 'Angebot %abgeschlossen%' or pl.entry ilike 'Angebot %versendet%' or pl.entry ilike 'Angebot %erstellt%')
  and not exists (select 1 from public.offers o where o.project_id = pl.project_id);
