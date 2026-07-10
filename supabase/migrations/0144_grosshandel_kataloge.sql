-- ============================================================
-- Installateur SuperAPP – Migration 0144
-- Großhandels-Kataloge (Datanorm): Artikel, Rabatte, Warengruppen, Metallkurse
-- ------------------------------------------------------------
-- Zweck:
--   Elektro-/Installateurbetriebe kalkulieren Material direkt über die
--   Preise ihres Großhändlers (z. B. Sonepar, Rexel, Holter). Der Händler
--   liefert Datanorm-Dateien: Artikelstamm (Listenpreise), kundenspezifische
--   Rabattgruppen und Netto-Sonderpreise. Diese Ebene ist bewusst GETRENNT
--   vom kuratierten Arbeits-Artikelstamm (public.articles):
--     • supplier_catalog_items  = read-only Preisquelle je Lieferant (100k–1M Artikel)
--     • articles       = eigene, gepflegte Artikel des Betriebs
--
--   Der EK wird NICHT beim Import eingefroren, sondern zur Abfragezeit
--   berechnet: nettopreis (Kundensonderpreis) sonst listenpreis × (1 − Rabatt).
--   Ein neues Rabattblatt ändert damit sofort alle Preise.
--
-- Suche: pg_trgm (word_similarity) über einen generierten Suchtext –
--   Grundlage für das Sprach-Angebot (Retrieval statt Prompt-Stuffing).
--
-- Mandantenfähigkeit: organization_id überall, RLS Post-0063-Standard.
-- ============================================================

create extension if not exists pg_trgm;

-- HINWEIS Altlast: Im Baseline-Schema existiert eine ungenutzte, leere Tabelle
-- public.catalog_items (B4Y-Rest, 0 Zeilen, keine Code-Referenz). Sie wird hier
-- bewusst NICHT gelöscht (destruktive Eingriffe nur nach Freigabe) – die neue
-- Katalog-Ebene heißt daher supplier_catalog_items.

-- ── 1) Kataloge (eine Zeile je Lieferant/Katalogstand) ─────
create table if not exists public.supplier_catalogs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.current_org_id()
                      references public.organizations(id) on delete cascade,
  name              text not null,                 -- z. B. "Sonepar Österreich"
  supplier_contact_id uuid references public.contacts(id) on delete set null,
  format            text not null default 'datanorm5',
  currency          text not null default 'EUR',
  valid_from        date,                          -- Datum aus dem Vorlaufsatz
  item_count        integer not null default 0,
  source_info       jsonb not null default '{}'::jsonb,  -- Dateinamen, Import-Statistik
  imported_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint supplier_catalogs_org_name_uq unique (organization_id, name)
);
comment on table public.supplier_catalogs is
  'Großhandels-Preiskataloge (Datanorm) je Lieferant. supplier_catalog_items hängen daran.';

-- ── 2) Katalog-Artikel ─────────────────────────────────────
create table if not exists public.supplier_catalog_items (
  id                bigint generated always as identity primary key,
  organization_id   uuid not null default public.current_org_id()
                      references public.organizations(id) on delete cascade,
  catalog_id        uuid not null references public.supplier_catalogs(id) on delete cascade,
  artikelnummer     text not null,
  kurztext1         text,
  kurztext2         text,
  matchcode         text,
  zusatz            text,             -- weitere Bezeichnungen (Serie/Typ) für die Suche
  einheit           text,             -- MTR, STK, …
  preiseinheit      integer not null default 1,   -- Preis gilt je N Einheiten (1/100/1000)
  listenpreis_cent  bigint,           -- Brutto-/Listenpreis in Cent je preiseinheit
  nettopreis_cent   bigint,           -- kundenspezifischer Nettopreis (DATPREIS), überschreibt Liste
  rabattgruppe      text,
  warengruppe       text,             -- Hauptgruppe (z. B. 10 = Kabel/Leitungen)
  untergruppe       text,
  ean               text,
  langtext_nr       text,
  metall            text,             -- CU/AL (Metallzuschlag, Z-Satz)
  metall_gewicht    numeric,          -- Rohwert aus Z-Satz (Gewicht je preiseinheit)
  metall_basis      numeric,          -- Rohwert Basis-Notierung aus Z-Satz
  updated_at        timestamptz not null default now(),
  -- Generierter Suchtext für die Trigram-Suche (Sprach-Angebot, Positionssuche).
  search            text generated always as (
    lower(coalesce(kurztext1,'') || ' ' || coalesce(kurztext2,'') || ' ' ||
          coalesce(matchcode,'') || ' ' || coalesce(zusatz,'') || ' ' || artikelnummer)
  ) stored,
  constraint supplier_catalog_items_org_cat_art_uq unique (organization_id, catalog_id, artikelnummer)
);
comment on table public.supplier_catalog_items is
  'Read-only Artikel des Großhandels-Katalogs (Datanorm A-/Z-Sätze). EK wird zur Abfragezeit aus Liste−Rabatt bzw. Nettopreis berechnet.';

