-- 0056: Automationen – erweitertes, generisches Regelmodell (mandantenfähig, erweiterbar).
-- Baut auf bestehender Tabelle automations auf (NICHT neu bauen). trigger_stage bleibt
-- aus Kompatibilität erhalten (= Auslöse-Status für project.status_changed/-is).
-- Neue Felder ermöglichen weitere Trigger-Typen (project.created, später document.* etc.),
-- Bedingungen und Audit-Spalten. Keine BAU4YOU-Hardcodierung, keine Seed-Regeln.

ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'project.status_changed',
  ADD COLUMN IF NOT EXISTS trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Audit-Spalten für das Protokoll (Auslöser-Details).
ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS trigger_type text,
  ADD COLUMN IF NOT EXISTS old_stage text,
  ADD COLUMN IF NOT EXISTS new_stage text,
  ADD COLUMN IF NOT EXISTS automation_name text,
  ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_automations_trigger_type ON public.automations(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automation_runs_created ON public.automation_runs(created_at DESC);
