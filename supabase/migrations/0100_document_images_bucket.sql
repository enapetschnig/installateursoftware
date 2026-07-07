-- 0100_document_images_bucket.sql
-- Privater, MANDANTENGETRENNTER Bucket fuer dokumentlokale Positions-Fotos.
-- Wird genutzt, wenn im Dokumenteditor (PositionEditModal) ein Leistungs-/Artikelfoto
-- dokumentlokal hochgeladen/ersetzt wird (Snapshot je Dokumentposition, aendert NICHT
-- den Stamm). Pfadschema "<organization_id>/<datei>" – Org-Isolation wie service-images (0099).
-- Stamm-Buckets (service-images org-isoliert via 0099, article-images privat) bleiben unveraendert.
-- Privat (public=false) → Client liest nur ueber signierte URLs (src/lib/storage.ts);
-- fuers PDF wird das Bild clientseitig in eine base64-Data-URL gewandelt (dauerhafter Snapshot).
-- 10 MB Limit, nur Bild-MIME-Types. Idempotent.
insert into storage.buckets (id, name, public)
  values ('document-images', 'document-images', false)
  on conflict (id) do update set public = false;

update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
  where id = 'document-images';

do $$
begin
  drop policy if exists "document_images_org_read" on storage.objects;
  drop policy if exists "document_images_org_write" on storage.objects;
  drop policy if exists "document_images_org_update" on storage.objects;
  drop policy if exists "document_images_org_delete" on storage.objects;

  create policy "document_images_org_read" on storage.objects for select to authenticated
    using (bucket_id = 'document-images' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "document_images_org_write" on storage.objects for insert to authenticated
    with check (bucket_id = 'document-images' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "document_images_org_update" on storage.objects for update to authenticated
    using (bucket_id = 'document-images' and (storage.foldername(name))[1] = (select current_org_id())::text)
    with check (bucket_id = 'document-images' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "document_images_org_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'document-images' and (storage.foldername(name))[1] = (select current_org_id())::text);
end $$;
