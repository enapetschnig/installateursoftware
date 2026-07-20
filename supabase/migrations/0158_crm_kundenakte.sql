-- ============================================================
-- Installateur SuperAPP – Migration 0158
-- CRM: Kundenakte (Kontaktereignisse, Aktivitätsarten, Kennzahlen)
-- ------------------------------------------------------------
-- Anwenderwunsch: "bei jedem Kunden sehen, wann ich ihn kontaktiert habe
-- und was besprochen wurde."
--
-- GRUNDIDEE – so wenig neuer Speicher wie möglich:
-- Rund 70 % der Kundenhistorie liegt bereits in der Datenbank (Angebote,
-- Aufträge, Rechnungen, Projekte, Termine, Anfragen inkl. Anruf-Transkript,
-- Regieberichte, Mails). Diese Daten werden NICHT kopiert, sondern über die
-- View `contact_timeline` zusammengeführt – dadurch ist die Kundenakte ab
-- dem ersten Tag rückwirkend gefüllt, ohne Datenmigration und ohne die
-- Gefahr doppelter Wahrheiten.
-- Neu gespeichert wird nur, was heute NIRGENDS existiert: menschliche
-- Kontaktereignisse (Telefonat, Gespräch, Notiz, ausgehende Mail).
--
-- Warum keine bestehende Tabelle reicht: `anfrage_events` hängt hart an
-- `anfragen`, `project_log` an `projects`. Ein Bestandskunde ohne offene
-- Anfrage und ohne Projekt hat heute keine Möglichkeit für "am 3.5.
-- telefoniert, will Zählerkasten tauschen". `contacts.notes` ist ein
-- einzelnes überschreibbares Freitextfeld – keine Historie.
-- ============================================================

-- ── 1) Aktivitätsarten (mandantenfähig konfigurierbar, KEINE CHECK-Liste) ──
create table if not exists public.crm_activity_types (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default public.current_org_id()
                     references public.organizations(id) on delete cascade,
  slug             text not null,
  label            text not null,
  icon             text,
  color            text,
  direction_default text check (direction_default is null or direction_default in ('in','out','intern')),
  -- zählt als "Kundenkontakt" (setzt contacts.last_contact_at)? Eine interne
  -- Notiz ist eine Aktivität, aber kein Kontakt mit dem Kunden.
  counts_as_contact boolean not null default true,
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (organization_id, slug)
);

-- ── 2) Kontaktereignisse: das Gedächtnis der Kundenbeziehung ──
create table if not exists public.contact_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.current_org_id()
                      references public.organizations(id) on delete cascade,
  contact_id        uuid not null references public.contacts(id) on delete cascade,
  contact_person_id uuid references public.contact_persons(id) on delete set null,
  project_id        uuid references public.projects(id) on delete set null,
  anfrage_id        uuid references public.anfragen(id) on delete set null,
  activity_type_id  uuid references public.crm_activity_types(id) on delete restrict,
  direction         text check (direction is null or direction in ('in','out','intern')),
  subject           text,
  note              text,                                   -- was besprochen wurde
  occurred_at       timestamptz not null default now(),      -- fachliches Datum ≠ created_at
  duration_minutes  integer,
  transcript        text,
  -- Herkunft: manuell erfasst oder automatisch erzeugt. source_ref_id ist der
  -- Idempotenz-Anker (z. B. incoming_mails.id) gegen Doppeleinträge beim
  -- erneuten Mail-Polling.
  source            text not null default 'manual',
  source_ref_id     uuid,
  payload           jsonb not null default '{}'::jsonb,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now()
);

create index if not exists contact_events_contact_idx
  on public.contact_events (organization_id, contact_id, occurred_at desc);
create index if not exists contact_events_project_idx
  on public.contact_events (project_id) where project_id is not null;
create unique index if not exists contact_events_source_uidx
  on public.contact_events (organization_id, source, source_ref_id)
  where source_ref_id is not null;

