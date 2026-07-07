-- ============================================================
-- B4Y SuperAPP – Angebotstypen (Standard / Pauschal / Regie)
-- Jeder Typ trägt eigene PDF-Darstellung, Einleitungs- und Abschlusstexte.
-- Beim Anlegen eines Angebots werden Texte + Darstellung als Snapshot kopiert.
-- ============================================================

create table if not exists public.offer_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  name text not null,
  slug text not null,
  description text,
  pdf_label text not null default 'Angebot',     -- Überschrift/Betrifft im PDF
  intro_text text,
  closing_text text,
  -- Standard-Darstellung (mappt 1:1 auf OfferDisplay)
  default_is_lump_sum boolean not null default false,
  default_show_unit_prices boolean not null default true,
  default_show_position_totals boolean not null default true,
  default_show_subtotals boolean not null default true,
  default_show_only_grand_total boolean not null default false,
  default_show_images boolean not null default false,
  default_show_service_images boolean not null default false,
  default_show_article_images boolean not null default false,
  default_show_articles_inside_services boolean not null default false,
  default_show_vat boolean not null default true,
  default_group_titles boolean not null default false,
  default_show_title_sums boolean not null default true,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists offer_types_slug_uidx on public.offer_types (slug);

alter table public.offer_types enable row level security;
drop policy if exists app_all on public.offer_types;
create policy app_all on public.offer_types for all using (true) with check (true);

drop trigger if exists trg_offer_types_touch on public.offer_types;
create trigger trg_offer_types_touch before update on public.offer_types
  for each row execute function public.b4y_touch_updated_at();

-- ── Angebote: Typ + Snapshot-Felder ──
alter table public.offers add column if not exists offer_type_id uuid references public.offer_types(id);
alter table public.offers add column if not exists offer_intro_text text;
alter table public.offers add column if not exists offer_closing_text text;
alter table public.offers add column if not exists display_settings_snapshot jsonb;

-- ── Seeds: drei praxisnahe Typen ──
insert into public.offer_types
  (name, slug, description, pdf_label, intro_text, closing_text,
   default_is_lump_sum, default_show_unit_prices, default_show_position_totals,
   default_show_subtotals, default_show_only_grand_total, default_show_vat,
   default_show_title_sums, sort_order)
values
  ('Standardangebot', 'standard', 'Normales Angebot mit detaillierten Preisen.', 'Angebot',
   'Gerne übermitteln wir Ihnen unser Angebot auf Basis der angeführten Positionen.',
   E'Preise gültig für die Dauer von 3 Monaten.\nDie Aufmaß-Abrechnung erfolgt nach tatsächlichem Aufwand und ÖNORM.\nWir würden uns freuen, Ihr Projekt gemeinsam mit Ihnen umzusetzen und stehen Ihnen für Rückfragen jederzeit gerne zur Verfügung.',
   false, true, true, true, false, true, true, 1),

  ('Pauschalangebot', 'pauschal', 'Angebot mit einer Pauschalsumme, ohne Einzelpreise für den Kunden.', 'Pauschalangebot',
   'Gerne übermitteln wir Ihnen unser Pauschalangebot für die beschriebenen Leistungen.',
   E'Dieses Angebot versteht sich als Pauschalangebot für die angeführten Leistungen.\nÄnderungen, Zusatzleistungen oder nicht beschriebene Leistungen werden gesondert angeboten bzw. nach tatsächlichem Aufwand abgerechnet.\nPreise gültig für die Dauer von 3 Monaten.\nWir würden uns freuen, Ihr Projekt gemeinsam mit Ihnen umzusetzen und stehen Ihnen für Rückfragen jederzeit gerne zur Verfügung.',
   true, false, false, false, true, true, false, 2),

  ('Regieangebot', 'regie', 'Angebot für Arbeiten nach tatsächlichem Aufwand.', 'Regieangebot',
   'Gerne übermitteln wir Ihnen unser Regieangebot für die Durchführung der Arbeiten nach tatsächlichem Aufwand.',
   E'Die Abrechnung erfolgt nach tatsächlichem Aufwand auf Regiebasis.\nArbeitszeit, Material, Fahrten, Entsorgung und sonstige Nebenleistungen werden nach tatsächlichem Anfall verrechnet.\nDie angegebenen Mengen und Beträge dienen, sofern vorhanden, als unverbindliche Schätzung.\nPreise gültig für die Dauer von 3 Monaten.\nWir würden uns freuen, Ihr Projekt gemeinsam mit Ihnen umzusetzen und stehen Ihnen für Rückfragen jederzeit gerne zur Verfügung.',
   false, true, true, true, false, true, true, 3)
on conflict (slug) do nothing;
