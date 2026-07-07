-- Markiert, dass die automatischen Standardtexte (Vor-/Einleitung-/Nachtext)
-- für ein Angebot bereits einmalig gesetzt wurden. Danach hat die manuelle
-- Auswahl/Änderung im Dokument Vorrang – Auto-Standardtexte greifen nicht erneut
-- (so bleibt z.B. „Keine Einleitung" erhalten). Bestehende Angebote gelten als
-- initialisiert, damit ihre gespeicherten Texte unverändert bleiben.
alter table offers add column if not exists texts_initialized boolean not null default false;
update offers set texts_initialized = true where texts_initialized = false;
