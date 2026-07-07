# MASTER_REGELN_B4Y-SuperAPP

## 1. Zweck und Prioritäten

Die B4Y SuperAPP ist eine mehrbenutzerfähige, mandantenfähige, rollenbasierte und revisionsfähige Geschäftsanwendung für Bauunternehmen.

Prioritäten:

1. Sicherheit, Datenschutz, Mandantentrennung und Datenintegrität
2. neueste ausdrückliche Anweisung von Lukasz
3. diese Masterregeln
4. bestehende Architektur und zentrale Geschäftslogik
5. frühere technische Vorschläge

Ein Prompt ist eine fachliche Anforderung, kein ungeprüfter technischer Bauplan. Jede Umsetzung ist gegen den tatsächlichen Code, das Datenmodell und die bestehenden Projektregeln zu prüfen.

## 2. Entwicklungsgrundsätze

- **Erst verstehen, dann bauen:** vor jeder nicht-trivialen Änderung gezielt den betroffenen Code + die passende `docs/funktionen/*`-Doku (Modul-/Abhängigkeitskarte) lesen, Modul-Zusammenhänge und Auswirkungen klären, dann die kleinste saubere Lösung umsetzen. Sandbox-Build ist unzuverlässig (Mount) → maßgeblich ist `npm run verify`/Vercel, keine erfundenen Testergebnisse.
- Bestehende zentrale Logik zuerst suchen und erweitern.
- Keine parallelen Systeme für denselben Geschäftsprozess.
- Kleine, abgeschlossene Arbeitspakete mit klaren Akzeptanzkriterien.
- Keine unbestellten Nebenfunktionen.
- Keine großflächigen Refactorings innerhalb kleiner Aufgaben.
- Gemeinsame Typen, Services, Validierungen und UI-Komponenten verwenden.
- Keine produktiven Mock-Daten oder provisorischen Produktionswege.
- Änderungen müssen Desktop, Tablet und mobile Nutzung berücksichtigen.
- Alle kritischen Aktionen müssen nachvollziehbar und auditierbar sein.

## 3. Mandanten, Benutzer, Rollen und Audit

- Jeder geschäftliche Datensatz muss eindeutig einem Mandanten zugeordnet sein.
- Ein Benutzer darf niemals Daten eines anderen Mandanten lesen oder verändern.
- Rechte müssen serverseitig und in Supabase-RLS-Policies durchgesetzt werden.
- Versteckte Buttons sind keine Berechtigungskontrolle.
- Rollen, Rechte und Statusübergänge müssen zentral definiert werden.
- Kritische Aktionen benötigen Benutzer, Zeitpunkt, Mandant und betroffenen Datensatz.
- Finanzielle, vertragliche und abrechnungsrelevante Änderungen müssen revisionsfähig bleiben.

## 4. Zentrale Dokumentarchitektur

Soweit fachlich möglich, verwenden alle finalisierbaren Dokumentarten dieselbe zentrale Dokument- und Positionslogik.

Dazu zählen insbesondere:

- Angebote
- Angebotsnachträge
- Aufträge
- SUB-Aufträge
- Rechnungen
- Gutschriften
- Mahnungen
- Materialbestellungen
- weitere buchungs-, vertrags- oder abrechnungsrelevante Dokumente

Unterschiede zwischen Dokumentarten werden über definierte Typen, Konfigurationen und Vorlagen abgebildet, nicht durch unverbundene Kopien kompletter Systeme.

## 5. Dokumentversionierung

- Ein finalisiertes Dokument darf niemals still überschrieben werden.
- Jede erneute Bearbeitung und Finalisierung erzeugt eine neue finale Version.
- Jede finale Version enthält mindestens:
  - Versionsnummer
  - Abschlussdatum
  - Abschlussuhrzeit
  - abschließenden Benutzer
  - Änderungshinweis
  - unveränderlichen PDF-Snapshot
- Frühere Versionen müssen sichtbar, öffnungs- und downloadbar bleiben.
- Frühere Versionen sollen vergleichbar sein.
- Eine frühere Version kann bei Bedarf als Grundlage einer neuen aktuellen Version übernommen werden; die Historie bleibt erhalten.
- Entwürfe benötigen keine finale Versionsnummer und dürfen gemäß Berechtigung gelöscht werden.
- Finalisierte Dokumente dürfen nicht wie gewöhnliche Entwürfe gelöscht werden.

## 6. Dokumentdatum und PDF

