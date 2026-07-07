-- ============================================================
-- 0114 – Microsoft Graph OAuth-Token-Storage (mandantenfähig)
-- ------------------------------------------------------------
-- Persistente Ablage der OAuth-2.0-Tokens (Access + Refresh) für die
-- Microsoft-Graph-Anbindung (E-Mail-Versand / Read via Mail.Send + Mail.Read).
--
-- Sicherheitskonzept:
--   * Tokens werden APP-SEITIG via libsodium (XChaCha20-Poly1305) verschlüsselt.
--   * Der KEK (Key Encryption Key) liegt als Vercel-Env `MS_TOKEN_KEK_V1`.
--   * `kek_version` erlaubt späteren KEK-Rotations-Lauf ohne Schema-Bruch.
--   * Multi-Tenant Azure-App: tenant_id pro Token (kein App-weiter Fixwert).
--
-- Mandantenfähigkeit:
--   * organization_id NOT NULL DEFAULT public.current_org_id()
--   * RESTRICTIVE Policy gemäß Post-0063-Standard (KEINE NULL-Klausel,
--     siehe Migrations 0085 / 0099).
--   * Zusätzlich: user_id = auth.uid() erzwingt Token-Privatheit innerhalb
--     der Org (kein Cross-User-Read selbst bei gleicher Organisation).
--
-- Idempotenz: ALLE Statements re-runable (IF NOT EXISTS / DROP+CREATE / DO-Blocks).
-- ============================================================

-- ============================================================
-- 1) Tabelle: microsoft_oauth_tokens
-- ============================================================
create table if not exists public.microsoft_oauth_tokens (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,

  -- Microsoft-Identitäten (UPN + tid). Multi-Tenant-App, daher tenant_id pro Token.
  microsoft_user_id  text not null,
  microsoft_tenant_id text not null,

  -- Verschlüsselte Tokens (libsodium secretbox / XChaCha20-Poly1305, Base64-codiert,
  -- inkl. Nonce-Prefix gemäß app-seitiger Convention).
  encrypted_access_token  text not null,
  encrypted_refresh_token text,

  -- KEK-Version: aktive Version 1 (Env `MS_TOKEN_KEK_V1`). Erlaubt zukünftige
  -- Key-Rotation ohne Schema-Migration.
  kek_version smallint not null default 1,

  -- Ablaufzeiten:
  --   expires_at         – Access-Token-Lebensdauer (~1 h, hart erzwungen).
  --   refresh_expires_at – Refresh-Token-Lebensdauer (laut Azure-Tenant,
  --                        meist 90 Tage inaktiv, sliding window).
  expires_at         timestamptz not null,
  refresh_expires_at timestamptz,

  -- Effektive Scopes des aktuellen Tokens
  -- (Soll: offline_access Mail.Read Mail.Send User.Read openid profile email).
  scopes text[] not null default '{}'::text[],

  -- Refresh-Bookkeeping
  last_refreshed_at timestamptz,

  -- Fehler-Tracking für Refresh-Failure-Backoff/Reauth-Erkennung
  error_count        int  not null default 0,
  last_error_message text,

  -- Soft-Disable (z.B. nach 5 Refresh-Failures in Folge oder revoke-Lauf)
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Genau ein aktiver Token pro (Org, User). Re-Connect updated den Row.
  constraint microsoft_oauth_tokens_org_user_uk unique (organization_id, user_id)
);

-- ============================================================
-- 2) Spalten-Kommentare (Doku der Zwecke / DSGVO-Footprint)
-- ============================================================
comment on table public.microsoft_oauth_tokens is
  'OAuth-2.0-Tokens für die Microsoft-Graph-Anbindung (Mail.Send/Mail.Read). Tokens sind app-seitig verschlüsselt (libsodium, KEK aus Vercel-Env MS_TOKEN_KEK_Vn). Eine Zeile pro (Org, User).';

comment on column public.microsoft_oauth_tokens.organization_id is
  'Mandanten-ID (mandantenfähige Isolation via RESTRICTIVE Policy + current_org_id()).';
comment on column public.microsoft_oauth_tokens.user_id is
  'Supabase-auth.users.id des verbundenen Benutzers. Token ist STRIKT user-privat (siehe RLS).';
comment on column public.microsoft_oauth_tokens.microsoft_user_id is
  'Microsoft UPN (UserPrincipalName, z.B. user@tenant.onmicrosoft.com). Quelle: Graph /me oder ID-Token claim "preferred_username".';
