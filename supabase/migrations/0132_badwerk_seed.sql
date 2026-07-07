-- ============================================================
-- Installateursoftware – Migration 0132: Bad.Werk-Startkonfiguration
--
-- Richtet den ersten Mandanten ein: Firmendaten Bad.Werk GmbH
-- (www.dasbadwerk.at, Heizungs-/Lüftungs-/Gas-/Sanitärtechnik,
-- Generalunternehmer für Komplett-Badsanierung), Benutzer-Bootstrap
-- (Profile, Admin-Rollen, Mitgliedschaften für bestehende Accounts)
-- und Installateur-Pipelines: Projekttypen mit Projektstufen je
-- Pipeline (project_types + project_statuses_global +
-- project_type_statuses). Alles bleibt über die Einstellungen
-- änderbar – keine Hardcodierung im Code. Idempotent.
-- ============================================================

-- ---------- 1) Organisation umbenennen ----------
update public.organizations
   set name = 'Bad.Werk GmbH', slug = 'badwerk'
 where id = (select id from public.organizations order by created_at asc limit 1);

-- ---------- 2) Firmendaten (company_settings id=1) ----------
insert into public.company_settings
  (id, name, street, zip, city, country, phone, email, web, uid, fn, fn_court,
   ceo, geschaeftsfuehrer, organization_id)
values
  (1, 'Bad.Werk GmbH', 'Bogenmühlstraße 8', '5411', 'Oberalm', 'Österreich',
   '+43 676 6968818', 'office@dasbadwerk.at', 'www.dasbadwerk.at',
   'ATU80440435', 'FN 622049 d', 'Landesgericht Salzburg',
   'Lucas Traintinger', array['Lucas Traintinger'],
   (select id from public.organizations order by created_at asc limit 1))
on conflict (id) do update set
  name = excluded.name, street = excluded.street, zip = excluded.zip,
  city = excluded.city, country = excluded.country, phone = excluded.phone,
  email = excluded.email, web = excluded.web, uid = excluded.uid,
  fn = excluded.fn, fn_court = excluded.fn_court, ceo = excluded.ceo,
  geschaeftsfuehrer = excluded.geschaeftsfuehrer,
  organization_id = excluded.organization_id;

-- ---------- 3) Benutzer-Bootstrap (bestehende Auth-Accounts) ----------
-- Profile für alle vorhandenen Auth-Benutzer anlegen (falls fehlend)
insert into public.profiles (id, email, name, role)
select u.id, u.email,
       coalesce(nullif(btrim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1)),
       'mitarbeiter'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

-- Mitgliedschaft in der Default-Organisation sicherstellen
insert into public.memberships (user_id, organization_id)
select u.id, (select id from public.organizations order by created_at asc limit 1)
  from auth.users u
on conflict (user_id, organization_id) do nothing;

-- Admin-Rolle für die Betreiber-Accounts
do $$
declare
  v_admin uuid := (select id from public.roles where key = 'admin' limit 1);
  v_org uuid := (select id from public.organizations order by created_at asc limit 1);
  v_user record;
begin
  if v_admin is null then return; end if;
  for v_user in
    select id from auth.users
     where email in ('hallo@epowergmbh.at', 'napetschnig.chris@gmail.com',
                     'napetschnig98@gmail.com', 'cnapetschnig@gmail.com',
                     'office@dasbadwerk.at')
  loop
    insert into public.user_roles (user_id, role_id, organization_id)
    values (v_user.id, v_admin, v_org)
    on conflict do nothing;
    update public.profiles set role = 'admin' where id = v_user.id;
  end loop;
end $$;

-- Mitarbeiter-Stammsatz für den Hauptaccount (für Zeiterfassung/Mitarbeiter-App)
insert into public.employees (auth_user_id, first_name, last_name, email, position, active, organization_id)
select u.id, 'Christoph', 'Napetschnig', u.email, 'Geschäftsführung', true,
       (select id from public.organizations order by created_at asc limit 1)
  from auth.users u
 where u.email = 'hallo@epowergmbh.at'
   and not exists (select 1 from public.employees e where e.auth_user_id = u.id);

-- ---------- 4) Installateur-Pipelines (Projekttypen + Stufen) ----------
-- BAU4YOU-Importtypen ersetzen: Bad.Werk arbeitet als Installateur-GU.
delete from public.project_type_statuses;
delete from public.project_statuses;
delete from public.project_statuses_global;
delete from public.project_types;

