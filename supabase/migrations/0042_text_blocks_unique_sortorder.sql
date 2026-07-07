-- Textbausteine/Titel: „Nummer" (sort_order) je Firma & Typ eindeutig machen.
-- 1) Bestehende Dubletten korrigieren: sauber in 10er-Schritten neu durchnummerieren
--    (Reihenfolge bleibt erhalten – sortiert nach bisheriger Nummer, dann Titel).
with renum as (
  select id,
         row_number() over (
           partition by organization_id, type
           order by sort_order, title, created_at
         ) * 10 as new_so
  from public.text_blocks
)
update public.text_blocks t
set sort_order = r.new_so
from renum r
where r.id = t.id and t.sort_order is distinct from r.new_so;

-- 2) Künftige Dubletten verhindern (DB-seitig, mandantenfähig je Typ).
create unique index if not exists uq_text_blocks_sortorder
  on public.text_blocks (organization_id, type, sort_order);
