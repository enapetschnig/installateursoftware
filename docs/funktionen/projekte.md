# Projekte
> Zentrale Projektakte: jedes Bauvorhaben bündelt Logbuch, Dokumente, Termine, Medien und Abrechnung an einem Ort.

## Für Anwender

**Was kann die Funktion?**
Projekte sind das Herz der App. Jedes Projekt hat einen Typ (`category`), einen Status (`stage`), einen verantwortlichen Mitarbeiter (`responsible`) und einen Kunden (`contact_id`). In der Projektakte hängen alle zugehörigen Angebote, Aufträge, Rechnungen, hochgeladenen Dokumente, Fotos/Videos, Termine, Baubesprechungen und das Logbuch.

**Bedienung – Schritt für Schritt**
1. **Übersicht** (`/projekte`): Liste oder Board (Kanban nach `stage`).
2. **Filterleiste** (genau diese Reihenfolge): Suche → **Projekttyp** → Status → Mitarbeiter → Aktiv/Archiviert → Jahr. Klick auf eine Zeile öffnet das Projekt.
3. **Neues Projekt** über Button oben rechts (`ProjectForm`).
4. **Projektakte** (`/projekte/:id`): linke Sidebar; zuletzt geöffneter Bereich wird je Projekt gemerkt.

**Projektstatus (`projects.stage`)** – Standardliste (`STAGES`, je Projekttyp in `project_statuses` überschreibbar):
`Neu – Erstkontakt`, `Vor-Ort-Termin`, `Angebotserstellung`, `Angebotsprüfung`, `Angebotsweiterleitung`, `Detailgespräch`, `Auftragsvergabe`, `Auftragsbestätigung`, `Umsetzungsbeginn`, `In Umsetzung`, `Kundenrechnung`, `Reklamation`, `Abgeschlossen`, `Abgelehnt`.
Status-Farbe schlüsselwortbasiert via `stageTone()` (grün = abgeschlossen/fertig; rot = abgelehnt/reklamation/storno; amber = auftrag/umsetzung/rechnung; blau = angebot/detailgespräch; sonst slate).

**Projekttypen (`projects.category`)** – Standard-Seed (`PROJECT_TYPES`, 12; je Mandant in `project_types` editierbar): Einreichungen / Pläne · Geschäftslokale / Büros / Häuser · Generalsanierung Wohnungen · Oberflächensanierung Wohnungen · Fassaden · Sofortaufträge · Fenster · Wasserschäden · Objektinstandhaltungen · Feuchtesanierungen · Badezimmersanierungen · Küchen / Geräte.

**Prioritäten** (`projects.priority`): Niedrig, Normal, Hoch, Dringend.

## Technik

**Routen & Komponenten**
- `/projekte` (`?typ=<slug>` filtert auf Typ) → `src/pages/Projects.tsx` (Liste/Board + Filter)
- `/projekte/:id` → `src/pages/ProjectDetail.tsx` (Akte, Sidebar-Bereiche, Dokument-Erstellung)
- `src/components/ProjectForm.tsx` (Anlegen/Bearbeiten), `src/components/project/*` (Dokumente, Medien, Baubesprechungen)

**Sidebar-Bereiche (SectionKey)** in `ProjectDetail.tsx`: `logbuch`, `bilder`, `dok_overview` + dynamisch `angebote`/`auftraege`/`rechnungen` (nur wenn Zähler > 0) + `doktype:<id>`, Organisation (`termine`, `baubesprechungen`, `aufgaben`, `checklisten`, `beteiligte`, `notizen`, `unterschriften`), Leistung (`regiestunden`, `zeitlohn`, `material`, `belege`), Abschluss (`sollist`, `abschluss`). Validierung über `VALID_SECTIONS`.

