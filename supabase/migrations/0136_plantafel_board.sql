-- ============================================================
-- Installateursoftware – Migration 0136: Plantafel-Ergänzungen
--
-- Ergänzungen für die moderne Wochen-/Monats-Plantafel (Vorbild
-- monti.pro, umgesetzt auf dem bestehenden Planungsmodul 0045):
--  * projects.board_color – eigene Balkenfarbe je Projekt auf der
--    Tafel (null = Farbe aus Projektstatus/Hash).
--  * planning_events.done_at – Erledigt-Zeitpunkt für Abhaken direkt
--    auf der Tafel.
-- Idempotent.
-- ============================================================

alter table public.projects
  add column if not exists board_color text;

alter table public.planning_events
  add column if not exists done_at timestamptz;
