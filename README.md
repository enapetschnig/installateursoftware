# Installateur SuperAPP

Software für Installateur-, Haustechnik- und Generalunternehmer-Betriebe.
Erste Firmenkonfiguration: **Bad.Werk GmbH** (Komplett-Badsanierung, Heizung/Lüftung/Gas/Sanitär, GU).
Dashboard, Kontakte, Projekte mit Installateur-Pipelines/Projektstufen, Angebote/Aufträge/Rechnungen,
Subunternehmer-Aufträge, Kalkulation (übernommener Positionskatalog), **Zeiterfassung mit Stundenauswertung**,
**Regieberichte**, **moderne Plantafel**, **Mitarbeiter-App** (mobil) und Outlook-Anbindung.

- Basis ist die B4Y-SuperAPP-Codebasis, mandantenfähig als SaaS ausgelegt (keine Firmen-Hardcodierung).
- **Produktname/Domain konfigurierbar:** `VITE_APP_NAME` / `VITE_APP_URL` (white-label, siehe `.env.example`).
- **Firmenidentität** (Name/Logo/Farben/PDF-Daten) je Mandant in `company_settings`.
- **Stack:** React · Vite · TypeScript · Tailwind CSS · Supabase (EU).
- **Supabase-Projekt:** `xyhgckqxowqnzjtoblfs` · **Repo:** `enapetschnig/installateursoftware`.

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Frontend | React + Vite + TypeScript |
| Styling | Tailwind CSS (Glassmorphism, Dark/Light) |
| Backend / DB | Supabase (Postgres, Auth, RLS), Region EU (Frankfurt) |
| Hosting | Vercel (Production + Preview Deployments) |
| Qualität | ESLint, Prettier, TypeScript strict, GitHub Actions CI |

## Projektstruktur

```
b4y-superapp/
├── src/
│   ├── pages/         # App-Seiten/Routen (Dashboard, Projekte, Kontakte, …)
│   ├── components/    # Wiederverwendbare UI-Bausteine (Layout, Charts, ui, Logo, Isabella)
│   ├── lib/           # Kern-Logik (supabase-Client, auth, theme, format, types)
│   ├── hooks/         # Wiederverwendbare React-Hooks
│   ├── utils/         # Reine Hilfsfunktionen
│   ├── types/         # Zentrale TypeScript-Typen
│   └── assets/        # Logo & Bilder
├── supabase/
│   └── migrations/    # Datenbank-Migrationen (0001_…, 0002_…)
├── docs/              # Architektur- & Workflow-Doku
├── .github/
│   ├── workflows/ci.yml        # CI: Lint · Typecheck · Build bei jedem PR
│   ├── pull_request_template.md
│   └── CODEOWNERS              # Eigentumsbereiche & Standard-Reviewer
├── .env.example       # benötigte Umgebungsvariablen (ohne Secrets)
└── vercel.json        # Vite-Build + SPA-Routing
```

---

## Development Workflow

> **Single Source of Truth: GitHub `main`.** Lukasz und Christoph arbeiten direkt auf `main`. Arbeitsbeginn ist immer ein Pull, damit niemand auf einem veralteten Stand weiterarbeitet.

1. **Aktualisieren vor Arbeitsbeginn**
   ```bash
   git checkout main
   git fetch origin
   git pull --ff-only origin main
   ```
2. **Lokal arbeiten** – in VS Code/Claude Code im Ordner `F:\Users\baranowski4\Projekte\b4y-superapp`.
3. **Vor dem Push erneut prüfen**
   ```bash
   git status
   git fetch origin
   git pull --ff-only origin main
   npm run verify
   ```
4. **Gezielt committen und nach `main` pushen** – keine Secrets, kein Force Push, keine ungeprüften Fremdänderungen.
5. **Vercel/GitHub prüfen** – Vercel deployt `main` automatisch; GitHub Actions bleiben die externe Kontrollinstanz.

Pull Requests bleiben optional für besonders riskante Änderungen, sind aber nicht der Standardweg für den täglichen Lukasz/Christoph-Workflow.

Der vollständige, verbindliche Arbeitsablauf (Rollen Codex/Claude-Fable-5, Git-Regeln, Verify-/Smoke-Pflichten): **[docs/FABLE5_VSCODE_WORKFLOW.md](./docs/FABLE5_VSCODE_WORKFLOW.md)**. Ausführliche Anleitung (auch für Nicht-Techniker): siehe **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

### Lokale Skripte
```bash
npm install         # Abhängigkeiten installieren
npm run dev         # Entwicklungsserver
npm run lint        # ESLint
npm run typecheck   # TypeScript prüfen
npm run build       # Produktions-Build
npm run format      # Prettier
npm run db:migrate  # Neue Supabase-Migrationen anwenden (Node-Runner, plattformunabhängig)
```

> **Datenbank-Migrationen:** `npm run db:migrate` (Datei `scripts/db-migrate.mjs`) wendet neue Dateien aus
> `supabase/migrations/` über die Supabase-Management-API an und trackt sie in `b4y_internal.migration_files`.
> Zugang lokal in `.env.supabase.local` (`SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`) – niemals committen.
> Migration `0000_baseline_schema.sql` bildet das komplette Ausgangsschema ab; `0130`–`0136` liefern
> Positionskatalog, Bad.Werk-Startkonfiguration, Zeiterfassung, Regieberichte, Mitarbeiter-App und Plantafel.

## Umgebungen & Secrets
- Client nutzt nur den **öffentlichen anon/publishable Key** (siehe `.env.example`).
- **Service-Role-Key niemals** ins Frontend – nur serverseitig.
- Variablen werden in Vercel pro Umgebung gesetzt: **Production · Preview · Development**.

## Doku
- [docs/FABLE5_VSCODE_WORKFLOW.md](./docs/FABLE5_VSCODE_WORKFLOW.md) – zentraler Entwicklungs-Workflow (VS Code + Claude/Fable 5)
- [docs/architecture.md](./docs/architecture.md) – Architektur & Ordner
- [docs/deployment.md](./docs/deployment.md) – Deploy & Umgebungen
- [supabase/README.md](./supabase/README.md) – Datenbank & Migrationen
