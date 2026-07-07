-- ============================================================
-- 0101 – Dokument-Signatur (getrennt von der E-Mail-Signatur)
-- ------------------------------------------------------------
-- Eigene Signaturfunktion für Dokumente/PDFs:
--  • company_settings.document_signature_html  → globale Standardsignatur (je Mandant)
--  • employees.document_signature_html/_active → optionale Signatur je Mitarbeiter
-- Die PDF-Engine wählt: aktive Mitarbeiter-Signatur des Erstellers > globale Standard-
-- signatur > (Fallback) automatische Firmen-Signatur (Geschäftsführer). Bewusst NICHT
-- die E-Mail-Signatur (employees.signature_html) wiederverwenden.
-- Additiv & datenbewahrend (nur neue, nullbare Spalten). Mandantenneutral: gilt für alle
-- Organisationen, keine BAU4YOU-Hardcodierung (Inhalte pflegt jeder Mandant selbst).
-- ============================================================

alter table public.company_settings
  add column if not exists document_signature_html text;

alter table public.employees
  add column if not exists document_signature_html text;

alter table public.employees
  add column if not exists document_signature_active boolean not null default false;

comment on column public.company_settings.document_signature_html is
  'Globale Standard-Signatur für Dokumente/PDFs (Rich-Text/HTML). Getrennt von E-Mail-Signaturen.';
comment on column public.employees.document_signature_html is
  'Optionale Dokument-Signatur dieses Mitarbeiters (Rich-Text/HTML). Getrennt von der E-Mail-Signatur (signature_html).';
comment on column public.employees.document_signature_active is
  'Wenn true und document_signature_html gesetzt: wird im von diesem Mitarbeiter erstellten Dokument bevorzugt verwendet.';
