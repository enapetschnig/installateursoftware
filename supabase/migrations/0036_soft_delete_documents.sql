-- Soft-Delete für Dokumente im Entwurf. Zentral & mandantenfähig (Org-RLS greift bereits).
-- Gelöschte Zeilen bleiben erhalten (deleted_at gesetzt), werden in normalen Listen ausgeblendet.
alter table public.offers   add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;
alter table public.orders   add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;
alter table public.invoices add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;
alter table public.documents add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;

create index if not exists idx_offers_not_deleted   on public.offers (deleted_at)   where deleted_at is null;
create index if not exists idx_orders_not_deleted   on public.orders (deleted_at)   where deleted_at is null;
create index if not exists idx_invoices_not_deleted on public.invoices (deleted_at) where deleted_at is null;
create index if not exists idx_documents_not_deleted on public.documents (deleted_at) where deleted_at is null;
