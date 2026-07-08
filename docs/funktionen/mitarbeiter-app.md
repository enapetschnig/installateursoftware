# Mitarbeiter-App
> Eigener, schlanker, mobil-first Bereich (Routenpräfix `/m`) nur für Monteure/Mitarbeiter. **Fokus (Fasching-Stil): reine Zeiterfassung + Regieberichte** (Regieberichte auch per Sprache). Projekte/Fotos bleiben als Nebenfunktion erreichbar.

## Für Anwender
**Was kann die Funktion?**
- Startseite als Karten-Launcher (Fasching-Stil): Wochen-Kennzahlen (Ist/Soll/Saldo) + große Aktions-Karten „Zeiterfassung" und „Regiebericht" (mit 🎤-Sprache-Badge) sowie sekundär „Projekte & Fotos".
- Stunden schreiben (Von–Bis + Pause, Arbeitsort, Projekt) mit Wochensumme.
- Regieberichte anlegen – **komplett per Sprache**: Einsatz diktieren → Transkription → KI füllt Kunde, Arbeit und Material aus. Zusätzlich Diktat-Mikro direkt am Beschreibungsfeld.
- Projekte ansehen und Fotos/Videos aufs Projekt hochladen (über die „Projekte & Fotos"-Karte).
- Untere Tab-Leiste (fokussiert): Start · Zeit · Regie.

**Bedienung**
1. Mitarbeiter meldet sich an und wird (je Rolle) in den `/m`-Bereich geführt.
2. Über die Tab-Leiste zwischen Start, Projekte, Regie und Zeit wechseln.
3. Im Projekt „Fotos hochladen" oder „Regiebericht/Stunden" starten.

**Wichtige Einstellungen (je Firma)**
- Rechte-Modul `mitarbeiter_app` schaltet den Bereich je Rolle frei (Standard: Monteur, Bauleitung, Techniker).
- Zusätzliche Rechte für Fotos (`media.photos`/`media.videos` upload), Zeiterfassung (`time_tracking`), Regieberichte (`regiestunden`).

## Technik
**Routen & Komponenten**
- Layout: `src/components/mitarbeiter/MitarbeiterLayout.tsx` (eigenes, ohne Admin-Sidebar; Kopfzeile + untere Tab-Bar Start/Zeit/Regie mit Safe-Area).
- Seiten unter `src/pages/mitarbeiter/`: `MHome.tsx` (Karten-Launcher), `MProjekte.tsx`, `MProjektDetail.tsx`, `MRegie.tsx` (inkl. Sprach-Erfassung), `MZeit.tsx`.
- Sprach-Regiebericht: `src/components/voice/InlineMicButton.tsx` (Aufnahme → `transcribeAudio`), `src/lib/voice/runVoiceRegie.ts` (Transkript → KI-Parse via `aiComplete`/`parseJsonResponse`), `src/lib/ai/prompts/regiebericht.ts` (mandantenfähiger Prompt). Braucht `OPENAI_API_KEY` serverseitig (`/api/ai/transcribe` + `/api/ai/chat`).
- Wiederverwendung: `useMyEmployee` (`src/lib/my-employee.ts`), Zeiterfassung (`src/lib/time-entries.ts`), Regieberichte (`src/lib/regie.ts`), Foto-Upload (`src/components/media/ProjectMediaGallery.tsx`).
- Routing/Guard in `src/App.tsx`: `/m/*` rendert `MitarbeiterLayout` statt des Admin-`Layout`; Zugang über Modul `mitarbeiter_app`.

**Datenbank** (Migration `0135_mitarbeiter_app.sql`)
- Permission-Modul `mitarbeiter_app` (Gruppe `mitarbeiter`, Aktion `view`).
- Rollen-Seeds: Monteur/Bauleitung/Techniker erhalten `mitarbeiter_app.view` sowie Foto-/Zeit-Rechte.

**So erweitern**
- Weitere mobile Kachel/Route → neue Seite unter `src/pages/mitarbeiter/` + Tab in `MitarbeiterLayout.tsx` + Route in `App.tsx`.
- Zugriff je Rolle über `role_permissions` (Modul `mitarbeiter_app`) steuern.

Querbezüge: [[zeiterfassung]], [[regieberichte]], [[projekte]], [[rechte-rollen]] (`mitarbeiter_app`), [[mitarbeiter]].
