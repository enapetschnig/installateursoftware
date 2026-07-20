-- ============================================================
-- Installateur SuperAPP – Migration 0159
-- CRM: Zeitstrahl-View + Kunden-Kennzahlen
-- ------------------------------------------------------------
-- `contact_timeline` führt ALLE Berührungspunkte mit einem Kontakt zu einem
-- Zeitstrahl zusammen – ohne Daten zu kopieren. Dadurch ist die Kundenakte
-- ab dem ersten Tag rückwirkend über die gesamte Firmenhistorie gefüllt.
--
-- security_invoker = true: die RLS der Quelltabellen greift unverändert
-- (Org-Isolation + Rechte). Die View selbst speichert nichts.
--
-- Abfrage-Vertrag: IMMER mit `.eq('contact_id', …)` filtern – die View ist
-- als Kundenakte gedacht, nicht als globaler Firmen-Feed.
-- ============================================================

-- Eingehende Mails brauchen einen Kundenbezug (Zuordnung folgt in 0160).
alter table public.incoming_mails
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
create index if not exists incoming_mails_contact_idx
  on public.incoming_mails (organization_id, contact_id, received_at desc)
  where contact_id is not null;

drop view if exists public.contact_timeline;
create view public.contact_timeline
with (security_invoker = true) as
-- a) Manuell/automatisch erfasste Kontaktereignisse (Telefonat, Notiz, Mail-Ausgang)
select
  e.contact_id,
  e.occurred_at                                as occurred_at,
  'ereignis'::text                             as kind,
  coalesce(t.label, 'Kontakt')                 as title,
  nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as subtitle,
  coalesce(e.subject, '') || case when e.subject is not null and e.note is not null then E'\n' else '' end || coalesce(e.note, '') as note,
  null::numeric                                as amount_gross,
  e.direction                                  as status,
  null::text                                   as route,
  e.id                                         as ref_id,
  t.slug                                       as type_slug,
  t.color                                      as color,
  t.icon                                       as icon,
  e.duration_minutes                           as duration_minutes,
  e.created_by                                 as created_by,
  e.organization_id                            as organization_id
from public.contact_events e
left join public.crm_activity_types t on t.id = e.activity_type_id
left join public.contact_persons p   on p.id = e.contact_person_id

union all
-- b) Belege (Angebot/Auftrag/Rechnung/…) – aus der bestehenden Dokument-Sicht
select
  d.customer_id,
  coalesce(d.doc_date::timestamptz, d.created_at),
  'dokument',
  coalesce(d.type_name, 'Dokument') || coalesce(' ' || d.doc_number, ''),
  nullif(d.title, ''),
  nullif(d.project_title, ''),
  d.gross,
  d.status_norm,
  case d.kind
    when 'offer'   then '/angebote/'   || d.id::text
    when 'order'   then '/auftraege/'  || d.id::text
    when 'invoice' then '/rechnungen/' || d.id::text
    else null end,
  d.id,
  'dokument_' || coalesce(d.kind, 'sonstige'),
  case d.status_norm when 'bezahlt' then 'green' when 'storniert' then 'red' else 'blue' end,
  'file-text',
  null::integer,
  null::uuid,
  d.organization_id
from public.documents_unified d
where d.customer_id is not null

union all
-- c) Anfragen (inkl. KI-Zusammenfassung und Anruf-Transkript)
select
  a.related_contact_id,
  coalesce(a.call_started_at, a.created_at),
  'anfrage',
  coalesce(nullif(a.subject, ''), 'Anfrage'),
  a.source,
  coalesce(nullif(a.ai_summary, ''), nullif(a.description, ''), nullif(a.transcript, '')),
  null::numeric,
  a.status,
  '/anfragen/' || a.id::text,
  a.id,
  'anfrage',
  'amber',
  'inbox',
  case when a.duration_seconds is not null then (a.duration_seconds / 60)::integer else null end,
  a.assigned_to,
  a.organization_id
from public.anfragen a
where a.related_contact_id is not null

union all
-- d) Termine der Plantafel
select
  pe.contact_id,
  pe.start_at,
  'termin',
  coalesce(nullif(pe.title, ''), 'Termin'),
  nullif(pe.location, ''),
  nullif(pe.description, ''),
  null::numeric,
  case when pe.done_at is not null then 'erledigt' else pe.status end,
  '/plantafel',
  pe.id,
  'termin',
  'green',
  'calendar',
  null::integer,
  pe.created_by,
  pe.organization_id
