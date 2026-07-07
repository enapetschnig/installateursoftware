-- ============================================================
-- B4Y SuperAPP – Migration 0014
-- Zentrale Dokumentenstruktur: document_types (verwaltbare Arten)
-- + documents (Uploads/E-Mails/externe Dateien). Idempotent.
-- ============================================================

create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category text,
  sort_order int not null default 0,
  icon text,
  is_active boolean not null default true,
  allow_upload boolean not null default true,
  allow_create boolean not null default false,
  belongs_to_project boolean not null default true,
  belongs_to_customer boolean not null default false,
  belongs_to_employee boolean not null default false,
  belongs_to_supplier boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  customer_id uuid references public.contacts(id) on delete set null,
  document_type_id uuid references public.document_types(id) on delete set null,
  document_number text,
  title text,
  subject text,
  status text not null default 'erhalten',
  source_type text not null default 'uploaded_file',
  file_url text,
  file_name text,
  file_mime_type text,
  file_size bigint,
  sender text,
  recipient text,
  version text,
  doc_date date,
  note text,
  created_by uuid default auth.uid() references auth.users(id),
  uploaded_by uuid references auth.users(id),
  sent_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_documents_project on public.documents(project_id);
create index if not exists idx_documents_type on public.documents(document_type_id);

alter table public.document_types enable row level security;
alter table public.documents enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_types' and policyname='app_all') then
    create policy app_all on public.document_types for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='documents' and policyname='app_all') then
    create policy app_all on public.documents for all to authenticated using (true) with check (true);
  end if;
end $$;

drop trigger if exists trg_touch_document_types on public.document_types;
create trigger trg_touch_document_types before update on public.document_types
  for each row execute function public.b4y_touch_updated_at();
drop trigger if exists trg_touch_documents on public.documents;
create trigger trg_touch_documents before update on public.documents
  for each row execute function public.b4y_touch_updated_at();

-- ---------- Seed: 27 Dokumentarten (nur wenn leer) ----------
do $$
begin
  if not exists (select 1 from public.document_types limit 1) then
    insert into public.document_types (name, slug, category, sort_order, allow_upload, allow_create) values
    ('Anfrage Mail','anfrage_mail','Kommunikation',10,true,false),
    ('Angebote','angebote','Angebote',20,true,true),
    ('Angebote SUB','angebote_sub','Angebote',30,true,true),
    ('Angebot Nachtrag','angebot_nachtrag','Angebote',40,true,true),
    ('Aufträge','auftraege','Aufträge',50,true,true),
    ('Auftrag SUB','auftrag_sub','Aufträge',60,true,true),
    ('Auftragsbestätigung','auftragsbestaetigung','Aufträge',70,true,true),
    ('Auftragsbestätigung SUB','auftragsbestaetigung_sub','Aufträge',80,true,true),
    ('Unterschriebene Aufträge','unterschriebene_auftraege','Aufträge',90,true,false),
    ('Rechnungen','rechnungen','Rechnungen',100,true,true),
    ('Mahnungen','mahnungen','Rechnungen',110,true,true),
    ('Gutschriften','gutschriften','Rechnungen',120,true,true),
    ('Rechnungsverkehr','rechnungsverkehr','Rechnungen',130,true,false),
    ('Nachträge','nachtraege','Aufträge',140,true,true),
    ('Materialbestellungen','materialbestellungen','Intern',150,true,true),
    ('Briefe','briefe','Kommunikation',160,true,true),
    ('Lieferanten','lieferanten','Kommunikation',170,true,false),
    ('Aufmaße','aufmasse','Pläne & Nachweise',180,true,true),
    ('Pläne','plaene','Pläne & Nachweise',190,true,false),
    ('Einreichung','einreichung','Pläne & Nachweise',200,true,false),
    ('Statik','statik','Pläne & Nachweise',210,true,false),
    ('Elektrobefunde','elektrobefunde','Pläne & Nachweise',220,true,false),
    ('Kalkulation','kalkulation','Intern',230,true,true),
    ('Arbeitsanweisung','arbeitsanweisung','Intern',240,true,true),
    ('Parkflächenabsperrung','parkflaechenabsperrung','Intern',250,true,true),
    ('Zeitvorgabe','zeitvorgabe','Intern',260,true,true),
    ('Baustellenbericht','baustellenbericht','Intern',270,true,true);
  end if;
end $$;
