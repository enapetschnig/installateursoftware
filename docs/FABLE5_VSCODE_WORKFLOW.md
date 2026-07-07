# B4Y SuperAPP – Entwicklungs-Workflow: VS Code + Claude/Fable 5 (Stand 2026-07-06)

**Diese Datei ist die zentrale, verbindliche Beschreibung des Arbeitsablaufs.**
Alle anderen Regeldateien (`CLAUDE.md`, `AGENTS.md`, `docs/MASTER_REGELN_B4Y-SuperAPP.md`,
`docs/COWORK_CODEX_WORKFLOW.md`) verweisen hierher und dürfen ihr nicht widersprechen.

## 1. Ziel

Ein einziger, klarer Ablauf: Anforderungen werden in Codex gesammelt und als Prompt
vorbereitet; **die gesamte technische Arbeit passiert in VS Code** mit Claude/Fable 5,
Claude Code oder einem vergleichbaren hochwertigen Entwicklungsmodell. Das Modell wird
pro Block **kostenbewusst nach Risiko und Schwierigkeit** gewählt – nicht automatisch
immer in der teuersten/höchsten Stufe. Entscheidend sind: sauberes Arbeiten im lokalen
VS-Code-Projekt, aktueller Git-Stand, keine überschriebenen Änderungen,
nachvollziehbare Commits, erfolgreiche Prüfungen und ein sauberer Push nach `main`.

## 2. Rollen

### Codex – Anforderungssammlung und Prompt-Vorbereitung

- Lukasz sammelt Anforderungen in Codex (direkt, aus E-Mails, Screenshots, PDFs, Notizen).
- Codex darf den lokalen Projektordner **rein lesend** prüfen (Ordnerstruktur, Doku,
  Code), damit Prompts repo-basiert und konkret sind.
- Codex erstellt daraus einen **kopierfertigen Prompt** für VS Code/Claude/Fable 5:
  konkrete Dateien/Komponenten, vorhandene zentrale Logik zum Wiederverwenden,
  betroffene Supabase-Tabellen/RLS, Risiken, Akzeptanzkriterien, sinnvolle Prüfungen.
- **Zwei Arbeitsarten (Details in `AGENTS.md`):** Im **Eingabe-/Sammelmodus** sammelt
  Codex Anforderungen thematisch in einem Sammelblock; „fertig" oder ein klar neues
  Thema schließt den Block ab → Codex erstellt den Prompt und startet den nächsten
  Sammelblock bei null. Im **Frage-/Analysemodus** beantwortet Codex Fragen zur
  App/zum Code direkt (rein lesend) und kann daraus entstehende Anforderungen als
  Sammelpunkt vorschlagen. Codex sagt jeweils kurz dazu, wie er eine Nachricht
  einordnet (Sammelpunkt, Analysefrage oder Blockabschluss).

**Grenzen von Codex (verbindlich):**

- Codex schreibt **keinen App-Code** und verändert **keine App-Dateien**.
- Codex führt **keine technische Umsetzung** aus.
- Codex macht **keine finalen App-Reviews**, **keine Smoke-Tests**, **keine Commits**
  und **keine Pushes**.
- Die früheren Codex-Mechanismen (Post-Fertig-Prüfer, Hintergrund-Sub-Agenten,
  Codex-Smoke-Tests, Codex-Reviews, `.codex/review.md`, `.codex/claude_fix_prompt.md`,
  `tmp/codex-postsync-*`) sind **kein aktiver Workflow mehr**. Lokale Restdateien
  davon sind bedeutungslos und gitignored.

### VS Code + Claude/Fable 5 – der zentrale Arbeitsort

Claude/Fable 5 (oder ein vergleichbares hochwertiges Entwicklungsmodell) übernimmt
nach dem Einfügen des Prompts **alles**:

1. technische Analyse (Prompt gegen Codebasis, Projektregeln, Supabase, Rollen/Rechte,
   Mandantentrennung, Dokumentlogik, PDFs prüfen – ein Prompt ist eine fachliche
   Zielvorgabe, kein fertiger Bauplan)
