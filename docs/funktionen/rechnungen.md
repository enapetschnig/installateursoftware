# Rechnungen
> Rechnungen aus Aufträgen – §11 UStG-konform, mit Teilrechnungen, Storno, Skonto und Zahlungsstatus.

## Für Anwender

**Was kann die Funktion?**
Rechnungen entstehen aus einem/mehreren Aufträgen (merge oder perSource), optional mit Positions-/Teilmengenauswahl (Teilrechnung). Unterstützt Storno (Bezug `storno_of`), Skonto (`with_skonto`/`skonto_percent`) und Zahlungsbedingungen (`payment_term_days`, `due_date`). Zahlungsstatus wird gepflegt.

**Bedienung – Schritt für Schritt**
1. Im Projekt „Dokument erstellen → Rechnung" (`/rechnungen/new?projectId=…`) oder aus Aufträgen „Rechnung erstellen". Die Auftrags-/Positionsauswahl (`MultiOrderPicker`) nutzt das einheitliche zweispaltige Auswahl-Layout (`SourceSelectLayout`): nur die Auftragsliste scrollt, Vorschau (Netto/MwSt/Brutto, Zielvariante, Hinweise) + „Rechnung erstellen" bleiben sichtbar; Teilmengen/Positionsauswahl je Auftrag inline – siehe [dokumentketten.md](dokumentketten.md).
2. Entwurf bearbeiten → **Finalisieren** (`locked=true`, Version + PDF-Snapshot).
3. Storno erzeugt eine Gegenbuchung (`storno_of`).

**Status**
`doc_status` (u. a. `storniert`), `payment_status` (z. B. `offen`/`bezahlt`), `locked` (bool – finalisiert/gesperrt). Anzeige in Listen: Entwurf (nicht `locked`) → Finalisiert (`locked`) → Bezahlt (`payment_status='bezahlt'`) bzw. Storniert.

**Bearbeiten nach Finalisierung (Stand 2026-06-28):** Bei finalisierten (`locked`) Rechnungen bleiben **Positionen/Canvas gesperrt** (`readOnly`) und der unveränderliche Versions-/PDF-Snapshot (`document_versions.print_html`) bleibt eingefroren – Korrektur am Betrag weiterhin nur über Storno. Die **Einstellungen** (Kopf-/Stammdaten: Rechnungsart, Titel, Datum, Zahlungsziel, Skonto/Skontoziel, Nachlass/Aufschlag, Leistungszeitraum, Kunde/Projekt/Ansprechpartner, MwSt-Modus, Notiz, abweichende Empfängeranschrift) lassen sich aber weiterhin öffnen, ändern und über „Speichern" persistieren – `doSave()` aktualisiert **nur** den LIVE-Datensatz (`invoices`), nie den Snapshot, und legt keine neue Version an. Die **Rechnungsnummer** bleibt systemvergeben/readonly. Zahnrad- und Speichern-Button sind im gesperrten Zustand zentral in `DocumentToolbar` freigeschaltet (gilt analog für Angebot/Auftrag).

## Technik

**Routen & Komponenten**
- `/rechnungen` → `src/pages/Invoices.tsx`; `/rechnungen/:id` & `/rechnungen/new` → `src/pages/InvoiceEditor.tsx` (`goBack`, `paramProjectId`); Buchhaltung unter `/buchhaltung`.
- **Projektkopf & „Zum Projekt" (Stand 2026-07-06):** Der Rechnungseditor zeigt bei Projektbezug den zentralen **Projektkontext-Kopf** (`ProjectContextChips` – Nr., Betreff, Adresse, Kunde, Mitarbeiter, Baubeginn, geplante Fertigstellung, identisch zur Projektakte). Der Toolbar-Button **„Zum Projekt"** navigiert per React Router und merkt via `rememberProjectSection()` den Bereich `rechnungen` vor. Editor-Routen sprechend über `docPath("invoice", …)`; **Rechnungs-Entwürfe** behalten bewusst die UUID-Route (Nummer erst bei Finalisierung, §11 UStG). Details zentral in [angebote.md](angebote.md).

