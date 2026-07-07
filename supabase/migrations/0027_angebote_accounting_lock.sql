-- Angebote als buchungsrelevant markieren → Trigger erzwingt verpflichtende
-- Versionierung/Abschluss/Sperre/PDF-Snapshot/Audit (harte Buchhaltungssperre).
update public.document_types
set is_accounting_relevant = true
where lower(slug) = 'angebote';
