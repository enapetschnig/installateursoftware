-- ============================================================
-- 0088 – Nummernkreise: fehlende Kreise ergänzen + Schutzstatus angleichen
-- ------------------------------------------------------------
-- Additiv & nicht-destruktiv (nur INSERT/UPDATE, keine Löschungen).
--   1) Anlegbare Dokumentarten ohne Nummernkreis bekommen einen Kreis
--      (Start 1, Label = document_types.name, Präfix aus dem Slug).
--   2) number_ranges.protected wird an document_types.is_system angeglichen
--      (systemrelevante Dokumentart => geschützter Kreis, sonst frei).
-- Kontakt-/Stammdaten-Kreise (ohne document_type_id) bleiben unberührt.
-- ============================================================

-- 1) Fehlende Dokument-Nummernkreise anlegen (nur für anlegbare Arten ohne Kreis).
insert into public.number_ranges
  (doc_type, label, prefix, use_year, separator, min_digits, next_number, active, protected, document_type_id, organization_id)
select
  dt.slug,
  dt.name,
  upper(substr(replace(dt.slug, '_', '-'), 1, 18)),
  false, '-', 4, 1, true,
  dt.is_system,                -- Schutz folgt der Dokumentart
  dt.id,
  dt.organization_id
from public.document_types dt
where dt.slug in (
    'briefe', 'kalkulation', 'materialbestellungen', 'parkflaechenabsperrung', 'baustellenbericht'
  )
  and dt.allow_create = true
  and not exists (
    select 1 from public.number_ranges nr where nr.document_type_id = dt.id
  );

-- 2) Schutzstatus aller mit einer Dokumentart verknüpften Kreise angleichen.
update public.number_ranges nr
set protected = dt.is_system,
    updated_at = now()
from public.document_types dt
where nr.document_type_id = dt.id
  and nr.protected is distinct from dt.is_system;
