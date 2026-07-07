-- 0071_textbausteine_seed.sql
-- B4Y SuperAPP – Standard-Textbausteine (Vortext + Nachtext) je Dokumentart seeden.
-- ------------------------------------------------------------------------------
-- Ziel: Pro Organisation und je relevanter Dokumentart einen Standard-Vortext
-- (text_type='dokument_vortext') und Standard-Nachtext (text_type='dokument_nachtext')
-- anlegen – professionelles österreichisches Deutsch mit Platzhaltern.
--
-- Echte Struktur (gegen src/lib/text-blocks.ts + Migrationen 0004/0019/0022/0042 geprüft):
--   text_blocks(organization_id, type['text'|'titel'], title, content, content_html,
--               text_type, category, document_type_id, applies_to_all_doctypes,
--               is_default, language, active, sort_order, …)
--   - Vortext/Nachtext werden über `text_type` unterschieden, NICHT über eine
--     "position vor/nach"-Spalte (die es nicht gibt). Das Matching im UI
--     (pickBestText) wählt den spezifischsten aktiven is_default-Baustein:
--     applies_to_all_doctypes=false + document_type_id = konkrete Dokumentart.
--   - document_types ist ein gemeinsamer Katalog (slug global unique, kein org_id) →
--     Join über slug, organization_id kommt aus public.organizations.
--   - UNIQUE(organization_id, type, sort_order) (Migration 0042): neue Bausteine
--     bekommen sort_order = (max bestehender 'text'-sort_order der Org) + rn*10.
--
-- Idempotent: pro (Organisation, Dokumentart, text_type) wird nur eingefügt, wenn
-- noch kein 'text'-Baustein dafür existiert (NOT EXISTS). Bestehende Texte werden
-- NIE überschrieben. Platzhalter: {{kunde.anrede}}, {{kunde.name}}, {{projekt.name}},
-- {{dokument.nummer}}, {{firma.name}} (siehe KNOWN_PLACEHOLDERS in text-blocks.ts).
-- ------------------------------------------------------------------------------

