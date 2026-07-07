# Zeiterfassung
> Ist-Arbeitszeiten je Mitarbeiter und Projekt erfassen, Soll/Ist-Saldo, Zeitkonto (Zeitausgleich) und Urlaub verwalten, auswerten und für die Verrechnung nutzen.

## Für Anwender
**Was kann die Funktion?**
- Arbeitszeiten als Von–Bis + Pause erfassen (Stunden werden automatisch berechnet), pro Tag mehrere Zeitblöcke.
- Arbeitsort je Block: Baustelle (mit Projekt), Werkstatt, Büro, Sonstiges.
- Abwesenheiten erfassen: Urlaub, Krankenstand, Feiertag, Zeitausgleich, Weiterbildung, Betriebsurlaub.
- Eigene Monatsübersicht (Meine Stunden): Ist / Soll / Saldo und Zeitkonto-Stand.
- Admin-/Büro-Auswertung (Stundenauswertung): je Mitarbeiter oder je Projekt, mit Freigabe der Einträge, Admin-Nachträgen und CSV-Export.
- Zeitkonto (ZA): Guthaben aufbauen (+Saldo) und Zeitausgleich abbuchen – jede Buchung mit Verlauf.
- Urlaub: Anträge stellen, genehmigen/ablehnen, Rest-Kontingent je Jahr.

**Bedienung**
1. „Zeit erfassen" öffnet den Dialog: Datum, Arbeitsort, Projekt (bei Baustelle), Tätigkeit, Beginn/Ende, Pause.
2. Für Abwesenheiten den Umschalter „Abwesenheit" nutzen und die Art wählen (ganztägig).
3. In „Meine Stunden" den Monat wechseln; grüner/roter Tagessaldo zeigt Plus-/Minusstunden.
4. In „Stundenauswertung" Mitarbeiter + Monat wählen, Einträge freigeben, exportieren.

**Wichtige Einstellungen (je Firma konfigurierbar)**
- Arbeitszeitmodell je Mitarbeiter (Einstellungen → Arbeitszeit / BUAK-Kalender) bestimmt die Soll-Stunden.
- Feiertage/Betriebsurlaub (Tabelle `company_holidays`, österr. Feiertage 2026–2030 vorbefüllt) – änderbar je Firma.
- Rechte-Modul `time_tracking` (Anzeigen/Erstellen/Bearbeiten/Löschen/Export) je Rolle.

## Technik
**Routen & Komponenten**
- `src/lib/time-entries.ts` – Datenlayer + Auswertung: `loadTimeEntries`, `saveTimeEntry`, `deleteTimeEntry`, `setApproved`, `markBackdated`, Zeitkonto (`loadTimeAccount`, `loadTimeAccountTx`, `bookTimeAccount` → RPC `za_book`), Urlaub (`loadLeaveRequests`, `saveLeaveRequest`, `reviewLeaveRequest`), Feiertage (`loadCompanyHolidays`), Saldo (`summarize`, `loadEmployeeSollContext`), Helfer (`hoursFromRange`, `fmtHours`, `fmtSaldo`, `ENTRY_KINDS`, `LOCATION_TYPES`).
- `src/lib/my-employee.ts` – löst den eingeloggten Nutzer auf seinen `employees`-Datensatz (`useMyEmployee`).
- Soll-Stunden-Engine: `src/lib/work-calendar.ts` (`resolveDaySoll`, `loadSollContextForEmployee`) – modellbewusst je Mitarbeiter.
- Seiten/Dialoge: `src/pages/MeineStunden.tsx`, `src/pages/Stundenauswertung.tsx`, `src/components/time/TimeEntryDialog.tsx`.
- Mobile: `src/pages/mitarbeiter/MZeit.tsx` (schlanke Erfassung in der Mitarbeiter-App).

**Datenbank** (Migration `0133_zeiterfassung.sql`)
- `time_entries` (erweitert): `employee_id` → `employees(id)`, `project_id`, `work_date`, `start_time`, `end_time`, `pause_minutes`, `hours`, `hourly_rate`, `description`, `location_type` (baustelle/werkstatt/buero/sonstig), `entry_kind` (arbeit/urlaub/krankenstand/feiertag/zeitausgleich/weiterbildung/betriebsurlaub/sonstig), `approved`/`approved_at`/`approved_by`, `nachgetragen_von`/`nachgetragen_am`, `source_regie_report_id`, `organization_id`.
- `time_accounts` (Zeitkonto je Mitarbeiter, `balance_hours`), `time_account_transactions` (Buchungs-Audit: `change_type`, `hours`, `balance_before/after`, `reason`, `reference_id`).
- `leave_balances` (`year`, `total_days`, `used_days`), `leave_requests` (`start_date`, `end_date`, `days`, `type`, `status`, Review-Felder).
- `company_holidays` (`datum`, `bezeichnung`, `kind` feiertag/betriebsurlaub, `organization_id`).
- RPC `za_book(p_employee_id, p_hours, p_change_type, p_reason, p_reference_id)` – transaktionale Zeitkonto-Buchung mit Rechteprüfung.
- RLS: Modul `time_tracking` (Admin/Büro) plus Eigen-Zweig (`employees.auth_user_id = auth.uid()`), org-Isolation über `current_org_id()`.

**So erweitern**
- Neue Eintragsart → `ENTRY_KINDS` in `time-entries.ts` + CHECK-Constraint `time_entries_entry_kind_check` erweitern; ggf. Saldo-Neutralität in `summarize` (`isSpecialKind`).
- Regiebericht-Stunden fließen automatisch als `time_entries` (via RPC `regie_sync_time_entries`, `source_regie_report_id`).

Querbezüge: [[regieberichte]] (erzeugt Zeiteinträge), [[mitarbeiter]] (Stammdaten/Arbeitszeitmodell), [[rechte-rollen]] (Modul `time_tracking`), [[mitarbeiter-app]] (mobile Erfassung).
