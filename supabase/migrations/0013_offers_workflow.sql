-- ============================================================
-- B4Y SuperAPP – Migration 0013
-- Angebots-Workflow: Abschluss-/Versanddaten. Idempotent.
-- ============================================================
alter table public.offers add column if not exists closed_at timestamptz;
alter table public.offers add column if not exists sent_at timestamptz;
alter table public.offers add column if not exists sent_by uuid references auth.users(id);

-- Bereinigung: technische Entwurf-Logs nicht mehr im sichtbaren Projekt-Logbuch.
-- 'Angebot erstellt' wurde früher schon beim Anlegen eines Entwurfs erzeugt –
-- ein Entwurf ist aber kein abgeschlossenes Angebot.
delete from public.project_log where entry = 'Angebot erstellt';
