-- 0124_document_templates_category.sql
-- ------------------------------------------------------------------------------
-- Dokument-Vorlagen (document_templates) um eine frei wählbare Kategorie erweitern,
-- damit Vorlagen im Vorlagen-Modal gruppiert und durchsucht werden können.
-- Additiv, idempotent, datenbewahrend. `description` existiert bereits (0004) und
-- wird nun im UI genutzt (Suche/Anzeige) – keine Schemaänderung dafür nötig.
-- organization_id/RLS ist bereits vorhanden (0022/0023/0063) → keine Isolationsänderung.
-- Bewusst KEINE feste Enum: Kategorien sind frei/mandantenfähig (Default "Standard").

alter table public.document_templates
  add column if not exists category text not null default 'Standard';

-- Bestandsvorlagen ohne Kategorie sauber auf "Standard" setzen.
update public.document_templates
  set category = 'Standard'
  where category is null or btrim(category) = '';

create index if not exists idx_document_templates_org_type_cat
  on public.document_templates (organization_id, doc_type, category);

comment on column public.document_templates.category is
  'Frei wählbare Kategorie einer Dokument-Vorlage (Default "Standard"); für Gruppierung/Suche im Vorlagen-Modal. Mandantenneutral, keine feste Enum.';

-- PostgREST-Schema-Cache neu laden, damit die neue Spalte sofort über die API sichtbar ist.
notify pgrst, 'reload schema';
