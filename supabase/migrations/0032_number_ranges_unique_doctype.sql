-- Nummernkreis-Zuordnung per ID (Backfill alter Slugs) + Eindeutigkeit je Firma & Dokumentart.
update public.number_ranges nr
set document_type_id = dt.id, updated_at = now()
from public.document_types dt
where nr.document_type_id is null
  and dt.organization_id = nr.organization_id
  and dt.slug = case nr.doc_type
    when 'angebot' then 'angebote'
    when 'auftrag' then 'auftraege'
    when 'rechnung' then 'rechnungen'
    when 'gutschrift' then 'gutschriften'
    when 'nachtrag' then 'nachtraege'
    when 'reminder' then 'mahnungen'
    when 'measurement' then 'aufmasse'
    when 'work_instruction' then 'arbeitsanweisung'
    when 'time_requirement' then 'zeitvorgabe'
    when 'subcontractor_order_confirmation' then 'auftragsbestaetigung_sub'
    else null end;

create unique index if not exists uniq_number_ranges_org_doctype
  on public.number_ranges(organization_id, document_type_id)
  where document_type_id is not null;
