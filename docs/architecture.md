# B4Y SuperAPP – Architektur & Erweiterungs-Leitfaden

Diese Datei erklärt, **wie die App aufgebaut ist** und **wie man neue Funktionen sauber ergänzt** –
auch für spätere KI-gestützte Entwicklung (Claude Code o.ä.). Sie ergänzt `CLAUDE.md` (dort stehen die
verbindlichen globalen Regeln). **Leitsatz: So viel wie möglich über Einstellungen lösen, nur echte
Spezialwünsche als Code-Erweiterung.**

## 1. Stack & Struktur
- **Frontend:** React 18 + Vite + TypeScript (`.tsx`) + Tailwind. Quellcode in `src/`.
- **Backend:** Supabase (Postgres + RLS + Auth + Storage). Migrationen in `supabase/migrations/`.
- **Hosting:** Vercel, Auto-Deploy bei Push auf `main`.

Wichtige Ordner:
- `src/pages/` – Seiten/Routen (z. B. `OfferEditor.tsx`, `kalkulation/Texte.tsx`).
- `src/components/` – wiederverwendbare UI; `components/document/` = Dokument-Engine (Positionen, PDF).
- `src/lib/` – **zentrale, wiederverwendbare Logik & Datenzugriff** (hier zuerst suchen!):
  - `documents.ts` (Dokumentarten/-Untertypen, Uploads), `text-blocks.ts` (Textbaustein-System),
    `company.ts` (Firmeneinstellungen + Logo-Hook), `offer-kinds.ts`/`offer-display.ts` (Angebote),
    `document-types.ts` (Positions-/Summenmodell), `permissions.ts` (Rechte-Hook), `theme.tsx` (Design).
- `docs/` – Architektur & Pläne (diese Datei, `mandantenfaehigkeit-migrationspfad.md`).

## 2. Verbindliche Projektregeln (Kurzfassung – Details in CLAUDE.md)
1. **Gesamtlogik-Integration:** jede Änderung mit 12-Punkte-Auswirkungsanalyse, nie isoliert.
2. **Mandantenfähig/SaaS:** keine hartcodierten BAU4YOU-Werte; Standards als Seed/Config; neue Tabellen
   mit `organization_id` denken; Daten je Firma getrennt.
3. **Flexible Basissoftware + KI-Erweiterbarkeit:** so viel wie möglich über Einstellungen; saubere,
   verständliche, kommentierte Struktur.

## 3. Mandantenfähigkeit
- Jede Firma = `organizations`-Zeile; Benutzer↔Firma über `memberships` (1 User = 1 Firma).
- Helfer `current_org_id()` (SQL, SECURITY DEFINER) liefert die Org des angemeldeten Users.
- Firmenbezogene Tabellen haben `organization_id` (Default `current_org_id()`), Isolation über eine
  **RESTRICTIVE RLS-Policy** `org_isolation` (AND-verknüpft mit den Rechte-Policies).
- **Neue Tabelle anlegen?** → `organization_id uuid default public.current_org_id()` + Index +
  `org_isolation`-Policy ergänzen (Muster: Migration 0023). Sonst droht Datenvermischung.
