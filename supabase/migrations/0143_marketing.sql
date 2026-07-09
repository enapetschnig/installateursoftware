-- ============================================================
-- Installateur SuperAPP – Migration 0143
-- Marketing-Modul: Social-Beiträge, Werbekampagnen, Kanäle
-- ------------------------------------------------------------
-- Zweck:
--   Redaktionsplanung für Social-Media-Beiträge (Facebook/Instagram)
--   und Werbeanzeigen-Kampagnen – vollwertig als PLANUNGSWERKZEUG.
--
--   WICHTIG / ehrliche Abgrenzung: Die tatsächliche Veröffentlichung zu
--   Facebook/Instagram ist NICHT angebunden. `social_accounts.status`
--   bildet den Verbindungszustand ab; Beiträge laufen bis `geplant` bzw.
--   werden manuell auf `veroeffentlicht` gesetzt. Es wird nirgends
--   vorgetäuscht, dass etwas gepostet wurde, was nicht gepostet wurde.
--
-- Mandantenfähigkeit: organization_id NOT NULL DEFAULT current_org_id().
-- RLS: permissive app_all + restrictive org_isolation (Post-0063-Standard).
-- ============================================================

-- ── 1) Kanäle (Verbindungszustand) ─────────────────────────
create table if not exists public.social_accounts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default public.current_org_id()
                     references public.organizations(id) on delete cascade,
  platform         text not null,          -- facebook | instagram | linkedin | google_ads
  account_name     text,
  status           text not null default 'nicht_verbunden',  -- nicht_verbunden | verbunden | fehler
  external_id      text,
  connected_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint social_accounts_platform_check check (
    platform = any (array['facebook','instagram','linkedin','google_ads'])
  ),
  constraint social_accounts_status_check check (
    status = any (array['nicht_verbunden','verbunden','fehler'])
  )
);
create unique index if not exists social_accounts_org_platform_uq
  on public.social_accounts (organization_id, platform);

comment on table public.social_accounts is
  'Verbindungszustand der Marketing-Kanäle. status=verbunden bedeutet: echte API-Anbindung vorhanden (aktuell nicht implementiert).';

-- ── 2) Werbekampagnen ──────────────────────────────────────
create table if not exists public.ad_campaigns (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default public.current_org_id()
                     references public.organizations(id) on delete cascade,
  name             text not null,
  platform         text not null default 'facebook',
  objective        text not null default 'leads',   -- reichweite | traffic | leads | conversions
  status           text not null default 'entwurf', -- entwurf | aktiv | pausiert | beendet
  budget_total     numeric(12,2),
  budget_daily     numeric(12,2),
  start_date       date,
  end_date         date,
  target_audience  jsonb not null default '{}'::jsonb,  -- {ort, radius_km, alter_von, alter_bis, interessen[]}
  metrics          jsonb not null default '{}'::jsonb,  -- {impressions, clicks, leads, spend, ctr, cpl}
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ad_campaigns_objective_check check (
    objective = any (array['reichweite','traffic','leads','conversions'])
  ),
  constraint ad_campaigns_status_check check (
    status = any (array['entwurf','aktiv','pausiert','beendet'])
  ),
  constraint ad_campaigns_platform_check check (
    platform = any (array['facebook','instagram','google_ads'])
  )
);
create index if not exists ad_campaigns_org_status_idx on public.ad_campaigns (organization_id, status);

