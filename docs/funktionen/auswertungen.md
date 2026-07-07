# Auswertungen
> Dashboards und Statistiken – live aus Belegen und Projekten berechnet (keine eigenen Auswertungstabellen).

## Für Anwender

**Was kann die Funktion?**
Verdichtet operative Daten zu Kennzahlen: Volumen/Umsätze aus Angeboten, Aufträgen, Rechnungen, Status-Verteilungen, Soll/Ist je Projekt. Zahlen entstehen **live** aus den Belegen – werden Belege gelöscht/geändert, aktualisieren sich die Auswertungen automatisch.

**Bedienung**
Start-Dashboard und Bereich „Auswertungen" (`/auswertungen`); Soll/Ist je Projekt im Projektbereich „Soll/Ist-Vergleich" (`sollist`). Filter (Zeitraum/Typ) grenzen ein.

## Technik

**Routen & Komponenten**
`/auswertungen` → `src/pages/Reports.tsx`; Start `src/pages/Dashboard.tsx`.

**Datenbank**
Nur **lesend/aggregierend** auf `offers`, `orders`, `invoices`, `projects` (für Aktivität zusätzlich `project_log`, Audit-Logs). **Keine** dedizierten Auswertungstabellen – Werte werden zur Laufzeit aggregiert (Brutto/Netto-Summen, Statuszählungen, Jahr via `doc_year`/`projectYear`).

**Zentrale Logik**
Aggregation im Frontend bzw. per Supabase-Query über die Belegtabellen und die View `documents_unified` (liefert `net/gross/status_norm/doc_year/...`). Da abgeleitet: Test-Reset muss nur Belege leeren → Auswertungen sind dann automatisch leer.

**Erweitern**
Neue Kennzahl = neue Aggregation über bestehende Tabellen, oder bei Performance eine materialisierte View. Mandantentrennung über `organization_id`/RLS sicherstellen (Firmen sehen nur eigene Zahlen). Keine festen Kennzahlen/Schwellen hartcodieren.

**Verknüpfungen**
[angebote.md](angebote.md) · [auftraege.md](auftraege.md) · [rechnungen.md](rechnungen.md) · [mandantenfaehigkeit.md](mandantenfaehigkeit.md)
