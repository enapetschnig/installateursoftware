-- ============================================================
-- B4Y SuperAPP – Automatische System-Leistungen je Gewerk/Stundensatz
-- Pro Gewerk:  999 Variable Position, 998 Material Regie
-- Pro Stundensatz: 990+ Regiestunde (nutzt den Stundensatz)
-- Mandantenfähig (organization_id), dublettensicher (partielle Unique-Indizes),
-- mehrbenutzersicher (Trigger in Transaktion + Indizes), auditierbar (vorhandener
-- services-Audit-Trigger + Fehler-Log). Nummern via positions_nummer; die
-- Gewerknummer (z.B. 01) bleibt Anzeige-Ableitung aus trades.sort_order.
-- ============================================================

-- 1) Kennzeichnungs-Spalten
alter table services add column if not exists system_generated boolean not null default false;
alter table services add column if not exists is_regie_material_template boolean not null default false;
alter table services add column if not exists is_regie_hour_template boolean not null default false;
alter table services add column if not exists source_hourly_rate_id uuid references hourly_rates(id) on delete set null;

-- 2) Vorhandene Variable-Vorlagen (Migr.0057) als System-Leistung mit Nummer 999 markieren
update services
   set system_generated = true,
       positions_nummer = coalesce(positions_nummer, '999')
 where is_variable_template = true;

-- 3) Dubletten-Schutz (pro Mandant/Gewerk/Nummer bzw. pro Stundensatz)
create unique index if not exists uq_services_system_num
  on services(organization_id, trade_id, positions_nummer)
  where system_generated and positions_nummer is not null;
create unique index if not exists uq_services_regie_rate
  on services(source_hourly_rate_id)
  where source_hourly_rate_id is not null;

-- 4) Funktion: System-Leistungen (999 variabel, 998 Material-Regie) je Gewerk sicherstellen
create or replace function b4y_ensure_trade_system_services(p_trade_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare t record;
begin
  select * into t from trades where id = p_trade_id;
  if not found then return; end if;

  if not exists (select 1 from services s where s.trade_id = t.id
       and s.organization_id is not distinct from t.organization_id and s.is_variable_template) then
    insert into services(name, trade_id, category, unit, vat_rate, vk_net_manual, material_mode,
                         aufschlag_percent, active, is_variable_template, system_generated,
                         positions_nummer, short_text, organization_id)
    values ('Variable Position – '||t.name, t.id, t.name, 'pauschal', 20, 0, 'kein',
            0, true, true, true, '999', 'Frei anpassbare Position für '||t.name, t.organization_id);
  end if;

  if not exists (select 1 from services s where s.trade_id = t.id
       and s.organization_id is not distinct from t.organization_id and s.is_regie_material_template) then
    insert into services(name, trade_id, category, unit, vat_rate, vk_net_manual, material_mode,
                         aufschlag_percent, active, is_regie_material_template, system_generated,
                         positions_nummer, short_text, organization_id)
    values ('Material Regie – '||t.name, t.id, t.name, 'pauschal', 20, 0, 'kein',
            0, true, true, true, '998', 'Materialaufwand bei Regiearbeiten – frei anpassbar', t.organization_id);
  end if;
exception when others then
  insert into calc_audit_log(entity_type, entity_id, action, new_data, organization_id)
  values ('service_automation', p_trade_id, 'auto_create_error',
          jsonb_build_object('context','trade','error',SQLERRM),
          (select organization_id from trades where id = p_trade_id));
end; $fn$;

-- 5) Funktion: Regiestunden-Leistung je Stundensatz sicherstellen (Nummer 990+)
create or replace function b4y_ensure_rate_regie_service(p_rate_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare r record; t record; v_num text; v_max int; v_svc uuid;
begin
  select * into r from hourly_rates where id = p_rate_id;
  if not found or r.trade_id is null then return; end if;
  select * into t from trades where id = r.trade_id;

  if exists (select 1 from services where source_hourly_rate_id = r.id) then return; end if;

  select coalesce(max(positions_nummer::int), 989) into v_max
    from services
   where trade_id = r.trade_id
     and organization_id is not distinct from r.organization_id
     and is_regie_hour_template
     and positions_nummer ~ '^99[0-9]$';
  v_num := greatest(v_max + 1, 990)::text;

  insert into services(name, trade_id, category, unit, vat_rate, material_mode, aufschlag_percent,
                       active, is_regie_hour_template, system_generated, source_hourly_rate_id,
                       positions_nummer, short_text, organization_id)
  values ('Regiestunde – '||coalesce(nullif(trim(r.label),''), t.name), r.trade_id, t.name, 'h', 20,
          'kein', 0, true, true, true, r.id, v_num, 'Regiestunde nach Aufwand', r.organization_id)
  returning id into v_svc;

  insert into service_components(service_id, kind, sort_order, label, hourly_rate_id, minutes,
                                 quantity, unit, cost_rate, sale_rate, organization_id)
  values (v_svc, 'arbeitszeit', 0, coalesce(nullif(trim(r.label),''),'Regiestunde'), r.id, 60,
          1, 'h', coalesce(r.internal_rate,0), coalesce(r.sale_rate,0), r.organization_id);
exception when others then
  insert into calc_audit_log(entity_type, entity_id, action, new_data, organization_id)
  values ('service_automation', p_rate_id, 'auto_create_error',
          jsonb_build_object('context','hourly_rate','error',SQLERRM),
          (select organization_id from hourly_rates where id = p_rate_id));
end; $fn$;

-- 6) Trigger: neue Gewerke / neue Stundensätze
create or replace function b4y_trg_trade_ins() returns trigger language plpgsql as $t$
begin perform b4y_ensure_trade_system_services(new.id); return new; end; $t$;
drop trigger if exists trg_trade_system_services on trades;
create trigger trg_trade_system_services after insert on trades
  for each row execute function b4y_trg_trade_ins();

