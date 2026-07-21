-- ============================================================
-- Installateur SuperAPP – Migration 0164
-- CRM: gemeinsame Phasen-Achse + Vorgangs-Sicht + Nachfass-Automatik
-- ------------------------------------------------------------
-- Ziel: EIN Board zeigt alles, was gerade in der Schwebe ist – neue
-- Anfragen, laufende Projekte (in den Stufen ihrer Projektart) und offene
-- Angebote ohne Projekt.
--
-- Problem dabei: Jede Projektart hat eigene Stufen (Badsanierung 16,
-- Service & Reparatur 6). Ein gemeinsames Board braucht daher eine
-- übergeordnete ACHSE, auf die alle Stufen abgebildet werden:
--
--   neu → qualifizierung → angebot → auftrag → umsetzung → abschluss
--   (+ verloren)
--
-- Die Zuordnung Stufe → Phase ist konfigurierbar (Spalte crm_phase), die
-- Achse selbst ist fix – sonst könnte das Board keine gemeinsame Reihenfolge
-- bilden. Beim Filter auf eine Projektart zeigt das Board weiterhin die
-- ECHTEN Stufen dieser Art; nur die "Alle"-Ansicht nutzt die Phasen.
-- ============================================================

-- ── 1) Phasen-Achse an den Stufen ──
alter table public.project_statuses_global
  add column if not exists crm_phase text;
alter table public.crm_pipeline_stages
  add column if not exists crm_phase text;

comment on column public.project_statuses_global.crm_phase is
  'Übergeordnete CRM-Phase (neu|qualifizierung|angebot|auftrag|umsetzung|abschluss|verloren) für die projektartübergreifende Board-Ansicht.';

-- Projekt-Stufen automatisch einordnen (danach in den Einstellungen änderbar).
update public.project_statuses_global set crm_phase = case
    when label ilike 'anfrage%'                                        then 'neu'
    when label ilike 'besichtigung%' or label ilike 'planung%'
      or label ilike 'terminiert%'                                     then 'qualifizierung'
    when label ilike 'angebot%'                                        then 'angebot'
    when label ilike 'auftrag%'                                        then 'auftrag'
    when label ilike 'abgeschlossen%' or label ilike 'verrechnet%'
      or label ilike 'übergabe%'                                       then 'abschluss'
    when label ilike 'storniert%' or label ilike 'verloren%'           then 'verloren'
    else 'umsetzung'
  end
 where crm_phase is null;

-- Anfragen-Stufen (aus Migration 0163) auf dieselbe Achse legen.
update public.crm_pipeline_stages set crm_phase = case
    when is_lost                       then 'verloren'
    when is_won                        then 'auftrag'
    when slug = 'neu'                  then 'neu'
    when slug = 'angebot'              then 'angebot'
    else 'qualifizierung'
  end
 where crm_phase is null;

-- ── 2) Nachfass-Automatik: Einstellungen ──
alter table public.company_settings
  add column if not exists crm_nachfass_tage   integer,
  add column if not exists crm_nachfass_aktiv  boolean;

comment on column public.company_settings.crm_nachfass_tage is
  'Tage nach Angebotsversand, bis die Nachfass-Erinnerung erscheint (Default 5).';
comment on column public.company_settings.crm_nachfass_aktiv is
  'Nachfass-Automatik aktiv? Der Versand erfolgt IMMER erst nach Freigabe durch den Anwender.';

update public.company_settings
   set crm_nachfass_tage = coalesce(crm_nachfass_tage, 5),
       crm_nachfass_aktiv = coalesce(crm_nachfass_aktiv, true);

-- ── 3) Nachfass-Vorgänge ──
-- Ein Datensatz je Angebot, das nachgefasst werden soll. Der Entwurf wird
-- vorbereitet, GESENDET WIRD ERST NACH FREIGABE (Anwender-Entscheidung
-- 2026-07-21) – deshalb der explizite Status-Übergang bereit → gesendet.
create table if not exists public.crm_nachfass (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id()
                    references public.organizations(id) on delete cascade,
  offer_id        uuid not null references public.offers(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  project_id      uuid references public.projects(id) on delete set null,
  faellig_am      date not null,
  -- geplant   = wartet auf Fälligkeit
  -- bereit    = Entwurf liegt vor, wartet auf Freigabe
  -- gesendet  = vom Anwender freigegeben und verschickt
  -- erledigt  = Kunde hat sich gemeldet / Angebot entschieden
  -- abgebrochen = bewusst gestoppt
  status          text not null default 'geplant',
  mail_betreff    text,
  mail_text       text,
  entwurf_am      timestamptz,
  gesendet_am     timestamptz,
  gesendet_von    uuid references auth.users(id) on delete set null,
  notiz           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, offer_id)
);

create index if not exists crm_nachfass_faellig_idx
  on public.crm_nachfass (organization_id, status, faellig_am);

alter table public.crm_nachfass enable row level security;
drop policy if exists crm_nachfass_app_all on public.crm_nachfass;
create policy crm_nachfass_app_all on public.crm_nachfass
  for all to authenticated using (true) with check (true);
drop policy if exists crm_nachfass_org_isolation on public.crm_nachfass;
create policy crm_nachfass_org_isolation on public.crm_nachfass
  as restrictive for all to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));
