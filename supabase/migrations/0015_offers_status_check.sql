-- ============================================================
-- B4Y SuperAPP – Migration 0015
-- Angebots-Status-Constraint an erweiterte Status anpassen
-- (abgeschlossen, storniert ergänzt). Idempotent.
-- ============================================================
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status = any (array['entwurf','abgeschlossen','versendet','angenommen','abgelehnt','storniert']::text[]));
