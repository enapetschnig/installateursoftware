-- 0123_document_signature_mode.sql
-- ------------------------------------------------------------------------------
-- Firmen-Modus für die Dokument-Signatur: entscheidet, ob die Firmensignatur für ALLE
-- Mitarbeiter erzwungen wird oder ob Mitarbeiter eigene Dokument-Signaturen verwenden dürfen.
--   'allow_employee' (Default) → bisheriges Verhalten: Quelle je Dokument frei wählbar;
--                                bei Quelle „Ersteller" gilt die Mitarbeiter-Signatur nur,
--                                wenn sie beim Mitarbeiter aktiv (document_signature_active)
--                                und befüllt ist, sonst Firmen-Standardsignatur.
--   'force_company'            → die Firmen-Standardsignatur wird immer verwendet
--                                (Quelle „Ersteller" wird wie „Firma" behandelt).
-- Additiv, idempotent, datenbewahrend. Das bestehende Feld employees.document_signature_active
-- wird durch diese Logik REAKTIVIERT (war zuvor Legacy/ignoriert).

alter table public.company_settings
  add column if not exists document_signature_mode text not null default 'allow_employee';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_settings_document_signature_mode_check'
  ) then
    alter table public.company_settings
      add constraint company_settings_document_signature_mode_check
      check (document_signature_mode in ('force_company', 'allow_employee'));
  end if;
end $$;

comment on column public.company_settings.document_signature_mode is
  'Dokument-Signatur-Modus: force_company = Firmensignatur für alle erzwingen; allow_employee = Mitarbeiter-Dokumentsignaturen zulassen (nur wenn beim Mitarbeiter aktiv+befüllt, sonst Firmen-Standard).';

notify pgrst, 'reload schema';
