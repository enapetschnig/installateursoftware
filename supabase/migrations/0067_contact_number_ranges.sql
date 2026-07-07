-- 0067_contact_number_ranges.sql
-- B4Y SuperAPP – Eigene Nummernkreise je Kontaktart + Backfill
-- ------------------------------------------------------------------------------
-- Ziel: Jede Kontaktart bekommt einen eigenen Nummernkreis (Prefix), Vergabe
-- atomar über public.next_document_number(doc_type). Bestehende Kontaktnummern
-- werden EINMALIG nach dem neuen Schema neu vergeben (Freigabe Lukasz).
--
-- Sicherheit: Dokumente referenzieren Kontakte über contact_id (FK), nicht über
-- die Kontaktnummer; PDF-Snapshots adressieren über Name/Adresse. Die Neuvergabe
-- ändert daher keine Dokumentverknüpfungen. Mandantenfähig (organization_id).

-- 1) Ranges für die übrigen Kontaktarten je Organisation anlegen (idempotent).
--    'kunde' existiert bereits (Prefix KUNDE).
insert into public.number_ranges
  (doc_type, label, prefix, separator, min_digits, use_year, next_number, active, protected, organization_id)
select v.doc_type, v.label, v.prefix, '-', 4, false, 1, true, false, o.id
from public.organizations o
cross join (values
  ('lieferant',      'Lieferanten',    'LIEFERANT'),
  ('subunternehmer', 'Subunternehmer', 'SUB'),
  ('partner',        'Partner',        'PARTNER'),
  ('sonstige',       'Sonstige',       'SONSTIGE')
) as v(doc_type, label, prefix)
on conflict do nothing;

-- 2) Bestehenden kunde-Kreis für Kontakte ohne Jahr (saubere Nummer KUNDE-0001) + Label.
update public.number_ranges
  set use_year = false,
      label = coalesce(nullif(label, ''), 'Kunden'),
      updated_at = now()
  where doc_type = 'kunde';

-- 3) EINMALIGER Backfill: Kontaktnummern je Org+Art deterministisch (nach created_at) neu vergeben.
with ranked as (
  select c.id, c.organization_id, c.type,
         row_number() over (partition by c.organization_id, c.type
                            order by c.created_at, c.id) as rn
  from public.contacts c
)
update public.contacts c
set contact_number = nr.prefix
       || case when coalesce(nr.separator, '') <> '' then nr.separator else '' end
       || lpad(r.rn::text, nr.min_digits, '0'),
    updated_at = now()
from ranked r
join public.number_ranges nr
  on nr.doc_type = r.type and nr.organization_id = r.organization_id
where c.id = r.id;

-- 4) Zähler je Range auf Anzahl+1 setzen (nächste Vergabe folgt sauber).
update public.number_ranges nr
set next_number = sub.cnt + 1, updated_at = now()
from (select organization_id, type, count(*) as cnt
      from public.contacts group by organization_id, type) sub
where nr.doc_type = sub.type and nr.organization_id = sub.organization_id;
