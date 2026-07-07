-- ============================================================
-- Artikelstamm: Berechnungs-/Staffelpreis-Text analog zu Leistungen
-- (services.calculation_text, Migr. 0096). Additive Spalte, kein
-- Datenverlust; Feld ist optional und wird im Artikel-Formular bei
-- den Preisfeldern (EK/Aufschlag/VK) gepflegt.
-- ============================================================
alter table public.articles
  add column if not exists calculation_text text;

comment on column public.articles.calculation_text is
  'Berechnungs-/Staffelpreis-Hinweise zum Artikel (analog services.calculation_text)';
