-- 0051: invoices_doc_status_check an das aktuelle Statusmodell anpassen.
-- Die alte Constraint erlaubte nur in_bearbeitung/erstellt/versendet/angenommen/
-- abgelehnt/storniert und passte NICHT zum App-Modell (entwurf/finalisiert/storniert,
-- Labels zusätzlich versendet/bezahlt). Folge: jede Rechnungserstellung mit
-- doc_status='entwurf' schlug fehl (invoices_doc_status_check). Fix:
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_doc_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_doc_status_check
  CHECK (doc_status = ANY (ARRAY['entwurf'::text, 'finalisiert'::text, 'versendet'::text, 'bezahlt'::text, 'storniert'::text]));
