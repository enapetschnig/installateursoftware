-- ============================================================
-- B4Y SuperAPP – Migration 0003: Härtung Kalkulations-Funktionen
-- Setzt search_path und entzieht RPC-Ausführungsrechte der
-- reinen Trigger-Funktionen (Security-Advisor-Hinweise).
-- Angewendet am: 2026-06-13 (Supabase: kalkulation_harden_functions)
-- ============================================================
create or replace function public.b4y_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;

revoke execute on function public.b4y_calc_audit() from public, anon, authenticated;
revoke execute on function public.b4y_touch_updated_at() from public, anon, authenticated;
