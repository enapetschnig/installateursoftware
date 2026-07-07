-- 0113_contacts_customer_number.sql
-- Additiv und datenbewahrend: eigene Kundennummer pro Kontakt, optional gepflegt.
alter table public.contacts
  add column if not exists customer_number text;

comment on column public.contacts.customer_number is
  'Optionale externe Kundennummer bzw. Kundenreferenz eines Kontakts; wird in Kontaktformular, Detailansicht und Suche verwendet.';
