-- ============================================================
-- B4Y SuperAPP – Migration 0061
-- RBAC für `employees` und `documents` (Security-Funde F-04 / F-05).
--
-- Bisher: Policy `app_all` (USING(true) WITH CHECK(true)) → JEDER
-- authentifizierte Mandantennutzer konnte ALLE Mitarbeiterdaten
-- (Lohn/Personaldaten) bzw. generische Dokumente lesen/ändern/löschen,
-- unabhängig von Rolle/Recht. Nur die restriktive `org_isolation`
-- (+ `hide_soft_deleted` bei documents) lag zusätzlich an.
--
-- Neu: rechtegeprüfte Policies exakt nach orders-/sub_orders-Muster
-- (b4y_is_admin ODER b4y_has_permission(<modul>,<aktion>)). Die
-- restriktiven org_isolation/hide_soft_deleted-Policies bleiben unberührt
-- und greifen weiterhin AND-verknüpft. Admin behält vollen Zugriff.
--
-- Idempotent – mehrfach ausführbar.
-- ============================================================

-- ── employees (Personal-/Lohndaten – sensibel) ──────────────
alter table public.employees enable row level security;
drop policy if exists app_all on public.employees;
drop policy if exists sel on public.employees;
drop policy if exists ins on public.employees;
drop policy if exists upd on public.employees;
drop policy if exists del on public.employees;

create policy sel on public.employees for select
  using (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'employees','view'));
create policy ins on public.employees for insert
  with check (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'employees','create'));
create policy upd on public.employees for update
  using (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'employees','edit'))
  with check (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'employees','edit'));
create policy del on public.employees for delete
  using (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'employees','delete'));

-- ── documents (zentrale/generische Dokumente) ───────────────
-- hide_soft_deleted (restrictive SELECT, deleted_at is null) aus 0037
-- bleibt bestehen und schützt soft-gelöschte Zeilen weiterhin.
alter table public.documents enable row level security;
drop policy if exists app_all on public.documents;
drop policy if exists sel on public.documents;
drop policy if exists ins on public.documents;
drop policy if exists upd on public.documents;
drop policy if exists del on public.documents;

create policy sel on public.documents for select
  using (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'documents','view'));
create policy ins on public.documents for insert
  with check (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'documents','create'));
create policy upd on public.documents for update
  using (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'documents','edit'))
  with check (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'documents','edit'));
create policy del on public.documents for delete
  using (b4y_is_admin(auth.uid()) or b4y_has_permission(auth.uid(),'documents','delete'));