create or replace function b4y_trg_rate_ins() returns trigger language plpgsql as $t$
begin perform b4y_ensure_rate_regie_service(new.id); return new; end; $t$;
drop trigger if exists trg_rate_regie_service on hourly_rates;
create trigger trg_rate_regie_service after insert on hourly_rates
  for each row execute function b4y_trg_rate_ins();

-- 7) Trigger: Gewerk umbenannt -> System-Leistungs-Bezeichnungen/Kategorie nachziehen (nur System)
create or replace function b4y_trg_trade_upd() returns trigger language plpgsql security definer set search_path=public as $t$
begin
  if new.name is distinct from old.name then
    update services set name = 'Variable Position – '||new.name, category = new.name
      where trade_id = new.id and system_generated and is_variable_template;
    update services set name = 'Material Regie – '||new.name, category = new.name
      where trade_id = new.id and system_generated and is_regie_material_template;
    update services set category = new.name
      where trade_id = new.id and system_generated and is_regie_hour_template;
  end if;
  return new;
end; $t$;
drop trigger if exists trg_trade_rename_services on trades;
create trigger trg_trade_rename_services after update on trades
  for each row execute function b4y_trg_trade_upd();

-- 8) Trigger: Stundensatz geändert -> verknüpfte Regiestunden-Leistung (Stamm) aktualisieren
--    Dokumente/Snapshots bleiben unberührt (eigene Kopien); nur die Stammleistung folgt.
create or replace function b4y_trg_rate_upd() returns trigger language plpgsql security definer set search_path=public as $t$
begin
  if new.sale_rate is distinct from old.sale_rate
     or new.internal_rate is distinct from old.internal_rate
     or new.label is distinct from old.label then
    update service_components sc
       set cost_rate = coalesce(new.internal_rate,0), sale_rate = coalesce(new.sale_rate,0),
           label = coalesce(nullif(trim(new.label),''), sc.label)
     where sc.hourly_rate_id = new.id and sc.kind = 'arbeitszeit'
       and sc.service_id in (select id from services where source_hourly_rate_id = new.id and system_generated);
    if new.label is distinct from old.label then
      update services s
         set name = 'Regiestunde – '||coalesce(nullif(trim(new.label),''),
                       (select name from trades where id = s.trade_id))
       where s.source_hourly_rate_id = new.id and s.system_generated and s.is_regie_hour_template;
    end if;
  end if;
  return new;
end; $t$;
drop trigger if exists trg_rate_update_services on hourly_rates;
create trigger trg_rate_update_services after update on hourly_rates
  for each row execute function b4y_trg_rate_upd();

-- 9) Backfill bestehender Gewerke + Stundensätze
do $bf$
declare x record;
begin
  for x in select id from trades loop
    perform b4y_ensure_trade_system_services(x.id);
  end loop;
  for x in select id from hourly_rates where trade_id is not null order by trade_id, created_at loop
    perform b4y_ensure_rate_regie_service(x.id);
  end loop;
end; $bf$;
