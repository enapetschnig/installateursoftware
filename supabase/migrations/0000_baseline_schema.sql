-- ============================================================
-- Installateursoftware – Migration 0000: Baseline-Schema
--
-- Rekonstruiert aus der B4Y-SuperAPP-Live-DB (pqwcpgmsutpbuvdzslbc)
-- am 2026-07-07. Die alte Remote-Historie war zeitstempelbasiert;
-- die Basistabellen (projects, contacts, offers, orders, invoices,
-- company_settings, ...) existierten nur remote. Diese Datei bildet
-- den kompletten Struktur-Stand ab (OHNE Daten). Die nummerierten
-- Migrationen 0001+ laufen idempotent darüber und liefern die Seeds.
-- ============================================================
set check_function_bodies = off;

-- ---------- Extensions ----------
create extension if not exists "pg_stat_statements" with schema "extensions";
create extension if not exists "pgcrypto" with schema "extensions";
create extension if not exists "supabase_vault" with schema "vault";
create extension if not exists "uuid-ossp" with schema "extensions";

-- ---------- Funktionen ----------
CREATE OR REPLACE FUNCTION public.appointments_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.b4y_admin_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct ur.user_id)::int
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  where r.is_admin and r.active;
$function$;
CREATE OR REPLACE FUNCTION public.b4y_bump_usage(p_kind text, p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  if p_kind = 'article' then
    update public.articles set usage_count = usage_count + 1 where id = any(p_ids);
  elsif p_kind = 'service' then
    update public.services set usage_count = usage_count + 1 where id = any(p_ids);
  elsif p_kind = 'text' or p_kind = 'title' then
    update public.text_blocks set usage_count = usage_count + 1 where id = any(p_ids);
  end if;
end; $function$;
CREATE OR REPLACE FUNCTION public.b4y_calc_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (tg_op = 'DELETE') then
    insert into public.calc_audit_log(entity_type, entity_id, action, old_data)
    values (tg_argv[0], old.id, 'delete', to_jsonb(old));
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.calc_audit_log(entity_type, entity_id, action, old_data, new_data)
    values (tg_argv[0], new.id, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.calc_audit_log(entity_type, entity_id, action, new_data)
    values (tg_argv[0], new.id, 'insert', to_jsonb(new));
    return new;
  end if;
end; $function$;
CREATE OR REPLACE FUNCTION public.b4y_effective_scope(uid uuid, p_module text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.b4y_is_admin(uid) then 'all'
    else coalesce(
      (select uso.scope from public.user_scope_overrides uso
       where uso.user_id = uid and uso.module_key = p_module limit 1),
      (select max(rs.scope) from public.user_roles ur
       join public.role_scopes rs on rs.role_id = ur.role_id
       where ur.user_id = uid and rs.module_key = p_module),
      'none'
    )
  end;
$function$;
CREATE OR REPLACE FUNCTION public.b4y_guard_last_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare was_admin boolean;
begin
  if (tg_op = 'DELETE') then
    select r.is_admin and r.active into was_admin from public.roles r where r.id = old.role_id;
    if was_admin and public.b4y_admin_count() <= 1 then
      raise exception 'Letzter Admin kann nicht entfernt werden (mindestens ein Admin muss bestehen bleiben).';
    end if;
    return old;
  end if;
  return new;
end; $function$;
CREATE OR REPLACE FUNCTION public.b4y_guard_role_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (old.is_admin and old.active) and (not new.is_admin or not new.active) then
    if public.b4y_admin_count() <= 1 then
      raise exception 'Die einzige Admin-Rolle kann nicht deaktiviert oder herabgestuft werden.';
    end if;
  end if;
  return new;
end; $function$;
CREATE OR REPLACE FUNCTION public.b4y_has_perm(uid uuid, p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.b4y_has_permission(
    uid,
    left(p_key, length(p_key) - position('.' in reverse(p_key))),
    right(p_key, position('.' in reverse(p_key)) - 1)
  );
$function$;
CREATE OR REPLACE FUNCTION public.b4y_has_permission(uid uuid, p_module text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.b4y_is_admin(uid) then true
    when exists (
      select 1 from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      where ur.user_id = uid and rp.module_key = p_module
        and rp.action = p_action and rp.allowed = true
    ) then true
    else false
  end;
$function$;
CREATE OR REPLACE FUNCTION public.b4y_is_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = uid and r.is_admin and r.active
  ) or exists (
    select 1 from public.profiles p where p.id = uid and p.role in ('admin','geschaeftsfuehrer')
  );
$function$;
CREATE OR REPLACE FUNCTION public.b4y_perm_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a_email text; rec jsonb; eid uuid;
begin
  select email into a_email from public.profiles where id = auth.uid();
  if (tg_op = 'DELETE') then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  eid := coalesce(nullif(rec->>'id','')::uuid, nullif(rec->>'user_id','')::uuid);
  if (tg_op = 'DELETE') then
    insert into public.perm_audit_log(actor_email, action, entity_type, entity_id, before)
    values (a_email, tg_argv[0] || '.delete', tg_argv[0], eid, rec);
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.perm_audit_log(actor_email, action, entity_type, entity_id, before, after)
    values (a_email, tg_argv[0] || '.update', tg_argv[0], eid, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.perm_audit_log(actor_email, action, entity_type, entity_id, after)
    values (a_email, tg_argv[0] || '.insert', tg_argv[0], eid, rec);
    return new;
  end if;
end; $function$;
CREATE OR REPLACE FUNCTION public.b4y_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end; $function$;
CREATE OR REPLACE FUNCTION public.cleanup_api_rate_limit_old()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  deleted_count integer;
begin
  delete from public.api_rate_limit
   where window_start < now() - interval '24 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;
CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select organization_id from public.memberships where user_id = auth.uid() limit 1;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_doctype_compliance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.is_accounting_relevant or new.is_tax_relevant then
    new.versioning_enabled := true;
    new.versioning_required := true;
    new.finalization_required := true;
    new.lock_finalized_versions := true;
    new.create_pdf_snapshot_on_finalize := true;
    new.audit_log_enabled := true;
  elsif new.is_system then
    new.versioning_enabled := true;
    new.finalization_required := true;
    new.lock_finalized_versions := true;
    new.create_pdf_snapshot_on_finalize := true;
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.ensure_document_number(p_kind text, p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $function$;
CREATE OR REPLACE FUNCTION public.next_document_number(p_doc_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
CREATE OR REPLACE FUNCTION public.prevent_delete_system_doctype()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if OLD.is_system then
    raise exception 'Geschützter System-Dokumenttyp "%" kann nicht gelöscht werden.', OLD.slug
      using errcode = 'P0001';
  end if;
  return OLD;
end $function$;
CREATE OR REPLACE FUNCTION public.prevent_delete_system_offer_type()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if OLD.is_system then
    raise exception 'Standard-Dokumentvariante "%" kann nicht gelöscht werden.', OLD.name
      using errcode = 'P0001';
  end if;
  return OLD;
end $function$;
CREATE OR REPLACE FUNCTION public.reset_test_data(p_confirm text, p_reset_number_ranges boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_before jsonb;
begin
  if v_org is null then raise exception 'Keine Organisation im Kontext.'; end if;
  if coalesce(p_confirm, '') <> 'RESET' then
    raise exception 'BestÃ¤tigung fehlt (erwartet: RESET).';
  end if;
  -- Nur Administratoren (Rolle mit is_admin) dÃ¼rfen zurÃ¼cksetzen.
  if not exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and coalesce(r.is_admin, false) = true
  ) then
    raise exception 'Nur Administratoren dÃ¼rfen den Datenreset ausfÃ¼hren.';
  end if;

  v_before := public.reset_test_data_preview();

  -- 1) Beleg-Positionen / VerknÃ¼pfungen (Kinder zuerst; cascaden zwar, explizit = deterministisch).
  delete from public.order_items      where organization_id = v_org;
  delete from public.invoice_items    where organization_id = v_org;
  delete from public.invoice_offers   where organization_id = v_org;
  delete from public.sub_order_items  where sub_order_id in (select id from public.sub_orders where organization_id = v_org);

  -- 2) Versions-/Audit-Daten (kein FK â€“ generisch source_table/source_id; immutable RLS,
  --    security definer als Owner kommt durch).
  delete from public.document_versions  where organization_id = v_org;
  delete from public.document_audit_log where organization_id = v_org;

  -- 3) Belege / Dokumente (Reihenfolge wahrt die Beleg-Kette).
  delete from public.invoices    where organization_id = v_org;
  delete from public.sub_orders  where organization_id = v_org;
  delete from public.orders      where organization_id = v_org;
  delete from public.offers      where organization_id = v_org;
  delete from public.documents   where organization_id = v_org;

  -- 4) Projekt-Kinder. FKs mit ON DELETE SET NULL wÃ¼rden verwaiste Zeilen hinterlassen
  --    (time_entries/planning_events/automation_runs) â†’ explizit projektbezogen lÃ¶schen.
  delete from public.project_checklist_items where organization_id = v_org;
  delete from public.project_checklists      where organization_id = v_org;
  delete from public.project_appointments    where organization_id = v_org;
  delete from public.project_participants    where organization_id = v_org;
  delete from public.project_media           where organization_id = v_org;
  delete from public.project_log             where organization_id = v_org;
  delete from public.project_meetings        where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.project_signatures      where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.tasks                   where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.time_entries            where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.planning_events         where project_id in (select id from public.projects where organization_id = v_org);
  delete from public.automation_runs         where project_id in (select id from public.projects where organization_id = v_org);

  -- 5) Projekte. Kontakte + Ansprechpartner bleiben ERHALTEN (Referenzen aus
  --    gelÃ¶schten Belegen zeigen ohnehin nicht mehr auf sie; projects.contact_id
  --    verschwindet mit dem Projekt).
  delete from public.projects where organization_id = v_org;

  -- 6) Optional: Projekt- und Dokument-Nummernkreise auf 1. NUR Kontakt-Kreise bleiben,
  --    weil die Kontakte (und deren vergebene Nummern) bestehen bleiben.
  if p_reset_number_ranges then
    update public.number_ranges
      set next_number = 1, updated_at = now()
      where organization_id = v_org
        and lower(doc_type) not in ('kunde','lieferant','subunternehmer','ansprechpartner','sonstige')
        and next_number <> 1;
  end if;

  return jsonb_build_object('ok', true, 'organization_id', v_org, 'deleted', v_before,
    'number_ranges_reset', p_reset_number_ranges);
end $function$;
CREATE OR REPLACE FUNCTION public.reset_test_data_preview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Keine Organisation im Kontext.'; end if;
  return jsonb_build_object(
    'projects',         (select count(*) from public.projects         where organization_id = v_org),
    'offers',           (select count(*) from public.offers           where organization_id = v_org),
    'orders',           (select count(*) from public.orders           where organization_id = v_org),
    'sub_orders',       (select count(*) from public.sub_orders       where organization_id = v_org),
    'invoices',         (select count(*) from public.invoices         where organization_id = v_org),
    'documents',        (select count(*) from public.documents        where organization_id = v_org),
    'project_media',    (select count(*) from public.project_media    where organization_id = v_org),
    'project_log',      (select count(*) from public.project_log      where organization_id = v_org),
    'project_appointments', (select count(*) from public.project_appointments where organization_id = v_org),
    'project_meetings', (select count(*) from public.project_meetings where project_id in (select id from public.projects where organization_id = v_org)),
    'tasks',            (select count(*) from public.tasks            where project_id in (select id from public.projects where organization_id = v_org)),
    'time_entries',     (select count(*) from public.time_entries     where project_id in (select id from public.projects where organization_id = v_org)),
    'planning_events',  (select count(*) from public.planning_events  where project_id in (select id from public.projects where organization_id = v_org)),
    -- Bleibt erhalten (nur zur Anzeige, wird NICHT gelÃ¶scht):
    'kept_contacts',        (select count(*) from public.contacts        where organization_id = v_org),
    'kept_contact_persons', (select count(*) from public.contact_persons where organization_id = v_org)
  );
end $function$;
CREATE OR REPLACE FUNCTION public.tg_anfragen_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at := now();

  if new.status = 'kontakt_erstellt'
     and new.related_contact_id is not null
     and new.converted_to_contact_at is null then
    new.converted_to_contact_at := now();
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.tg_microsoft_oauth_tokens_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.tg_voice_input_templates_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.touch_microsoft_oauth_tokens_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end$function$;

-- ---------- Tabellen ----------
create table public."ai_action_logs" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "user_id" uuid,
  "user_input_summary" text,
  "tool_name" text,
  "tool_arguments_summary" text,
  "action_level" integer,
  "target_type" text,
  "target_id" text,
  "status" text,
  "confirmation_required" boolean default false,
  "confirmed_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone default now()
);
alter table only public."ai_action_logs" add constraint "ai_action_logs_pkey" PRIMARY KEY (id);
create table public."ai_logs" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid,
  "user_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "module" text,
  "context_id" text,
  "context_type" text,
  "action" text,
  "prompt" text,
  "response" text,
  "adopted" boolean default false not null
);
alter table only public."ai_logs" add constraint "ai_logs_pkey" PRIMARY KEY (id);
create table public."ai_settings" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid default current_org_id(),
  "active" boolean default true not null,
  "allowed_modules" text[] default ARRAY[]::text[] not null,
  "auto_suggestions" boolean default false not null,
  "language" text default 'de'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "provider" text default 'anthropic'::text,
  "model" text default 'claude-sonnet-4-6'::text,
  "api_key" text,
  "system_prompt" text,
  "updated_at" timestamp with time zone default now()
);
alter table only public."ai_settings" add constraint "ai_settings_pkey" PRIMARY KEY (id);
create table public."ai_usage_logs" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "user_id" uuid,
  "action_type" text not null,
  "model" text,
  "provider" text,
  "input_length" integer,
  "output_length" integer,
  "tokens_input" integer,
  "tokens_output" integer,
  "cost_estimate" numeric,
  "context_type" text,
  "route" text,
  "success" boolean default true,
  "error" text,
  "created_at" timestamp with time zone default now()
);
alter table only public."ai_usage_logs" add constraint "ai_usage_logs_pkey" PRIMARY KEY (id);
create table public."anfrage_events" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "anfrage_id" uuid not null,
  "created_by" uuid default auth.uid(),
  "event_type" text not null,
  "from_value" text,
  "to_value" text,
  "note" text,
  "payload" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
alter table only public."anfrage_events" add constraint "anfrage_events_event_type_check" CHECK ((event_type = ANY (ARRAY['created'::text, 'status_changed'::text, 'assigned'::text, 'note'::text, 'ai_classified'::text, 'contact_linked'::text, 'project_linked'::text, 'converted'::text, 'rejected'::text, 'reopened'::text, 'audio_played'::text])));
alter table only public."anfrage_events" add constraint "anfrage_events_pkey" PRIMARY KEY (id);
create table public."anfragen" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "source" text not null,
  "source_ref" text,
  "status" text default 'neu'::text not null,
  "assigned_to" uuid,
  "caller_name" text,
  "caller_phone" text,
  "caller_email" text,
  "caller_address" text,
  "subject" text,
  "description" text,
  "transcript" text,
  "audio_url" text,
  "duration_seconds" integer,
  "call_direction" text,
  "call_started_at" timestamp with time zone,
  "call_ended_at" timestamp with time zone,
  "ai_summary" text,
  "ai_classification" text,
  "ai_priority" text,
  "ai_extracted_data" jsonb default '{}'::jsonb not null,
  "related_contact_id" uuid,
  "related_project_id" uuid,
  "converted_to_contact_at" timestamp with time zone,
  "raw_payload" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."anfragen" add constraint "anfragen_ai_classification_check" CHECK (((ai_classification IS NULL) OR (ai_classification = ANY (ARRAY['interessent'::text, 'kunde_bestand'::text, 'spam'::text, 'termine_anfrage'::text, 'reklamation'::text, 'info_only'::text, 'rueckruf_gewuenscht'::text, 'fehlanruf'::text, 'sonstiges'::text]))));
