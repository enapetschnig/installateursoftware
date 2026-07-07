# Einrichtungs-Checkliste (manuelle Klicks)

Alle Konfig- und Doku-Dateien sind im Projekt fertig. Diese Schritte musst du noch
**im Browser** anklicken (kein Terminal nötig). Reihenfolge einhalten.

## 0) Quellcode ins GitHub-Repo bringen (einmalig)
Das Repo `MUSHLUKASZ/b4y-superapp` enthält bisher nur die fertige `index.html`.
Damit Team-Workflow, CI und Previews funktionieren, muss der **komplette Projekt-Quellcode**
aus dem Ordner `B4Y SuperAPP/app` ins Repo.
→ Am einfachsten gemeinsam im Browser hochladen (Isabella führt dich durch) oder per
GitHub Desktop / VS Code (ohne Terminal). **Wichtig:** den Ordner `node_modules` NICHT hochladen.

## 1) GitHub – `main` absichern
Repo → **Settings → Branches → Add branch ruleset** (oder „Add rule") für `main`:
- ✅ **Require status checks to pass** → relevante Checks auswählen
- ✅ **Block force pushes**
- ❌ **Require a pull request before merging** ist im aktuellen Lukasz/Christoph-Workflow nicht Pflicht, weil direkt auf `main` gearbeitet wird.

## 2) GitHub – Team & Secrets
- **Settings → Collaborators** → Teammitglieder einladen.
- **Settings → Secrets and variables → Actions** → anlegen:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- `.github/CODEOWNERS` → echte GitHub-Handles der Bereichs-Verantwortlichen eintragen.

## 3) Vercel – Build & Umgebungen
Projekt `b4y-superapp` → **Settings → Build & Development**:
- Framework: **Vite** (wird über `vercel.json` erkannt), Output: `dist`.
**Settings → Environment Variables** – je Umgebung anlegen:
| Variable | Production | Preview | Development |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | ✅ | ✅ |
| `VITE_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ |
- PR-Previews bleiben für optionale Pull Requests aktiv.
- **Settings → Git → Production Branch = `main`** prüfen.

## 4) Supabase – Sicherheit & Umgebungen
- **Project Settings → API**: nur **anon/publishable Key** im Frontend verwenden.
  Den **service_role**-Key NIE ins Frontend / in `VITE_*` – nur serverseitig.
- Für saubere Trennung später: eigenes **Preview/Dev-Projekt** oder **Branching** anlegen
  und dessen Keys in Vercel (Preview/Development) hinterlegen.
- **Authentication → URL Configuration**: Site-URL = `https://b4y-superapp.app` (Custom Domain).
  Zu den **Redirect-URLs** zusätzlich hinzufügen: `https://b4y-superapp.vercel.app` (Übergang),
  Preview-URLs und `http://localhost:5173` (lokal). So bleibt Auth nach dem Domainwechsel stabil.
- **Vercel → Settings → Domains**: `b4y-superapp.app` als Custom Domain hinterlegen; optional Redirect
  von `b4y-superapp.vercel.app` → Custom Domain (im Vercel-Dashboard, NICHT im Code → keine Redirect-Loops).
- **Env (Vercel + lokal)**: `VITE_APP_URL=https://b4y-superapp.app`, `VITE_APP_NAME=B4Y SuperAPP`
  (für Kunden z.B. `Handwerk SuperAPP`).
- **Microsoft OAuth (Vercel Production)**:
  - `MICROSOFT_REDIRECT_URI=https://b4y-superapp.app/api/auth/microsoft-callback`
  - Nach jeder Aenderung an Vercel-Env-Werten ein neues Production-Deployment/Redeploy ausloesen.
  - In Microsoft Entra App Registration → Authentication → Web muss dieselbe URI eingetragen sein.

## Fertig
Danach gilt: `main` pullen → lokal arbeiten → vor Push aktualisieren + `npm run verify` → `main` pushen → GitHub Actions + Vercel prüfen/deployen automatisch.
