# Deployment & Umgebungen

## Pipeline
GitHub (`main`) → Vercel.

- **Push nach `main`** → Vercel **Production** (https://b4y-superapp.app; Vercel-Default https://b4y-superapp.vercel.app bleibt erreichbar).
- **Pull Request** → optionales Vercel **Preview Deployment** für riskante oder bewusst reviewte Änderungen.
- Schutz erfolgt lokal über Pull-vor-Arbeit, `npm run verify`, pre-push-Hook und extern über GitHub Actions/Vercel.

## Build
Vercel nutzt `vercel.json`: Framework **Vite**, Build `npm run build`, Output `dist`,
SPA-Rewrites auf `index.html`.

## Umgebungsvariablen (in Vercel pro Umgebung)
| Variable | Production | Preview | Development |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Prod-Projekt | Test/Branch | Dev |
| `VITE_SUPABASE_ANON_KEY` | Prod anon | Test anon | Dev anon |

Nur **öffentliche** Keys im Client. Service-Role-Keys ausschließlich serverseitig
(z. B. als GitHub-Actions-Secret oder in Supabase Edge Functions).

## CI (GitHub Actions)
Bei jedem Push auf `main` und bei optionalen PRs: `npm ci` → `lint` → `typecheck` → `build`/Tests gemäß Workflow.
Der lokale Push wird zusätzlich durch `.githooks/pre-push` mit `npm run verify` abgesichert.
