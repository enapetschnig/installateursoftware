-- 0110: SUB-Aufträge (sub_orders) in die zentrale Dokumentenliste aufnehmen.
-- Additiv: nur eine weitere UNION-Branch in documents_unified_core; Spalten/Reihenfolge
-- identisch → CREATE OR REPLACE erhält den Wrapper documents_unified und alle Verwender.
-- Projektzuordnung über sub_orders.project_id (konsistent zu Angebot/Auftrag/Rechnung).
-- RLS der sub_orders-Tabelle (org_isolation + orders-Recht) gilt unverändert über die View.
CREATE OR REPLACE VIEW public.documents_unified_core AS
 WITH cust AS (
         SELECT contacts.id, contacts.organization_id,
                CASE WHEN COALESCE(contacts.customer_type, ''::text) = 'firma'::text THEN COALESCE(NULLIF(btrim(contacts.company), ''::text), btrim((COALESCE(contacts.first_name, ''::text) || ' '::text) || COALESCE(contacts.last_name, ''::text)))
                     ELSE COALESCE(NULLIF(btrim((COALESCE(contacts.first_name, ''::text) || ' '::text) || COALESCE(contacts.last_name, ''::text)), ''::text), contacts.company) END AS name,
            contacts.email
           FROM contacts
        ), proj AS (
         SELECT projects.id, projects.project_number, projects.title,
            btrim((((COALESCE(projects.street, ''::text) || ' '::text) || COALESCE(projects.zip, ''::text)) || ' '::text) || COALESCE(projects.city, ''::text)) AS address
           FROM projects
        )
 SELECT o.id, 'offer'::text AS kind, o.organization_id, dt.id AS document_type_id, 'angebote'::text AS type_slug,
    COALESCE(dt.name, 'Angebot'::text) AS type_name, COALESCE(dt.sort_order, 0) AS type_sort,
    o.offer_type_id AS variant_id, ot.name AS variant_name, o.number AS doc_number, o.status,
        CASE WHEN o.archived_at IS NOT NULL THEN 'archiviert'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'entwurf'::text THEN 'entwurf'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'versendet'::text THEN 'versendet'::text
            WHEN lower(COALESCE(o.status, ''::text)) = ANY (ARRAY['abgeschlossen'::text, 'angenommen'::text]) THEN 'abgeschlossen'::text
            ELSE COALESCE(o.status, 'entwurf'::text) END AS status_norm,
    NULL::text AS payment_status, lower(COALESCE(o.status, ''::text)) = 'entwurf'::text AS is_draft,
    o.archived_at IS NOT NULL AS is_archived, lower(COALESCE(o.status, ''::text)) = 'storniert'::text AS is_canceled,
    lower(COALESCE(o.status, ''::text)) <> 'entwurf'::text AS is_locked,
    (lower(COALESCE(o.status, ''::text)) = ANY (ARRAY['abgeschlossen'::text, 'versendet'::text, 'angenommen'::text])) AND o.archived_at IS NULL AS convertible,
    o.contact_id AS customer_id, c.name AS customer_name, o.project_id, p.project_number, p.title AS project_title, p.address AS object_address, o.title,
    COALESCE(o.closed_at::date, o.sent_at::date, o.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(o.closed_at, o.sent_at, o.created_at))::integer AS doc_year,
    o.net, o.gross, o.created_by AS editor_id, pr.name AS editor_name, o.created_at,
    GREATEST(o.created_at, o.closed_at, o.sent_at) AS last_change, NULL::text AS file_url,
    lower(concat_ws(' '::text, o.number, o.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, o.status, ot.name)) AS search_text
   FROM offers o
     LEFT JOIN document_types dt ON dt.slug = 'angebote'::text AND NOT dt.organization_id IS DISTINCT FROM o.organization_id
     LEFT JOIN offer_types ot ON ot.id = o.offer_type_id
     LEFT JOIN cust c ON c.id = o.contact_id
     LEFT JOIN proj p ON p.id = o.project_id
     LEFT JOIN profiles pr ON pr.id = o.created_by
  WHERE o.deleted_at IS NULL
