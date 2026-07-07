-- ============================================================
-- B4Y SuperAPP – Migration 0119
-- RBAC-Katalog-Seed für das Anfragen-Modul (`requests`).
-- ------------------------------------------------------------
-- Hintergrund:
--   Mit 0117/0118 entstehen die Tabellen `anfragen` und `anfrage_events`.
--   Die Route `/anfragen` wird über <Guard module="requests"> bzw.
--   can('requests','view') geschützt. Damit die Rechte-UI
--   (Einstellungen → Zugriffsrechte) das Modul kennt und Admin/User
--   gezielt freischalten können, muss `requests` im Katalog
--   `permission_modules` existieren.
--
--   Vorlage analog 0078_email_permission_module.sql (gleiche Spalten-
--   reihenfolge, gleicher idempotenter ON CONFLICT-Pfad).
--
-- Gruppen-Zuordnung:
--   group_key = 'stammdaten' (Anfragen sind Vorstufe von Kontakten, analog zu key=contacts).
--   `group_key` ist Freitext in permission_modules – die Gruppe wird
--   in der UI implizit über die Modul-Zuordnung gebildet.
--
-- Sort-Order:
--   Wir hängen das Modul ans Ende der bestehenden Sortierung an
--   (COALESCE(MAX(sort_order),0)+10) – stabil & kollisionsfrei,
--   unabhängig vom aktuellen DB-Zustand.
--
-- Mandantenneutral: nur Katalog-Stammdaten, keine BAU4YOU-Spezifika.
-- Idempotent: ON CONFLICT (key) DO NOTHING – auf bestehender DB ein No-op.
-- Es werden KEINE Rechte automatisch an Rollen vergeben; das bleibt
-- bewusste Admin-Entscheidung in der Rechte-UI.
-- ============================================================

insert into public.permission_modules
  (key, label, group_key, parent_key, supports_scope, actions, is_system, active, sort_order)
select
  'requests',
  'Anfragen',
  'stammdaten',
  null,
  true,
  ARRAY['view','create','edit','delete','convert','archive','export']::text[],
  true,
  true,
  coalesce((select max(sort_order) from public.permission_modules), 0) + 10
on conflict (key) do nothing;