2. Planung (Gesamtplan + Task-Liste; offene fachliche Entscheidungen gebündelt klären)
3. Umsetzung (kleinste saubere Lösung, zentrale Logik erweitern, Doku unter
   `docs/funktionen/` mitpflegen)
4. Codeprüfung und App-Prüfung
5. Browser-Smoke, falls sinnvoll (siehe Abschnitt 6)
6. `npm run verify`
7. Commit (gezielt, nachvollziehbare Message)
8. Pull/Rebase vor dem Push
9. erneut `npm run verify`
10. Push nach `main`
11. In der Abschluss-Zusammenfassung Lukasz daran erinnern, die Session mit
    `/clear` zu leeren, bevor ein neues großes Thema startet

### Kostenbewusste Modellwahl

- **Standardmodell für normale Blöcke:** ein starkes, günstigeres Modell (z. B. Sonnet/
  Standard in Claude Code), sofern der Block keine besondere Architektur-, PDF-,
  RLS-/Rechte-, Datenbank- oder Versionslogik betrifft.
- **Höchste Stufe/Fable/Opus nur gezielt:** für komplexe oder riskante Blöcke wie
  PDF-Engine, Dokumentversionierung, Mandantentrennung/RLS, Rechte, größere
  Architekturänderungen, schwierige Bugs oder wenn Lukasz es ausdrücklich verlangt.
- **Zu Beginn jedes Blocks** benennt Claude Code kurz die gewählte Modellstufe bzw.
  prüft per `/model`, ob sie zur Aufgabe passt. Bei Unsicherheit eher ein mittleres
  Modell starten und nur bei echter Blockade oder hohem Risiko hochschalten.
- **Abo-/Billing-Hygiene:** Claude Code soll über Lukasz' Claude Pro/Max/Team-Konto
  laufen, nicht unbeabsichtigt über API-Verbrauch. Wenn Claude Code API-Credits oder
  Pay-as-you-go anbietet, nur nach ausdrücklicher Zustimmung verwenden. Praktische
  Prüfanleitung (bei langen Sessions gelegentlich wiederholen):
  1. In Claude Code `/status` prüfen: Auth-Methode muss das Claude-Abo sein, nicht
     ein API-Key.
  2. Bei Zweifel `/login` bzw. das aktive Konto prüfen (richtiges Konto/Organisation).
  3. Auf claude.ai unter Abrechnung prüfen, ob ein Pro/Max/Team-Plan aktiv ist.
  4. In der Anthropic Console prüfen, ob API-Credits, **Auto-Reload (Auto-Recharge)**
     oder API-Keys aktiv sind – diese erzeugen separate Verbrauchsrechnungen und sind
     **nicht** im Abo enthalten. Ein gesetztes `ANTHROPIC_API_KEY` kann Claude Code
     unbemerkt auf API-Abrechnung umleiten.

### Session-Hygiene

- Nach einem abgeschlossenen und gepushten Block erinnert Claude Code Lukasz in der
  Abschluss-Zusammenfassung daran, die Session mit `/clear` zu leeren – kleiner
  Kontext spart Verbrauch bzw. Nutzungslimit.
- Mehrere kleine, zusammenhängende Wünsche dürfen im selben Block gesammelt und als
  ein Commit/Push-Block geliefert werden.
- Klar unterschiedliche große Themen werden besser als getrennte Blöcke in frischen
  Sessions gestartet, statt eine Session endlos wachsen zu lassen.

### Lukasz

Entscheidet über fachliche Prioritäten, destruktive DB-Eingriffe, Secrets,
Rollen-/Auth-Architektur, Force-Push/Reset und echte Geschäftsentscheidungen.

### Christoph Napetschnig

Arbeitet **ebenfalls direkt auf `main`**. Der Workflow muss deshalb sauber mit
parallelen Änderungen umgehen: jeder Arbeitsblock beginnt mit einem Pull, vor jedem
Push wird erneut synchronisiert, fremde Änderungen werden nie überschrieben.