UNION ALL
 SELECT o.id, 'order'::text AS kind, o.organization_id, dt.id AS document_type_id, 'auftraege'::text AS type_slug,
    COALESCE(dt.name, 'Auftrag'::text) AS type_name, COALESCE(dt.sort_order, 0) AS type_sort,
    o.offer_type_id AS variant_id, ot.name AS variant_name, o.order_number AS doc_number, o.status,
        CASE WHEN o.archived_at IS NOT NULL THEN 'archiviert'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'entwurf'::text THEN 'entwurf'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'storniert'::text THEN 'storniert'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'versendet'::text THEN 'versendet'::text
            ELSE 'abgeschlossen'::text END AS status_norm,
    NULL::text AS payment_status, lower(COALESCE(o.status, ''::text)) = 'entwurf'::text AS is_draft,
    o.archived_at IS NOT NULL AS is_archived, lower(COALESCE(o.status, ''::text)) = 'storniert'::text AS is_canceled,
    lower(COALESCE(o.status, ''::text)) <> 'entwurf'::text AS is_locked,
    (lower(COALESCE(o.status, ''::text)) <> ALL (ARRAY['entwurf'::text, 'storniert'::text, 'archiviert'::text])) AND o.archived_at IS NULL AS convertible,
    o.contact_id AS customer_id, c.name AS customer_name, o.project_id, p.project_number, p.title AS project_title, p.address AS object_address, o.title,
    COALESCE(o.order_date, o.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(o.order_date::timestamp with time zone, o.created_at))::integer AS doc_year,
    o.net, o.gross, o.created_by AS editor_id, pr.name AS editor_name, o.created_at,
    COALESCE(o.updated_at, o.created_at) AS last_change, NULL::text AS file_url,
    lower(concat_ws(' '::text, o.order_number, o.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, o.status, ot.name)) AS search_text
   FROM orders o
     LEFT JOIN document_types dt ON dt.slug = 'auftraege'::text AND NOT dt.organization_id IS DISTINCT FROM o.organization_id
     LEFT JOIN offer_types ot ON ot.id = o.offer_type_id
     LEFT JOIN cust c ON c.id = o.contact_id
     LEFT JOIN proj p ON p.id = o.project_id
     LEFT JOIN profiles pr ON pr.id = o.created_by
  WHERE o.deleted_at IS NULL
UNION ALL
 SELECT i.id, 'invoice'::text AS kind, i.organization_id, dt.id AS document_type_id, 'rechnungen'::text AS type_slug,
    COALESCE(dt.name, 'Rechnung'::text) AS type_name, COALESCE(dt.sort_order, 0) AS type_sort,
    i.offer_type_id AS variant_id, ot.name AS variant_name, i.number AS doc_number, i.doc_status AS status,
        CASE WHEN i.archived_at IS NOT NULL THEN 'archiviert'::text
            WHEN i.doc_status = 'storniert'::text OR i.storno_of IS NOT NULL THEN 'storniert'::text
            WHEN i.doc_status = 'entwurf'::text THEN 'entwurf'::text
            WHEN i.payment_status = 'bezahlt'::text THEN 'bezahlt'::text
            WHEN i.payment_status = 'teilbezahlt'::text THEN 'teilbezahlt'::text
            WHEN i.locked AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND COALESCE(i.payment_status, ''::text) <> 'bezahlt'::text THEN 'ueberfaellig'::text
            WHEN i.doc_status = 'versendet'::text THEN 'versendet'::text
            ELSE 'abgeschlossen'::text END AS status_norm,
    i.payment_status, i.doc_status = 'entwurf'::text AS is_draft, i.archived_at IS NOT NULL AS is_archived,
    i.doc_status = 'storniert'::text OR i.storno_of IS NOT NULL AS is_canceled, COALESCE(i.locked, false) AS is_locked, false AS convertible,
    i.contact_id AS customer_id, c.name AS customer_name, i.project_id, p.project_number, p.title AS project_title, p.address AS object_address, i.title,
    COALESCE(i.invoice_date, i.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(i.invoice_date::timestamp with time zone, i.created_at))::integer AS doc_year,
    i.net, i.gross, i.created_by AS editor_id, pr.name AS editor_name, i.created_at,
    COALESCE(i.updated_at, i.created_at) AS last_change, NULL::text AS file_url,
    lower(concat_ws(' '::text, i.number, i.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, i.doc_status, ot.name)) AS search_text
   FROM invoices i
     LEFT JOIN document_types dt ON dt.slug = 'rechnungen'::text AND NOT dt.organization_id IS DISTINCT FROM i.organization_id
     LEFT JOIN offer_types ot ON ot.id = i.offer_type_id
     LEFT JOIN cust c ON c.id = i.contact_id
     LEFT JOIN proj p ON p.id = i.project_id
     LEFT JOIN profiles pr ON pr.id = i.created_by
  WHERE i.deleted_at IS NULL
