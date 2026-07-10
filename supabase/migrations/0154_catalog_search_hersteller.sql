-- ============================================================
-- Installateur SuperAPP – Migration 0154
-- catalog_search: Hersteller + Hersteller-Artikelnummer ausgeben
-- ------------------------------------------------------------
-- In den Datanorm-Daten steckt der Hersteller im Feld `zusatz` (erstes Wort:
-- KAISER, BERKER, MERTEN, ABB …) und der `matchcode` ist die HERSTELLER-
-- Artikelnummer (z. B. MEG2301-0419). Beides gehört sichtbar in Angebots-
-- Stücklisten und den Editor-Picker – der Anwender bestellt danach.
-- Return-Typ ändert sich → DROP + CREATE (wie 0149). Sicherheitsmodell
-- unverändert: SECURITY DEFINER mit hartem Org-Filter aus dem JWT.
-- ============================================================

drop function if exists public.catalog_search(text, integer, uuid);

create function public.catalog_search(
  p_query text,
  p_limit integer default 12,
  p_catalog_id uuid default null
)
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
  score          real,
  catalog_id     uuid,
  katalog_name   text,
  hersteller     text,
  hersteller_artnr text
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
        and (p_catalog_id is null or ci.catalog_id = p_catalog_id)
        and v_query <% ci.search
      order by word_similarity(v_query, ci.search) desc
      limit 60)
    union all
    (select ci.*, 1.0::real as s
       from public.supplier_catalog_items ci
      where ci.organization_id = v_org
        and (p_catalog_id is null or ci.catalog_id = p_catalog_id)
        and ci.artikelnummer = trim(p_query))
    union all
    (select ci.*, 1.0::real as s
       from public.supplier_catalog_items ci
      where ci.organization_id = v_org
        and (p_catalog_id is null or ci.catalog_id = p_catalog_id)
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
    b.s as score,
    b.catalog_id,
    sc.name as katalog_name,
    nullif(split_part(coalesce(b.zusatz,''), ' ', 1), '') as hersteller,
    nullif(trim(coalesce(b.matchcode,'')), '') as hersteller_artnr
  from best b
  left join public.supplier_catalogs sc
    on sc.id = b.catalog_id
  left join public.catalog_discounts cd
    on cd.organization_id = b.organization_id
   and cd.catalog_id = b.catalog_id
   and cd.rabattgruppe = b.rabattgruppe
  order by b.s desc, b.listenpreis_cent asc nulls last
  limit least(greatest(p_limit,1), 40);
end;
$$;

revoke all on function public.catalog_search(text, integer, uuid) from public;
grant execute on function public.catalog_search(text, integer, uuid) to authenticated;
grant execute on function public.catalog_search(text, integer, uuid) to service_role;
