-- 0098_service_images_bucket.sql
-- Ziel 3: Privater Storage-Bucket fuer Leistungsfotos (analog 'article-images').
-- Privat (public=false) → Client liest nur ueber signierte URLs (src/lib/storage.ts).
-- 10 MB Limit, nur Bild-MIME-Types. Idempotent.
insert into storage.buckets (id, name, public)
  values ('service-images', 'service-images', false)
  on conflict (id) do update set public = false;

update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
  where id = 'service-images';

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_images_auth_read') then
    create policy "service_images_auth_read" on storage.objects for select to authenticated
      using (bucket_id = 'service-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_images_auth_write') then
    create policy "service_images_auth_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'service-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_images_auth_update') then
    create policy "service_images_auth_update" on storage.objects for update to authenticated
      using (bucket_id = 'service-images') with check (bucket_id = 'service-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_images_auth_delete') then
    create policy "service_images_auth_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'service-images');
  end if;
end $$;
