-- ============================================================
-- B4Y SuperAPP – Eingangs-Standardnachlass für Kontakte
-- ------------------------------------------------------------
-- Additiv: ergänzt das Gegenstück zu default_discount_percent (Ausgang)
-- für die Eingangsrichtung (Lieferant/Subunternehmer berechnet uns).
-- Kein Datenverlust, keine Pflicht (nullable). Symmetrisch zu den
-- in_*-Feldern aus Migration 0066.
-- ============================================================

alter table public.contacts
  add column if not exists in_discount_percent numeric;

comment on column public.contacts.in_discount_percent is
  'Eingangs-Standardnachlass in % (Lieferant/Subunternehmer berechnet uns). Gegenstück zu default_discount_percent (Ausgang).';
