-- 0073_contact_persons_active.sql
-- B4Y SuperAPP – Ansprechpersonen: Aktiv/Inaktiv-Status.
-- ------------------------------------------------------------------------------
-- contact_persons (Ansprechpartner zu Kunden/Lieferanten/Subunternehmern) bekommt
-- ein additives `active`-Feld, damit einzelne Ansprechpersonen aktiv/inaktiv
-- gesetzt werden können (analog zu contacts.status). Bestehende Datensätze gelten
-- als aktiv. Datenbewahrend, idempotent. RLS/Mandantentrennung unverändert –
-- contact_persons ist bereits org-isoliert (organization_id = current_org_id()).
-- ------------------------------------------------------------------------------

alter table public.contact_persons
  add column if not exists active boolean not null default true;