**Datenbank – exakte Felder**
- **`projects`**: `id, project_number, title, category, stage, contact_id, street, zip, city, description, budget, created_by, created_at, gewerk, responsible, country, address_extra, start_date, end_date, priority, reminder_date, reminder_text, reminder_done, internal_note, archived, updated_at, organization_id`
  - Hinweis: `description` ist **Legacy** – wird seit dem Wegfall des doppelten Beschreibungsfelds **nicht mehr im `ProjectForm` gepflegt** (nur noch `internal_note`/„Interne Notiz"). Spalte bleibt für Altdaten erhalten (kein Datenverlust) und ist weiterhin in der Projektsuche (`Projects.tsx`) als Treffer-Feld enthalten.
- **`project_log`**: `id, project_id, entry, kind, created_by, created_at, organization_id, offer_id`
- **`project_media`**: `id, project_id, file_name, file_type, file_size, file_url, created_by, created_at, description, category, archived, thumbnail_url, mime_type, media_type, category_id, title, taken_at, source, sort_order, is_favorite, organization_id`
- **`project_types`**: `id, label, slug, category, sort_order, active, organization_id` · **`project_statuses`**: `id, project_type_id, label, sort_order, active, organization_id`
- Weiter: `project_participants`, `project_checklists`/`project_checklist_items`, `project_appointments`, `project_meetings` (→ [planung.md](planung.md))

**Zentrale Logik**
`src/lib/project-config.ts` → `useProjectConfig()` lädt **aktive** Typen/Status (Fallback `FALLBACK_TYPES`/`FALLBACK_STATUSES`), liefert `statusLabelsFor(category)`; Live-Reload via `emitProjectConfigChange()`. Aktiver Bereich in `sessionStorage` (`b4y:lastProjectSection:<projektId>`), gesetzt durch `setSec()`; beim Dokument-Erstellen Rücksprung vorgemerkt durch `rememberSection()` (→ [dokumentketten.md](dokumentketten.md)). Auch der Toolbar-Button **„Zum Projekt"** in den Dokumenteditoren (zentral `DocumentWorkspace.tsx`) merkt vor der React-Router-Navigation den fachlich passenden Bereich über `rememberProjectSection()` (`src/lib/project-nav.ts`, gleicher sessionStorage-Key) – Angebot/Nachtrag→`angebote`, Auftrag/SUB→`auftraege`, Rechnung→`rechnungen`. Jahr aus `project_number` (Regex `(?:19|20)\d{2}`, letzter Treffer) sonst `created_at`/`updated_at` (`projectYear()` in `Projects.tsx`).

**Erweitern**
Neuer Sidebar-Bereich: Section-Key + `VALID_SECTIONS` + Render-Block. Neues Projektfeld: `projects` (DB) + `ProjectForm` + Tabelle/Filter in `Projects.tsx` (`shown`-useMemo, je Filter ein unabhängiges `if`). Typen/Status nie hartcodieren – immer über `useProjectConfig()` (Typen aus `project_types`, Status global aus `project_statuses_global` + Zuordnung `project_type_statuses`). `organization_id` mitführen.

**Stand 2026-06-21 (Block Projekte):**
- **Zuständiger Mitarbeiter** kommt aus der echten `employees`-Tabelle über `useEmployees()` (kein Hardcode mehr); `projects.responsible` bleibt Namens-Text (Bestandsdaten bleiben erhalten/filterbar).
- **Projektstatus zentral:** Filter „Alle Status" = alle global aktiven Status (`cfg.allStatusLabels`); bei gewähltem Typ nur dessen aktivierte Status. Verwaltung in Einstellungen (siehe [einstellungen.md](einstellungen.md)).
- **Baubeginn mit Uhrzeit:** `projects.start_at` (timestamptz, Migr. 0077) – Stunde + 5-Minuten-Schritte; altes `start_date` (nur Datum) bleibt erhalten. „Fertigstellung" → **„Geplante Fertigstellung"** (nur Datum).
- **Sprechende URLs:** `/projekte/PROJEKT-0001-2026` über `projectRoute()` (UUID-Fallback, Alt-Links gültig); `ProjectDetail` lädt per `project_number` ODER UUID und löst intern die UUID (`pid`) für DB-Filter/Section-Storage auf. Die **Projektnummer** wird – anders als Belegnummern (erst bei Verbindlichkeit, siehe [nummernkreise.md](nummernkreise.md)) – weiterhin direkt beim Anlegen vergeben (`ProjectForm`).
- **Projekttyp-Filter-Reset:** Klick auf Hauptmenü „Projekte" (ohne `?typ=`) setzt den Typfilter wieder auf „Alle".
- **KI-Schulungsmodus-Anker:** Für die Tour „Projekt anlegen" tragen Navigation, „Neues Projekt"-Button und die `ProjectForm`-Felder stabile `data-tour-id` (z. B. `project-nav`, `project-create-button`, `project-form-customer/type/address/status/responsible/internal-note/save`, `project-form-modal`). Beim Umbenennen/Verschieben dieser Elemente die IDs mitführen (siehe [ki-schulungsmodus.md](ki-schulungsmodus.md)).

**Projektkopf zentral (Stand 2026-07-06):** Die Meta-Chips des Projektkopfs (Nr., Betreff, Adresse, Kunde, Mitarbeiter, Baubeginn, geplante Fertigstellung) kommen aus dem zentralen Helfer `projectContextChips()` in `src/components/project/ProjectContextChips.tsx`. `ProjectDetail` rendert sie im `EntityHeader`; **dieselben Chips** erscheinen als Projektkontext in den Kopfzeilen aller Dokumenteditoren (Angebot/Auftrag/Auftrag-SUB/Rechnung/Text-/Formular-Dokument, Komponente `ProjectContextChips`). Neue Kopf-Felder nur dort ergänzen – nie je Editor duplizieren. Siehe [angebote.md](angebote.md).

**Auftragsvolumen netto (Stand 2026-06-22):** Projektliste und -Detail zeigen statt `projects.budget` das **Auftragsvolumen netto** = Summe `orders.net` aller gültigen Aufträge des Projekts (ohne `deleted_at`, `status='storniert'`, `archived_at`). Aggregation in `Projects.tsx` (ein Gruppen-Query über `orders`) bzw. `ProjectDetail.tsx`.

**Projektstatus speichern (Stand 2026-06-22):** `changeStage` persistiert mit `.select()`-Prüfung der betroffenen Zeilen; bei Fehler oder 0 Zeilen (z. B. RLS/Mandantenkontext) erfolgt Rollback + Fehlermeldung, Logbuch/Automation laufen nur nach erfolgreichem Update. Der Status bleibt nach Reload/Navigation erhalten; Labels weiterhin aus `useProjectConfig()` (kein Hardcoding).

**Projekt-Audit-Fixes (Stand 2026-06-22):** Speicheraktionen mit robuster Fehlerbehandlung + Rollback + Toast: Status (`changeStage`), Archivieren (`toggleArchive`), interne Notiz (`saveNote`), Angebot/Auftrag/generisches Dokument aus dem Projekt (`createOffer`/`createOrder`/`createGenericDoc`), Foto-Favorit/Archiv (`ProjectMediaGallery`) – kein falscher „gespeichert"-Zustand mehr. Noch nicht gebaute Bereiche (Regiestunden, Zeit & Lohn, Material, Belege, Soll/Ist, Projektabschluss) sind in der Sidebar **als „in Vorbereitung" ausgegraut/deaktiviert** (kein Funktions-Schein). Offen (eigenes Security-Paket, siehe [sicherheit.md](sicherheit.md)): RLS der globalen Tabelle `appointments` (SELECT `using(true)`, keine `org_isolation`).

**Verknüpfungen**
[angebote.md](angebote.md) · [auftraege.md](auftraege.md) · [rechnungen.md](rechnungen.md) · [dokumente.md](dokumente.md) · [planung.md](planung.md)

## Aufgeräumte Projektakte (Stand 2026-07-09)

- Die linke Bereichs-Navigation zeigt **keine deaktivierten „in Vorbereitung"-Punkte** mehr
  (Regiestunden, Zeit & Lohn, Material, Belege, Soll/Ist-Vergleich, Projektabschluss). Die Definitionen und
  Empty-Handler bleiben im Code, damit die Bereiche später ohne Umbau reaktiviert werden können.
- **„Notizen" gab es doppelt** (Organisation-Bereich + Schnellnotiz in der rechten Spalte, beide auf demselben Feld).
  Der Klon in der Seitenleiste ist entfernt; kanonisch ist **Organisation → Notizen**.
- Der Bereich „Regiestunden" heißt jetzt **„Regieberichte"** (passend zum Modulnamen); der interne Section-Key bleibt unverändert.
