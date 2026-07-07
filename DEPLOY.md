# B4Y SuperAPP — Online stellen (eigenes Vercel-Projekt)

> **Hinweis (Stand 2026-07-06):** Das produktive Projekt ist bereits mit Vercel
> verbunden und deployt **automatisch bei jedem Push auf `main`** (siehe
> [docs/deployment.md](docs/deployment.md) und
> [docs/FABLE5_VSCODE_WORKFLOW.md](docs/FABLE5_VSCODE_WORKFLOW.md)).
> Diese Anleitung braucht man nur, um ein **neues, eigenes** Vercel-Projekt
> anzulegen (z. B. für einen weiteren Mandanten/Kunden).

## Schritt für Schritt

1. **Terminal / Eingabeaufforderung** öffnen.
2. In den App-Ordner wechseln (echter Git-Klon):
   ```
   cd "F:\Users\baranowski4\Projekte\b4y-superapp"
   ```
3. Deployment starten:
   ```
   npx vercel
   ```
4. Beim ersten Mal:
   - Mit deinem Vercel-Konto anmelden (Browser öffnet sich kurz).
   - Fragen einfach mit **Enter** bestätigen:
     - „Set up and deploy?" → **Y**
     - „Which scope?" → dein Konto wählen
     - „Link to existing project?" → **N**
     - „Project name?" → **b4y-superapp** (oder Enter)
     - „Directory?" → **Enter** (aktuelles Verzeichnis)
     - Build-Einstellungen → **Enter** (Vite wird automatisch erkannt)
5. Nach ~1 Minute bekommst du eine **Web-Adresse** (z. B. `https://b4y-superapp.vercel.app`).
6. Für die finale Live-Version:
   ```
   npx vercel --prod
   ```

## Erste Anmeldung in der App
- Öffne die Web-Adresse.
- Klicke auf **„Noch kein Konto? Jetzt erstellen"**.
- Lege dein Konto an (E-Mail + Passwort) → du bist drin.

## Wichtig
- Die Datenbank-Verbindung (EU/Frankfurt) ist bereits eingebaut.
- Der verwendete Schlüssel ist ein öffentlicher Frontend-Schlüssel; deine Daten sind
  über Zugriffsregeln (RLS) in der Datenbank geschützt.

Wenn du möchtest, machen wir das Deployment in der nächsten Sitzung auch gemeinsam
über den Browser — sag einfach Bescheid.
