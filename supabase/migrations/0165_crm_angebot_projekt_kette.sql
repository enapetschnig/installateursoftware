-- ============================================================
-- Installateur SuperAPP – Migration 0165
-- CRM: Angebot ↔ Kunde ↔ Projekt automatisch verketten
-- ------------------------------------------------------------
-- Anwenderwunsch: "Wenn man ein Angebot erstellt, soll der jeweilige Kunde
-- bzw. das Projekt in das Angebot gelegt werden."
--
-- Befund vorher: Nur 1 von 6 Angeboten hatte überhaupt ein Projekt. Der
-- Grund ist, dass Angebote an mehreren Stellen entstehen (Projekt, Dokumente-
-- Übersicht, Sprach-Angebot, Anfrage). Deshalb liegt die Logik als TRIGGER in
-- der Datenbank – dann greift sie an JEDEM Einstiegspunkt, auch bei künftigen.
--
-- Zusätzlich: Wird ein Angebot versendet, rückt das zugehörige Projekt
-- automatisch auf die Stufe "Angebot gesendet" – aber NUR vorwärts. Ein
-- Nachtrag zu einem laufenden Projekt darf die Baustelle nicht zurückwerfen.
-- ============================================================

-- ── 1) Kunde aus dem Projekt übernehmen, wenn er fehlt ──
create or replace function public.crm_offer_kunde_ergaenzen()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.contact_id is null and new.project_id is not null then
    select p.contact_id into new.contact_id
      from public.projects p where p.id = new.project_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_offer_kunde on public.offers;
create trigger trg_crm_offer_kunde
  before insert or update of project_id on public.offers
  for each row execute function public.crm_offer_kunde_ergaenzen();

-- Bestandsdaten nachziehen (Angebote mit Projekt, aber ohne Kunde).
update public.offers o
   set contact_id = p.contact_id
  from public.projects p
 where o.project_id = p.id
   and o.contact_id is null
   and p.contact_id is not null;

-- ── 2) Projektstufe beim Angebotsversand vorrücken ──
-- Reihenfolge der Phasen als Zahl, damit "nur vorwärts" prüfbar ist.
create or replace function public.crm_phase_rang(p_phase text)
returns integer
language sql
immutable
as $$
  select case p_phase
    when 'neu'            then 1
    when 'qualifizierung' then 2
    when 'angebot'        then 3
    when 'auftrag'        then 4
    when 'umsetzung'      then 5
    when 'abschluss'      then 6
    when 'verloren'       then 9
    else 0 end
$$;

create or replace function public.crm_projekt_stufe_bei_versand()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_type uuid;
  v_ziel_label   text;
  v_ist_rang     integer;
  v_ziel_rang    integer;
begin
  -- Nur beim ersten Versand und nur mit Projektbezug.
  if new.sent_at is null or old.sent_at is not null or new.project_id is null then
    return new;
  end if;

  -- Projektart des Projekts ermitteln (projects.category = Label der Art).
  select pt.id into v_project_type
    from public.projects p
    join public.project_types pt
      on pt.organization_id = p.organization_id and pt.label = p.category
   where p.id = new.project_id;

  -- Die "angebot"-Stufe dieser Projektart suchen (Label ist je Art konfigurierbar).
  select g.label into v_ziel_label
    from public.project_type_statuses pts
    join public.project_statuses_global g on g.id = pts.status_id
   where pts.project_type_id = v_project_type
     and pts.active
     and g.crm_phase = 'angebot'
   order by pts.sort_order
   limit 1;

  if v_ziel_label is null then
    return new;  -- Diese Projektart kennt keine Angebots-Stufe
  end if;

  -- Nur VORWÄRTS: laufende Baustellen nicht zurückwerfen.
  select public.crm_phase_rang(g.crm_phase) into v_ist_rang
    from public.projects p
    left join public.project_statuses_global g
      on g.organization_id = p.organization_id and g.label = p.stage
   where p.id = new.project_id;
  v_ziel_rang := public.crm_phase_rang('angebot');

  if coalesce(v_ist_rang, 0) < v_ziel_rang then
    update public.projects set stage = v_ziel_label where id = new.project_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_projekt_stufe_versand on public.offers;
create trigger trg_crm_projekt_stufe_versand
  after update of sent_at on public.offers
  for each row execute function public.crm_projekt_stufe_bei_versand();

-- ── 3) Angebotsversand im Kundenverlauf festhalten ──
-- Hat keine eigene Quelle im Zeitstrahl (documents_unified zeigt das Angebot,
-- aber nicht den Versandzeitpunkt) – deshalb hier ein Kontaktereignis.
create or replace function public.crm_log_angebot_versand()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_type uuid;
begin
  if new.sent_at is null or old.sent_at is not null or new.contact_id is null then
    return new;
  end if;
  select id into v_type from public.crm_activity_types
   where organization_id = new.organization_id and slug = 'mail_aus' limit 1;
  insert into public.contact_events
    (organization_id, contact_id, project_id, activity_type_id, direction,
     subject, note, occurred_at, source, source_ref_id)
  values
    (new.organization_id, new.contact_id, new.project_id, v_type, 'out',
     'Angebot ' || coalesce(new.number, '') || ' versendet',
     nullif(new.title, ''), new.sent_at, 'document', new.id)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_crm_log_angebot_versand on public.offers;
create trigger trg_crm_log_angebot_versand
  after update of sent_at on public.offers
  for each row execute function public.crm_log_angebot_versand();
