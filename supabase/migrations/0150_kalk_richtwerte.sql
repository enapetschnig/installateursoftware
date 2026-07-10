-- ============================================================
-- Installateur SuperAPP – Migration 0150
-- Handelsübliche Richtwert-Spannen (mandantenfähig, je Firma pflegbar)
-- ------------------------------------------------------------
-- Zweck: Das Sprach-Angebot soll handelsübliche Preise liefern. Richtwerte
-- gehören als DATEN in die Mandanten-Konfiguration (company_settings), nicht
-- als fixe Zahlen in Prompt oder Code:
--   • Die KI bekommt die Spannen als Prompt-Block ({{RICHTWERTE}}) und
--     kalibriert von vornherein handelsüblich.
--   • Der Plausibilitäts-Guard meldet Positionen außerhalb der Spanne als
--     "Prüfen:"-Hinweis (nur Hinweis – Preise erfindet der Guard nie).
-- Struktur je Eintrag (JSONB-Array):
--   { "stichwort": "steckdose|schalter",  -- Regex (case-insensitive) auf Positionsname
--     "bezeichnung": "Steckdosen-/Schalter-Auslass UP komplett",
--     "einheit": "Stk", "vk_min": 60, "vk_max": 110 }
-- Seed = Startkonfiguration für einen österreichischen Elektro-/Sanitär-
-- Betrieb (netto, Stand 2026) – vom Mandanten änderbar/löschbar.
-- ============================================================

alter table public.company_settings
  add column if not exists kalk_richtwerte jsonb;

comment on column public.company_settings.kalk_richtwerte is
  'Handelsübliche VK-Richtwert-Spannen je Leistungskategorie (JSONB-Array: stichwort-Regex, bezeichnung, einheit, vk_min, vk_max). Genutzt vom Sprach-Angebot (Prompt-Kalibrierung + Plausibilitäts-Hinweise).';

update public.company_settings
   set kalk_richtwerte = '[
  { "stichwort": "steckdose|schalter|wechselschalter|serienschalter|taster|dimmer", "bezeichnung": "Steckdosen-/Schalter-Auslass UP komplett (ohne Leitungsverlegung)", "einheit": "Stk", "vk_min": 60,  "vk_max": 130 },
  { "stichwort": "brennstelle|lampenauslass|deckenauslass|leuchte.*auslass",        "bezeichnung": "Brennstelle/Lampenauslass",                                        "einheit": "Stk", "vk_min": 50,  "vk_max": 110 },
  { "stichwort": "fi[- /]?schalter|fehlerstrom|fi[/]?ls",                           "bezeichnung": "FI-Schutzschalter nachrüsten inkl. Material",                      "einheit": "Stk", "vk_min": 150, "vk_max": 320 },
  { "stichwort": "leitungsschutz|ls[- ]schalter|sicherungsautomat",                 "bezeichnung": "LS-Schalter tauschen/ergänzen",                                    "einheit": "Stk", "vk_min": 40,  "vk_max": 100 },
  { "stichwort": "nym|mantelleitung|leitung.*verlegen|kabel.*verlegen",             "bezeichnung": "Leitung verlegen je lfm (AP/Leerrohr)",                            "einheit": "m",   "vk_min": 5,   "vk_max": 42 },
  { "stichwort": "verteiler|zählerkasten|sicherungskasten|unterverteil",            "bezeichnung": "Verteiler-/Zählerkastenarbeiten je Stunde-Äquivalent",             "einheit": "Stk", "vk_min": 120, "vk_max": 2500 },
  { "stichwort": "regiestunde|stundenlohn|monteur",                                 "bezeichnung": "Elektriker-/Monteur-Stundensatz",                                  "einheit": "Std", "vk_min": 65,  "vk_max": 110 }
]'::jsonb
 where kalk_richtwerte is null;
