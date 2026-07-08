-- ============================================================
-- Installateur SuperAPP – Migration 0142
-- Storage-Bucket 'belege' für Eingangsrechnungen/Belege (Buchhaltung)
-- ------------------------------------------------------------
-- Privater, mandantengetrennter Bucket nach dem Muster von 0129
-- (document-pdfs): Pfad IMMER "<organization_id>/...", Zugriff nur über
-- signierte URLs mit User-JWT. Der IMAP-Poller lädt PDF-Anhänge von
-- Eingangsrechnungen serverseitig (Service-Role) hierher; die App zeigt
-- sie über src/lib/storage.ts (signedUrl) an.
--
-- MIME: PDF + gängige Bildformate (abfotografierte Belege). 25 MB Limit.
-- Idempotent (bestehender Bucket in der Live-DB wird nur nachgezogen).
-- ============================================================

insert into storage.buckets (id, name, public)
  values ('belege', 'belege', false)
  on conflict (id) do update set public = false;

update storage.buckets set
    file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
    ]
  where id = 'belege';

do $$
begin
  drop policy if exists "belege_org_read"   on storage.objects;
  drop policy if exists "belege_org_write"  on storage.objects;
  drop policy if exists "belege_org_update" on storage.objects;
  drop policy if exists "belege_org_delete" on storage.objects;

  create policy "belege_org_read" on storage.objects for select to authenticated
    using (bucket_id = 'belege' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "belege_org_write" on storage.objects for insert to authenticated
    with check (bucket_id = 'belege' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "belege_org_update" on storage.objects for update to authenticated
    using (bucket_id = 'belege' and (storage.foldername(name))[1] = (select current_org_id())::text)
    with check (bucket_id = 'belege' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "belege_org_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'belege' and (storage.foldername(name))[1] = (select current_org_id())::text);
end $$;
