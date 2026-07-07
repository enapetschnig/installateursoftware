# Supabase – Backend & Datenbank

- **Projekt-Ref:** `pqwcpgmsutpbuvdzslbc` · **Region:** eu-central-1 (Frankfurt, DSGVO)
- **Client:** nur **anon/publishable Key** (siehe `.env.example`). RLS schützt die Daten.
- **Service-Role-Key:** NIEMALS im Frontend! Nur serverseitig (Edge Functions / CI-Secrets).

## Migrationen
Schemaänderungen werden als nummerierte SQL-Dateien in `supabase/migrations/` abgelegt:
`0001_initial_schema.sql`, `0002_<beschreibung>.sql`, …
- Bestehende Migrationen **nie** nachträglich ändern – immer eine neue Datei.
- Eine Migration = eine in sich abgeschlossene Änderung (eine PR).

### Migrationen direkt aus VS Code/Claude Code anwenden

Die Supabase CLI ist lokal als Dev-Dependency installiert. Migrationen werden in
der Entwicklungsphase automatisch angewendet, sobald Claude Code den Block
abschliesst:

```powershell
npm run db:migrate
```

Einmalig bzw. lokal muss eine gitignored Datei `.env.supabase.local` oder
`.env.local` vorhanden sein:

```env
SUPABASE_PROJECT_REF=pqwcpgmsutpbuvdzslbc
SUPABASE_DB_PASSWORD=<Datenbank-Passwort aus Supabase>
# Optional, wenn die CLI nicht per `npx supabase login` angemeldet ist:
SUPABASE_ACCESS_TOKEN=<Supabase Personal Access Token>
```

Der Dry-Run zeigt offene Migrationen, ohne sie anzuwenden:

```powershell
npm run db:migrate:dry
```

In der aktuellen Entwicklungsphase darf Claude Code Migrationen nach erfolgreichem
Plan/Umsetzung automatisch mit `npm run db:migrate` anwenden. Spaeter, wenn die
App produktiv stabil laeuft, wird dieser Schritt wieder als bewusster
Sicherheits-Gate neu bewertet.

Zusaetzlich erkennt der lokale `pre-push`-Hook SQL-Dateien unter
`supabase/migrations/` im zu pushenden Commit und fuehrt dann automatisch
`npm run db:migrate` aus, bevor `npm run verify` und der Push weiterlaufen. Damit
werden Migrationen nicht vergessen. Ohne lokales `SUPABASE_DB_PASSWORD` wird der
Push bewusst mit klarer Meldung gestoppt.

## Umgebungen
| Umgebung | Empfehlung |
|---|---|
| Production | eigenes Supabase-Projekt oder geschützter Branch |
| Preview | Supabase-Branch / separates Projekt für Tests |
| Development | lokal oder Dev-Projekt |
Die jeweiligen `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` werden in Vercel pro Umgebung gesetzt.
