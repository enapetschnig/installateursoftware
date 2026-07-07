# Mandantenfähigkeit
> Mehrfirmen-SaaS: Daten je Firma sauber getrennt, Standards als Konfiguration statt Code.

## Für Anwender
Die B4Y SuperAPP ist nicht nur die interne App von BAU4YOU, sondern als Software für andere Firmen gedacht. Jede Firma (Mandant) hat eigene Daten, Dokumentarten, Nummernkreise, Texte, Rollen, Logos/Farben. BAU4YOU ist nur die erste Beispiel-/Standardkonfiguration.

## Technik

**Datenbank – exakte Felder**
- **`organizations`**: `id, name, slug, created_at, updated_at`
- **`memberships`**: `id, user_id, organization_id, created_at`
- `organization_id` auf **allen** fachlichen Tabellen (Projekte, Belege, Stammdaten, Logs …) + **restriktive RLS-Policy `org_isolation`** → Firmen sehen nur eigene Daten.
- DB-Funktion **`current_org_id()`** liefert die aktive Organisation des angemeldeten Users (Basis der RLS).

**Status (Phasen 0–3 live)**
organizations/memberships + `current_org_id()` vorhanden; `organization_id` + RLS auf allen Tabellen aktiv. **Offen**: Onboarding/Seeding neuer Firmen + Frontend-Org-Context (Org-Wechsel). Reihenfolge/Details in [`../mandantenfaehigkeit-migrationspfad.md`](../mandantenfaehigkeit-migrationspfad.md). Faktisch derzeit Einzelmandant (`company_settings` id=1).

**Erweitern (Pflichtregel)**
Jede **neue Tabelle** bekommt `organization_id` + RLS-Isolation. Keine BAU4YOU-Werte hartcodieren – Standards als Seed/Config (Firma kann ändern/deaktivieren/ersetzen). Bei jeder Änderung prüfen: allgemein nutzbar? Werte/Texte einstellbar (DB statt Code)? Daten je Firma getrennt? Codefixe Fallbacks nur als Notfall-Default bei leerer DB.

**Verknüpfungen**
[einstellungen.md](einstellungen.md) · [rechte-rollen.md](rechte-rollen.md) · [`../architecture.md`](../architecture.md)
