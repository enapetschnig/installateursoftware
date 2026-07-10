-- ============================================================
-- Installateur SuperAPP – Migration 0147
-- catalog_search: GIN-Index greift (Variable statt CTE-Subquery als Operand)
-- ------------------------------------------------------------
-- Timeout-Fix Teil 3: `(select …) <% search` verhinderte die Indexnutzung –
-- als plpgsql-Variable (Parameter) nutzt der Planner den GIN-Trigram-Index.
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
security invoker
stable
set search_path = pg_catalog, public
as $$
declare
  v_org uuid := public.current_org_id();
  -- WICHTIG: als Variable, nicht als CTE-Subquery – nur mit einem
  -- Parameter-Operanden nutzt der Planner den GIN-Trigram-Index
  -- (mit `(select …) <% search` fiel er auf einen Seq-Scan über
  -- 641k Zeilen zurück → statement_timeout).
  v_query text := lower(trim(p_query));
begin
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

grant execute on function public.catalog_search(text, integer) to authenticated;