alter table only public."anfragen" add constraint "anfragen_ai_priority_check" CHECK (((ai_priority IS NULL) OR (ai_priority = ANY (ARRAY['hoch'::text, 'mittel'::text, 'niedrig'::text]))));
alter table only public."anfragen" add constraint "anfragen_call_direction_check" CHECK (((call_direction IS NULL) OR (call_direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))));
alter table only public."anfragen" add constraint "anfragen_source_check" CHECK ((source = ANY (ARRAY['phone_fonio'::text, 'website_form'::text, 'email'::text, 'manual'::text, 'instagram'::text, 'facebook'::text, 'whatsapp'::text, 'other'::text])));
alter table only public."anfragen" add constraint "anfragen_status_check" CHECK ((status = ANY (ARRAY['neu'::text, 'in_arbeit'::text, 'qualifiziert'::text, 'kontakt_erstellt'::text, 'abgewiesen'::text, 'archiviert'::text])));
alter table only public."anfragen" add constraint "anfragen_pkey" PRIMARY KEY (id);
alter table only public."anfragen" add constraint "anfragen_org_source_source_ref_key" UNIQUE (organization_id, source, source_ref);
create table public."api_rate_limit" (
  "user_id" uuid not null,
  "action" text not null,
  "window_start" timestamp with time zone not null,
  "count" integer default 0 not null
);
alter table only public."api_rate_limit" add constraint "api_rate_limit_count_check" CHECK ((count >= 0));
alter table only public."api_rate_limit" add constraint "api_rate_limit_pkey" PRIMARY KEY (user_id, action, window_start);
create table public."appointments" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid default current_org_id(),
  "hero_projektnummer" text,
  "title" text not null,
  "description" text,
  "location" text,
  "start_datetime" timestamp with time zone not null,
  "end_datetime" timestamp with time zone not null,
  "all_day" boolean default false not null,
  "timezone" text default 'Europe/Vienna'::text not null,
  "is_recurring" boolean default false not null,
  "rrule" text,
  "recurrence_end_date" date,
  "recurrence_count" integer,
  "recurrence_parent_id" uuid,
  "is_exception" boolean default false not null,
  "exception_original_date" date,
  "cancelled" boolean default false not null,
  "attendees" text[],
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."appointments" add constraint "appointments_pkey" PRIMARY KEY (id);
create table public."articles" (
  "id" uuid default gen_random_uuid() not null,
  "article_number" text,
  "name" text not null,
  "description" text,
  "category" text,
  "unit" text default 'Stk'::text,
  "purchase_price" numeric default 0 not null,
  "sale_price" numeric default 0 not null,
  "supplier" text,
  "is_stock" boolean default false not null,
  "active" boolean default true not null,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "trade_id" uuid,
  "supplier_email" text,
  "list_price" numeric default 0 not null,
  "vat_rate" numeric default 20 not null,
  "image_url" text,
  "positions_nummer" text,
  "usage_count" integer default 0 not null,
  "organization_id" uuid default current_org_id(),
  "calculation_text" text
);
alter table only public."articles" add constraint "articles_pkey" PRIMARY KEY (id);
create table public."automation_runs" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "automation_id" uuid,
  "project_id" uuid,
  "trigger_stage" text,
  "status" text default 'ok'::text not null,
  "result" jsonb default '[]'::jsonb not null,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "trigger_type" text,
  "old_stage" text,
  "new_stage" text,
  "automation_name" text,
  "dry_run" boolean default false not null
);
alter table only public."automation_runs" add constraint "automation_runs_pkey" PRIMARY KEY (id);
create table public."automations" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "trigger_stage" text not null,
  "category" text,
  "actions" jsonb default '[]'::jsonb not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "description" text,
  "sort_order" integer default 0 not null,
  "updated_at" timestamp with time zone default now(),
  "trigger_type" text default 'project.status_changed'::text not null,
  "trigger_config" jsonb default '{}'::jsonb not null,
  "conditions" jsonb default '[]'::jsonb not null,
  "created_by" uuid default auth.uid(),
  "updated_by" uuid
);
alter table only public."automations" add constraint "automations_pkey" PRIMARY KEY (id);
create table public."buak_calendar" (
  "id" uuid default gen_random_uuid() not null,
  "year" integer not null,
  "week" integer not null,
  "date_from" date,
  "date_to" date,
  "week_type" text default 'neutral'::text not null,
  "soll_bau" numeric,
  "soll_maler" numeric,
  "note" text,
  "source" text,
  "updated_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "status" text default 'gespeichert'::text not null,
  "confidence" numeric,
  "source_url" text,
  "source_domain" text,
  "organization_id" uuid default current_org_id(),
  "target_hours" numeric
);
alter table only public."buak_calendar" add constraint "buak_calendar_week_type_check" CHECK ((week_type = ANY (ARRAY['kurz'::text, 'lang'::text, 'neutral'::text, 'frei'::text, 'unbekannt'::text])));
alter table only public."buak_calendar" add constraint "buak_calendar_pkey" PRIMARY KEY (id);
alter table only public."buak_calendar" add constraint "buak_calendar_year_week_key" UNIQUE (year, week);
create table public."calc_audit_log" (
  "id" uuid default gen_random_uuid() not null,
  "entity_type" text not null,
  "entity_id" uuid,
  "action" text not null,
  "changed_by" uuid default auth.uid(),
  "old_data" jsonb,
  "new_data" jsonb,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."calc_audit_log" add constraint "calc_audit_log_action_check" CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])));
alter table only public."calc_audit_log" add constraint "calc_audit_log_pkey" PRIMARY KEY (id);
create table public."catalog_items" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "category" text,
  "unit" text default 'Stk'::text,
  "unit_price" numeric default 0,
  "is_service" boolean default false,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."catalog_items" add constraint "catalog_items_pkey" PRIMARY KEY (id);
create table public."company_settings" (
  "id" integer default 1 not null,
  "name" text,
  "street" text,
  "zip" text,
  "city" text,
  "country" text,
  "fn" text,
  "fn_court" text,
  "tax_number" text,
  "uid" text,
  "ceo" text,
  "bank_name" text,
  "iban" text,
  "bic" text,
  "phone" text,
  "mobile" text,
  "email" text,
  "web" text,
  "logo_url" text,
  "updated_at" timestamp with time zone default now() not null,
  "icon_logo_url" text,
  "organization_id" uuid default current_org_id(),
  "gesellschafter" text[] default '{}'::text[] not null,
  "geschaeftsfuehrer" text[] default '{}'::text[] not null,
  "regie_material_default_mode" text default 'ask'::text not null,
  "regie_material_default_percent" numeric default 20 not null,
  "document_signature_html" text,
  "email_signature_html" text,
  "document_signature_mode" text default 'allow_employee'::text not null,
  "kalk_aufschlag_gesamt" numeric default 20 not null,
  "kalk_aufschlag_material" numeric default 30 not null,
  "kalk_stundensatz_default" numeric default 70 not null,
  "kalk_material_cap" numeric default 30 not null
);
alter table only public."company_settings" add constraint "company_settings_document_signature_mode_check" CHECK ((document_signature_mode = ANY (ARRAY['force_company'::text, 'allow_employee'::text])));
alter table only public."company_settings" add constraint "company_settings_id_check" CHECK ((id = 1));
alter table only public."company_settings" add constraint "company_settings_kalk_aufschlag_gesamt_check" CHECK (((kalk_aufschlag_gesamt >= (0)::numeric) AND (kalk_aufschlag_gesamt <= (500)::numeric)));
alter table only public."company_settings" add constraint "company_settings_kalk_aufschlag_material_check" CHECK (((kalk_aufschlag_material >= (0)::numeric) AND (kalk_aufschlag_material <= (500)::numeric)));
alter table only public."company_settings" add constraint "company_settings_kalk_material_cap_check" CHECK (((kalk_material_cap >= (0)::numeric) AND (kalk_material_cap <= (100)::numeric)));
alter table only public."company_settings" add constraint "company_settings_kalk_stundensatz_default_check" CHECK (((kalk_stundensatz_default >= (0)::numeric) AND (kalk_stundensatz_default <= (1000)::numeric)));
alter table only public."company_settings" add constraint "company_settings_pkey" PRIMARY KEY (id);
create table public."company_work_calendar_settings" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "year" integer not null,
  "work_time_model" text default 'buak_auto'::text not null,
  "short_week_hours" numeric,
  "long_week_hours" numeric,
  "fixed_weekly_hours" numeric,
  "default_daily_hours" numeric,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."company_work_calendar_settings" add constraint "company_work_calendar_settings_pkey" PRIMARY KEY (id);
alter table only public."company_work_calendar_settings" add constraint "company_work_calendar_settings_organization_id_year_key" UNIQUE (organization_id, year);
create table public."company_work_day_rules" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "year" integer not null,
  "weekday" integer not null,
  "is_working_day" boolean default true not null,
  "target_hours" numeric,
  "start_time" text,
  "end_time" text,
  "break_minutes" integer,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."company_work_day_rules" add constraint "company_work_day_rules_pkey" PRIMARY KEY (id);
alter table only public."company_work_day_rules" add constraint "company_work_day_rules_organization_id_year_weekday_key" UNIQUE (organization_id, year, weekday);
create table public."contact_persons" (
  "id" uuid default gen_random_uuid() not null,
  "contact_id" uuid not null,
  "salutation" text,
  "title" text,
  "first_name" text,
  "last_name" text,
  "function" text,
  "email" text,
  "phone" text,
  "mobile" text,
  "note" text,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "active" boolean default true not null,
  "contact_number" text
);
alter table only public."contact_persons" add constraint "contact_persons_pkey" PRIMARY KEY (id);
create table public."contacts" (
  "id" uuid default gen_random_uuid() not null,
  "type" text default 'kunde'::text not null,
  "salutation" text,
  "first_name" text,
  "last_name" text,
  "company" text,
  "email" text,
  "phone" text,
  "street" text,
  "zip" text,
  "city" text,
  "country" text default 'Österreich'::text,
  "address_form" text default 'sie'::text not null,
  "notes" text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "contact_number" text,
  "customer_type" text default 'privat'::text not null,
  "status" text default 'aktiv'::text not null,
  "title" text,
  "invoice_email" text,
  "mobile" text,
  "website" text,
  "uid_number" text,
  "address_extra" text,
  "payment_term_days" integer default 14,
  "skonto_percent" numeric,
  "skonto_days" integer,
  "is_invoice_recipient" boolean default false not null,
  "payment_method" text,
  "payment_note" text,
  "updated_at" timestamp with time zone default now() not null,
  "default_discount_percent" numeric default 0,
  "organization_id" uuid default current_org_id(),
  "in_payment_term_days" integer,
  "in_skonto_percent" numeric,
  "in_skonto_days" integer,
  "in_payment_method" text,
  "in_payment_note" text,
  "in_discount_percent" numeric,
  "default_surcharge_percent" numeric default 0 not null,
  "recipient_extra_line1" text,
  "recipient_extra_line2" text,
  "auto_accept_supplements" boolean default false not null,
  "customer_number" text
);
alter table only public."contacts" add constraint "contacts_address_form_check" CHECK ((address_form = ANY (ARRAY['du'::text, 'sie'::text])));
alter table only public."contacts" add constraint "contacts_type_check" CHECK ((type = ANY (ARRAY['kunde'::text, 'lieferant'::text, 'sonstige'::text, 'subunternehmer'::text])));
alter table only public."contacts" add constraint "contacts_pkey" PRIMARY KEY (id);
create table public."document_audit_log" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "source_table" text not null,
  "source_id" uuid not null,
  "version_no" integer,
  "action" text not null,
  "detail" text,
  "user_id" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null
);
alter table only public."document_audit_log" add constraint "document_audit_log_pkey" PRIMARY KEY (id);
create table public."document_pdf_cache" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "source_table" text not null,
  "source_id" uuid not null,
  "version_no" integer default 0 not null,
  "html_hash" text not null,
  "storage_path" text not null,
  "generated_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."document_pdf_cache" add constraint "document_pdf_cache_pkey" PRIMARY KEY (id);
alter table only public."document_pdf_cache" add constraint "document_pdf_cache_source_table_source_id_version_no_key" UNIQUE (source_table, source_id, version_no);
create table public."document_subtypes" (
  "id" uuid default gen_random_uuid() not null,
  "document_type_id" uuid not null,
  "name" text not null,
  "slug" text not null,
  "sort_order" integer default 0 not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."document_subtypes" add constraint "document_subtypes_pkey" PRIMARY KEY (id);
create table public."document_templates" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "doc_type" text default 'angebot'::text not null,
  "description" text,
  "items" jsonb default '[]'::jsonb not null,
  "usage_count" integer default 0 not null,
  "active" boolean default true not null,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "category" text default 'Standard'::text not null
);
alter table only public."document_templates" add constraint "document_templates_pkey" PRIMARY KEY (id);
create table public."document_type_transitions" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "offer_type_id" uuid not null,
  "order_label" text,
  "order_intro_text" text,
  "order_closing_text" text,
  "invoice_label" text,
  "invoice_intro_text" text,
  "invoice_closing_text" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "nachtrag_label" text,
  "nachtrag_intro_text" text,
  "nachtrag_closing_text" text,
  "sub_order_label" text,
  "sub_order_intro_text" text,
  "sub_order_closing_text" text
);
alter table only public."document_type_transitions" add constraint "document_type_transitions_pkey" PRIMARY KEY (id);
alter table only public."document_type_transitions" add constraint "document_type_transitions_organization_id_offer_type_id_key" UNIQUE (organization_id, offer_type_id);
create table public."document_types" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "slug" text not null,
  "category" text,
  "sort_order" integer default 0 not null,
  "icon" text,
  "is_active" boolean default true not null,
  "allow_upload" boolean default true not null,
  "allow_create" boolean default false not null,
  "belongs_to_project" boolean default true not null,
  "belongs_to_customer" boolean default false not null,
  "belongs_to_employee" boolean default false not null,
  "belongs_to_supplier" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "belongs_to_subcontractor" boolean default false not null,
  "organization_id" uuid default current_org_id(),
  "is_accounting_relevant" boolean default false not null,
  "is_tax_relevant" boolean default false not null,
  "versioning_enabled" boolean default false not null,
  "versioning_required" boolean default false not null,
  "finalization_required" boolean default false not null,
  "lock_finalized_versions" boolean default false not null,
  "create_pdf_snapshot_on_finalize" boolean default false not null,
  "audit_log_enabled" boolean default false not null,
  "is_system" boolean default false not null,
  "document_structure" text default 'upload_only'::text not null
);
alter table only public."document_types" add constraint "document_types_structure_check" CHECK ((document_structure = ANY (ARRAY['positions'::text, 'text'::text, 'form'::text, 'upload_only'::text])));
alter table only public."document_types" add constraint "document_types_pkey" PRIMARY KEY (id);
alter table only public."document_types" add constraint "document_types_slug_key" UNIQUE (slug);
create table public."document_versions" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "source_table" text not null,
  "source_id" uuid not null,
  "version_no" integer not null,
  "status" text,
  "title" text,
  "doc_number" text,
  "data" jsonb,
  "summary" jsonb,
  "print_html" text,
  "created_by" uuid default auth.uid(),
  "finalized_at" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now() not null
);
alter table only public."document_versions" add constraint "document_versions_pkey" PRIMARY KEY (id);
alter table only public."document_versions" add constraint "document_versions_source_table_source_id_version_no_key" UNIQUE (source_table, source_id, version_no);
create table public."documents" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid,
  "customer_id" uuid,
  "document_type_id" uuid,
  "document_number" text,
  "title" text,
  "subject" text,
  "status" text default 'erhalten'::text not null,
  "source_type" text default 'uploaded_file'::text not null,
  "file_url" text,
  "file_name" text,
  "file_mime_type" text,
  "file_size" bigint,
  "sender" text,
  "recipient" text,
  "version" text,
  "doc_date" date,
  "note" text,
  "created_by" uuid default auth.uid(),
  "uploaded_by" uuid,
  "sent_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  "archived_by" uuid,
  "body_html" text,
  "print_html_snapshot" text
);
alter table only public."documents" add constraint "documents_pkey" PRIMARY KEY (id);
create table public."employees" (
  "id" uuid default gen_random_uuid() not null,
  "auth_user_id" uuid,
  "salutation" text,
  "title" text,
  "first_name" text not null,
  "last_name" text not null,
  "birth_date" date,
  "email" text not null,
  "phone" text,
  "mobile" text,
  "street" text,
  "address_extra" text,
  "zip" text,
  "city" text,
  "country" text default 'Österreich'::text not null,
  "photo_url" text,
  "notes_internal" text,
  "active" boolean default true not null,
  "entry_date" date,
  "exit_date" date,
  "employment_type" text,
  "position" text,
  "weekly_hours" numeric,
  "vacation_days_per_year" numeric,
  "probation_until" date,
  "notice_period" text,
  "supervisor_id" uuid,
  "personnel_number" text,
  "work_state" text default 'Wien'::text,
  "worktime_model" text,
  "wage_group" text,
  "collective_agreement" text,
  "hourly_wage_gross" numeric,
  "monthly_wage_gross" numeric,
  "overtime_rate" numeric,
  "surcharges" text,
  "wage_valid_from" date,
  "wage_note" text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "normal_weekly_hours" numeric,
  "trade_kv" text,
  "hours_short_week" numeric,
  "hours_long_week" numeric,
  "week_rhythm" text,
  "worktime_valid_from" date,
  "wage_category" text,
  "signature_active" boolean default false not null,
  "signature_html" text,
  "ssn" text,
  "citizenship" text,
  "birth_place" text,
  "marital_status" text,
  "commuter_allowance" boolean default false not null,
  "sole_earner" text,
  "tax_note" text,
  "account_holder" text,
  "iban" text,
  "bic" text,
  "bank_name" text,
  "bank_note" text,
  "week_short" jsonb default '{}'::jsonb not null,
  "week_long" jsonb default '{}'::jsonb not null,
  "organization_id" uuid default current_org_id(),
  "work_time_model_id" uuid,
  "document_signature_html" text,
  "document_signature_active" boolean default false not null
);
alter table only public."employees" add constraint "employees_employment_type_check" CHECK ((employment_type = ANY (ARRAY['vollzeit'::text, 'teilzeit'::text, 'geringfuegig'::text, 'freier_dienstnehmer'::text, 'praktikant'::text])));
alter table only public."employees" add constraint "employees_work_state_check" CHECK ((work_state = ANY (ARRAY['Burgenland'::text, 'Kärnten'::text, 'Niederösterreich'::text, 'Oberösterreich'::text, 'Salzburg'::text, 'Steiermark'::text, 'Tirol'::text, 'Vorarlberg'::text, 'Wien'::text])));
alter table only public."employees" add constraint "employees_pkey" PRIMARY KEY (id);
create table public."hourly_rates" (
  "id" uuid default gen_random_uuid() not null,
  "trade_id" uuid,
  "label" text not null,
  "internal_rate" numeric default 0 not null,
  "sale_rate" numeric default 0 not null,
  "valid_from" date,
  "valid_to" date,
  "active" boolean default true not null,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."hourly_rates" add constraint "hourly_rates_pkey" PRIMARY KEY (id);
create table public."invoice_items" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_id" uuid not null,
  "pos_no" text,
  "service_number" text,
  "short_text" text,
  "long_text" text,
  "qty" numeric default 1 not null,
  "unit" text,
  "unit_price" numeric default 0 not null,
  "discount_percent" numeric default 0 not null,
  "vat_rate" numeric default 20 not null,
  "net" numeric default 0 not null,
  "gross" numeric default 0 not null,
  "source_order_id" uuid,
  "source_order_item_id" uuid,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."invoice_items" add constraint "invoice_items_pkey" PRIMARY KEY (id);
create table public."invoice_offers" (
  "invoice_id" uuid not null,
  "offer_id" uuid not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."invoice_offers" add constraint "invoice_offers_pkey" PRIMARY KEY (invoice_id, offer_id);
create table public."invoices" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid,
  "contact_id" uuid,
  "number" text,
  "invoice_type" text default 'standard'::text not null,
  "invoice_kind" text default 'schluss'::text not null,
  "with_skonto" boolean default false,
  "skonto_percent" numeric default 0,
  "payment_status" text default 'offen'::text not null,
  "doc_status" text default 'entwurf'::text not null,
  "items" jsonb default '[]'::jsonb not null,
  "net" numeric default 0,
  "vat" numeric default 0,
  "gross" numeric default 0,
  "invoice_date" date default CURRENT_DATE,
  "due_date" date,
  "paid_at" date,
  "notes" text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "order_ids" uuid[] default '{}'::uuid[] not null,
  "offer_ids" uuid[] default '{}'::uuid[] not null,
  "title" text,
  "service_period" text,
  "person_id" uuid,
  "discount_percent" numeric default 0,
  "snapshot" jsonb,
  "storno_of" uuid,
  "locked" boolean default false not null,
  "updated_at" timestamp with time zone default now() not null,
  "payment_term_days" integer default 30,
  "organization_id" uuid default current_org_id(),
  "offer_type_id" uuid,
  "pdf_label" text,
  "doc_intro_text" text,
  "doc_closing_text" text,
  "display_settings_snapshot" jsonb,
  "pre_positions_text" text,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "conditions_snapshot" jsonb,
  "working_base_version_no" integer,
  "recipient_override" jsonb,
  "vat_mode" text default 'standard'::text not null,
  "signature_source" text default 'company'::text not null
);
alter table only public."invoices" add constraint "invoices_doc_status_check" CHECK ((doc_status = ANY (ARRAY['entwurf'::text, 'finalisiert'::text, 'versendet'::text, 'bezahlt'::text, 'storniert'::text])));
alter table only public."invoices" add constraint "invoices_invoice_kind_check" CHECK ((invoice_kind = ANY (ARRAY['abschlag'::text, 'teilrechnung'::text, 'schluss'::text, 'einzel'::text])));
alter table only public."invoices" add constraint "invoices_invoice_type_check" CHECK ((invoice_type = ANY (ARRAY['standard'::text, 'pauschal'::text, 'par19_bauleistung'::text, 'gutschrift'::text, 'storno'::text])));
alter table only public."invoices" add constraint "invoices_payment_status_check" CHECK ((payment_status = ANY (ARRAY['offen'::text, 'teilzahlung'::text, 'bezahlt'::text, 'ueberfaellig'::text, 'storniert'::text])));
alter table only public."invoices" add constraint "invoices_signature_source_chk" CHECK ((signature_source = ANY (ARRAY['company'::text, 'creator'::text, 'none'::text])));
alter table only public."invoices" add constraint "invoices_vat_mode_check" CHECK ((vat_mode = ANY (ARRAY['standard'::text, 'par19'::text])));
alter table only public."invoices" add constraint "invoices_pkey" PRIMARY KEY (id);
create table public."mail_templates" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "context" text default 'allgemein'::text not null,
  "subject" text default ''::text not null,
  "body_html" text default ''::text not null,
  "description" text,
  "sort_order" integer default 0 not null,
  "usage_count" integer default 0 not null,
  "active" boolean default true not null,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "document_type_slug" text,
  "document_type_id" uuid,
  "doc_variant" text,
  "trigger_action" text,
  "category" text,
  "is_default" boolean default false not null
);
alter table only public."mail_templates" add constraint "mail_templates_context_check" CHECK ((context = ANY (ARRAY['kunde'::text, 'projekt'::text, 'angebot'::text, 'auftrag'::text, 'rechnung'::text, 'mahnung'::text, 'subunternehmer'::text, 'lieferant'::text, 'allgemein'::text, 'dokument'::text, 'termin'::text])));
alter table only public."mail_templates" add constraint "mail_templates_pkey" PRIMARY KEY (id);
create table public."media_categories" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "description" text,
  "applies_to_photos" boolean default true not null,
  "applies_to_videos" boolean default true not null,
  "is_default" boolean default false not null,
  "is_active" boolean default true not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."media_categories" add constraint "media_categories_pkey" PRIMARY KEY (id);