- Status: faktisch Einzelmandant (eine Org „bau4you"); Onboarding/Seeding neuer Firmen + Org-Switcher
  sind noch offen (siehe `docs/mandantenfaehigkeit-migrationspfad.md`).

## 4. Dokumenttypen (dynamisch, keine fixe Liste!)
- Tabelle `document_types` (frei anlegbar in Einstellungen → Dokumentarten, `DocumentTypesManager.tsx`).
- Untertypen: `document_subtypes` (je `document_type_id`). Zugehörigkeit: `belongs_to_*`
  (project/customer/employee/supplier/subcontractor) – als Toggles im Modal, als Badges in der Tabelle.
- **Nie auf einen Slug/Namen hart codieren.** Über `document_type_id` + Flags arbeiten.
- Neue Eigenschaft eines Dokumenttyps = Spalte in `document_types` + Feld in `DocumentType`-Typ
  (`lib/documents.ts`) + Toggle/Feld im `DocumentTypesManager`-Formular + ggf. Tabellen-Anzeige.

## 5. Texte / Vor- & Nachtexte (zentral, dynamisch)
- Tabelle `text_blocks`, UI `pages/kalkulation/Texte.tsx`, Logik `lib/text-blocks.ts`.
- Texttypen: Vortext, Nachtext, Leistungstext, Rechtstext, Zahlungsbedingung, Hinweis, intern.
- Zuordnung über IDs: `document_type_id`, `document_subtype_id`, `project_type_id`, `customer_type`,
  `applies_to_all_doctypes`, `is_default`, `language`.
- `pickBestText()` = Prioritäts-Matching (spezifischster aktiver Standardtext). `applyPlaceholders()` =
  `{{kunde.name}}` etc. `snapshotText()` = Kopie ins Dokument (Vorlage bleibt unberührt).
- PDF rendert Rich-Text (HTML) über `introHtml`/`closingHtml`/`legalHtml` in `printDocument.ts`.

## 6. Versionierung & Compliance (je Dokumenttyp einstellbar)
- Felder am Dokumenttyp: `is_accounting_relevant`, `is_tax_relevant`, `versioning_enabled`,
  `versioning_required`, `finalization_required`, `lock_finalized_versions`,
  `create_pdf_snapshot_on_finalize`, `audit_log_enabled`.
- **Regel:** buchungs-/steuerrelevant ⇒ Versionierung/Abschluss/Sperre/PDF-Snapshot/Audit-Log
  verpflichtend (nicht ohne Admin-Warnung abschaltbar). Sonst pro Dokumenttyp frei wählbar.
- Logik dynamisch für ALLE Dokumenttypen – keine Hardcodierung auf Rechnung/Angebot.

## 7. Rechte & Rollen
- RLS-Helfer `b4y_is_admin(uid)` und `b4y_has_permission(uid, module, action)` (SECURITY DEFINER).
- Tabellen: `roles` (inkl. rollenbasierter Sichtbarkeits-Flags seit Migr. 0106), `role_permissions`,
  `role_scopes`, `user_roles`, `permission_modules`/`permission_groups` (Katalog), `perm_audit_log`
  (Audit per DB-Trigger). Frontend-Hook: `lib/permissions.tsx` (`can(module, action)`, `isAdmin`, `scope`).
  UI: `components/access/AccessControl.tsx` (4 Reiter: Rollen/Zuweisung/Ansicht als/Protokoll).
  Rein rollenbasiert – die ungenutzten Pro-User-Overrides wurden mit Migr. 0106 entfernt.
- Neue geschützte Aktion = `permission_modules`-Eintrag + Prüfung via `can(...)` im Frontend +
  RLS-Policy (`b4y_has_permission`) in der DB.

## 8. PDFs
- Erzeugung in `src/components/document/printDocument.ts` (druckfertiges HTML → Druckdialog).
- Aufbau: Firmenkopf/Logo → Meta/Empfänger → Titel → **Vortext** → Positionen/Summen → **Nachtext** →
  Rechts-/Zahlungstexte → Fuß. Logo/Firmendaten aus `company.ts`. Rich-Text-CSS-Klasse `.rt`.
- Darstellungseinstellungen (Preise/Summen/Spalten sichtbar …) über `offer-display.ts`.

## 9. So baut man eine neue Funktion ein (Checkliste)
1. **Auswirkungsanalyse** (CLAUDE.md, 12 Punkte). Über Einstellungen lösbar statt hartcodiert?
2. Datenmodell: neue/erweiterte Tabelle → `organization_id` + RLS + Index mitdenken; Migration in
   `supabase/migrations/` ablegen UND per Supabase-MCP anwenden.
3. Zentrale Logik nach `src/lib/` (wiederverwendbar), UI in `pages/`/`components/`.
4. Bestehendes Design/Utilities wiederverwenden; Dark-/Light-Mode + iPad beachten.
5. Prüfen: anlegen/bearbeiten/speichern/Refresh, Tabellen/Filter/Suche, PDFs, Rechte, keine
   Konsolenfehler, Vercel-Build grün (Build = Wahrheit bei Mount-Lag).

## 10. Konfliktvermeidung (Mehrbenutzer-Entwicklung)
- Komponenten klein halten; gemeinsame UI in `components/`. Pro Änderung möglichst nur einen Bereich.
- Geteilte Bausteine (Layout, theme, ui) nur bewusst ändern. Mehrbenutzer-Workflow: direkt auf `main`, aber immer mit Pull zu Arbeitsbeginn, erneutem Pull vor Push, `npm run verify` und ohne Autowatcher.
