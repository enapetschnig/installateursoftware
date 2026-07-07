-- ============================================================
-- Versionierung & Compliance je Dokumenttyp (dynamisch für alle Typen)
-- ============================================================
alter table public.document_types
  add column if not exists is_accounting_relevant boolean not null default false,
  add column if not exists is_tax_relevant boolean not null default false,
  add column if not exists versioning_enabled boolean not null default false,
  add column if not exists versioning_required boolean not null default false,
  add column if not exists finalization_required boolean not null default false,
  add column if not exists lock_finalized_versions boolean not null default false,
  add column if not exists create_pdf_snapshot_on_finalize boolean not null default false,
  add column if not exists audit_log_enabled boolean not null default false;

-- Compliance-Invariante DB-seitig erzwingen (unabhängig von der UI):
-- buchungs-/steuerrelevant ⇒ Versionierung/Abschluss/Sperre/Snapshot/Audit verpflichtend.
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
  end if;
  return new;
end $$;

drop trigger if exists trg_doctype_compliance on public.document_types;
create trigger trg_doctype_compliance
  before insert or update on public.document_types
  for each row execute function public.enforce_doctype_compliance();

-- Bestehende, klar buchungs-/steuerrelevante Dokumentarten vorbelegen
update public.document_types
set is_accounting_relevant = true, is_tax_relevant = true
where lower(slug) in ('rechnungen','mahnungen','gutschriften','rechnungsverkehr');
