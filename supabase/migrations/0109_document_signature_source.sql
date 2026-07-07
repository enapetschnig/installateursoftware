-- 0109: Dokument-Signaturquelle je Dokument: company | creator | none (Default company).
-- Additiv, datenbewahrend. Pro Dokument wählbar; ersetzt die fachliche Aktivierung
-- am Mitarbeiter (employees.document_signature_active/_html bleiben als Legacy bestehen).
alter table public.offers     add column if not exists signature_source text not null default 'company';
alter table public.orders     add column if not exists signature_source text not null default 'company';
alter table public.invoices   add column if not exists signature_source text not null default 'company';
alter table public.sub_orders add column if not exists signature_source text not null default 'company';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='offers_signature_source_chk') then
    alter table public.offers add constraint offers_signature_source_chk check (signature_source in ('company','creator','none'));
  end if;
  if not exists (select 1 from pg_constraint where conname='orders_signature_source_chk') then
    alter table public.orders add constraint orders_signature_source_chk check (signature_source in ('company','creator','none'));
  end if;
  if not exists (select 1 from pg_constraint where conname='invoices_signature_source_chk') then
    alter table public.invoices add constraint invoices_signature_source_chk check (signature_source in ('company','creator','none'));
  end if;
  if not exists (select 1 from pg_constraint where conname='sub_orders_signature_source_chk') then
    alter table public.sub_orders add constraint sub_orders_signature_source_chk check (signature_source in ('company','creator','none'));
  end if;
end $$;

-- Firmen-Standardsignatur einmalig aus dem Geschäftsführer-Mitarbeiter ableiten
-- (Name + Funktion aus der Anstellung = employees.position), NUR falls noch leer.
-- Mandantenneutral (zieht den GF-Mitarbeiter), kein hartkodierter Name.
update public.company_settings cs
set document_signature_html = sub.sig
from (
  select 'Mit freundlichen Grüßen<br><br>' || e.first_name || ' ' || e.last_name ||
         coalesce('<br>' || nullif(btrim(e.position), ''), '') as sig
  from public.employees e
  where btrim(coalesce(e.position,'')) ilike 'gesch%ftsf%hrer%'
  order by e.last_name
  limit 1
) sub
where cs.id = 1
  and (cs.document_signature_html is null or btrim(cs.document_signature_html) = '');
