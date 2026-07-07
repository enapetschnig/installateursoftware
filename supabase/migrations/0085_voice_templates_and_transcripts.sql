-- ============================================================
-- B4Y SuperAPP – Sprach-Eingabe: Vorlagen + Transkript-Audit
-- ------------------------------------------------------------
-- Zwei neue Tabellen für die Sprach-Pipeline (Migration der bau4you-Angebots-
-- Funktionalität nach b4y-superapp):
--
-- 1) voice_input_templates  – Wiederverwendbare Sprach-Vorlagen pro User
--                             (analog bau4you `input_templates`).
-- 2) voice_transcripts      – Audit-Trail aller Sprach-Aufnahmen mit Bezug
--                             zum erzeugten Dokument.
-- 3) Storage-Bucket voice-recordings (DSGVO-konform: Persistenz optional).
--
-- Mandantenfähigkeit: organization_id NOT NULL DEFAULT current_org_id() +
-- RESTRICTIVE Policy gemäß Post-0063-Standard (KEINE NULL-Klausel).
-- Storage-Pfad-Konvention {organization_id}/{user_id}/{voice_transcript_id}.{ext}
-- wird POLICY-SEITIG erzwungen (Storage RLS via storage.foldername()).
-- ============================================================

-- ============================================================
-- 1) voice_input_templates – Sprach-Vorlagen pro Organisation
-- ============================================================
create table if not exists public.voice_input_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,

  name            text not null,
  kind            text not null default 'klein' check (kind in ('klein', 'gross', 'einzel')),

  -- Roh-Text der Sprachnachricht (Whisper-Output nach Bau-Vokabular-Korrektur).
  -- Wird beim Laden direkt in SpeechInput-Komponente injiziert.
  input_text      text not null,

  -- Zusätzliche Metadaten (Tags, Default-Empfänger, Default-Aufschläge, etc.)
  template_data   jsonb not null default '{}'::jsonb,

  active          boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_voice_input_templates_org
  on public.voice_input_templates (organization_id);

create index if not exists idx_voice_input_templates_kind
  on public.voice_input_templates (organization_id, kind, active);

comment on table public.voice_input_templates is
  'Wiederverwendbare Sprach-Vorlagen für die Angebots-Pipeline. Modi: klein (Single-Shot), gross (Multi-Gewerk), einzel (Add-Position). Replikation bau4you input_templates.';
comment on column public.voice_input_templates.input_text is
  'Roh-Text der zuletzt verwendeten Sprachnachricht (nach Bau-Vokabular-Korrektur). Wird beim Laden in SpeechInput injiziert.';
comment on column public.voice_input_templates.template_data is
  'Optionale Zusatzmetadaten (Default-Empfänger, Default-Notizen, Tags). Frei strukturierbar.';
comment on column public.voice_input_templates.kind is
  'Modus: klein=Single-Shot, gross=Multi-Gewerk, einzel=Add-Position.';

-- Updated-At Trigger (mit explizitem search_path, Best-Practice)
create or replace function public.tg_voice_input_templates_touch()
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

drop trigger if exists trg_voice_input_templates_touch on public.voice_input_templates;
create trigger trg_voice_input_templates_touch
  before update on public.voice_input_templates
  for each row execute function public.tg_voice_input_templates_touch();

-- RLS: org_isolation (Post-0063-Standard: KEINE `or organization_id is null` Klausel)
alter table public.voice_input_templates enable row level security;

drop policy if exists voice_input_templates_app_all on public.voice_input_templates;
create policy voice_input_templates_app_all
  on public.voice_input_templates
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists voice_input_templates_org_isolation on public.voice_input_templates;
create policy voice_input_templates_org_isolation
  on public.voice_input_templates
  as restrictive
  for all to authenticated
  using  (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());


