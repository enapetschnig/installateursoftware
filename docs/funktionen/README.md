# Funktions-Dokumentation – B4Y SuperAPP

Pro Funktion eine eigene `.md`-Datei. Jede Datei hat denselben Aufbau: **oben die Anwender-Sicht** (was kann die Funktion, wie bedient man sie), **unten der technische Teil** (Routen, Komponenten, Datenbank, zentrale Logik, wie erweitern). So findet sich sowohl ein Anwender bei der Einschulung als auch ein Techniker (oder die KI/Claude Code) bei der Weiterentwicklung schnell zurecht.

> Diese Doku ist eine **lebende Basis**. Wer eine Funktion ändert oder erweitert, hält die zugehörige `.md` aktuell. Ergänzt die übergeordnete Architektur in [`../architecture.md`](../architecture.md), die UI-Regeln in [`../ui-guidelines.md`](../ui-guidelines.md) und den Mandanten-Pfad in [`../mandantenfaehigkeit-migrationspfad.md`](../mandantenfaehigkeit-migrationspfad.md).

## Pflege – die Doku wächst mit der App (Pflicht)

Das Aktualisieren dieser Dateien ist **Teil jeder Änderung** (Definition-of-Done), kein optionaler Nachgang. Verankert als globale Regel in [`../../CLAUDE.md`](../../CLAUDE.md) → „Funktions-Dokumentation mitpflegen". Konkret:

- **Funktion geändert** → zugehörige `<funktion>.md` im selben Schritt nachziehen (Felder, Status/Enums, Routen, Tabellen, Bedienschritte, Erweitern).
- **Neue Funktion** → neue `<name>.md` nach obiger Vorlage anlegen **und** unten im Index verlinken.
- **Funktion entfernt/zusammengelegt** → Datei + Index + Querverweise bereinigen.
- **DB-Migration** → exakte Feldlisten in der betroffenen Datei aktualisieren (bei neuer Tabelle `organization_id`/RLS prüfen).
- **Genauigkeit** → Felder/Enums aus echter Codebasis/Supabase (`information_schema`) übernehmen, nicht raten.

## Vorlage für neue Funktions-Dateien

