# Plantafel (Einsatzplanung)
> Moderne Wochen-/Monats-Plantafel: wer arbeitet wann auf welchem Projekt. Mitarbeiter als Zeilen, Tage als Spalten, Einsätze als farbige Balken – per Drag&Drop verschiebbar.

## Für Anwender
**Was kann die Funktion?**
- Einsätze (Zeitraum + Projekt + Mitarbeiter) planen und als Balken darstellen.
- Woche/Monat umschalten, mit „Heute" und Vor/Zurück navigieren (KW-Anzeige).
- Balken per Drag&Drop auf einen anderen Tag oder Mitarbeiter ziehen.
- Klick auf leere Zelle legt einen Einsatz an; Klick auf Balken bearbeitet ihn.
- Feiertage (rot getönt) und Wochenenden (dezent) sind im Raster erkennbar.
- Überlappende Einsätze werden gestapelt (eigene Lanes), verdecken sich nicht.
- Erledigt-Häkchen direkt am Einsatz.

**Bedienung**
1. „Plantafel" öffnen, Woche/Monat wählen.
2. In eine Zelle (Mitarbeiter × Tag) klicken → Einsatz-Dialog (Projekt, Mitarbeiter, Zeitraum, ganztägig oder Zeiten).
3. Balken ziehen, um Tag/Mitarbeiter zu ändern; bei Doppelbelegung erscheint eine Warnung.

**Wichtige Einstellungen (je Firma)**
- Rechte-Modul `plantafel` (Anzeigen/Erstellen/Bearbeiten/Löschen) je Rolle.
- Ressourcen-/Kategorie-/Terminarten in Planung → Einstellungen; Projektfarbe über `projects.board_color`.

## Technik
**Routen & Komponenten**
- Datenbasis: `src/lib/planning.ts` (Events, Mitarbeiter-/Ressourcen-Verknüpfung, Konfliktprüfung).
- Seite `src/pages/Plantafel.tsx` (Route `/plantafel`), Komponenten unter `src/components/plantafel/` (`plantafelUtils.ts` Raster/Lane-Stacking/Farben, `EinsatzBar.tsx`, `EinsatzDialog.tsx`).
- Die bestehende Konfigurations-/Listenansicht bleibt unter `src/pages/Planung.tsx` (`/planung`).
- Feiertage aus `src/lib/time-entries.ts` (`loadCompanyHolidays`).

**Datenbank**
- Planungsmodul (Migration `0045_planning_module.sql`): `planning_events` (+ `done_at`, Migration `0136`), `planning_event_employees`, `planning_event_resources`, `planning_resources`, `planning_categories`, `planning_event_types`, `planning_absences`.
- `projects.board_color` (Migration `0136`) – eigene Balkenfarbe je Projekt.
- RLS: Modul `plantafel`, org-Isolation über `current_org_id()`.

**So erweitern**
- Ressourcen-/Fahrzeugzeilen als weitere Sektion ergänzen (planning_resources).
- Realtime über `supabase.channel('planning_events')` für Mehrbenutzerbetrieb.

Querbezüge: [[planung]] (Termine/Ressourcen/Abwesenheiten), [[projekte]], [[mitarbeiter]], [[zeiterfassung]], [[rechte-rollen]] (`plantafel`).

## Zugang (Stand 2026-07-09)

Die Plantafel ist die Ansicht **`/einsatzplanung?ansicht=plan`** (Menüpunkt **Einsatzplanung**).
Die alte Route `/plantafel` leitet dorthin um. Details: [planung.md](planung.md).
