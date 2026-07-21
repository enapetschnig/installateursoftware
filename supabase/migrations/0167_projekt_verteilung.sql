-- ============================================================
-- Installateur SuperAPP – Migration 0167
-- Projekt-Verteilung: Anzahl je Projektart und Stufe
-- ------------------------------------------------------------
-- Für die aufklappbare Projekt-Struktur (Projekte-Seite + Dashboard):
-- "Badsanierung → 3 in Besichtigung, 5 in Angebot gesendet, 2 in Umsetzung".
--
-- Warum eine View: PostgREST kann kein GROUP BY über .select(). Ohne View
-- bräuchte die Oberfläche 6 Arten × 17 Stufen = über 100 Zähl-Requests.
-- So ist es EIN Request mit unter 100 Zeilen.
-- security_invoker = true → die RLS von projects/orders greift unverändert.
-- ============================================================

create index if not exists idx_projects_org_category_stage
  on public.projects (organization_id, category, stage)
  where archived = false;

drop view if exists public.projekt_verteilung;
create view public.projekt_verteilung
with (security_invoker = true) as
with auftragswert as (
  select o.project_id, sum(coalesce(o.net, 0)) as netto
    from public.orders o
   where o.deleted_at is null
     and coalesce(o.status, '') <> 'storniert'
     and o.project_id is not null
   group by o.project_id
)
select
  p.organization_id,
  coalesce(nullif(p.category, ''), '(ohne Projektart)') as art,
  coalesce(nullif(p.stage, ''),    '(ohne Stufe)')      as stufe,
  count(*)::int                                         as anzahl,
  coalesce(sum(coalesce(a.netto, p.budget, 0)), 0)::numeric as volumen_netto
from public.projects p
left join auftragswert a on a.project_id = p.id
where coalesce(p.archived, false) = false
group by 1, 2, 3;

grant select on public.projekt_verteilung to authenticated;
