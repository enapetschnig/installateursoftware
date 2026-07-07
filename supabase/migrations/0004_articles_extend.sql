-- ============================================================
-- Migration 0004: Artikelstamm erweitern + Bild-Bucket
-- Alle Preise netto; MwSt separat (vat_rate). Angewendet 2026-06-13.
-- ============================================================
alter table public.articles
  add column if not exists trade_id uuid references public.trades(id) on delete set null,
  add column if not exists supplier_email text,
  add column if not exists list_price numeric not null default 0,
  add column if not exists vat_rate numeric not null default 20,
  add column if not exists image_url text;

create index if not exists idx_articles_trade on public.articles(trade_id);

insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='article_images_read') then
    create policy "article_images_read" on storage.objects for select using (bucket_id = 'article-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='article_images_insert') then
    create policy "article_images_insert" on storage.objects for insert to authenticated with check (bucket_id = 'article-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='article_images_update') then
    create policy "article_images_update" on storage.objects for update to authenticated using (bucket_id = 'article-images') with check (bucket_id = 'article-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='article_images_delete') then
    create policy "article_images_delete" on storage.objects for delete to authenticated using (bucket_id = 'article-images');
  end if;
end $$;
