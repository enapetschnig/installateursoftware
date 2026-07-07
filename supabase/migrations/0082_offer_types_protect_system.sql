-- ============================================================
-- B4Y SuperAPP – Schutz der Standard-Dokumentvarianten (offer_types)
-- ------------------------------------------------------------
-- Standardvarianten (Standard/Pauschal/Regie) sind fixe Grundbestandteile und
-- dürfen NICHT gelöscht werden (bearbeiten/aktivieren/deaktivieren bleibt erlaubt).
-- Schutz mehrschichtig: hier DB-Ebene (Flag + BEFORE DELETE Trigger), zusätzlich
-- UI + Service im Frontend. Rein additiv, RLS/organization_id unverändert.
-- Markierung als Seed/Config (Slug-basiert), keine BAU4YOU-Hardcodierung in der App-Logik.
-- ============================================================

alter table public.offer_types
  add column if not exists is_system boolean not null default false;

comment on column public.offer_types.is_system is
  'Geschützte Standard-Dokumentvariante (z. B. Standard/Pauschal/Regie). Nicht löschbar; bearbeitbar/deaktivierbar. Mandantenfähig (je Organisation markiert).';

-- Vorhandene Standardvarianten je Organisation markieren (Slug-basiert = Seed/Config).
update public.offer_types
   set is_system = true
 where lower(slug) in ('standard', 'pauschal', 'regie');

-- Serverseitiger Löschschutz (Muster wie prevent_delete_system_doctype, Migr. 0039).
create or replace function prevent_delete_system_offer_type() returns trigger
  language plpgsql as $$
begin
  if OLD.is_system then
    raise exception 'Standard-Dokumentvariante "%" kann nicht gelöscht werden.', OLD.name
      using errcode = 'P0001';
  end if;
  return OLD;
end $$;

drop trigger if exists trg_prevent_delete_system_offer_type on public.offer_types;
create trigger trg_prevent_delete_system_offer_type
  before delete on public.offer_types
  for each row execute function prevent_delete_system_offer_type();