-- ── 3) Social-Beiträge (Redaktionsplan) ────────────────────
create table if not exists public.social_posts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default public.current_org_id()
                     references public.organizations(id) on delete cascade,
  title            text,
  content          text not null default '',
  platforms        text[] not null default array['facebook']::text[],
  status           text not null default 'entwurf',  -- entwurf | geplant | veroeffentlicht | archiviert
  scheduled_at     timestamptz,
  published_at     timestamptz,
  image_path       text,        -- Objektpfad im Bucket 'marketing' (<orgId>/posts/...)
  link_url         text,
  hashtags         text[] not null default '{}'::text[],
  ai_generated     boolean not null default false,
  campaign_id      uuid references public.ad_campaigns(id) on delete set null,
  project_id       uuid references public.projects(id) on delete set null,
  metrics          jsonb not null default '{}'::jsonb,  -- {reach, likes, comments, shares, clicks}
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint social_posts_status_check check (
    status = any (array['entwurf','geplant','veroeffentlicht','archiviert'])
  )
);
create index if not exists social_posts_org_status_idx    on public.social_posts (organization_id, status);
create index if not exists social_posts_org_scheduled_idx on public.social_posts (organization_id, scheduled_at);

comment on column public.social_posts.status is
  'entwurf → geplant (Termin gesetzt) → veroeffentlicht. Solange kein Kanal verbunden ist, wird "veroeffentlicht" manuell gesetzt – es erfolgt KEIN automatischer Post.';

-- ── 4) updated_at-Trigger ──────────────────────────────────
create or replace function public.tg_marketing_touch()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_social_accounts_touch on public.social_accounts;
create trigger trg_social_accounts_touch before update on public.social_accounts
  for each row execute function public.tg_marketing_touch();
drop trigger if exists trg_ad_campaigns_touch on public.ad_campaigns;
create trigger trg_ad_campaigns_touch before update on public.ad_campaigns
  for each row execute function public.tg_marketing_touch();
drop trigger if exists trg_social_posts_touch on public.social_posts;
create trigger trg_social_posts_touch before update on public.social_posts
  for each row execute function public.tg_marketing_touch();

-- ── 5) RLS (Post-0063-Standard) ────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['social_accounts','ad_campaigns','social_posts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_app_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_org_isolation', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (organization_id = public.current_org_id())
         with check (organization_id = public.current_org_id())',
      t || '_org_isolation', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 6) Bild-Bucket 'marketing' (privat, org-isoliert wie 0129) ──
insert into storage.buckets (id, name, public)
  values ('marketing', 'marketing', false)
  on conflict (id) do update set public = false;
update storage.buckets set
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
  where id = 'marketing';