- Beim Finalisieren wird das Dokumentdatum automatisch auf das aktuelle Abschlussdatum der Version gesetzt.
- Bei erneuter Finalisierung erhält die neue Version das neue aktuelle Abschlussdatum und die Abschlussuhrzeit.
- Das finale PDF zeigt das Dokumentdatum der jeweiligen Version.
- Jeder PDF-Snapshot muss exakt die damals finalisierte Version wiedergeben.
- Kopf- und Fußzeilen müssen drucksicher, positionsstabil und auf allen Seiten sichtbar sein.
- PDF-Ausgaben dürfen keine abgeschnittenen Inhalte, verrutschten Fußzeilen oder inkonsistenten Summen enthalten.

## 7. Dokumentpositionen

Positionen dürfen grundsätzlich nur eingefügt werden aus:

- Leistungsstamm
- Artikelstamm
- definierten variablen Positionen
- Regieleistungen
- Regiematerial
- einer kontrollierten Kopier-/Vorlagenfunktion aus bestehenden Dokumenten

Unkontrollierte freie Positionen sind nicht zulässig.

Beim Kopieren aus bestehenden Dokumenten gilt:

- Positionen aus mehreren Quelldokumenten dürfen gemeinsam ausgewählt und übernommen werden.
- Einzelne Positionen sowie ganze Titel oder Abschnitte dürfen ausgewählt werden.
- Quellpositionen und Quelldokumente bleiben unverändert.
- Es entsteht keine falsche Dokumentketten-Verknüpfung.
- Herkunft kann zu Audit- und Nachvollziehbarkeitszwecken gespeichert werden, ohne die Dokumentbeziehung fachlich zu verfälschen.

Das Werkzeug-/Schraubenschlüssel-Symbol einer Dokumentposition öffnet eine vollständige Positionsbearbeitung. Diese verwendet dieselbe zentrale Feld- und Kalkulationslogik wie der Leistungsstamm, verändert jedoch standardmäßig nur die Dokumentposition und nicht ungefragt den Stamm.

Bearbeitbar sind insbesondere:

- Menge
- Einheit
- Kurztext
- Langtext
- Preis
- Mehrwertsteuer
- Kalkulationsdaten
- Arbeitszeit
- Materialkosten
- variable oder regiebezogene Einstellungen

Nach Änderungen müssen Summen, PDF und abhängige Berechnungen korrekt aktualisiert werden.

## 8. Dokumenteditor und Versionshistorie

- Die Aktion „Versionen“ gehört klar beschriftet in die mittlere Dokument-Toolbar.
- Die Versionshistorie muss breit und übersichtlich sein.
- Benutzer, Abschlussdatum und Abschlussuhrzeit jeder Version müssen korrekt angezeigt werden.
- Beim Schließen eines aus der Versionshistorie geöffneten PDFs kehrt der Benutzer zur geöffneten Versionshistorie zurück.
- Nach dem Finalisieren führt die Navigation in den passenden Projekt-/Dokumentbereich zurück und bleibt nicht unnötig im Editor hängen.
- Mittige Aktionen für unzulässige freie Positionen sind zu entfernen.
- Stammdaten-Neuanlage und dokumentbezogene Schnellaktionen müssen logisch getrennt und klar beschriftet sein.

## 9. Berechnungen und Geldbeträge

- Preise, Mengen, Rabatte, Aufschläge, Steuer und Summen werden zentral berechnet.
- Geldbeträge verwenden eine konsistente Dezimal- und Rundungslogik.
- Frontendanzeige und serverseitige Berechnung dürfen nicht voneinander abweichen.
- Pauschal-, Standard- und Regiedokumente verwenden definierte Konfigurationen und passende PDF-Texte.
- Einzelpreise, Zwischensummen, Titelsummen, Mehrwertsteuer und Leistungsdetails werden je Dokumenttyp kontrolliert ein- oder ausgeblendet.

## 10. Supabase und Datenbank

- Schemaänderungen nur über neue, versionierte Migrationen.
- Bereits angewendete Migrationen nicht nachträglich ändern.
- Keine strukturellen Produktionsänderungen nur über das Dashboard.
- Vor neuen NOT-NULL-Regeln oder Constraints bestehende Daten sicher migrieren.
- Foreign Keys, Constraints, Indizes und Löschverhalten bewusst festlegen.
- Relevante Tabellen über RLS absichern.
- SELECT, INSERT, UPDATE und DELETE getrennt testen.
- Storage-Buckets und Dateien über geeignete Policies absichern.
- Service-Role- und Secret-Schlüssel niemals im Browser verwenden.
- Keine echten Geheimnisse in Repository, Tests, Logs oder Screenshots.
- Destruktive Befehle niemals gegen Produktion oder eine entfernte Datenbank ausführen.

## 11. Sicherheit

Bei jeder Änderung sind – soweit relevant – zu prüfen:

