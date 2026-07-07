-- 0055: Automationen-Engine – Ausführungs-Protokoll + optionale Konfig-Felder.
-- Die Tabelle public.automations existiert bereits (trigger_stage + actions jsonb, RLS auf Modul 'automations').
-- Hier nur sanfte Ergänzungen: Beschreibung/Reihenfolge + ein Audit-/Run-Log für Nachvollziehbarkeit.
-- Mandantenfähig (organization_id = current_org_id()), keine BAU4YOU-Hardcodierung, keine Seed-Regeln.

-- 1) Sanfte Ergänzungen an automations (alle optional/nullable -> bestehende Zeilen unberührt)
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2) Ausführungs-Protokoll: welche Regel wann für welches Projekt mit welchem Ergebnis lief.
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  automation_id uuid REFERENCES public.automations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  trigger_stage text,
  status text NOT NULL DEFAULT 'ok',          -- ok | partial | error
  result jsonb NOT NULL DEFAULT '[]'::jsonb,   -- pro Aktion: {type, ok, info?}
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON public.automation_runs(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_project ON public.automation_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_automations_trigger_stage ON public.automations(trigger_stage);

-- 3) RLS exakt nach automations-Muster (Modul 'automations' wiederverwendet).
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON public.automation_runs AS RESTRICTIVE FOR ALL
  USING (organization_id = current_org_id() OR organization_id IS NULL)
  WITH CHECK (organization_id = current_org_id() OR organization_id IS NULL);
CREATE POLICY sel ON public.automation_runs FOR SELECT
  USING (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'automations','view'));
CREATE POLICY ins ON public.automation_runs FOR INSERT
  WITH CHECK (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'automations','view'));
CREATE POLICY del ON public.automation_runs FOR DELETE
  USING (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'automations','delete'));
