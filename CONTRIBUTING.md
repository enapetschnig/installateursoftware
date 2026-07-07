# Mitarbeiten an der B4Y SuperAPP

Diese Anleitung erklärt den aktuellen Teamablauf für Lukasz und Christoph. Ihr
arbeitet direkt auf `main`, aber mit klaren Schutzregeln: **erst pullen, dann
arbeiten, vor dem Push prüfen.** Der vollständige verbindliche Ablauf inkl.
KI-Rollen steht in [docs/FABLE5_VSCODE_WORKFLOW.md](docs/FABLE5_VSCODE_WORKFLOW.md).

## Die wichtigste Regel

> **Arbeitsbeginn ist immer ein Pull von `main`.**

`main` ist der gemeinsame aktuelle Stand und wird von Vercel automatisch deployed.
Niemand arbeitet bewusst auf einem alten Stand weiter.

## So änderst du etwas

### 1. Projekt aktualisieren

In VS Code über Source Control oder im Terminal:

```bash
git checkout main
git status
git fetch origin
git pull --ff-only origin main
```

Wenn lokale Änderungen offen sind, erst committen, stashen oder klären.

### 2. Änderungen machen

Bearbeite die Dateien in VS Code/Claude Code. Halte Änderungen klein und
fokussiert. Gemeinsame Logik, Supabase, Rollen/Rechte, PDFs und Dokumentketten
immer mitprüfen, wenn sie betroffen sind.

### 3. Vor dem Push prüfen

```bash
git status
git fetch origin
git pull --ff-only origin main
npm run verify
```

Wenn Christoph inzwischen gepusht hat und ein Fast-Forward nicht möglich ist:

```bash
git pull --rebase origin main
npm run verify
```

### 4. Committen und pushen

```bash
git add <nur die passenden Dateien>
git commit -m "kurze, klare Beschreibung"
git push origin main
```

Nach dem Push laufen GitHub Actions. Vercel deployt `main` automatisch.

## Wann ein Pull Request sinnvoll ist

Pull Requests sind optional und vor allem für riskante Änderungen gedacht:

- Rollen/Auth/RLS/Mandantentrennung
- destruktive oder irreversible Datenbankänderungen
- größere Architekturänderungen
- Änderungen, die bewusst extern reviewt werden sollen

## Was du NIE tun solltest

- Kein Force Push auf `main`.
- Keine geheimen Schlüssel, Passwörter oder Service-Role-Keys committen.
- Keine Build-/Testfehler mit `--no-verify` wegdrücken.
- Keine destruktiven DB-Befehle ohne ausdrückliche Freigabe.

## Hilfe

Bei Unsicherheit erst stoppen und kurz klären. Lieber einmal sauber synchronisieren
als später Konflikte oder kaputte Deployments reparieren.