grant select, insert, update, delete on public.crm_nachfass to authenticated;

-- ── 4) Nachfass automatisch planen, sobald ein Angebot versendet wird ──
create or replace function public.crm_plane_nachfass()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tage integer;
  v_aktiv boolean;
begin
  -- Nur beim Übergang "noch nie versendet" → "versendet".
  if new.sent_at is null or old.sent_at is not null then
    return new;
  end if;

  select coalesce(crm_nachfass_tage, 5), coalesce(crm_nachfass_aktiv, true)
    into v_tage, v_aktiv
    from public.company_settings limit 1;

  if not coalesce(v_aktiv, true) or new.contact_id is null then
    return new;
  end if;

  insert into public.crm_nachfass
    (organization_id, offer_id, contact_id, project_id, faellig_am, status)
  values
    (new.organization_id, new.id, new.contact_id, new.project_id,
     (new.sent_at::date + coalesce(v_tage, 5)), 'geplant')
  on conflict (organization_id, offer_id) do nothing;

  return new;
end $$;

drop trigger if exists trg_crm_plane_nachfass on public.offers;
create trigger trg_crm_plane_nachfass
  after update of sent_at on public.offers
  for each row execute function public.crm_plane_nachfass();

-- Nachfassen erledigen, sobald das Angebot entschieden ist.
create or replace function public.crm_nachfass_abschliessen()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status is distinct from old.status
     and lower(coalesce(new.status, '')) in ('angenommen', 'beauftragt', 'abgelehnt', 'storniert') then
    update public.crm_nachfass
       set status = 'erledigt', updated_at = now()
     where offer_id = new.id and status in ('geplant', 'bereit');
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_nachfass_abschliessen on public.offers;
create trigger trg_crm_nachfass_abschliessen
  after update of status on public.offers
  for each row execute function public.crm_nachfass_abschliessen();

-- ── 5) DIE Vorgangs-Sicht: alles was offen ist, auf einer Achse ──
-- Drei Quellen, bewusst überschneidungsfrei:
--   a) Anfragen OHNE Projekt (sonst zeigt das Projekt den Vorgang)
--   b) Projekte (nicht archiviert)
--   c) Angebote OHNE Projekt (sonst doppelt)
drop view if exists public.crm_vorgaenge;
create view public.crm_vorgaenge
with (security_invoker = true) as
-- a) Anfragen, die noch zu keinem Projekt geführt haben
select
  a.id                                            as vorgang_id,
  'anfrage'::text                                 as quelle,
  a.organization_id,
  coalesce(nullif(a.subject, ''), 'Anfrage')      as titel,
  a.related_contact_id                            as contact_id,
  coalesce(c.company, nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), a.caller_name) as kunde,
  null::uuid                                      as project_id,
  null::text                                      as projektart,
  coalesce(s.label, 'Neu')                        as stufe,
  coalesce(s.crm_phase, 'neu')                    as phase,
  coalesce(s.sort_order, 0)                       as stufe_sort,
  a.expected_value_net                            as wert_netto,
  a.expected_close_date                           as termin,
  coalesce(a.call_started_at, a.created_at)       as datum,
  '/crm/anfragen/' || a.id::text                  as route,
  a.assigned_to                                   as zustaendig,
  a.related_contact_id is null                    as unzugeordnet
from public.anfragen a
left join public.contacts c on c.id = a.related_contact_id
left join public.crm_pipeline_stages s on s.id = a.pipeline_stage_id
where a.related_project_id is null
  and coalesce(a.status, '') <> 'archiviert'

union all
-- b) Projekte in den Stufen ihrer Projektart
select
  p.id,
  'projekt',
  p.organization_id,
  coalesce(nullif(p.title, ''), 'Projekt') || coalesce(' · ' || p.project_number, ''),
  p.contact_id,
  coalesce(c.company, nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '')),
  p.id,
  p.category,
  coalesce(nullif(p.stage, ''), 'Anfrage'),
  coalesce(g.crm_phase, 'umsetzung'),
  coalesce(g.sort_order, 50),
  p.budget,
  p.end_date,
  coalesce(p.start_at, p.created_at),
  '/projekte/' || p.id::text,
  null::uuid,
  false
from public.projects p
left join public.contacts c on c.id = p.contact_id
left join public.project_statuses_global g
       on g.organization_id = p.organization_id and g.label = p.stage
where coalesce(p.archived, false) = false

union all
-- c) Offene Angebote ohne Projekt (sonst über das Projekt sichtbar)
select
  o.id,
  'angebot',
  o.organization_id,
  'Angebot ' || coalesce(o.number, '') || coalesce(' · ' || o.title, ''),
  o.contact_id,
  coalesce(c.company, nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '')),
  null::uuid,
  null::text,
  case when o.sent_at is not null then 'Angebot gesendet' else 'Angebot in Arbeit' end,
  'angebot',
  4,
  o.net,
  null::date,
  coalesce(o.sent_at, o.created_at),
  '/angebote/' || o.id::text,
  null::uuid,
  false
from public.offers o
left join public.contacts c on c.id = o.contact_id
where o.project_id is null
  and o.deleted_at is null
  and o.archived_at is null
  and lower(coalesce(o.status, '')) not in ('angenommen', 'abgelehnt', 'storniert', 'archiviert');

grant select on public.crm_vorgaenge to authenticated;
