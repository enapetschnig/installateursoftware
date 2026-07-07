-- ============================================================
-- B4Y SuperAPP – Migration 0016
-- Angebotsdarstellung: globale Defaults + pro-Angebot-Override.
-- Steuert NUR die PDF-/Kundendarstellung, nicht die Kalkulation.
-- ============================================================
create table if not exists public.offer_display_settings (
  id int primary key default 1 check (id = 1),
  default_is_lump_sum boolean not null default false,
  default_show_unit_prices boolean not null default true,
  default_show_position_totals boolean not null default true,
  default_show_subtotals boolean not null default true,
  default_show_only_grand_total boolean not null default false,
  default_show_images boolean not null default false,
  default_show_service_images boolean not null default false,
  default_show_article_images boolean not null default false,
  default_show_articles_inside_services boolean not null default false,
  default_show_vat boolean not null default true,
  default_group_titles boolean not null default false,
  default_show_title_sums boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.offer_display_settings (id) values (1) on conflict (id) do nothing;

alter table public.offers add column if not exists use_global_display boolean not null default true;
alter table public.offers add column if not exists display jsonb;

alter table public.offer_display_settings enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='offer_display_settings' and policyname='app_all') then
    create policy app_all on public.offer_display_settings for all to authenticated using (true) with check (true);
  end if;
end $$;
