-- ============================================================
-- B4Y SuperAPP – Migration 0064
-- Fund F-02: Öffentliche Storage-Buckets schließen.
--
-- `project-files` (Projektfotos/-videos/-dokumente, Mitarbeiterfotos) und
-- `article-images` waren ÖFFENTLICH → Dateibytes ohne Auth/Ablauf abrufbar,
-- SELECT-Policy erlaubte sogar Auflisten. Beide werden PRIVAT; der Client
-- liest künftig ausschließlich über signierte URLs (src/lib/storage.ts).
--
-- Logos müssen ÖFFENTLICH bleiben (Login-Seite vor Auth + PDF-Einbettung) →
-- eigener öffentlicher Bucket `branding`. CompanySettings lädt Logos dorthin.
--
-- Idempotent. HINWEIS: Bestehende Logo-Dateien liegen noch im (jetzt privaten)
-- `project-files`-Bucket unter branding/… – das Logo muss nach diesem Deploy
-- EINMAL in den Einstellungen neu hochgeladen werden (landet dann in
-- `branding`). Bis dahin greift in der App das gebündelte Fallback-Logo.
-- ============================================================

-- 1) Öffentlichen Branding-Bucket anlegen (Logos: Login + PDF, ohne Auth lesbar)
insert into storage.buckets (id, name, public)
  values ('branding', 'branding', true)
  on conflict (id) do update set public = true;

-- 2) Sensible Buckets auf PRIVAT stellen
update storage.buckets set public = false where id in ('project-files', 'article-images');

-- 2b) Bucket-Limits (F-09): Größenlimit + MIME-Allowlist (project-files bleibt MIME-offen,
--     da diverse Dateien: Fotos/Videos/PDF/Dokumente/.eml).
update storage.buckets set file_size_limit = 52428800 where id = 'project-files';
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'] where id = 'article-images';
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml'] where id = 'branding';

-- 3) Storage-RLS: Lese-/Schreibzugriff sauber je Bucket setzen (idempotent).
do $$
begin
  -- ---- branding: öffentlich lesbar, nur authentifizierte schreiben ----
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='branding_public_read') then
    create policy "branding_public_read" on storage.objects for select
      using (bucket_id = 'branding');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='branding_auth_write') then
    create policy "branding_auth_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'branding');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='branding_auth_update') then
    create policy "branding_auth_update" on storage.objects for update to authenticated
      using (bucket_id = 'branding') with check (bucket_id = 'branding');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='branding_auth_delete') then
    create policy "branding_auth_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'branding');
  end if;

  -- ---- private Buckets: nur authentifizierte dürfen lesen (= signieren) ----
  -- Vorhandene, evtl. anon-/public-permissive SELECT-Policies auf diesen
  -- Buckets entfernen und durch authenticated-only ersetzen (schließt Listing-/
  -- Direktzugriffs-Leak). Schreib-/Update-/Delete-Policies bleiben unberührt.
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='article_images_read') then
    drop policy "article_images_read" on storage.objects;
  end if;

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='project_files_auth_read') then
    create policy "project_files_auth_read" on storage.objects for select to authenticated
      using (bucket_id = 'project-files');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='article_images_auth_read') then
    create policy "article_images_auth_read" on storage.objects for select to authenticated
      using (bucket_id = 'article-images');
  end if;
end $$;
