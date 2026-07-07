-- Richtungswechsel: Variable Position / Regiestunde / Regiematerial werden künftig
-- DIREKT im Dokumenteditor eingefügt (Auswahl beim Bearbeiten), nicht mehr als
-- automatische Stammleistungen geführt. Daher Auto-Trigger + System-Leistungen entfernen
-- (kehrt 0057/0059 fachlich um). Manuelle Leistungen/Artikel bleiben unberührt.

drop trigger if exists trg_trade_system_services on trades;
drop trigger if exists trg_rate_regie_service on hourly_rates;
drop trigger if exists trg_trade_rename_services on trades;
drop trigger if exists trg_rate_update_services on hourly_rates;
drop function if exists b4y_trg_trade_ins();
drop function if exists b4y_trg_rate_ins();
drop function if exists b4y_trg_trade_upd();
drop function if exists b4y_trg_rate_upd();
drop function if exists b4y_ensure_trade_system_services(uuid);
drop function if exists b4y_ensure_rate_regie_service(uuid);

-- Nur automatisch erzeugte System-Leistungen (+ Komponenten) entfernen
delete from service_components where service_id in (select id from services where system_generated);
delete from services where system_generated;

-- Mandanten-Standard für Regiematerial im Dokument (Editor-Logik)
--   ask | none | manual | percent | fixed   (Default: immer fragen)
alter table company_settings add column if not exists regie_material_default_mode text not null default 'ask';
alter table company_settings add column if not exists regie_material_default_percent numeric not null default 20;

-- Hinweis: Spalten/Indizes is_variable_template/is_regie_*_template/source_hourly_rate_id
-- bleiben bestehen (harmlos, keine Zeilen mehr) – kein riskanter Schema-Rückbau nötig.
