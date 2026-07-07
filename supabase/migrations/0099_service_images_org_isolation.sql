-- 0099_service_images_org_isolation.sql
-- Mandantentrennung fuer den Bucket 'service-images' (Codex-Finding PR #92):
-- Die in 0098 angelegten Policies erlaubten ALLEN authentifizierten Nutzern Zugriff auf
-- ALLE Objekte des Buckets. Jetzt: Zugriff nur auf Objekte im EIGENEN Org-Ordner
-- (Pfadschema: "<organization_id>/<datei>"). Das Frontend praefixiert Uploads mit current_org_id().
-- Idempotent. (article-images bleibt unveraendert – dessen Mandantentrennung ist ein separates Arbeitspaket.)
do $$
begin
  drop policy if exists "service_images_auth_read" on storage.objects;
  drop policy if exists "service_images_auth_write" on storage.objects;
  drop policy if exists "service_images_auth_update" on storage.objects;
  drop policy if exists "service_images_auth_delete" on storage.objects;

  create policy "service_images_org_read" on storage.objects for select to authenticated
    using (bucket_id = 'service-images' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "service_images_org_write" on storage.objects for insert to authenticated
    with check (bucket_id = 'service-images' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "service_images_org_update" on storage.objects for update to authenticated
    using (bucket_id = 'service-images' and (storage.foldername(name))[1] = (select current_org_id())::text)
    with check (bucket_id = 'service-images' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "service_images_org_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'service-images' and (storage.foldername(name))[1] = (select current_org_id())::text);
end $$;
