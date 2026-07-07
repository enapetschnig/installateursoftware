## Fachliches Ziel

<!-- Was kann der Benutzer nach diesem Pull Request konkret? -->

## Akzeptanzkriterien

- [ ] Fachliches Ziel vollständig erfüllt
- [ ] Keine ungefragten Nebenfunktionen
- [ ] Bestehende zentrale Logik verwendet
- [ ] Diff ist auf die Aufgabe begrenzt

## Geänderte Bereiche

<!-- Dateien, Module und zentrale Logik -->

## Datenbank / Supabase

- [ ] Keine Datenbankänderung
- [ ] Neue Migration vorhanden
- [ ] RLS für SELECT/INSERT/UPDATE/DELETE geprüft
- [ ] Mandantentrennung geprüft
- [ ] Typen aktualisiert

Details:

## Sicherheit

- [ ] Rollen und Rechte geprüft
- [ ] Keine Secrets im Frontend oder Commit
- [ ] Direkte API-Manipulation berücksichtigt
- [ ] Keine fremden Mandantendaten erreichbar
- [ ] Autowatcher/Auto-Deploy umgeht den PR-Workflow nicht

## Tatsächlich ausgeführte Tests

```text
Hier exakte Befehle und Ergebnisse eintragen.
```

- [ ] Typprüfung
- [ ] Lint
- [ ] Unit-Tests
- [ ] Integrationstests
- [ ] Produktions-Build
- [ ] E2E-/Browser-Smoke-Test
- [ ] Supabase-/RLS-Tests

## Manuelle Prüfung

<!-- Geprüfter Benutzerablauf, Browser, PDF, Konsole und Netzwerk -->

## Vercel Preview

<!-- URL einfügen -->

## Review

- [ ] Code-/App-Prüfung in VS Code (Claude/Fable 5) durchgeführt
- [ ] Browser-Smoke ausgeführt, falls sinnvoll (`npm run e2e` oder manuell)
- [ ] Berechtigte Review-Hinweise behoben
- [ ] Nach Korrekturen erneut getestet

## Risiken / offene Punkte

<!-- Keine bekannten offenen Punkte oder konkrete Risiken -->

## Freigabe

- [ ] Nicht nach `main` gemergt
- [ ] Kein Produktivdeployment ohne Freigabe von Lukasz
