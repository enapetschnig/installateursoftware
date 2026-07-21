-- ============================================================
-- Installateur SuperAPP – Migration 0166
-- CRM: Stufe "Warte auf Angebotsbestätigung"
-- ------------------------------------------------------------
-- Zwischen "Angebot gesendet" und "Auftrag erhalten" fehlte die Realität:
-- Das Angebot ist beim Kunden, man wartet auf die Entscheidung. Genau in
-- dieser Stufe steht die Nachfass-Erinnerung an – deshalb liegt sie in der
-- Phase `angebot`.
--
-- Wird allen Projektarten zugeordnet, die eine "Angebot gesendet"-Stufe
-- haben (direkt danach einsortiert).
-- ============================================================

-- 1) Globale Stufe anlegen (je Organisation, idempotent)
insert into public.project_statuses_global (organization_id, label, color, sort_order, active, crm_phase)
select o.id, 'Warte auf Angebotsbestätigung', 'amber', 45, true, 'angebot'
  from public.organizations o
 where not exists (
   select 1 from public.project_statuses_global g
    where g.organization_id = o.id and g.label = 'Warte auf Angebotsbestätigung');

-- 2) Der neuen Stufe in jeder Projektart direkt nach "Angebot gesendet" Platz machen
--    (sort_order der Folgestufen um 1 anheben – nur dort, wo nötig).
with ziel as (
  select pts.project_type_id, pts.organization_id, pts.sort_order as ab_sort
    from public.project_type_statuses pts
    join public.project_statuses_global g on g.id = pts.status_id
   where g.label = 'Angebot gesendet' and pts.active
)
update public.project_type_statuses p
   set sort_order = p.sort_order + 1
  from ziel z
 where p.project_type_id = z.project_type_id
   and p.sort_order > z.ab_sort;

-- 3) Zuordnung anlegen
insert into public.project_type_statuses (organization_id, project_type_id, status_id, sort_order, active)
select z.organization_id, z.project_type_id, g.id, z.ab_sort + 1, true
  from (
    select pts.project_type_id, pts.organization_id, pts.sort_order as ab_sort
      from public.project_type_statuses pts
      join public.project_statuses_global gg on gg.id = pts.status_id
     where gg.label = 'Angebot gesendet' and pts.active
  ) z
  join public.project_statuses_global g
    on g.organization_id = z.organization_id and g.label = 'Warte auf Angebotsbestätigung'
 where not exists (
   select 1 from public.project_type_statuses x
    where x.project_type_id = z.project_type_id and x.status_id = g.id);
