-- ============================================================
-- B4Y SuperAPP – Migration 0078
-- RBAC-Katalog-Seed für das E-Mail-Modul (`email`).
--
-- Hintergrund: Die Route `/email` ist über <Guard module="email"> bzw.
-- can('email','view') geschützt. Damit Nicht-Admins der Zugriff in der
-- Rechte-UI (Einstellungen → Zugriffsrechte) überhaupt vergeben werden
-- kann, muss der Modul-Schlüssel `email` im Katalog `permission_modules`
-- existieren. In der produktiven DB ist die Zeile bereits vorhanden,
-- es fehlte jedoch eine nachvollziehbare Migration – dadurch hätte eine
-- frisch aus Migrationen aufgebaute Instanz (neuer Mandant / CI / Test)
-- das Modul nicht und `/email` wäre dort faktisch Admin-only.
--
-- Diese Migration bildet exakt die bestehende Katalogzeile nach und ist
-- idempotent (ON CONFLICT DO NOTHING) – auf der bestehenden DB ein No-op.
-- Es werden KEINE Rechte automatisch an Rollen vergeben; das bleibt eine
-- bewusste Admin-Entscheidung in der Rechte-UI.
--
-- Mandantenneutral: nur Katalog-Stammdaten, keine BAU4YOU-Spezifika.
-- ============================================================

insert into public.permission_modules
  (key, label, group_key, parent_key, supports_scope, actions, is_system, active, sort_order)
values
  ('email', 'E-Mail', 'system', null, false,
   ARRAY['view','create','export','share'], true, true, 2)
on conflict (key) do nothing;
