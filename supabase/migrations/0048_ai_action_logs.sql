-- ============================================================
-- B4Y SuperAPP – KI-Aktions-/Tool-Protokoll (Auditierbarkeit)
-- Mandantenfähig (organization_id + current_org_id()-RLS).
-- Wird serverseitig (Service-Role) von api/ai/chat bei Tool-Nutzung befüllt.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  user_id uuid,
  user_input_summary text,
  tool_name text,
  tool_arguments_summary text,
  action_level int,                 -- 1 read | 2 draft | 3 write | 4 destructive
  target_type text,
  target_id text,
  status text,                      -- ok | denied | error | needs_confirmation
  confirmation_required boolean DEFAULT false,
  confirmed_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_action_org_created ON ai_action_logs (organization_id, created_at DESC);

ALTER TABLE ai_action_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON ai_action_logs;
CREATE POLICY app_all ON ai_action_logs AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS org_isolation ON ai_action_logs;
CREATE POLICY org_isolation ON ai_action_logs AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR organization_id IS NULL)
  WITH CHECK (organization_id = current_org_id() OR organization_id IS NULL);
