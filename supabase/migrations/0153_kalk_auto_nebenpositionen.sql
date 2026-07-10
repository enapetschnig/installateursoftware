-- ============================================================
-- Installateur SuperAPP – Migration 0153
-- Betriebsprofil: automatische Nebenpositionen abschaltbar
-- ------------------------------------------------------------
-- Die Sprach-Angebots-Pipeline stammt aus einem Baubetriebs-Kontext und
-- ergänzte IMMER Baustelleneinrichtung (Gemeinkosten) und eine Reinigungs-
-- position. Für einen reinen Fachbetrieb (Elektriker) ist das falsch:
-- Ein Elektriker-Angebot enthält NUR die gesprochenen Elektro-Leistungen.
--
--   kalk_auto_nebenpositionen:
--     null/true → Baubetriebs-Verhalten (B4Y-kompatibler Default)
--     false     → Fachbetrieb: Prompt (FACHBETRIEB-MODUS) und Pipeline
--                 (applyBaustelleneinrichtung, smartReinigung) ergänzen NICHTS
--
-- Die Angebots-GLIEDERUNG kommt zusätzlich aus den aktiven Gewerken (trades
-- mit aktiven Leistungen) – siehe buildBetriebsGewerke() / {{GEWERKE}}.
-- ============================================================

alter table public.company_settings
  add column if not exists kalk_auto_nebenpositionen boolean;

comment on column public.company_settings.kalk_auto_nebenpositionen is
  'Sprach-Angebot: automatische Nebenpositionen (Baustelleneinrichtung/Reinigung). null/true = Baubetriebs-Verhalten, false = Fachbetrieb (nichts Ungesprochenes ergänzen).';
