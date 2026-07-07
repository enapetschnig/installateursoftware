-- ============================================================
-- 0121 – anfragen + anfrage_events in Supabase-Realtime aufnehmen
-- ------------------------------------------------------------
-- Damit das Frontend per supabase.channel("anfragen-insert").on(
-- "postgres_changes", { event: "INSERT", table: "anfragen" }) Push-
-- Notifications fuer neue Anfragen erhaelt, muss die Tabelle in der
-- Publication "supabase_realtime" stehen. Standardmaessig sind nur
-- explizit hinzugefuegte Tabellen drin.
--
-- RLS bleibt aktiv: Realtime liefert nur Events, die der jeweilige
-- User-Token via RLS sehen darf (organization_id = current_org_id()).
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'anfragen'
  ) then
    execute 'alter publication supabase_realtime add table public.anfragen';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'anfrage_events'
  ) then
    execute 'alter publication supabase_realtime add table public.anfrage_events';
  end if;
end$$;
