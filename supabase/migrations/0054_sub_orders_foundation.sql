-- 0054: Subunternehmer-Vergabe – eigene Tabellen (Kundenkette bleibt sauber getrennt).
-- sub_orders = Auftrag VON UNS AN Subunternehmer, abgeleitet aus einem Hauptauftrag.
-- RLS exakt nach orders-Muster (current_org_id + b4y_is_admin/b4y_has_permission('orders')).
-- Modul 'orders' wiederverwendet, damit keine Rechte-Sperre entsteht (eigene SUB-Rechte = Refinement).

CREATE TABLE IF NOT EXISTS public.sub_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  sub_number text,
  sub_date date NOT NULL DEFAULT (now()::date),
  title text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  subcontractor_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_person_id uuid,
  status text NOT NULL DEFAULT 'entwurf',
  payment_term_days int,
  skonto_percent numeric, skonto_days int,
  retention_percent numeric,
  discount_percent numeric,
  service_period text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  net numeric NOT NULL DEFAULT 0, vat numeric NOT NULL DEFAULT 0, gross numeric NOT NULL DEFAULT 0,
  cost_basis_net numeric NOT NULL DEFAULT 0,
  margin_net numeric NOT NULL DEFAULT 0,
  pdf_label text, doc_intro_text text, doc_closing_text text, display_settings_snapshot jsonb,
  sent_at timestamptz, accepted_at timestamptz, signed_at timestamptz,
  snapshot jsonb,
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.sub_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid DEFAULT current_org_id(),
  sub_order_id uuid NOT NULL REFERENCES public.sub_orders(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  source_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  source_order_item_key text,
  pos_no text, short_text text, long_text text,
  qty numeric NOT NULL DEFAULT 0,
  unit text,
  customer_unit_price numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  discount_percent numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 20,
  net numeric NOT NULL DEFAULT 0,
  is_title boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sub_orders_order ON public.sub_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_project ON public.sub_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_sub_order_items_sub ON public.sub_order_items(sub_order_id);
CREATE INDEX IF NOT EXISTS idx_sub_order_items_srckey ON public.sub_order_items(source_order_item_key);

ALTER TABLE public.sub_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON public.sub_orders AS RESTRICTIVE FOR ALL
  USING (organization_id = current_org_id() OR organization_id IS NULL)
  WITH CHECK (organization_id = current_org_id() OR organization_id IS NULL);
CREATE POLICY hide_soft_deleted ON public.sub_orders AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY sel ON public.sub_orders FOR SELECT USING (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','view'));
CREATE POLICY ins ON public.sub_orders FOR INSERT WITH CHECK (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','create'));
CREATE POLICY upd ON public.sub_orders FOR UPDATE USING (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','edit')) WITH CHECK (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','edit'));
CREATE POLICY del ON public.sub_orders FOR DELETE USING (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','delete'));

CREATE POLICY org_isolation ON public.sub_order_items AS RESTRICTIVE FOR ALL
  USING (organization_id = current_org_id() OR organization_id IS NULL)
  WITH CHECK (organization_id = current_org_id() OR organization_id IS NULL);
CREATE POLICY sel ON public.sub_order_items FOR SELECT USING (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','view'));
CREATE POLICY ins ON public.sub_order_items FOR INSERT WITH CHECK (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','create'));
CREATE POLICY upd ON public.sub_order_items FOR UPDATE USING (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','edit')) WITH CHECK (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','edit'));
CREATE POLICY del ON public.sub_order_items FOR DELETE USING (b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(),'orders','delete'));

INSERT INTO public.number_ranges (doc_type, label, prefix, use_year, separator, min_digits, next_number, active, protected)
  VALUES ('auftrag_sub', 'Auftrag SUB', 'SUB', true, '-', 4, 1, true, false)
  ON CONFLICT (doc_type) DO NOTHING;
