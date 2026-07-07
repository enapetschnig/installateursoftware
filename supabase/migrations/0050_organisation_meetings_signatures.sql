-- ============================================================
-- B4Y SuperAPP – Projektbereich „Organisation":
-- Baubesprechungen (+ Teilnehmer, TOPs/Beschlüsse/offene Punkte),
-- digitale Unterschriften, Aufgaben-Quellenbezug.
-- Mandantenfähig (organization_id + current_org_id()-RLS wie Bestand).
-- ============================================================

CREATE TABLE IF NOT EXISTS project_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_number text,
  title text NOT NULL DEFAULT '',
  meeting_date date NOT NULL DEFAULT current_date,
  time_from text, time_to text,
  location text,
  status text NOT NULL DEFAULT 'entwurf',          -- entwurf | abgeschlossen
  notes text,                                       -- Besprechungsnotizen / Protokoll-Fließtext
  next_meeting_date date,
  planning_event_id uuid REFERENCES planning_events(id) ON DELETE SET NULL, -- optionale Termin-Verknüpfung (vorbereitet)
  finalized_at timestamptz, finalized_by uuid,
  created_by uuid DEFAULT auth.uid(), updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz, deleted_by uuid
);

CREATE TABLE IF NOT EXISTS project_meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  meeting_id uuid NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES project_participants(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  person_id uuid REFERENCES contact_persons(id) ON DELETE SET NULL,
  role text DEFAULT 'sonstige',                     -- intern | kunde | planer | sub | sonstige
  name text NOT NULL DEFAULT '',                    -- Klarname (auch Freitext erlaubt)
  company text, email text,
  present boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_meeting_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  meeting_id uuid NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'agenda',              -- agenda | note | open | decision
  text text NOT NULL DEFAULT '',
  status text,                                      -- für offene Punkte: offen | erledigt …
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES project_meetings(id) ON DELETE SET NULL,
  planning_event_id uuid REFERENCES planning_events(id) ON DELETE SET NULL,
  document_ref uuid,                                -- optionaler Dokumentbezug (lose, da typ-übergreifend)
  order_sub_ref text,                               -- optionaler Bezug zu Auftrag-SUB
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  person_id uuid REFERENCES contact_persons(id) ON DELETE SET NULL,
  participant_id uuid REFERENCES project_participants(id) ON DELETE SET NULL,
  purpose text DEFAULT 'protokoll',                 -- protokoll | anwesenheit | auftrag_sub | regie | abnahme
  signer_name text NOT NULL DEFAULT '',
  signer_company text, signer_role text,
  signed_at timestamptz DEFAULT now(),
  location text,
  signature_data text,                              -- Unterschrift als PNG-DataURL
  note text,
  captured_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz, deleted_by uuid
);

-- Aufgaben-Quellenbezug (keine Doppellogik – Baubesprechungs-Aufgaben leben in tasks)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_meeting_id uuid REFERENCES project_meetings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pm_project ON project_meetings (project_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_pmp_meeting ON project_meeting_participants (meeting_id);
CREATE INDEX IF NOT EXISTS idx_pmi_meeting ON project_meeting_items (meeting_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_psig_project ON project_signatures (project_id);
CREATE INDEX IF NOT EXISTS idx_psig_meeting ON project_signatures (meeting_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source_meeting ON tasks (source_meeting_id);

-- RLS: permissive app_all + restriktive org_isolation (wie Bestand)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_meetings','project_meeting_participants','project_meeting_items','project_signatures'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS app_all ON %I;', t);
    EXECUTE format('CREATE POLICY app_all ON %I AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I;', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (organization_id = current_org_id() OR organization_id IS NULL) WITH CHECK (organization_id = current_org_id() OR organization_id IS NULL);', t);
  END LOOP;
END $$;

-- Rechte-Module (Admins sehen automatisch alles; andere Rollen konfigurierbar)
INSERT INTO permission_modules (key, label, group_key, parent_key, supports_scope, actions, is_system, active, sort_order) VALUES
  ('meetings','Baubesprechungen','projekte','projects',true, ARRAY['view','create','edit','delete','finalize','export','print','share'], true, true, 25),
  ('signatures','Unterschriften','projekte','projects',true, ARRAY['view','create','delete'], true, true, 26)
ON CONFLICT (key) DO NOTHING;

-- Protokoll-Nummernkreis je Organisation (mandantenfähig, keine hartcodierte ID)
INSERT INTO number_ranges (organization_id, doc_type, label, prefix, use_year, separator, min_digits, next_number, active, protected)
SELECT DISTINCT organization_id, 'protokoll', 'Besprechungsprotokolle', 'PROT', true, '-', 4, 1, true, false
FROM number_ranges
WHERE organization_id IS NOT NULL
ON CONFLICT DO NOTHING;