do $$
begin
  drop policy if exists "marketing_org_read"   on storage.objects;
  drop policy if exists "marketing_org_write"  on storage.objects;
  drop policy if exists "marketing_org_update" on storage.objects;
  drop policy if exists "marketing_org_delete" on storage.objects;

  create policy "marketing_org_read" on storage.objects for select to authenticated
    using (bucket_id = 'marketing' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "marketing_org_write" on storage.objects for insert to authenticated
    with check (bucket_id = 'marketing' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "marketing_org_update" on storage.objects for update to authenticated
    using (bucket_id = 'marketing' and (storage.foldername(name))[1] = (select current_org_id())::text)
    with check (bucket_id = 'marketing' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "marketing_org_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'marketing' and (storage.foldername(name))[1] = (select current_org_id())::text);
end $$;

-- ── 7) Rechte-Modul 'marketing' registrieren ───────────────
insert into public.permission_modules (key, label, group_key, supports_scope, actions, is_system, active, sort_order)
  values ('marketing', 'Marketing', 'system', true,
          array['view','create','edit','delete','export','print'], true, true, 6)
  on conflict (key) do update set label = excluded.label, active = true;

-- ── 8) Startkonfiguration + Beispielinhalte ────────────────
-- Kanäle als "nicht_verbunden" anlegen (ehrlicher Ausgangszustand) und
-- einen gefüllten Redaktionsplan als Ausgangsbeispiel bereitstellen.
do $$
declare v_org uuid; v_campaign uuid;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then return; end if;

  insert into public.social_accounts (organization_id, platform, account_name, status)
  values (v_org, 'facebook',   'Bad.Werk GmbH', 'nicht_verbunden'),
         (v_org, 'instagram',  'badwerk.at',    'nicht_verbunden'),
         (v_org, 'google_ads', null,            'nicht_verbunden')
  on conflict (organization_id, platform) do nothing;

  if not exists (select 1 from public.ad_campaigns where organization_id = v_org) then
    insert into public.ad_campaigns
      (organization_id, name, platform, objective, status, budget_total, budget_daily,
       start_date, end_date, target_audience, metrics)
    values
      (v_org, 'Frühjahrs-Aktion Komplettbad', 'facebook', 'leads', 'aktiv', 1200.00, 40.00,
       current_date - 18, current_date + 12,
       '{"ort":"Linz","radius_km":30,"alter_von":30,"alter_bis":65,"interessen":["Eigenheim","Renovierung","Wohnen"]}'::jsonb,
       '{"impressions":48210,"clicks":1342,"leads":37,"spend":720.00,"ctr":2.78,"cpl":19.46}'::jsonb)
    returning id into v_campaign;

    insert into public.ad_campaigns
      (organization_id, name, platform, objective, status, budget_total, budget_daily,
       start_date, end_date, target_audience, metrics)
    values
      (v_org, 'Badausstellung – Terminbuchung', 'instagram', 'traffic', 'pausiert', 600.00, 25.00,
       current_date - 40, current_date - 5,
       '{"ort":"Oberösterreich","radius_km":50,"alter_von":28,"alter_bis":60,"interessen":["Interior","Badezimmer"]}'::jsonb,
       '{"impressions":19870,"clicks":611,"leads":9,"spend":410.00,"ctr":3.08,"cpl":45.56}'::jsonb);
  end if;

  if not exists (select 1 from public.social_posts where organization_id = v_org) then
    insert into public.social_posts
      (organization_id, title, content, platforms, status, scheduled_at, published_at, hashtags, campaign_id, metrics)
    values
      (v_org, 'Vorher/Nachher: Komplettbad in Linz',
       E'Aus alt mach neu: In nur 9 Arbeitstagen haben wir dieses Bad in Linz komplett saniert – bodengleiche Dusche, Fußbodenheizung und großformatige Fliesen.\n\nAlles aus einer Hand: Planung, Abbruch, Installation, Fliesen, Endreinigung. Ihr Bad, unser Handwerk.',
       array['facebook','instagram'], 'veroeffentlicht', now() - interval '9 days', now() - interval '9 days',
       array['badsanierung','komplettbad','linz','handwerk'], v_campaign,
       '{"reach":8420,"likes":214,"comments":18,"shares":11,"clicks":96}'::jsonb),

      (v_org, '3 Tipps für eine barrierefreie Dusche',
       E'Barrierefrei heißt nicht „steril". Worauf es wirklich ankommt:\n\n1) Bodengleicher Einstieg ohne Stolperkante\n2) Rutschhemmende Fliesen (mind. R10)\n3) Haltegriffe, die wie Designelemente aussehen\n\nWir beraten Sie gerne persönlich.',
       array['facebook'], 'veroeffentlicht', now() - interval '3 days', now() - interval '3 days',
       array['barrierefrei','dusche','badplanung'], null,
       '{"reach":5130,"likes":142,"comments":9,"shares":7,"clicks":58}'::jsonb),

      (v_org, 'Neue Badausstellung – jetzt Termin sichern',
       E'Unsere neue Ausstellung ist eröffnet! Erleben Sie Armaturen, Fliesen und Duschlösungen zum Angreifen.\n\nTerminvereinbarung telefonisch oder direkt über unsere Website.',
       array['facebook','instagram'], 'geplant', now() + interval '2 days', null,
       array['badausstellung','showroom','termin'], null, '{}'::jsonb),

      (v_org, 'Team-Vorstellung: unsere Installateure',
       E'Hinter jedem fertigen Bad steht ein eingespieltes Team. Diese Woche stellen wir unsere Monteure vor.',
       array['instagram'], 'entwurf', null, null,
       array['team','handwerk','ausbildung'], null, '{}'::jsonb);
  end if;
end $$;
