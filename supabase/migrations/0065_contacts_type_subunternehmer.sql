-- 0065_contacts_type_subunternehmer.sql
-- B4Y SuperAPP – Kontaktart "subunternehmer" als gültigen contacts.type-Wert zulassen
-- ------------------------------------------------------------------------------
-- Hintergrund / Fehlerursache:
--   Der CHECK-Constraint contacts_type_check erlaubte bisher nur
--   ('kunde','lieferant','partner','sonstige'). Die App bietet aber die
--   Kontaktart "Subunternehmer" an. Beim Speichern eines Subunternehmer-
--   Kontakts schlug der Insert/Update deshalb mit einer Constraint-Verletzung
--   fehl ("violates check constraint contacts_type_check").
--
-- Lösung:
--   Constraint additiv um 'subunternehmer' erweitern. Rein additiv:
--   - Es werden KEINE Werte entfernt.
--   - Bestehende Datensätze (alle mit einem der bisherigen Werte) bleiben gültig.
--   - Kein Datenverlust, keine Datenänderung.
--
-- Mandantenfähigkeit: contacts.organization_id + RLS bleiben unverändert.

alter table public.contacts
  drop constraint if exists contacts_type_check;

alter table public.contacts
  add constraint contacts_type_check
  check (type = any (array['kunde'::text, 'lieferant'::text, 'partner'::text, 'sonstige'::text, 'subunternehmer'::text]));
