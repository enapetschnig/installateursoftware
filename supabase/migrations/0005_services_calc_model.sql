-- Migration 0005: Leistungen – erweitertes Kalkulationsmodell (angewendet 2026-06-13)
alter table public.services
  add column if not exists internal_name text,
  add column if not exists category text,
  add column if not exists vat_rate numeric not null default 20,
  add column if not exists internal_note text,
  add column if not exists sort_order int not null default 0,
  add column if not exists aufschlag_percent numeric not null default 0,
  add column if not exists vk_net_manual numeric,
  add column if not exists material_mode text not null default 'artikel'
    check (material_mode in ('kein','artikel','pauschale_fix','pauschale_prozent','artikel_pauschale')),
  add column if not exists pauschale_active boolean not null default false,
  add column if not exists pauschale_type text not null default 'kein'
    check (pauschale_type in ('kein','fix','prozent_lohn','prozent_material','prozent_ek')),
  add column if not exists pauschale_fix numeric not null default 0,
  add column if not exists pauschale_percent numeric not null default 0;
