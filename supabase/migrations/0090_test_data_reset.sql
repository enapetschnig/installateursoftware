-- ============================================================
-- 0090 – TEST-DATEN-RESET (DESTRUKTIV, EINMALIG)
-- ------------------------------------------------------------
-- ⚠️ Löscht ALLE bisher erstellten Belege/Dokumente, damit von vorne getestet
-- werden kann. Von Lukasz BEWUSST im Supabase SQL-Editor auszuführen.
-- Läuft in einer Transaktion – bei FK-Fehler wird alles sicher zurückgerollt
-- (dann bitte Fehlermeldung melden, Skript wird ergänzt).
--
-- BLEIBT ERHALTEN: Kontakte (Kunden/Lieferanten/Subunternehmer/Ansprechpartner),
-- Projekte, Leistungen, Artikel, Preislisten, Dokumentarten, Einstellungen.
-- Auswertungen/Dashboard sind danach automatisch leer (rein abgeleitet).
--
-- HINWEIS: Vor diesem Skript bitte 0089 ausführen (Nummernkreis-Finalisierung).
-- ============================================================
begin;

-- 1) Abhängige Positions-/Link-/Versions-Daten zuerst (Kinder vor Eltern).
delete from public.order_items;
delete from public.invoice_items;
delete from public.sub_order_items;
delete from public.invoice_offers;
delete from public.document_versions;
delete from public.document_audit_log;

-- 2) Projekt-Logbuch: nur Dokument-/Belegbezüge entfernen (übrige Projekthistorie bleibt).
delete from public.project_log
where kind = 'dokument' or offer_id is not null;

-- 3) Belege/Dokumente (Eltern). Reihenfolge wahrt die Beleg-Kette.
delete from public.invoices;
delete from public.sub_orders;
delete from public.orders;
delete from public.offers;
delete from public.documents;

-- 4) Dokument-Nummernkreise auf Start 1 zurücksetzen.
--    Kontakt-/Stammdaten-Kreise (kunde/lieferant/subunternehmer/ansprechpartner/
--    sonstige/projekt) bleiben unverändert, da deren Datensätze bestehen bleiben
--    (next_number entspricht dort bereits höchste vorhandene Nr. + 1).
update public.number_ranges
set next_number = 1, updated_at = now()
where lower(doc_type) not in
      ('kunde', 'lieferant', 'subunternehmer', 'ansprechpartner', 'sonstige', 'projekt')
  and next_number <> 1;

commit;
