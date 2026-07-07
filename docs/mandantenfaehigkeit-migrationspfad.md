# Mandantenfähigkeit – Migrationspfad (Single-Tenant → Multi-Tenant SaaS)

Stand: 2026-06-15 · Status: **Plan** (noch nicht umgesetzt)

Dieses Dokument beschreibt, wie die B4Y SuperAPP vom heutigen **Einzelmandanten** sauber und
schrittweise zu einer **mandantenfähigen, vermarktbaren SaaS** wird – ohne den laufenden Betrieb
zu brechen. Es konkretisiert die globale Produktregel in `CLAUDE.md`.

## 1. Ausgangslage (Ist)
- Faktisch **Single-Tenant**: `company_settings` hat genau eine Zeile (`id = 1`, integer).
- **Keine `organization_id`** auf den Tabellen – Daten gehören implizit „der einen Firma".
- **RLS** über `b4y_has_permission(uid, module, action)` und `b4y_is_admin(uid)` (SECURITY DEFINER),
  basierend auf `user_roles` + `role_permissions` + `user_permission_overrides` + `profiles.role`.
- `number_ranges` zählt **global** (`next_number`), `roles`/`role_permissions` sind global,
  `permission_modules` ist ein globaler Katalog.

## 2. Zielbild (Soll)
- Tabelle `organizations` (= Mandant/Firma). Jede **firmenbezogene** Tabelle bekommt `organization_id`.
- **RLS filtert je Organisation** → Daten verschiedener Firmen können sich nie vermischen.
- Eine **neue Firma** bekommt beim Anlegen ihre **eigenen Standarddaten als Seed** (die heutigen
  BAU4YOU-Daten dienen als Vorlage/Template), die sie frei ändern/deaktivieren kann.
- `company_settings`, Nummernkreise, Dokumentarten, Textbausteine, Rollen/Rechte, Theme/Logos,
  PDF-Layouts, E-Mail-Vorlagen, Kalkulationsgrundlagen: **alles je Firma getrennt**.

## 3. Architekturentscheidung: Zugangsmodell (zu bestätigen)
- **Variante A (empfohlen):** 1 Benutzer = 1 Firma. `organization_id` an `profiles`
  (oder schlanke `memberships`-Tabelle). Einfachste, deckt „Verkauf an separate Firmen" vollständig ab.
- **Variante B:** 1 Benutzer kann mehreren Firmen angehören (Org-Switcher in der App). Mehr Aufwand
  (aktive Org als JWT-Claim/Session). Später nachrüstbar auf Basis von A.
- **Variante C (Login-Branding):** je Firma eigene Subdomain/Custom-Domain für gebrandeten Login.
  Separates Thema, unabhängig von A/B.
> Empfehlung: **mit A bauen**, B/C später additiv. Die DB-Struktur (memberships) so wählen,
> dass B kein Umbau wird.

## 4. Zentraler RLS-Helfer
Neue STABLE-SECURITY-DEFINER-Funktion `current_org_id()`: liefert die Org des `auth.uid()`
(aus `memberships`/`profiles`). Alle org-bezogenen Policies bekommen die Bedingung
`organization_id = public.current_org_id()`. `b4y_has_permission`/`b4y_is_admin` werden org-scoped
(Rollen/Rechte je Org statt global).

## 5. Tabellen-Klassifizierung
**Org-bezogen (bekommen `organization_id`):** contacts, projects, project_log, project_participants,
project_appointments, project_checklists(+items), offers, invoices, invoice_items, invoice_offers,
orders, order_items, documents, document_types, document_subtypes, text_blocks, trades, hourly_rates,
articles, services, service_components, units, number_ranges, project_types, project_statuses,
offer_types, offer_display_settings, mail_templates, employees, media_categories, buak_calendar,
catalog_items, time_entries, tasks, automations, project_media, calc_audit_log, perm_audit_log,
roles, role_permissions, user_roles, user_access, user_permission_overrides, user_scope_overrides,
company_settings (→ **eine Zeile je Org** statt id=1).

