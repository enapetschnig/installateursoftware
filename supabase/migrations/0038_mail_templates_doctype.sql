-- Mailvorlagen: Zuordnung zu Dokumentart + Auslöser/Aktion statt unscharfem Kontext.
-- Additive Erweiterung; bestehende Spalte "context" bleibt als Fallback erhalten.
alter table mail_templates
  add column if not exists document_type_slug text,
  add column if not exists document_type_id uuid references document_types(id) on delete set null,
  add column if not exists doc_variant text,
  add column if not exists trigger_action text,
  add column if not exists category text,
  add column if not exists is_default boolean not null default false;

-- Backfill: Kategorie aus bisherigem Kontext ableiten
update mail_templates set category = case context
    when 'angebot' then 'dokument' when 'auftrag' then 'dokument'
    when 'rechnung' then 'dokument' when 'mahnung' then 'dokument'
    when 'dokument' then 'dokument'
    when 'termin' then 'termin'
    when 'subunternehmer' then 'subunternehmer'
    when 'lieferant' then 'lieferant'
    when 'kunde' then 'projekt' when 'projekt' then 'projekt'
    else 'allgemein' end
  where category is null;

-- Backfill: Dokumentart-Slug (Grund-Dokumenttyp) aus Kontext
update mail_templates set document_type_slug = case context
    when 'angebot' then 'angebote'
    when 'auftrag' then 'auftraege'
    when 'rechnung' then 'rechnungen'
    when 'mahnung' then 'rechnungen'
    else null end
  where document_type_slug is null;

-- Backfill: sinnvoller Standard-Auslöser aus Kontext
update mail_templates set trigger_action = case context
    when 'angebot' then 'senden'
    when 'auftrag' then 'bestaetigen'
    when 'rechnung' then 'senden'
    when 'mahnung' then 'zahlungserinnerung'
    when 'dokument' then 'senden'
    when 'termin' then 'termin_bestaetigen'
    when 'subunternehmer' then 'subunternehmer_anfragen'
    else null end
  where trigger_action is null;

create index if not exists idx_mail_templates_doctype on mail_templates(organization_id, document_type_slug, trigger_action);
