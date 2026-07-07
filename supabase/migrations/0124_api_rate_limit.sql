-- ============================================================
-- 0124 – Persistentes API-Rate-Limit
-- ------------------------------------------------------------
-- Sliding-Window-Counter pro (user_id, action). Wird von den
-- MS-Graph-Mail-APIs verwendet (mail-list, mail-send, ...) um
-- Kosten-Missbrauch + Graph-Throttling vorzubeugen.
--
-- Der bestehende api/_lib/security.js -> checkRateLimit() ist rein
-- IN-MEMORY (per Serverless-Instanz). Diese Tabelle laesst sich
-- optional aktivieren, wenn wir zu einem persistenten Limit wollen
-- (z.B. weil User pro Sekunde mail-list flooden, Instanzen sich abwechseln).
--
-- Fenster: minutenweise gebuckelt (window_start ist Stunde/Minute).
-- Cleanup: taeglicher Cron oder Partition-by-day (Later).
-- ============================================================

create table public.api_rate_limit (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count int not null default 0 check (count >= 0),
  primary key (user_id, action, window_start)
);

alter table public.api_rate_limit enable row level security;

-- Nur der eigene User darf sehen (Metadaten sind harmlos, aber
-- brauchen wir nicht cross-User exposen).
create policy "arl_own_only"
  on public.api_rate_limit
  as restrictive for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- app_all fuer authenticated + service_role.
create policy "arl_app_all"
  on public.api_rate_limit
  for all to authenticated
  using (true) with check (true);

create index idx_arl_window
  on public.api_rate_limit(window_start);

comment on table public.api_rate_limit is
  'Persistentes Rate-Limit (Sliding-Window, minutenweise) fuer sensible APIs.';
