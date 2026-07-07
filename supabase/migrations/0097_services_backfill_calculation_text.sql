-- 0097_services_backfill_calculation_text.sql
-- Ziel 2 (Backfill): "Berechnung:"-Bloecke aus services.long_text herausloesen und
-- nach calculation_text schreiben. Danach enthaelt long_text nur noch die echte
-- Leistungsbeschreibung. Robust gegen "Berechnung:von" / "Berechnung: von" /
-- Whitespace / Zeilenumbrueche / Staffeltexte am Ende.
--
-- WICHTIG: Setzt voraus, dass die Katalog-/Staffelpreis-Logik bereits auf
-- calculation_text umgestellt ist (servicesToCatalog haengt "Berechnung: "+calc wieder an),
-- damit KI/Voice/Staffelpreise weiterfunktionieren. Idempotent: greift nur, solange
-- long_text noch einen "Berechnung:"-Block enthaelt. internal_note (Hero-Metadaten) bleibt unberuehrt.
update public.services set
  calculation_text = nullif(regexp_replace(regexp_replace(long_text, '^.*?Berechnung:', '', 'is'), '^\s+|\s+$', '', 'g'), ''),
  long_text        = nullif(regexp_replace(regexp_replace(long_text, '\s*Berechnung:.*$', '', 'is'), '^\s+|\s+$', '', 'g'), '')
where long_text ~* 'Berechnung:'
  and calculation_text is null;
