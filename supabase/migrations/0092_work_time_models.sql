-- ============================================================
-- 0092 – Arbeitszeitmodell-Vorlagen (mandantenfähig)
-- ------------------------------------------------------------
-- Frei anlegbare Arbeitszeitmodelle als Stammdaten/Vorlagen. Mitarbeiter bekommen
-- über employees.work_time_model_id eine Vorlage zugewiesen. Der Firmen-Jahres-
-- kalender (company_work_calendar_settings + buak_calendar Wochenarten) bleibt als
-- Kalender/Standard-Fallback bestehen (Migr. 0028). Additiv, kein Datenverlust.
-- ============================================================

create table if not exists public.work_time_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  -- Logik/Art: buak_auto | short_long_manual | only_short | only_long | fixed_weekly | individual_week
  logic text not null default 'buak_auto',
  week_short jsonb not null default '{}'::jsonb,   -- Tagesstunden kurze Woche (Mo–So)
  week_long  jsonb not null default '{}'::jsonb,   -- Tagesstunden lange Woche (Mo–So)
  weekly_hours numeric,                            -- Wochenstunden (fixe Modelle)
  daily_hours  numeric,                            -- Tagesstunden (fixe Modelle)
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wtm_org on public.work_time_models(organization_id);

alter table public.work_time_models enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='work_time_models' and policyname='sel') then
    create policy "sel" on public.work_time_models for select to authenticated using (organization_id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='work_time_models' and policyname='mod') then
    create policy "mod" on public.work_time_models for all to authenticated
      using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
  end if;
end $$;

-- Mitarbeiter-Zuweisung (Vorlage). Löschen einer Vorlage setzt die Zuweisung auf NULL.
alter table public.employees
  add column if not exists work_time_model_id uuid references public.work_time_models(id) on delete set null;

-- ── Standard-Vorlagen je Organisation seeden (idempotent über Name) ──
insert into public.work_time_models
  (organization_id, name, description, logic, week_short, week_long, weekly_hours, daily_hours, sort_order)
select o.id, v.name, v.description, v.logic, v.week_short::jsonb, v.week_long::jsonb, v.weekly_hours, v.daily_hours, v.sort_order
from public.organizations o
cross join (values
  ('Bau BUAK 36/42',     'Baugewerbe: kurze Woche Mo–Do 9 h (36 h), lange Woche Mo–Fr 8,4 h (42 h) laut BUAK-Kalender.', 'buak_auto',
     '{"mon":9,"tue":9,"wed":9,"thu":9}', '{"mon":8.4,"tue":8.4,"wed":8.4,"thu":8.4,"fri":8.4}', null, null, 10),
  ('Maler BUAK 39/43',   'Maler/Anstreicher: kurze Woche 39 h, lange Woche 43 h laut BUAK-Kalender.', 'buak_auto',
     '{"mon":7.8,"tue":7.8,"wed":7.8,"thu":7.8,"fri":7.8}', '{"mon":8.6,"tue":8.6,"wed":8.6,"thu":8.6,"fri":8.6}', null, null, 20),
  ('Büro 38,5 h',        'Bürozeit: fixe Woche Mo–Fr 7,7 h (38,5 h).', 'fixed_weekly',
     '{"mon":7.7,"tue":7.7,"wed":7.7,"thu":7.7,"fri":7.7}', '{"mon":7.7,"tue":7.7,"wed":7.7,"thu":7.7,"fri":7.7}', 38.5, 7.7, 30),
  ('Teilzeit 20 h',      'Teilzeit: fixe Woche Mo–Fr 4 h (20 h).', 'fixed_weekly',
     '{"mon":4,"tue":4,"wed":4,"thu":4,"fri":4}', '{"mon":4,"tue":4,"wed":4,"thu":4,"fri":4}', 20, 4, 40),
  ('Reinigung Samstag',  'Reinigung: individuelles Wochenmodell inkl. Samstag (Beispiel: Sa 6 h).', 'individual_week',
     '{"sat":6}', '{"sat":6}', 6, null, 50),
  ('Lehrling',           'Lehrling Bau: kurze/lange Woche analog BUAK (Mo–Do 9 h / Mo–Fr 8,4 h).', 'buak_auto',
     '{"mon":9,"tue":9,"wed":9,"thu":9}', '{"mon":8.4,"tue":8.4,"wed":8.4,"thu":8.4,"fri":8.4}', null, null, 60),
  ('Individuell',        'Individuelles Modell – Tagesstunden je Mitarbeiter frei festlegen (Override).', 'individual_week',
     '{}', '{}', null, null, 70)
) as v(name, description, logic, week_short, week_long, weekly_hours, daily_hours, sort_order)
where not exists (
  select 1 from public.work_time_models w where w.organization_id = o.id and w.name = v.name
);

-- ── Bestehende Mitarbeiter auf passende Vorlage mappen (nur wo noch nicht gesetzt) ──
update public.employees e
set work_time_model_id = w.id
from public.work_time_models w
where w.organization_id = e.organization_id
  and e.work_time_model_id is null
  and (
       (e.worktime_model = 'buak'        and w.name = 'Bau BUAK 36/42')
    or (e.worktime_model = 'buero'       and w.name = 'Büro 38,5 h')
    or (e.worktime_model = 'individuell' and w.name = 'Individuell')
  );
