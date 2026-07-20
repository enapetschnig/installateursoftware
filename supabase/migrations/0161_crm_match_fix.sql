-- ============================================================
-- Installateur SuperAPP – Migration 0161
-- Fix: crm_match_* nutzten min(uuid) – existiert in Postgres nicht
-- ------------------------------------------------------------
-- Ersetzt durch array_agg(distinct …) und Auswertung der Länge:
-- genau 1 Treffer → zuordnen, sonst NULL (nie falsch zuordnen).
-- ============================================================

create or replace function public.crm_match_contact_by_email(p_email text, p_org uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  v_mail text := lower(trim(p_email));
  v_ids uuid[];
begin
  if v_org is null or v_mail is null or v_mail = '' or position('@' in v_mail) = 0 then
    return null;
  end if;

  select array_agg(distinct id) into v_ids from (
    select c.id
      from public.contacts c
     where c.organization_id = v_org
       and (lower(trim(coalesce(c.email, ''))) = v_mail
         or lower(trim(coalesce(c.invoice_email, ''))) = v_mail)
    union
    select p.contact_id as id
      from public.contact_persons p
     where p.organization_id = v_org
       and lower(trim(coalesce(p.email, ''))) = v_mail
       and p.contact_id is not null
  ) t;

  if v_ids is not null and array_length(v_ids, 1) = 1 then
    return v_ids[1];
  end if;
  return null;  -- 0 Treffer oder mehrdeutig → lieber nicht zuordnen
end $$;

create or replace function public.crm_match_contact_by_phone(p_phone text, p_org uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  v_norm text := public.crm_normalize_phone(p_phone);
  v_ids uuid[];
begin
  if v_org is null or v_norm is null or length(v_norm) < 7 then
    return null;
  end if;

  select array_agg(distinct id) into v_ids from (
    select c.id
      from public.contacts c
     where c.organization_id = v_org
       and (public.crm_normalize_phone(c.phone) = v_norm
         or public.crm_normalize_phone(c.mobile) = v_norm)
    union
    select p.contact_id as id
      from public.contact_persons p
     where p.organization_id = v_org
       and p.contact_id is not null
       and (public.crm_normalize_phone(p.phone) = v_norm
         or public.crm_normalize_phone(p.mobile) = v_norm)
  ) t;

  if v_ids is not null and array_length(v_ids, 1) = 1 then
    return v_ids[1];
  end if;
  return null;
end $$;

-- Bestandsdaten erneut nachziehen (die Version aus 0160 lief ins Leere).
update public.incoming_mails m
   set contact_id = public.crm_match_contact_by_email(m.from_email, m.organization_id)
 where m.contact_id is null;

update public.anfragen a
   set related_contact_id = coalesce(
         public.crm_match_contact_by_phone(a.caller_phone, a.organization_id),
         public.crm_match_contact_by_email(a.caller_email, a.organization_id))
 where a.related_contact_id is null;
