-- ============================================================
-- B4Y SuperAPP – Migration 0004
-- Dokument-Seitenleiste (HERO-Stil): Textbausteine, Titel,
-- Nutzungshäufigkeit, Vorlagen, JSONB-Positionen für Aufträge.
-- Idempotent – mehrfach ausführbar.
-- ============================================================

-- ---------- 1) Textbausteine & Titel (Stammdaten) ----------
create table if not exists public.text_blocks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  -- 'text' = Textbaustein, 'titel' = Überschrift/Gliederungspunkt
  type text not null default 'text' check (type in ('text','titel')),
  -- fachliche Einordnung (frei, mit empfohlenen Werten)
  category text not null default 'standard'
    check (category in (
      'standard','vorbemerkung','schlusstext','gewaehrleistung',
      'zahlungsbedingung','titel'
    )),
  level int not null default 1,        -- nur für Titel relevant
  sort_order int not null default 0,
  usage_count int not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 2) Nutzungshäufigkeit auf Stammdaten ----------
alter table public.articles add column if not exists usage_count int not null default 0;
alter table public.services add column if not exists usage_count int not null default 0;

-- ---------- 3) JSONB-Positionen auch für Aufträge ----------
-- Angebote haben bereits 'items jsonb'. Aufträge bekommen das gleiche
-- Modell für die neue Dokument-Engine (order_items bleibt für die
-- Rechnungs-/Verrechnungslogik erhalten und wird daraus befüllt).
alter table public.orders add column if not exists items jsonb not null default '[]'::jsonb;

-- ---------- 4) Dokument-Vorlagen (wiederverwendbare Positions-Sets) ----------
create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- für welchen Dokumenttyp gedacht (angebot, auftrag, rechnung, ...)
  doc_type text not null default 'angebot',
  description text,
  items jsonb not null default '[]'::jsonb,
  usage_count int not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 5) Indizes ----------
create index if not exists idx_text_blocks_type on public.text_blocks(type);
create index if not exists idx_text_blocks_active on public.text_blocks(active);
create index if not exists idx_document_templates_type on public.document_templates(doc_type);

-- ---------- 6) RLS ----------
alter table public.text_blocks enable row level security;
alter table public.document_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='text_blocks' and policyname='app_all') then
    create policy app_all on public.text_blocks for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_templates' and policyname='app_all') then
    create policy app_all on public.document_templates for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------- 7) updated_at-Trigger (Muster wie Bestand) ----------
drop trigger if exists trg_touch_text_blocks on public.text_blocks;
create trigger trg_touch_text_blocks before update on public.text_blocks
  for each row execute function public.b4y_touch_updated_at();

drop trigger if exists trg_touch_document_templates on public.document_templates;
create trigger trg_touch_document_templates before update on public.document_templates
  for each row execute function public.b4y_touch_updated_at();

-- ---------- 8) RPC: Nutzungshäufigkeit hochzählen ----------
-- Wird beim Einfügen aus der Seitenleiste aufgerufen. Sicher gegen
-- ungültige Kinds; zählt nur aktive Stammdaten.
create or replace function public.b4y_bump_usage(p_kind text, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;
  if p_kind = 'article' then
    update public.articles set usage_count = usage_count + 1 where id = any(p_ids);
  elsif p_kind = 'service' then
    update public.services set usage_count = usage_count + 1 where id = any(p_ids);
  elsif p_kind = 'text' or p_kind = 'title' then
    update public.text_blocks set usage_count = usage_count + 1 where id = any(p_ids);
  end if;
end;
$$;

-- ---------- 9) Seeds: österreichische Standard-Textbausteine & Titel ----------
-- Nur einfügen, wenn noch keine Textbausteine existieren.
do $$
begin
  if not exists (select 1 from public.text_blocks limit 1) then
    insert into public.text_blocks (title, content, type, category, level, sort_order) values
    ('Vorbemerkung',
     'Die nachstehenden Positionen wurden nach bestem Wissen kalkuliert. Massenangaben sind, sofern nicht anders vermerkt, vorläufig und werden nach tatsächlichem Aufmaß abgerechnet.',
     'text','vorbemerkung',1,10),
    ('Angebotsgültigkeit',
     'Dieses Angebot ist freibleibend und 30 Tage ab Ausstellungsdatum gültig.',
     'text','vorbemerkung',1,20),
    ('Zahlungsbedingungen',
     'Zahlbar innerhalb von 14 Tagen ab Rechnungsdatum ohne Abzug. Bei Bauleistungen gilt §19 Abs. 1a UStG (Übergang der Steuerschuld), sofern zutreffend.',
     'text','zahlungsbedingung',1,30),
    ('Gewährleistung',
     'Für die erbrachten Leistungen gilt die gesetzliche Gewährleistungsfrist gemäß ABGB. Für Bauleistungen beträgt die Gewährleistungsfrist drei Jahre ab Übernahme.',
     'text','gewaehrleistung',1,40),
    ('Schlusstext',
     'Wir freuen uns auf Ihren Auftrag und stehen für Rückfragen jederzeit gerne zur Verfügung. Mit freundlichen Grüßen, BAU4YOU Baranowski Bau GmbH.',
     'text','schlusstext',1,50),
    ('Abschnitt: Baustelleneinrichtung','','titel','titel',1,60),
    ('Abschnitt: Abbruch- und Demontagearbeiten','','titel','titel',1,70),
    ('Abschnitt: Maurer- und Betonarbeiten','','titel','titel',1,80),
    ('Abschnitt: Malerarbeiten','','titel','titel',1,90),
    ('Abschnitt: Regiearbeiten','','titel','titel',1,100);
  end if;
end $$;
