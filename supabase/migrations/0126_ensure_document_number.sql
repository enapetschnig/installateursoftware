-- 0126_ensure_document_number.sql
-- ------------------------------------------------------------------------------
-- Nummernvergabe erst bei Verbindlichkeit: Entwürfe verbrauchen KEINE Nummer mehr.
-- Diese RPC vergibt die fachliche Nummer ATOMAR und IDEMPOTENT genau einmal:
--   - Row-Lock (select ... for update) verhindert Doppelvergabe bei parallelem Abschluss.
--   - Hat der Beleg bereits eine Nummer (Altbestand, Korrekturversion, Re-Finalize),
--     wird KEINE neue gezogen, sondern die bestehende zurückgegeben.
--   - Org-scoped: wirkt nur auf Belege der aktuellen Organisation (current_org_id()).
-- Aufrufer (Client): beim Abschließen (Angebot/Nachtrag), Beauftragen (Auftrag),
-- ersten Statuswechsel aus Entwurf (SUB). Rechnungen nutzen weiterhin den
-- bestehenden Finalize-Flow (next_document_number direkt), können aber ebenfalls
-- über diese Funktion laufen.

create or replace function public.ensure_document_number(p_kind text, p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_num text;
  v_offer_kind text;
begin
  if v_org is null then
    raise exception 'Keine Organisation im Kontext.';
  end if;

  if p_kind = 'offer' then
    select number, kind into v_num, v_offer_kind
      from public.offers where id = p_id and organization_id = v_org for update;
    if not found then raise exception 'Angebot nicht gefunden.'; end if;
    if v_num is null or btrim(v_num) = '' then
      v_num := public.next_document_number(
        case when v_offer_kind = 'nachtrag' then 'nachtrag' else 'angebot' end);
      update public.offers set number = v_num where id = p_id;
    end if;
    return v_num;

  elsif p_kind = 'order' then
    select order_number into v_num
      from public.orders where id = p_id and organization_id = v_org for update;
    if not found then raise exception 'Auftrag nicht gefunden.'; end if;
    if v_num is null or btrim(v_num) = '' then
      v_num := public.next_document_number('auftrag');
      update public.orders set order_number = v_num where id = p_id;
    end if;
    return v_num;

  elsif p_kind = 'sub_order' then
    select sub_number into v_num
      from public.sub_orders where id = p_id and organization_id = v_org for update;
    if not found then raise exception 'Auftrag-SUB nicht gefunden.'; end if;
    if v_num is null or btrim(v_num) = '' then
      v_num := public.next_document_number('auftrag_sub');
      update public.sub_orders set sub_number = v_num where id = p_id;
    end if;
    return v_num;

  elsif p_kind = 'invoice' then
    select number into v_num
      from public.invoices where id = p_id and organization_id = v_org for update;
    if not found then raise exception 'Rechnung nicht gefunden.'; end if;
    if v_num is null or btrim(v_num) = '' then
      v_num := public.next_document_number('rechnung');
      update public.invoices set number = v_num where id = p_id;
    end if;
    return v_num;

  else
    raise exception 'Unbekannter Dokumenttyp: %', p_kind;
  end if;
end $$;

revoke all on function public.ensure_document_number(text, uuid) from public;
grant execute on function public.ensure_document_number(text, uuid) to authenticated;

notify pgrst, 'reload schema';
