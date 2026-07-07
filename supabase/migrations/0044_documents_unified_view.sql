-- ============================================================
-- B4Y SuperAPP – Zentrale Dokumentenübersicht
-- 1) Archiv-Felder für die Dokumentkette (documents hat archived_at bereits)
-- 2) View documents_unified: vereint Angebote/Aufträge/Rechnungen/Dokumente
--    in ein gemeinsames, server-seitig filter-/sortier-/durchsuchbares Schema.
--    Mandantenfähig über die RLS der Basistabellen (security_invoker).
--    Dokumenttypen dynamisch via JOIN auf document_types (Slug je Mandant) –
--    Umbenennung/Deaktivierung der Typen wirkt automatisch.
-- ============================================================

-- 1) Archiv-Felder
ALTER TABLE offers   ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE offers   ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_by uuid;

-- Performance: Sortier-/Filter-Indizes (klein gehalten)
CREATE INDEX IF NOT EXISTS idx_offers_created_at   ON offers (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at   ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices (created_at);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at);

-- 2) View
CREATE OR REPLACE VIEW documents_unified
WITH (security_invoker = true) AS
WITH
cust AS (
  SELECT id, organization_id,
    CASE WHEN coalesce(customer_type,'') = 'firma'
         THEN coalesce(NULLIF(btrim(company),''), btrim(coalesce(first_name,'')||' '||coalesce(last_name,'')))
         ELSE coalesce(NULLIF(btrim(coalesce(first_name,'')||' '||coalesce(last_name,'')),''), company)
    END AS name,
    email
  FROM contacts
),
proj AS (
  SELECT id, project_number, title,
    btrim(coalesce(street,'') || ' ' || coalesce(zip,'') || ' ' || coalesce(city,'')) AS address
  FROM projects
)
-- ===== ANGEBOTE =====
SELECT
  o.id, 'offer'::text AS kind, o.organization_id,
  dt.id AS document_type_id, 'angebote'::text AS type_slug,
  coalesce(dt.name,'Angebot') AS type_name, coalesce(dt.sort_order,0) AS type_sort,
  o.offer_type_id AS variant_id, ot.name AS variant_name,
  o.number AS doc_number,
  o.status AS status,
  CASE WHEN o.archived_at IS NOT NULL THEN 'archiviert'
       WHEN lower(coalesce(o.status,''))='entwurf' THEN 'entwurf'
       WHEN lower(coalesce(o.status,''))='versendet' THEN 'versendet'
       WHEN lower(coalesce(o.status,'')) IN ('abgeschlossen','angenommen') THEN 'abgeschlossen'
       ELSE coalesce(o.status,'entwurf') END AS status_norm,
  NULL::text AS payment_status,
  (lower(coalesce(o.status,''))='entwurf') AS is_draft,
  (o.archived_at IS NOT NULL) AS is_archived,
  (lower(coalesce(o.status,''))='storniert') AS is_canceled,
  (lower(coalesce(o.status,''))<>'entwurf') AS is_locked,
  (lower(coalesce(o.status,'')) IN ('abgeschlossen','versendet','angenommen') AND o.archived_at IS NULL) AS convertible,
  o.contact_id AS customer_id, c.name AS customer_name,
  o.project_id, p.project_number, p.title AS project_title, p.address AS object_address,
  o.title,
  coalesce(o.closed_at::date, o.sent_at::date, o.created_at::date) AS doc_date,
  extract(year FROM coalesce(o.closed_at, o.sent_at, o.created_at))::int AS doc_year,
  o.net, o.gross,
  o.created_by AS editor_id, pr.name AS editor_name,
  o.created_at, greatest(o.created_at, o.closed_at, o.sent_at) AS last_change,
  NULL::text AS file_url,
  lower(concat_ws(' ', o.number, o.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, o.status, ot.name)) AS search_text
FROM offers o
LEFT JOIN document_types dt ON dt.slug='angebote' AND dt.organization_id IS NOT DISTINCT FROM o.organization_id
LEFT JOIN offer_types ot ON ot.id = o.offer_type_id
LEFT JOIN cust c ON c.id = o.contact_id
LEFT JOIN proj p ON p.id = o.project_id
LEFT JOIN profiles pr ON pr.id = o.created_by
WHERE o.deleted_at IS NULL

UNION ALL
-- ===== AUFTRÄGE =====
SELECT
  o.id, 'order'::text, o.organization_id,
  dt.id, 'auftraege'::text,
  coalesce(dt.name,'Auftrag'), coalesce(dt.sort_order,0),
  o.offer_type_id, ot.name,
  o.order_number,
  o.status,
  CASE WHEN o.archived_at IS NOT NULL THEN 'archiviert'
       WHEN lower(coalesce(o.status,''))='entwurf' THEN 'entwurf'
       WHEN lower(coalesce(o.status,''))='storniert' THEN 'storniert'
       WHEN lower(coalesce(o.status,''))='versendet' THEN 'versendet'
       ELSE 'abgeschlossen' END,
  NULL::text,
  (lower(coalesce(o.status,''))='entwurf'),
  (o.archived_at IS NOT NULL),
  (lower(coalesce(o.status,''))='storniert'),
  (lower(coalesce(o.status,''))<>'entwurf'),
  (lower(coalesce(o.status,'')) NOT IN ('entwurf','storniert','archiviert') AND o.archived_at IS NULL),
  o.contact_id, c.name,
  o.project_id, p.project_number, p.title, p.address,
  o.title,
  coalesce(o.order_date, o.created_at::date),
  extract(year FROM coalesce(o.order_date::timestamptz, o.created_at))::int,
  o.net, o.gross,
  o.created_by, pr.name,
  o.created_at, coalesce(o.updated_at, o.created_at),
  NULL::text,
  lower(concat_ws(' ', o.order_number, o.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, o.status, ot.name))