-- ── 3) Kontakt-Erweiterungen (additiv) ──
alter table public.contacts
  add column if not exists owner_id         uuid references auth.users(id) on delete set null,
  add column if not exists last_contact_at  timestamptz,
  add column if not exists next_followup_at timestamptz,
  add column if not exists crm_rating       text;

comment on column public.contacts.owner_id is 'Betreuer/zuständiger Mitarbeiter (CRM).';
comment on column public.contacts.last_contact_at is 'Letzter Kundenkontakt – Trigger aus contact_events (nur Arten mit counts_as_contact).';
comment on column public.contacts.next_followup_at is 'Nächste offene Wiedervorlage – gespiegelt aus tasks.';
comment on column public.contacts.crm_rating is 'Kundenbewertung (z. B. A/B/C), Werte frei konfigurierbar.';

-- ── 4) Wiedervorlagen = Aufgaben mit Kundenbezug (kein zweites Modul) ──
alter table public.tasks
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
create index if not exists tasks_contact_idx
  on public.tasks (organization_id, contact_id, done, due_date)
  where contact_id is not null;

-- ── 5) last_contact_at / next_followup_at automatisch pflegen ──
create or replace function public.crm_touch_last_contact()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_counts boolean;
begin
  select coalesce(t.counts_as_contact, true) into v_counts
    from public.crm_activity_types t where t.id = new.activity_type_id;
  if coalesce(v_counts, true) then
    update public.contacts
       set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at)
     where id = new.contact_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_touch_last_contact on public.contact_events;
create trigger trg_crm_touch_last_contact
  after insert on public.contact_events
  for each row execute function public.crm_touch_last_contact();

create or replace function public.crm_sync_next_followup()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_contact uuid := coalesce(new.contact_id, old.contact_id);
begin
  if v_contact is not null then
    update public.contacts c
       set next_followup_at = (
         select min(t.due_date)::timestamptz from public.tasks t
          where t.contact_id = v_contact and coalesce(t.done, false) = false and t.due_date is not null)
     where c.id = v_contact;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_crm_sync_next_followup on public.tasks;
create trigger trg_crm_sync_next_followup
  after insert or update or delete on public.tasks
  for each row execute function public.crm_sync_next_followup();

-- ── 6) RLS (Standard-Muster: permissiv app_all + restriktive Org-Isolation) ──
do $$
declare t text;
begin
  foreach t in array array['crm_activity_types','contact_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_app_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_org_isolation', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (organization_id = (select public.current_org_id()))
         with check (organization_id = (select public.current_org_id()))',
      t || '_org_isolation', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 7) Startkonfiguration Aktivitätsarten (änderbar in den Einstellungen) ──
insert into public.crm_activity_types (organization_id, slug, label, icon, color, direction_default, counts_as_contact, sort_order)
select o.id, v.slug, v.label, v.icon, v.color, v.dir, v.counts, v.ord
  from public.organizations o
 cross join (values
   ('telefon_ein',  'Telefonat (eingehend)',  'phone-incoming', 'blue',   'in',     true,  10),
   ('telefon_aus',  'Telefonat (ausgehend)',  'phone-outgoing', 'blue',   'out',    true,  20),
   ('mail_ein',     'E-Mail (eingehend)',     'mail',           'violet', 'in',     true,  30),
   ('mail_aus',     'E-Mail (ausgehend)',     'send',           'violet', 'out',    true,  40),
   ('vor_ort',      'Vor-Ort-Termin',         'map-pin',        'green',  'out',    true,  50),
   ('besprechung',  'Besprechung',            'users',          'green',  'intern', true,  60),
   ('notiz',        'Notiz',                  'sticky-note',    'slate',  'intern', false, 70),
   ('reklamation',  'Reklamation',            'alert-triangle', 'red',    'in',     true,  80),
   ('wiedervorlage','Wiedervorlage besprochen','clock',         'amber',  'out',    true,  90)
 ) as v(slug, label, icon, color, dir, counts, ord)
 where not exists (
   select 1 from public.crm_activity_types t
    where t.organization_id = o.id and t.slug = v.slug);
