-- ============================================================
-- Laufzeit-Versionierung: unveränderliche Versions-Snapshots + Audit-Log
-- generisch (source_table/source_id), mandantenfähig
-- ============================================================
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  source_table text not null,           -- z.B. 'offer','invoice'
  source_id uuid not null,
  version_no int not null,
  status text,
  title text,
  doc_number text,
  data jsonb,                            -- { head, positions }
  summary jsonb,                         -- { net, vat, gross }
  print_html text,                       -- gespeicherter Druckstand (HTML)
  created_by uuid default auth.uid(),
  finalized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_table, source_id, version_no)
);
create index if not exists idx_docver_src on public.document_versions(source_table, source_id);

create table if not exists public.document_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  source_table text not null,
  source_id uuid not null,
  version_no int,
  action text not null,                  -- 'finalize','reopen','edit', …
  detail text,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_docaudit_src on public.document_audit_log(source_table, source_id);

alter table public.document_versions enable row level security;
alter table public.document_audit_log enable row level security;

-- RLS: lesen & einfügen je Org; KEIN update/delete ⇒ unveränderlich (immutable)
do $$ begin
  if not exists (select 1 from pg_policies where tablename='document_versions' and policyname='sel') then
    create policy "sel" on public.document_versions for select to authenticated
      using (organization_id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='document_versions' and policyname='ins') then
    create policy "ins" on public.document_versions for insert to authenticated
      with check (organization_id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='document_audit_log' and policyname='sel') then
    create policy "sel" on public.document_audit_log for select to authenticated
      using (organization_id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='document_audit_log' and policyname='ins') then
    create policy "ins" on public.document_audit_log for insert to authenticated
      with check (organization_id = public.current_org_id());
  end if;
end $$;