create table public."memberships" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "organization_id" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
alter table only public."memberships" add constraint "memberships_pkey" PRIMARY KEY (id);
alter table only public."memberships" add constraint "memberships_user_id_organization_id_key" UNIQUE (user_id, organization_id);
create table public."microsoft_mail_audit_log" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "user_id" uuid,
  "action" text not null,
  "recipient_to" text[],
  "recipient_cc" text[],
  "recipient_bcc" text[],
  "subject" text,
  "body_preview" text,
  "attachment_count" integer default 0 not null,
  "microsoft_message_id" text,
  "related_offer_id" uuid,
  "related_order_id" uuid,
  "related_invoice_id" uuid,
  "error_message" text,
  "duration_ms" integer,
  "sent_at" timestamp with time zone default now() not null
);
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_action_check" CHECK ((action = ANY (ARRAY['sent'::text, 'failed'::text, 'reply'::text, 'forward'::text])));
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_attachment_count_check" CHECK ((attachment_count >= 0));
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_body_preview_check" CHECK (((body_preview IS NULL) OR (length(body_preview) <= 500)));
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_duration_ms_check" CHECK (((duration_ms IS NULL) OR (duration_ms >= 0)));
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_pkey" PRIMARY KEY (id);
create table public."microsoft_oauth_tokens" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "user_id" uuid not null,
  "microsoft_user_id" text not null,
  "microsoft_tenant_id" text not null,
  "access_token_enc" text not null,
  "refresh_token_enc" text,
  "kek_version" smallint default 1 not null,
  "expires_at" timestamp with time zone not null,
  "refresh_expires_at" timestamp with time zone,
  "scopes" text[] default '{}'::text[] not null,
  "last_refreshed_at" timestamp with time zone,
  "error_count" integer default 0 not null,
  "last_error_message" text,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."microsoft_oauth_tokens" add constraint "microsoft_oauth_tokens_error_count_check" CHECK ((error_count >= 0));
alter table only public."microsoft_oauth_tokens" add constraint "microsoft_oauth_tokens_kek_version_check" CHECK (((kek_version > 0) AND (kek_version < 100)));
alter table only public."microsoft_oauth_tokens" add constraint "microsoft_oauth_tokens_pkey" PRIMARY KEY (id);
alter table only public."microsoft_oauth_tokens" add constraint "microsoft_oauth_tokens_organization_id_user_id_key" UNIQUE (organization_id, user_id);
create table public."number_ranges" (
  "id" uuid default gen_random_uuid() not null,
  "doc_type" text not null,
  "label" text not null,
  "prefix" text default ''::text not null,
  "use_year" boolean default true not null,
  "separator" text default '-'::text not null,
  "min_digits" integer default 4 not null,
  "next_number" integer default 1 not null,
  "active" boolean default true not null,
  "protected" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "document_type_id" uuid
);
alter table only public."number_ranges" add constraint "number_ranges_pkey" PRIMARY KEY (id);
create table public."offer_display_settings" (
  "id" integer default 1 not null,
  "default_is_lump_sum" boolean default false not null,
  "default_show_unit_prices" boolean default true not null,
  "default_show_position_totals" boolean default true not null,
  "default_show_subtotals" boolean default true not null,
  "default_show_only_grand_total" boolean default false not null,
  "default_show_images" boolean default false not null,
  "default_show_service_images" boolean default false not null,
  "default_show_article_images" boolean default false not null,
  "default_show_articles_inside_services" boolean default false not null,
  "default_show_vat" boolean default true not null,
  "default_group_titles" boolean default false not null,
  "default_show_title_sums" boolean default true not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "default_show_quantities" boolean default true not null,
  "default_show_long_texts" boolean default true not null,
  "default_show_discount" boolean default true not null
);
alter table only public."offer_display_settings" add constraint "offer_display_settings_id_check" CHECK ((id = 1));
alter table only public."offer_display_settings" add constraint "offer_display_settings_pkey" PRIMARY KEY (id);
create table public."offer_types" (
  "id" uuid default gen_random_uuid() not null,
  "company_id" uuid,
  "name" text not null,
  "slug" text not null,
  "description" text,
  "pdf_label" text default 'Angebot'::text not null,
  "intro_text" text,
  "closing_text" text,
  "default_is_lump_sum" boolean default false not null,
  "default_show_unit_prices" boolean default true not null,
  "default_show_position_totals" boolean default true not null,
  "default_show_subtotals" boolean default true not null,
  "default_show_only_grand_total" boolean default false not null,
  "default_show_images" boolean default false not null,
  "default_show_service_images" boolean default false not null,
  "default_show_article_images" boolean default false not null,
  "default_show_articles_inside_services" boolean default false not null,
  "default_show_vat" boolean default true not null,
  "default_group_titles" boolean default false not null,
  "default_show_title_sums" boolean default true not null,
  "is_active" boolean default true not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "default_show_quantities" boolean default true not null,
  "default_show_long_texts" boolean default true not null,
  "default_show_discount" boolean default true not null,
  "footer_text" text,
  "show_page_numbers" boolean default true not null,
  "is_system" boolean default false not null
);
alter table only public."offer_types" add constraint "offer_types_pkey" PRIMARY KEY (id);
create table public."offers" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid,
  "contact_id" uuid,
  "number" text,
  "title" text,
  "status" text default 'entwurf'::text not null,
  "items" jsonb default '[]'::jsonb not null,
  "net" numeric default 0,
  "vat" numeric default 0,
  "gross" numeric default 0,
  "notes" text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "closed_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "sent_by" uuid,
  "use_global_display" boolean default true not null,
  "display" jsonb,
  "offer_type_id" uuid,
  "offer_intro_text" text,
  "offer_closing_text" text,
  "display_settings_snapshot" jsonb,
  "organization_id" uuid default current_org_id(),
  "pre_positions_text" text,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "kind" text default 'angebot'::text not null,
  "related_order_id" uuid,
  "texts_initialized" boolean default false not null,
  "conditions_snapshot" jsonb,
  "working_base_version_no" integer,
  "recipient_override" jsonb,
  "vat_mode" text default 'standard'::text not null,
  "signature_source" text default 'company'::text not null
);
alter table only public."offers" add constraint "offers_signature_source_chk" CHECK ((signature_source = ANY (ARRAY['company'::text, 'creator'::text, 'none'::text])));
alter table only public."offers" add constraint "offers_status_check" CHECK ((status = ANY (ARRAY['entwurf'::text, 'abgeschlossen'::text, 'versendet'::text, 'angenommen'::text, 'abgelehnt'::text, 'storniert'::text, 'in_auftrag_uebernommen'::text])));
alter table only public."offers" add constraint "offers_vat_mode_check" CHECK ((vat_mode = ANY (ARRAY['standard'::text, 'par19'::text])));
alter table only public."offers" add constraint "offers_pkey" PRIMARY KEY (id);
create table public."order_items" (
  "id" uuid default gen_random_uuid() not null,
  "order_id" uuid not null,
  "pos_no" text,
  "service_number" text,
  "short_text" text,
  "long_text" text,
  "qty" numeric default 1 not null,
  "unit" text,
  "unit_price" numeric default 0 not null,
  "discount_percent" numeric default 0 not null,
  "vat_rate" numeric default 20 not null,
  "net" numeric default 0 not null,
  "gross" numeric default 0 not null,
  "source_offer_id" uuid,
  "source_offer_item_id" text,
  "invoiced_qty" numeric default 0 not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "is_supplement" boolean default false not null,
  "source_supplement_offer_id" uuid,
  "source_supplement_item_id" uuid
);
alter table only public."order_items" add constraint "order_items_pkey" PRIMARY KEY (id);
create table public."orders" (
  "id" uuid default gen_random_uuid() not null,
  "order_number" text,
  "order_date" date default CURRENT_DATE not null,
  "title" text,
  "project_id" uuid,
  "contact_id" uuid,
  "person_id" uuid,
  "offer_ids" uuid[] default '{}'::uuid[] not null,
  "service_period" text,
  "payment_term_days" integer,
  "discount_percent" numeric default 0,
  "internal_note" text,
  "status" text default 'entwurf'::text not null,
  "invoice_status" text default 'offen'::text not null,
  "net" numeric default 0 not null,
  "vat" numeric default 0 not null,
  "gross" numeric default 0 not null,
  "snapshot" jsonb,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "items" jsonb default '[]'::jsonb not null,
  "organization_id" uuid default current_org_id(),
  "offer_type_id" uuid,
  "pdf_label" text,
  "doc_intro_text" text,
  "doc_closing_text" text,
  "display_settings_snapshot" jsonb,
  "pre_positions_text" text,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "conditions_snapshot" jsonb,
  "working_base_version_no" integer,
  "recipient_override" jsonb,
  "vat_mode" text default 'standard'::text not null,
  "signature_source" text default 'company'::text not null
);
alter table only public."orders" add constraint "orders_signature_source_chk" CHECK ((signature_source = ANY (ARRAY['company'::text, 'creator'::text, 'none'::text])));
alter table only public."orders" add constraint "orders_vat_mode_check" CHECK ((vat_mode = ANY (ARRAY['standard'::text, 'par19'::text])));
alter table only public."orders" add constraint "orders_pkey" PRIMARY KEY (id);
alter table only public."orders" add constraint "orders_order_number_key" UNIQUE (order_number);
create table public."organizations" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "slug" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."organizations" add constraint "organizations_pkey" PRIMARY KEY (id);
alter table only public."organizations" add constraint "organizations_slug_key" UNIQUE (slug);
create table public."perm_audit_log" (
  "id" uuid default gen_random_uuid() not null,
  "actor_id" uuid default auth.uid(),
  "actor_email" text,
  "action" text not null,
  "entity_type" text,
  "entity_id" uuid,
  "entity_label" text,
  "before" jsonb,
  "after" jsonb,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."perm_audit_log" add constraint "perm_audit_log_pkey" PRIMARY KEY (id);
create table public."permission_groups" (
  "id" uuid default gen_random_uuid() not null,
  "key" text not null,
  "label" text not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);
alter table only public."permission_groups" add constraint "permission_groups_pkey" PRIMARY KEY (id);
alter table only public."permission_groups" add constraint "permission_groups_key_key" UNIQUE (key);
create table public."permission_modules" (
  "id" uuid default gen_random_uuid() not null,
  "key" text not null,
  "label" text not null,
  "group_key" text,
  "parent_key" text,
  "supports_scope" boolean default false not null,
  "actions" text[] default ARRAY['view'::text, 'create'::text, 'edit'::text, 'delete'::text, 'archive'::text, 'export'::text, 'print'::text, 'share'::text] not null,
  "is_system" boolean default true not null,
  "active" boolean default true not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);
alter table only public."permission_modules" add constraint "permission_modules_pkey" PRIMARY KEY (id);
alter table only public."permission_modules" add constraint "permission_modules_key_key" UNIQUE (key);
create table public."planning_absences" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "employee_id" uuid,
  "kind" text default 'urlaub'::text not null,
  "start_date" date not null,
  "end_date" date not null,
  "all_day" boolean default true,
  "status" text default 'bestaetigt'::text,
  "color" text default '#ef4444'::text,
  "note" text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now()
);
alter table only public."planning_absences" add constraint "planning_absences_pkey" PRIMARY KEY (id);
create table public."planning_categories" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "name" text not null,
  "slug" text,
  "color" text default '#64748b'::text,
  "sort_order" integer default 0,
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now()
);
alter table only public."planning_categories" add constraint "planning_categories_pkey" PRIMARY KEY (id);
create table public."planning_event_employees" (
  "event_id" uuid not null,
  "employee_id" uuid not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."planning_event_employees" add constraint "planning_event_employees_pkey" PRIMARY KEY (event_id, employee_id);
create table public."planning_event_resources" (
  "event_id" uuid not null,
  "resource_id" uuid not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."planning_event_resources" add constraint "planning_event_resources_pkey" PRIMARY KEY (event_id, resource_id);
create table public."planning_event_types" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "name" text not null,
  "slug" text,
  "color" text default '#0ea5e9'::text,
  "default_duration_min" integer default 60,
  "is_absence" boolean default false,
  "sort_order" integer default 0,
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now()
);
alter table only public."planning_event_types" add constraint "planning_event_types_pkey" PRIMARY KEY (id);
create table public."planning_events" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "title" text default ''::text not null,
  "event_type_id" uuid,
  "category_id" uuid,
  "status" text default 'geplant'::text not null,
  "priority" text default 'normal'::text,
  "color" text,
  "start_at" timestamp with time zone not null,
  "end_at" timestamp with time zone not null,
  "all_day" boolean default false,
  "project_id" uuid,
  "contact_id" uuid,
  "location" text,
  "description" text,
  "visibility" text default 'intern'::text,
  "recurrence" jsonb,
  "reminder" jsonb,
  "external_ref" jsonb,
  "done_at" timestamp with time zone,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
alter table only public."planning_events" add constraint "planning_events_pkey" PRIMARY KEY (id);
create table public."planning_resource_types" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "name" text not null,
  "slug" text,
  "icon" text,
  "sort_order" integer default 0,
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now()
);
alter table only public."planning_resource_types" add constraint "planning_resource_types_pkey" PRIMARY KEY (id);
create table public."planning_resources" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "name" text not null,
  "resource_type_id" uuid,
  "category_id" uuid,
  "employee_id" uuid,
  "color" text default '#64748b'::text,
  "description" text,
  "availability" jsonb,
  "is_active" boolean default true,
  "sort_order" integer default 0,
  "created_at" timestamp with time zone default now()
);
alter table only public."planning_resources" add constraint "planning_resources_pkey" PRIMARY KEY (id);
create table public."profiles" (
  "id" uuid not null,
  "email" text,
  "name" text,
  "role" text default 'mitarbeiter'::text not null,
  "position" text,
  "phone" text,
  "signature" text,
  "created_at" timestamp with time zone default now() not null
);
alter table only public."profiles" add constraint "profiles_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'bauleiter'::text, 'buero'::text, 'mitarbeiter'::text])));
alter table only public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);
create table public."project_appointments" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "title" text,
  "kind" text,
  "date" date,
  "time" text,
  "location" text,
  "participants" text,
  "description" text,
  "reminder" boolean default false not null,
  "status" text default 'geplant'::text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."project_appointments" add constraint "project_appointments_pkey" PRIMARY KEY (id);