create index if not exists supplier_catalog_items_search_trgm
  on public.supplier_catalog_items using gin (search gin_trgm_ops);
create index if not exists supplier_catalog_items_org_ean_idx
  on public.supplier_catalog_items (organization_id, ean) where ean is not null;

-- ── 3) Rabattgruppen (kundenspezifisch, aus .rab) ──────────
create table if not exists public.catalog_discounts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.current_org_id()
                      references public.organizations(id) on delete cascade,
  catalog_id        uuid not null references public.supplier_catalogs(id) on delete cascade,
  rabattgruppe      text not null,
  prozent           numeric(6,2) not null default 0,   -- 68.00 = 68 %
  bezeichnung       text,
  updated_at        timestamptz not null default now(),
  constraint catalog_discounts_uq unique (organization_id, catalog_id, rabattgruppe)
);

-- ── 4) Warengruppen (aus .wrg) ─────────────────────────────
create table if not exists public.catalog_groups (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.current_org_id()
                      references public.organizations(id) on delete cascade,
  catalog_id        uuid not null references public.supplier_catalogs(id) on delete cascade,
  hauptgruppe       text not null,
  untergruppe       text,
  bezeichnung       text,
  constraint catalog_groups_uq unique (organization_id, catalog_id, hauptgruppe, untergruppe)
);

-- ── 5) Metallkurse (Kupfer/Alu, aus Metallbasis.csv) ───────
create table if not exists public.catalog_metal_rates (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.current_org_id()
                      references public.organizations(id) on delete cascade,
  catalog_id        uuid not null references public.supplier_catalogs(id) on delete cascade,
  metall            text not null,           -- CU, AL
  kurs              numeric not null,        -- Rohwert des Händlers
  stand             date,
  constraint catalog_metal_rates_uq unique (organization_id, catalog_id, metall)
);
comment on table public.catalog_metal_rates is
  'Metallbasis-Notierungen des Händlers. Die Zuschlagsformel (Kurs, Basis, Gewicht) wird gegen eine echte Händlerrechnung verifiziert, bevor sie automatisch aufgeschlagen wird.';

-- ── 6) updated_at-Trigger ──────────────────────────────────
drop trigger if exists trg_supplier_catalogs_touch on public.supplier_catalogs;
create trigger trg_supplier_catalogs_touch before update on public.supplier_catalogs
  for each row execute function public.tg_marketing_touch();

-- ── 7) RLS (Post-0063-Standard) ────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['supplier_catalogs','supplier_catalog_items','catalog_discounts','catalog_groups','catalog_metal_rates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_app_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_org_isolation', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (organization_id = public.current_org_id())
         with check (organization_id = public.current_org_id())',
      t || '_org_isolation', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 8) Katalog-Suche (RPC, für Sprach-Angebot + Positionssuche) ──
-- Liefert die passendsten Artikel inkl. berechnetem EK je EINER Einheit.
-- SECURITY INVOKER: RLS (org-Isolation) greift automatisch.
create or replace function public.catalog_search(p_query text, p_limit integer default 12)
returns table (
  artikelnummer  text,
  bezeichnung    text,
  einheit        text,
  ek_cent        numeric,     -- Einkaufspreis in Cent je 1 Einheit (Rabatt/Netto eingerechnet)
  listen_cent    numeric,     -- Listenpreis in Cent je 1 Einheit
  rabatt_prozent numeric,
  warengruppe    text,
  ean            text,
  metall         text,
  score          real
)
language sql
security invoker
stable
set search_path = pg_catalog, public
as $$
  with q as (select lower(trim(p_query)) as query)
  select
    ci.artikelnummer,
    trim(coalesce(ci.kurztext1,'') || ' ' || coalesce(ci.kurztext2,'')) as bezeichnung,
    ci.einheit,
    round(
      coalesce(ci.nettopreis_cent::numeric,
               ci.listenpreis_cent::numeric * (1 - coalesce(cd.prozent,0) / 100))
      / greatest(ci.preiseinheit,1), 4) as ek_cent,
    round(ci.listenpreis_cent::numeric / greatest(ci.preiseinheit,1), 4) as listen_cent,
    coalesce(cd.prozent, 0) as rabatt_prozent,
    ci.warengruppe,
    ci.ean,
    ci.metall,
    greatest(
      word_similarity((select query from q), ci.search),
      -- exakte Artikelnummer/EAN schlägt jede Textähnlichkeit
      case when ci.artikelnummer = trim(p_query) or ci.ean = trim(p_query) then 1.0 else 0 end
    )::real as score
  from public.supplier_catalog_items ci
  left join public.catalog_discounts cd
    on cd.organization_id = ci.organization_id
   and cd.catalog_id = ci.catalog_id
   and cd.rabattgruppe = ci.rabattgruppe
  where (select query from q) <% ci.search
     or ci.artikelnummer = trim(p_query)
     or ci.ean = trim(p_query)
  order by score desc, ci.listenpreis_cent asc nulls last
  limit least(greatest(p_limit,1), 40);
$$;

grant execute on function public.catalog_search(text, integer) to authenticated;
