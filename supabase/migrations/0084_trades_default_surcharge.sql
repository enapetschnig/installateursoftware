-- ============================================================
-- B4Y SuperAPP – Gewerk-spezifischer Standardaufschlag
-- ------------------------------------------------------------
-- Pro Gewerk konfigurierbarer Default-Aufschlag in % (z. B. Maler 20 %,
-- Reinigung 15 %, Spezial-Techniken höher). Wird beim Erzeugen einer neuen
-- Service-Position via KI-Pipeline ausgewertet, wenn der Service selbst keinen
-- `aufschlag_percent` setzt. Replizier-Vorbild: bau4you `verifyAufschlaegeGewerke`
-- (claude.js Z. 2681) — dort kann der Aufschlag pro Gewerk variieren.
--
-- Konsistenz mit 0081_conditions_snapshot_and_surcharge.sql:
--   • contacts.default_surcharge_percent  → Kunden-Aufschlag (UNSICHTBAR, einmalig im EP)
--   • trades.default_surcharge_percent    → Gewerk-Aufschlag (Pipeline-Default für Neu-Positionen)
-- Beide stören sich nicht: Gewerk-Aufschlag entsteht in der Kalkulation der Einzelposition,
-- Kunden-Aufschlag wird beim Anlegen eines Belegs zusätzlich in den finalen EP eingerechnet.
--
-- Rein additiv, NOT NULL mit DEFAULT 0 = kein Behaviour-Change für Bestandsangebote.
-- ============================================================

alter table public.trades
  add column if not exists default_surcharge_percent numeric not null default 0;

comment on column public.trades.default_surcharge_percent is
  'Standardaufschlag in % pro Gewerk für die KI-Kalkulations-Pipeline (z. B. Maler 20, Reinigung 15). Wird auf (Material + Lohn) der Position aufgeschlagen, wenn die Position selbst keinen aufschlag_percent setzt. Replikation von bau4you verifyAufschlaegeGewerke (claude.js). Default 0 = kein Aufschlag.';
