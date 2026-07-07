-- 0096_services_calculation_text_and_image.sql
-- Ziel 2: separates Feld fuer den Berechnungs-/Staffelpreis-Text einer Leistung
--         (bisher im long_text als "Berechnung:"-Block vermischt).
-- Ziel 3: Bild/Foto bei Leistungen (analog articles.image_url) – privater Storage.
-- Beide additiv, datenbewahrend (nullable, kein Default-Zwang). Der Daten-Backfill
-- (long_text -> calculation_text) erfolgt in einer SPAETEREN Migration, NACHDEM die
-- KI-/Voice-/Staffelpreis-Logik auf calculation_text umgestellt ist.
alter table public.services
  add column if not exists calculation_text text,
  add column if not exists image_url text;

comment on column public.services.calculation_text is
  'Berechnungs-/Staffelpreis-Text der Leistung (Feld „Berechnung"); aus dem fruehren long_text-Block "Berechnung:" herausgeloest. Quelle fuer KI-/Staffelpreis-Logik.';
comment on column public.services.image_url is
  'Pfad/Schluessel des Leistungsbildes im privaten Storage-Bucket (analog articles.image_url); via signierte URL angezeigt.';
