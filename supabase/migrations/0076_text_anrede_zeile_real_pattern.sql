-- 0076_text_anrede_zeile_real_pattern.sql
-- Nachzug zu 0074 (Block A / Aufgabe 2): Das tatsächliche Anrede-Muster der Standard-Vortexte
-- ist „Sehr geehrte/r {{kunde.anrede}}," (mit Komma, OHNE {{kunde.name}}) – genau das erzeugte
-- kaputte Anreden wie „Sehr geehrte/r Ing.,". 0074 traf nur das 0071-Seed-Muster *mit* {{kunde.name}}.
-- Hier wird das reale Muster auf die zentrale, robuste Anredezeile {{kunde.anrede_zeile}} umgestellt
-- (löst zu „Sehr geehrter Herr …," / „Sehr geehrte Frau …," bzw. Fallback „Sehr geehrte Damen und Herren,").
-- Nur Standard-Vorlagen (text_blocks, is_default, type='text') – KEINE finalisierten Snapshots.
-- Idempotent (REPLACE; fehlt das Muster, passiert nichts).
-- ------------------------------------------------------------------------------
update public.text_blocks set
  content = replace(content, 'Sehr geehrte/r {{kunde.anrede}},', '{{kunde.anrede_zeile}}'),
  content_html = replace(content_html, 'Sehr geehrte/r {{kunde.anrede}},', '{{kunde.anrede_zeile}}')
where type = 'text' and is_default = true
  and (content like '%Sehr geehrte/r {{kunde.anrede}},%'
       or content_html like '%Sehr geehrte/r {{kunde.anrede}},%');
