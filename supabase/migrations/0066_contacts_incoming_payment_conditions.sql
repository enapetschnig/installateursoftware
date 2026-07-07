-- 0066_contacts_incoming_payment_conditions.sql
-- B4Y SuperAPP – Eingangs-Zahlungskonditionen je Kontakt (additiv)
-- ------------------------------------------------------------------------------
-- Hintergrund:
--   Bisher hatte ein Kontakt nur EINEN Konditionssatz (payment_term_days,
--   skonto_percent/days, payment_method, payment_note) – semantisch die
--   AUSGANGS-Konditionen (wir berechnen den Kunden).
--   Für Lieferanten/Subunternehmer brauchen wir die EINGANGS-Konditionen
--   (der Lieferant/Sub berechnet UNS): eigene Zahlungsfrist, Skonto, Zahlungsweg.
--
-- Lösung (rein additiv, kein Datenverlust, keine Änderung bestehender Werte):
--   Neue Spalten mit Präfix `in_` für die Eingangskonditionen.
--   Die bestehenden Spalten bleiben unverändert = Ausgangskonditionen.
--
-- Mandantenfähigkeit: contacts.organization_id + RLS bleiben unverändert.

alter table public.contacts
  add column if not exists in_payment_term_days integer,
  add column if not exists in_skonto_percent    numeric,
  add column if not exists in_skonto_days        integer,
  add column if not exists in_payment_method     text,
  add column if not exists in_payment_note       text;

comment on column public.contacts.in_payment_term_days is 'Eingangskonditionen: Zahlungsziel in Tagen (Lieferant/Sub berechnet uns)';
comment on column public.contacts.in_skonto_percent    is 'Eingangskonditionen: Skonto in Prozent';
comment on column public.contacts.in_skonto_days        is 'Eingangskonditionen: Skonto-Frist in Tagen';
comment on column public.contacts.in_payment_method     is 'Eingangskonditionen: Zahlungsweg';
comment on column public.contacts.in_payment_note       is 'Eingangskonditionen: Hinweis/Notiz';
