-- ============================================================
-- 0091 – Folgedokument-Bezeichnungen entkoppeln (Override-Labels leeren)
-- ------------------------------------------------------------
-- Die Bezeichnungen der Folgedokumente (Auftrag/Rechnung/Nachtrag/Auftrag SUB)
-- werden ab jetzt AUTOMATISCH zentral aus Dokumentart + Variante gebildet
-- (variantLabel in src/lib/offer-kinds.ts). Die früher manuell pflegbaren
-- Override-Spalten in document_type_transitions werden daher geleert, damit
-- keine veralteten manuellen Bezeichnungen mehr greifen.
--
-- NICHT betroffen: die Vor-/Nachtext-Spalten (*_intro_text/*_closing_text) – sie
-- bleiben als Legacy-Fallback erhalten. Bestehende Dokumente/PDF-Snapshots werden
-- NICHT verändert (sie tragen ihren eigenen pdf_label-Snapshot).
-- Mandantenweit (RLS scoped automatisch je Organisation), kein Datenverlust an Texten.
-- ============================================================
update public.document_type_transitions
set order_label     = null,
    invoice_label   = null,
    nachtrag_label  = null,
    sub_order_label = null,
    updated_at      = now()
where order_label is not null
   or invoice_label is not null
   or nachtrag_label is not null
   or sub_order_label is not null;