create table public."project_checklist_items" (
  "id" uuid default gen_random_uuid() not null,
  "checklist_id" uuid not null,
  "label" text not null,
  "done" boolean default false not null,
  "responsible" text,
  "due_date" date,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."project_checklist_items" add constraint "project_checklist_items_pkey" PRIMARY KEY (id);
create table public."project_checklists" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "name" text not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."project_checklists" add constraint "project_checklists_pkey" PRIMARY KEY (id);
create table public."project_log" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid,
  "entry" text not null,
  "kind" text default 'note'::text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "offer_id" uuid
);
alter table only public."project_log" add constraint "project_log_pkey" PRIMARY KEY (id);
create table public."project_media" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid,
  "file_name" text,
  "file_type" text,
  "file_size" bigint,
  "file_url" text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "description" text,
  "category" text,
  "archived" boolean default false not null,
  "thumbnail_url" text,
  "mime_type" text,
  "media_type" text default 'photo'::text not null,
  "category_id" uuid,
  "title" text,
  "taken_at" timestamp with time zone,
  "source" text default 'upload'::text not null,
  "sort_order" integer default 0 not null,
  "is_favorite" boolean default false not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."project_media" add constraint "project_media_media_type_check" CHECK ((media_type = ANY (ARRAY['photo'::text, 'video'::text])));
alter table only public."project_media" add constraint "project_media_source_check" CHECK ((source = ANY (ARRAY['upload'::text, 'camera'::text, 'mobile_camera'::text, 'ipad_camera'::text])));
alter table only public."project_media" add constraint "project_media_pkey" PRIMARY KEY (id);
create table public."project_meeting_items" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "meeting_id" uuid not null,
  "kind" text default 'agenda'::text not null,
  "text" text default ''::text not null,
  "status" text,
  "sort_order" integer default 0,
  "created_at" timestamp with time zone default now()
);
alter table only public."project_meeting_items" add constraint "project_meeting_items_pkey" PRIMARY KEY (id);
create table public."project_meeting_participants" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "meeting_id" uuid not null,
  "participant_id" uuid,
  "contact_id" uuid,
  "person_id" uuid,
  "role" text default 'sonstige'::text,
  "name" text default ''::text not null,
  "company" text,
  "email" text,
  "present" boolean default true,
  "sort_order" integer default 0,
  "created_at" timestamp with time zone default now()
);
alter table only public."project_meeting_participants" add constraint "project_meeting_participants_pkey" PRIMARY KEY (id);
create table public."project_meetings" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "project_id" uuid not null,
  "meeting_number" text,
  "title" text default ''::text not null,
  "meeting_date" date default CURRENT_DATE not null,
  "time_from" text,
  "time_to" text,
  "location" text,
  "status" text default 'entwurf'::text not null,
  "notes" text,
  "next_meeting_date" date,
  "planning_event_id" uuid,
  "finalized_at" timestamp with time zone,
  "finalized_by" uuid,
  "created_by" uuid default auth.uid(),
  "updated_by" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid
);
alter table only public."project_meetings" add constraint "project_meetings_pkey" PRIMARY KEY (id);
create table public."project_participants" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "contact_id" uuid,
  "person_id" uuid,
  "role" text,
  "name" text,
  "email" text,
  "phone" text,
  "note" text,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."project_participants" add constraint "project_participants_pkey" PRIMARY KEY (id);
