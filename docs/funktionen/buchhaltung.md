# Buchhaltung (Eingangsrechnungen & offene Posten)
> Verwaltet Lieferantenrechnungen (Eingangsrechnungen) – manuell oder **automatisch aus dem smarten KI-Postfach** – und zeigt die offenen Posten der Ausgangsrechnungen.

## Für Anwender

**Was kann die Funktion?**
Unter **Buchhaltung** (`/buchhaltung`) gibt es zwei Bereiche:
- **Eingangsrechnungen**: alle Rechnungen, die dem Betrieb gestellt werden (Lieferanten/Dienstleister). Rechnungen aus dem Postfach werden von der KI erkannt und landen **automatisch** hier (mit erkanntem Lieferant, Nummer, Betrag, Fälligkeit, IBAN und dem **PDF als Beleg**). Zusätzlich lassen sich Eingangsrechnungen **manuell** erfassen.
- **Offene Posten (Ausgang)**: unbezahlte, finalisierte **Ausgangsrechnungen** (an Kunden) – als Überblick, was noch offen/überfällig ist. Klick öffnet die jeweilige Rechnung.

**Bedienung**
- Oben vier Kennzahlen: offene Eingangsrechnungen, davon überfällig, offener Betrag (Eingang), offene Posten (Ausgang).
- Reiter **Eingangsrechnungen** → Filter (Alle/Offen/Überfällig/Bezahlt/Storniert), Klick auf eine Zeile öffnet das **Bearbeiten-Fenster** (Lieferant, Nr., Daten, Beträge, Status, Kategorie, Projekt, IBAN, Notizen, **Belege**).
- **Neue Eingangsrechnung**: Button oben rechts → Fenster ausfüllen → **Anlegen**; danach lassen sich **Belege (PDF/Bild)** hinzufügen, öffnen und entfernen.
- **Status**: offen → geprüft → freigegeben → bezahlt (oder storniert). Beim Wechsel auf „bezahlt" wird das Zahldatum automatisch gesetzt.
- Ein 📧-Symbol/Hinweis kennzeichnet automatisch aus dem KI-Postfach übernommene Rechnungen.

**Wichtige Einstellungen (pro Firma)**
Rechte über das Modul **`buchhaltung`** (Aktionen view/create/edit/delete/export/print, pro Rolle vergebbar). Belege liegen im privaten, mandantengetrennten Bucket **`belege`**.

## Technik

**Routing & Rechte**
`/buchhaltung` in `src/App.tsx` → `<Guard module="buchhaltung"><Buchhaltung/></Guard>`. Modul-Key `buchhaltung` ist in `permission_modules` geseedet (Nav-Eintrag in `src/components/Layout.tsx` vorhanden). Button-Gating via `useCan("buchhaltung", <action>)`.

**Frontend**
- `src/pages/Buchhaltung.tsx` – Seite mit Haupt-Tabs (Eingangsrechnungen | Offene Posten), KPI-Kacheln, Filter-Tabs, Glass-Tabelle (`SortHeader`+`useTableSort`), Mobile-Karten, Bearbeiten-/Erfassen-Modal inkl. Beleg-Verwaltung. UI-Muster gespiegelt aus `src/pages/Invoices.tsx`.
- `src/lib/buchhaltung.ts` – Typen + CRUD (`listEingangsrechnungen`, `getEingangsrechnung`, `createEingangsrechnung`, `updateEingangsrechnung`, `deleteEingangsrechnung`), Belege (`uploadBeleg`, `addBelegToInvoice`, `removeBeleg`, `belegUrl`), `listOpenPosten`, Status-Label/Tone, `isOverdue`.

**Datenbank**
- **`public.eingangsrechnungen`** (Migration `0141_eingangsrechnungen.sql`): `id`, `organization_id` (Default `current_org_id()`), `supplier_contact_id` (FK contacts, SET NULL), `supplier_name`, `invoice_number`, `invoice_date`, `due_date`, `received_date` (NOT NULL Default `current_date`), `net`, `vat`, `gross`, `vat_rate`, `currency` (Default 'EUR'), `status` (`offen|geprueft|freigegeben|bezahlt|storniert`), `paid_at` (Trigger setzt bei „bezahlt"), `payment_reference`, `iban`, `category`, `project_id` (FK projects, SET NULL), `notes`, `source` (`manual|email`), `incoming_mail_id` (FK incoming_mails, SET NULL), `ai_extracted_data` (jsonb), `belege` (jsonb `[{path,filename,content_type,size,uploaded_at}]`), `created_by`, `created_at`, `updated_at`. **Idempotenz**: UNIQUE `(organization_id, incoming_mail_id)` (eine E-Mail → max. eine Eingangsrechnung). **RLS**: permissive `app_all` + restrictive `org_isolation` (`organization_id = current_org_id()`).
- **`public.invoices`** – Quelle der **offenen Posten** (Ausgangsrechnungen). Kanonischer Filter (wie Dashboard/Cockpit): `deleted_at IS NULL AND locked=true AND doc_status<>'storniert' AND payment_status<>'bezahlt'`; überfällig = zusätzlich `due_date < heute`.
- **Storage-Bucket `belege`** (Migration `0142_belege_bucket.sql`): privat, 25 MB, `application/pdf` + Bildformate; **org-isolierte** Policies (`(storage.foldername(name))[1] = current_org_id()::text`). Pfad IMMER `<organization_id>/eingangsrechnungen/<id>/<datei>`. Anzeige über signierte URLs (`src/lib/storage.ts`, `belege` in der Bucket-Union).

**Automatische Anlage aus E-Mail**
Der Poller `api/mail/poll.js` legt bei `mail_class='rechnung'` eine Eingangsrechnung an (`createEingangsrechnungFromMail`, idempotent über `incoming_mail_id`), lädt PDF-/Bild-Anhänge in den `belege`-Bucket (`uploadBelege`, Service-Role, org-Pfad, `upsert:true`) und verknüpft sie. Lieferant wird via `resolveSupplier` (nur bei genau einem `contacts`-Treffer `type='lieferant'`) verknüpft. Der Anhang-Buffer wird über `rawAttachments` (in `api/_lib/mail-imap.js`) geführt und landet **nie** im JSONB. Siehe [smartes-ki-postfach.md](smartes-ki-postfach.md).

**Erweitern**
- **Mahnwesen**: Nummernkreis `reminder` ist bereits vorgesehen; auf Basis der offenen Posten (Ausgang) und überfälliger Eingangsrechnungen ausbaubar.
- **Lieferanten-Auswahl**: aktuell Freitext + Datalist aus `contacts (type='lieferant')`; ein generischer Kontakt-Picker (Variante von `CustomerSelect` mit `type`-Prop) wäre der nächste Schritt.
- **Nummernkreis** für interne Eingangsrechnungs-Nummern über `next_document_number(<doc_type>)` ergänzbar.
- **Kategorien/Kostenstellen**: `category` ist aktuell Freitext → auf konfigurierbare Stammdaten (mandantenfähig) heben.
- **DATEV/Export**: `export`-Recht am Modul ist vorhanden; CSV/Buchungsexport andockbar.

**Verknüpfungen**
[smartes-ki-postfach.md](smartes-ki-postfach.md), [rechnungen.md](rechnungen.md), [kontakte.md](kontakte.md), [rechte-rollen.md](rechte-rollen.md), [mandantenfaehigkeit.md](mandantenfaehigkeit.md), [sicherheit.md](sicherheit.md).
