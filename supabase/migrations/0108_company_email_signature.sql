-- ============================================================
-- B4Y SuperAPP – Migration 0108
-- Allgemeine Firmen-E-Mail-Signatur (additiv)
-- ------------------------------------------------------------
-- Eigene, vom Dokument-Signatur-Feld (document_signature_html) getrennte
-- Standard-E-Mail-Signatur je Mandant. Wird verwendet, wenn ein Mitarbeiter
-- keine aktive eigene E-Mail-Signatur hat (Fallback-Logik in src/lib/email-signature.ts).
-- Rückwärtskompatibel: nullable, kein Default-Zwang, RLS von company_settings greift unverändert.
-- ============================================================
alter table public.company_settings
  add column if not exists email_signature_html text;

comment on column public.company_settings.email_signature_html is
  'Globale Standard-E-Mail-Signatur (HTML). Getrennt von document_signature_html (Dokument-/PDF-Signatur).';
