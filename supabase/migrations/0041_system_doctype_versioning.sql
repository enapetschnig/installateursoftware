-- Geschützte System-Dokumentarten brauchen nachvollziehbare abgeschlossene Stände:
-- Versionierung + Abschluss + PDF-Snapshot + Versions-Sperre verpflichtend.
-- (Buchungs-/Steuerrelevanz wird NICHT pauschal gesetzt – bleibt fachlich je Typ.)
update public.document_types set
  versioning_enabled = true,
  finalization_required = true,
  create_pdf_snapshot_on_finalize = true,
  lock_finalized_versions = true
where is_system = true;

-- Compliance-Trigger erweitern: zusätzlich zu buchungs-/steuerrelevant erzwingen
-- auch geschützte Systemtypen ihre verpflichtende Versionierung (serverseitig).
create or replace function public.enforce_doctype_compliance()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_accounting_relevant or new.is_tax_relevant then
    new.versioning_enabled := true;
    new.versioning_required := true;
    new.finalization_required := true;
    new.lock_finalized_versions := true;
    new.create_pdf_snapshot_on_finalize := true;
    new.audit_log_enabled := true;
  elsif new.is_system then
    new.versioning_enabled := true;
    new.finalization_required := true;
    new.lock_finalized_versions := true;
    new.create_pdf_snapshot_on_finalize := true;
  end if;
  return new;
end $$;