### GitHub Actions und Vercel

GitHub Actions ist die externe technische Kontrollinstanz. Vercel deployt automatisch
bei Push auf `main`.

## 3. Standard: Arbeit direkt auf `main`

- Kein Feature-Branch-Workflow als Standard, keine PR-Pflicht im Alltag.
- Pull Requests bleiben optional für besonders riskante Änderungen
  (Auth/Rollen/RLS, destruktive DB-Änderungen, größere Architekturänderungen,
  bewusst gewünschtes externes Review).

## 4. Start eines Arbeitsblocks

```bash
git status --short --branch   # lokale Änderungen sichten – nichts überschreiben
git fetch origin
git pull --rebase origin main
```

- **Lokale Änderungen** werden nie blind überschrieben: erst committen, stashen oder
  bewusst mit Lukasz klären.
- **Konflikte beim Pull:** stoppen, Konflikt klar erklären, sauber lösen. Fachlich
  unklare Überschneidungen entscheidet Lukasz.

## 5. Umgang mit Christophs Änderungen auf `main`

- Vor jedem Push: `git fetch origin` + `git pull --rebase origin main`.
- Neue Christoph-Commits werden per Rebase integriert; Konfliktdateien fachlich
  sauber lösen, `git add <gelöste Dateien>`, `git rebase --continue`, danach erneut
  `npm run verify` – erst dann pushen.
- Fremde Änderungen niemals verwerfen oder überschreiben. Kein Force-Push.

## 6. Verify-/Testpflicht

- **`npm run verify`** (Lint + Build + alle Tests; Lint mit `--max-warnings 0`)
  ist Pflicht vor jedem Commit-Abschluss und nach jedem Rebase. Der pre-push-Hook
  (`.githooks/pre-push`, aktiv via `git config core.hooksPath .githooks`) erzwingt
  das zusätzlich.
- **Browser-Smoke/e2e nur gezielt:** Playwright-Smokes (`npm run e2e`, Details in
  Abschnitt 6a) sind nicht mehr automatisch für jeden kleinen Block vorgesehen. Sie
  laufen bei riskanten UI-/PDF-/Dokumenteditor-/Rechte-Flows, bei Änderungen an
  Kernnavigation/Erstellung/Speichern/Finalisieren oder wenn Lukasz sie ausdrücklich
  verlangt. Für kleine Text-, Doku-, Label- oder schmale Tabellenkorrekturen genügt
  eine kurze manuelle Prüfliste. Kein Smoke-Ergebnis erfinden: Wenn ein Flow nicht
  automatisiert geprüft wurde, ehrlich als „manuell zu prüfen" melden.
- Testergebnisse werden nie erfunden. Maßgeblich sind lokale `npm run verify`-Läufe,
  der Vercel-Build und echte Browser-Beobachtung.

### 6a. Automatisierter Browser-Smoke (Playwright)

- **Start:** `npm run e2e` (startet den Vite-Dev-Server automatisch und führt die
  Smoke-Specs unter `e2e/` in Chromium aus). `npm run e2e:headed` zeigt den Browser.
- **Login:** Die Specs melden sich mit den E2E-Zugangsdaten aus `.env.local` an
  (`B4Y_E2E_EMAIL` / `B4Y_E2E_PASSWORD`, gitignored – niemals committen).
  Einmalige Einrichtung: `npm run e2e:setup` legt den Benutzer
  `e2e-test@b4y-superapp.app` an (Org `bau4you`, Rolle `admin`) und schreibt die
  Zugangsdaten nach `.env.local`. Ohne Zugangsdaten werden die Specs sauber
  übersprungen (kein falsches Grün).
- **Umfang:** App lädt, Login funktioniert, Kernnavigation (Projekte, Einstellungen
  inkl. `?tab=`-Sync) und die zuletzt geänderten riskanten Flows. Neue e2e-Specs nur
  ergänzen, wenn sie einen wiederkehrenden kritischen Ablauf absichern; keine neuen
  Playwright-Tests für Kleinigkeiten, die Lukasz schneller manuell prüfen kann.
