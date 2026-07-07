-- Migration 0006: zentrale Einheiten (angewendet 2026-06-13)
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  name text not null, code text not null,
  sort_order int not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_units_code_lower on public.units (lower(code));
alter table public.units enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='units' and policyname='app_all') then
    create policy app_all on public.units for all to authenticated using (true) with check (true);
  end if;
end $$;
drop trigger if exists trg_touch_units on public.units;
create trigger trg_touch_units before update on public.units for each row execute function public.b4y_touch_updated_at();
insert into public.units (name, code, sort_order)
select v.name, v.code, v.so from (values
  ('Stück','Stk',1),('Meter','m',2),('Quadratmeter','m²',3),('Kubikmeter','m³',4),
  ('Laufmeter','lfm',5),('Kilogramm','kg',6),('Tonne','t',7),('Liter','l',8),
  ('Stunde','Std',9),('Tag','Tag',10),('Woche','Woche',11),('Monat','Monat',12),('Pauschale','Pauschale',13)
) as v(name, code, so)
where not exists (select 1 from public.units u where lower(u.code) = lower(v.code));