- Authentifizierung
- Autorisierung
- Mandantentrennung
- Rollen und Rechte
- serverseitige Eingabevalidierung
- direkte API-Manipulation
- Datei-Uploads, Dateityp und Dateigröße
- Storage-Zugriffe
- sensible Daten in Logs und Fehlermeldungen
- Secret-Verwendung
- ungeschützte Endpunkte oder Server Actions
- Audit kritischer Aktionen

Nach sicherheitsrelevanten Änderungen ist zusätzlich adversarial zu prüfen, wie ein normaler Benutzer die Funktion umgehen, missbrauchen oder auf fremde Daten zugreifen könnte.

## 12. UI und Tabellen

- Bestehendes Designsystem und bestehende Komponenten verwenden.
- Keine ungefragte komplette Neugestaltung.
- Deutsche, klare und konsistente Begriffe.
- Lade-, Leer- und Fehlerzustände sauber darstellen.
- Formulare gegen Mehrfachabsenden absichern.
- Tabellen mit vertikalem Scrollen behalten ihre Spaltenüberschriften sichtbar.
- Dialoge dürfen auf üblichen Bildschirmgrößen nicht außerhalb des sichtbaren Bereichs liegen.
- Sidebar, Toolbar und Aktionen werden logisch nach fachlicher Bedeutung angeordnet.
- Keine grellen oder inkonsistenten Farben.
- Browser-Konsole und Netzwerkfehler nach UI-Änderungen prüfen.

## 13. Tests und Qualitätskontrolle

Für jede Änderung sind die vorhandenen relevanten Prüfungen tatsächlich auszuführen:

- Typprüfung
- Lint
- Unit-Tests
- Integrationstests
- Produktions-Build
- End-to-End- oder Browser-Smoke-Tests
- Supabase-Migrations- und RLS-Tests

Kritische Smoke-Tests:

- Anmeldung und Abmeldung
- Rollen und Rechte
- zwei unterschiedliche Mandanten
- Projekt öffnen und bearbeiten
- Kontakt suchen und auswählen
- Dokument anlegen
- Position einfügen und vollständig bearbeiten
- Preise und Summen berechnen
- Dokument finalisieren
- neue Version erzeugen
- ältere Version öffnen
- PDF erzeugen und anzeigen
- unerlaubte Aktionen serverseitig blockieren

GitHub Actions sind die verbindliche automatische Testinstanz. **Claude/Fable 5 / Claude Code in VS Code implementiert, prüft und testet selbst**. `npm run verify` bleibt Pflicht; Browser-Smoke/e2e (`npm run e2e`, Playwright) wird gezielt bei riskanten UI-/PDF-/Dokumenteditor-/Rechte-Flows oder auf ausdrücklichen Wunsch eingesetzt, nicht automatisch für jede Kleinigkeit. Codex führt keine Prüfungen aus; es bereitet nur Prompts vor (siehe `docs/FABLE5_VSCODE_WORKFLOW.md`).

## 14. GitHub, Vercel und Freigaben

- GitHub ist die zentrale Codequelle.
- Gearbeitet wird im täglichen Lukasz/Christoph-Workflow direkt auf `main`.
- Arbeitsbeginn ist immer: `git checkout main`, `git fetch origin`, `git pull --ff-only origin main`.
- Nach Lukasz' neuer Vorgabe (Stand 2026-06-30) übernimmt Claude Code in VS Code nach dem Bauen den normalen Veröffentlichungsabschluss selbst: `npm run verify`, gezielt committen, `git fetch origin`, `git pull --rebase origin main`, neue Christoph-Commits/Konflikte sauber integrieren, erneut `npm run verify`, `git push origin main`.
- Ein pre-push Hook (`.githooks/pre-push`, aktiv via `git config core.hooksPath .githooks`) erzwingt `npm run verify` zusätzlich und blockt bei Build-/Testfehlern; Notfall-Bypass nur bewusst mit `git push --no-verify`.
- Vercel deployt automatisch bei Push auf `main`; GitHub Actions bleiben die externe technische Kontrollinstanz.
- Pull Requests sind optional für besonders riskante Änderungen (Auth/Rollen/RLS, destruktive DB-Änderungen, größere Architekturänderungen oder bewusst gewünschtes externes Review).
- **Weiterhin nur mit ausdrücklicher Freigabe von Lukasz:** destruktive oder irreversible DB-Eingriffe (Daten/Tabellen/Buckets löschen, `db reset`, destruktive Migration), Änderung von Secrets, Auth-/Rollen-Architektur, größere Mandanten- oder Architekturänderungen, Force Push / `git reset --hard` / `git clean`, Reaktivierung des Autowatchers sowie Produktivdeployment außerhalb des automatischen Vercel-Deploys bei Push auf `main`.
- Force Push auf `main` ist verboten, außer Lukasz beauftragt ihn ausdrücklich nach Risikoabwägung.

