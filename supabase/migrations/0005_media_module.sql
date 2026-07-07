-- ============================================================
-- B4Y SuperAPP – Migration 0005: Medienmodul (Fotos & Videos)
-- Zentrale Foto-/Video-Kategorien + erweitertes project_media.
-- Idempotent. (Wurde via MCP angewandt; Datei dient der Historie.)
-- ============================================================
create table if not exists public.media_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  applies_to_photos boolean not null default true,
  applies_to_videos boolean not null default true,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_media
  add column if not exists thumbnail_url text,
  add column if not exists mime_type text,
  add column if not exists media_type text not null default 'photo' check (media_type in ('photo','video')),
  add column if not exists category_id uuid references public.media_categories(id) on delete set null,
  add column if not exists title text,
  add column if not exists taken_at timestamptz,
  add column if not exists source text not null default 'upload' check (source in ('upload','camera','mobile_camera','ipad_camera')),
  add column if not exists sort_order int not null default 0,
  add column if not exists is_favorite boolean not null default false;

create index if not exists idx_project_media_project on public.project_media(project_id);
create index if not exists idx_project_media_category on public.project_media(category_id);
create index if not exists idx_media_categories_active on public.media_categories(is_active);

alter table public.media_categories enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='media_categories' and policyname='app_all') then
    create policy app_all on public.media_categories for all to authenticated using (true) with check (true);
  end if;
end $$;

drop trigger if exists trg_touch_media_categories on public.media_categories;
create trigger trg_touch_media_categories before update on public.media_categories
  for each row execute function public.b4y_touch_updated_at();

do $$
begin
  if not exists (select 1 from public.media_categories limit 1) then
    insert into public.media_categories (name, applies_to_photos, applies_to_videos, is_default, sort_order) values
    ('Erstbesichtigung', true, true, false, 10),
    ('Baufortschritt',   true, true, false, 20),
    ('Nachtrag',         true, true, false, 30),
    ('Regiearbeit',      true, true, false, 40),
    ('Mangel',           true, true, false, 50),
    ('Schaden',          true, true, false, 60),
    ('Dokumentation',    true, true, false, 70),
    ('Vorher',           true, true, false, 80),
    ('Nachher',          true, true, false, 90),
    ('Subunternehmer',   true, true, false, 100),
    ('Lieferant',        true, true, false, 110),
    ('Kunde',            true, true, false, 120),
    ('Abnahme',          true, true, false, 130),
    ('Rechnung',         true, true, false, 140),
    ('Sonstiges',        true, true, true,  150);
  end if;
end $$;

do $$
declare def_id uuid;
begin
  select id into def_id from public.media_categories where is_default = true order by sort_order limit 1;
  update public.project_media
     set media_type = case when coalesce(file_type,'') like 'video%' then 'video' else 'photo' end
   where media_type is null or media_type = '';
  update public.project_media set mime_type = coalesce(mime_type, file_type) where mime_type is null;
  if def_id is not null then
    update public.project_media set category_id = def_id where category_id is null;
  end if;
end $$;
