-- Migration 0007: Positionsnummer + eindeutige Leistungsnummer (angewendet 2026-06-13)
alter table public.services add column if not exists positions_nummer text;
create unique index if not exists uq_services_number on public.services (service_number) where service_number is not null;
