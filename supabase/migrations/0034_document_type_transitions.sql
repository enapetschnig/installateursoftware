-- Folge-Dokument-Workflow: Angebotstyp fließt durch Auftrag → Rechnung.
-- Typ/Darstellung/Texte werden als Snapshot in orders/invoices kopiert.

-- 1) Snapshot-Spalten auf Folgedokumenten (mandantenfähig, keine harten Werte)
alter table public.orders
  add column if not exists offer_type_id uuid references public.offer_types(id) on delete set null,
  add column if not exists pdf_label text,
  add column if not exists doc_intro_text text,
  add column if not exists doc_closing_text text,
  add column if not exists display_settings_snapshot jsonb;

alter table public.invoices
  add column if not exists offer_type_id uuid references public.offer_types(id) on delete set null,
  add column if not exists pdf_label text,
  add column if not exists doc_intro_text text,
  add column if not exists doc_closing_text text,
  add column if not exists display_settings_snapshot jsonb;

-- 2) Übergangs-Definition je Typ-Familie (frei konfigurierbar je Firma)
create table if not exists public.document_type_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  offer_type_id uuid not null references public.offer_types(id) on delete cascade,
  order_label text,
  order_intro_text text,
  order_closing_text text,
  invoice_label text,
  invoice_intro_text text,
  invoice_closing_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, offer_type_id)
);

alter table public.document_type_transitions enable row level security;

drop policy if exists dtt_all on public.document_type_transitions;
create policy dtt_all on public.document_type_transitions
  for all to authenticated using (true) with check (true);

drop policy if exists dtt_org_isolation on public.document_type_transitions;
create policy dtt_org_isolation on public.document_type_transitions
  as restrictive for all to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- 3) Seed: für jeden bestehenden Angebotstyp eine editierbare Übergangs-Vorlage
--    (Bezeichnungen aus pdf_label abgeleitet: Angebot→Auftrag→Rechnung)
insert into public.document_type_transitions (organization_id, offer_type_id, order_label, invoice_label)
select t.organization_id, t.id,
  regexp_replace(regexp_replace(coalesce(t.pdf_label,'Angebot'),'Angebot','Auftrag','g'),'angebot','auftrag','g'),
  regexp_replace(regexp_replace(coalesce(t.pdf_label,'Angebot'),'Angebot','Rechnung','g'),'angebot','rechnung','g')
from public.offer_types t
where not exists (
  select 1 from public.document_type_transitions x
  where x.offer_type_id = t.id and x.organization_id = t.organization_id
);
