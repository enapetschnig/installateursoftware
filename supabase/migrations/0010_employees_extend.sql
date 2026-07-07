-- ============================================================
-- B4Y SuperAPP – Migration 0010
-- Mitarbeiter-Detailseite Phase B: zusätzliche Felder
-- (Anstellung, Lohn-Kategorie, Steuer, Bank, Signatur, App-Rolle)
-- + Modulrechte-Matrix. Idempotent.
-- ============================================================

-- ---------- Anstellung / Arbeitszeit ----------
alter table public.employees add column if not exists normal_weekly_hours numeric;
alter table public.employees add column if not exists trade_kv text;            -- Gewerbe / Kollektivvertrag (Anstellung)
alter table public.employees add column if not exists hours_short_week numeric; -- Stunden kurze Woche
alter table public.employees add column if not exists hours_long_week numeric;  -- Stunden lange Woche
alter table public.employees add column if not exists week_rhythm text;         -- Wechselrhythmus kurze/lange Woche
alter table public.employees add column if not exists worktime_valid_from date;

-- worktime_model: Check lockern (neue Modelle: baugewerbe_buak, maler, buero, individuell)
alter table public.employees drop constraint if exists employees_worktime_model_check;

-- ---------- Lohngruppe ----------
alter table public.employees add column if not exists wage_category text;

-- Hinweis: Berechtigungen laufen über das bestehende RBAC
-- (roles/user_roles/user_permission_overrides), NICHT über eine eigene
-- Mitarbeiter-Matrix. Daher hier bewusst keine zusätzlichen Rechte-Tabellen.

-- ---------- E-Mail-Signatur ----------
alter table public.employees add column if not exists signature_active boolean not null default false;
alter table public.employees add column if not exists signature_html text;

-- ---------- Steuerdaten (sensibel) ----------
alter table public.employees add column if not exists ssn text;                 -- Sozialversicherungsnummer
alter table public.employees add column if not exists citizenship text;
alter table public.employees add column if not exists birth_place text;
alter table public.employees add column if not exists marital_status text;
alter table public.employees add column if not exists commuter_allowance boolean not null default false;
alter table public.employees add column if not exists sole_earner text;         -- Alleinverdiener/Alleinerzieher
alter table public.employees add column if not exists tax_note text;

-- ---------- Bankdaten (sensibel) ----------
alter table public.employees add column if not exists account_holder text;
alter table public.employees add column if not exists iban text;
alter table public.employees add column if not exists bic text;
alter table public.employees add column if not exists bank_name text;
alter table public.employees add column if not exists bank_note text;
