-- 0129_document_pdf_cache.sql
-- Persistenter PDF-Cache: gerenderte PDFs (PDFShift) werden je Dokument gespeichert,
-- damit unveraenderte Dokumente NICHT bei jedem Oeffnen teuer neu gerendert werden.
--
--  • Bucket "document-pdfs" (privat, mandantengetrennt, Pfad "<organization_id>/...",
--    Org-Policies wie document-images/0100). Client laedt PDFs nur ueber die
--    Storage-API mit User-JWT – kein oeffentlicher Zugriff, keine Secrets im Frontend.
--  • Tabelle document_pdf_cache: EIN Eintrag je (source_table, source_id, version_no).
--    version_no = 0  → Entwurf/Live-Stand (wird bei jedem Neu-Rendern ueberschrieben).
--    version_no > 0  → finalisierte Version (print_html-Snapshot; einmal erzeugt, stabil).
--  • Gueltigkeit ueber html_hash (SHA-256 des kompletten gerenderten HTML): Inhalt,
--    Empfaenger, Firma/Logo-URL, Texte UND das eingebettete PDF-CSS/Layout stecken im
--    HTML → jede Aenderung ergibt einen neuen Hash → Cache wird nie veraltet verwendet.
--  • BEWUSST eigene Tabelle statt Spalten an document_versions: document_versions ist
--    revisionssicher unveraenderlich (keine UPDATE-Policy, Migration 0025) und bleibt es.
--    Der Cache ist reproduzierbar (aus print_html/Live-Stand jederzeit neu erzeugbar)
--    und darf daher normal beschrieben/ueberschrieben werden.
-- Idempotent.

-- ── Bucket (privat, nur PDFs, 25 MB Limit) ─────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('document-pdfs', 'document-pdfs', false)
  on conflict (id) do update set public = false;

update storage.buckets set file_size_limit = 26214400,
  allowed_mime_types = array['application/pdf']
  where id = 'document-pdfs';

do $$
begin
  drop policy if exists "document_pdfs_org_read" on storage.objects;
  drop policy if exists "document_pdfs_org_write" on storage.objects;
  drop policy if exists "document_pdfs_org_update" on storage.objects;
  drop policy if exists "document_pdfs_org_delete" on storage.objects;

  create policy "document_pdfs_org_read" on storage.objects for select to authenticated
    using (bucket_id = 'document-pdfs' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "document_pdfs_org_write" on storage.objects for insert to authenticated
    with check (bucket_id = 'document-pdfs' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "document_pdfs_org_update" on storage.objects for update to authenticated
    using (bucket_id = 'document-pdfs' and (storage.foldername(name))[1] = (select current_org_id())::text)
    with check (bucket_id = 'document-pdfs' and (storage.foldername(name))[1] = (select current_org_id())::text);
  create policy "document_pdfs_org_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'document-pdfs' and (storage.foldername(name))[1] = (select current_org_id())::text);
end $$;

-- ── Cache-Tabelle ───────────────────────────────────────────────────────────
create table if not exists public.document_pdf_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  source_table text not null,            -- wie document_versions.source_table: 'offer','order','invoice',…
  source_id uuid not null,
  version_no int not null default 0,     -- 0 = Entwurf/Live, >0 = finalisierte Version
  html_hash text not null,               -- SHA-256 des gerenderten HTML (Inhalt + Layout)
  storage_path text not null,            -- Pfad im Bucket document-pdfs
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id, version_no)
);
create index if not exists idx_docpdfcache_src on public.document_pdf_cache(source_table, source_id);

alter table public.document_pdf_cache enable row level security;

do $$
begin
  drop policy if exists "sel" on public.document_pdf_cache;
  drop policy if exists "ins" on public.document_pdf_cache;
  drop policy if exists "upd" on public.document_pdf_cache;
  drop policy if exists "del" on public.document_pdf_cache;

  create policy "sel" on public.document_pdf_cache for select to authenticated
    using (organization_id = public.current_org_id());
  create policy "ins" on public.document_pdf_cache for insert to authenticated
    with check (organization_id = public.current_org_id());
  create policy "upd" on public.document_pdf_cache for update to authenticated
    using (organization_id = public.current_org_id())
    with check (organization_id = public.current_org_id());
  create policy "del" on public.document_pdf_cache for delete to authenticated
    using (organization_id = public.current_org_id());
end $$;
