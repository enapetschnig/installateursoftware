-- Subunternehmer-Zugehörigkeit für Dokumentarten (getrennt von Lieferant)
alter table public.document_types
  add column if not exists belongs_to_subcontractor boolean not null default false;

-- Bestehende SUB-Dokumentarten sinnvoll vorbelegen (Name/Slug endet auf SUB/_sub)
update public.document_types
set belongs_to_subcontractor = true
where belongs_to_subcontractor = false
  and (lower(slug) like '%\_sub' escape '\' or lower(slug) like '%\_sub\_%' escape '\'
       or name ilike '% SUB' or name ilike '% SUB %');
