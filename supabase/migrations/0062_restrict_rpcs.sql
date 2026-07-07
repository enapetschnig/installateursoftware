-- ============================================================
-- B4Y SuperAPP – Migration 0062
-- Sensible SECURITY-DEFINER-Funktionen für `anon` sperren (Fund F-06).
--
-- Problem: Nicht angemeldete Aufrufer konnten u. a. `next_document_number`
-- ausführen und Nummernkreise „verbrennen" (Lücken/DoS) sowie Info-Leaks
-- erzeugen (`b4y_admin_count`). RLS-Helper (`b4y_is_admin`,
-- `b4y_has_permission`, `current_org_id`) müssen für `anon` nicht aufrufbar
-- sein – sie werden in Policies serverseitig ausgewertet.
--
-- Lösung: EXECUTE für `anon` entziehen, für `authenticated` sicherstellen.
-- Per Namens-Lookup über pg_proc (deckt alle Overloads/Signaturen ab,
-- unabhängig von der konkreten Argumentliste). Idempotent.
-- ============================================================

do $$
declare
  fn record;
  names text[] := array[
    'next_document_number',
    'b4y_admin_count',
    'b4y_is_admin',
    'b4y_has_permission',
    'current_org_id',
    'handle_new_user'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname = any(names) or p.proname like 'b4y_%')
  loop
    -- PUBLIC-Grant entziehen (anon erbt EXECUTE sonst über PUBLIC) + anon explizit.
    execute format('revoke execute on function %s from public', fn.sig);
    execute format('revoke execute on function %s from anon', fn.sig);
    -- authenticated behält Zugriff (RLS-Helper + Nummernvergabe im Login-Kontext).
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end $$;

-- ============================================================
-- F-11 · Leaked-Password-Protection (HaveIBeenPwned)
-- ------------------------------------------------------------
-- HINWEIS (manuelle Aktion): Dieser Schutz lässt sich NICHT per SQL
-- aktivieren. Im Supabase-Dashboard einschalten:
--   Authentication → Settings → Password protection
--   → „Check against HaveIBeenPwned" aktivieren.
-- Verhindert die Verwendung bekannter geleakter Passwörter.
-- ============================================================