## 15. Definition of Done

Eine Aufgabe ist erst fertig, wenn:

- das fachliche Ziel erfüllt ist
- Akzeptanzkriterien nachweislich erfüllt sind
- keine unnötige doppelte Logik entstanden ist
- notwendige Migrationen und RLS-Policies vorhanden sind
- relevante Tests tatsächlich erfolgreich gelaufen sind (`npm run verify`)
- der Produktions-Build erfolgreich ist
- der geänderte Benutzerablauf passend zum Risiko geprüft wurde (bei riskanten UI-/PDF-/
  Dokumenteditor-/Rechte-Flows Browser-Smoke via `npm run e2e`, sonst gezielte manuelle
  Prüfliste – nicht automatisiert prüfbare Flows ehrlich als „manuell zu prüfen" gemeldet)
- der Stand nach `main` gepusht wurde und GitHub Actions/Vercel keine blockierenden
  Fehler melden
- offene Risiken ehrlich dokumentiert sind


## 16. Rollen: VS Code/Claude/Fable 5 und Codex (Stand 2026-07-07)

- **VS Code ist der zentrale Arbeitsort.** Claude/Fable 5, Claude Code oder ein vergleichbares hochwertiges Entwicklungsmodell übernimmt vollständig: technische Analyse, Planung, Umsetzung, Codeprüfung, App-Prüfung, gezielte Browser-Smokes (falls sinnvoll), Tests, Commits und Pushes. Das konkrete Tool und Modell werden kostenbewusst je Block gewählt: Routine mit günstigerem starkem Modell, höchste Stufe nur bei komplexen/riskanten Blöcken oder ausdrücklichem Wunsch. Entscheidend ist der saubere Git-, Test- und Entwicklungsablauf.
- **Codex wird nur noch für Anforderungssammlung und Prompt-Vorbereitung verwendet.** Codex darf den lokalen Projektordner rein lesend prüfen, damit Prompts repo-basiert und konkret sind. Codex schreibt keinen App-Code, führt keine technische Umsetzung aus und macht keine finalen App-Reviews, keine Smoke-Tests, keine Commits und keine Pushes. Die früheren Mechanismen (Post-Fertig-Prüfer, Hintergrund-Sub-Agenten, Codex-Reviews, `.codex/*`-Dateien, `tmp/codex-postsync-*`) sind abgeschafft.
- **Christoph Napetschnig arbeitet parallel direkt auf `main`.** Jeder Block startet mit Pull; vor dem Push wird erneut synchronisiert (`git pull --rebase origin main`), fremde Änderungen werden nie überschrieben, kein Force-Push.
- GitHub Actions sind die reproduzierbare externe Testinstanz; Vercel deployt automatisch bei Push auf `main`.
- Der Autowatcher/Auto-Deploy wurde entfernt; Commits/Pushes erfolgen nur bewusst am Blockende. Eine Wiedereinführung ist ein eigenes Arbeitspaket mit ausdrücklicher Freigabe.
- **Kosten-/Session-Hygiene:** Claude Code läuft über Lukasz' Claude Pro/Max/Team-Abo, nicht über API-Credits/Auto-Reload/`ANTHROPIC_API_KEY` (bei Zweifel `/status` prüfen; Details in `CLAUDE.md` und `docs/FABLE5_VSCODE_WORKFLOW.md`). Nach einem abgeschlossenen, gepushten Block wird Lukasz an `/clear` erinnert; kleine zusammenhängende Wünsche werden in einem Block gebündelt, klar unterschiedliche große Themen als getrennte Blöcke/Sessions gestartet.
- **DB-Migrationen im Entwicklungsmodus:** Wenn ein Block neue oder geänderte Supabase-Migrationen enthält, wird in VS Code automatisch `npm run db:migrate` ausgeführt, bevor verifiziert, committet und gepusht wird. Das lokale DB-Passwort/Token liegt nur in `.env.supabase.local`/`.env.local` (gitignored). Rückfrage nur bei fehlenden Secrets, destruktiven Migrationen, Migrationskonflikten oder unerwarteten DB-Fehlern. In der späteren stabilen Live-Phase wird dieser Automatismus als Sicherheits-Gate neu bewertet.
- Der vollständige verbindliche Ablauf steht in `docs/FABLE5_VSCODE_WORKFLOW.md`; die Codex-Detailregeln in `AGENTS.md` und `docs/COWORK_CODEX_WORKFLOW.md`.
