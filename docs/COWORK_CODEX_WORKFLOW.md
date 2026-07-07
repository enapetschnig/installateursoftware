# B4Y SuperAPP – Codex-Workflow (Stand 2026-07-06)

> **Hinweis:** Der zentrale, verbindliche Entwicklungs-Workflow steht in
> **[FABLE5_VSCODE_WORKFLOW.md](FABLE5_VSCODE_WORKFLOW.md)**. Diese Datei beschreibt
> nur noch die (bewusst kleine) Rolle von Codex. Die früheren Abschnitte zu
> Post-Fertig-Prüfern, Hintergrund-Sub-Agenten, Codex-Reviews und Codex-Smoke-Tests
> sind **abgeschafft**.

## Rolle von Codex

Codex wird nur noch für **Anforderungssammlung und Prompt-Vorbereitung** verwendet:

1. Lukasz sammelt Anforderungen in Codex (direkt, aus E-Mails, Screenshots, PDFs,
   Notizen) und schreibt am Ende **„fertig"**.
2. Codex liest bei Bedarf relevante Ordner, Dateien, Doku und Code **nur lesend**
   (lokaler Projektordner), damit der Prompt repo-basiert und konkret ist.
3. Codex erstellt einen **kopierfertigen Prompt** mit Ziel, Akzeptanzkriterien,
   betroffenen Dateien/Komponenten, vorhandener zentraler Logik, Supabase-/RLS-Bezug,
   Risiken und sinnvollen Prüfungen.
4. Lukasz kopiert den Prompt manuell in VS Code (Claude/Fable 5 bzw. ein
   vergleichbares hochwertiges Entwicklungsmodell).

## Grenzen von Codex

- **Kein App-Code**, keine Änderung von App-Dateien.
- **Keine technische Umsetzung.**
- **Keine finalen App-Reviews, keine Smoke-Tests, keine Commits, keine Pushes.**
- `.codex/review.md`, `.codex/claude_fix_prompt.md` und `tmp/codex-postsync-*` sind
  kein aktiver Workflow mehr; lokale Restdateien sind bedeutungslos und gitignored.

## Ab der Prompt-Übergabe

Analyse, Planung, Umsetzung, Codeprüfung, App-Prüfung, Browser-Smoke,
`npm run verify`, Commit, Pull/Rebase, erneutes Verify und Push nach `main`
übernimmt vollständig **VS Code mit Claude/Fable 5** – Details, Git-Regeln
(Christoph arbeitet parallel auf `main`), Supabase-/Migrationsregeln und Verbote:
siehe [FABLE5_VSCODE_WORKFLOW.md](FABLE5_VSCODE_WORKFLOW.md).

Die verbindlichen Codex-Detailregeln stehen in [`AGENTS.md`](../AGENTS.md).
