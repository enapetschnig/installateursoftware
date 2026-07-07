-- Weitere zentrale Dokumentarten als geschützte System-Typen markieren
-- und fachlich passende Standard-Flags setzen. Bestehende Zeilen werden NUR
-- aktualisiert (kein Doppel-Anlegen, keine Slug-Änderung).

-- Angebot Nachtrag: vertragsrelevant, versioniert, Abschluss + PDF-Snapshot; nicht buchungs-/steuerrelevant
update document_types set
  is_system = true,
  versioning_enabled = true,
  finalization_required = true,
  create_pdf_snapshot_on_finalize = true,
  belongs_to_project = true,
  belongs_to_customer = true
where slug = 'angebot_nachtrag';

-- Auftrag-SUB / Subunternehmerauftrag: subunternehmerbezogen, versioniert, Abschluss + Snapshot
update document_types set
  is_system = true,
  versioning_enabled = true,
  finalization_required = true,
  create_pdf_snapshot_on_finalize = true,
  belongs_to_project = true,
  belongs_to_subcontractor = true
where slug = 'auftrag_sub';

-- Mahnung / Zahlungserinnerung: rechnungs-/kundenbezogen, versioniert, Snapshot;
-- NICHT als eigenständiges Buchungs-/Steuerdokument behandeln
update document_types set
  is_system = true,
  is_accounting_relevant = false,
  is_tax_relevant = false,
  versioning_enabled = true,
  finalization_required = true,
  create_pdf_snapshot_on_finalize = true,
  belongs_to_project = true,
  belongs_to_customer = true
where slug = 'mahnungen';

-- Gutschrift: buchungs- und steuerrelevant (Compliance bleibt), kundenbezogen
update document_types set
  is_system = true,
  is_accounting_relevant = true,
  is_tax_relevant = true,
  versioning_enabled = true,
  versioning_required = true,
  finalization_required = true,
  lock_finalized_versions = true,
  create_pdf_snapshot_on_finalize = true,
  audit_log_enabled = true,
  belongs_to_project = true,
  belongs_to_customer = true
where slug = 'gutschriften';

-- Serverseitiger Löschschutz: geschützte System-Dokumenttypen können nicht gelöscht werden.
create or replace function prevent_delete_system_doctype() returns trigger
  language plpgsql as $$
begin
  if OLD.is_system then
    raise exception 'Geschützter System-Dokumenttyp "%" kann nicht gelöscht werden.', OLD.slug
      using errcode = 'P0001';
  end if;
  return OLD;
end $$;

drop trigger if exists trg_prevent_delete_system_doctype on document_types;
create trigger trg_prevent_delete_system_doctype
  before delete on document_types
  for each row execute function prevent_delete_system_doctype();
