-- ============================================================
-- B4Y SuperAPP – Migration 0079
-- Eigene Nummer + Nummernkreis für Ansprechpartner (contact_persons).
-- Additiv, idempotent, datenbewahrend. Mandantenfähig: pro Organisation
-- ein eigener Nummernkreis 'ansprechpartner' (Standard AP-0001, ohne Jahr,
-- in den Einstellungen frei änderbar). Format identisch zur RPC
-- next_document_number (prefix + separator + lpad(nummer, min_digits)).
-- ============================================================

-- 1) Spalte für die Ansprechpartner-Nummer (sichtbar in der Kontaktliste).
alter table public.contact_persons
  add column if not exists contact_number text;

-- 2) Nummernkreis 'ansprechpartner' je Organisation anlegen, die noch keinen hat.
--    (NOT EXISTS statt ON CONFLICT, um nicht von einem bestimmten Constraint abzuhängen.)
insert into public.number_ranges
  (doc_type, label, prefix, use_year, separator, min_digits, next_number, active, protected, organization_id)
select 'ansprechpartner', 'Ansprechpartner', 'AP', false, '-', 4, 1, true, true, o.organization_id
from (select distinct organization_id from public.number_ranges) o
where not exists (
  select 1 from public.number_ranges x
  where x.organization_id = o.organization_id and x.doc_type = 'ansprechpartner'
);

-- 3) Backfill: bestehende Ansprechpartner ohne Nummer fortlaufend je Organisation
--    nummerieren (AP-0001, AP-0002, …) – exakt im Format der RPC.
with seq as (
  select cp.id,
         cp.organization_id,
         row_number() over (partition by cp.organization_id order by cp.created_at, cp.id) as rn
  from public.contact_persons cp
  where cp.contact_number is null
)
update public.contact_persons cp
set contact_number = 'AP-' || lpad(seq.rn::text, 4, '0'),
    updated_at = now()
from seq
where cp.id = seq.id;

-- 4) next_number des Kreises je Organisation auf „bereits vergebene + 1" setzen,
--    damit der nächste echte RPC-Aufruf nicht kollidiert.
update public.number_ranges nr
set next_number = greatest(nr.next_number, sub.cnt + 1), updated_at = now()
from (
  select organization_id, count(*) as cnt
  from public.contact_persons
  where contact_number is not null
  group by organization_id
) sub
where nr.doc_type = 'ansprechpartner' and nr.organization_id = sub.organization_id;

-- 5) Eindeutigkeit je Organisation absichern (nur wo eine Nummer gesetzt ist – Bestand
--    ohne Nummer bleibt erlaubt; neue Ansprechpartner ziehen im Code immer eine Nummer).
create unique index if not exists contact_persons_org_number_uniq
  on public.contact_persons (organization_id, contact_number)
  where contact_number is not null;
