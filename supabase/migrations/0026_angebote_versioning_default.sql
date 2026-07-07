-- Angebote: Versionierung standardmäßig aktiv (ohne harte Buchungs-Sperre,
-- damit Angebote weiter überarbeitbar bleiben). Konfigurierbar je Firma.
update public.document_types
set versioning_enabled = true,
    finalization_required = true,
    create_pdf_snapshot_on_finalize = true,
    audit_log_enabled = true
where lower(slug) = 'angebote';
