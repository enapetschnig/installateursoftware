-- ============================================================
-- B4Y SuperAPP – Migration 0008
-- Mailvorlagen: zentrale Verwaltung für E-Mail-Vorlagen mit
-- Kontexten und {{Variablen}}. Basis für spätere Mail-Automatisierung.
-- Idempotent – mehrfach ausführbar.
-- ============================================================

-- ---------- 1) Tabelle ----------
create table if not exists public.mail_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- fachlicher Kontext, an dem die Vorlage vorgeschlagen wird
  context text not null default 'allgemein'
    check (context in (
      'kunde','projekt','angebot','auftrag','rechnung','mahnung',
      'subunternehmer','lieferant','allgemein','dokument','termin'
    )),
  subject text not null default '',
  body_html text not null default '',
  description text,
  sort_order int not null default 0,
  usage_count int not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 2) Indizes ----------
create index if not exists idx_mail_templates_context on public.mail_templates(context);
create index if not exists idx_mail_templates_active on public.mail_templates(active);

-- ---------- 3) RLS (Muster wie Bestand: app_all) ----------
alter table public.mail_templates enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='mail_templates' and policyname='app_all') then
    create policy app_all on public.mail_templates for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------- 4) updated_at-Trigger ----------
drop trigger if exists trg_touch_mail_templates on public.mail_templates;
create trigger trg_touch_mail_templates before update on public.mail_templates
  for each row execute function public.b4y_touch_updated_at();

-- ---------- 5) Seeds: 10 Standard-Mailvorlagen ----------
-- Nur einfügen, wenn noch keine Mailvorlagen existieren.
do $$
begin
  if not exists (select 1 from public.mail_templates limit 1) then
    insert into public.mail_templates (name, context, subject, body_html, sort_order) values
    ('Angebot senden','angebot','Ihr Angebot für {{Project.address}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p>vielen Dank für Ihre Anfrage. Anbei erhalten Sie unser Angebot Nr. {{Offer.number}} für das Projekt {{Project.address}}.</p><p>Für Rückfragen stehen wir Ihnen gerne zur Verfügung.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     10),
    ('Angebot Nachtrag senden','angebot','Nachtrag zum Angebot für {{Project.address}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p>zu Ihrem Projekt {{Project.address}} übersenden wir Ihnen anbei einen Nachtrag zu unserem Angebot {{Offer.number}}.</p><p>Bei Fragen melden Sie sich jederzeit gerne.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     20),
    ('Auftrag bestätigen','auftrag','Auftragsbestätigung für {{Project.address}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p>vielen Dank für Ihren Auftrag. Hiermit bestätigen wir den Auftrag Nr. {{Order.number}} für das Projekt {{Project.address}}.</p><p>Wir freuen uns auf die Zusammenarbeit und melden uns zur Terminabstimmung.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     30),
    ('Rechnung senden','rechnung','Ihre Rechnung für {{Project.address}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p>anbei erhalten Sie unsere Rechnung Nr. {{Invoice.number}} über {{Invoice.amount}} für das Projekt {{Project.address}}.</p><p>Wir bitten um Begleichung bis zum {{Invoice.due_date}}.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     40),
    ('Zahlungserinnerung','mahnung','Zahlungserinnerung – Rechnung {{Invoice.number}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p>sicher ist es Ihrer Aufmerksamkeit entgangen: Unsere Rechnung Nr. {{Invoice.number}} über {{Invoice.amount}} (fällig am {{Invoice.due_date}}) ist noch offen.</p><p>Wir bitten Sie höflich um Begleichung. Sollte sich Ihre Zahlung überschnitten haben, betrachten Sie dieses Schreiben als gegenstandslos.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     50),
    ('Letzte Mahnung','mahnung','Letzte Mahnung – Rechnung {{Invoice.number}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p>trotz unserer Erinnerung ist die Rechnung Nr. {{Invoice.number}} über {{Invoice.amount}} weiterhin offen.</p><p>Wir setzen Ihnen eine letzte Frist zur Zahlung. Nach Verstreichen behalten wir uns weitere Schritte vor.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     60),
    ('Planstand senden','dokument','Aktueller Planstand – Projekt {{Project.address}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p>anbei übersenden wir Ihnen den aktuellen Planstand zum Projekt {{Project.address}} ({{Project.display_id}}).</p><p>Für Rückfragen stehen wir gerne zur Verfügung.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     70),
    ('Vor-Ort-Termin bestätigen','termin','Vor-Ort-Termin – {{Project.address}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p>hiermit bestätigen wir gerne unseren Vor-Ort-Termin zum Projekt {{Project.address}}.</p><p>Sollte etwas dazwischenkommen, geben Sie uns bitte rechtzeitig Bescheid.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     80),
    ('Subunternehmer anfragen','subunternehmer','Anfrage zu Projekt {{Project.address}}',
     '<p>Sehr geehrte Damen und Herren,</p><p>für unser Projekt {{Project.address}} ({{Project.display_id}}) möchten wir Sie um ein Angebot für die nachstehend beschriebenen Leistungen ersuchen.</p><p>Über eine kurze Rückmeldung zu Verfügbarkeit und Konditionen freuen wir uns.</p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     90),
    ('Allgemeine Mail an Kunden','kunde','{{Project.address}}',
     '<p>{{Customer.salutation}} {{Customer.name}},</p><p></p><p>Liebe Grüße,<br>{{User.name}}<br>{{Company.name}} · {{Company.phone}}</p>',
     100);
  end if;
end $$;