UNION ALL
 SELECT d.id, 'document'::text AS kind, d.organization_id, d.document_type_id, dt.slug AS type_slug,
    COALESCE(dt.name, 'Dokument'::text) AS type_name, COALESCE(dt.sort_order, 0) AS type_sort,
    NULL::uuid AS variant_id, NULL::text AS variant_name, d.document_number AS doc_number, d.status,
        CASE WHEN d.archived_at IS NOT NULL THEN 'archiviert'::text
            WHEN d.status = ANY (ARRAY['entwurf'::text, 'draft'::text]) THEN 'entwurf'::text
            ELSE COALESCE(d.status, 'erhalten'::text) END AS status_norm,
    NULL::text AS payment_status, d.status = ANY (ARRAY['entwurf'::text, 'draft'::text]) AS is_draft,
    d.archived_at IS NOT NULL AS is_archived, d.status = 'storniert'::text AS is_canceled, false AS is_locked, false AS convertible,
    d.customer_id, c.name AS customer_name, d.project_id, p.project_number, p.title AS project_title, p.address AS object_address,
    COALESCE(d.subject, d.title) AS title, COALESCE(d.doc_date, d.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(d.doc_date::timestamp with time zone, d.created_at))::integer AS doc_year,
    NULL::numeric AS net, NULL::numeric AS gross, COALESCE(d.created_by, d.uploaded_by) AS editor_id, pr.name AS editor_name, d.created_at,
    COALESCE(d.updated_at, d.created_at) AS last_change, d.file_url,
    lower(concat_ws(' '::text, d.document_number, d.title, d.subject, c.name, c.email, p.project_number, p.title, p.address, pr.name, d.status, d.sender, d.recipient, dt.name)) AS search_text
   FROM documents d
     LEFT JOIN document_types dt ON dt.id = d.document_type_id
     LEFT JOIN cust c ON c.id = d.customer_id
     LEFT JOIN proj p ON p.id = d.project_id
     LEFT JOIN profiles pr ON pr.id = COALESCE(d.created_by, d.uploaded_by)
  WHERE d.deleted_at IS NULL
UNION ALL
 SELECT s.id, 'sub_order'::text AS kind, s.organization_id, dt.id AS document_type_id, 'auftrag_sub'::text AS type_slug,
    COALESCE(dt.name, 'Auftrag SUB'::text) AS type_name, COALESCE(dt.sort_order, 0) AS type_sort,
    NULL::uuid AS variant_id, NULL::text AS variant_name, s.sub_number AS doc_number, s.status,
        CASE WHEN lower(COALESCE(s.status, ''::text)) = 'entwurf'::text THEN 'entwurf'::text
            WHEN lower(COALESCE(s.status, ''::text)) = 'storniert'::text THEN 'storniert'::text
            WHEN lower(COALESCE(s.status, ''::text)) = 'versendet'::text THEN 'versendet'::text
            ELSE 'abgeschlossen'::text END AS status_norm,
    NULL::text AS payment_status, lower(COALESCE(s.status, ''::text)) = 'entwurf'::text AS is_draft,
    false AS is_archived, lower(COALESCE(s.status, ''::text)) = 'storniert'::text AS is_canceled, false AS is_locked, false AS convertible,
    s.subcontractor_id AS customer_id, c.name AS customer_name, s.project_id, p.project_number, p.title AS project_title, p.address AS object_address, s.title,
    COALESCE(s.sub_date, s.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(s.sub_date::timestamp with time zone, s.created_at))::integer AS doc_year,
    s.net, s.gross, s.created_by AS editor_id, pr.name AS editor_name, s.created_at,
    COALESCE(s.updated_at, s.created_at) AS last_change, NULL::text AS file_url,
    lower(concat_ws(' '::text, s.sub_number, s.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, s.status)) AS search_text
   FROM sub_orders s
     LEFT JOIN document_types dt ON dt.slug = 'auftrag_sub'::text AND NOT dt.organization_id IS DISTINCT FROM s.organization_id
     LEFT JOIN cust c ON c.id = s.subcontractor_id
     LEFT JOIN proj p ON p.id = s.project_id
     LEFT JOIN profiles pr ON pr.id = s.created_by
  WHERE s.deleted_at IS NULL;
