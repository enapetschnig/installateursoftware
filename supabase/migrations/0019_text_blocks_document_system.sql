-- ============================================================
-- Zentrales Textbaustein-System: generische Untertypen + erweiterte text_blocks
-- ============================================================

-- 1) Generische Dokument-Untertypen (je Dokumententyp, frei erweiterbar)
create table if not exists public.document_subtypes (
  id uuid primary key default gen_random_uuid(),
  document_type_id uuid not null references public.document_types(id) on delete cascade,
  name text not null,
  slug text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_document_subtypes_type on public.document_subtypes(document_type_id);
alter table public.document_subtypes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='document_subtypes' and policyname='sel') then
    create policy "sel" on public.document_subtypes for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='document_subtypes' and policyname='mod') then
    create policy "mod" on public.document_subtypes for all to authenticated
      using (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'kalkulation','edit'))
      with check (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'kalkulation','edit'));
  end if;
end $$;

-- 2) text_blocks erweitern (bestehende Einträge bleiben erhalten)
alter table public.text_blocks
  add column if not exists text_type text not null default 'hinweis',
  add column if not exists content_html text,
  add column if not exists document_type_id uuid references public.document_types(id) on delete set null,
  add column if not exists document_subtype_id uuid references public.document_subtypes(id) on delete set null,
  add column if not exists project_type_id uuid references public.project_types(id) on delete set null,
  add column if not exists customer_type text,
  add column if not exists language text not null default 'de',
  add column if not exists is_default boolean not null default false,
  add column if not exists applies_to_all_doctypes boolean not null default false;

create index if not exists idx_text_blocks_match
  on public.text_blocks(text_type, document_type_id, project_type_id) where active;

-- 3) Bestehende Bausteine migrieren: doc_type (Freitext) → document_type_id per Namenspräfix
update public.text_blocks tb
set document_type_id = dt.id
from public.document_types dt
where tb.document_type_id is null
  and tb.doc_type is not null and btrim(tb.doc_type) <> ''
  and lower(btrim(tb.doc_type)) not in ('allgemein','alle')
  and dt.name ilike btrim(tb.doc_type) || '%';

update public.text_blocks
set applies_to_all_doctypes = true
where document_type_id is null;

-- 4) Angebots-Untertypen aus offer_types als Untertypen von "Angebote" anlegen
insert into public.document_subtypes (document_type_id, name, slug, sort_order, is_active)
select dt.id, ot.name, ot.slug, ot.sort_order, ot.is_active
from public.offer_types ot
cross join lateral (
  select id from public.document_types where lower(name) = 'angebote' order by sort_order limit 1
) dt
where not exists (
  select 1 from public.document_subtypes ds
  where ds.document_type_id = dt.id and ds.slug = ot.slug
);
