-- ============================================================
-- 0122 – Microsoft OAuth Tokens (per User + Org)
-- ------------------------------------------------------------
-- Speichert die fuer Microsoft Graph benoetigten OAuth-Tokens:
-- pro User + Org ein Datensatz, Tokens VERSCHLUESSELT (libsodium
-- XChaCha20-Poly1305 mit KEK aus MS_TOKEN_KEK_V<version>, siehe
-- api/_lib/encryption.js).
--
-- Sicherheit:
--   * RLS strikt: jeder User sieht ausschliesslich SEINE eigenen
--     Tokens (current_org_id + auth.uid()). Selbst Org-Admins
--     kommen via RLS nicht an fremde Tokens.
--   * Schreibender Zugriff aus dem Callback erfolgt mit Service-
--     Role-Client (RLS bypass) — die User-ID kommt aus dem signierten
--     state-Cookie und wird explizit in der Spalte gespeichert.
--   * RESTRICTIVE-Policy nach b4y-Konvention (Migr. 0063 ff.) plus
--     permissive app_all fuer Bearbeiter mit User-Token.
--
-- Loeschpfade (DSGVO):
--   * User wird in auth.users geloescht → CASCADE delete des Tokens
--   * Org wird geloescht → CASCADE delete
--   * Manueller Unlink: is_active=false + Tokens loeschen (siehe
--     /api/auth/microsoft-unlink)
-- ============================================================

create table public.microsoft_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Microsoft-User-Identifier (UPN, z.B. user@firma.onmicrosoft.com)
  -- + Heimat-Tenant. Aus dem id_token im Callback extrahiert.
  microsoft_user_id text not null,
  microsoft_tenant_id text not null,

  -- Verschluesselte Tokens. Format siehe encryption.js (v1).
  -- Klartext landet NIE in der DB. Spalten-Namen matchen den bestehenden
  -- Helper api/_lib/microsoft-graph.js (access_token_enc / refresh_token_enc).
  access_token_enc text not null,
  refresh_token_enc text,
  kek_version smallint not null default 1
    check (kek_version > 0 and kek_version < 100),

  -- Ablaufzeiten (aus token-endpoint expires_in / refresh expiry).
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,

  -- Welche Scopes der User tatsaechlich consented hat (kann sich
  -- vom Request unterscheiden, wenn der User Berechtigungen abwaehlt).
  scopes text[] not null default '{}'::text[],

  last_refreshed_at timestamptz,

  -- Operative Felder: Fehler-Counter (z.B. invalid_grant beim Refresh
  -- → User muss neu verbinden) + Aktivitaets-Flag fuer soft-disable.
  error_count int not null default 0 check (error_count >= 0),
  last_error_message text,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Pro User + Org gibt es genau EIN aktives Token-Tripel.
  unique (organization_id, user_id)
);

alter table public.microsoft_oauth_tokens enable row level security;

-- Permissive: legt fest, wer ueberhaupt operieren kann (alle eingeloggten).
create policy "msot_app_all"
  on public.microsoft_oauth_tokens
  for all to authenticated
  using (true) with check (true);

-- Restrictive: schraenkt auf den jeweiligen User in seiner Org ein.
-- (RESTRICTIVE wird mit AND verknuepft → garantiert strikte Isolation.)
create policy "msot_org_user_isolation"
  on public.microsoft_oauth_tokens
  as restrictive for all to authenticated
  using (
    organization_id = public.current_org_id()
    and user_id = auth.uid()
  )
  with check (
    organization_id = public.current_org_id()
    and user_id = auth.uid()
  );

-- updated_at automatisch synchron halten.
create or replace function public.touch_microsoft_oauth_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end$$;

create trigger trg_microsoft_oauth_tokens_touch
  before update on public.microsoft_oauth_tokens
  for each row execute function public.touch_microsoft_oauth_tokens_updated_at();

-- Indizes fuer typische Zugriffsmuster:
--   * (org, user) ist schon UNIQUE-Index
--   * expires_at fuer Refresh-Jobs (nur aktive Tokens scannen)
create index idx_msot_expires_active
  on public.microsoft_oauth_tokens(expires_at)
  where is_active;

comment on table public.microsoft_oauth_tokens is
  'Microsoft Graph OAuth-Tokens pro User+Org. Tokens libsodium-verschluesselt.';
comment on column public.microsoft_oauth_tokens.kek_version is
  'Version des verwendeten Key-Encryption-Keys; erlaubt rotierende Re-Encryption.';
comment on column public.microsoft_oauth_tokens.scopes is
  'Tatsaechlich gewaehrte Scopes laut Token-Response (kann von Request abweichen).';
