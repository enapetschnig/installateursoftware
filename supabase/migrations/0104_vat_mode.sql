-- ============================================================
-- 0104 – MwSt-Modus je Dokument (Standard 20 % / §19 Reverse Charge 0 %)
-- ------------------------------------------------------------
-- Macht den bisher nur impliziten §19-Status (über vat=0 erschlossen) zu einem
-- EXPLIZITEN, wählbaren Modus je Dokument – in allen Dokumenttypen und durch die
-- Dokumentkette vererbbar (Angebot → Auftrag → Rechnung, Nachtrag, SUB).
--   'standard' = regulär 20 % USt
--   'par19'    = §19 Bauleistung, Reverse Charge (0 % ausgewiesen, Hinweis im PDF)
--
-- Additiv & datenbewahrend: neue Spalte mit Default 'standard'. Bestehende §19-Belege
-- (vat=0 bei positivem Netto) werden per Backfill korrekt als 'par19' markiert, damit
-- ihr Status erhalten bleibt. Mandantenneutral.
-- ============================================================

alter table public.offers     add column if not exists vat_mode text not null default 'standard';
alter table public.orders     add column if not exists vat_mode text not null default 'standard';
alter table public.invoices   add column if not exists vat_mode text not null default 'standard';
alter table public.sub_orders add column if not exists vat_mode text not null default 'standard';

-- Backfill: bestehende §19-Belege (0 % USt bei positivem Netto) als 'par19' kennzeichnen.
update public.offers     set vat_mode = 'par19' where coalesce(vat,0) = 0 and coalesce(net,0) > 0 and vat_mode = 'standard';
update public.orders     set vat_mode = 'par19' where coalesce(vat,0) = 0 and coalesce(net,0) > 0 and vat_mode = 'standard';
update public.invoices   set vat_mode = 'par19' where coalesce(vat,0) = 0 and coalesce(net,0) > 0 and vat_mode = 'standard';
update public.sub_orders set vat_mode = 'par19' where coalesce(vat,0) = 0 and coalesce(net,0) > 0 and vat_mode = 'standard';

comment on column public.offers.vat_mode is 'MwSt-Modus: standard (20 %) | par19 (§19 Bauleistung, Reverse Charge 0 %). Wird in Folgedokumente vererbt.';
comment on column public.orders.vat_mode is 'MwSt-Modus: standard | par19. Siehe offers.vat_mode.';
comment on column public.invoices.vat_mode is 'MwSt-Modus: standard | par19. Siehe offers.vat_mode.';
comment on column public.sub_orders.vat_mode is 'MwSt-Modus: standard | par19. Siehe offers.vat_mode.';
