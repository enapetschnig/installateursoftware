-- ============================================================
-- Installateur SuperAPP – Migration 0141
-- Eingangsrechnungen (Lieferantenrechnungen) – Buchhaltungsmodul
-- ------------------------------------------------------------
-- Zweck:
--   Erfasst Rechnungen, die dem Betrieb gestellt werden (Lieferanten/
--   Dienstleister) – manuell ODER automatisch aus dem smarten KI-Postfach
--   (incoming_mails mail_class='rechnung'). Bildet die Grundlage des
--   Buchhaltungsmoduls (/buchhaltung): offene Posten, Fälligkeiten,
--   Belege (PDF im 'belege'-Bucket), Projekt-/Lieferantenzuordnung.
--
--   Abgrenzung: public.invoices = AUSGANGSrechnungen (an Kunden).
--               public.eingangsrechnungen = EINGANGSrechnungen (an uns).
--
-- Mandantenfähigkeit:
--   organization_id NOT NULL DEFAULT public.current_org_id(); der Poller
--   (Service-Role) setzt organization_id explizit.
--
-- RLS (Post-0063-Standard, exakt wie public.anfragen / incoming_mails):
--   permissive  eingangsrechnungen_app_all       (authenticated, using/check true)
--   restrictive eingangsrechnungen_org_isolation (organization_id = current_org_id())
-- ============================================================

create table if not exists public.eingangsrechnungen (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default public.current_org_id()
                       references public.organizations(id) on delete cascade,

  -- Lieferant (optional als Kontakt verknüpft; sonst Freitext aus KI/manuell)
  supplier_contact_id uuid references public.contacts(id) on delete set null,
  supplier_name       text,

  -- Belegkopf
  invoice_number     text,                 -- Rechnungsnummer des Lieferanten
  invoice_date       date,
  due_date           date,
  received_date      date not null default current_date,   -- Eingangsdatum

  -- Beträge
  net                numeric(14,2),
  vat                numeric(14,2),
  gross              numeric(14,2),
  vat_rate           numeric(5,2),
  currency           text not null default 'EUR',

  -- Status / Zahlung
  status             text not null default 'offen',
  paid_at            date,
  payment_reference  text,
  iban               text,

  -- Zuordnung / Kategorisierung
  category           text,                 -- z. B. Material, Werkzeug, Subunternehmer (frei/konfigurierbar)
  project_id         uuid references public.projects(id) on delete set null,
  notes              text,

  -- Herkunft
  source             text not null default 'manual',       -- manual | email
  incoming_mail_id   uuid references public.incoming_mails(id) on delete set null,
  ai_extracted_data  jsonb not null default '{}'::jsonb,

  -- Belege (Dateien im Bucket 'belege'): [{path,filename,content_type,size,uploaded_at}]
  belege             jsonb not null default '[]'::jsonb,

  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint eingangsrechnungen_status_check check (
    status = any (array['offen','geprueft','freigegeben','bezahlt','storniert'])
  ),
  constraint eingangsrechnungen_source_check check (
    source = any (array['manual','email'])
  )
);

comment on table public.eingangsrechnungen is
  'Eingangsrechnungen (Lieferantenrechnungen) für das Buchhaltungsmodul. Manuell oder automatisch aus incoming_mails (mail_class=rechnung). Abgrenzung: invoices = Ausgangsrechnungen.';
comment on column public.eingangsrechnungen.organization_id is
  'Mandanten-ID. Beim Service-Role-Insert (Poller) explizit gesetzt (Default current_org_id() für App-Kontext).';
comment on column public.eingangsrechnungen.status is
  'offen → geprueft → freigegeben → bezahlt; storniert als Endzustand.';
comment on column public.eingangsrechnungen.incoming_mail_id is
  'Herkunfts-Mail (smartes KI-Postfach). Idempotenz-Anker für die automatische Anlage.';
comment on column public.eingangsrechnungen.belege is
  'Datei-Metadaten im Bucket belege: [{path,filename,content_type,size,uploaded_at}]. Anzeige über signierte URLs.';

-- ── Idempotenz + Indizes ───────────────────────────────────
-- Eine E-Mail erzeugt höchstens EINE Eingangsrechnung je Mandant.
create unique index if not exists eingangsrechnungen_org_mail_uq
  on public.eingangsrechnungen (organization_id, incoming_mail_id)
  where incoming_mail_id is not null;

create index if not exists eingangsrechnungen_org_status_idx
  on public.eingangsrechnungen (organization_id, status);
create index if not exists eingangsrechnungen_org_due_idx
  on public.eingangsrechnungen (organization_id, due_date);
create index if not exists eingangsrechnungen_org_created_idx
  on public.eingangsrechnungen (organization_id, created_at desc);
create index if not exists eingangsrechnungen_org_supplier_idx
  on public.eingangsrechnungen (organization_id, supplier_contact_id);
create index if not exists eingangsrechnungen_org_project_idx
  on public.eingangsrechnungen (organization_id, project_id);

-- ── updated_at-Touch ───────────────────────────────────────
create or replace function public.tg_eingangsrechnungen_touch()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  -- paid_at automatisch setzen, wenn auf bezahlt gewechselt und noch leer.
  if new.status = 'bezahlt' and new.paid_at is null then
    new.paid_at := current_date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_eingangsrechnungen_touch on public.eingangsrechnungen;
create trigger trg_eingangsrechnungen_touch
  before insert or update on public.eingangsrechnungen
  for each row execute function public.tg_eingangsrechnungen_touch();

-- ── Row-Level-Security (Post-0063-Standard, wie public.anfragen) ──
alter table public.eingangsrechnungen enable row level security;

drop policy if exists eingangsrechnungen_app_all on public.eingangsrechnungen;
create policy eingangsrechnungen_app_all
  on public.eingangsrechnungen
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists eingangsrechnungen_org_isolation on public.eingangsrechnungen;
create policy eingangsrechnungen_org_isolation
  on public.eingangsrechnungen
  as restrictive
  for all to authenticated
  using  (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

grant select, insert, update, delete on public.eingangsrechnungen to authenticated;