create table public."project_signatures" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "project_id" uuid not null,
  "meeting_id" uuid,
  "planning_event_id" uuid,
  "document_ref" uuid,
  "order_sub_ref" text,
  "contact_id" uuid,
  "person_id" uuid,
  "participant_id" uuid,
  "purpose" text default 'protokoll'::text,
  "signer_name" text default ''::text not null,
  "signer_company" text,
  "signer_role" text,
  "signed_at" timestamp with time zone default now(),
  "location" text,
  "signature_data" text,
  "note" text,
  "captured_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now(),
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid
);
alter table only public."project_signatures" add constraint "project_signatures_pkey" PRIMARY KEY (id);
create table public."project_statuses" (
  "id" uuid default gen_random_uuid() not null,
  "project_type_id" uuid not null,
  "label" text not null,
  "sort_order" integer default 0 not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."project_statuses" add constraint "project_statuses_pkey" PRIMARY KEY (id);
create table public."project_statuses_global" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "label" text not null,
  "color" text,
  "sort_order" integer default 0 not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."project_statuses_global" add constraint "project_statuses_global_pkey" PRIMARY KEY (id);
alter table only public."project_statuses_global" add constraint "project_statuses_global_organization_id_label_key" UNIQUE (organization_id, label);
create table public."project_type_statuses" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "project_type_id" uuid not null,
  "status_id" uuid not null,
  "sort_order" integer default 0 not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
alter table only public."project_type_statuses" add constraint "project_type_statuses_pkey" PRIMARY KEY (id);
alter table only public."project_type_statuses" add constraint "project_type_statuses_organization_id_project_type_id_statu_key" UNIQUE (organization_id, project_type_id, status_id);
create table public."project_types" (
  "id" uuid default gen_random_uuid() not null,
  "label" text not null,
  "slug" text not null,
  "category" text not null,
  "sort_order" integer default 0 not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."project_types" add constraint "project_types_pkey" PRIMARY KEY (id);
alter table only public."project_types" add constraint "project_types_slug_key" UNIQUE (slug);
create table public."projects" (
  "id" uuid default gen_random_uuid() not null,
  "project_number" text,
  "title" text not null,
  "category" text,
  "stage" text default 'Neu – Erstkontakt'::text not null,
  "contact_id" uuid,
  "street" text,
  "zip" text,
  "city" text,
  "description" text,
  "budget" numeric,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "gewerk" text,
  "responsible" text,
  "country" text default 'Österreich'::text,
  "address_extra" text,
  "start_date" date,
  "end_date" date,
  "priority" text,
  "reminder_date" date,
  "reminder_text" text,
  "reminder_done" boolean default false not null,
  "internal_note" text,
  "archived" boolean default false not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "start_at" timestamp with time zone
);
alter table only public."projects" add constraint "projects_pkey" PRIMARY KEY (id);
create table public."role_permissions" (
  "id" uuid default gen_random_uuid() not null,
  "role_id" uuid not null,
  "module_key" text not null,
  "action" text not null,
  "allowed" boolean default false not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."role_permissions" add constraint "role_permissions_pkey" PRIMARY KEY (id);
alter table only public."role_permissions" add constraint "role_permissions_role_id_module_key_action_key" UNIQUE (role_id, module_key, action);
create table public."role_scopes" (
  "id" uuid default gen_random_uuid() not null,
  "role_id" uuid not null,
  "module_key" text not null,
  "scope" text default 'none'::text not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."role_scopes" add constraint "role_scopes_scope_check" CHECK ((scope = ANY (ARRAY['none'::text, 'own'::text, 'assigned'::text, 'department'::text, 'all'::text])));
alter table only public."role_scopes" add constraint "role_scopes_pkey" PRIMARY KEY (id);
alter table only public."role_scopes" add constraint "role_scopes_role_id_module_key_key" UNIQUE (role_id, module_key);
create table public."roles" (
  "id" uuid default gen_random_uuid() not null,
  "key" text,
  "name" text not null,
  "description" text,
  "is_system" boolean default false not null,
  "is_admin" boolean default false not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone,
  "organization_id" uuid default current_org_id(),
  "see_archived" boolean default false not null,
  "see_deleted" boolean default false not null,
  "restore_deleted" boolean default false not null,
  "default_project_scope" text default 'own'::text not null
);
alter table only public."roles" add constraint "roles_default_project_scope_chk" CHECK ((default_project_scope = ANY (ARRAY['none'::text, 'own'::text, 'assigned'::text, 'department'::text, 'all'::text])));
alter table only public."roles" add constraint "roles_pkey" PRIMARY KEY (id);
alter table only public."roles" add constraint "roles_key_key" UNIQUE (key);
create table public."service_components" (
  "id" uuid default gen_random_uuid() not null,
  "service_id" uuid not null,
  "kind" text default 'material'::text not null,
  "sort_order" integer default 0 not null,
  "label" text,
  "hourly_rate_id" uuid,
  "article_id" uuid,
  "minutes" numeric default 0 not null,
  "quantity" numeric default 0 not null,
  "unit" text,
  "cost_rate" numeric default 0 not null,
  "sale_rate" numeric default 0 not null,
  "percent" numeric default 0 not null,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."service_components" add constraint "service_components_kind_check" CHECK ((kind = ANY (ARRAY['arbeitszeit'::text, 'material'::text, 'maschine'::text, 'subunternehmer'::text, 'gemeinkosten'::text, 'individuell'::text])));
alter table only public."service_components" add constraint "service_components_pkey" PRIMARY KEY (id);
create table public."services" (
  "id" uuid default gen_random_uuid() not null,
  "service_number" text,
  "name" text not null,
  "short_text" text,
  "long_text" text,
  "trade_id" uuid,
  "unit" text default 'Stk'::text,
  "overhead_percent" numeric default 0 not null,
  "active" boolean default true not null,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "internal_name" text,
  "category" text,
  "vat_rate" numeric default 20 not null,
  "internal_note" text,
  "sort_order" integer default 0 not null,
  "aufschlag_percent" numeric default 0 not null,
  "vk_net_manual" numeric,
  "material_mode" text default 'artikel'::text not null,
  "pauschale_active" boolean default false not null,
  "pauschale_type" text default 'kein'::text not null,
  "pauschale_fix" numeric default 0 not null,
  "pauschale_percent" numeric default 0 not null,
  "positions_nummer" text,
  "usage_count" integer default 0 not null,
  "organization_id" uuid default current_org_id(),
  "is_variable_template" boolean default false not null,
  "system_generated" boolean default false not null,
  "is_regie_material_template" boolean default false not null,
  "is_regie_hour_template" boolean default false not null,
  "source_hourly_rate_id" uuid,
  "calculation_text" text,
  "image_url" text
);
alter table only public."services" add constraint "services_material_mode_check" CHECK ((material_mode = ANY (ARRAY['kein'::text, 'artikel'::text, 'pauschale_fix'::text, 'pauschale_prozent'::text, 'artikel_pauschale'::text])));
alter table only public."services" add constraint "services_pauschale_type_check" CHECK ((pauschale_type = ANY (ARRAY['kein'::text, 'fix'::text, 'prozent_lohn'::text, 'prozent_material'::text, 'prozent_ek'::text])));
alter table only public."services" add constraint "services_pkey" PRIMARY KEY (id);
create table public."sub_order_items" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "sub_order_id" uuid not null,
  "order_item_id" uuid,
  "source_order_id" uuid,
  "source_order_item_key" text,
  "pos_no" text,
  "short_text" text,
  "long_text" text,
  "qty" numeric default 0 not null,
  "unit" text,
  "customer_unit_price" numeric default 0 not null,
  "unit_price" numeric default 0 not null,
  "discount_percent" numeric default 0 not null,
  "vat_rate" numeric default 20 not null,
  "net" numeric default 0 not null,
  "is_title" boolean default false not null,
  "sort_order" integer default 0 not null
);
alter table only public."sub_order_items" add constraint "sub_order_items_pkey" PRIMARY KEY (id);
create table public."sub_orders" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id(),
  "sub_number" text,
  "sub_date" date default (now())::date not null,
  "title" text,
  "project_id" uuid,
  "order_id" uuid,
  "subcontractor_id" uuid,
  "contact_person_id" uuid,
  "status" text default 'entwurf'::text not null,
  "payment_term_days" integer,
  "skonto_percent" numeric,
  "skonto_days" integer,
  "retention_percent" numeric,
  "discount_percent" numeric,
  "service_period" text,
  "items" jsonb default '[]'::jsonb not null,
  "net" numeric default 0 not null,
  "vat" numeric default 0 not null,
  "gross" numeric default 0 not null,
  "cost_basis_net" numeric default 0 not null,
  "margin_net" numeric default 0 not null,
  "pdf_label" text,
  "doc_intro_text" text,
  "doc_closing_text" text,
  "display_settings_snapshot" jsonb,
  "sent_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "signed_at" timestamp with time zone,
  "snapshot" jsonb,
  "created_by" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "deleted_at" timestamp with time zone,
  "conditions_snapshot" jsonb,
  "recipient_override" jsonb,
  "vat_mode" text default 'standard'::text not null,
  "signature_source" text default 'company'::text not null
);
alter table only public."sub_orders" add constraint "sub_orders_signature_source_chk" CHECK ((signature_source = ANY (ARRAY['company'::text, 'creator'::text, 'none'::text])));
alter table only public."sub_orders" add constraint "sub_orders_vat_mode_check" CHECK ((vat_mode = ANY (ARRAY['standard'::text, 'par19'::text])));
alter table only public."sub_orders" add constraint "sub_orders_pkey" PRIMARY KEY (id);
create table public."tasks" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "description" text,
  "board" text default 'Büro'::text not null,
  "bucket" text default 'Allgemein'::text,
  "project_id" uuid,
  "assignee_id" uuid,
  "due_date" date,
  "priority" text default 'normal'::text,
  "done" boolean default false not null,
  "recurrence" text default 'none'::text,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "source_type" text,
  "source_meeting_id" uuid
);
alter table only public."tasks" add constraint "tasks_priority_check" CHECK ((priority = ANY (ARRAY['niedrig'::text, 'normal'::text, 'hoch'::text, 'dringend'::text])));
alter table only public."tasks" add constraint "tasks_recurrence_check" CHECK ((recurrence = ANY (ARRAY['none'::text, 'daily'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text])));
alter table only public."tasks" add constraint "tasks_pkey" PRIMARY KEY (id);
create table public."text_blocks" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "content" text default ''::text not null,
  "type" text default 'text'::text not null,
  "category" text default 'standard'::text,
  "level" integer default 1 not null,
  "sort_order" integer default 0 not null,
  "usage_count" integer default 0 not null,
  "active" boolean default true not null,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "number" text,
  "doc_type" text,
  "trade_id" uuid,
  "description" text,
  "text_type" text default 'hinweis'::text not null,
  "content_html" text,
  "document_type_id" uuid,
  "document_subtype_id" uuid,
  "project_type_id" uuid,
  "customer_type" text,
  "language" text default 'de'::text not null,
  "is_default" boolean default false not null,
  "applies_to_all_doctypes" boolean default false not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."text_blocks" add constraint "text_blocks_type_check" CHECK ((type = ANY (ARRAY['text'::text, 'titel'::text])));
alter table only public."text_blocks" add constraint "text_blocks_pkey" PRIMARY KEY (id);
create table public."time_entries" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid,
  "employee_id" uuid default auth.uid(),
  "work_date" date default CURRENT_DATE not null,
  "hours" numeric default 0 not null,
  "hourly_rate" numeric,
  "description" text,
  "created_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."time_entries" add constraint "time_entries_pkey" PRIMARY KEY (id);
create table public."trades" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "code" text,
  "description" text,
  "color" text,
  "sort_order" integer default 0 not null,
  "active" boolean default true not null,
  "created_by" uuid default auth.uid(),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id(),
  "default_surcharge_percent" numeric default 0 not null
);
alter table only public."trades" add constraint "trades_pkey" PRIMARY KEY (id);
create table public."units" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "code" text not null,
  "sort_order" integer default 0 not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."units" add constraint "units_pkey" PRIMARY KEY (id);
create table public."user_access" (
  "user_id" uuid not null,
  "see_archived" boolean default false not null,
  "see_deleted" boolean default false not null,
  "restore_deleted" boolean default false not null,
  "default_project_scope" text default 'assigned'::text not null,
  "updated_at" timestamp with time zone default now() not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."user_access" add constraint "user_access_default_project_scope_check" CHECK ((default_project_scope = ANY (ARRAY['none'::text, 'own'::text, 'assigned'::text, 'department'::text, 'all'::text])));
alter table only public."user_access" add constraint "user_access_pkey" PRIMARY KEY (user_id);
create table public."user_roles" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "role_id" uuid not null,
  "organization_id" uuid default current_org_id()
);
alter table only public."user_roles" add constraint "user_roles_pkey" PRIMARY KEY (id);
alter table only public."user_roles" add constraint "user_roles_user_id_role_id_key" UNIQUE (user_id, role_id);
create table public."voice_input_templates" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "created_by" uuid default auth.uid(),
  "name" text not null,
  "kind" text default 'klein'::text not null,
  "input_text" text not null,
  "template_data" jsonb default '{}'::jsonb not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."voice_input_templates" add constraint "voice_input_templates_kind_check" CHECK ((kind = ANY (ARRAY['klein'::text, 'gross'::text, 'einzel'::text])));
alter table only public."voice_input_templates" add constraint "voice_input_templates_pkey" PRIMARY KEY (id);
create table public."voice_transcripts" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "created_by" uuid default auth.uid(),
  "offer_id" uuid,
  "document_id" uuid,
  "audio_path" text,
  "audio_size_bytes" bigint,
  "audio_mime" text,
  "duration_ms" integer,
  "transcript_raw" text,
  "transcript_corrected" text,
  "transcribe_model" text default 'gpt-4o-transcribe'::text,
  "produced_offer" boolean default false not null,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null
);
alter table only public."voice_transcripts" add constraint "voice_transcripts_audio_mime_chk" CHECK (((audio_mime IS NULL) OR (audio_mime = ANY (ARRAY['audio/webm'::text, 'audio/ogg'::text, 'audio/mp4'::text, 'audio/mpeg'::text, 'audio/wav'::text, 'audio/x-wav'::text, 'audio/m4a'::text, 'audio/x-m4a'::text]))));
alter table only public."voice_transcripts" add constraint "voice_transcripts_pkey" PRIMARY KEY (id);
create table public."work_time_models" (
  "id" uuid default gen_random_uuid() not null,
  "organization_id" uuid default current_org_id() not null,
  "name" text not null,
  "description" text,
  "logic" text default 'buak_auto'::text not null,
  "week_short" jsonb default '{}'::jsonb not null,
  "week_long" jsonb default '{}'::jsonb not null,
  "weekly_hours" numeric,
  "daily_hours" numeric,
  "is_active" boolean default true not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table only public."work_time_models" add constraint "work_time_models_pkey" PRIMARY KEY (id);

-- ---------- Fremdschlüssel (nach allen Tabellen) ----------
alter table only public."ai_logs" add constraint "ai_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."anfrage_events" add constraint "anfrage_events_anfrage_id_fkey" FOREIGN KEY (anfrage_id) REFERENCES anfragen(id) ON DELETE CASCADE;
alter table only public."anfrage_events" add constraint "anfrage_events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."anfrage_events" add constraint "anfrage_events_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."anfragen" add constraint "anfragen_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."anfragen" add constraint "anfragen_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."anfragen" add constraint "anfragen_related_contact_id_fkey" FOREIGN KEY (related_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."anfragen" add constraint "anfragen_related_project_id_fkey" FOREIGN KEY (related_project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table only public."api_rate_limit" add constraint "api_rate_limit_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only public."appointments" add constraint "appointments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."appointments" add constraint "appointments_recurrence_parent_id_fkey" FOREIGN KEY (recurrence_parent_id) REFERENCES appointments(id) ON DELETE CASCADE;
alter table only public."appointments" add constraint "appointments_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."articles" add constraint "articles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."articles" add constraint "articles_trade_id_fkey" FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL;
alter table only public."automation_runs" add constraint "automation_runs_automation_id_fkey" FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE;
alter table only public."automation_runs" add constraint "automation_runs_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table only public."buak_calendar" add constraint "buak_calendar_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
alter table only public."company_work_calendar_settings" add constraint "company_work_calendar_settings_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."company_work_day_rules" add constraint "company_work_day_rules_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."contact_persons" add constraint "contact_persons_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;
alter table only public."contacts" add constraint "contacts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."document_subtypes" add constraint "document_subtypes_document_type_id_fkey" FOREIGN KEY (document_type_id) REFERENCES document_types(id) ON DELETE CASCADE;
alter table only public."document_templates" add constraint "document_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."document_type_transitions" add constraint "document_type_transitions_offer_type_id_fkey" FOREIGN KEY (offer_type_id) REFERENCES offer_types(id) ON DELETE CASCADE;
alter table only public."documents" add constraint "documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."documents" add constraint "documents_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."documents" add constraint "documents_document_type_id_fkey" FOREIGN KEY (document_type_id) REFERENCES document_types(id) ON DELETE SET NULL;
alter table only public."documents" add constraint "documents_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."documents" add constraint "documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
alter table only public."employees" add constraint "employees_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."employees" add constraint "employees_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."employees" add constraint "employees_supervisor_id_fkey" FOREIGN KEY (supervisor_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table only public."employees" add constraint "employees_work_time_model_id_fkey" FOREIGN KEY (work_time_model_id) REFERENCES work_time_models(id) ON DELETE SET NULL;
alter table only public."hourly_rates" add constraint "hourly_rates_trade_id_fkey" FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE;
alter table only public."invoice_items" add constraint "invoice_items_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table only public."invoice_offers" add constraint "invoice_offers_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table only public."invoice_offers" add constraint "invoice_offers_offer_id_fkey" FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE;
alter table only public."invoices" add constraint "invoices_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."invoices" add constraint "invoices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."invoices" add constraint "invoices_offer_type_id_fkey" FOREIGN KEY (offer_type_id) REFERENCES offer_types(id) ON DELETE SET NULL;
alter table only public."invoices" add constraint "invoices_person_id_fkey" FOREIGN KEY (person_id) REFERENCES contact_persons(id) ON DELETE SET NULL;
alter table only public."invoices" add constraint "invoices_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table only public."invoices" add constraint "invoices_storno_of_fkey" FOREIGN KEY (storno_of) REFERENCES invoices(id) ON DELETE SET NULL;
alter table only public."mail_templates" add constraint "mail_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."mail_templates" add constraint "mail_templates_document_type_id_fkey" FOREIGN KEY (document_type_id) REFERENCES document_types(id) ON DELETE SET NULL;
alter table only public."memberships" add constraint "memberships_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."memberships" add constraint "memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_related_invoice_id_fkey" FOREIGN KEY (related_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_related_offer_id_fkey" FOREIGN KEY (related_offer_id) REFERENCES offers(id) ON DELETE SET NULL;
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_related_order_id_fkey" FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table only public."microsoft_mail_audit_log" add constraint "microsoft_mail_audit_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."microsoft_oauth_tokens" add constraint "microsoft_oauth_tokens_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."microsoft_oauth_tokens" add constraint "microsoft_oauth_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only public."number_ranges" add constraint "number_ranges_document_type_id_fkey" FOREIGN KEY (document_type_id) REFERENCES document_types(id) ON DELETE CASCADE;
alter table only public."offers" add constraint "offers_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."offers" add constraint "offers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."offers" add constraint "offers_offer_type_id_fkey" FOREIGN KEY (offer_type_id) REFERENCES offer_types(id);
alter table only public."offers" add constraint "offers_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."offers" add constraint "offers_related_order_id_fkey" FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table only public."offers" add constraint "offers_sent_by_fkey" FOREIGN KEY (sent_by) REFERENCES auth.users(id);
alter table only public."order_items" add constraint "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table only public."order_items" add constraint "order_items_source_supplement_offer_id_fkey" FOREIGN KEY (source_supplement_offer_id) REFERENCES offers(id) ON DELETE SET NULL;
alter table only public."orders" add constraint "orders_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."orders" add constraint "orders_offer_type_id_fkey" FOREIGN KEY (offer_type_id) REFERENCES offer_types(id) ON DELETE SET NULL;
alter table only public."orders" add constraint "orders_person_id_fkey" FOREIGN KEY (person_id) REFERENCES contact_persons(id) ON DELETE SET NULL;
alter table only public."orders" add constraint "orders_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table only public."permission_modules" add constraint "permission_modules_group_key_fkey" FOREIGN KEY (group_key) REFERENCES permission_groups(key) ON UPDATE CASCADE;
alter table only public."planning_absences" add constraint "planning_absences_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table only public."planning_event_employees" add constraint "planning_event_employees_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table only public."planning_event_employees" add constraint "planning_event_employees_event_id_fkey" FOREIGN KEY (event_id) REFERENCES planning_events(id) ON DELETE CASCADE;
alter table only public."planning_event_resources" add constraint "planning_event_resources_event_id_fkey" FOREIGN KEY (event_id) REFERENCES planning_events(id) ON DELETE CASCADE;
alter table only public."planning_event_resources" add constraint "planning_event_resources_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES planning_resources(id) ON DELETE CASCADE;
alter table only public."planning_events" add constraint "planning_events_category_id_fkey" FOREIGN KEY (category_id) REFERENCES planning_categories(id) ON DELETE SET NULL;
alter table only public."planning_events" add constraint "planning_events_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."planning_events" add constraint "planning_events_event_type_id_fkey" FOREIGN KEY (event_type_id) REFERENCES planning_event_types(id) ON DELETE SET NULL;
alter table only public."planning_events" add constraint "planning_events_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table only public."planning_resources" add constraint "planning_resources_category_id_fkey" FOREIGN KEY (category_id) REFERENCES planning_categories(id) ON DELETE SET NULL;
alter table only public."planning_resources" add constraint "planning_resources_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table only public."planning_resources" add constraint "planning_resources_resource_type_id_fkey" FOREIGN KEY (resource_type_id) REFERENCES planning_resource_types(id) ON DELETE SET NULL;
alter table only public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only public."project_appointments" add constraint "project_appointments_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."project_checklist_items" add constraint "project_checklist_items_checklist_id_fkey" FOREIGN KEY (checklist_id) REFERENCES project_checklists(id) ON DELETE CASCADE;
alter table only public."project_checklists" add constraint "project_checklists_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."project_log" add constraint "project_log_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."project_log" add constraint "project_log_offer_id_fkey" FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;
alter table only public."project_log" add constraint "project_log_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."project_media" add constraint "project_media_category_id_fkey" FOREIGN KEY (category_id) REFERENCES media_categories(id) ON DELETE SET NULL;
alter table only public."project_media" add constraint "project_media_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."project_media" add constraint "project_media_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."project_meeting_items" add constraint "project_meeting_items_meeting_id_fkey" FOREIGN KEY (meeting_id) REFERENCES project_meetings(id) ON DELETE CASCADE;
alter table only public."project_meeting_participants" add constraint "project_meeting_participants_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."project_meeting_participants" add constraint "project_meeting_participants_meeting_id_fkey" FOREIGN KEY (meeting_id) REFERENCES project_meetings(id) ON DELETE CASCADE;
alter table only public."project_meeting_participants" add constraint "project_meeting_participants_participant_id_fkey" FOREIGN KEY (participant_id) REFERENCES project_participants(id) ON DELETE SET NULL;
alter table only public."project_meeting_participants" add constraint "project_meeting_participants_person_id_fkey" FOREIGN KEY (person_id) REFERENCES contact_persons(id) ON DELETE SET NULL;
alter table only public."project_meetings" add constraint "project_meetings_planning_event_id_fkey" FOREIGN KEY (planning_event_id) REFERENCES planning_events(id) ON DELETE SET NULL;
alter table only public."project_meetings" add constraint "project_meetings_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."project_participants" add constraint "project_participants_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."project_participants" add constraint "project_participants_person_id_fkey" FOREIGN KEY (person_id) REFERENCES contact_persons(id) ON DELETE SET NULL;
alter table only public."project_participants" add constraint "project_participants_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."project_signatures" add constraint "project_signatures_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."project_signatures" add constraint "project_signatures_meeting_id_fkey" FOREIGN KEY (meeting_id) REFERENCES project_meetings(id) ON DELETE SET NULL;
alter table only public."project_signatures" add constraint "project_signatures_participant_id_fkey" FOREIGN KEY (participant_id) REFERENCES project_participants(id) ON DELETE SET NULL;
alter table only public."project_signatures" add constraint "project_signatures_person_id_fkey" FOREIGN KEY (person_id) REFERENCES contact_persons(id) ON DELETE SET NULL;
alter table only public."project_signatures" add constraint "project_signatures_planning_event_id_fkey" FOREIGN KEY (planning_event_id) REFERENCES planning_events(id) ON DELETE SET NULL;
alter table only public."project_signatures" add constraint "project_signatures_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."project_statuses" add constraint "project_statuses_project_type_id_fkey" FOREIGN KEY (project_type_id) REFERENCES project_types(id) ON DELETE CASCADE;
alter table only public."project_type_statuses" add constraint "project_type_statuses_project_type_id_fkey" FOREIGN KEY (project_type_id) REFERENCES project_types(id) ON DELETE CASCADE;
alter table only public."project_type_statuses" add constraint "project_type_statuses_status_id_fkey" FOREIGN KEY (status_id) REFERENCES project_statuses_global(id) ON DELETE CASCADE;
alter table only public."projects" add constraint "projects_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."projects" add constraint "projects_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."role_permissions" add constraint "role_permissions_role_id_fkey" FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
alter table only public."role_scopes" add constraint "role_scopes_role_id_fkey" FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
alter table only public."service_components" add constraint "service_components_article_id_fkey" FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL;
alter table only public."service_components" add constraint "service_components_hourly_rate_id_fkey" FOREIGN KEY (hourly_rate_id) REFERENCES hourly_rates(id) ON DELETE SET NULL;
alter table only public."service_components" add constraint "service_components_service_id_fkey" FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
alter table only public."services" add constraint "services_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."services" add constraint "services_source_hourly_rate_id_fkey" FOREIGN KEY (source_hourly_rate_id) REFERENCES hourly_rates(id) ON DELETE SET NULL;
alter table only public."services" add constraint "services_trade_id_fkey" FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL;
alter table only public."sub_order_items" add constraint "sub_order_items_order_item_id_fkey" FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL;
alter table only public."sub_order_items" add constraint "sub_order_items_source_order_id_fkey" FOREIGN KEY (source_order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table only public."sub_order_items" add constraint "sub_order_items_sub_order_id_fkey" FOREIGN KEY (sub_order_id) REFERENCES sub_orders(id) ON DELETE CASCADE;
alter table only public."sub_orders" add constraint "sub_orders_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table only public."sub_orders" add constraint "sub_orders_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table only public."sub_orders" add constraint "sub_orders_subcontractor_id_fkey" FOREIGN KEY (subcontractor_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table only public."tasks" add constraint "tasks_assignee_id_fkey" FOREIGN KEY (assignee_id) REFERENCES auth.users(id);
alter table only public."tasks" add constraint "tasks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."tasks" add constraint "tasks_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table only public."tasks" add constraint "tasks_source_meeting_id_fkey" FOREIGN KEY (source_meeting_id) REFERENCES project_meetings(id) ON DELETE SET NULL;
alter table only public."text_blocks" add constraint "text_blocks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."text_blocks" add constraint "text_blocks_document_subtype_id_fkey" FOREIGN KEY (document_subtype_id) REFERENCES document_subtypes(id) ON DELETE SET NULL;
alter table only public."text_blocks" add constraint "text_blocks_document_type_id_fkey" FOREIGN KEY (document_type_id) REFERENCES document_types(id) ON DELETE SET NULL;
alter table only public."text_blocks" add constraint "text_blocks_project_type_id_fkey" FOREIGN KEY (project_type_id) REFERENCES project_types(id) ON DELETE SET NULL;
alter table only public."text_blocks" add constraint "text_blocks_trade_id_fkey" FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL;
alter table only public."time_entries" add constraint "time_entries_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES auth.users(id);
alter table only public."time_entries" add constraint "time_entries_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table only public."trades" add constraint "trades_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table only public."user_access" add constraint "user_access_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only public."user_roles" add constraint "user_roles_role_id_fkey" FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
alter table only public."user_roles" add constraint "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only public."voice_input_templates" add constraint "voice_input_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."voice_input_templates" add constraint "voice_input_templates_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."voice_transcripts" add constraint "voice_transcripts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table only public."voice_transcripts" add constraint "voice_transcripts_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table only public."voice_transcripts" add constraint "voice_transcripts_offer_id_fkey" FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;
alter table only public."voice_transcripts" add constraint "voice_transcripts_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table only public."work_time_models" add constraint "work_time_models_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- ---------- Indizes ----------
CREATE INDEX IF NOT EXISTS ai_logs_context_idx ON public.ai_logs USING btree (context_type, context_id);
CREATE INDEX IF NOT EXISTS ai_logs_user_idx ON public.ai_logs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS appointments_parent_idx ON public.appointments USING btree (recurrence_parent_id);
CREATE INDEX IF NOT EXISTS appointments_projekt_idx ON public.appointments USING btree (hero_projektnummer);
CREATE INDEX IF NOT EXISTS appointments_start_idx ON public.appointments USING btree (start_datetime);
CREATE UNIQUE INDEX IF NOT EXISTS articles_article_number_key ON public.articles USING btree (article_number) WHERE (article_number IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS contact_persons_org_number_uniq ON public.contact_persons USING btree (organization_id, contact_number) WHERE (contact_number IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_contact_number_key ON public.contacts USING btree (contact_number) WHERE (contact_number IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ai_action_org_created ON public.ai_action_logs USING btree (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_created ON public.ai_usage_logs USING btree (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anfrage_events_anfrage_created ON public.anfrage_events USING btree (anfrage_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anfrage_events_org_created ON public.anfrage_events USING btree (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anfragen_assigned_to ON public.anfragen USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_anfragen_org_ai_classification ON public.anfragen USING btree (organization_id, ai_classification) WHERE (ai_classification IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_anfragen_org_created ON public.anfragen USING btree (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anfragen_org_status ON public.anfragen USING btree (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_anfragen_related_contact ON public.anfragen USING btree (related_contact_id) WHERE (related_contact_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_anfragen_source ON public.anfragen USING btree (source);
CREATE INDEX IF NOT EXISTS idx_arl_window ON public.api_rate_limit USING btree (window_start);
CREATE INDEX IF NOT EXISTS idx_articles_org ON public.articles USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_articles_trade ON public.articles USING btree (trade_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON public.automation_runs USING btree (automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_created ON public.automation_runs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_project ON public.automation_runs USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_automations_org ON public.automations USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_automations_trigger_stage ON public.automations USING btree (trigger_stage);
CREATE INDEX IF NOT EXISTS idx_automations_trigger_type ON public.automations USING btree (trigger_type);
CREATE INDEX IF NOT EXISTS idx_buak_calendar_org ON public.buak_calendar USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_buak_year ON public.buak_calendar USING btree (year);
CREATE INDEX IF NOT EXISTS idx_calc_audit_entity ON public.calc_audit_log USING btree (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_calc_audit_log_org ON public.calc_audit_log USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_catalog_items_org ON public.catalog_items USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_company_settings_org ON public.company_settings USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_persons_contact ON public.contact_persons USING btree (contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_persons_org ON public.contact_persons USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON public.contacts USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_docaudit_src ON public.document_audit_log USING btree (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_docpdfcache_src ON public.document_pdf_cache USING btree (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_document_subtypes_org ON public.document_subtypes USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_document_subtypes_type ON public.document_subtypes USING btree (document_type_id);
CREATE INDEX IF NOT EXISTS idx_document_templates_org ON public.document_templates USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_document_templates_org_type_cat ON public.document_templates USING btree (organization_id, doc_type, category);
CREATE INDEX IF NOT EXISTS idx_document_templates_type ON public.document_templates USING btree (doc_type);
CREATE INDEX IF NOT EXISTS idx_document_types_org ON public.document_types USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_documents_not_deleted ON public.documents USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_documents_org ON public.documents USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON public.documents USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON public.documents USING btree (document_type_id);
CREATE INDEX IF NOT EXISTS idx_docver_src ON public.document_versions USING btree (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_employees_active ON public.employees USING btree (active);
CREATE INDEX IF NOT EXISTS idx_employees_name ON public.employees USING btree (last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_employees_org ON public.employees USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_hourly_rates_org ON public.hourly_rates USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_hourly_rates_trade ON public.hourly_rates USING btree (trade_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_org ON public.invoice_items USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_invoice_offers_org ON public.invoice_offers USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON public.invoices USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_not_deleted ON public.invoices USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON public.invoices USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_project ON public.invoices USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices USING btree (payment_status);
CREATE INDEX IF NOT EXISTS idx_mail_templates_active ON public.mail_templates USING btree (active);
CREATE INDEX IF NOT EXISTS idx_mail_templates_context ON public.mail_templates USING btree (context);
CREATE INDEX IF NOT EXISTS idx_mail_templates_doctype ON public.mail_templates USING btree (organization_id, document_type_slug, trigger_action);
CREATE INDEX IF NOT EXISTS idx_mail_templates_org ON public.mail_templates USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_media_categories_active ON public.media_categories USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_media_categories_org ON public.media_categories USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_mmal_invoice ON public.microsoft_mail_audit_log USING btree (related_invoice_id) WHERE (related_invoice_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mmal_offer ON public.microsoft_mail_audit_log USING btree (related_offer_id) WHERE (related_offer_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mmal_order ON public.microsoft_mail_audit_log USING btree (related_order_id) WHERE (related_order_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mmal_org_sent ON public.microsoft_mail_audit_log USING btree (organization_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msot_expires_active ON public.microsoft_oauth_tokens USING btree (expires_at) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_number_ranges_doctype ON public.number_ranges USING btree (document_type_id);
CREATE INDEX IF NOT EXISTS idx_number_ranges_org ON public.number_ranges USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_offer_display_settings_org ON public.offer_display_settings USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_offer_types_org ON public.offer_types USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_offers_created_at ON public.offers USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_offers_not_deleted ON public.offers USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_offers_org ON public.offers USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_offers_project ON public.offers USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_org ON public.order_items USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted ON public.orders USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_orders_org ON public.orders USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_orders_project ON public.orders USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_pa_project ON public.project_appointments USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_pc_project ON public.project_checklists USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_pci_checklist ON public.project_checklist_items USING btree (checklist_id);
CREATE INDEX IF NOT EXISTS idx_perm_audit_created ON public.perm_audit_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perm_audit_log_org ON public.perm_audit_log USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_pl_abs_emp ON public.planning_absences USING btree (employee_id, start_date);
CREATE INDEX IF NOT EXISTS idx_pl_ee_emp ON public.planning_event_employees USING btree (employee_id);
CREATE INDEX IF NOT EXISTS idx_pl_er_res ON public.planning_event_resources USING btree (resource_id);
CREATE INDEX IF NOT EXISTS idx_pl_events_org_start ON public.planning_events USING btree (organization_id, start_at);
CREATE INDEX IF NOT EXISTS idx_pl_events_project ON public.planning_events USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_pm_project ON public.project_meetings USING btree (project_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_pmi_meeting ON public.project_meeting_items USING btree (meeting_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pmp_meeting ON public.project_meeting_participants USING btree (meeting_id);
CREATE INDEX IF NOT EXISTS idx_pp_project ON public.project_participants USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_project_appointments_org ON public.project_appointments USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_project_checklist_items_org ON public.project_checklist_items USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_project_checklists_org ON public.project_checklists USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_project_log_org ON public.project_log USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_project_media_category ON public.project_media USING btree (category_id);
CREATE INDEX IF NOT EXISTS idx_project_media_org ON public.project_media USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_project_media_project ON public.project_media USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_project_participants_org ON public.project_participants USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_project_statuses_org ON public.project_statuses USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_project_statuses_type ON public.project_statuses USING btree (project_type_id);
CREATE INDEX IF NOT EXISTS idx_project_types_org ON public.project_types USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_contact ON public.projects USING btree (contact_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON public.projects USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON public.projects USING btree (stage);
CREATE INDEX IF NOT EXISTS idx_psig_meeting ON public.project_signatures USING btree (meeting_id);
CREATE INDEX IF NOT EXISTS idx_psig_project ON public.project_signatures USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_org ON public.role_permissions USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions USING btree (role_id);
CREATE INDEX IF NOT EXISTS idx_role_scopes_org ON public.role_scopes USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_roles_org ON public.roles USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_service_components_org ON public.service_components USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_service_components_service ON public.service_components USING btree (service_id);
CREATE INDEX IF NOT EXISTS idx_services_org ON public.services USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_services_trade ON public.services USING btree (trade_id);
CREATE INDEX IF NOT EXISTS idx_sub_order_items_srckey ON public.sub_order_items USING btree (source_order_item_key);
CREATE INDEX IF NOT EXISTS idx_sub_order_items_sub ON public.sub_order_items USING btree (sub_order_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_order ON public.sub_orders USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_project ON public.sub_orders USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON public.tasks USING btree (done);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON public.tasks USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source_meeting ON public.tasks USING btree (source_meeting_id);
CREATE INDEX IF NOT EXISTS idx_text_blocks_active ON public.text_blocks USING btree (active);
CREATE INDEX IF NOT EXISTS idx_text_blocks_match ON public.text_blocks USING btree (text_type, document_type_id, project_type_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_text_blocks_org ON public.text_blocks USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_text_blocks_trade ON public.text_blocks USING btree (trade_id);
CREATE INDEX IF NOT EXISTS idx_text_blocks_type ON public.text_blocks USING btree (type);
CREATE INDEX IF NOT EXISTS idx_time_entries_org ON public.time_entries USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_time_project ON public.time_entries USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_trades_org ON public.trades USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_units_org ON public.units USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_user_access_org ON public.user_access USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON public.user_roles USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_voice_input_templates_kind ON public.voice_input_templates USING btree (organization_id, kind, active);
CREATE INDEX IF NOT EXISTS idx_voice_input_templates_org ON public.voice_input_templates USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_document ON public.voice_transcripts USING btree (document_id) WHERE (document_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_offer ON public.voice_transcripts USING btree (offer_id) WHERE (offer_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_org_created ON public.voice_transcripts USING btree (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wcs_org_year ON public.company_work_calendar_settings USING btree (organization_id, year);
CREATE INDEX IF NOT EXISTS idx_wdr_org_year ON public.company_work_day_rules USING btree (organization_id, year);
CREATE INDEX IF NOT EXISTS idx_wtm_org ON public.work_time_models USING btree (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS offer_types_slug_uidx ON public.offer_types USING btree (slug);
CREATE UNIQUE INDEX IF NOT EXISTS projects_project_number_key ON public.projects USING btree (project_number) WHERE (project_number IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_number_ranges_org_doc_type ON public.number_ranges USING btree (organization_id, doc_type);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_number_ranges_org_doctype ON public.number_ranges USING btree (organization_id, document_type_id) WHERE (document_type_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_services_number ON public.services USING btree (service_number) WHERE (service_number IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_services_regie_rate ON public.services USING btree (source_hourly_rate_id) WHERE (source_hourly_rate_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_services_system_num ON public.services USING btree (organization_id, trade_id, positions_nummer) WHERE (system_generated AND (positions_nummer IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_text_blocks_sortorder ON public.text_blocks USING btree (organization_id, type, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_units_code_lower ON public.units USING btree (lower(code));

-- ---------- Views ----------
create or replace view public."company_branding" as
 SELECT id,
    logo_url,
    icon_logo_url
   FROM company_settings
  WHERE id = 1;
alter view public."company_branding" set (security_invoker=false);
create or replace view public."documents_unified_core" as
 WITH cust AS (
         SELECT contacts.id,
            contacts.organization_id,
                CASE
                    WHEN COALESCE(contacts.customer_type, ''::text) = 'firma'::text THEN COALESCE(NULLIF(btrim(contacts.company), ''::text), btrim((COALESCE(contacts.first_name, ''::text) || ' '::text) || COALESCE(contacts.last_name, ''::text)))
                    ELSE COALESCE(NULLIF(btrim((COALESCE(contacts.first_name, ''::text) || ' '::text) || COALESCE(contacts.last_name, ''::text)), ''::text), contacts.company)
                END AS name,
            contacts.email
           FROM contacts
        ), proj AS (
         SELECT projects.id,
            projects.project_number,
            projects.title,
            btrim((((COALESCE(projects.street, ''::text) || ' '::text) || COALESCE(projects.zip, ''::text)) || ' '::text) || COALESCE(projects.city, ''::text)) AS address
           FROM projects
        )
 SELECT o.id,
    'offer'::text AS kind,
    o.organization_id,
    dt.id AS document_type_id,
    'angebote'::text AS type_slug,
    COALESCE(dt.name, 'Angebot'::text) AS type_name,
    COALESCE(dt.sort_order, 0) AS type_sort,
    o.offer_type_id AS variant_id,
    ot.name AS variant_name,
    o.number AS doc_number,
    o.status,
        CASE
            WHEN o.archived_at IS NOT NULL THEN 'archiviert'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'entwurf'::text THEN 'entwurf'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'versendet'::text THEN 'versendet'::text
            WHEN lower(COALESCE(o.status, ''::text)) = ANY (ARRAY['abgeschlossen'::text, 'angenommen'::text]) THEN 'abgeschlossen'::text
            ELSE COALESCE(o.status, 'entwurf'::text)
        END AS status_norm,
    NULL::text AS payment_status,
    lower(COALESCE(o.status, ''::text)) = 'entwurf'::text AS is_draft,
    o.archived_at IS NOT NULL AS is_archived,
    lower(COALESCE(o.status, ''::text)) = 'storniert'::text AS is_canceled,
    lower(COALESCE(o.status, ''::text)) <> 'entwurf'::text AS is_locked,
    (lower(COALESCE(o.status, ''::text)) = ANY (ARRAY['abgeschlossen'::text, 'versendet'::text, 'angenommen'::text])) AND o.archived_at IS NULL AS convertible,
    o.contact_id AS customer_id,
    c.name AS customer_name,
    o.project_id,
    p.project_number,
    p.title AS project_title,
    p.address AS object_address,
    o.title,
    COALESCE(o.closed_at::date, o.sent_at::date, o.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(o.closed_at, o.sent_at, o.created_at))::integer AS doc_year,
    o.net,
    o.gross,
    o.created_by AS editor_id,
    pr.name AS editor_name,
    o.created_at,
    GREATEST(o.created_at, o.closed_at, o.sent_at) AS last_change,
    NULL::text AS file_url,
    lower(concat_ws(' '::text, o.number, o.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, o.status, ot.name)) AS search_text
   FROM offers o
     LEFT JOIN document_types dt ON dt.slug = 'angebote'::text AND NOT dt.organization_id IS DISTINCT FROM o.organization_id
     LEFT JOIN offer_types ot ON ot.id = o.offer_type_id
     LEFT JOIN cust c ON c.id = o.contact_id
     LEFT JOIN proj p ON p.id = o.project_id
     LEFT JOIN profiles pr ON pr.id = o.created_by
  WHERE o.deleted_at IS NULL
UNION ALL
 SELECT o.id,
    'order'::text AS kind,
    o.organization_id,
    dt.id AS document_type_id,
    'auftraege'::text AS type_slug,
    COALESCE(dt.name, 'Auftrag'::text) AS type_name,
    COALESCE(dt.sort_order, 0) AS type_sort,
    o.offer_type_id AS variant_id,
    ot.name AS variant_name,
    o.order_number AS doc_number,
    o.status,
        CASE
            WHEN o.archived_at IS NOT NULL THEN 'archiviert'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'entwurf'::text THEN 'entwurf'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'storniert'::text THEN 'storniert'::text
            WHEN lower(COALESCE(o.status, ''::text)) = 'versendet'::text THEN 'versendet'::text
            ELSE 'abgeschlossen'::text
        END AS status_norm,
    NULL::text AS payment_status,
    lower(COALESCE(o.status, ''::text)) = 'entwurf'::text AS is_draft,
    o.archived_at IS NOT NULL AS is_archived,
    lower(COALESCE(o.status, ''::text)) = 'storniert'::text AS is_canceled,
    lower(COALESCE(o.status, ''::text)) <> 'entwurf'::text AS is_locked,
    (lower(COALESCE(o.status, ''::text)) <> ALL (ARRAY['entwurf'::text, 'storniert'::text, 'archiviert'::text])) AND o.archived_at IS NULL AS convertible,
    o.contact_id AS customer_id,
    c.name AS customer_name,
    o.project_id,
    p.project_number,
    p.title AS project_title,
    p.address AS object_address,
    o.title,
    COALESCE(o.order_date, o.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(o.order_date::timestamp with time zone, o.created_at))::integer AS doc_year,
    o.net,
    o.gross,
    o.created_by AS editor_id,
    pr.name AS editor_name,
    o.created_at,
    COALESCE(o.updated_at, o.created_at) AS last_change,
    NULL::text AS file_url,
    lower(concat_ws(' '::text, o.order_number, o.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, o.status, ot.name)) AS search_text
   FROM orders o
     LEFT JOIN document_types dt ON dt.slug = 'auftraege'::text AND NOT dt.organization_id IS DISTINCT FROM o.organization_id
     LEFT JOIN offer_types ot ON ot.id = o.offer_type_id
     LEFT JOIN cust c ON c.id = o.contact_id
     LEFT JOIN proj p ON p.id = o.project_id
     LEFT JOIN profiles pr ON pr.id = o.created_by
  WHERE o.deleted_at IS NULL
UNION ALL
 SELECT i.id,
    'invoice'::text AS kind,
    i.organization_id,
    dt.id AS document_type_id,
    'rechnungen'::text AS type_slug,
    COALESCE(dt.name, 'Rechnung'::text) AS type_name,
    COALESCE(dt.sort_order, 0) AS type_sort,
    i.offer_type_id AS variant_id,
    ot.name AS variant_name,
    i.number AS doc_number,
    i.doc_status AS status,
        CASE
            WHEN i.archived_at IS NOT NULL THEN 'archiviert'::text
            WHEN i.doc_status = 'storniert'::text OR i.storno_of IS NOT NULL THEN 'storniert'::text
            WHEN i.doc_status = 'entwurf'::text THEN 'entwurf'::text
            WHEN i.payment_status = 'bezahlt'::text THEN 'bezahlt'::text
            WHEN i.payment_status = 'teilbezahlt'::text THEN 'teilbezahlt'::text
            WHEN i.locked AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND COALESCE(i.payment_status, ''::text) <> 'bezahlt'::text THEN 'ueberfaellig'::text
            WHEN i.doc_status = 'versendet'::text THEN 'versendet'::text
            ELSE 'abgeschlossen'::text
        END AS status_norm,
    i.payment_status,
    i.doc_status = 'entwurf'::text AS is_draft,
    i.archived_at IS NOT NULL AS is_archived,
    i.doc_status = 'storniert'::text OR i.storno_of IS NOT NULL AS is_canceled,
    COALESCE(i.locked, false) AS is_locked,
    false AS convertible,
    i.contact_id AS customer_id,
    c.name AS customer_name,
    i.project_id,
    p.project_number,
    p.title AS project_title,
    p.address AS object_address,
    i.title,
    COALESCE(i.invoice_date, i.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(i.invoice_date::timestamp with time zone, i.created_at))::integer AS doc_year,
    i.net,
    i.gross,
    i.created_by AS editor_id,
    pr.name AS editor_name,
    i.created_at,
    COALESCE(i.updated_at, i.created_at) AS last_change,
    NULL::text AS file_url,
    lower(concat_ws(' '::text, i.number, i.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, i.doc_status, ot.name)) AS search_text
   FROM invoices i
     LEFT JOIN document_types dt ON dt.slug = 'rechnungen'::text AND NOT dt.organization_id IS DISTINCT FROM i.organization_id
     LEFT JOIN offer_types ot ON ot.id = i.offer_type_id
     LEFT JOIN cust c ON c.id = i.contact_id
     LEFT JOIN proj p ON p.id = i.project_id
     LEFT JOIN profiles pr ON pr.id = i.created_by
  WHERE i.deleted_at IS NULL
UNION ALL
 SELECT d.id,
    'document'::text AS kind,
    d.organization_id,
    d.document_type_id,
    dt.slug AS type_slug,
    COALESCE(dt.name, 'Dokument'::text) AS type_name,
    COALESCE(dt.sort_order, 0) AS type_sort,
    NULL::uuid AS variant_id,
    NULL::text AS variant_name,
    d.document_number AS doc_number,
    d.status,
        CASE
            WHEN d.archived_at IS NOT NULL THEN 'archiviert'::text
            WHEN d.status = ANY (ARRAY['entwurf'::text, 'draft'::text]) THEN 'entwurf'::text
            ELSE COALESCE(d.status, 'erhalten'::text)
        END AS status_norm,
    NULL::text AS payment_status,
    d.status = ANY (ARRAY['entwurf'::text, 'draft'::text]) AS is_draft,
    d.archived_at IS NOT NULL AS is_archived,
    d.status = 'storniert'::text AS is_canceled,
    false AS is_locked,
    false AS convertible,
    d.customer_id,
    c.name AS customer_name,
    d.project_id,
    p.project_number,
    p.title AS project_title,
    p.address AS object_address,
    COALESCE(d.subject, d.title) AS title,
    COALESCE(d.doc_date, d.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(d.doc_date::timestamp with time zone, d.created_at))::integer AS doc_year,
    NULL::numeric AS net,
    NULL::numeric AS gross,
    COALESCE(d.created_by, d.uploaded_by) AS editor_id,
    pr.name AS editor_name,
    d.created_at,
    COALESCE(d.updated_at, d.created_at) AS last_change,
    d.file_url,
    lower(concat_ws(' '::text, d.document_number, d.title, d.subject, c.name, c.email, p.project_number, p.title, p.address, pr.name, d.status, d.sender, d.recipient, dt.name)) AS search_text
   FROM documents d
     LEFT JOIN document_types dt ON dt.id = d.document_type_id
     LEFT JOIN cust c ON c.id = d.customer_id
     LEFT JOIN proj p ON p.id = d.project_id
     LEFT JOIN profiles pr ON pr.id = COALESCE(d.created_by, d.uploaded_by)
  WHERE d.deleted_at IS NULL
UNION ALL
 SELECT s.id,
    'sub_order'::text AS kind,
    s.organization_id,
    dt.id AS document_type_id,
    'auftrag_sub'::text AS type_slug,
    COALESCE(dt.name, 'Auftrag SUB'::text) AS type_name,
    COALESCE(dt.sort_order, 0) AS type_sort,
    NULL::uuid AS variant_id,
    NULL::text AS variant_name,
    s.sub_number AS doc_number,
    s.status,
        CASE
            WHEN lower(COALESCE(s.status, ''::text)) = 'entwurf'::text THEN 'entwurf'::text
            WHEN lower(COALESCE(s.status, ''::text)) = 'storniert'::text THEN 'storniert'::text
            WHEN lower(COALESCE(s.status, ''::text)) = 'versendet'::text THEN 'versendet'::text
            ELSE 'abgeschlossen'::text
        END AS status_norm,
    NULL::text AS payment_status,
    lower(COALESCE(s.status, ''::text)) = 'entwurf'::text AS is_draft,
    false AS is_archived,
    lower(COALESCE(s.status, ''::text)) = 'storniert'::text AS is_canceled,
    false AS is_locked,
    false AS convertible,
    s.subcontractor_id AS customer_id,
    c.name AS customer_name,
    s.project_id,
    p.project_number,
    p.title AS project_title,
    p.address AS object_address,
    s.title,
    COALESCE(s.sub_date, s.created_at::date) AS doc_date,
    EXTRACT(year FROM COALESCE(s.sub_date::timestamp with time zone, s.created_at))::integer AS doc_year,
    s.net,
    s.gross,
    s.created_by AS editor_id,
    pr.name AS editor_name,
    s.created_at,
    COALESCE(s.updated_at, s.created_at) AS last_change,
    NULL::text AS file_url,
    lower(concat_ws(' '::text, s.sub_number, s.title, c.name, c.email, p.project_number, p.title, p.address, pr.name, s.status)) AS search_text
   FROM sub_orders s
     LEFT JOIN document_types dt ON dt.slug = 'auftrag_sub'::text AND NOT dt.organization_id IS DISTINCT FROM s.organization_id
     LEFT JOIN cust c ON c.id = s.subcontractor_id
     LEFT JOIN proj p ON p.id = s.project_id
     LEFT JOIN profiles pr ON pr.id = s.created_by
  WHERE s.deleted_at IS NULL;
create or replace view public."documents_unified" as
 SELECT id,
    kind,
    organization_id,
    document_type_id,
    type_slug,
    type_name,
    type_sort,
    variant_id,
    variant_name,
    doc_number,
    status,
    status_norm,
    payment_status,
    is_draft,
    is_archived,
    is_canceled,
    is_locked,
    convertible,
    customer_id,
    customer_name,
    project_id,
    project_number,
    project_title,
    object_address,
    title,
    doc_date,
    doc_year,
    net,
    gross,
    editor_id,
    editor_name,
    created_at,
    last_change,
    file_url,
    search_text,
    regexp_replace(search_text, '[^a-z0-9]'::text, ''::text, 'g'::text) AS search_norm
   FROM documents_unified_core c;
alter view public."documents_unified" set (security_invoker=true);

-- ---------- Row Level Security ----------
alter table public."ai_action_logs" enable row level security;
alter table public."ai_logs" enable row level security;
alter table public."ai_settings" enable row level security;
alter table public."ai_usage_logs" enable row level security;
alter table public."anfrage_events" enable row level security;
alter table public."anfragen" enable row level security;
alter table public."api_rate_limit" enable row level security;
alter table public."appointments" enable row level security;
alter table public."articles" enable row level security;
alter table public."automation_runs" enable row level security;
alter table public."automations" enable row level security;
alter table public."buak_calendar" enable row level security;
alter table public."calc_audit_log" enable row level security;
alter table public."catalog_items" enable row level security;
alter table public."company_settings" enable row level security;
alter table public."company_work_calendar_settings" enable row level security;
alter table public."company_work_day_rules" enable row level security;
alter table public."contact_persons" enable row level security;
alter table public."contacts" enable row level security;
alter table public."document_audit_log" enable row level security;
alter table public."document_pdf_cache" enable row level security;
alter table public."document_subtypes" enable row level security;
alter table public."document_templates" enable row level security;
alter table public."document_type_transitions" enable row level security;
alter table public."document_types" enable row level security;
alter table public."document_versions" enable row level security;
alter table public."documents" enable row level security;
alter table public."employees" enable row level security;
alter table public."hourly_rates" enable row level security;
alter table public."invoice_items" enable row level security;
alter table public."invoice_offers" enable row level security;
alter table public."invoices" enable row level security;
alter table public."mail_templates" enable row level security;
alter table public."media_categories" enable row level security;
alter table public."memberships" enable row level security;
alter table public."microsoft_mail_audit_log" enable row level security;
alter table public."microsoft_oauth_tokens" enable row level security;
alter table public."number_ranges" enable row level security;
alter table public."offer_display_settings" enable row level security;
alter table public."offer_types" enable row level security;
alter table public."offers" enable row level security;
alter table public."order_items" enable row level security;
alter table public."orders" enable row level security;
alter table public."organizations" enable row level security;
alter table public."perm_audit_log" enable row level security;
alter table public."permission_groups" enable row level security;
alter table public."permission_modules" enable row level security;
alter table public."planning_absences" enable row level security;
alter table public."planning_categories" enable row level security;
alter table public."planning_event_employees" enable row level security;
alter table public."planning_event_resources" enable row level security;
alter table public."planning_event_types" enable row level security;
alter table public."planning_events" enable row level security;
alter table public."planning_resource_types" enable row level security;
alter table public."planning_resources" enable row level security;
alter table public."profiles" enable row level security;
alter table public."project_appointments" enable row level security;
alter table public."project_checklist_items" enable row level security;
alter table public."project_checklists" enable row level security;
alter table public."project_log" enable row level security;
alter table public."project_media" enable row level security;
alter table public."project_meeting_items" enable row level security;
alter table public."project_meeting_participants" enable row level security;
alter table public."project_meetings" enable row level security;
alter table public."project_participants" enable row level security;
alter table public."project_signatures" enable row level security;
alter table public."project_statuses" enable row level security;
alter table public."project_statuses_global" enable row level security;
alter table public."project_type_statuses" enable row level security;
alter table public."project_types" enable row level security;
alter table public."projects" enable row level security;
alter table public."role_permissions" enable row level security;
alter table public."role_scopes" enable row level security;
alter table public."roles" enable row level security;
alter table public."service_components" enable row level security;
alter table public."services" enable row level security;
alter table public."sub_order_items" enable row level security;
alter table public."sub_orders" enable row level security;
alter table public."tasks" enable row level security;
alter table public."text_blocks" enable row level security;
alter table public."time_entries" enable row level security;
alter table public."trades" enable row level security;
alter table public."units" enable row level security;
alter table public."user_access" enable row level security;
alter table public."user_roles" enable row level security;
alter table public."voice_input_templates" enable row level security;
alter table public."voice_transcripts" enable row level security;
alter table public."work_time_models" enable row level security;

-- ---------- Policies (public) ----------
create policy "app_all" on public."ai_action_logs" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."ai_action_logs" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "ai_logs_delete" on public."ai_logs" for delete to authenticated
  using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
create policy "ai_logs_insert" on public."ai_logs" for insert to authenticated
  with check ((user_id = auth.uid()));
create policy "ai_logs_select" on public."ai_logs" for select to authenticated
  using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
create policy "ai_logs_update" on public."ai_logs" for update to authenticated
  using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))))
  with check (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
create policy "ai_settings_insert" on public."ai_settings" for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
create policy "ai_settings_select" on public."ai_settings" for select to authenticated
  using (true);
create policy "ai_settings_update" on public."ai_settings" for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
create policy "app_all" on public."ai_settings" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."ai_settings" as restrictive for all to authenticated
  using (((org_id = current_org_id()) OR (org_id IS NULL)))
  with check (((org_id = current_org_id()) OR (org_id IS NULL)));
create policy "app_all" on public."ai_usage_logs" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."ai_usage_logs" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "anfrage_events_app_all" on public."anfrage_events" for all to authenticated
  using (true)
  with check (true);
create policy "anfrage_events_org_isolation" on public."anfrage_events" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "anfragen_app_all" on public."anfragen" for all to authenticated
  using (true)
  with check (true);
create policy "anfragen_org_isolation" on public."anfragen" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "arl_app_all" on public."api_rate_limit" for all to authenticated
  using (true)
  with check (true);
create policy "arl_own_only" on public."api_rate_limit" as restrictive for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy "appointments_delete" on public."appointments" for delete to authenticated
  using (((created_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
create policy "appointments_insert" on public."appointments" for insert to authenticated
  with check ((created_by = auth.uid()));
create policy "appointments_select" on public."appointments" for select to authenticated
  using (true);
create policy "appointments_update" on public."appointments" for update to authenticated
  using (((created_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))))
  with check (((created_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
create policy "org_isolation" on public."appointments" as restrictive for all to public
  using ((org_id = current_org_id()))
  with check ((org_id = current_org_id()));
create policy "mod" on public."articles" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.articles'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.articles'::text, 'edit'::text)));
create policy "org_isolation" on public."articles" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."articles" for select to authenticated
  using (true);
create policy "del" on public."automation_runs" for delete to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'automations'::text, 'delete'::text)));
create policy "ins" on public."automation_runs" for insert to public
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'automations'::text, 'view'::text)));
create policy "org_isolation" on public."automation_runs" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."automation_runs" for select to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'automations'::text, 'view'::text)));
create policy "del" on public."automations" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'automations'::text, 'delete'::text)));
create policy "ins" on public."automations" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'automations'::text, 'create'::text)));
create policy "org_isolation" on public."automations" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."automations" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'automations'::text, 'view'::text)));
create policy "upd" on public."automations" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'automations'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'automations'::text, 'edit'::text)));
create policy "app_all" on public."buak_calendar" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."buak_calendar" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_read" on public."calc_audit_log" for select to authenticated
  using (true);
create policy "org_isolation" on public."calc_audit_log" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "del" on public."catalog_items" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'delete'::text)));
create policy "ins" on public."catalog_items" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'create'::text)));
create policy "org_isolation" on public."catalog_items" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."catalog_items" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'view'::text)));
create policy "upd" on public."catalog_items" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'edit'::text)));
create policy "mod" on public."company_settings" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.company'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.company'::text, 'edit'::text)));
create policy "org_isolation" on public."company_settings" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."company_settings" for select to authenticated
  using (true);
create policy "mod" on public."company_work_calendar_settings" for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."company_work_calendar_settings" for select to authenticated
  using ((organization_id = current_org_id()));
create policy "mod" on public."company_work_day_rules" for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."company_work_day_rules" for select to authenticated
  using ((organization_id = current_org_id()));
create policy "del" on public."contact_persons" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'delete'::text)));
create policy "ins" on public."contact_persons" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'create'::text)));
create policy "org_isolation" on public."contact_persons" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."contact_persons" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'view'::text)));
create policy "upd" on public."contact_persons" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'edit'::text)));
create policy "del" on public."contacts" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'delete'::text)));
create policy "ins" on public."contacts" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'create'::text)));
create policy "org_isolation" on public."contacts" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."contacts" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'view'::text)));
create policy "upd" on public."contacts" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'contacts'::text, 'edit'::text)));
create policy "ins" on public."document_audit_log" for insert to authenticated
  with check ((organization_id = current_org_id()));
