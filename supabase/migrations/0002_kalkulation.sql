-- ============================================================
-- B4Y SuperAPP – Migration 0002: Kalkulationsmodul
-- Additiv. Keine bestehende Tabelle/Daten wird verändert.
-- Tabellen: trades, hourly_rates, articles, services,
--           service_components, calc_audit_log
-- RLS-Muster wie Bestand: Policy app_all (ALL, authenticated, true/true)
-- Angewendet am: 2026-06-13 (Supabase: kalkulation_module)
-- ============================================================

-- ---------- Hilfsfunktionen (Trigger) ----------
create or replace function public.b4y_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create or replace function public.b4y_calc_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') then
    insert into public.calc_audit_log(entity_type, entity_id, action, old_data)
    values (tg_argv[0], old.id, 'delete', to_jsonb(old));
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.calc_audit_log(entity_type, entity_id, action, old_data, new_data)
    values (tg_argv[0], new.id, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.calc_audit_log(entity_type, entity_id, action, new_data)
    values (tg_argv[0], new.id, 'insert', to_jsonb(new));
    return new;
  end if;
end; $$;

revoke execute on function public.b4y_calc_audit() from public, anon, authenticated;
revoke execute on function public.b4y_touch_updated_at() from public, anon, authenticated;

-- ---------- Audit-Log ----------
create table if not exists public.calc_audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null check (action in ('insert','update','delete')),
  changed_by uuid default auth.uid(),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- ---------- Gewerke ----------
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  description text,
  color text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Stundensätze ----------
create table if not exists public.hourly_rates (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid references public.trades(id) on delete cascade,
  label text not null,
  internal_rate numeric not null default 0,   -- interner Stundensatz netto
  sale_rate numeric not null default 0,       -- Verkaufssatz netto
  valid_from date,
  valid_to date,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Artikelstamm ----------
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  article_number text,
  name text not null,
  description text,
  category text,
  unit text default 'Stk',
  purchase_price numeric not null default 0,  -- EK netto
  sale_price numeric not null default 0,      -- VK netto
  supplier text,
  is_stock boolean not null default false,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Leistungen ----------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  service_number text,
  name text not null,
  short_text text,
  long_text text,
  trade_id uuid references public.trades(id) on delete set null,
  unit text default 'Stk',
  overhead_percent numeric not null default 0,   -- Gemeinkosten-Vorgabe %
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Leistungsbestandteile ----------
create table if not exists public.service_components (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  kind text not null default 'material'
    check (kind in ('arbeitszeit','material','maschine','subunternehmer','gemeinkosten','individuell')),
  sort_order int not null default 0,
  label text,
  hourly_rate_id uuid references public.hourly_rates(id) on delete set null,
  article_id uuid references public.articles(id) on delete set null,
  minutes numeric not null default 0,     -- für Arbeitszeit
  quantity numeric not null default 0,    -- für Material/Maschine/Subunternehmer/individuell
  unit text,
  cost_rate numeric not null default 0,   -- Selbstkosten je Einheit (interner Satz / EK)
  sale_rate numeric not null default 0,   -- Verkauf je Einheit (VK-Satz / VK)
  percent numeric not null default 0,     -- für Gemeinkosten %
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Indizes ----------
create index if not exists idx_hourly_rates_trade on public.hourly_rates(trade_id);
create index if not exists idx_services_trade on public.services(trade_id);
create index if not exists idx_service_components_service on public.service_components(service_id);
create index if not exists idx_calc_audit_entity on public.calc_audit_log(entity_type, entity_id);

-- ---------- RLS aktivieren ----------
alter table public.trades enable row level security;
alter table public.hourly_rates enable row level security;
alter table public.articles enable row level security;
alter table public.services enable row level security;
alter table public.service_components enable row level security;
alter table public.calc_audit_log enable row level security;

-- ---------- Policies (Muster wie Bestand) ----------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trades' and policyname='app_all') then
    create policy app_all on public.trades for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hourly_rates' and policyname='app_all') then
    create policy app_all on public.hourly_rates for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='articles' and policyname='app_all') then
    create policy app_all on public.articles for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='services' and policyname='app_all') then
    create policy app_all on public.services for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='service_components' and policyname='app_all') then
    create policy app_all on public.service_components for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='calc_audit_log' and policyname='app_read') then
    create policy app_read on public.calc_audit_log for select to authenticated using (true);
  end if;
end $$;

-- ---------- updated_at-Trigger ----------
drop trigger if exists trg_touch_trades on public.trades;
create trigger trg_touch_trades before update on public.trades
  for each row execute function public.b4y_touch_updated_at();
drop trigger if exists trg_touch_hourly_rates on public.hourly_rates;
create trigger trg_touch_hourly_rates before update on public.hourly_rates
  for each row execute function public.b4y_touch_updated_at();
drop trigger if exists trg_touch_articles on public.articles;
create trigger trg_touch_articles before update on public.articles
  for each row execute function public.b4y_touch_updated_at();
drop trigger if exists trg_touch_services on public.services;
create trigger trg_touch_services before update on public.services
  for each row execute function public.b4y_touch_updated_at();
drop trigger if exists trg_touch_service_components on public.service_components;
create trigger trg_touch_service_components before update on public.service_components
  for each row execute function public.b4y_touch_updated_at();

-- ---------- Audit-Trigger (Preis-/Kalkulationsänderungen) ----------
drop trigger if exists trg_audit_hourly_rates on public.hourly_rates;
create trigger trg_audit_hourly_rates after insert or update or delete on public.hourly_rates
  for each row execute function public.b4y_calc_audit('hourly_rate');
drop trigger if exists trg_audit_articles on public.articles;
create trigger trg_audit_articles after insert or update or delete on public.articles
  for each row execute function public.b4y_calc_audit('article');
drop trigger if exists trg_audit_services on public.services;
create trigger trg_audit_services after insert or update or delete on public.services
  for each row execute function public.b4y_calc_audit('service');
drop trigger if exists trg_audit_service_components on public.service_components;
create trigger trg_audit_service_components after insert or update or delete on public.service_components
  for each row execute function public.b4y_calc_audit('service_component');
