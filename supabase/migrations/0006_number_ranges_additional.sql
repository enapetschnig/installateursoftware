-- ============================================================
-- B4Y SuperAPP – Migration 0006: zusätzliche Nummernkreise
-- Idempotent (ON CONFLICT DO NOTHING) – überschreibt bestehende
-- Nummernkreise NICHT, legt fehlende bei Erstinstallation an.
-- ============================================================
insert into public.number_ranges (doc_type, label, prefix, use_year, separator, min_digits, next_number, active, protected) values
  ('work_instruction',                 'Arbeitsanweisung',        'ARBEITSANWEISUNG', true, '-', 4, 1, true, false),
  ('measurement',                      'Aufmaß',                  'AUFMASS',          true, '-', 4, 1, true, false),
  ('subcontractor_order_confirmation', 'Auftragsbestätigung Sub', 'AUFTRAG-SUB',      true, '-', 4, 1, true, false),
  ('customer_mail',                    'Mail an Kunden',          'MAIL-KUNDE',       true, '-', 4, 1, true, false),
  ('reminder',                         'Mahnung',                 'MAHNUNG',          true, '-', 4, 1, true, false),
  ('time_requirement',                 'Zeitvorgabe',             'ZEITVORGABE',      true, '-', 4, 1, true, false)
on conflict (doc_type) do nothing;
