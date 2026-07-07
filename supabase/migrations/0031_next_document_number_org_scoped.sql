-- Nummernvergabe atomar UND mandantenfähig: nur den Nummernkreis der aktuellen Firma hochzählen.
create or replace function public.next_document_number(p_doc_type text)
returns text
language plpgsql security definer set search_path = public
as $function$
declare r record; y text; num text; result text;
begin
  update public.number_ranges
    set next_number = next_number + 1, updated_at = now()
    where doc_type = p_doc_type and active = true
      and organization_id = public.current_org_id()
    returning prefix, use_year, separator, min_digits, (next_number - 1) as used into r;
  if not found then raise exception 'Kein aktiver Nummernkreis für % (Firma)', p_doc_type; end if;
  y := to_char(now(), 'YYYY');
  num := lpad(r.used::text, r.min_digits, '0');
  result := r.prefix;
  if r.separator is not null and r.separator <> '' and r.prefix <> '' then
    result := result || r.separator;
  end if;
  result := result || num;
  if r.use_year then
    if r.separator is not null and r.separator <> '' then
      result := result || r.separator;
    end if;
    result := result || y;
  end if;
  return result;
end $function$;
