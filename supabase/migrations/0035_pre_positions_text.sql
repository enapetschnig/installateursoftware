-- Neuer Dokumentbereich „Einleitung vor Positionen" (Snapshot je Dokument).
-- Steht zwischen Dokument-Vortext und Positionstabelle. Eigener Texttyp
-- einleitung_vor_positionen im zentralen Textbaustein-System (text_blocks.text_type
-- ist freitext, daher keine Constraint-Änderung nötig).
alter table public.offers   add column if not exists pre_positions_text text;
alter table public.orders   add column if not exists pre_positions_text text;
alter table public.invoices add column if not exists pre_positions_text text;

-- Optionaler generischer Standardtext je Firma (nur wenn noch keiner existiert).
-- Wird beim Erstellen als Snapshot übernommen; firmenspezifisch editierbar.
insert into public.text_blocks
  (id, type, title, content, content_html, text_type, language, is_default,
   applies_to_all_doctypes, active, sort_order, organization_id)
select gen_random_uuid(), 'text', 'Einleitung vor Positionen (Standard)',
  'Nachstehend finden Sie die angebotenen Leistungen im Detail.',
  '<p>Nachstehend finden Sie die angebotenen Leistungen im Detail.</p>',
  'einleitung_vor_positionen', 'de', true, true, true, 0, o.id
from public.organizations o
where not exists (
  select 1 from public.text_blocks tb
  where tb.organization_id = o.id and tb.text_type = 'einleitung_vor_positionen'
);
