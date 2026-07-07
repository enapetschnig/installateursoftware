-- 0095_trades_sort_order_data_aligned.sql
-- Feinkorrektur der Gewerk-Sortiernummer: 0094 hatte pauschal +1 gerechnet; bei Gewerken
-- mit Luecken (z. B. Reinigung=13, Elektrozuleitung=16) passte das nicht zu den tatsaechlich
-- vergebenen Leistungs-/Artikel-Nummern. Diese Migration richtet trades.sort_order
-- DATENGETRIEBEN am haeufigsten Nummern-Praefix der zugehoerigen services/articles aus.
--
-- Vorgehen je Mandant (idempotent, sicher):
--  1) sort_order temporaer +1000 (kollisionsfreies Umsortieren)
--  2) Gewerke MIT Nummern: sort_order = haeufigster Praefix (mode) ihrer services/articles
--  3) Gewerke OHNE Nummern: auf die naechsten freien Luecken setzen
--  4) Dublettenpruefung je Mandant -> bei Konflikt Abbruch (RAISE EXCEPTION = Rollback).
-- service_number/article_number werden NICHT veraendert (sind bereits korrekt); trade_id-
-- Referenzen (hourly_rates/Titel/Texte/services/articles) bleiben unberuehrt.
do $$
begin
  update public.trades set sort_order = sort_order + 1000 where sort_order < 1000;

  with pfx as (
    select trade_id, substring(service_number from '^[0-9]{2}')::int as p
      from public.services where service_number ~ '^[0-9]{2}-'
    union all
    select trade_id, substring(article_number from '^[0-9]{2}')::int
      from public.articles where article_number ~ '^[0-9]{2}-'
  ), m as (
    select trade_id, mode() within group (order by p) as p from pfx group by trade_id
  )
  update public.trades t set sort_order = m.p from m where m.trade_id = t.id;

  with leer as (
    select id, organization_id,
           row_number() over (partition by organization_id order by sort_order) as rn
      from public.trades where sort_order > 1000
  ), frei as (
    select o.organization_id, g.num,
           row_number() over (partition by o.organization_id order by g.num) as rn
      from (select distinct organization_id from public.trades) o
      cross join generate_series(1, 200) as g(num)
     where not exists (
       select 1 from public.trades x
        where x.organization_id is not distinct from o.organization_id
          and x.sort_order = g.num and x.sort_order < 1000
     )
  )
  update public.trades t set sort_order = f.num
    from leer l join frei f
      on f.organization_id is not distinct from l.organization_id and f.rn = l.rn
   where t.id = l.id;

  if exists (
    select 1 from public.trades
     group by organization_id, sort_order having count(*) > 1
  ) then
    raise exception 'Gewerk sort_order Dublette nach Backfill – Abbruch (keine Aenderung)';
  end if;
end $$;
