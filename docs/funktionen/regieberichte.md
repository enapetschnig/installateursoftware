# Regieberichte
> Arbeits-/Regieberichte mit Einsatzzeiten, Kundendaten, Material, beteiligten Mitarbeitern, Fotos und Kundenunterschrift – vom Monteur erstellbar, als PDF druckbar und in die Verrechnung überführbar.

## Für Anwender
**Was kann die Funktion?**
- Regiebericht anlegen: Projekt/Kunde, Datum, Von–Bis + Pause (Stunden automatisch), Arbeitsbeschreibung.
- Material erfassen (Bezeichnung, Menge, Einheit, Einzelpreis) – mit Netto-Summe für die Verrechnung.
- Beteiligte Mitarbeiter zuordnen; deren Stunden landen automatisch in der Zeiterfassung.
- Fotos zum Bericht hochladen.
- Kundenunterschrift direkt am Gerät (Finger/Stift) einholen → Status „unterschrieben".
- PDF öffnen/drucken; Bericht als „verrechnet" markieren.

**Bedienung**
1. In „Regieberichte" auf „Neuer Regiebericht" – Projekt wählen (Kundendaten werden vorbefüllt), Einsatzdaten + Material + Beteiligte eintragen, speichern.
2. In der Detailansicht Fotos hochladen, Kunden unterschreiben lassen, PDF drucken.
3. Später „verrechnet" setzen, sobald der Bericht in eine Rechnung übernommen wurde.

**Wichtige Einstellungen (je Firma)**
- Nummernkreis `regiebericht` (Präfix „RB", Einstellungen → Nummernkreise).
- Rechte-Modul `regiestunden` je Rolle; Monteure/Bauleitung/Techniker dürfen eigene Berichte anlegen.

## Technik
**Routen & Komponenten**
- `src/lib/regie.ts` – Datenlayer: `loadRegieReports`, `loadRegieReport`, `saveRegieReport` (zieht Nummernkreis via RPC `next_document_number`, synchronisiert Zeiteinträge via RPC `regie_sync_time_entries`), `signRegieReport`, `setRegieVerrechnet`, `deleteRegieReport` (Soft-Delete), Foto-Helfer, `materialSum`.
- Seiten/Komponenten: `src/pages/Regieberichte.tsx`, `src/pages/RegieberichtDetail.tsx`, `src/components/regie/RegieForm.tsx`, `src/components/regie/regiePdf.ts` (druckbare A4-HTML-Ansicht ohne externe PDF-Lib).
- Unterschrift: `src/components/SignaturePad.tsx`. Fotos: Bucket `project-files` unter `regie/<report_id>/…` (signierte URLs via `src/lib/storage.ts`).
- Mobile: `src/pages/mitarbeiter/MRegie.tsx`.

**Datenbank** (Migration `0134_regieberichte.sql`)
- `regie_reports`: `report_number`, `project_id`, `contact_id`, Kunden-Snapshot (`kunde_name`/`_strasse`/`_plz`/`_ort`/`_email`/`_telefon`), `datum`, `start_time`, `end_time`, `pause_minutes`, `stunden`, `beschreibung`, `notizen`, `status` (offen/unterschrieben/gesendet), `is_verrechnet`, `unterschrift_kunde`/`_name`/`_am`, `pdf_path`/`pdf_gesendet_am`, `created_by`, `organization_id`, `deleted_at`.
- `regie_report_materials`: `article_id`, `material`, `menge`, `einheit`, `einzelpreis`, `notizen`, `sort_order`.
- `regie_report_workers`: `employee_id`, `is_main`, `hours` (null = Berichtsstunden übernehmen).
- `regie_report_photos`: `file_path`, `file_name`.
- `time_entries.source_regie_report_id` – automatisch erzeugte Zeiteinträge der Beteiligten.
- RPC `regie_sync_time_entries(p_report_id)` – erzeugt/ersetzt Zeiteinträge je Beteiligtem.
- RLS: Modul `regiestunden` + Eigen-Zweig (Ersteller/Beteiligte über `employees.auth_user_id`).

**So erweitern**
- Rechnungs-Import: Material (× Einzelpreis) + Stunden (× Stundensatz) als Rechnungspositionen übernehmen – über die zentrale Dokumentlogik ([[dokumentketten]] / [[rechnungen]]).
- E-Mail-Versand des PDFs analog zur bestehenden Mailfunktion ([[email]]).

Querbezüge: [[zeiterfassung]] (Beteiligten-Stunden), [[projekte]], [[kalkulation]] (Artikel/Material), [[nummernkreise]], [[rechte-rollen]] (`regiestunden`), [[mitarbeiter-app]].
