-- ============================================================
-- Installateursoftware – Migration 0139: Regie-RLS-Rekursion beheben
--
-- Die SELECT-Policy auf regie_reports (0134) prüfte die Beteiligung
-- über eine Unterabfrage auf regie_report_workers. Dessen eigene
-- RLS-Policy fragt aber wiederum regie_reports ab → gegenseitige
-- Auswertung = "infinite recursion detected in policy for relation
-- regie_reports" (Fehler 42P17) bei jedem SELECT unter RLS. Fällt
-- ohne echten Nutzer-Kontext nicht auf (Service-Rolle umgeht RLS).
--
-- Fix: Die Beteiligungsprüfung in eine SECURITY-DEFINER-Funktion
-- auslagern. Diese liest regie_report_workers/employees OHNE RLS,
-- wodurch der Rückverweis auf regie_reports entfällt und die
-- Rekursion durchbrochen wird. Idempotent.
-- ============================================================

create or replace function public.b4y_is_regie_participant(p_report_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from regie_report_workers w
      join employees e on e.id = w.employee_id
     where w.report_id = p_report_id
       and e.auth_user_id = auth.uid()
  );
$$;

revoke execute on function public.b4y_is_regie_participant(uuid) from anon;

drop policy if exists "sel" on public.regie_reports;
create policy "sel" on public.regie_reports for select to authenticated
  using (
    b4y_is_admin(auth.uid())
    or b4y_has_permission(auth.uid(), 'regiestunden', 'view')
    or created_by = auth.uid()
    or public.b4y_is_regie_participant(id)
  );