**Datenbank – exakte Felder**
- **`invoices`**: `id, project_id, contact_id, number, invoice_type, invoice_kind, with_skonto, skonto_percent, payment_status, doc_status, items(jsonb), net, vat, gross, invoice_date, due_date, paid_at, notes, created_by, created_at, order_ids(ARRAY), offer_ids(ARRAY), title, service_period, person_id, discount_percent, snapshot(jsonb), storno_of, locked, payment_term_days, organization_id, offer_type_id, pdf_label, doc_intro_text, doc_closing_text, display_settings_snapshot(jsonb), pre_positions_text, deleted_at, deleted_by, archived_at, archived_by, conditions_snapshot(jsonb), working_base_version_no`
  - **`conditions_snapshot`** (Migr. 0081): Konditionen werden vom Auftrag geerbt; in den Rechnungseinstellungen sind Zahlungsziel/Skonto/**Skontoziel**/Standardnachlass/Standardaufschlag editierbar. Das **Skontoziel** (`skontoDays`) steuert die Skontofrist im PDF (kein Vermischen mit dem Zahlungsziel). **Stand 2026-06-26:** der frühere harte 14-Tage-Fallback ist entfernt – ohne gepflegtes Skontoziel werden weder Skonto-Datum noch eine feste Tagesfrist erzeugt; das PDF formuliert dann generisch „innerhalb der Skontofrist" (`InvoiceEditor`: `skontoDays = conditions.skontoDays>0 ? … : null`; `printDocument`: kein `?? termDays`-Rückfall). Der Aufschlag bleibt intern/unsichtbar. **Version-Wiederherstellung ist bei Rechnungen gesperrt** (§11 UStG, lückenlose Nummern, Aufbewahrung) – Korrektur nur über Storno + neue Rechnung (Hinweis in der Versionshistorie).
- **`invoice_items`**: `id, invoice_id, pos_no, service_number, short_text, long_text, qty, unit, unit_price, discount_percent, vat_rate, net, gross, source_order_id, source_order_item_id, sort_order, organization_id`
- **`invoice_offers`**: `invoice_id, offer_id, organization_id` (Verknüpfung zu Quell-Angeboten)

**Zentrale Logik**
`src/lib/document-chain.ts`: `createInvoiceFromOrders` (merge), `createInvoicesPerOrder` (perSource), `qtyFilter` für Teilmengen; danach `refreshOrdersInvoiceStatus`. PDF + §11-Block + Skonto/Zahlung über `PrintMeta.payment` der PDF-Engine ([pdf-engine.md](pdf-engine.md)). Nummer via RPC `next_document_number('rechnung')` **erst beim Finalisieren** (`InvoiceEditor.finalize`) – seit 2026-07-06 gilt derselbe Vergabezeitpunkt „erst bei Verbindlichkeit" einheitlich für alle Belegtypen (siehe [nummernkreise.md](nummernkreise.md)). Das **Drei-Punkte-Menü** (Storno erstellen, Zur Original-Rechnung, Entwurf löschen) wird zentral über `src/lib/document-actions.tsx` (`buildDocumentMoreActions`) erzeugt – verhaltensgleich für alle Editoren; finalisierte Rechnungen sind nicht löschbar (nur Storno).

**Erweitern**
Neue Rechnungsart über `offer_types`/Darstellung; neue Felder in `invoices` + Editor + `PrintMeta` + Auswertung. §11 UStG, lückenlose Nummern, Aufbewahrung 7 Jahre, Audit beachten ([versionierung.md](versionierung.md)). Keine Nummernkreis-/Statuslogik hartcodieren.

**§19 Reverse-Charge – expliziter MwSt-Modus (Stand 2026-06-27):** Jedes Dokument hat einen **MwSt-Modus** `vat_mode` (`standard` = 20 % / `par19` = §19 Bauleistung, 0 %) – Spalte auf `offers`/`orders`/`invoices`/`sub_orders` (Migr. 0104, Backfill bestehender 0 %-Belege). Auswählbar im Editor von **Angebot, Auftrag und Rechnung** (Dropdown „MwSt-Modus"); die Summenberechnung nutzt `vatOverride` (0 % bei §19) über `useDocumentBuilder`/`computeSummary`. **Vererbung:** Beim Erzeugen von Folgedokumenten (Angebot→Auftrag→Rechnung) übernimmt `document-chain.ts` den `vat_mode` und rechnet die Folge-Summe mit Reverse-Charge. Der gesetzliche Hinweis „Die Umsatzsteuer für diese Bauleistung wird gemäß § 19 Abs. 1a UStG vom Leistungsempfänger geschuldet." wird zentral via `withParagraph19Note` (`src/lib/offer-types.ts`) an den Schlusstext angehängt – für **alle** Varianten, idempotent. Gilt für Angebot/Auftrag/Rechnung/SUB.

**Verknüpfungen**
[auftraege.md](auftraege.md) · [dokumentketten.md](dokumentketten.md) · [nummernkreise.md](nummernkreise.md) · [versionierung.md](versionierung.md) · [textbausteine.md](textbausteine.md)
