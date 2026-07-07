-- ============================================================
-- B4Y SuperAPP – KI-Nutzungsprotokoll (Abrechnung/Monitoring je Mandant)
-- Mandantenfähig (organization_id + current_org_id()-RLS wie Bestand).
-- Wird serverseitig (Service-Role) von den /api/ai-Functions befüllt.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  user_id uuid,
  action_type text NOT NULL,            -- 'chat' | 'transcription'
  model text,
  provider text,                        -- 'openai' | 'anthropic'
  input_length int,
  output_length int,
  tokens_input int,
  tokens_output int,
  cost_estimate numeric,
  context_type text,                    -- z. B. projekt/angebot/dokument
  route text,
  success boolean DEFAULT true,
  error text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_org_created ON ai_usage_logs (organization_id, created_at DESC);

ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON ai_usage_logs;
CREATE POLICY app_all ON ai_usage_logs AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS org_isolation ON ai_usage_logs;
CREATE POLICY org_isolation ON ai_usage_logs AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR organization_id IS NULL)
  WITH CHECK (organization_id = current_org_id() OR organization_id IS NULL);
