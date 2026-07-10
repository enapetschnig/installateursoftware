-- ============================================================
-- Installateur SuperAPP – Migration 0145
-- catalog_search: Performance-Fix (Timeout als authenticated-Rolle)
-- ------------------------------------------------------------
-- Problem: Das OR über drei Suchwege (Trigram / Artikelnummer / EAN) in
-- catalog_search verhinderte die Indexnutzung → Seq-Scan über 641k Zeilen
-- mit CPU-teurem word_similarity() → statement_timeout (8 s) der
-- authenticated-Rolle. Als Service-Role (ohne Timeout) unauffällig.
--
-- Fix:
--   • UNION ALL aus drei getrennten, je index-freundlichen Zweigen
--     (GIN-Trigram via <% ; btree für Artikelnummer; Partial-Index für EAN).
--   • Neuer btree-Index (organization_id, artikelnummer).
--   • word_similarity-Schwelle je Funktion auf 0.40 gesenkt (gesprochene
--     Suchphrasen matchen selten mit Default 0.60).
-- ============================================================

create index if not exists supplier_catalog_items_org_artnr_idx
  on public.supplier_catalog_items (organization_id, artikelnummer);

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
begin
  -- pg_trgm-Bibliothek laden (registriert deren GUCs), dann Schwelle
  -- TRANSAKTIONS-LOKAL senken: gesprochene Suchphrasen matchen selten mit
  -- dem Default 0.60. (SET im Funktionskopf scheitert an Supabase-Rechten
  -- für Extension-Parameter, set_config ist erlaubt.)
  perform word_similarity('a', 'a');
  perform set_config('pg_trgm.word_similarity_threshold', '0.40', true);

  return query
  with q as (select lower(trim(p_query)) as query),
  hits as (
    -- 1) Fuzzy-Textsuche (GIN-Trigram, nutzt <%-Operator)
    (select ci.*, word_similarity((select query from q), ci.search)::real as s
       from public.supplier_catalog_items ci
      where (select query from q) <% ci.search
      order by word_similarity((select query from q), ci.search) desc
      limit 60)
    union all
    -- 2) Exakte Artikelnummer (btree)
    (select ci.*, 1.0::real as s
       from public.supplier_catalog_items ci
      where ci.artikelnummer = trim(p_query))
    union all
    -- 3) Exakte EAN (Partial-Index)
    (select ci.*, 1.0::real as s
       from public.supplier_catalog_items ci
      where ci.ean = trim(p_query))
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