FROM orders o
LEFT JOIN document_types dt ON dt.slug='auftraege' AND dt.organization_id IS NOT DISTINCT FROM o.organization_id
LEFT JOIN offer_types ot ON ot.id = o.offer_type_id
LEFT JOIN cust c ON c.id = o.contact_id
LEFT JOIN proj p ON p.id = o.project_id
LEFT JOIN profiles pr ON pr.id = o.created_by
WHERE o.deleted_at IS NULL

UNION ALL
-- ===== RECHNUNGEN =====
SELECT
  i.id, 'invoice'::text, i.organization_id,
  dt.id, 'rechnungen'::text,
  coalesce(dt.name,'Rechnung'), coalesce(dt.sort_order,0),
  i.offer_type_id, ot.name,
  i.number,
  i.doc_status,
  CASE WHEN i.archived_at IS NOT NULL THEN 'archiviert'
       WHEN i.doc_status='storniert' OR i.storno_of IS NOT NULL THEN 'storniert'
       WHEN i.doc_status='entwurf' THEN 'entwurf'
       WHEN i.payment_status='bezahlt' THEN 'bezahlt'
       WHEN i.payment_status='teilbezahlt' THEN 'teilbezahlt'
       WHEN i.locked AND i.due_date IS NOT NULL AND i.due_date < current_date AND coalesce(i.payment_status,'') NOT IN ('bezahlt') THEN 'ueberfaellig'
       WHEN i.doc_status='versendet' THEN 'versendet'
       ELSE 'abgeschlossen' END,
  i.payment_status,
  (i.doc_status='entwurf'),
  (i.archived_at IS NOT NULL),
  (i.doc_status='storniert' OR i.storno_of IS NOT NULL),
  coalesce(i.locked,false),
  false,
  i.contact_id, c.name,
  i.project_id, p.project_number, p.title, p.address,
  i.title,
  coalesce(i.invoice_date, i.created_at::date),
  extract(year FROM coalesce(i.invoice_date::timestamptz, i.created_at))::int,
  i.net, i.gross,
  i.created_by, pr.name,
  i.created_at, coalesce(i.updated_at, i.created_at),
  NULL::text,
  lower(concat_ws(' ', i.number, i.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, i.doc_status, ot.name))
FROM invoices i
LEFT JOIN document_types dt ON dt.slug='rechnungen' AND dt.organization_id IS NOT DISTINCT FROM i.organization_id
LEFT JOIN offer_types ot ON ot.id = i.offer_type_id
LEFT JOIN cust c ON c.id = i.contact_id
LEFT JOIN proj p ON p.id = i.project_id
LEFT JOIN profiles pr ON pr.id = i.created_by
WHERE i.deleted_at IS NULL

UNION ALL
-- ===== GENERISCHE DOKUMENTE (Uploads/E-Mails/weitere Typen) =====
SELECT
  d.id, 'document'::text, d.organization_id,
  d.document_type_id, dt.slug,
  coalesce(dt.name,'Dokument'), coalesce(dt.sort_order,0),
  NULL::uuid, NULL::text,
  d.document_number,
  d.status,
  CASE WHEN d.archived_at IS NOT NULL THEN 'archiviert'
       WHEN d.status IN ('entwurf','draft') THEN 'entwurf'
       ELSE coalesce(d.status,'erhalten') END,
  NULL::text,
  (d.status IN ('entwurf','draft')),
  (d.archived_at IS NOT NULL),
  (d.status='storniert'),
  false,
  false,
  d.customer_id, c.name,
  d.project_id, p.project_number, p.title, p.address,
  coalesce(d.subject, d.title),
  coalesce(d.doc_date, d.created_at::date),
  extract(year FROM coalesce(d.doc_date::timestamptz, d.created_at))::int,
  NULL::numeric, NULL::numeric,
  coalesce(d.created_by, d.uploaded_by), pr.name,
  d.created_at, coalesce(d.updated_at, d.created_at),
  d.file_url,
  lower(concat_ws(' ', d.document_number, d.title, d.subject, c.name, c.email, p.project_number, p.title, p.address, pr.name, d.status, d.sender, d.recipient, dt.name))
FROM documents d
LEFT JOIN document_types dt ON dt.id = d.document_type_id
LEFT JOIN cust c ON c.id = d.customer_id
LEFT JOIN proj p ON p.id = d.project_id
LEFT JOIN profiles pr ON pr.id = coalesce(d.created_by, d.uploaded_by)
WHERE d.deleted_at IS NULL;

GRANT SELECT ON documents_unified TO authenticated, anon;
