-- ============================================================
-- B4Y SuperAPP – Empfänger-Zusatzzeilen für Kontakte
-- ------------------------------------------------------------
-- Zwei optionale Zusatzzeilen für den Dokument-Empfängerblock, die im PDF direkt
-- NACH dem Firmen-/Empfängernamen und VOR der Straße erscheinen (z. B. „z. Hd. …",
-- Hausverwaltung/Abteilung). Rein additiv, nullable, kein Default, kein Datenverlust.
-- Bewusst getrennt von address_extra (= Adresszusatz zur Straße, z. B. Stiege/Top).
-- Mandantenfähigkeit: contacts.organization_id + RLS bleiben unverändert.
-- ============================================================

alter table public.contacts
  add column if not exists recipient_extra_line1 text,
  add column if not exists recipient_extra_line2 text;

comment on column public.contacts.recipient_extra_line1 is
  'Empfänger-Zusatzzeile 1 im Dokument (nach Firmen-/Empfängername, vor Straße), z. B. „z. Hd. …". Optional.';
comment on column public.contacts.recipient_extra_line2 is
  'Empfänger-Zusatzzeile 2 im Dokument (Hausverwaltung/Abteilung/Zusatzinfo). Optional.';
