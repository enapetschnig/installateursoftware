-- 0075_document_transitions_nachtrag_sub.sql
-- B4Y SuperAPP – Block A / Aufgabe 3:
-- Dokumentvarianten „Angebot Nachtrag" und „Auftrag SUB" vollständig in der
-- Variantenverwaltung (Einstellungen → Dokumentvarianten & Texte) abbilden.
-- document_type_transitions je Variante (offer_type_id) um eigene Bezeichnung + Vor-/Nachtext
-- für Nachtrag und Auftrag-SUB erweitern. Mandantenfähig (organization_id bleibt), nullable
-- (leer = Standardbezeichnung „Nachtrag" / „Auftrag SUB"). Additiv – keine Daten zerstört,
-- bestehende Zeilen/finalisierte Snapshots unverändert.
-- ------------------------------------------------------------------------------
alter table public.document_type_transitions
  add column if not exists nachtrag_label text,
  add column if not exists nachtrag_intro_text text,
  add column if not exists nachtrag_closing_text text,
  add column if not exists sub_order_label text,
  add column if not exists sub_order_intro_text text,
  add column if not exists sub_order_closing_text text;
