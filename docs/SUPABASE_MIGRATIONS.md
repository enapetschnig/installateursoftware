# Supabase-Migrationen in VS Code / Claude Code

Stand: 2026-07-01

## Kurzregel

Wenn ein Arbeitsblock Dateien unter `supabase/migrations/*.sql` aendert oder neue Migrationen erstellt, fuehrt Claude Code vor `npm run verify` automatisch aus:

```bash
npm run db:migrate
```

Der Befehl ist fuer dieses Projekt bewusst kein nacktes `supabase db push`, sondern laeuft ueber:

```text
scripts/Supabase-Db-Push.ps1
scripts/supabase-migration-policy.json
```

Grund: Die bestehende Remote-DB hat eine alte Supabase-Migrationshistorie mit Zeitstempel-Versionen, waehrend der lokale Ordner `supabase/migrations/` spaeter sequenzielle Dateinamen (`0001_...`, `0113_...`) bekommen hat. Ein direktes `supabase db push` wuerde deshalb mit `Remote migration versions not found in local migrations directory` abbrechen.

## Lokale Secrets

Die Datei `.env.supabase.local` ist lokal und gitignored. Sie muss enthalten:

```dotenv
SUPABASE_PROJECT_REF=pqwcpgmsutpbuvdzslbc
SUPABASE_DB_PASSWORD=<Datenbank-Passwort>
SUPABASE_ACCESS_TOKEN=<Supabase Personal Access Token>
```

Secrets niemals committen, nie in Screenshots teilen und nie in Logs kopieren.

## Befehle

```bash
npm run db:link
npm run db:migrate:dry
npm run db:migrate
```

- `db:link` verknuepft den lokalen Ordner mit dem Supabase-Projekt.
- `db:migrate:dry` zeigt offene B4Y-Migrationen ohne DB-Aenderung.
- `db:migrate` wendet offene Migrationen per `supabase db query --linked --file ...` an.

Der Runner tracked angewendete Dateien in:

```sql
b4y_internal.migration_files
```

Diese interne Tabelle liegt nicht im `public`-API-Modell und bekommt keine Rechte fuer `anon` oder `authenticated`.

## Neue Migrationen

Neue Schemaaenderungen weiterhin als SQL-Datei in `supabase/migrations/` ablegen. Bereits angewendete Migrationen nicht nachtraeglich aendern. Wenn eine angewendete Datei geaendert wurde, stoppt der Runner und verlangt eine neue Migration.

Bei destruktiven Migrationen, Auth/RLS/Rollen-Aenderungen oder unklarer Datenwirkung muss Claude Code stoppen und Lukasz fragen.