comment on column public.microsoft_oauth_tokens.microsoft_tenant_id is
  'Azure Tenant-ID (claim "tid" aus dem ID-Token). Multi-Tenant-App, daher pro Token gespeichert.';
comment on column public.microsoft_oauth_tokens.encrypted_access_token is
  'Verschlüsselter Access-Token (libsodium secretbox, Base64, Nonce-Prefix). Niemals als Klartext loggen.';
comment on column public.microsoft_oauth_tokens.encrypted_refresh_token is
  'Verschlüsselter Refresh-Token (libsodium secretbox, Base64, Nonce-Prefix). Optional – Azure liefert ihn nur bei offline_access-Scope.';
comment on column public.microsoft_oauth_tokens.kek_version is
  'Version des verwendeten Key-Encryption-Keys (Env MS_TOKEN_KEK_Vn). Erlaubt KEK-Rotation ohne Schema-Bruch.';
comment on column public.microsoft_oauth_tokens.expires_at is
  'Access-Token-Ablaufzeitpunkt (UTC). Wird vor jedem Graph-Call gegen now()+skew geprüft.';
comment on column public.microsoft_oauth_tokens.refresh_expires_at is
  'Optionaler Refresh-Token-Ablaufzeitpunkt (laut Azure-Tenant-Policy, oft 90 Tage sliding).';
comment on column public.microsoft_oauth_tokens.scopes is
  'Effektiv vom Graph zurückgegebene Scopes (Soll: offline_access Mail.Read Mail.Send User.Read openid profile email).';
comment on column public.microsoft_oauth_tokens.last_refreshed_at is
  'Zeitpunkt des letzten erfolgreichen Refresh-Token-Austauschs.';
comment on column public.microsoft_oauth_tokens.error_count is
  'Zähler konsekutiver Refresh-Failures. Wird bei Erfolg auf 0 zurückgesetzt.';
comment on column public.microsoft_oauth_tokens.last_error_message is
  'Letzte Fehlermeldung des Graph/Token-Endpoints (gekürzt). Klartext, keine Tokens enthalten.';
comment on column public.microsoft_oauth_tokens.is_active is
  'Soft-Disable. False = Token nicht mehr verwenden (z.B. nach >5 Refresh-Failures oder explizitem Disconnect). Re-Connect setzt true.';

-- ============================================================
-- 3) Updated-At Trigger (analog 0085, mit explizitem search_path)
-- ============================================================
create or replace function public.tg_microsoft_oauth_tokens_touch()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_microsoft_oauth_tokens_touch on public.microsoft_oauth_tokens;
create trigger trg_microsoft_oauth_tokens_touch
  before update on public.microsoft_oauth_tokens
  for each row execute function public.tg_microsoft_oauth_tokens_touch();

-- ============================================================
-- 4) Indices
-- ============================================================
-- Lookup-Pfad: Token zu (Org, User) auflösen (zusätzlich zum UNIQUE-Constraint
-- explizit als BTREE-Index für klare Optimizer-Hints; UNIQUE-Constraints liefern
-- den Index zwar auch, der Name hier dient als Dokumentations-Anker).
create index if not exists idx_microsoft_oauth_tokens_org_user
  on public.microsoft_oauth_tokens (organization_id, user_id);

-- Scan-Pfad für Refresh-Cron / Expiry-Checks: nur aktive Tokens, sortiert nach
-- Ablaufzeitpunkt. Partial-Index hält die Größe klein.
create index if not exists idx_microsoft_oauth_tokens_expires_at_active
  on public.microsoft_oauth_tokens (expires_at)
  where is_active;

-- ============================================================
-- 5) Row-Level-Security (Post-0063-Standard)
-- ------------------------------------------------------------
-- Permissive Policy: app_all (using true, with check true) – wird vom
-- RESTRICTIVE-Layer eingegrenzt.
-- Restrictive Policy: organization_id = current_org_id() AND user_id = auth.uid()
-- (Token-Privatheit innerhalb der Org).
-- ============================================================
alter table public.microsoft_oauth_tokens enable row level security;

drop policy if exists microsoft_oauth_tokens_app_all on public.microsoft_oauth_tokens;
create policy microsoft_oauth_tokens_app_all
  on public.microsoft_oauth_tokens
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists microsoft_oauth_tokens_org_user_isolation on public.microsoft_oauth_tokens;
create policy microsoft_oauth_tokens_org_user_isolation
  on public.microsoft_oauth_tokens
  as restrictive
  for all to authenticated
  using  (
    organization_id = public.current_org_id()
    and user_id = auth.uid()
  )
  with check (
    organization_id = public.current_org_id()
    and user_id = auth.uid()
  );
