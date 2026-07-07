-- Zusätzliche Darstellungsoptionen je Angebotstyp + globaler Fallback
alter table public.offer_types
  add column if not exists default_show_quantities boolean not null default true,
  add column if not exists default_show_long_texts boolean not null default true,
  add column if not exists default_show_discount   boolean not null default true;

alter table public.offer_display_settings
  add column if not exists default_show_quantities boolean not null default true,
  add column if not exists default_show_long_texts boolean not null default true,
  add column if not exists default_show_discount   boolean not null default true;