create policy "sel" on public."document_audit_log" for select to authenticated
  using ((organization_id = current_org_id()));
create policy "del" on public."document_pdf_cache" for delete to authenticated
  using ((organization_id = current_org_id()));
create policy "ins" on public."document_pdf_cache" for insert to authenticated
  with check ((organization_id = current_org_id()));
create policy "sel" on public."document_pdf_cache" for select to authenticated
  using ((organization_id = current_org_id()));
create policy "upd" on public."document_pdf_cache" for update to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "mod" on public."document_subtypes" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'edit'::text)));
create policy "org_isolation" on public."document_subtypes" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."document_subtypes" for select to authenticated
  using (true);
create policy "mod" on public."document_templates" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.document_types'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.document_types'::text, 'edit'::text)));
create policy "org_isolation" on public."document_templates" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."document_templates" for select to authenticated
  using (true);
create policy "dtt_all" on public."document_type_transitions" for all to authenticated
  using (true)
  with check (true);
create policy "dtt_org_isolation" on public."document_type_transitions" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."document_types" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."document_types" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "ins" on public."document_versions" for insert to authenticated
  with check ((organization_id = current_org_id()));
create policy "sel" on public."document_versions" for select to authenticated
  using ((organization_id = current_org_id()));
create policy "del" on public."documents" for delete to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'documents'::text, 'delete'::text)));
create policy "hide_soft_deleted" on public."documents" as restrictive for select to authenticated
  using ((deleted_at IS NULL));
