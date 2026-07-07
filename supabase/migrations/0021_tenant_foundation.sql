-- ============================================================
-- Mandantenfähigkeit Phase 0: Fundament (nicht brechend)
-- organizations + memberships + current_org_id()
-- ============================================================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, organization_id)
);
create index if not exists idx_memberships_user on public.memberships(user_id);

-- Default-Organisation (BAU4YOU) aus den Firmeneinstellungen ableiten
insert into public.organizations (name, slug)
select coalesce(nullif(btrim((select name from public.company_settings where id = 1)), ''),
                'BAU4YOU Baranowski Bau GmbH'),
       'bau4you'
where not exists (select 1 from public.organizations where slug = 'bau4you');

-- Alle bestehenden Benutzer der Default-Org zuordnen
insert into public.memberships (user_id, organization_id)
select u.id, (select id from public.organizations where slug = 'bau4you')
from auth.users u
on conflict (user_id, organization_id) do nothing;

-- Helfer: aktuelle Organisation des angemeldeten Benutzers
create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select organization_id from public.memberships where user_id = auth.uid() limit 1;
$$;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='organizations' and policyname='org_sel') then
    create policy "org_sel" on public.organizations for select to authenticated
      using (id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='memberships' and policyname='mem_sel') then
    create policy "mem_sel" on public.memberships for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;