- **Grenzen:** Keine destruktiven Aktionen (kein Löschen, kein Finalisieren echter
  Dokumente); angelegte Testdaten mit „E2E-TEST"-Kennzeichnung.

## 7. Commit-/Push-Regeln

- Gezielt stagen (`git add <Dateien>`), keine Sammel-Adds mit Fremddateien.
- Klare, nachvollziehbare Commit-Messages (Was + Warum in einer Zeile, Details im Body).
- Zusammengehörige Punkte eines Blocks als **ein sauberer Commit-/Push-Block** liefern
  (Block-Batching), nicht pro Einzelpunkt pushen.
- Reihenfolge am Blockende: `npm run verify` → Commit → `git fetch origin` →
  `git pull --rebase origin main` → Konflikte lösen → erneut `npm run verify` →
  `git push origin main`.

## 8. Supabase-/Migrationsregeln

- Schemaänderungen ausschließlich über neue Dateien in `supabase/migrations/`.
- Enthält ein Block Migrationen, wird vor `npm run verify` automatisch
  `npm run db:migrate` ausgeführt (B4Y-Runner `scripts/Supabase-Db-Push.ps1` +
  `scripts/supabase-migration-policy.json`, Details `docs/SUPABASE_MIGRATIONS.md`).
- Stoppen und Lukasz fragen nur bei: fehlendem DB-Passwort/Token, destruktiven
  Migrationen, Migrationskonflikten oder unerwarteten DB-Fehlern.
- Bereits angewendete Migrationen nie umschreiben. Secrets nur in
  `.env.supabase.local`/`.env.local` (gitignored).

## 9. Was ausdrücklich NICHT gemacht wird

- Kein Force-Push auf `main`.
- Kein `git reset --hard` / `git clean` ohne ausdrückliche Freigabe von Lukasz.
- Keine fremden Änderungen überschreiben.
- Keine Secrets im Repo, in Logs oder Screenshots.
- Keine destruktiven oder irreversiblen DB-Eingriffe ohne Freigabe.
- Keine Veränderung finalisierter Dokumente, Versionen oder PDF-Snapshots.
- Keine ungefragten Architektur-Umbauten, UI-Redesigns oder Businesslogik-Änderungen
  außerhalb des Auftrags.
- Kein `--no-verify`, um Build-/Testfehler zu umgehen.

## 10. Verhalten bei Konflikten, Testfehlern oder Unsicherheit

- **Konflikte:** stoppen, Konflikt konkret erklären (welche Dateien, welche
  Überschneidung), sauber lösen; fachlich unklare Fälle entscheidet Lukasz.
- **Testfehler:** nicht pushen. Ursache diagnostizieren und beheben; wenn der Fehler
  nicht zum eigenen Block gehört (z. B. durch parallele Änderungen), klar melden und
  nächsten Schritt vorschlagen.
- **Fachliche Unsicherheit:** keine riskante Änderung erzwingen – naheliegendste
  saubere Lösung wählen oder eine gebündelte Rückfrage an Lukasz stellen.
- In allen drei Fällen gilt: **nicht pushen, stoppen, Problem klar melden, konkreten
  nächsten Schritt vorschlagen.**

## 11. Praktischer Gesamtablauf (Kurzfassung)

1. Lukasz sammelt Anforderungen in Codex.
2. Codex liest bei Bedarf relevante Ordner/Dateien/Doku/Code **nur lesend**.
3. Codex erstellt einen kopierfertigen Prompt.
4. Lukasz fügt den Prompt in VS Code/Claude/Fable 5 ein.
5. Claude/Fable 5 übernimmt mit kostenbewusst passender Modellwahl: Analyse →
   Planung → Umsetzung → Code-/App-Prüfung → gezielter Browser-Smoke/e2e nur wenn
   sinnvoll → `npm run verify` → Commit → Pull/Rebase → erneut `npm run verify` →
   Push nach `main`.
6. Vercel deployt automatisch; GitHub Actions prüfen extern.
