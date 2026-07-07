-- Variable Leistungs-Vorlagen pro Gewerk (mandantenfähig).
-- Flag kennzeichnet Vorlagen, die im Dokument frei angepasst werden, ohne den
-- normalen Leistungsstamm zu verschmutzen.
alter table services add column if not exists is_variable_template boolean not null default false;

-- Seed: je aktivem Gewerk genau eine variable Vorlage (nur wenn noch keine existiert).
insert into services
  (name, trade_id, category, unit, vat_rate, vk_net_manual, material_mode,
   aufschlag_percent, active, is_variable_template, short_text, organization_id)
select
  'Variable Position – ' || t.name, t.id, t.name, 'pauschal', 20, 0, 'kein',
  0, true, true, 'Frei anpassbare Position für ' || t.name, t.organization_id
from trades t
where t.active = true
  and not exists (
    select 1 from services s
    where s.is_variable_template = true
      and s.trade_id = t.id
      and s.organization_id is not distinct from t.organization_id
  );
