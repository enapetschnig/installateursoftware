-- ============================================================
-- Installateur SuperAPP – Migration 0148
-- catalog_search: SECURITY DEFINER (Timeout-Fix, endgültig)
-- ------------------------------------------------------------
-- Befund (EXPLAIN unter authenticated): Unter RLS verwirft der Planner den
-- GIN-Trigram-Index, weil der nicht-leakproof <%-Operator nicht vor dem
-- Security-Qual ausgewertet werden darf → Seq-Scan über 641k Zeilen ×
-- word_similarity() ≈ 14 s → statement_timeout. Ohne RLS: 0,34 s.
--
-- Lösung (Standard-Muster für Suche auf großen RLS-Tabellen):
--   SECURITY DEFINER – die Funktion läuft als Owner (RLS greift nicht),
--   erzwingt die Mandanten-Isolation aber SELBST als harten Filter:
--   organization_id = public.current_org_id()  (liest auth.uid() aus dem
--   JWT des AUFRUFERS – auch im Definer-Kontext korrekt).
--   Kein Query-Parameter kann diesen Filter umgehen; zurückgegeben werden
--   ausschließlich Katalogfelder der eigenen Organisation.
-- ============================================================

create or replace function public.catalog_search(p_query text, p_limit integer default 12)
returns table (
  artikelnummer  text,
  bezeichnung    text,
  einheit        text,
  ek_cent        numeric,
  listen_cent    numeric,
  rabatt_prozent numeric,
  warengruppe    text,
  ean            text,
  metall         text,
  score          real
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_org uuid := public.current_org_id();
  v_query text := lower(trim(p_query));
begin
  -- Ohne Organisation (kein/ungültiges JWT) niemals Daten liefern.
  if v_org is null then
    return;
  end if;

  perform word_similarity('a', 'a');
  perform set_config('pg_trgm.word_similarity_threshold', '0.40', true);

  return query
  with hits as (
    (select ci.*, word_similarity(v_query, ci.search)::real as s
       from public.supplier_catalog_items ci
      where ci.organization_id = v_org
        and v_query <% ci.search
      order by word_similarity(v_query, ci.search) desc
      limit 60)
    union all
    (select ci.*, 1.0::real as s
       from public.supplier_catalog_items ci
      where ci.organization_id = v_org
        and ci.artikelnummer = trim(p_query))
    union all
    (select ci.*, 1.0::real as s
       from public.supplier_catalog_items ci
      where ci.organization_id = v_org
        and ci.ean = trim(p_query))
  ),
  best as (
    select distinct on (h.id) h.*
      from hits h
     order by h.id, h.s desc
  )
  select
    b.artikelnummer,
    trim(coalesce(b.kurztext1,'') || ' ' || coalesce(b.kurztext2,'')) as bezeichnung,
    b.einheit,
    round(
      coalesce(b.nettopreis_cent::numeric,
               b.listenpreis_cent::numeric * (1 - coalesce(cd.prozent,0) / 100))
      / greatest(b.preiseinheit,1), 4) as ek_cent,
    round(b.listenpreis_cent::numeric / greatest(b.preiseinheit,1), 4) as listen_cent,
    coalesce(cd.prozent, 0) as rabatt_prozent,
    b.warengruppe,
    b.ean,
    b.metall,
    b.s as score
  from best b
  left join public.catalog_discounts cd
    on cd.organization_id = b.organization_id
   and cd.catalog_id = b.catalog_id
   and cd.rabattgruppe = b.rabattgruppe
  order by b.s desc, b.listenpreis_cent asc nulls last
  limit least(greatest(p_limit,1), 40);
end;
$$;

revoke all on function public.catalog_search(text, integer) from public;
grant execute on function public.catalog_search(text, integer) to authenticated;
grant execute on function public.catalog_search(text, integer) to service_role;
