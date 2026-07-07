-- ============================================================
-- B4Y SuperAPP – Migration 0116
-- API Rate Limiting (Sliding-Window-Counter, Service-Role only)
-- ------------------------------------------------------------
-- Backend-seitiges Rate-Limiting für API-Endpoints (z. B. Microsoft-Graph
-- Mail-Send/-List, später ggf. weitere). Implementiert ein Sliding-Window-
-- Pattern auf Basis eines diskretisierten Fenster-Anfangs (`window_start`),
-- mit `INSERT … ON CONFLICT DO UPDATE SET count = count + 1` als atomarem
-- Increment.
--
-- ENTWURFS-ENTSCHEIDUNGEN
--   • Kein `organization_id` – Rate-Limit ist *pro User*, weil Token-/Quota-
--     Limits bei Microsoft Graph pro Mailbox/User gelten (nicht pro Org).
--     Mit Org-Switch ändert sich der User-Kontext nicht.
--   • Granularität (`minute` vs. `hour`) wird *vom Caller* bestimmt, indem
--     er `window_start` entsprechend rundet (z. B. `date_trunc('minute',
--     now())` für Per-Minute, `date_trunc('hour', now())` für Per-Stunde).
--     Dadurch kann jede Action ihr eigenes Limit/Fenster führen, ohne
--     Schema-Änderung.
--   • `action` ist ein freier Text-Slug (z. B. "ms-mail-send",
--     "ms-mail-list"). Konventionsempfehlung: `<provider>-<resource>-<verb>`.
--   • Service-Role-only: Keine `app_all` Policy, keine Self-Service-Policy.
--     RLS aktiv ohne Policies → kein authenticated/anon-Zugriff. Der Vercel-
--     Backend-Layer (api/_lib/security.js → checkRateLimit) nutzt den
--     SERVICE-ROLE-Client, der RLS umgeht.
--
-- ATOMARES INCREMENT (vom Backend zu verwenden):
--   INSERT INTO public.api_rate_limit (user_id, action, window_start, count)
--   VALUES ($1, $2, date_trunc('minute', now()), 1)
--   ON CONFLICT (user_id, action, window_start)
--     DO UPDATE SET count = public.api_rate_limit.count + 1
--   RETURNING count;
-- ============================================================

create table if not exists public.api_rate_limit (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  action       text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (user_id, action, window_start)
);

-- Cleanup-Index: ermöglicht effizienten Range-Scan auf alte Fenster
-- (siehe cleanup_api_rate_limit_old()). Partial-Index unnötig, weil die
-- Tabelle ohnehin nur kurzlebige Zeilen enthält.
create index if not exists idx_api_rate_limit_window_start
  on public.api_rate_limit (window_start);

comment on table public.api_rate_limit is
  'Sliding-Window-Counter für API-Rate-Limiting (pro User+Action+Fenster). Service-Role-only: RLS aktiv, keine Policies → nur Service-Role-Client (Vercel-Backend) darf zugreifen.';
comment on column public.api_rate_limit.user_id is
  'Auth-User, dessen Requests gezählt werden (FK auth.users, cascade delete).';
comment on column public.api_rate_limit.action is
  'Freier Action-Slug (Konvention: <provider>-<resource>-<verb>, z. B. "ms-mail-send", "ms-mail-list"). Jede Action kann eigene Fenster-Granularität führen.';
comment on column public.api_rate_limit.window_start is
  'Diskreter Fenster-Anfang. Granularität wird vom Caller per date_trunc() bestimmt (minute/hour/day). Dadurch ist die Limit-Granularität pro Action frei wählbar, ohne Schema-Änderung.';
comment on column public.api_rate_limit.count is
  'Anzahl der Requests im Fenster. Atomar incrementiert via INSERT … ON CONFLICT DO UPDATE SET count = count + 1.';

-- ============================================================
-- RLS: aktiv, aber KEINE Policies → kein Zugriff für authenticated/anon.
-- Service-Role-Client (BYPASSRLS) im Vercel-Backend ist der einzige Pfad.
-- ============================================================
alter table public.api_rate_limit enable row level security;

-- Defensive: Vorherige Policy-Reste löschen (idempotente Re-Runs).
-- Falls in früheren Hand-Patches Policies existieren, jetzt entfernen.
drop policy if exists api_rate_limit_app_all       on public.api_rate_limit;
drop policy if exists api_rate_limit_org_isolation on public.api_rate_limit;
drop policy if exists api_rate_limit_self          on public.api_rate_limit;

-- Berechtigungen einziehen (Service-Role behält Zugriff via BYPASSRLS):
revoke all on public.api_rate_limit from public;
revoke all on public.api_rate_limit from anon;
revoke all on public.api_rate_limit from authenticated;

-- ============================================================
-- Cleanup-Funktion: alte Fenster löschen (> 24 h alt).
-- ------------------------------------------------------------
-- Aufruf per Cron (pg_cron oder Vercel-Cron). 24 h ist großzügig genug, um
-- auch Day-Granularity-Limits abzudecken; für Per-Minute/Per-Hour-Limits ist
-- jede Zeile nach Ablauf ihres Fensters ohnehin obsolet.
-- ============================================================
create or replace function public.cleanup_api_rate_limit_old()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
begin
  delete from public.api_rate_limit
   where window_start < now() - interval '24 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function public.cleanup_api_rate_limit_old() is
  'Löscht abgelaufene Rate-Limit-Fenster (älter als 24 h). Per Cron (pg_cron oder Vercel-Cron) aufrufen. SECURITY DEFINER, damit Service-Role-Cron-Aufrufe genau wie direkter Tabellenzugriff funktionieren.';

-- Execute-Rechte: nur Service-Role darf cleanen. Authenticated/anon nicht.
revoke all on function public.cleanup_api_rate_limit_old() from public;
revoke all on function public.cleanup_api_rate_limit_old() from anon;
revoke all on function public.cleanup_api_rate_limit_old() from authenticated;
