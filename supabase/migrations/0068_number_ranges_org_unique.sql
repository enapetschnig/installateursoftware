-- 0068_number_ranges_org_unique.sql
-- B4Y SuperAPP – number_ranges mandantentauglich machen (Codex-Finding #46)
-- ------------------------------------------------------------------------------
-- Problem: number_ranges hatte einen GLOBALEN Unique `number_ranges_doc_type_key
-- UNIQUE(doc_type)`. Dadurch kann pro doc_type nur EINE Zeile über alle
-- Organisationen existieren → in Mehrmandanten-Installationen bekäme eine zweite
-- Firma keinen eigenen Nummernkreis (z. B. kunde/lieferant), und
-- next_document_number() würde „Kein aktiver Nummernkreis" werfen.
--
-- Lösung: globalen Unique entfernen, durch org-scoped UNIQUE(organization_id,
-- doc_type) ersetzen. Bei aktuell einer Organisation datenkonfliktfrei
-- (jeder doc_type existiert genau einmal). Danach Kontakt-Ranges idempotent je
-- Organisation nachziehen (für ggf. weitere Orgs), org-scoped on conflict.

-- 1) Globalen Unique entfernen.
alter table public.number_ranges drop constraint if exists number_ranges_doc_type_key;

-- 2) Org-scoped Unique (deckt auch Slug-/Kontakt-Ranges ohne document_type_id ab).
create unique index if not exists uniq_number_ranges_org_doc_type
  on public.number_ranges (organization_id, doc_type);

-- 3) Kontakt-Ranges je Organisation sicherstellen (idempotent, org-scoped).
insert into public.number_ranges
  (doc_type, label, prefix, separator, min_digits, use_year, next_number, active, protected, organization_id)
select v.doc_type, v.label, v.prefix, '-', 4, false, 1, true, false, o.id
from public.organizations o
cross join (values
  ('kunde',          'Kunden',         'KUNDE'),
  ('lieferant',      'Lieferanten',    'LIEFERANT'),
  ('subunternehmer', 'Subunternehmer', 'SUB'),
  ('partner',        'Partner',        'PARTNER'),
  ('sonstige',       'Sonstige',       'SONSTIGE')
) as v(doc_type, label, prefix)
on conflict (organization_id, doc_type) do nothing;
