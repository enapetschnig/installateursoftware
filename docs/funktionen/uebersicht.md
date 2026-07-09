# Übersicht (Dashboard)
> Startseite als Tageszentrale: schnelle Unternehmenszahlen, Projekte, Aufgaben, Umsatz, Termine, Schnellaktionen und Wetter auf einen Blick.

## Für Anwender
**Was kann die Funktion?**
- **Kopf:** Begrüßung, Live-Datum + Uhrzeit, kompakte Tageszusammenfassung (offene Aufgaben, offene Rechnungen, laufende Projekte, Termine heute) und ein Hinweis, wenn etwas überfällig ist.
- **KPI-Karten:** Projekte, Angebote, Offene Rechnungen, Offene Aufgaben – je mit Beschreibung und Status/Trend (z. B. „+2 diese Woche", „1 überfällig"). Klick führt zur jeweiligen Detailseite.
- **Aktuelle Projekte:** bis zu 5 aktive Projekte mit Kategorie, Status-Badge, Fortschritt, Verantwortlichem und Priorität (sofern gepflegt).
- **Aufgaben für heute:** offene Aufgaben mit Fälligkeit, Priorität und Projektbezug; überfällige sind dezent hervorgehoben. Leerer Zustand mit „Aufgabe erstellen".
- **Umsatz (Monat):** aktuelle Monatssumme, Vergleich zum Vormonat, 12-Monats-Verlauf mit Monatslabels.
- **Heute:** heutige Termine + Projekt-Erinnerungen/Fristen.
- **Schnellaktionen:** Neues Projekt (hervorgehoben), Angebot, Rechnung, Baustelle dokumentieren, Kontakt.
- **Wetter:** echte Daten für die **Firmenstadt** (aus den Firmeneinstellungen; Fallback Wien) über Open-Meteo – Temperatur, Wetterzustand, Tageshoch/-tief, Regenwahrscheinlichkeit, Wind, Tagesverlauf und Aktualisierungszeit. Dazu eine **Bauwetter-Bewertung** für Außenarbeiten (Wind >40 km/h „kritisch", Tief <5 °C „Frostgefahr", Hoch >30 °C „Hitze", Regen >60 % „Regenrisiko", sonst „grundsätzlich möglich"). Funktionierender „Aktualisieren"-Button; fehlende Einzelwerte werden als „–" dargestellt; bei Komplettausfall ruhiger Hinweis statt Fehler.

**Bedienung** – Startseite nach Login; Karten/Listen sind anklickbar und führen in den jeweiligen Bereich.

**Wichtige Einstellungen** – keine eigenen; zeigt ausschließlich vorhandene Echtdaten. Leere Bereiche erscheinen als sauberer Empty-State (keine Beispiel-/Fake-Daten).

## Technik
**Routen & Komponenten**
- `src/pages/Dashboard.tsx` – gesamte Übersicht inkl. interner Hilfskomponenten (`Summary`, `EmptyState`, `QA`) und Lade-/Empty-/Error-Behandlung.
- `src/components/Weather.tsx` – Wetterblock (Open-Meteo, **kein API-Key**, keine Fake-Daten). Standort **mandantenfähig**: ohne expliziten `location`-Prop wird die **Stadt aus den Firmeneinstellungen** (`company_settings.city`) per Open-Meteo-Geocoding zu Koordinaten aufgelöst; **Wien** bleibt Fallback (leere/nicht auflösbare Stadt). **Wichtig:** In der CSP (`connect-src` in `vercel.json`) müssen **`https://api.open-meteo.com`** und **`https://geocoding-api.open-meteo.com`** erlaubt sein, sonst blockiert der Browser den Abruf. Bauwetter-Bewertung in `bauwetter()`.
- `src/components/Charts.tsx` – `AreaChart`/`Sparkline`/`Ring`.
- `src/components/ui.tsx` – `Badge`/`TONES`, `Spinner`.

**Datenbank (nur lesend)**
- `projects` (aktiv = `archived=false`; Felder u. a. `stage`, `category`, `responsible`, `priority`, `reminder_*`).
- `offers` (Anzahl ohne `deleted_at`; „diese Woche" via `created_at`).
- `invoices` (offen = `payment_status≠bezahlt` & `doc_status≠storniert`; überfällig zusätzlich `locked` & `due_date<heute`; Umsatz aus `net`+`invoice_date`).
- `tasks` (`done=false`; Felder `due_date`, `priority`, `project_id`).
- `appointments` (heutige Termine über `lib/appointments`).

**Zentrale Logik**
- `lib/types.ts` → `STAGES`, `stageTone` (Status-Farblogik), `Project`.
- `lib/appointments.ts` → `fetchAppointments` + `materializeOccurrences` (Serien/Heute).
- `lib/invoice-types.ts` → Überfälligkeits-/Statuslogik (`deriveInvoiceStatus`).
- `lib/format.ts` → `eur`.
- Fortschritt = Position der `stage` in `STAGES`.

**Erweitern** – Neue Kennzahl: KPI in der `kpis`-Liste ergänzen (echte Datenquelle, kein Hardcoding) und ggf. Ladeabfrage im `useEffect` erweitern. Empty-/Loading-/Error-States beibehalten. Mandantenneutral halten (keine BAU4YOU-fixen Werte); Daten werden DB-seitig per RLS/`organization_id` getrennt. Dark-Mode + iPad-Responsivität prüfen.

**Verknüpfungen** – [projekte.md](projekte.md), [rechnungen.md](rechnungen.md), [planung.md](planung.md), [auswertungen.md](auswertungen.md).

## Leitstand (Stand 2026-07-09)

Die frühere separate Seite **/cockpit** ist in die Startseite aufgegangen – es gibt nur noch **eine** Startseite.
Administratoren sehen unterhalb der persönlichen Kacheln zusätzlich den **Leitstand** (`src/components/dashboard/Leitstand.tsx`,
Daten aus `src/lib/cockpit.ts`) mit den Blöcken, die es auf der Übersicht nicht schon gab:

- **Offene Forderungen** – offener Betrag, Anzahl, überfällige Summe
- **Angebots-Pipeline** – Entwurf → Abgeschlossen → Versendet → Angenommen (je Anzahl + Summe)
- **Mitarbeiter-Einteilung heute** – inkl. „ohne Zuordnung" und Abwesenheiten

Weggefallen sind die Doppelungen (KPIs, Anfragen, Schnellaktionen) und der Platzhalter „KI-Telefonagent".
Das **Sprach-Angebot** ist als Schnellaktion „Angebot per Sprache" erhalten.
`/cockpit` leitet dauerhaft auf `/` um (alte Links/Lesezeichen bleiben gültig).
