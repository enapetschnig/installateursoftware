-- 0074_text_anrede_signatur_cleanup.sql
-- B4Y SuperAPP – Standard-Textbausteine bereinigen (Block A / Aufgabe 2):
--   • Kaputte Anrede „Sehr geehrte/r {{kunde.anrede}} {{kunde.name}}," → zentrale, robuste
--     Anredezeile {{kunde.anrede_zeile}} (löst zu „Sehr geehrter Herr …,"/„Sehr geehrte Frau …,"
--     bzw. Fallback „Sehr geehrte Damen und Herren," auf – verhindert „Sehr geehrte/r Ing.,").
--   • Doppelte Signatur vermeiden: „Mit freundlichen Grüßen / {{firma.name}}" aus den
--     Standard-Nachtexten entfernen – die PDF-Engine rendert die Signatur zentral genau EINMAL.
--   • Etwaigen doppelten Steuerhinweis („… exklusive der gesetzlichen Umsatzsteuer …") aus
--     Vor-/Nachtexten entfernen (in aktuellen Seeds nicht vorhanden → i. d. R. No-Op, defensiv).
--
-- Betrifft NUR Standard-Vorlagen: public.text_blocks mit type='text' AND is_default=true.
-- KEINE finalisierten Dokument-Snapshots (diese liegen in offers/orders/invoices.*_text und
-- werden hier NICHT angefasst). Mandantenneutral (alle Organisationen, organization_id bleibt).
-- Idempotent: arbeitet ausschließlich über REPLACE/regexp_replace auf bekannte Muster –
-- fehlt das Muster (z. B. bereits bereinigt oder individuell angepasst), passiert nichts.
-- ------------------------------------------------------------------------------
begin;

-- 1) Anrede-Zeile robust machen (Vor- und Nachtexte, Plain + HTML)
update public.text_blocks set
  content = replace(content,
    'Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},', '{{kunde.anrede_zeile}}'),
  content_html = replace(content_html,
    '<p>Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},</p>', '<p>{{kunde.anrede_zeile}}</p>')
where type = 'text' and is_default = true
  and (content like '%Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},%'
       or content_html like '%Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},%');

-- 2) Doppel-Signatur aus Standard-Nachtexten entfernen (Plain + HTML-Varianten <br> / <br/>)
update public.text_blocks set
  content = regexp_replace(content, E'\\n+Mit freundlichen Grüßen\\n\\{\\{firma\\.name\\}\\}\\s*$', ''),
  content_html = replace(replace(content_html,
      '<p>Mit freundlichen Grüßen<br>{{firma.name}}</p>', ''),
      '<p>Mit freundlichen Grüßen<br/>{{firma.name}}</p>', '')
where type = 'text' and is_default = true and text_type = 'dokument_nachtext'
  and (content like '%Mit freundlichen Grüßen%{{firma.name}}%'
       or content_html like '%Mit freundlichen Grüßen%{{firma.name}}%');

-- 3) Etwaigen doppelten Steuerhinweis entfernen (defensiv)
update public.text_blocks set
  content = replace(content,
    'Sämtliche Preise verstehen sich in Euro, exklusive der gesetzlichen Umsatzsteuer, sofern nicht anders angegeben.', ''),
  content_html = replace(content_html,
    'Sämtliche Preise verstehen sich in Euro, exklusive der gesetzlichen Umsatzsteuer, sofern nicht anders angegeben.', '')
where type = 'text' and is_default = true
  and (content like '%exklusive der gesetzlichen Umsatzsteuer%'
       or content_html like '%exklusive der gesetzlichen Umsatzsteuer%');

commit;
