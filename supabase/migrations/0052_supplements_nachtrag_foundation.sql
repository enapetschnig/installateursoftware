-- 0052: Angebot-Nachtrag (Architektur A – Wiederverwendung der offers-Kette).
-- Nachtrag = spezielles "Angebot" in offers (kind='nachtrag') mit Pflicht-Bezug zu
-- einem bestehenden Auftrag. Angenommene Nachtrag-Positionen werden DIESEM Auftrag
-- hinzugefügt (order_items.is_supplement) – KEIN eigener Nachtragsauftrag, keine neue
-- Auftragsnummer. Mandantenneutral, keine BAU4YOU-Hardcodierung.

-- 1) offers: Dokumentart + Auftragsbezug
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'angebot';
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS related_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.offers.kind IS 'angebot | nachtrag – Dokumentart innerhalb der offers-Tabelle';

-- 2) order_items: Nachtragspositionen kennzeichnen + Herkunft (Doppelübernahme-Schutz)
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_supplement boolean NOT NULL DEFAULT false;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS source_supplement_offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS source_supplement_item_id uuid;

-- 3) Nummernkreis für Nachträge
INSERT INTO public.number_ranges (doc_type, label, prefix, use_year, separator, min_digits, next_number, active, protected)
  VALUES ('nachtrag', 'Nachtrag', 'NACHTRAG', true, '-', 4, 1, true, false)
  ON CONFLICT (doc_type) DO NOTHING;
