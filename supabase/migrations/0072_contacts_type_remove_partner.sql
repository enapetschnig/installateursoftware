-- 0072_contacts_type_remove_partner.sql
-- B4Y SuperAPP – Kontaktart 'partner' aus dem CHECK-Constraint contacts_type_check entfernen.
-- ------------------------------------------------------------------------------
-- Hintergrund:
--   Die Kontaktart 'partner' wird im Frontend nicht mehr angeboten (nur noch
--   kunde / lieferant / subunternehmer als Tabs, sonstige als Auffang). Der
--   bisherige ungenutzte Nummernkreis 'partner' wurde bereits in 0070 entfernt.
--   Hier wird 'partner' zusätzlich aus dem erlaubten Wertebereich der Spalte
--   contacts.type genommen, damit Code (ContactType) und DB konsistent sind.
--
-- Sicherheit / Datenbewahrung:
--   Es existiert KEIN Kontakt mit type = 'partner' (vor der Migration geprüft:
--   0 Zeilen). Die Migration ist daher rein additiv-bereinigend und verliert
--   keine Daten. Zur Absicherung bricht die Migration kontrolliert ab, falls
--   wider Erwarten doch 'partner'-Kontakte existieren sollten.
-- ------------------------------------------------------------------------------

do $$
declare
  n integer;
begin
  select count(*) into n from public.contacts where type = 'partner';
  if n > 0 then
    raise exception 'Abbruch: % Kontakt(e) mit type=''partner'' vorhanden. Bitte zuerst migrieren/umbuchen.', n;
  end if;
end $$;

alter table public.contacts drop constraint if exists contacts_type_check;

alter table public.contacts
  add constraint contacts_type_check
  check (type = any (array['kunde'::text, 'lieferant'::text, 'sonstige'::text, 'subunternehmer'::text]));