create policy "ins" on public."documents" for insert to public
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'documents'::text, 'create'::text)));
create policy "org_isolation" on public."documents" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."documents" for select to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'documents'::text, 'view'::text)));
create policy "upd" on public."documents" for update to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'documents'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'documents'::text, 'edit'::text)));
create policy "del" on public."employees" for delete to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'employees'::text, 'delete'::text)));
create policy "ins" on public."employees" for insert to public
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'employees'::text, 'create'::text)));
create policy "org_isolation" on public."employees" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."employees" for select to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'employees'::text, 'view'::text)));
create policy "upd" on public."employees" for update to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'employees'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'employees'::text, 'edit'::text)));
create policy "mod" on public."hourly_rates" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.hourly_rates'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.hourly_rates'::text, 'edit'::text)));
create policy "org_isolation" on public."hourly_rates" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."hourly_rates" for select to authenticated
  using (true);
create policy "del" on public."invoice_items" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'delete'::text)));
create policy "ins" on public."invoice_items" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'create'::text)));
create policy "org_isolation" on public."invoice_items" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."invoice_items" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'view'::text)));
create policy "upd" on public."invoice_items" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'edit'::text)));
create policy "del" on public."invoice_offers" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'delete'::text)));
create policy "ins" on public."invoice_offers" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'create'::text)));
create policy "org_isolation" on public."invoice_offers" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."invoice_offers" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'view'::text)));
create policy "upd" on public."invoice_offers" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'edit'::text)));
create policy "del" on public."invoices" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'delete'::text)));
create policy "hide_soft_deleted" on public."invoices" as restrictive for select to authenticated
  using ((deleted_at IS NULL));
create policy "ins" on public."invoices" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'create'::text)));
create policy "org_isolation" on public."invoices" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."invoices" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'view'::text)));
create policy "upd" on public."invoices" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'invoices'::text, 'edit'::text)));
create policy "app_all" on public."mail_templates" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."mail_templates" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "mod" on public."media_categories" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.media_categories'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.media_categories'::text, 'edit'::text)));
create policy "org_isolation" on public."media_categories" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."media_categories" for select to authenticated
  using (true);
create policy "mem_sel" on public."memberships" for select to authenticated
  using ((user_id = auth.uid()));
create policy "mmal_app_all" on public."microsoft_mail_audit_log" for all to authenticated
  using (true)
  with check (true);
create policy "mmal_org_isolation" on public."microsoft_mail_audit_log" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "msot_app_all" on public."microsoft_oauth_tokens" for all to authenticated
  using (true)
  with check (true);
create policy "msot_org_user_isolation" on public."microsoft_oauth_tokens" as restrictive for all to authenticated
  using (((organization_id = current_org_id()) AND (user_id = auth.uid())))
  with check (((organization_id = current_org_id()) AND (user_id = auth.uid())));
create policy "mod" on public."number_ranges" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.number_ranges'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.number_ranges'::text, 'edit'::text)));
create policy "org_isolation" on public."number_ranges" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."number_ranges" for select to authenticated
  using (true);
create policy "app_all" on public."offer_display_settings" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."offer_display_settings" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."offer_types" for all to public
  using (true)
  with check (true);
create policy "org_isolation" on public."offer_types" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "del" on public."offers" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'offers'::text, 'delete'::text)));
create policy "hide_soft_deleted" on public."offers" as restrictive for select to authenticated
  using ((deleted_at IS NULL));
create policy "ins" on public."offers" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'offers'::text, 'create'::text)));
create policy "org_isolation" on public."offers" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."offers" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'offers'::text, 'view'::text)));
create policy "upd" on public."offers" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'offers'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'offers'::text, 'edit'::text)));
create policy "del" on public."order_items" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'delete'::text)));
create policy "ins" on public."order_items" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'create'::text)));
create policy "org_isolation" on public."order_items" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."order_items" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'view'::text)));
create policy "upd" on public."order_items" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'edit'::text)));
create policy "del" on public."orders" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'delete'::text)));
create policy "hide_soft_deleted" on public."orders" as restrictive for select to authenticated
  using ((deleted_at IS NULL));
create policy "ins" on public."orders" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'create'::text)));
create policy "org_isolation" on public."orders" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."orders" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'view'::text)));
create policy "upd" on public."orders" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'edit'::text)));
create policy "org_sel" on public."organizations" for select to authenticated
  using ((id = current_org_id()));