**Global (bleiben ohne org_id):** organizations, memberships, profiles (User↔Org via membership),
permission_modules (Katalog der verfügbaren Rechte/Module), permission_groups.

> Bei JEDER neuen Tabelle künftig prüfen: org-bezogen → `organization_id` + org-RLS Pflicht.

## 6. Phasenplan (jede Phase einzeln deployen & prüfen)

**Phase 0 – Fundament (nicht brechend):**
`organizations` + `memberships` anlegen; Default-Org „BAU4YOU" einfügen; alle bestehenden
User per membership der Default-Org zuordnen; `current_org_id()`-Helfer anlegen.

**Phase 1 – Spalten additiv:** `organization_id uuid` (nullable) auf allen org-bezogenen Tabellen,
**Backfill** auf die Default-Org, Index `(organization_id)` je Tabelle. Noch keine RLS-Änderung.

**Phase 2 – Schreibpfad:** Inserts setzen `organization_id` (Frontend oder DB-Default via
`current_org_id()`). `company_settings` org-bezogen laden (`loadCompanySettings` → aktuelle Org statt
id=1); `company_branding`-View org-aware; `number_ranges` zählt je Org.

**Phase 3 – RLS org-aware:** alle org-Policies um `organization_id = current_org_id()` ergänzen;
`b4y_has_permission`/`b4y_is_admin` org-scoped. **Kritischste Phase** – sorgfältig testen
(kein Cross-Tenant-Leak, kein Datenverlust für die Default-Org).

**Phase 4 – Härten:** `organization_id` auf `NOT NULL` + FK setzen, sobald alles befüllt.

**Phase 5 – Org-Onboarding/Seeding:** Funktion „neue Firma anlegen" kopiert Default-Vorlagen
(Dokumentarten, Untertypen, Nummernkreise, Textbausteine, Gewerke/Leistungen/Artikel/Einheiten/
Stundensätze, Projektarten/-status, Angebotstypen, Rollen/Rechte, `company_settings`, Theme/Logo,
Mailvorlagen). BAU4YOU-Daten = Template.

**Phase 6 – Login/Branding:** Org-Zuordnung beim Login; optional Subdomain/Custom-Domain für
gebrandeten Login (Variante C); öffentliche Branding-View je Org.

**Phase 7 – Frontend:** `OrganizationProvider`/Context; (optional) Org-Switcher (Variante B);
alle Loader laufen über die aktuelle Org (RLS erzwingt Trennung, Inserts setzen org_id);
End-to-End-Tests je Modul, Dark/Light, PDFs, Auswertungen.

## 7. Risiken & Schutzmaßnahmen
- **Cross-Tenant-Leak** (RLS-Lücke) = Datenschutz-GAU → jede neue Tabelle ohne org-RLS ist verboten.
- **Nummernkreise** müssen je Org getrennt zählen (sonst Doppelnummern/Rechtsverstoß §11 UStG).
- **Backfill** der Default-Org darf keine bestehenden Daten verlieren (vorher Backup/Branch-Test).
- **`company_settings` id=integer** → Umstieg auf org-bezogene Zeilen; `loadCompanySettings` und alle
  Verwender (PDF, Branding, Login-Logo) anpassen.
- **Performance:** Indizes auf `organization_id`; Policies einfach halten.
- **Reihenfolge strikt einhalten** – Spalten/Backfill vor RLS, RLS vor NOT-NULL.

## 8. Aufwand & Empfehlung
Mittelgroßes bis großes Vorhaben. Empfehlung: **streng phasenweise**, Phase 0/1 sind risikoarm und
schaffen sofort die Grundlage; Phase 3 (RLS) zuerst auf einem Supabase-**Branch** testen.
Bis dahin gilt weiter: neue Funktionen bereits **mandantentauglich** strukturieren (org_id mitdenken).

## 9. Nicht-Ziele (bewusst später)
Multi-Org pro Benutzer (B), Custom-Domain-Login-Branding (C), org-übergreifende Konzern-Auswertungen,
Self-Service-Registrierung/Billing.