-- ============================================================
-- 2) voice_transcripts – Audit-Trail Sprach → Angebot
-- ============================================================
create table if not exists public.voice_transcripts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,

  -- Optionaler Bezug zum erzeugten Dokument (wird nachgetragen sobald persistiert).
  offer_id        uuid references public.offers(id) on delete set null,
  document_id     uuid references public.documents(id) on delete set null,

  -- Audio-Storage (DSGVO-Default = nicht speichern). Pfad-Konvention:
  -- {organization_id}/{user_id}/{voice_transcript_id}.{ext} im Bucket 'voice-recordings'.
  -- Convention wird policy-seitig erzwungen (siehe Storage-RLS unten).
  audio_path       text,
  audio_size_bytes bigint,
  audio_mime       text,
  duration_ms      integer,

  -- Beide Transkript-Varianten speichern: Roh (für Re-Run der Korrektur-Logik)
  -- + korrigiert (für Pipeline-Input).
  transcript_raw       text,
  transcript_corrected text,

  -- KI-Provider (Vendor-Transparenz)
  transcribe_model text default 'gpt-4o-transcribe',

  -- Erfolgs-Marker für Statistik (wurde ein Dokument erzeugt?)
  produced_offer  boolean not null default false,

  -- Error-Tracking (falls Transcription fehlschlug)
  error_message   text,

  created_at      timestamptz not null default now(),

  -- Audio-MIME-Whitelist analog Bucket-Allowlist (verhindert MIME-Spoofing)
  constraint voice_transcripts_audio_mime_chk
    check (audio_mime is null or audio_mime in (
      'audio/webm','audio/ogg','audio/mp4','audio/mpeg',
      'audio/wav','audio/x-wav','audio/m4a','audio/x-m4a'
    ))
);

create index if not exists idx_voice_transcripts_org_created
  on public.voice_transcripts (organization_id, created_at desc);

create index if not exists idx_voice_transcripts_offer
  on public.voice_transcripts (offer_id) where offer_id is not null;

create index if not exists idx_voice_transcripts_document
  on public.voice_transcripts (document_id) where document_id is not null;

comment on table public.voice_transcripts is
  'Audit-Trail aller Sprach-Aufnahmen für die Angebots-Pipeline. Roh-Transkript + korrigiert + Bezug zum erzeugten Dokument. Audio-Datei optional (DSGVO).';
comment on column public.voice_transcripts.audio_path is
  'Optionaler Storage-Pfad im Bucket voice-recordings (Konvention {org_id}/{user_id}/{file}). NULL = Audio nicht persistiert (Default DSGVO).';
comment on column public.voice_transcripts.transcript_raw is
  'Rohes Transkript direkt von OpenAI (gpt-4o-transcribe). Vor Bau-Vokabular-Korrektur.';
comment on column public.voice_transcripts.transcript_corrected is
  'Korrigiertes Transkript nach korrigiereTranskription() (Bau-Vokabular, Sprache→Nummer-Konvertierung).';
comment on column public.voice_transcripts.produced_offer is
  'True wenn der Transkript erfolgreich in mindestens eine Position übersetzt wurde.';

-- RLS: org_isolation (Post-0063-Standard)
alter table public.voice_transcripts enable row level security;

drop policy if exists voice_transcripts_app_all on public.voice_transcripts;
create policy voice_transcripts_app_all
  on public.voice_transcripts
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists voice_transcripts_org_isolation on public.voice_transcripts;
create policy voice_transcripts_org_isolation
  on public.voice_transcripts
  as restrictive
  for all to authenticated
  using  (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());


-- ============================================================
-- 3) Storage Bucket: voice-recordings
-- ------------------------------------------------------------
-- Privat (nicht public), max 25 MB (gpt-4o-transcribe Limit), Audio-MIME-Allowlist.
-- Pfad-Konvention: {organization_id}/{user_id}/{voice_transcript_id}.{ext}
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-recordings', 'voice-recordings', false,
  26214400, -- 25 MB
  array[
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg',
    'audio/wav', 'audio/x-wav', 'audio/m4a', 'audio/x-m4a'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage-RLS: Pfad-Konvention {org_id}/{user_id}/... wird ERZWUNGEN.
-- (storage.foldername() splittet name am '/', Index 1-basiert.)

drop policy if exists voice_recordings_auth_select on storage.objects;
create policy voice_recordings_auth_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-recordings'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

drop policy if exists voice_recordings_auth_insert on storage.objects;
create policy voice_recordings_auth_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-recordings'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists voice_recordings_auth_update on storage.objects;
create policy voice_recordings_auth_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'voice-recordings'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and owner = auth.uid()
  )
  with check (
    -- Verhindert auch Cross-User-Rename innerhalb derselben Org:
    -- WITH-CHECK pinnt sowohl Org-Prefix [1] als auch User-Prefix [2].
    bucket_id = 'voice-recordings'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists voice_recordings_auth_delete on storage.objects;
create policy voice_recordings_auth_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-recordings'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and owner = auth.uid()
  );
