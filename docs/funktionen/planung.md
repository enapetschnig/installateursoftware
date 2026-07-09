# Planung
> Termine, Ressourcen und Abwesenheiten auf Wochen-/Monats-Plantafel mit Konfliktprüfung.

## Für Anwender

**Was kann die Funktion?**
Zeigt, wer/was wann eingeplant ist: Termine (Einsätze), Ressourcen (Personen/Fahrzeuge/Geräte), Abwesenheiten (Urlaub/Krank). Wochen- und Monatsansicht; Konflikte (Doppelbelegung/Abwesenheit) werden erkannt. Arbeits-/BUAK-Kalender fließen ein.

**Bedienung**
Bereich „Planung" (`/planung`): Termine anlegen, Ressourcen/Mitarbeiter zuordnen, Abwesenheiten eintragen; Wechsel Woche/Monat.

## Technik

**Routen & Komponenten**
`/planung` → `src/pages/Planung.tsx`; `src/components/WorkCalendar.tsx`, `src/components/BuakCalendar.tsx`.

**Datenbank – exakte Felder (Migration 0045)**
- **`planning_events`**: `id, organization_id, title, event_type_id, category_id, status, priority, color, start_at, end_at, all_day, project_id, contact_id, location, description, visibility, recurrence(jsonb), reminder(jsonb), external_ref(jsonb), done_at, created_by, created_at, updated_at`
- **`planning_event_employees`**: `event_id, employee_id, organization_id` · **`planning_event_resources`**: `event_id, resource_id, organization_id`
- **`planning_resources`**: `id, organization_id, name, resource_type_id, category_id, employee_id, color, description, availability(jsonb), is_active, sort_order`
- **`planning_resource_types`**: `id, organization_id, name, slug, icon, sort_order, is_active`
- **`planning_categories`**: `id, organization_id, name, slug, color, sort_order, is_active`
- **`planning_event_types`**: `id, organization_id, name, slug, color, default_duration_min, is_absence, sort_order, is_active`
- **`planning_absences`**: `id, organization_id, employee_id, kind, start_date, end_date, all_day, status, color, note, created_by`
- Daneben **`appointments`** (Serien: `rrule, recurrence_*, is_exception, exception_original_date, attendees…`) und **`project_appointments`** (projektbezogen) – bewusst getrennt.
- **`buak_calendar`**: `id, year, week, date_from, date_to, week_type, soll_bau, soll_maler, target_hours, status, confidence, source*, organization_id`

**Zentrale Logik**
Konfliktprüfung über Zeitraum-Überlappung je Ressource/Mitarbeiter. Terminserien via `appointments` + `rruleUtils` (RFC 5545: YEARLY/BYMONTHDAY/BYSETPOS). BUAK kurz/lang je KW, Edge-Function-Autoimport (Google CSE + KI).

**Erweitern**
Neue Ereignis-/Ressourcentypen als Stammdaten (kein Code). **Drei Termin-Systeme** (`appointments`, `project_appointments`, `planning_events`) bewusst separat – nicht vermischen. Neue Tabellen mit `organization_id` + RLS.

**Verknüpfungen**
[projekte.md](projekte.md) · [mitarbeiter.md](mitarbeiter.md)

## Einsatzplanung (Stand 2026-07-09)

„Planung" und „Plantafel" sind zu **einem** Menüpunkt **Einsatzplanung** zusammengefasst – zwei Ansichten statt zwei Seiten:

- Route: **`/einsatzplanung`** mit `?ansicht=plan` (Plantafel-Board) oder `?ansicht=termine` (Terminplanung).
- Der Umschalter liegt in `src/App.tsx` (`Einsatzplanung`), die beiden Seiten (`Planung.tsx`, `Plantafel.tsx`) sind **unverändert**.
- Alte Links bleiben gültig: `/plantafel` leitet auf `?ansicht=plan` um; `/planung` rendert den Umschalter direkt,
  sodass Deep-Links wie `/planung?project=…&new=1` weiterhin in der Termin-Ansicht mit geöffnetem Dialog landen.
