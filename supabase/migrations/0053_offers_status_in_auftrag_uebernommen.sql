-- 0053: Angebot-Nachtrag-Workflow – Status „In Auftrag übernommen" für offers zulassen.
-- Ein angenommener Nachtrag (offers.kind='nachtrag') wird nach Übernahme in einen
-- bestehenden Auftrag auf diesen Status gesetzt (Doppelübernahme-Schutz + Anzeige).
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_status_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_status_check
  CHECK (status = ANY (ARRAY['entwurf'::text, 'abgeschlossen'::text, 'versendet'::text, 'angenommen'::text, 'abgelehnt'::text, 'storniert'::text, 'in_auftrag_uebernommen'::text]));
