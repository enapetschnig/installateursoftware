-- ============================================================
-- Installateur SuperAPP – Migration 0163
-- CRM: Verkaufschancen-Pipeline (Kanban) auf Basis der Anfragen
-- ------------------------------------------------------------
-- Bewusst KEINE eigene Lead-Tabelle: eine Verkaufschance IST eine Anfrage,
-- die sich über Stufen bewegt (Neu → Qualifiziert → Angebot → Auftrag).
-- Eine zweite Tabelle würde dieselben Daten doppelt führen und die
-- bestehende Anfragen-/Angebots-Kette zerschneiden.
--
-- Stufen sind Daten, keine CHECK-Liste – jede Firma kann ihre eigene
-- Pipeline definieren (Projektregel: nichts hartcodieren).
-- ============================================================

create table if not exists public.crm_pipeline_stages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null default public.current_org_id()
                        references public.organizations(id) on delete cascade,
  slug                text not null,
  label               text not null,
  color               text,
  sort_order          integer not null default 0,
  -- Endstufen: gewonnen/verloren zählen nicht als "offene Chance" und
  -- steuern die Trefferquote.
  is_won              boolean not null default false,
  is_lost             boolean not null default false,
  default_probability integer,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (organization_id, slug)
);

alter table public.anfragen
  add column if not exists pipeline_stage_id   uuid references public.crm_pipeline_stages(id) on delete set null,
  add column if not exists expected_value_net  numeric(14,2),
  add column if not exists probability         integer,
  add column if not exists expected_close_date date,
  add column if not exists lost_reason         text,
  add column if not exists stage_changed_at    timestamptz;

create index if not exists anfragen_pipeline_idx
  on public.anfragen (organization_id, pipeline_stage_id, expected_close_date);

comment on column public.anfragen.expected_value_net is 'Erwarteter Auftragswert netto – Basis für die gewichtete Pipeline-Summe.';
comment on column public.anfragen.probability is 'Abschluss-Wahrscheinlichkeit in % (Vorbelegung aus der Stufe).';

-- ── RLS wie im Standard ──
do $$
declare t text := 'crm_pipeline_stages';
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
  execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_app_all', t);
  execute format('drop policy if exists %I on public.%I', t || '_org_isolation', t);
  execute format(
    'create policy %I on public.%I as restrictive for all to authenticated
       using (organization_id = (select public.current_org_id()))
       with check (organization_id = (select public.current_org_id()))',
    t || '_org_isolation', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
end $$;

-- ── Stufenwechsel im Kundenverlauf festhalten ──
-- Hier ist ein contact_events-Eintrag richtig: ein Stufenwechsel hat KEINE
-- eigene Quelle in der Zeitstrahl-View (anders als Mails/Anrufe).
create or replace function public.crm_log_stage_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_alt text;
  v_neu text;
  v_type uuid;
begin
  if new.pipeline_stage_id is distinct from old.pipeline_stage_id then
    new.stage_changed_at := now();
    if new.related_contact_id is not null then
      select label into v_alt from public.crm_pipeline_stages where id = old.pipeline_stage_id;
      select label into v_neu from public.crm_pipeline_stages where id = new.pipeline_stage_id;
      select id into v_type from public.crm_activity_types
       where organization_id = new.organization_id and slug = 'notiz' limit 1;
      insert into public.contact_events
        (organization_id, contact_id, activity_type_id, direction, subject, note,
         occurred_at, anfrage_id, source)
      values
        (new.organization_id, new.related_contact_id, v_type, 'intern',
         'Verkaufschance: ' || coalesce(v_alt, 'ohne Stufe') || ' → ' || coalesce(v_neu, 'ohne Stufe'),
         nullif(new.lost_reason, ''),
         now(), new.id, 'status');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_log_stage_change on public.anfragen;
create trigger trg_crm_log_stage_change
  before update on public.anfragen
  for each row execute function public.crm_log_stage_change();

-- ── Startkonfiguration der Pipeline (frei änderbar) ──
insert into public.crm_pipeline_stages (organization_id, slug, label, color, sort_order, is_won, is_lost, default_probability)
select o.id, v.slug, v.label, v.color, v.ord, v.won, v.lost, v.prob
  from public.organizations o
 cross join (values
   ('neu',           'Neu',              'blue',   10, false, false, 10),
   ('qualifiziert',  'Qualifiziert',     'amber',  20, false, false, 30),
   ('besichtigung',  'Besichtigung',     'amber',  30, false, false, 50),
   ('angebot',       'Angebot gelegt',   'violet', 40, false, false, 70),
   ('gewonnen',      'Gewonnen',         'green',  50, true,  false, 100),
   ('verloren',      'Verloren',         'red',    60, false, true,  0)
 ) as v(slug, label, color, ord, won, lost, prob)
 where not exists (
   select 1 from public.crm_pipeline_stages s
    where s.organization_id = o.id and s.slug = v.slug);

-- Bestehende Anfragen auf eine sinnvolle Stufe setzen (aus dem Status abgeleitet).
update public.anfragen a
   set pipeline_stage_id = s.id
  from public.crm_pipeline_stages s
 where a.pipeline_stage_id is null
   and s.organization_id = a.organization_id
   and s.slug = case a.status
         when 'neu'              then 'neu'
         when 'in_arbeit'        then 'qualifiziert'
         when 'qualifiziert'     then 'qualifiziert'
         when 'kontakt_erstellt' then 'gewonnen'
         when 'abgewiesen'       then 'verloren'
         else 'neu' end;