create policy "audit_admin_read" on public."perm_audit_log" for select to authenticated
  using (b4y_is_admin(auth.uid()));
create policy "org_isolation" on public."perm_audit_log" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "perm_def_read" on public."permission_groups" for select to authenticated
  using (true);
create policy "perm_def_write" on public."permission_groups" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "perm_def_read" on public."permission_modules" for select to authenticated
  using (true);
create policy "perm_def_write" on public."permission_modules" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "app_all" on public."planning_absences" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."planning_absences" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."planning_categories" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."planning_categories" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."planning_event_employees" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."planning_event_employees" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."planning_event_resources" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."planning_event_resources" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."planning_event_types" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."planning_event_types" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."planning_events" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."planning_events" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."planning_resource_types" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."planning_resource_types" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."planning_resources" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."planning_resources" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "prof_ins" on public."profiles" for insert to authenticated
  with check (((id = auth.uid()) OR b4y_is_admin(auth.uid())));
create policy "prof_sel" on public."profiles" for select to authenticated
  using (((id = auth.uid()) OR b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'employees'::text, 'view'::text)));
create policy "prof_upd" on public."profiles" for update to authenticated
  using (((id = auth.uid()) OR b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'employees'::text, 'edit'::text)))
  with check (((id = auth.uid()) OR b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'employees'::text, 'edit'::text)));
create policy "del" on public."project_appointments" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'delete'::text)));
create policy "ins" on public."project_appointments" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'create'::text)));
create policy "org_isolation" on public."project_appointments" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."project_appointments" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'view'::text)));
create policy "upd" on public."project_appointments" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)));
create policy "del" on public."project_checklist_items" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'delete'::text)));
create policy "ins" on public."project_checklist_items" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'create'::text)));
create policy "org_isolation" on public."project_checklist_items" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."project_checklist_items" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'view'::text)));
create policy "upd" on public."project_checklist_items" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)));
create policy "del" on public."project_checklists" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'delete'::text)));
create policy "ins" on public."project_checklists" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'create'::text)));
create policy "org_isolation" on public."project_checklists" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."project_checklists" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'view'::text)));
create policy "upd" on public."project_checklists" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)));
create policy "del" on public."project_log" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'delete'::text)));
create policy "ins" on public."project_log" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'create'::text)));
create policy "org_isolation" on public."project_log" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."project_log" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'view'::text)));
create policy "upd" on public."project_log" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)));
create policy "del" on public."project_media" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'media.photos'::text, 'delete'::text)));
create policy "ins" on public."project_media" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'media.photos'::text, 'create'::text)));
create policy "org_isolation" on public."project_media" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."project_media" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'media.photos'::text, 'view'::text)));
create policy "upd" on public."project_media" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'media.photos'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'media.photos'::text, 'edit'::text)));
create policy "app_all" on public."project_meeting_items" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."project_meeting_items" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."project_meeting_participants" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."project_meeting_participants" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "app_all" on public."project_meetings" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."project_meetings" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "del" on public."project_participants" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'delete'::text)));
create policy "ins" on public."project_participants" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'create'::text)));
create policy "org_isolation" on public."project_participants" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."project_participants" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'view'::text)));
create policy "upd" on public."project_participants" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)));
create policy "app_all" on public."project_signatures" for all to authenticated
  using (true)
  with check (true);
create policy "org_isolation" on public."project_signatures" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "mod" on public."project_statuses" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.project_statuses'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.project_statuses'::text, 'edit'::text)));
create policy "org_isolation" on public."project_statuses" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."project_statuses" for select to authenticated
  using (true);
create policy "psg_all" on public."project_statuses_global" for all to authenticated
  using (true)
  with check (true);
create policy "psg_org_isolation" on public."project_statuses_global" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "pts_all" on public."project_type_statuses" for all to authenticated
  using (true)
  with check (true);
create policy "pts_org_isolation" on public."project_type_statuses" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "mod" on public."project_types" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects.types'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects.types'::text, 'edit'::text)));
create policy "org_isolation" on public."project_types" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."project_types" for select to authenticated
  using (true);
create policy "del" on public."projects" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'delete'::text)));
create policy "ins" on public."projects" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'create'::text)));
create policy "org_isolation" on public."projects" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."projects" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'view'::text)));
create policy "upd" on public."projects" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'projects'::text, 'edit'::text)));
create policy "org_isolation" on public."role_permissions" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "perm_def_read" on public."role_permissions" for select to authenticated
  using (true);
create policy "perm_def_write" on public."role_permissions" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "org_isolation" on public."role_scopes" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "perm_def_read" on public."role_scopes" for select to authenticated
  using (true);
create policy "perm_def_write" on public."role_scopes" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "org_isolation" on public."roles" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "perm_def_read" on public."roles" for select to authenticated
  using (true);
create policy "perm_def_write" on public."roles" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "mod" on public."service_components" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.services'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.services'::text, 'edit'::text)));
create policy "org_isolation" on public."service_components" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."service_components" for select to authenticated
  using (true);
create policy "mod" on public."services" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.services'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.services'::text, 'edit'::text)));
create policy "org_isolation" on public."services" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."services" for select to authenticated
  using (true);
create policy "del" on public."sub_order_items" for delete to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'delete'::text)));
create policy "ins" on public."sub_order_items" for insert to public
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'create'::text)));
create policy "org_isolation" on public."sub_order_items" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."sub_order_items" for select to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'view'::text)));
create policy "upd" on public."sub_order_items" for update to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'edit'::text)));
create policy "del" on public."sub_orders" for delete to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'delete'::text)));
create policy "hide_soft_deleted" on public."sub_orders" as restrictive for select to public
  using ((deleted_at IS NULL));
create policy "ins" on public."sub_orders" for insert to public
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'create'::text)));
create policy "org_isolation" on public."sub_orders" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."sub_orders" for select to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'view'::text)));
create policy "upd" on public."sub_orders" for update to public
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'orders'::text, 'edit'::text)));
create policy "del" on public."tasks" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'tasks'::text, 'delete'::text)));
create policy "ins" on public."tasks" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'tasks'::text, 'create'::text)));
create policy "org_isolation" on public."tasks" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."tasks" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'tasks'::text, 'view'::text)));
create policy "upd" on public."tasks" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'tasks'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'tasks'::text, 'edit'::text)));
create policy "mod" on public."text_blocks" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation'::text, 'edit'::text)));
create policy "org_isolation" on public."text_blocks" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."text_blocks" for select to authenticated
  using (true);
create policy "del" on public."time_entries" for delete to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'time_tracking'::text, 'delete'::text)));
create policy "ins" on public."time_entries" for insert to authenticated
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'time_tracking'::text, 'create'::text)));
create policy "org_isolation" on public."time_entries" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."time_entries" for select to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'time_tracking'::text, 'view'::text)));
create policy "upd" on public."time_entries" for update to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'time_tracking'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'time_tracking'::text, 'edit'::text)));
create policy "mod" on public."trades" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.trades'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.trades'::text, 'edit'::text)));
create policy "org_isolation" on public."trades" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."trades" for select to authenticated
  using (true);
create policy "mod" on public."units" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.units'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'kalkulation.units'::text, 'edit'::text)));
create policy "org_isolation" on public."units" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."units" for select to authenticated
  using (true);
create policy "org_isolation" on public."user_access" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "user_admin_write" on public."user_access" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "user_self_read" on public."user_access" for select to authenticated
  using (((user_id = auth.uid()) OR b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "org_isolation" on public."user_roles" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "user_admin_write" on public."user_roles" for all to authenticated
  using ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)))
  with check ((b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "user_self_read" on public."user_roles" for select to authenticated
  using (((user_id = auth.uid()) OR b4y_is_admin(auth.uid()) OR b4y_has_permission(auth.uid(), 'settings.permissions'::text, 'edit'::text)));
create policy "voice_input_templates_app_all" on public."voice_input_templates" for all to authenticated
  using (true)
  with check (true);
create policy "voice_input_templates_org_isolation" on public."voice_input_templates" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "voice_transcripts_app_all" on public."voice_transcripts" for all to authenticated
  using (true)
  with check (true);
create policy "voice_transcripts_org_isolation" on public."voice_transcripts" as restrictive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "mod" on public."work_time_models" for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));
create policy "sel" on public."work_time_models" for select to authenticated
  using ((organization_id = current_org_id()));

-- ---------- Trigger ----------
CREATE TRIGGER trg_anfragen_touch BEFORE INSERT OR UPDATE ON public.anfragen FOR EACH ROW EXECUTE FUNCTION tg_anfragen_touch();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION appointments_set_updated_at();
CREATE TRIGGER trg_audit_articles AFTER INSERT OR DELETE OR UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION b4y_calc_audit('article');
CREATE TRIGGER trg_touch_articles BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_buak BEFORE UPDATE ON public.buak_calendar FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_document_templates BEFORE UPDATE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_doctype_compliance BEFORE INSERT OR UPDATE ON public.document_types FOR EACH ROW EXECUTE FUNCTION enforce_doctype_compliance();
CREATE TRIGGER trg_prevent_delete_system_doctype BEFORE DELETE ON public.document_types FOR EACH ROW EXECUTE FUNCTION prevent_delete_system_doctype();
CREATE TRIGGER trg_touch_document_types BEFORE UPDATE ON public.document_types FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_documents BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_employees BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_audit_hourly_rates AFTER INSERT OR DELETE OR UPDATE ON public.hourly_rates FOR EACH ROW EXECUTE FUNCTION b4y_calc_audit('hourly_rate');
CREATE TRIGGER trg_touch_hourly_rates BEFORE UPDATE ON public.hourly_rates FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_mail_templates BEFORE UPDATE ON public.mail_templates FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_media_categories BEFORE UPDATE ON public.media_categories FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_microsoft_oauth_tokens_touch BEFORE UPDATE ON public.microsoft_oauth_tokens FOR EACH ROW EXECUTE FUNCTION touch_microsoft_oauth_tokens_updated_at();
CREATE TRIGGER trg_offer_types_touch BEFORE UPDATE ON public.offer_types FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_prevent_delete_system_offer_type BEFORE DELETE ON public.offer_types FOR EACH ROW EXECUTE FUNCTION prevent_delete_system_offer_type();
CREATE TRIGGER trg_audit_role_permissions AFTER INSERT OR DELETE OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION b4y_perm_audit('role_permission');
CREATE TRIGGER trg_audit_role_scopes AFTER INSERT OR DELETE OR UPDATE ON public.role_scopes FOR EACH ROW EXECUTE FUNCTION b4y_perm_audit('role_scope');
CREATE TRIGGER trg_audit_roles AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION b4y_perm_audit('role');
CREATE TRIGGER trg_guard_role_admin BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION b4y_guard_role_admin();
CREATE TRIGGER trg_audit_service_components AFTER INSERT OR DELETE OR UPDATE ON public.service_components FOR EACH ROW EXECUTE FUNCTION b4y_calc_audit('service_component');
CREATE TRIGGER trg_touch_service_components BEFORE UPDATE ON public.service_components FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_audit_services AFTER INSERT OR DELETE OR UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION b4y_calc_audit('service');
CREATE TRIGGER trg_touch_services BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_text_blocks BEFORE UPDATE ON public.text_blocks FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_trades BEFORE UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_touch_units BEFORE UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION b4y_touch_updated_at();
CREATE TRIGGER trg_audit_user_access AFTER INSERT OR DELETE OR UPDATE ON public.user_access FOR EACH ROW EXECUTE FUNCTION b4y_perm_audit('user_access');
CREATE TRIGGER trg_audit_user_roles AFTER INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION b4y_perm_audit('user_role');
CREATE TRIGGER trg_guard_last_admin_userrole BEFORE DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION b4y_guard_last_admin();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER trg_voice_input_templates_touch BEFORE UPDATE ON public.voice_input_templates FOR EACH ROW EXECUTE FUNCTION tg_voice_input_templates_touch();

-- ---------- Storage-Buckets ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('article-images', 'article-images', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('document-images', 'document-images', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('document-pdfs', 'document-pdfs', false, 26214400, array['application/pdf'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('project-files', 'project-files', false, 52428800, null)
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('service-images', 'service-images', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('voice-recordings', 'voice-recordings', false, 26214400, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/m4a', 'audio/x-m4a'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------- Storage-Policies ----------
drop policy if exists "article_images_auth_read" on storage."objects";
create policy "article_images_auth_read" on storage."objects" for select to authenticated
  using ((bucket_id = 'article-images'::text));
drop policy if exists "article_images_delete" on storage."objects";
create policy "article_images_delete" on storage."objects" for delete to authenticated
  using ((bucket_id = 'article-images'::text));
drop policy if exists "article_images_insert" on storage."objects";
create policy "article_images_insert" on storage."objects" for insert to authenticated
  with check ((bucket_id = 'article-images'::text));
drop policy if exists "article_images_update" on storage."objects";
create policy "article_images_update" on storage."objects" for update to authenticated
  using ((bucket_id = 'article-images'::text))
  with check ((bucket_id = 'article-images'::text));
drop policy if exists "branding_auth_delete" on storage."objects";
create policy "branding_auth_delete" on storage."objects" for delete to authenticated
  using ((bucket_id = 'branding'::text));
drop policy if exists "branding_auth_update" on storage."objects";
create policy "branding_auth_update" on storage."objects" for update to authenticated
  using ((bucket_id = 'branding'::text))
  with check ((bucket_id = 'branding'::text));
drop policy if exists "branding_auth_write" on storage."objects";
create policy "branding_auth_write" on storage."objects" for insert to authenticated
  with check ((bucket_id = 'branding'::text));
drop policy if exists "branding_public_read" on storage."objects";
create policy "branding_public_read" on storage."objects" for select to public
  using ((bucket_id = 'branding'::text));
drop policy if exists "document_images_org_delete" on storage."objects";
create policy "document_images_org_delete" on storage."objects" for delete to authenticated
  using (((bucket_id = 'document-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "document_images_org_read" on storage."objects";
create policy "document_images_org_read" on storage."objects" for select to authenticated
  using (((bucket_id = 'document-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "document_images_org_update" on storage."objects";
create policy "document_images_org_update" on storage."objects" for update to authenticated
  using (((bucket_id = 'document-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)))
  with check (((bucket_id = 'document-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "document_images_org_write" on storage."objects";
create policy "document_images_org_write" on storage."objects" for insert to authenticated
  with check (((bucket_id = 'document-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "document_pdfs_org_delete" on storage."objects";
create policy "document_pdfs_org_delete" on storage."objects" for delete to authenticated
  using (((bucket_id = 'document-pdfs'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "document_pdfs_org_read" on storage."objects";
create policy "document_pdfs_org_read" on storage."objects" for select to authenticated
  using (((bucket_id = 'document-pdfs'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "document_pdfs_org_update" on storage."objects";
create policy "document_pdfs_org_update" on storage."objects" for update to authenticated
  using (((bucket_id = 'document-pdfs'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)))
  with check (((bucket_id = 'document-pdfs'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "document_pdfs_org_write" on storage."objects";
create policy "document_pdfs_org_write" on storage."objects" for insert to authenticated
  with check (((bucket_id = 'document-pdfs'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "project_files_all" on storage."objects";
create policy "project_files_all" on storage."objects" for all to authenticated
  using ((bucket_id = 'project-files'::text))
  with check ((bucket_id = 'project-files'::text));
drop policy if exists "project_files_auth_read" on storage."objects";
create policy "project_files_auth_read" on storage."objects" for select to authenticated
  using ((bucket_id = 'project-files'::text));
drop policy if exists "project_files_read" on storage."objects";
create policy "project_files_read" on storage."objects" for select to anon
  using ((bucket_id = 'project-files'::text));
drop policy if exists "service_images_org_delete" on storage."objects";
create policy "service_images_org_delete" on storage."objects" for delete to authenticated
  using (((bucket_id = 'service-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "service_images_org_read" on storage."objects";
create policy "service_images_org_read" on storage."objects" for select to authenticated
  using (((bucket_id = 'service-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "service_images_org_update" on storage."objects";
create policy "service_images_org_update" on storage."objects" for update to authenticated
  using (((bucket_id = 'service-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)))
  with check (((bucket_id = 'service-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "service_images_org_write" on storage."objects";
create policy "service_images_org_write" on storage."objects" for insert to authenticated
  with check (((bucket_id = 'service-images'::text) AND ((storage.foldername(name))[1] = (( SELECT current_org_id() AS current_org_id))::text)));
drop policy if exists "voice_recordings_auth_delete" on storage."objects";
create policy "voice_recordings_auth_delete" on storage."objects" for delete to authenticated
  using (((bucket_id = 'voice-recordings'::text) AND ((storage.foldername(name))[1] = (current_org_id())::text) AND (owner = auth.uid())));
drop policy if exists "voice_recordings_auth_insert" on storage."objects";
create policy "voice_recordings_auth_insert" on storage."objects" for insert to authenticated
  with check (((bucket_id = 'voice-recordings'::text) AND ((storage.foldername(name))[1] = (current_org_id())::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));
drop policy if exists "voice_recordings_auth_select" on storage."objects";
create policy "voice_recordings_auth_select" on storage."objects" for select to authenticated
  using (((bucket_id = 'voice-recordings'::text) AND ((storage.foldername(name))[1] = (current_org_id())::text)));
drop policy if exists "voice_recordings_auth_update" on storage."objects";
create policy "voice_recordings_auth_update" on storage."objects" for update to authenticated
  using (((bucket_id = 'voice-recordings'::text) AND ((storage.foldername(name))[1] = (current_org_id())::text) AND (owner = auth.uid())))
  with check (((bucket_id = 'voice-recordings'::text) AND ((storage.foldername(name))[1] = (current_org_id())::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));

-- ---------- Realtime-Publikation ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
                 and schemaname='public' and tablename='anfrage_events') then
    alter publication supabase_realtime add table public."anfrage_events";
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
                 and schemaname='public' and tablename='anfragen') then
    alter publication supabase_realtime add table public."anfragen";
  end if;
end $$;
