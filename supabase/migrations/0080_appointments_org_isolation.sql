-- ============================================================
-- B4Y SuperAPP – Migration 0080
-- Mandantentrennung (RLS) für die globale Termin-Tabelle `appointments`.
-- Befund (Projekt-Audit 2026-06-22): appointments hatte SELECT `using(true)`
-- und KEINE org_isolation → organisationsübergreifend lesbar. Die Tabelle hat
-- bereits eine Org-Spalte `org_id` (anders benannt als sonst organization_id)
-- und ist leer → risikoarm. Additiv, konsistent zu project_appointments.
-- ============================================================

-- 1) Neue Termine erhalten automatisch die Organisation des Erstellers.
alter table public.appointments
  alter column org_id set default public.current_org_id();

-- 2) Restriktive Mandanten-Policy (AND-verknüpft mit den bestehenden
--    created_by-Policies) – wie bei project_appointments.
drop policy if exists org_isolation on public.appointments;
create policy org_isolation on public.appointments
  as restrictive for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
