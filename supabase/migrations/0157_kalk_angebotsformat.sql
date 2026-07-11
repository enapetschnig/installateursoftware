-- ============================================================
-- Installateur SuperAPP – Migration 0157
-- Angebotsformat: Material und Arbeitszeit getrennt (Elektriker-Stil)
-- ------------------------------------------------------------
-- Elektriker schreiben Angebote klassisch so: jede MATERIAL-Komponente als
-- eigene Position (Katalog-Kurztext, Menge, Stückpreis) und die ARBEITSZEIT
-- separat als Stunden-Position (diktierte Stunden oder Summe der Richtzeiten).
-- Andere Betriebe (z. B. Bad-Komplettanbieter) kalkulieren je Leistung
-- inklusive Montage. Deshalb mandantenfähig als Einstellung:
--
--   kalk_angebotsformat:
--     null/'inkl_montage'          → Leistungspositionen inkl. Material+Montage (bisher)
--     'material_lohn_getrennt'     → Materialliste + separate Arbeitszeit-Position
--
-- Umsetzung: rein deterministisch NACH der KI (splitMaterialArbeit in
-- src/lib/wholesale.ts) – die KI liefert weiter Fakten (Stückliste + Minuten),
-- der Code formt daraus das gewünschte Angebot. Kein LLM-Risiko im Format.
-- ============================================================

alter table public.company_settings
  add column if not exists kalk_angebotsformat text;

comment on column public.company_settings.kalk_angebotsformat is
  'Sprach-Angebot: null/inkl_montage = Leistungspositionen inkl. Montage; material_lohn_getrennt = Materialpositionen einzeln (Katalog-Kurztext) + separate Arbeitszeit-Stunden-Position (Elektriker-Stil).';
