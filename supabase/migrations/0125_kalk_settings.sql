-- ============================================================
-- 0125 – Kalkulations-Einstellungen (Voice-Angebote-Pipeline)
-- ------------------------------------------------------------
-- Bisher waren die Kalkulations-Parameter der Voice-Pipeline als
-- DEFAULT_KALK_SETTINGS hartcodiert (src/lib/calc/types.ts):
--   aufschlagGesamt 20 % | aufschlagMaterial 30 %
--   stundensatzDefault 70 € | materialCapPercent 30 %
--
-- Jetzt werden sie pro Organisation in company_settings gepflegt
-- (neuer Einstellungen-Reiter "Kalkulation"). Die Spalten-Defaults
-- entsprechen exakt den bisherigen Hardcode-Werten — bestehende
-- Orgs rechnen also unveraendert weiter, bis jemand aktiv aendert.
--
-- CHECK-Grenzen bewusst grosszuegig (0-500), damit Sonderfaelle
-- (Kampfpreise, Premium-Aufschlaege) nicht blockiert werden. Die
-- UI validiert enger.
-- ============================================================

alter table public.company_settings
  add column if not exists kalk_aufschlag_gesamt numeric not null default 20
    check (kalk_aufschlag_gesamt >= 0 and kalk_aufschlag_gesamt <= 500),
  add column if not exists kalk_aufschlag_material numeric not null default 30
    check (kalk_aufschlag_material >= 0 and kalk_aufschlag_material <= 500),
  add column if not exists kalk_stundensatz_default numeric not null default 70
    check (kalk_stundensatz_default >= 0 and kalk_stundensatz_default <= 1000),
  add column if not exists kalk_material_cap numeric not null default 30
    check (kalk_material_cap >= 0 and kalk_material_cap <= 100);

comment on column public.company_settings.kalk_aufschlag_gesamt is
  'Voice-Kalkulation: Gesamt-Aufschlag in % auf Positionen (Default 20).';
comment on column public.company_settings.kalk_aufschlag_material is
  'Voice-Kalkulation: Material-Aufschlag in % (Default 30).';
comment on column public.company_settings.kalk_stundensatz_default is
  'Voice-Kalkulation: Fallback-Stundensatz in EUR wenn kein Gewerk-Satz gepflegt (Default 70).';
comment on column public.company_settings.kalk_material_cap is
  'Voice-Kalkulation: Obergrenze Material-Anteil in % der Position (Default 30).';
