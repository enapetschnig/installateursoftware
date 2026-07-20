-- ============================================================
-- Installateur SuperAPP – Migration 0160
-- CRM: automatische Kundenzuordnung (Mail + Telefon)
-- ------------------------------------------------------------
-- Damit sich die Kundenakte OHNE Mehrarbeit füllt, werden eingehende Mails
-- und Anrufe automatisch dem richtigen Kontakt zugeordnet. Die Zuordnung
-- liegt bewusst in SQL-Funktionen, damit ALLE Einlieferwege (IMAP-Poller,
-- Webhook, UI) dieselbe Logik nutzen.
--
-- Grundsatz: Bei Mehrdeutigkeit lieber NICHT zuordnen (NULL) als falsch –
-- eine falsch zugeordnete Mail in der Kundenakte ist schlimmer als eine
-- fehlende.
-- ============================================================

-- ── 1) Kontakt über E-Mail-Adresse finden ──
-- Sucht in contacts.email, contacts.invoice_email und contact_persons.email.
-- Rückgabe NULL, wenn nichts oder mehr als ein Kontakt passt.
create or replace function public.crm_match_contact_by_email(p_email text, p_org uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  v_mail text := lower(trim(p_email));
  v_id uuid;
  v_anzahl integer;
begin
  if v_org is null or v_mail is null or v_mail = '' or position('@' in v_mail) = 0 then
    return null;
  end if;

  with treffer as (
    select c.id
      from public.contacts c
     where c.organization_id = v_org
       and (lower(trim(coalesce(c.email, ''))) = v_mail
         or lower(trim(coalesce(c.invoice_email, ''))) = v_mail)
    union
    select p.contact_id
      from public.contact_persons p
     where p.organization_id = v_org
       and lower(trim(coalesce(p.email, ''))) = v_mail
       and p.contact_id is not null
  )
  select count(distinct id), min(id) into v_anzahl, v_id from treffer;

  if v_anzahl = 1 then
    return v_id;
  end if;
  return null;  -- 0 Treffer oder mehrdeutig
end $$;

-- ── 2) Kontakt über Telefonnummer finden ──
-- Normalisiert auf die letzten 9 Ziffern (robust gegen +43/0043/0-Präfixe,
-- Leerzeichen, Klammern und Bindestriche).
create or replace function public.crm_normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '')
$$;

create or replace function public.crm_match_contact_by_phone(p_phone text, p_org uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  v_norm text := public.crm_normalize_phone(p_phone);
  v_id uuid;
  v_anzahl integer;
begin
  if v_org is null or v_norm is null or length(v_norm) < 7 then
    return null;
  end if;

  with treffer as (
    select c.id
      from public.contacts c
     where c.organization_id = v_org
       and (public.crm_normalize_phone(c.phone) = v_norm
         or public.crm_normalize_phone(c.mobile) = v_norm)
    union
    select p.contact_id
      from public.contact_persons p
     where p.organization_id = v_org
       and p.contact_id is not null
       and (public.crm_normalize_phone(p.phone) = v_norm
         or public.crm_normalize_phone(p.mobile) = v_norm)
  )
  select count(distinct id), min(id) into v_anzahl, v_id from treffer;

  if v_anzahl = 1 then
    return v_id;
  end if;
  return null;
end $$;

-- ── 3) Eingehende Mails automatisch zuordnen (Trigger) ──
-- Greift für JEDEN Einlieferweg (IMAP-Poller, Graph, Webhook) und schreibt
-- zusätzlich ein Kontaktereignis, damit die Mail im Zeitstrahl erscheint.
create or replace function public.crm_assign_incoming_mail()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_contact uuid;
  v_type uuid;
begin
  if new.contact_id is null then
    new.contact_id := public.crm_match_contact_by_email(new.from_email, new.organization_id);
  end if;

  if new.contact_id is not null then
    select id into v_type from public.crm_activity_types
     where organization_id = new.organization_id and slug = 'mail_ein' limit 1;
    -- Idempotent: der Unique-Index (org, source, source_ref_id) verhindert
    -- Doppeleinträge, wenn dieselbe Mail erneut gepollt wird.
    insert into public.contact_events
      (organization_id, contact_id, activity_type_id, direction, subject, note,
       occurred_at, source, source_ref_id)
    values
      (new.organization_id, new.contact_id, v_type, 'in', new.subject,
       coalesce(nullif(new.ai_summary, ''), nullif(new.body_snippet, '')),
       coalesce(new.received_at, now()), 'mail_in', new.id)
    on conflict do nothing;
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_assign_incoming_mail on public.incoming_mails;
create trigger trg_crm_assign_incoming_mail
  before insert on public.incoming_mails
  for each row execute function public.crm_assign_incoming_mail();

-- ── 4) Anfragen (inkl. Telefonanrufe über den Fonio-Webhook) zuordnen ──
-- anfragen.related_contact_id bleibt die fachliche Verknüpfung; sie wird
-- jetzt automatisch aus Telefonnummer bzw. E-Mail des Anrufers ermittelt.
create or replace function public.crm_assign_anfrage_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_type uuid;
  v_slug text;
begin
  if new.related_contact_id is null then
    new.related_contact_id := coalesce(
      public.crm_match_contact_by_phone(new.caller_phone, new.organization_id),
      public.crm_match_contact_by_email(new.caller_email, new.organization_id));
  end if;

  -- Telefonate zusätzlich als Kontaktereignis festhalten (mit Transkript),
  -- damit sie im Zeitstrahl als Gespräch erscheinen – nicht nur als Anfrage.
  if new.related_contact_id is not null and coalesce(new.source, '') in ('telefon', 'phone', 'fonio', 'anruf') then
    v_slug := case when coalesce(new.call_direction, 'in') = 'out' then 'telefon_aus' else 'telefon_ein' end;
    select id into v_type from public.crm_activity_types
     where organization_id = new.organization_id and slug = v_slug limit 1;
    insert into public.contact_events
      (organization_id, contact_id, activity_type_id, direction, subject, note, transcript,
       occurred_at, duration_minutes, anfrage_id, source, source_ref_id)
    values
      (new.organization_id, new.related_contact_id, v_type,
       case when coalesce(new.call_direction, 'in') = 'out' then 'out' else 'in' end,
       coalesce(nullif(new.subject, ''), 'Telefonat'),
       coalesce(nullif(new.ai_summary, ''), nullif(new.description, '')),
       new.transcript,
       coalesce(new.call_started_at, new.created_at, now()),
       case when new.duration_seconds is not null then greatest(1, (new.duration_seconds / 60)::integer) else null end,
       new.id, 'call', new.id)
    on conflict do nothing;
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_assign_anfrage_contact on public.anfragen;
create trigger trg_crm_assign_anfrage_contact
  before insert on public.anfragen
  for each row execute function public.crm_assign_anfrage_contact();

grant execute on function public.crm_match_contact_by_email(text, uuid) to authenticated, service_role;
grant execute on function public.crm_match_contact_by_phone(text, uuid) to authenticated, service_role;
grant execute on function public.crm_normalize_phone(text) to authenticated, service_role;

-- ── 5) Bestandsdaten nachziehen: bereits vorhandene Mails zuordnen ──
update public.incoming_mails m
   set contact_id = public.crm_match_contact_by_email(m.from_email, m.organization_id)
 where m.contact_id is null;
