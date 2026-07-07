-- ============================================================
-- Installateursoftware – Migration 0138: Zeiterfassung-Korrekturen
--
-- Behebt drei im Review bestätigte Fehler aus 0133/0134:
--  1. time_entries.employee_id verweist weiterhin auf auth.users, weil
--     der Repoint in 0133 nur bei fehlendem Constraint-NAMEN griff –
--     der Name existierte aber bereits aus dem Baseline-Schema. Jetzt
--     wird der FK unbedingt auf employees(id) umgehängt (Bestandsdaten
--     werden zuvor von auth.uid()- auf employees.id-Semantik gemappt).
--  2. za_book erlaubte Selbstbedienern (eigenes Konto, ohne
--     time_tracking/edit) über 'za_abzug' mit positiven Stunden das
--     eigene Zeitkonto zu ERHÖHEN. Vorzeichen/Effekt werden jetzt
--     erzwungen; 'za_storno' muss eine echte frühere Abbuchung
--     referenzieren.
--  3. regie_sync_time_entries konnte time_entries_time_order_check
--     verletzen (start_time = end_time bei Kurzeinsätzen). Ungültige
--     Zeitpaare werden auf NULL gesetzt (Stunden bleiben erhalten).
-- Idempotent.
-- ============================================================

-- ---------- 1) FK time_entries.employee_id -> employees(id) ----------
-- Bestandsdaten remappen (auth.uid()-Semantik -> employees.id), bevor der
-- FK gewechselt wird. In der frisch aufgebauten DB ist die Tabelle leer,
-- der Schritt ist aber für Bestandsinstallationen wichtig und idempotent.
update public.time_entries te
   set employee_id = e.id
  from public.employees e
 where te.employee_id = e.auth_user_id
   and te.employee_id is not null
   and not exists (select 1 from public.employees e2 where e2.id = te.employee_id);

-- Verwaiste Verweise (kein passender Mitarbeiter) neutralisieren, damit der
-- neue FK nicht scheitert.
update public.time_entries te
   set employee_id = null
 where te.employee_id is not null
   and not exists (select 1 from public.employees e where e.id = te.employee_id);

alter table public.time_entries drop constraint if exists time_entries_employee_id_fkey;
alter table public.time_entries
  add constraint time_entries_employee_id_fkey
  foreign key (employee_id) references public.employees(id) on delete set null;

-- ---------- 2) za_book härten (Selbstbedienung) ----------
create or replace function public.za_book(
  p_employee_id uuid,
  p_hours numeric,
  p_change_type text,
  p_reason text default null,
  p_reference_id uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
  v_own boolean;
  v_privileged boolean;
begin
  v_own := exists (select 1 from employees e where e.id = p_employee_id and e.auth_user_id = auth.uid());
  v_privileged := b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(), 'time_tracking', 'edit');

  if not (v_privileged or v_own) then
    raise exception 'Keine Berechtigung für Zeitkonto-Buchungen';
  end if;

  -- Selbstbedienung (eigenes Konto ohne Modulrecht): nur Zeitausgleich, und der
  -- Effekt wird erzwungen – kein Aufblähen des eigenen Guthabens möglich.
  if v_own and not v_privileged then
    if p_change_type = 'za_abzug' then
      if p_hours >= 0 then
        raise exception 'Zeitausgleich-Abbuchung muss negativ sein';
      end if;
    elsif p_change_type = 'za_storno' then
      -- Storno gibt nur bereits abgebuchte Zeit zurück und muss auf eine echte
      -- frühere Abbuchung desselben Mitarbeiters verweisen.
      if p_hours <= 0 then
        raise exception 'Zeitausgleich-Storno muss positiv sein';
      end if;
      if p_reference_id is null or not exists (
        select 1 from time_account_transactions t
         where t.employee_id = p_employee_id and t.change_type = 'za_abzug'
           and t.reference_id = p_reference_id
      ) then
        raise exception 'Storno ohne gültige frühere Abbuchung nicht erlaubt';
      end if;
    else
      raise exception 'Nur Zeitausgleich-Buchungen am eigenen Konto erlaubt';
    end if;
  end if;

  insert into time_accounts (employee_id, organization_id)
  values (p_employee_id, (select organization_id from employees where id = p_employee_id))
  on conflict (employee_id) do nothing;

  select balance_hours into v_before from time_accounts where employee_id = p_employee_id for update;
  v_after := coalesce(v_before, 0) + p_hours;
  if p_change_type = 'za_abzug' and v_after < 0 then
    raise exception 'Zeitkonto-Guthaben reicht nicht aus (Stand: % h)', coalesce(v_before, 0);
  end if;

  update time_accounts set balance_hours = v_after, updated_at = now() where employee_id = p_employee_id;
  insert into time_account_transactions
    (employee_id, changed_by, change_type, hours, balance_before, balance_after, reason, reference_id, organization_id)
  values
    (p_employee_id, auth.uid(), p_change_type, p_hours, coalesce(v_before, 0), v_after, p_reason, p_reference_id,
     (select organization_id from employees where id = p_employee_id));
  return v_after;
end;
$$;

revoke execute on function public.za_book(uuid, numeric, text, text, uuid) from anon;

-- ---------- 3) regie_sync_time_entries: gültige Zeitpaare erzwingen ----------
create or replace function public.regie_sync_time_entries(p_report_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report regie_reports%rowtype;
  v_count integer := 0;
  v_worker record;
  v_start time;
  v_end time;
begin
  select * into v_report from regie_reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'Regiebericht nicht gefunden';
  end if;
  if not (b4y_is_admin(auth.uid())
          or b4y_has_permission(auth.uid(), 'regiestunden', 'edit')
          or v_report.created_by = auth.uid()) then
    raise exception 'Keine Berechtigung';
  end if;

  -- Nur gültige Zeitpaare übernehmen (sonst verletzt time_entries_time_order_check).
  if v_report.start_time is not null and v_report.end_time is not null
     and v_report.end_time > v_report.start_time then
    v_start := v_report.start_time;
    v_end := v_report.end_time;
  else
    v_start := null;
    v_end := null;
  end if;

  delete from time_entries where source_regie_report_id = p_report_id;

  for v_worker in
    select w.employee_id, coalesce(w.hours, v_report.stunden) as hours
      from regie_report_workers w where w.report_id = p_report_id
  loop
    insert into time_entries
      (project_id, employee_id, work_date, hours, description,
       start_time, end_time, pause_minutes, location_type, entry_kind,
       source_regie_report_id, organization_id)
    values
      (v_report.project_id, v_worker.employee_id, v_report.datum, v_worker.hours,
       'Regiearbeit: ' || coalesce(nullif(v_report.report_number, ''), left(v_report.beschreibung, 80)),
       v_start, v_end, case when v_start is null then 0 else v_report.pause_minutes end, 'baustelle', 'arbeit',
       p_report_id, v_report.organization_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.regie_sync_time_entries(uuid) from anon;
