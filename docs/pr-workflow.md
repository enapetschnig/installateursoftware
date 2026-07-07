# Mitwirken: direkter Main-Workflow

Diese Anleitung beschreibt den aktuellen Arbeitsablauf für die B4Y SuperAPP:
Lukasz und Christoph arbeiten direkt auf `main`. Der wichtigste Schutz ist daher:
**vor Arbeitsbeginn pullen, vor dem Push prüfen, niemals Force Push.**
Der vollständige Ablauf inkl. KI-Rollen: [FABLE5_VSCODE_WORKFLOW.md](FABLE5_VSCODE_WORKFLOW.md).

## Einmalige Einrichtung: pre-push-Hook aktivieren

Im Repo liegt unter `.githooks/pre-push` ein Hook, der **vor jedem Push**
automatisch `npm run verify` ausführt und den Push **abbricht, wenn etwas
fehlschlägt**. Das ist der zentrale lokale Schutz. Einmal pro Klon aktivieren:

```bash
git config core.hooksPath .githooks
```

Notfall-Bypass nur bewusst und begründet: `git push --no-verify`.

## Arbeitsbeginn: immer zuerst aktualisieren

```bash
git checkout main
git status
git fetch origin
git pull --ff-only origin main
```

Wenn `git status` lokale Änderungen zeigt, erst entscheiden: committen, verwerfen
oder stashen. Nicht blind pullen, wenn lokale Arbeit offen ist.

## Ablauf pro Änderung

1. **Auf aktuellem `main` starten** – siehe Arbeitsbeginn oben.
2. **Ändern und lokal testen** – VS Code/Claude Code im echten Repo-Ordner
   `F:\Users\baranowski4\Projekte\b4y-superapp`.
3. **Vor dem Push nochmal synchronisieren**
   ```bash
   git status
   git fetch origin
   git pull --ff-only origin main
   npm run verify
   ```
4. **Gezielt committen**
   ```bash
   git add <nur die passenden Dateien>
   git commit -m "kurze, klare Beschreibung"
   ```
5. **Direkt nach `main` pushen**
   ```bash
   git push origin main
   ```

Nach dem Push prüft GitHub Actions den Stand. Vercel deployt `main` automatisch.

## Wenn Christoph parallel gepusht hat

Wenn beim Push gemeldet wird, dass `main` weiter ist:

```bash
git fetch origin
git pull --rebase origin main
npm run verify
git push origin main
```

Bei Konflikten: Konflikt sauber lösen, erneut `npm run verify`, dann pushen.

## Pull Requests

Pull Requests sind nicht mehr der Standardweg für den täglichen Lukasz/Christoph-
Workflow. Sie bleiben sinnvoll bei besonders riskanten Änderungen, z. B.:

- größere Rollen-/Auth-/RLS-Änderungen
- destruktive oder irreversible Datenbankänderungen
- größere Architekturänderungen
- Änderungen, die vorher bewusst extern reviewt werden sollen

## Abhängigkeiten und Lockfile

Wenn sich `package.json` ändert, danach **`npm install` laufen lassen und das
aktualisierte `package-lock.json` mit-committen**. Die CI nutzt `npm ci` und ist
streng: `package.json` und `package-lock.json` müssen zusammenpassen.

## Don'ts

- Kein `git push --force` auf `main`.
- Kein `git reset --hard` / `git clean` ohne ausdrückliche Freigabe.
- Keine Secrets/Zugangsdaten committen.
- Bei Build-Fehlern nicht mit `--no-verify` durchdrücken, sondern Ursache beheben.
