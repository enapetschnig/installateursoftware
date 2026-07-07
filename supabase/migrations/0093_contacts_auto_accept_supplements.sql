-- 0093_contacts_auto_accept_supplements.sql
-- Kontakt-Schalter „Nachträge automatisch akzeptieren".
-- Additiv und datenbewahrend: Default false → Bestandskontakte bleiben unverändert
-- (keine überraschende Auto-Akzeptanz). Mandantenneutral; erbt RLS/organization_id
-- der bestehenden contacts-Tabelle (keine neue Policy nötig).
alter table public.contacts
  add column if not exists auto_accept_supplements boolean not null default false;

comment on column public.contacts.auto_accept_supplements is
  'Wenn true: Angebot-Nachträge dieses Kontakts gelten nach dem Finalisieren automatisch als akzeptiert und werden in den zugehörigen Auftrag übernommen (bei eindeutigem Auftrag automatisch, bei mehreren über Auswahl-Dialog). Fachlich v.a. für Kunden relevant; technisch für alle Kontaktarten verfügbar.';
