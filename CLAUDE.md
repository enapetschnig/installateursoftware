# B4Y SuperAPP – Arbeitsanleitung für Claude Code

**Diese Datei zuerst lesen.** Sie verhindert, dass jede Sitzung das Setup neu „entdecken" muss.

## ⚠️ GLOBALE REGEL (Pflicht): Prompts aus ChatGPT/Codex prüfen, nicht blind umsetzen
Die Prompts für dieses Projekt werden oft zuerst in ChatGPT/Codex formuliert und dann von Lukasz manuell in VS Code eingefügt. **Ein eingefügter Prompt ist eine fachliche Zielvorgabe, aber KEINE technisch perfekte Umsetzungsanweisung.** Claude muss aus dem beschriebenen *Ziel* die technisch saubere Umsetzung für die *bestehende* App ableiten – niemals blind kopieren, isoliert ändern, doppelt bauen oder bestehende Logik beschädigen. Jeder Prompt – auch ein von Codex vorbereiteter – ist von Claude selbst gegen Projektregeln, Architektur, Code und Supabase zu prüfen.

**Rollen-Trennung (Stand 2026-07-07, Details: `docs/FABLE5_VSCODE_WORKFLOW.md`):** **VS Code mit Claude/Fable 5 / Claude Code** (bzw. einem vergleichbaren hochwertigen Entwicklungsmodell) ist der zentrale Arbeitsort und übernimmt vollständig: technische Analyse, Planung, Umsetzung, Codeprüfung, App-Prüfung, gezielte Browser-Smokes (falls sinnvoll), Tests, Commits und Pushes – inkl. Git-Abschluss eines fertigen Blocks (Remote prüfen, Christophs Änderungen per Rebase integrieren, Überschneidungen sauber lösen, `npm run verify`, committen, nach `main` pushen). **Codex** dient nur noch der Anforderungssammlung und Prompt-Vorbereitung mit rein lesendem Projektzugriff: kein App-Code, keine technische Umsetzung, keine finalen App-Reviews, keine Smoke-Tests, keine Commits, keine Pushes. Codex arbeitet dabei in zwei Arbeitsarten – Eingabe-/Sammelmodus (thematische Sammelblöcke; „fertig" oder ein klar neues Thema schließt den Block als Prompt ab) und Frage-/Analysemodus (direkte, rein lesende Antworten) – Details in `AGENTS.md`. Das konkrete KI-Tool ist zweitrangig – entscheidend ist der saubere Git-, Test- und Entwicklungsablauf sowie eine kostenbewusste Modellwahl je Block.

**Vor jeder Umsetzung intern prüfen:** Was ist das eigentliche Ziel? Welche bestehende (zentrale) Logik gibt es dafür schon? Wo gehört die Änderung fachlich richtig hin? Welche Module/Datenstrukturen sind betroffen? Welche Risiken? Welche Lösung ist langfristig sauber? Dann: Passt der Prompt zu (1) Codebasis, (2) Architektur, (3) Supabase-Struktur, (4) Gesamtlogik, (5) Mandantenfähigkeit, (6) Rechte/Rollen, (7) Workflows, (8) Dokumenttypen/PDFs/Nummernkreisen/Textbausteinen, (9) bestehenden Projektregeln, (10) ohne bestehende Funktionen zu beschädigen?

**Leitlinien:** Wenn ein Prompt „neuen Reiter erstellen" sagt, aber ein passender Bereich existiert → in den bestehenden integrieren statt neu bauen. Nennt ein Prompt fixe Dokumenttypen, die App nutzt aber dynamische → über IDs/Einstellungen/Mandantenlogik lösen, nichts hartcodieren. Erwähnt ein Prompt nur Angebote, betrifft die Logik aber auch Aufträge/Rechnungen → in der gesamten Dokumentlogik sauber erweitern. Beschreibt ein Prompt eine UI-Änderung → auch Mobile, Dark/Light, Rechte, DB, PDF und abhängige Module mitprüfen.

**Eindeutiger Prompt:** sauber umsetzen → Gesamtlogik prüfen → testen. **Unklar/widersprüchlich:** nicht blind falsch umsetzen, naheliegendste saubere Lösung wählen, ggf. **eine** Rückfrage, keine riskante Änderung erzwingen. **Globale Priorität:** bestehende Architektur + globale Projektregeln haben Vorrang vor einzelnen Formulierungen eines kopierten Prompts (besonders: Mandantenfähigkeit, flexible Konfigurierbarkeit, keine BAU4YOU-Hardcodierung, zentrale Dokument-/PDF-/Textbaustein-/Nummernkreis-Logik, Versionierung, Rechte/Rollen, Mobile, Dark/Light, sticky Tabellenköpfe, keine isolierten Schnelllösungen). **Immer: prüfen → einordnen → technisch sauber anpassen → in die Gesamtlogik integrieren → testen.**

## ⚠️ GLOBALE REGEL (Pflicht): Erst verstehen, dann bauen (Stand 2026-06-23)
Die meisten Folgefehler entstehen durch zu frühes Schreiben. Daher **vor jeder nicht-trivialen Änderung zuerst lesen & verstehen**, dann erst umsetzen:
- **Gezielt lesen statt raten:** zuerst die passende `docs/funktionen/<funktion>.md` (= Modul-/Abhängigkeitskarte), dann die echten Dateien in `src/…`, zentrale Libs (`src/lib/*`), betroffenes Supabase-Schema + RLS. Nicht das ganze Repo lesen – gezielt die betroffenen Bereiche (gern read-only-Suchagenten parallel; aber **nicht** parallel an denselben/abhängigen Dateien schreiben).
- **Modul-Zusammenhänge benennen:** Welche zentrale Logik existiert schon? Welche Komponenten/Services/Typen hängen daran? Wo gehört die Änderung fachlich hin? Erst danach die kleinste saubere Lösung bauen (zentrale Logik erweitern, keine Doppellogik).
- **Build-Wahrheit:** Ein Sandbox-`tsc`/Build kann durch Mount-Encoding unzuverlässig sein (NUL/Phantomfehler, auch bei unveränderten Dateien) → **nie als Test-/Fertig-Beweis** verwenden. Maßgeblich ist Lukasz' lokales `npm run verify` (pre-push) bzw. der Vercel-Build. Lieber „lokal verify nötig" im Bericht schreiben als Tests/Ergebnisse erfinden.

## ⚠️ GLOBALE REGEL (Pflicht bei JEDER Änderung): Änderungen immer in die Gesamtlogik integrieren
Diese Regel gilt **dauerhaft** für das gesamte Projekt und für **alle zukünftigen Prompts und Änderungen**. Egal welche Änderung, Erweiterung, Korrektur oder neue Funktion: **niemals nur isoliert die einzelne Stelle ändern.** Die App ist immer als zusammenhängendes System zu betrachten – keine halben Änderungen, keine isolierten Schnelllösungen, keine Funktionen, die nur an einer Stelle funktionieren, keine kaputten Folgefunktionen.

**Vor jeder Umsetzung prüfen** (Auswirkungs-Analyse):
1. Welche bestehenden Funktionen sind betroffen?
2. Welche Module hängen damit zusammen?
3. Welche Datenstrukturen / Supabase-Tabellen sind betroffen?
4. Welche Dokumente / Dokumentarten sind betroffen?
5. Welche PDFs / PDF-Vorschauen / PDF-Layouts sind betroffen?
6. Welche Auswertungen / Statistiken / Dashboards sind betroffen?
7. Welche Einstellungen / Stammdaten sind betroffen?
8. Welche Rechte / Rollen / Zugriffsrechte sind betroffen?
9. Welche Workflows sind betroffen?
10. Welche mobilen / Tablet- / Desktop-Ansichten sind betroffen?
11. Welche Dark-/Light-Mode-Darstellungen sind betroffen?
12. Welche bestehenden Automatismen / Standardwerte sind betroffen?

Hat eine Änderung Auswirkungen auf andere Bereiche, werden diese **direkt mitangepasst**. Beispiele:
- **Neuer Dokumententyp** → Dokumentarten, Vor-/Nachtexte, PDF-Erstellung, Nummernkreise, Rechte, Upload/Erstellung, Projektzuordnung, Auswertungen, Suche, Filter, Export, Vorschau.
- **Neue Kontaktart** → Kontakte, Projekte, Dokumente, Auswertungen, Filter, Rechte, Auswahlfelder, PDFs, E-Mail-Funktionen, Tabellenansichten.
- **Feld geändert/ergänzt** → Formular, Tabelle, Detailansicht, Bearbeitungsmodal, Datenbank, Validierung, Suche, Filter, Export, PDF, mobile Ansicht.

**Nach jeder Änderung prüfen:** funktioniert die ursprüngliche Funktion? alle abhängigen Funktionen? bleiben bestehende Daten erhalten? UI sauber? Dark- und Light-Mode? Tabellen/Filter/Suche? Dokumente/PDFs? Berechtigungen? keine neuen Konsolenfehler? Lösung zukunftssicher und wiederverwendbar?

Jede Änderung muss vollständig, sauber und professionell in die bestehende Gesamtlogik passen. Ergänzt den Skill „app-planen-bauen-pruefen" (Planen → Bauen → Prüfen) um die verpflichtende Auswirkungs-Analyse.

## ⚠️ GLOBALE REGEL (Pflicht bei JEDER Änderung): Funktions-Dokumentation mitpflegen
Unter **`docs/funktionen/`** liegt pro Funktion eine `.md` (Aufbau: oben Anwender, unten Technik – exakte Routen, Komponenten, Supabase-Tabellen/-Felder, zentrale Logik, „so erweitern"). Diese Doku **muss mit der App mitwachsen** – sie ist Teil der Definition-of-Done jeder Änderung, kein optionaler Nachgang.

**Bei JEDER Änderung gilt zusätzlich zur Auswirkungs-Analyse:**
- **Funktion geändert/erweitert** → die zugehörige `docs/funktionen/<funktion>.md` im selben Schritt aktualisieren (neue Felder/Spalten, Status-/Enum-Werte, Routen, Tabellen, Logik, Bedienschritte, Erweitern-Hinweise).
- **Neue Funktion/Modul/Engine** → **neue** `docs/funktionen/<name>.md` nach der Vorlage in `docs/funktionen/README.md` anlegen **und** im Index (README-Tabelle) verlinken.
- **Funktion entfernt/zusammengelegt** → Datei entfernen/zusammenführen, Index + Querverweise (`[[…]]`/Links) bereinigen.
- **DB-Migration** (neue/geänderte Tabelle/Spalte/Enum) → exakte Feldlisten in der betroffenen `.md` nachziehen; bei neuer Tabelle prüfen, ob `organization_id` + RLS dokumentiert sind.
- **Querbezüge** prüfen: betrifft die Änderung mehrere Funktionen (z. B. Dokumentkette, PDF, Nummernkreise, Rechte), alle betroffenen `.md` mitpflegen und untereinander verlinken.

**Genauigkeit:** Feldlisten/Enums stammen aus der echten Codebasis/Supabase-Struktur (nicht raten). Im Zweifel kurz gegen `src/…` bzw. `information_schema` prüfen. Die Doku ist eine **lebende Basis** für Anwender-Einschulung **und** KI-gestützte Weiterentwicklung – deshalb immer aktuell, präzise und mandantenneutral halten (keine BAU4YOU-Hardcodierung in der Beschreibung als „so muss es sein").

## ⚠️ GLOBALE PRODUKTREGEL (Pflicht): Mehrfirmen-/Mandantenfähige, vermarktbare Software
Die B4Y SuperAPP ist **nicht** nur die interne App von BAU4YOU, sondern soll als **Softwareprodukt (SaaS) an andere Firmen** verkauft werden. Daher: **niemals hart auf eine einzige Firma zuschneiden.** Alles flexibel, mandantenfähig, skalierbar, individuell konfigurierbar bauen.

**Keine hartcodierten BAU4YOU-Werte im Code** – nicht „BAU4YOU", bestimmte Kunden, Projektarten, Dokumentarten, Nummernkreise, Texte oder Workflows als fixe Programmlogik. BAU4YOU-Standards immer als **Standardkonfiguration / Seed-Daten / Vorlage** (in DB/Einstellungen), die andere Firmen ändern, deaktivieren oder ersetzen können. Fixe Fallback-Werte im Code sind nur als Notfall-Default erlaubt, wenn die DB (noch) leer ist – nie als einzige Quelle.

**Bei JEDER Änderung zusätzlich prüfen:** Ist das nur für BAU4YOU oder allgemein nutzbar? Könnte eine andere Firma es genauso verwenden? Sind Texte/Bezeichnungen/Werte einstellbar (DB statt Code)? Funktioniert es mandantenfähig und sind die Daten sauber je Firma getrennt? Können andere Firmen eigene Dokumentarten, Nummernkreise, Texte, Workflows, Rollen/Rechte, PDF-Layouts, Logos/Farben/Firmendaten verwalten?

**Mandanten-Zuordnung:** Bei **neuen Tabellen** immer prüfen, ob eine Firmen-/Mandanten-Zuordnung nötig ist (z. B. `company_id`/`tenant_id`/`organization_id` – Bezeichnung passend zur bestehenden Architektur). Daten verschiedener Firmen dürfen **nie** vermischt werden; Rechte ggf. pro Firma prüfen; firmenspezifische Standardwerte vorsehen. Hinweis: Aktuell ist das System faktisch Einzelmandant (eine `company_settings`-Zeile id=1); neue Funktionen aber bereits mandantentauglich denken/strukturieren, damit die spätere Mehrmandanten-Einführung kein Umbau wird.

**Vollständig konfigurierbar (Ziel):** Firmeneinstellungen (Name/Adresse/UID/Bank/Kontakt/Logos/Icon/Farben/Design/Sprache), Dokumente (Arten, Untertypen, Nummernkreise, Vor-/Nachtexte, PDF-Layouts, Pflichtfelder, Sichtbarkeit von Preisen/Summen/Bildern/Artikeln/Steuer je Typ), Texte (alle Textbausteine + E-Mail-Texte + Platzhalter), Workflows (Anfrage/Angebot/Auftrag/Rechnung/Nachtrag/Regie/Abnahme/Mahnung + eigene), Rechte/Rollen (frei definierbar), Kalkulation (Gewerke/Leistungen/Artikel/Einheiten/Stundensätze/Zuschläge/Rabatte/Gemeinkosten/Gewinn), Auswertungen (firmenspezifische Dashboards/Filter). Produktqualität: wie professionelle SaaS für Bau-/Handwerks-/Dienstleistungsfirmen, nicht wie eine Einzel-Speziallösung.

## ⚠️ GLOBALE REGEL (Pflicht): Flexible, erweiterbare Basissoftware + KI-Weiterentwicklung
Die B4Y SuperAPP wird als **Basissoftware** verkauft, die der Kunde nach Übergabe **selbst** (auch mit KI-Tools wie Claude Code) erweitern, anpassen und weiterentwickeln kann. BAU4YOU ist nur die **erste Beispiel-/Standardkonfiguration**.

**Leitsatz: So viel wie möglich über Einstellungen lösbar machen – nur echte Spezialwünsche als individuelle Erweiterung programmieren.** Der Kunde muss nach Übergabe selbst können: Mitarbeiter/Rollen/Rechte, Dokumenttypen/-Untertypen/-Zugehörigkeiten, Nummernkreise, Texte/Vor-/Nachtexte, PDF-Layouts, Projektarten/Workflows, Stammdaten, Farben/Logos/Firmendaten, Auswertungen/Filter – alles über die App-Einstellungen, ohne Code-Änderung.

**Damit KI-gestützte Weiterentwicklung leicht bleibt, beim Bauen beachten:** klare Ordnerstruktur, verständliche Komponenten, sprechende Namen, zentrale wiederverwendbare Funktionen (`src/lib/*`), saubere Datenmodelle, Kommentare bei komplexer Logik, keine unnötige Speziallogik. Architektur + „wie baue ich Neues ein"-Anleitung stehen in **`docs/architecture.md`** – diese Datei bei größeren strukturellen Änderungen aktuell halten.

**Verkaufs-/Servicemodell** (Kontext): Grundsoftware → Einrichtung → Einschulung → KI-Erweiterungsschulung → Erweiterung nach Bedarf. Die App muss deshalb stabil, sauber dokumentiert, mandantenfähig, flexibel konfigurierbar und für fremde Firmen verständlich sein.

## Wo wird gearbeitet
- **Hier, direkt in diesem Ordner:** `F:\Users\baranowski4\Projekte\b4y-superapp` — das ist der **echte Git-Klon** (privates Repo `MUSHLUKASZ/b4y-superapp`, Branch **`main`**).
- NICHT im Cowork-Ordner `…\Claude\Projects\B4Y SuperAPP\app` arbeiten — der ist nur ein alter Spiegel.
- Falls dieser Ordner nicht verbunden ist: über „Ordner verbinden" `F:\Users\baranowski4\Projekte` einbinden.

## Stack
- React 18 + **Vite + TypeScript (.tsx!)** + Tailwind. Projekt liegt im **Stammverzeichnis** (`src/`, `supabase/`).
- Backend: **Supabase** Projekt `xyhgckqxowqnzjtoblfs` (EU, Installateursoftware / Bad.Werk). DB-Migrationen als Datei in `supabase/migrations/` ablegen und aus VS Code/Claude Code automatisch mit `npm run db:migrate` anwenden. Dieser Befehl nutzt den **plattformunabhängigen Node-Runner `scripts/db-migrate.mjs`** (macOS/Windows/Linux): er wendet neue Dateien über die Supabase-Management-API an und trackt sie in `b4y_internal.migration_files` – nicht blindes `supabase db push`. `0000_baseline_schema.sql` bildet das komplette Ausgangsschema ab; `0130`–`0136` liefern Positionskatalog, Bad.Werk-Startkonfiguration, Zeiterfassung, Regieberichte, Mitarbeiter-App und Plantafel. Lokale Secrets (`SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`) stehen nur in `.env.supabase.local`/`.env.local` (gitignored), niemals im Repo.
- Hosting: **Vercel** (Projekt `b4y-superapp`, Account `ipad-1611s-projects`), Auto-Deploy bei Push auf `main`. Live (Custom Domain): **https://b4y-superapp.app** (Vercel-Default `b4y-superapp.vercel.app` bleibt erreichbar).
- **Produkt-/Domain-Branding zentral & white-label:** `src/lib/branding.ts` (`APP_NAME` aus `VITE_APP_NAME` Default „B4Y SuperAPP"; `APP_URL`/`appUrl()` aus `VITE_APP_URL` Default `https://b4y-superapp.app`). KEINE harte Vercel-URL/kein harter Produktname im Code. Firmenname/Logo/Farben/PDF-Firmendaten bleiben pro Mandant in `company_settings`.

## Deploy = direkter Claude-Code-Main-Workflow (KEIN Autowatcher)
- **Der Autowatcher wurde entfernt** (kein `Start-AutoDeploy.bat`, `scripts/Auto-Deploy.ps1`, `git-push.bat` oder `.watcher-status/` mehr). Es gibt keine blinde Hintergrund-Automation. Stattdessen führt **Claude Code in VS Code** den bewussten Abschluss eines fertigen Arbeitsblocks selbst aus: Sync, Verify, Commit, Push.
- **Gearbeitet wird direkt auf `main`.** Lukasz und Christoph pushen in denselben Hauptbranch. Deshalb ist der erste Schritt zu Arbeitsbeginn immer:
  ```bash
  git checkout main
  git fetch origin
  git pull --ff-only origin main
  ```
- **Nie von einem alten Stand ausgehen:** Vor jeder Umsetzung `git status` prüfen. Wenn lokale Änderungen offen sind, erst committen, stashen oder bewusst klären – nicht blind pullen.
- **Nach dem Bauen: eigenständig synchronisieren, prüfen, committen und pushen.** Claude Code macht diesen Abschluss selbst:
  ```bash
  git status
  npm run db:migrate   # nur wenn der Block Supabase-Migrationen enthaelt
  npm run verify
  git add <gezielte Dateien>
  git commit -m "<kurze klare Commit-Message>"
  git fetch origin
  git pull --rebase origin main
  npm run verify
  git push origin main
  ```
  Wenn Christoph inzwischen gepusht hat, wird der lokale Commit auf `origin/main` rebased. Bei Konflikten/Überschneidungen: Konfliktdateien fachlich sauber lösen, `git add <gelöste Dateien>`, `git rebase --continue`, danach erneut `npm run verify` und erst dann pushen. Wenn die Überschneidung fachlich unklar ist oder eine echte Geschäftsentscheidung verlangt, Lukasz fragen.
  DB-Migrationen in der Entwicklungsphase nicht jedes Mal bei Lukasz rückfragen: Wenn `supabase/migrations/` geändert wurde, vorher automatisch `npm run db:migrate` ausführen. Stoppen und fragen nur bei fehlendem lokalem DB-Passwort/Token, destruktiven Migrationen, Migrationskonflikten oder unerwarteten DB-Fehlern.
- **Vercel** deployt automatisch bei Push auf `main`. GitHub Actions bleiben die externe technische Kontrollinstanz.
- **Pull Requests sind optional**, nicht der Standardweg. Sie sind sinnvoll bei besonders riskanten Änderungen (Auth/Rollen/RLS, destruktive DB-Änderungen, größere Architekturänderungen oder bewusst gewünschtes externes Review).
- **Nur Lukasz** entscheidet weiterhin über: destruktive/irreversible DB-Eingriffe (Daten/Tabellen/Buckets löschen, `db reset`), Secrets, Rollen-/Auth-Architektur, Autowatcher-Reaktivierung, Force-Push/Reset/Clean, echte Geschäftsentscheidungen.
- **Verboten:** Force Push auf `main`, `git reset --hard`/`git clean` ohne ausdrückliche Freigabe, Secrets im Repo, ungeprüfte produktive DB-Eingriffe.

## Arbeitsweise je Prompt (Plan-zuerst + Block-Batching, Stand 2026-07-07)
- **Plan zuerst:** Bei jedem neuen Prompt/Block zuerst einen **Gesamtplan für ALLE Aufgaben** des Blocks erstellen, offene Entscheidungen/Varianten **mit Lukasz abklären** (gebündelte Rückfrage) und **alle Aufgaben in die Fortschrittsanzeige/Task-Liste** schreiben. **Erst nach Lukasz' OK** mit dem Bauen beginnen – kein Losbauen vor Plan + Abstimmung + Task-Liste.
- **Kostenbewusste Modellwahl:** Nicht automatisch das teuerste/höchste Modell verwenden. Für Routine-Blöcke (Texte, Labels, kleine UI-Fixes, Doku, einfache Tabellen/Filter) ist ein günstigeres starkes Modell wie Sonnet/Standard der Default. Fable/Opus/höchste Stufe nur für komplexe oder riskante Blöcke (PDF-Engine, Dokumentversionierung, RLS/Rechte, Datenbank/Migrationen, Architektur, schwer reproduzierbare Bugs) oder wenn Lukasz es ausdrücklich verlangt. Zu Beginn eines Blocks kurz `/model` prüfen bzw. die gewählte Modellstufe benennen; bei echter Blockade oder hohem Risiko hochschalten statt dauerhaft maximal teuer zu arbeiten.
- **Block-Batching:** Alle Punkte eines Blocks werden lokal fertiggebaut und als **ein sauberer Commit/Push-Block auf `main`** geliefert. Nicht pro Einzelpunkt pushen, wenn die Punkte fachlich zusammengehören. Claude Code aktualisiert vor der Veröffentlichung selbst gegen `origin/main`, rebased ggf. Christophs neue Commits und führt `npm run verify` aus.
- **Codex-Prompt:** Wenn ein Prompt von Codex kommt, wurde er aus Lukasz' Sammelblock (direkt, Mail, Screenshot, PDF, Notiz) erstellt – Codex hat dafür das Repo nur **lesend** geprüft. Lukasz kopiert ihn manuell in VS Code/Claude Code. Claude Code prüft ihn trotzdem selbst gegen Code, Regeln, Supabase und Gesamtlogik. Danach führt Claude Code den kompletten Abschluss bis `git push origin main` selbst aus.
- **Git-Zuständigkeit:** Claude Code darf im normalen Arbeitsblock die nötigen Git-Schritte ausführen (`status`, `fetch`, `pull --rebase`, Konflikte lösen, `add`, `commit`, `push origin main`). Verboten bleiben Force-Push, `git reset`, `git clean`, ungeklärte destruktive Aktionen und fachlich riskante Konfliktentscheidungen ohne Lukasz.
- **DB-Migrationen:** Wenn ein Block Supabase-Migrationen ändert oder neue Dateien in `supabase/migrations/` erstellt, führt Claude Code vor `npm run verify` automatisch `npm run db:migrate` aus. In der Entwicklungsphase nicht jedes Mal bei Lukasz nachfragen. Der Befehl verwendet den B4Y-Migrationsrunner (`docs/SUPABASE_MIGRATIONS.md`), weil die Remote-Historie ältere Zeitstempel-Versionen nutzt. Stoppen und fragen nur bei fehlendem lokalem DB-Passwort/Token, destruktiven Migrationen, Migrationskonflikten oder unerwarteten DB-Fehlern.
- **Prüfen nach dem Bauen (Stand 2026-07-07):** `npm run verify` bleibt Pflicht vor Commit/Push und nach Rebase. Code-/App-Prüfung macht **Claude Code selbst** – es gibt keinen Codex-Post-Fertig-Prüfer, keine Hintergrund-Sub-Agenten und keine `tmp/codex-postsync-*`-Berichte mehr. Playwright/e2e (`npm run e2e`) nur gezielt bei riskanten UI-/PDF-/Dokumenteditor-/Rechte-Flows oder auf ausdrücklichen Wunsch; keine neuen e2e-Tests für Kleinigkeiten, wenn eine kurze manuelle Prüfliste genügt. Nicht automatisiert prüfbare Flows ehrlich als „manuell zu prüfen" melden – keine erfundenen Testergebnisse.
- **Abo-/Billing-Hygiene:** Claude Code soll mit Lukasz' Claude Pro/Max/Team-Konto laufen und nicht versehentlich über API-Key/PAYG. Wenn ein API-Credit-/Pay-as-you-go-Dialog erscheint, nur nach ausdrücklicher Zustimmung verwenden. **Kurze Prüfanleitung:** (1) In Claude Code `/status` prüfen (Auth-Methode = Claude-Abo, nicht API-Key); (2) bei Zweifel `/login` bzw. aktives Konto prüfen; (3) auf claude.ai unter Abrechnung prüfen, ob ein Pro/Max/Team-Plan aktiv ist; (4) in der Anthropic Console prüfen, ob API-Credits/**Auto-Reload (Auto-Recharge)**/API-Keys aktiv sind – die verursachen separate Verbrauchsrechnungen und sind **nicht** im Abo enthalten. Ein gesetztes `ANTHROPIC_API_KEY` kann dazu führen, dass Claude Code über API-Verbrauch statt über das Abo läuft. Bei langen Sessions `/status` gelegentlich erneut prüfen.
- **Session-Hygiene:** Nach einem abgeschlossenen und gepushten Block erinnert Claude Code Lukasz am Ende der Zusammenfassung daran, die Session mit `/clear` zu leeren (kleiner Kontext = weniger Verbrauch/Limit-Last). Mehrere kleine zusammenhängende Wünsche dürfen im selben Block gesammelt werden; klar unterschiedliche große Themen besser als getrennte Blöcke/frische Sessions starten.
- **Gedächtnis ↔ Doku synchron:** Was dauerhaft ins Projektgedächtnis geschrieben wird (Regeln/Entscheidungen/Konventionen), wird **automatisch auch in die passenden `.md`-Dateien** übernommen (`CLAUDE.md`, `AGENTS.md`, `docs/FABLE5_VSCODE_WORKFLOW.md`, `docs/MASTER_REGELN_B4Y-SuperAPP.md`, `docs/funktionen/*`) – damit Regeln versioniert und für Codex/andere Sitzungen sichtbar sind. (Reine, kurzlebige Arbeitsstände müssen nicht in die Doku.)

## Build prüfen
- `npm install` einmalig im Ordner, dann `npm run typecheck` / `npm run build`.
- **Achtung Sandbox-Mount-Lag:** Frisch geschriebene Dateien werden über die Bash-Sandbox teils abgeschnitten gelesen (NUL/Trunkierung). Lokaler `tsc` zeigt dann Phantom-Syntaxfehler. → Im Zweifel der **Vercel-Build ist die Wahrheit** (Deployment-Status prüfen). Datei-Tool (Read/Write) liest/schreibt korrekt die echte Platte.

## Lokaler Entwickel-Workflow (Stand 2026-07-06, Details: `docs/FABLE5_VSCODE_WORKFLOW.md`)
Schnellster Loop für Lukasz – `main` aktualisieren, lokal entwickeln, Claude Code prüft und veröffentlicht selbst:
1. **Arbeitsbeginn:** `git status --short --branch`, `git fetch origin`, `git pull --rebase origin main` (lokale Änderungen vorher klären, nie überschreiben).
2. **Lokal vorschauen:** `npm run dev` (Vite, UI/DB schnell) oder `vercel dev` (voller Stack inkl. `/api/ai/*` für Isabella-Chat/Voice; Secrets via `vercel env pull .env.local`, gitignored). Daten = echtes Supabase → Schreibaktionen produktiv (Testdaten markieren, z. B. „E2E-TEST").
3. **Prüfen:** Claude Code prüft Code und App selbst; Playwright/e2e nur gezielt bei riskanten UI-/PDF-Flows oder auf Wunsch, sonst kurze manuelle Prüfliste.
4. **Claude-Code-Abschluss:** Nach Umsetzung `npm run verify`, gezielt committen, `git fetch origin`, `git pull --rebase origin main`, ggf. Konflikte lösen, erneut `npm run verify`, dann `git push origin main`.
5. **Schutz:** Ein `pre-push`-Hook (`.githooks/pre-push`, aktiviert via `git config core.hooksPath .githooks`) führt `verify` automatisch aus und blockt den Push bei Build-/Testfehlern.

## Konventionen
- Auf Deutsch arbeiten. Bestehendes Design (Glas, BAU4YOU-Rot, 4 Themes) wiederverwenden.
- Österr. Recht beachten (Rechnungen §11 UStG, Nummernkreise, EUR/20% Default).
- Module bauen: erst planen → bauen → prüfen (siehe Skill „app-planen-bauen-pruefen").

## Geräte-Strategie (WICHTIG, Stand 2026-06-14)
Primäre Zielgeräte sind **PC und iPad** — darauf wird gebaut und optimiert.
Das **Handy** wird NICHT pro Feature mit-optimiert. Stattdessen kommt **ganz zum Schluss**, wenn alle Module fertig sind, eine **eigene schlanke Handy-Version** mit nur den wichtigsten Funktionen (z.B. Projekte ansehen, Fotos/Videos aufnehmen, Zeiten/Notizen) — KEIN Angebote-Schreiben o.Ä. am Handy.
→ Also: bei neuen Features nicht in Handy-Feinschliff (<640px) versenken. Sinnvolle Responsivität für iPad reicht.

Bereits umgesetzte, harmlose Mobil-Basics bleiben drin (helfen auch dem iPad): Eingabefelder ≥16px (kein iOS-Zoom), Touch-Ziele ≥44px, Modals als Vollbild-Sheet am Handy, responsive Formular-Raster. Globale Regeln in `src/index.css` (Block „Mobile-Optimierung").

## Design-/Farbsystem (Stand 2026-06-15)
Drei unabhängige Achsen über zentrale CSS-Tokens, gesteuert in `src/lib/theme.tsx`:
- **themeMode** (light/dark/**system**), **accentTheme** (7 Schemata), **eyeCareMode** (Augenschon).
- Anwendung auf `<html>`: Klassen `dark` / `warm-light` / `warm-dark` + Attribut `data-accent="…"`. Speicherung: localStorage (`b4y-theme-mode`, `b4y-accent`, `b4y-care`); Anti-Flash-Script in `index.html`.
- **Tokens in `src/index.css`:** Akzent-Schemata setzen nur `--accent-base*`; Modus-Blöcke lösen daraus `--accent`/`--accent-h`/`--accent-a`/`--accent-soft` auf (Dunkel = darkPrimary, Augenschon = entsättigt per `color-mix` + warmes Beige). Semantische Aliase `--color-*` (z. B. `--color-primary`). `--c-red/-amber/-green` bleiben fix (Gefahr rot, Erfolg grün, Warnung orange).
- Alt-Rot `brand-*` wird global auf `var(--accent)` gemappt → bestehende Komponenten folgen automatisch.

**Neues Farbschema hinzufügen (2 Schritte):**
1. In `src/index.css` unter „1) AKZENT-SCHEMATA" einen Block ergänzen: `[data-accent="NAME"] { --accent-base:…; --accent-base-h:…; --accent-base-soft:…; --accent-base-dark:…; }`
2. In `src/lib/theme.tsx` die Liste `ACCENT_THEMES` um `{ key:"NAME", label:"…", swatch:"#…", darkSwatch:"#…" }` erweitern (key muss zum `data-accent` passen). Reiter + Topbar-Dropdown ziehen automatisch nach.

## UI-Regeln (global)
- **Sticky Tabellen-Header:** Alle Tabellen in der B4Y SuperAPP müssen bei vertikalem Scrollen sticky Spaltenüberschriften haben. Diese Regel gilt global für bestehende und zukünftige Tabellen. Zentral gelöst in `src/index.css` (`thead th` sticky + deckend `var(--card)`; `.overflow-x-auto:has(> table)` als beschränkter Scrollbereich). Neue Tabellen einfach wie gewohnt in `<div className="overflow-x-auto …"><table>…` wickeln – Header klebt automatisch. Details: `docs/ui-guidelines.md`.

## Bekannte Altlasten
- Zwei `0004_*`-Migrationsdateien (Nummernkollision) — harmlos, bei Gelegenheit umnummerieren.