with seed(slug, text_type, category, title, content) as (
  values
    -- Angebot
    ('angebote', 'dokument_vortext', 'vorbemerkung', 'Angebot – Vortext',
     E'Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},\n\nvielen Dank für Ihre Anfrage und Ihr Interesse an unseren Leistungen. Gerne unterbreiten wir Ihnen nachstehendes Angebot {{dokument.nummer}} zum Projekt „{{projekt.name}}". Die angeführten Massen verstehen sich, sofern nicht anders vermerkt, als vorläufig und werden nach tatsächlichem Aufmaß abgerechnet.'),
    ('angebote', 'dokument_nachtext', 'schlusstext', 'Angebot – Nachtext',
     E'Dieses Angebot ist freibleibend und 30 Tage ab Ausstellungsdatum gültig. Für die Ausführung gelten unsere Allgemeinen Geschäftsbedingungen. Wir freuen uns auf Ihren Auftrag und stehen für Rückfragen jederzeit gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{firma.name}}'),

    -- Nachtrag (Angebot Nachtrag)
    ('angebot_nachtrag', 'dokument_vortext', 'vorbemerkung', 'Nachtrag – Vortext',
     E'Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},\n\nim Zuge des Projekts „{{projekt.name}}" haben sich zusätzliche bzw. geänderte Leistungen ergeben. Diese stellen wir Ihnen mit gegenständlichem Nachtrag {{dokument.nummer}} im Detail dar.'),
    ('angebot_nachtrag', 'dokument_nachtext', 'schlusstext', 'Nachtrag – Nachtext',
     E'Wir ersuchen um Freigabe dieses Nachtrags vor Ausführung der angeführten Leistungen. Für Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{firma.name}}'),

    -- Auftrag
    ('auftraege', 'dokument_vortext', 'vorbemerkung', 'Auftrag – Vortext',
     E'Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},\n\nwir bestätigen hiermit den Auftrag {{dokument.nummer}} zum Projekt „{{projekt.name}}" und bedanken uns für Ihr Vertrauen. Nachstehend finden Sie die vereinbarten Leistungen im Detail.'),
    ('auftraege', 'dokument_nachtext', 'schlusstext', 'Auftrag – Nachtext',
     E'Die Ausführung erfolgt zu den vereinbarten Konditionen. Sollten sich Änderungen ergeben, informieren wir Sie rechtzeitig. Wir freuen uns auf die gute Zusammenarbeit.\n\nMit freundlichen Grüßen\n{{firma.name}}'),

    -- Auftrag SUB (Subunternehmer)
    ('auftrag_sub', 'dokument_vortext', 'vorbemerkung', 'Auftrag SUB – Vortext',
     E'Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},\n\nhiermit beauftragen wir Sie mit den nachstehend angeführten Leistungen zum Projekt „{{projekt.name}}" (Auftrag {{dokument.nummer}}). Es gelten die vereinbarten Bedingungen sowie die einschlägigen ÖNORMEN.'),
    ('auftrag_sub', 'dokument_nachtext', 'schlusstext', 'Auftrag SUB – Nachtext',
     E'Wir ersuchen um schriftliche Auftragsbestätigung. Rechnungen sind unter Anführung der Auftragsnummer {{dokument.nummer}} zu legen. Für Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{firma.name}}'),

    -- Rechnung
    ('rechnungen', 'dokument_vortext', 'vorbemerkung', 'Rechnung – Vortext',
     E'Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},\n\nfür die im Rahmen des Projekts „{{projekt.name}}" erbrachten Leistungen erlauben wir uns, Ihnen nachstehende Rechnung {{dokument.nummer}} zu legen.'),
    ('rechnungen', 'dokument_nachtext', 'schlusstext', 'Rechnung – Nachtext',
     E'Wir ersuchen um Überweisung des Rechnungsbetrags innerhalb der angeführten Zahlungsfrist ohne Abzug unter Anführung der Rechnungsnummer {{dokument.nummer}}. Vielen Dank für Ihren Auftrag.\n\nMit freundlichen Grüßen\n{{firma.name}}'),

    -- Gutschrift
    ('gutschriften', 'dokument_vortext', 'vorbemerkung', 'Gutschrift – Vortext',
     E'Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},\n\nbezugnehmend auf das Projekt „{{projekt.name}}" erstellen wir Ihnen nachstehende Gutschrift {{dokument.nummer}}.'),
    ('gutschriften', 'dokument_nachtext', 'schlusstext', 'Gutschrift – Nachtext',
     E'Der Gutschriftsbetrag wird Ihnen gemäß Vereinbarung gutgeschrieben bzw. rücküberwiesen. Für Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{firma.name}}'),

    -- Mahnung
    ('mahnungen', 'dokument_vortext', 'vorbemerkung', 'Mahnung – Vortext',
     E'Sehr geehrte/r {{kunde.anrede}} {{kunde.name}},\n\nfür das Projekt „{{projekt.name}}" haften zur Rechnung {{dokument.nummer}} noch offene Beträge aus. Vermutlich ist Ihnen dies entgangen.'),
    ('mahnungen', 'dokument_nachtext', 'schlusstext', 'Mahnung – Nachtext',
     E'Wir ersuchen Sie höflich, den offenen Betrag umgehend zur Anweisung zu bringen. Sollten Sie die Zahlung zwischenzeitlich bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.\n\nMit freundlichen Grüßen\n{{firma.name}}')
),
rows as (
  select o.id as organization_id,
         dt.id as document_type_id,
         s.text_type, s.category, s.title, s.content,
         row_number() over (partition by o.id order by dt.sort_order, s.text_type) as rn
  from public.organizations o
  cross join seed s
  join public.document_types dt on dt.slug = s.slug
  where not exists (
    select 1 from public.text_blocks tb
    where tb.organization_id = o.id
      and tb.document_type_id = dt.id
      and tb.text_type = s.text_type
      and tb.type = 'text'
  )
)
insert into public.text_blocks
  (organization_id, type, title, content, content_html, text_type, category,
   document_type_id, applies_to_all_doctypes, is_default, language, active, sort_order)
select
  r.organization_id,
  'text',
  r.title,
  r.content,
  '<p>' || replace(replace(r.content, E'\n\n', '</p><p>'), E'\n', '<br>') || '</p>',
  r.text_type,
  r.category,
  r.document_type_id,
  false,
  true,
  'de',
  true,
  coalesce(
    (select max(sort_order) from public.text_blocks tb2
      where tb2.organization_id = r.organization_id and tb2.type = 'text'),
    0
  ) + r.rn * 10
from rows r;
