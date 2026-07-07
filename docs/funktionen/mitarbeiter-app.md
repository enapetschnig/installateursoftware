# Mitarbeiter-App
> Eigener, schlanker, mobil-first Bereich (Routenpräfix `/m`) nur für Monteure/Mitarbeiter: Projekte ansehen, Fotos hochladen, Regieberichte erstellen, Stunden schreiben.

## Für Anwender
**Was kann die Funktion?**
- Startseite mit Begrüßung und Wochenstunden-Überblick.
- Projekte ansehen (Liste + Detail) und Fotos/Videos direkt aufs Projekt hochladen.
- Regieberichte für ein Projekt anlegen (mobil-optimiert).
- Stunden schreiben (Von–Bis + Pause, Arbeitsort, Projekt) mit Wochensumme.
- Untere Tab-Leiste: Start · Projekte · Regie · Zeit.

**Bedienung**
1. Mitarbeiter meldet sich an und wird (je Rolle) in den `/m`-Bereich geführt.
2. Über die Tab-Leiste zwischen Start, Projekte, Regie und Zeit wechseln.
3. Im Projekt „Fotos hochladen" oder „Regiebericht/Stunden" starten.

**Wichtige Einstellungen (je Firma)**
- Rechte-Modul `mitarbeiter_app` schaltet den Bereich je Rolle frei (Standard: Monteur, Bauleitung, Techniker).
- Zusätzliche Rechte für Fotos (`media.photos`/`media.videos` upload), Zeiterfassung (`time_tracking`), Regieberichte (`regiestunden`).

## Technik
**Routen & Komponenten**
- Layout: `src/components/mitarbeiter/MitarbeiterLayout.tsx` (eigenes, ohne Admin-Sidebar; Kopfzeile + untere Tab-Bar mit Safe-Area).
- Seiten unter `src/pages/mitarbeiter/`: `MHome.tsx`, `MProjekte.tsx`, `MProjektDetail.tsx`, `MRegie.tsx`, `MZeit.tsx`.
- Wiederverwendung: `useMyEmployee` (`src/lib/my-employee.ts`), Zeiterfassung (`src/lib/time-entries.ts`), Regieberichte (`src/lib/regie.ts`), Foto-Upload (`src/components/media/ProjectMediaGallery.tsx`).
- Routing/Guard in `src/App.tsx`: `/m/*` rendert `MitarbeiterLayout` statt des Admin-`Layout`; Zugang über Modul `mitarbeiter_app`.

**Datenbank** (Migration `0135_mitarbeiter_app.sql`)
- Permission-Modul `mitarbeiter_app` (Gruppe `mitarbeiter`, Aktion `view`).
- Rollen-Seeds: Monteur/Bauleitung/Techniker erhalten `mitarbeiter_app.view` sowie Foto-/Zeit-Rechte.

**So erweitern**
- Weitere mobile Kachel/Route → neue Seite unter `src/pages/mitarbeiter/` + Tab in `MitarbeiterLayout.tsx` + Route in `App.tsx`.
- Zugriff je Rolle über `role_permissions` (Modul `mitarbeiter_app`) steuern.

Querbezüge: [[zeiterfassung]], [[regieberichte]], [[projekte]], [[rechte-rollen]] (`mitarbeiter_app`), [[mitarbeiter]].
