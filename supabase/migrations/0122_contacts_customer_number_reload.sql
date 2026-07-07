-- 0122_contacts_customer_number_reload.sql
-- ------------------------------------------------------------------------------
-- Zweck: Behebt den Laufzeitfehler beim Kontakt-Speichern
--   "Could not find the 'customer_number' column of 'contacts' in the schema cache".
-- Ursache ist entweder eine in der Ziel-DB (noch) fehlende Spalte ODER – wahrscheinlicher,
-- da 0113 sowie spätere Migrationen existieren – ein veralteter PostgREST-Schema-Cache.
--
-- Diese Migration ist additiv, idempotent und datenbewahrend:
--   1) stellt die Spalte sicher (falls sie wirklich fehlt),
--   2) erzwingt einen PostgREST-Schema-Cache-Reload, damit die Spalte sofort über die API
--      sichtbar ist.
-- Die Altmigration 0113 bleibt unverändert (Projektregel: angewendete Migrationen nicht ändern).

alter table public.contacts
  add column if not exists customer_number text;

comment on column public.contacts.customer_number is
  'Optionale externe Kundennummer bzw. Kundenreferenz eines Kontakts; wird in Kontaktformular, Detailansicht und Suche verwendet.';

-- PostgREST anweisen, den Schema-Cache neu zu laden (behebt den Schema-Cache-Fehler,
-- ohne API-Neustart). Wirkt sofort nach Anwendung der Migration.
notify pgrst, 'reload schema';
