-- ============================================================
-- 0102 – Dokumentbezogene Empfängeranschrift (Override)
-- ------------------------------------------------------------
-- Pro Dokument kann die Empfänger-Anschrift abweichend vom Kundenstamm gesetzt
-- werden, OHNE den Kontakt (contacts) zu ändern. Speicherung als JSONB-Snapshot
-- am Dokument (offers/orders/invoices/sub_orders), damit PDF + Versions-Snapshot
-- exakt diese Anschrift verwenden und sie revisionssicher eingefroren bleibt.
--
-- Struktur (alle Felder optional):
--   { "enabled": bool, "name": text, "line1": text, "line2": text,
--     "street": text, "address_extra": text, "zip": text, "city": text, "country": text }
-- enabled=false ODER NULL → es gilt der Kundenstamm (contactRecipientLines).
--
-- Additiv & datenbewahrend (nur neue, nullbare Spalte). Mandantenneutral.
-- ============================================================

alter table public.offers      add column if not exists recipient_override jsonb;
alter table public.orders      add column if not exists recipient_override jsonb;
alter table public.invoices    add column if not exists recipient_override jsonb;
alter table public.sub_orders  add column if not exists recipient_override jsonb;

comment on column public.offers.recipient_override is
  'Dokumentbezogene Empfängeranschrift (JSONB, überschreibt den Kundenstamm nur für dieses Dokument). enabled=false/NULL → Kundenstamm.';
comment on column public.orders.recipient_override is
  'Dokumentbezogene Empfängeranschrift (JSONB). Siehe offers.recipient_override.';
comment on column public.invoices.recipient_override is
  'Dokumentbezogene Empfängeranschrift (JSONB). Siehe offers.recipient_override.';
comment on column public.sub_orders.recipient_override is
  'Dokumentbezogene Empfängeranschrift (JSONB). Siehe offers.recipient_override.';