from public.planning_events pe
where pe.contact_id is not null

union all
-- e) Regieberichte
select
  r.contact_id,
  coalesce(r.datum::timestamptz, r.created_at),
  'regie',
  'Regiebericht ' || coalesce(r.report_number, ''),
  case when r.stunden is not null then r.stunden::text || ' Std' else null end,
  coalesce(nullif(r.beschreibung, ''), nullif(r.notizen, '')),
  null::numeric,
  r.status,
  '/regieberichte/' || r.id::text,
  r.id,
  'regie',
  'violet',
  'clipboard-list',
  null::integer,
  r.created_by,
  r.organization_id
from public.regie_reports r
where r.contact_id is not null and r.deleted_at is null

union all
-- f) Eingegangene Mails (Zuordnung über contact_id, siehe 0160)
select
  m.contact_id,
  coalesce(m.received_at, m.created_at),
  'mail',
  coalesce(nullif(m.subject, ''), 'E-Mail'),
  m.from_email,
  coalesce(nullif(m.ai_summary, ''), nullif(m.body_snippet, '')),
  null::numeric,
  m.status,
  '/email',
  m.id,
  'mail_ein',
  'violet',
  'mail',
  null::integer,
  null::uuid,
  m.organization_id
from public.incoming_mails m
where m.contact_id is not null

union all
-- g) Projekte (Anlage)
select
  pr.contact_id,
  coalesce(pr.start_at, pr.created_at),
  'projekt',
  'Projekt ' || coalesce(pr.project_number, '') || coalesce(' – ' || pr.title, ''),
  pr.stage,
  nullif(pr.description, ''),
  pr.budget,
  pr.stage,
  '/projekte/' || pr.id::text,
  pr.id,
  'projekt',
  'blue',
  'folder-kanban',
  null::integer,
  pr.created_by,
  pr.organization_id
from public.projects pr
where pr.contact_id is not null and coalesce(pr.archived, false) = false

union all
-- h) Wiedervorlagen/Aufgaben mit Kundenbezug
select
  tk.contact_id,
  coalesce(tk.due_date::timestamptz, tk.created_at),
  'aufgabe',
  coalesce(nullif(tk.title, ''), 'Aufgabe'),
  case when coalesce(tk.done, false) then 'erledigt' else 'offen' end,
  nullif(tk.description, ''),
  null::numeric,
  case when coalesce(tk.done, false) then 'erledigt' else 'offen' end,
  '/aufgaben',
  tk.id,
  'aufgabe',
  case when coalesce(tk.done, false) then 'slate' else 'amber' end,
  'check-square',
  null::integer,
  tk.assignee_id,
  tk.organization_id
from public.tasks tk
where tk.contact_id is not null;

grant select on public.contact_timeline to authenticated;

-- ── Kennzahlen je Kunde (immer aktuell, daher View statt Spalten) ──
drop view if exists public.contact_crm_stats;
create view public.contact_crm_stats
with (security_invoker = true) as
select
  c.id as contact_id,
  c.organization_id,
  count(*) filter (where d.kind = 'offer')                                             as offers_count,
  count(*) filter (where d.kind = 'offer' and d.status_norm in ('offen','versendet','entwurf')) as offers_open_count,
  coalesce(sum(d.net)  filter (where d.kind = 'offer' and d.status_norm in ('offen','versendet')), 0) as offers_open_net,
  count(*) filter (where d.kind = 'order')                                             as orders_count,
  count(*) filter (where d.kind = 'invoice')                                           as invoices_count,
  coalesce(sum(d.net)  filter (where d.kind = 'invoice' and coalesce(d.is_canceled,false) = false), 0) as revenue_net_total,
  coalesce(sum(d.net)  filter (where d.kind = 'invoice' and coalesce(d.is_canceled,false) = false
                                 and d.doc_date >= (current_date - interval '12 months')), 0)        as revenue_net_12m,
  coalesce(sum(d.gross) filter (where d.kind = 'invoice' and coalesce(d.is_canceled,false) = false
                                 and coalesce(d.payment_status,'') <> 'bezahlt'), 0)                 as open_receivables_gross,
  min(d.doc_date) as first_document_at,
  max(d.doc_date) as last_document_at
from public.contacts c
left join public.documents_unified d on d.customer_id = c.id
group by c.id, c.organization_id;

grant select on public.contact_crm_stats to authenticated;
