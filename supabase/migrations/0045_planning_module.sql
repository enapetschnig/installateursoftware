-- ============================================================
-- B4Y SuperAPP – Planungsmodul (Termine, Ressourcen, Abwesenheiten)
-- Mandantenfähig (organization_id + current_org_id()-RLS wie Bestand).
-- Recurrence/Reminder/Outlook als jsonb vorbereitet (spätere Integration).
-- ============================================================

CREATE TABLE IF NOT EXISTS planning_resource_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  name text NOT NULL, slug text, icon text,
  sort_order int DEFAULT 0, is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planning_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  name text NOT NULL, slug text, color text DEFAULT '#64748b',
  sort_order int DEFAULT 0, is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planning_event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  name text NOT NULL, slug text, color text DEFAULT '#0ea5e9',
  default_duration_min int DEFAULT 60, is_absence boolean DEFAULT false,
  sort_order int DEFAULT 0, is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planning_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  name text NOT NULL,
  resource_type_id uuid REFERENCES planning_resource_types(id) ON DELETE SET NULL,
  category_id uuid REFERENCES planning_categories(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  color text DEFAULT '#64748b', description text, availability jsonb,
  is_active boolean DEFAULT true, sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  title text NOT NULL DEFAULT '',
  event_type_id uuid REFERENCES planning_event_types(id) ON DELETE SET NULL,
  category_id uuid REFERENCES planning_categories(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'geplant', priority text DEFAULT 'normal', color text,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, all_day boolean DEFAULT false,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  location text, description text, visibility text DEFAULT 'intern',
  recurrence jsonb, reminder jsonb, external_ref jsonb, done_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planning_event_employees (
  event_id uuid NOT NULL REFERENCES planning_events(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id uuid DEFAULT current_org_id(),
  PRIMARY KEY (event_id, employee_id)
);

CREATE TABLE IF NOT EXISTS planning_event_resources (
  event_id uuid NOT NULL REFERENCES planning_events(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES planning_resources(id) ON DELETE CASCADE,
  organization_id uuid DEFAULT current_org_id(),
  PRIMARY KEY (event_id, resource_id)
);

CREATE TABLE IF NOT EXISTS planning_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'urlaub',
  start_date date NOT NULL, end_date date NOT NULL, all_day boolean DEFAULT true,
  status text DEFAULT 'bestaetigt', color text DEFAULT '#ef4444', note text,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pl_events_org_start ON planning_events (organization_id, start_at);
CREATE INDEX IF NOT EXISTS idx_pl_events_project ON planning_events (project_id);
CREATE INDEX IF NOT EXISTS idx_pl_ee_emp ON planning_event_employees (employee_id);
CREATE INDEX IF NOT EXISTS idx_pl_er_res ON planning_event_resources (resource_id);
CREATE INDEX IF NOT EXISTS idx_pl_abs_emp ON planning_absences (employee_id, start_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'planning_resource_types','planning_categories','planning_event_types',
    'planning_resources','planning_events','planning_event_employees',
    'planning_event_resources','planning_absences'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS app_all ON %I;', t);
    EXECUTE format('CREATE POLICY app_all ON %I AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I;', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (organization_id = current_org_id() OR organization_id IS NULL) WITH CHECK (organization_id = current_org_id() OR organization_id IS NULL);', t);
  END LOOP;
END $$;

INSERT INTO planning_resource_types (organization_id, name, slug, sort_order) VALUES
  (NULL,'Mitarbeiter','mitarbeiter',1),(NULL,'Team / Kolonne','team',2),(NULL,'Fahrzeug','fahrzeug',3),
  (NULL,'Maschine','maschine',4),(NULL,'Gerät','geraet',5),(NULL,'Raum / Lager / Büro','raum',6),
  (NULL,'Subunternehmer','subunternehmer',7),(NULL,'Sonstiges','sonstiges',8)
ON CONFLICT DO NOTHING;

INSERT INTO planning_categories (organization_id, name, slug, color, sort_order) VALUES
  (NULL,'Baustelle','baustelle','#16a34a',1),(NULL,'Büro','buero','#6366f1',2),(NULL,'Lieferung','lieferung','#0ea5e9',3),
  (NULL,'Besichtigung','besichtigung','#f59e0b',4),(NULL,'Urlaub','urlaub','#ef4444',5),(NULL,'Krankenstand','krankenstand','#dc2626',6),
  (NULL,'Intern','intern','#64748b',7),(NULL,'Subunternehmer','subunternehmer','#a855f7',8),
  (NULL,'Material','material','#0891b2',9),(NULL,'Wartung','wartung','#ca8a04',10)
ON CONFLICT DO NOTHING;

INSERT INTO planning_event_types (organization_id, name, slug, color, default_duration_min, is_absence, sort_order) VALUES
  (NULL,'Erstbesichtigung','erstbesichtigung','#f59e0b',60,false,1),
  (NULL,'Baustellentermin','baustellentermin','#16a34a',120,false,2),
  (NULL,'Baustellenarbeit','baustellenarbeit','#15803d',480,false,3),
  (NULL,'Materiallieferung','materiallieferung','#0ea5e9',60,false,4),
  (NULL,'Subunternehmertermin','subunternehmertermin','#a855f7',120,false,5),
  (NULL,'Büroarbeit','bueroarbeit','#6366f1',120,false,6),
  (NULL,'Besprechung','besprechung','#8b5cf6',60,false,7),
  (NULL,'Urlaub','urlaub','#ef4444',1440,true,8),
  (NULL,'Krankenstand','krankenstand','#dc2626',1440,true,9),
  (NULL,'Zeitausgleich','zeitausgleich','#f97316',1440,true,10),
  (NULL,'Schulung','schulung','#0d9488',480,false,11),
  (NULL,'Wartung','wartung','#ca8a04',120,false,12),
  (NULL,'Erinnerung','erinnerung','#64748b',30,false,13),
  (NULL,'Sonstiges','sonstiges','#94a3b8',60,false,14)
ON CONFLICT DO NOTHING;

-- Menüpunkt „Plantafel" → „Planung" + Aktionen (Schlüssel bleibt 'plantafel' für Rechte-Kompatibilität)
UPDATE permission_modules
SET label='Planung',
    actions = (SELECT array(SELECT DISTINCT unnest(coalesce(actions,'{}') || ARRAY['view','create','edit','delete','archive','export'])))
WHERE key='plantafel';
