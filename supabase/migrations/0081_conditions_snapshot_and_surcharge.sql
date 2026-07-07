-- ============================================================
-- B4Y SuperAPP – Standardaufschlag (Kunde) + Konditionen-Snapshot je Dokument
-- ------------------------------------------------------------
-- Rein additiv, nicht-destruktiv. Bestehende Dokumente bleiben unverändert
-- (neue Spalten sind nullable bzw. haben Default). Mandantenfähigkeit:
-- organization_id + RLS der betroffenen Tabellen bleiben unverändert.
--
-- 1) contacts.default_surcharge_percent (AUSGANG / Kunde):
--    Kundenspezifischer, im PDF UNSICHTBARER Standardaufschlag. Gegenstück zu
--    default_discount_percent (Standardnachlass, sichtbar). Default 0 = kein
--    Aufschlag. Nur Ausgangsrichtung (wir → Kunde); für Eingang (Sub/Lieferant)
--    gibt es bewusst keinen Aufschlag.
--
-- 2) conditions_snapshot (jsonb) auf offers/orders/invoices/sub_orders:
--    Festgeschriebene Dokument-Konditionen zum Zeitpunkt der Anlage. Damit sind
--    Belege unabhängig von späteren Stammdatenänderungen und Folgedokumente
--    übernehmen die Werte vom VORGÄNGER (nicht erneut live vom Kunden).
--    Shape (alle Felder optional):
--      {
--        "termDays": int, "skontoPercent": num, "skontoDays": int,
--        "paymentMethod": text, "paymentNote": text,
--        "discountPercent": num,        -- Standardnachlass (sichtbar im PDF)
--        "surchargePercent": num,       -- Standardaufschlag (intern/unsichtbar)
--        "surchargeApplied": bool       -- Guard: Aufschlag bereits in EP eingerechnet?
--      }
-- ============================================================

-- 1) Kunden-Standardaufschlag (Ausgang) ----------------------------------------
alter table public.contacts
  add column if not exists default_surcharge_percent numeric not null default 0;

comment on column public.contacts.default_surcharge_percent is
  'Ausgangs-Standardaufschlag in % (kundenspezifisch, im PDF UNSICHTBAR). Wird bei neuen Dokumenten einmalig in die Einzelpreise eingerechnet. Gegenstück zu default_discount_percent (sichtbarer Nachlass). Default 0.';

-- 2) Konditionen-Snapshot je Dokument ------------------------------------------
alter table public.offers      add column if not exists conditions_snapshot jsonb;
alter table public.orders      add column if not exists conditions_snapshot jsonb;
alter table public.invoices    add column if not exists conditions_snapshot jsonb;
alter table public.sub_orders  add column if not exists conditions_snapshot jsonb;

comment on column public.offers.conditions_snapshot is
  'Festgeschriebene Zahlungs-/Nachlass-/Aufschlag-Konditionen des Belegs (siehe Migration 0081). Unabhängig von späteren Stammdatenänderungen.';
comment on column public.orders.conditions_snapshot is
  'Festgeschriebene Zahlungs-/Nachlass-/Aufschlag-Konditionen des Belegs (siehe Migration 0081). Folgedokumente übernehmen vom Vorgänger.';
comment on column public.invoices.conditions_snapshot is
  'Festgeschriebene Zahlungs-/Nachlass-/Aufschlag-Konditionen des Belegs (siehe Migration 0081). Folgedokumente übernehmen vom Vorgänger.';
comment on column public.sub_orders.conditions_snapshot is
  'Festgeschriebene Eingangs-Konditionen/Nachlass des SUB-Belegs (siehe Migration 0081).';

-- 3) Arbeitsstand-Basis: aus welcher finalen Version wurde der aktuelle Entwurf
--    wiederhergestellt? (Anzeige „Arbeitsstand aus Vx", persistent über Reload.)
--    NULL = normaler Entwurf / keine Wiederherstellung. Beim erneuten Finalisieren
--    wird der Wert wieder auf NULL gesetzt (die neue Version ersetzt den Arbeitsstand).
alter table public.offers    add column if not exists working_base_version_no integer;
alter table public.orders    add column if not exists working_base_version_no integer;
alter table public.invoices  add column if not exists working_base_version_no integer;

comment on column public.offers.working_base_version_no   is 'Wiederhergestellt aus finaler Version Nr. (Arbeitsstand-Anzeige). NULL = normaler Entwurf.';
comment on column public.orders.working_base_version_no   is 'Wiederhergestellt aus finaler Version Nr. (Arbeitsstand-Anzeige). NULL = normaler Entwurf.';
comment on column public.invoices.working_base_version_no is 'Wiederhergestellt aus finaler Version Nr. (Arbeitsstand-Anzeige). NULL = normaler Entwurf.';
