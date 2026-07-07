# Automationen
> Regeln nach dem Muster Trigger → Bedingung → Aktion, mit Dedupe, Test (dry run) und Protokoll.

## Für Anwender

**Was kann die Funktion?**
Nimmt wiederkehrende Handgriffe ab: Eine Regel reagiert auf ein Ereignis (z. B. Projektstatuswechsel), prüft Bedingungen und führt Aktionen aus. Ausführungen werden protokolliert; Regeln lassen sich als „dry run" testen; Dedupe verhindert Mehrfachauslösung.

**Bedienung**
Bereich „Automationen" (`/automationen`): Reiter Regeln (Trigger/Bedingungen/Aktionen) und Protokoll. Regel anlegen → testen → aktivieren → im Protokoll prüfen.

## Technik

**Routen & Komponenten**
`/automationen` → `src/pages/Automationen.tsx`. Engine `src/lib/automations.ts`.

**Datenbank – exakte Felder (Migr. 0055/0056)**
- **`automations`**: `id, name, trigger_stage, category, actions(jsonb), active, description, sort_order, trigger_type, trigger_config(jsonb), conditions(jsonb), created_by, updated_by, created_at, updated_at, organization_id`
- **`automation_runs`**: `id, organization_id, automation_id, project_id, trigger_stage, status, result(jsonb), trigger_type, old_stage, new_stage, automation_name, dry_run, created_by, created_at`

**Zentrale Logik**
`automations.ts`: Trigger auswerten (`trigger_type`/`trigger_stage`/`trigger_config`), Bedingungen (`conditions`) prüfen, Aktionen (`actions`) ausführen, Dedupe; jede Ausführung → `automation_runs` (inkl. `dry_run`).

**Benachrichtigungen (Topbar-Glocke, Stand 2026-07-06)**
Die Aktion `create_notification` (und weitere Automations-Aktionen) schreiben Meldungen ins Projekt-Logbuch (`project_log`, `kind='automation'`). Die Topbar-Glocke (`src/components/TopbarIndicators.tsx`) zeigt daraus die letzten Meldungen (Klick → Projekt) und einen dezenten Punkt bei Einträgen der letzten 24 h – keine eigene Notification-Tabelle, keine Fake-Zähler. Sichtbar nur mit `projects`-Sichtrecht; RLS filtert serverseitig.

**Erweitern**
Neue Trigger/Aktionen in `automations.ts` als erweiterbare, **datengetriebene** Typen (nicht pro Firma hartcodieren). Mailversand-Aktionen sind aktuell Blocker (brauchen Mailzugang). `organization_id` beachten.

**Verknüpfungen**
[projekte.md](projekte.md) · [textbausteine.md](textbausteine.md)