```markdown
# <Funktionsname>
> Ein-Satz-Beschreibung.

## Für Anwender
**Was kann die Funktion?** – kurze Aufzählung des Nutzens.
**Bedienung** – Schritt für Schritt.
**Wichtige Einstellungen** – was lässt sich pro Firma konfigurieren.

## Technik
**Routen & Komponenten** – Dateien unter `src/…`.
**Datenbank** – betroffene Supabase-Tabellen.
**Zentrale Logik** – wiederverwendbare Helfer in `src/lib/*`.
**Erweitern** – wo setzt man Neues an, worauf achten (Mandant, Rechte, PDF, Mobile).
**Verknüpfungen** – verwandte Funktionen.
```

## Übersicht der Funktionen

### Module (Anwender-Bereiche)

| Funktion | Datei | Kurz |
|---|---|---|
| Übersicht (Dashboard) | [uebersicht.md](uebersicht.md) | Tageszentrale: KPIs, Projekte, Aufgaben, Umsatz, Termine, Wetter |
| Projekte | [projekte.md](projekte.md) | Zentrale Projektakte, Sidebar-Bereiche, Übersicht & Filter |
| Angebote | [angebote.md](angebote.md) | Angebote inkl. Typen (Standard/Pauschal/Regie) & Nachtrag |
| Aufträge | [auftraege.md](auftraege.md) | Aufträge aus Angeboten, Subunternehmer-Aufträge (SUB) |
| Rechnungen | [rechnungen.md](rechnungen.md) | Rechnungen, Teil-/Storno/Skonto, §11 UStG |
| Buchhaltung | [buchhaltung.md](buchhaltung.md) | Eingangsrechnungen (auto aus KI-Postfach) + offene Posten, Belege |
| Marketing | [marketing.md](marketing.md) | Social-Beiträge planen (KI-Texte, Kalender, Live-Vorschau) + Werbeanzeigen |
| Dokumente | [dokumente.md](dokumente.md) | Zentrale Dokumentenübersicht, Upload, Dokumentarten |
| Kalkulation | [kalkulation.md](kalkulation.md) | Gewerke, Artikel, Leistungen, Stundensätze, Einheiten, Texte |
| Einsatzplanung | [planung.md](planung.md) | Ein Menüpunkt, zwei Ansichten: Plantafel-Board + Terminplanung |
| ↳ Plantafel-Ansicht | [plantafel.md](plantafel.md) | Wochen-/Monats-Einsatzplanung (Mitarbeiter × Tage, Drag&Drop) |
| Zeiterfassung | [zeiterfassung.md](zeiterfassung.md) | Ist-Stunden, Soll/Ist-Saldo, Zeitkonto (ZA), Urlaub, Auswertung |
| Regieberichte | [regieberichte.md](regieberichte.md) | Arbeitsberichte mit Material, Beteiligten, Fotos, Unterschrift, PDF |
| Mitarbeiter-App | [mitarbeiter-app.md](mitarbeiter-app.md) | Mobiler Bereich (/m): Fotos, Regieberichte, Stunden |
| Automationen | [automationen.md](automationen.md) | Regeln (Trigger → Bedingung → Aktion), Protokoll |
| Kontakte | [kontakte.md](kontakte.md) | Kunden/Firmen/Personen, Ansprechpartner |
| Mitarbeiter | [mitarbeiter.md](mitarbeiter.md) | Personalstammdaten, Anstellung, Lohngruppen |
| Auswertungen | [auswertungen.md](auswertungen.md) | Dashboards, Statistiken, Soll/Ist |
| Einstellungen | [einstellungen.md](einstellungen.md) | Firma, Dokumentarten, Texte, Rollen, Design |

### Zentrale Engines (übergreifende Logik)

| Engine | Datei | Kurz |
|---|---|---|
| PDF-Engine | [pdf-engine.md](pdf-engine.md) | Ein finales PDF für Vorschau/Download/Druck (paged.js + PDFShift) |
| Dokumentketten | [dokumentketten.md](dokumentketten.md) | Angebot → Auftrag → Rechnung (Snapshots, Quellverweise) |
| Textbausteine | [textbausteine.md](textbausteine.md) | Vor-/Nachtexte, Platzhalter, Mailvorlagen |
| Nummernkreise | [nummernkreise.md](nummernkreise.md) | Belegnummern je Dokumenttyp, konfigurierbar |
| Rechte & Rollen | [rechte-rollen.md](rechte-rollen.md) | Rollenbasiertes RBAC, RLS, Audit |
| Versionierung | [versionierung.md](versionierung.md) | Dokumentversionen, Audit, Druckstand-Snapshot |
| Mandantenfähigkeit | [mandantenfaehigkeit.md](mandantenfaehigkeit.md) | Mehrfirmen-SaaS, organization_id, RLS-Isolation |
| KI-Assistent (Isabella) | [ki-assistent-isabella.md](ki-assistent-isabella.md) | Sprach-/Chat-Assistent, OpenAI/Claude-Fallback |
| KI-Schulungsmodus | [ki-schulungsmodus.md](ki-schulungsmodus.md) | Geführte Touren mit virtuellem Cursor (data-tour-id) |
| E-Mail (Outlook-ähnlich) | [email.md](email.md) | Outlook-ähnliches Mail-Modul, Fundament ohne Graph (Mock-Adapter, Demo-Modus) |
| Smartes KI-Postfach | [smartes-ki-postfach.md](smartes-ki-postfach.md) | IMAP-Eingang → KI liest jede Mail → Kundenanfragen ins Anfragen-Postfach, Rechnungen für die Buchhaltung |
| Sicherheit & Härtung | [sicherheit.md](sicherheit.md) | API-Auth, Rate-Limit, RBAC, private Buckets/signierte URLs, Sanitisierung, Header |

### Marketing / Öffentliche Seite

| Bereich | Datei | Kurz |
|---|---|---|
| Landingpage | [landingpage.md](landingpage.md) | Statische Verkaufsseite auf `/` (self-contained, lokale Fotos), getrennt von der App unter `/app` |
