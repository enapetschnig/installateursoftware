-- ============================================================
-- 0120 – anfragen: partiellen UNIQUE-Index in echten UNIQUE-Constraint umbauen
-- ------------------------------------------------------------
-- Migration 0117 hatte einen partiellen Unique-Index angelegt:
--   CREATE UNIQUE INDEX anfragen_org_source_ref_uk
--     ON anfragen(organization_id, source, source_ref)
--     WHERE source_ref IS NOT NULL;
--
-- Problem: PostgreSQL's UPSERT (INSERT ... ON CONFLICT) akzeptiert NUR
-- echte UNIQUE-Constraints als Conflict-Target, KEINE partiellen Indices.
-- Der Fonio-Webhook schlug deshalb mit Error 42P10 fehl:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Loesung: partiellen Index droppen + echten UNIQUE-Constraint anlegen.
-- NULL-Werte sind in UNIQUE-Constraints standardmaessig erlaubt (mehrere NULLs
-- gelten in PostgreSQL als verschieden) — daher sind manuelle Anfragen ohne
-- source_ref (NULL) weiterhin moeglich, ohne dass die Idempotenz fuer
-- nicht-NULL source_refs leidet.
-- ============================================================

-- 1) Alten partiellen Index droppen.
drop index if exists public.anfragen_org_source_ref_uk;

-- 2) Echten UNIQUE-Constraint anlegen, der als ON CONFLICT target dienen kann.
--    NULL-Verhalten bleibt: jede NULL ist unique -> keine Kollision bei
--    manuellen Anfragen ohne source_ref.
alter table public.anfragen
  drop constraint if exists anfragen_org_source_source_ref_key;

alter table public.anfragen
  add constraint anfragen_org_source_source_ref_key
  unique (organization_id, source, source_ref);

comment on constraint anfragen_org_source_source_ref_key on public.anfragen is
  'Webhook-Idempotenz: derselbe Anruf landet bei Retry in derselben Row. '
  'NULL-source_ref erlaubt mehrfache manuelle Anfragen (PostgreSQL NULL-Semantik).';