with org as (select id from public.organizations order by created_at asc limit 1),
new_types as (
  insert into public.project_types (label, slug, category, sort_order, active, organization_id)
  select t.label, t.slug, t.category, t.sort_order, true, org.id
    from org,
         (values
           ('Badsanierung',        'badsanierung',        'Badsanierung',         1),
           ('Heizung & Wärmepumpe','heizung-waermepumpe', 'Heizung & Wärmepumpe', 2),
           ('Sanitär-Installation','sanitaer-installation','Sanitär-Installation',3),
           ('Klima & Lüftung',     'klima-lueftung',      'Klima & Lüftung',      4),
           ('Service & Reparatur', 'service-reparatur',   'Service & Reparatur',  5),
           ('GU-Projekt',          'gu-projekt',          'GU-Projekt',           6)
         ) as t(label, slug, category, sort_order)
  returning id, slug
),
new_statuses as (
  insert into public.project_statuses_global (label, color, sort_order, active, organization_id)
  select s.label, s.color, s.sort_order, true, org.id
    from org,
         (values
           ('Anfrage',          '#64748B',  1),
           ('Besichtigung',     '#0EA5E9',  2),
           ('Planung',          '#6366F1',  3),
           ('Angebot gesendet', '#8B5CF6',  4),
           ('Auftrag erhalten', '#10B981',  5),
           ('Vergabe Subunternehmer', '#14B8A6', 6),
           ('Vorbereitung',     '#F59E0B',  7),
           ('Demontage',        '#F97316',  8),
           ('Rohinstallation',  '#EA580C',  9),
           ('Maurerarbeiten',   '#A16207', 10),
           ('Fliesenarbeiten',  '#0D9488', 11),
           ('Malerarbeiten',    '#7C3AED', 12),
           ('Endmontage',       '#2563EB', 13),
           ('Inbetriebnahme',   '#0891B2', 14),
           ('Terminiert',       '#3B82F6', 15),
           ('In Arbeit',        '#F59E0B', 16),
           ('Übergabe',         '#22C55E', 17),
           ('Abgeschlossen',    '#16A34A', 18),
           ('Verrechnet',       '#15803D', 19),
           ('Storniert',        '#9CA3AF', 20)
         ) as s(label, color, sort_order)
  returning id, label
),
mapping as (
  select * from (values
    -- Pipeline Badsanierung: der 8-Stufen-Prozess von dasbadwerk.at
    ('badsanierung', 'Anfrage', 1), ('badsanierung', 'Besichtigung', 2),
    ('badsanierung', 'Planung', 3), ('badsanierung', 'Angebot gesendet', 4),
    ('badsanierung', 'Auftrag erhalten', 5), ('badsanierung', 'Vorbereitung', 6),
    ('badsanierung', 'Demontage', 7), ('badsanierung', 'Rohinstallation', 8),
    ('badsanierung', 'Maurerarbeiten', 9), ('badsanierung', 'Fliesenarbeiten', 10),
    ('badsanierung', 'Malerarbeiten', 11), ('badsanierung', 'Endmontage', 12),
    ('badsanierung', 'Übergabe', 13), ('badsanierung', 'Abgeschlossen', 14),
    ('badsanierung', 'Verrechnet', 15), ('badsanierung', 'Storniert', 16),
    -- Pipeline Heizung & Wärmepumpe
    ('heizung-waermepumpe', 'Anfrage', 1), ('heizung-waermepumpe', 'Besichtigung', 2),
    ('heizung-waermepumpe', 'Planung', 3), ('heizung-waermepumpe', 'Angebot gesendet', 4),
    ('heizung-waermepumpe', 'Auftrag erhalten', 5), ('heizung-waermepumpe', 'Demontage', 6),
    ('heizung-waermepumpe', 'Rohinstallation', 7), ('heizung-waermepumpe', 'Endmontage', 8),
    ('heizung-waermepumpe', 'Inbetriebnahme', 9), ('heizung-waermepumpe', 'Übergabe', 10),
    ('heizung-waermepumpe', 'Abgeschlossen', 11), ('heizung-waermepumpe', 'Verrechnet', 12),
    ('heizung-waermepumpe', 'Storniert', 13),
    -- Pipeline Sanitär-Installation (Neubau/Umbau)
    ('sanitaer-installation', 'Anfrage', 1), ('sanitaer-installation', 'Planung', 2),
    ('sanitaer-installation', 'Angebot gesendet', 3), ('sanitaer-installation', 'Auftrag erhalten', 4),
    ('sanitaer-installation', 'Rohinstallation', 5), ('sanitaer-installation', 'Endmontage', 6),
    ('sanitaer-installation', 'Übergabe', 7), ('sanitaer-installation', 'Abgeschlossen', 8),
    ('sanitaer-installation', 'Verrechnet', 9), ('sanitaer-installation', 'Storniert', 10),
    -- Pipeline Klima & Lüftung
    ('klima-lueftung', 'Anfrage', 1), ('klima-lueftung', 'Besichtigung', 2),
    ('klima-lueftung', 'Angebot gesendet', 3), ('klima-lueftung', 'Auftrag erhalten', 4),
    ('klima-lueftung', 'Rohinstallation', 5), ('klima-lueftung', 'Endmontage', 6),
    ('klima-lueftung', 'Inbetriebnahme', 7), ('klima-lueftung', 'Abgeschlossen', 8),
    ('klima-lueftung', 'Verrechnet', 9), ('klima-lueftung', 'Storniert', 10),
    -- Pipeline Service & Reparatur (schnelle Einsätze)
    ('service-reparatur', 'Anfrage', 1), ('service-reparatur', 'Terminiert', 2),
    ('service-reparatur', 'In Arbeit', 3), ('service-reparatur', 'Abgeschlossen', 4),
    ('service-reparatur', 'Verrechnet', 5), ('service-reparatur', 'Storniert', 6),
    -- Pipeline GU-Projekt (Generalunternehmer, Vergabe an Subunternehmer)
    ('gu-projekt', 'Anfrage', 1), ('gu-projekt', 'Besichtigung', 2),
    ('gu-projekt', 'Planung', 3), ('gu-projekt', 'Angebot gesendet', 4),
    ('gu-projekt', 'Auftrag erhalten', 5), ('gu-projekt', 'Vergabe Subunternehmer', 6),
    ('gu-projekt', 'In Arbeit', 7), ('gu-projekt', 'Übergabe', 8),
    ('gu-projekt', 'Abgeschlossen', 9), ('gu-projekt', 'Verrechnet', 10),
    ('gu-projekt', 'Storniert', 11)
  ) as m(type_slug, status_label, sort_order)
)
insert into public.project_type_statuses (project_type_id, status_id, sort_order, active, organization_id)
select nt.id, ns.id, m.sort_order, true, org.id
  from mapping m
  join new_types nt on nt.slug = m.type_slug
  join new_statuses ns on ns.label = m.status_label
  cross join org;
