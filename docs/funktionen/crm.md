# CRM – Kundenakte, Verlauf und Verkaufschancen

> Antwort auf die Frage „Wann habe ich den Kunden zuletzt kontaktiert, was wurde besprochen, was läuft gerade?" – ohne dass jemand Daten doppelt pflegen muss.

## Für Anwender

**Kundenakte** (Kontakte → Zeile anklicken): Jeder Kunde hat eine Akte mit fünf Bereichen:

- **Verlauf** – der Zeitstrahl: alle Angebote, Aufträge, Rechnungen, Projekte, Termine, Anfragen (inkl. Anruf-Zusammenfassung), Regieberichte, E-Mails und selbst erfasste Gespräche, nach Monaten gruppiert. Filter (Alles/Kommunikation/Dokumente/Termine/Projekte) und Volltextsuche. Klick auf einen Eintrag springt zum Beleg.
- **Projekte**, **Wiedervorlagen**, **Ansprechpartner**, **Zahlen** (Umsatz gesamt/12 Monate, offene Angebote, offene Forderungen).

Oben stehen vier Kennzahlen-Kacheln und „Letzter Kontakt vor X Tagen".

**Gespräch festhalten:** Im Verlauf auf „Gespräch, Notiz oder Telefonat festhalten …", Art wählen (Telefonat ein/aus, Vor-Ort, Besprechung, Notiz, Reklamation …), kurz worum es ging, was besprochen wurde, Datum/Dauer – fertig. Bewusst ohne Dialogfenster, damit die Hemmschwelle niedrig bleibt.

**Was sich von selbst füllt (keine Mehrarbeit):**
- Eingehende E-Mails werden über die Absenderadresse automatisch dem Kunden zugeordnet (auch über Ansprechpartner-Adressen).
- Eingehende Anrufe über den KI-Telefonagenten werden über die Rufnummer zugeordnet – Transkript und Zusammenfassung stehen in der Akte.
- Ausgehende E-Mails (Compose-Dialog, Angebots-/Rechnungsversand) werden protokolliert.
- Alle Belege, Projekte, Termine und Regieberichte erscheinen automatisch.
- **Bei Mehrdeutigkeit wird bewusst NICHT zugeordnet** – eine falsch einsortierte Mail ist schlimmer als eine fehlende.

**Wiedervorlagen** („bei Huber in 14 Tagen nachfassen"): In der Akte anlegen, Schnellwahl 7/14/30 Tage. Sie sind normale Aufgaben mit Kundenbezug und erscheinen daher auch im Aufgaben-Board und im Dashboard – eine einzige Liste für alles, was man nicht vergessen darf.

**Das CRM-Board** (Menü → **CRM**, früher „Anfragen"): die zentrale Übersicht über ALLES, was gerade offen ist – neue Anfragen, laufende Projekte in den Stufen ihrer Projektart und offene Angebote ohne Projekt. Karten per Drag&Drop verschieben; je Spalte Anzahl und Summe, oben das offene Gesamtvolumen.

- **Spalte „Neu"**: alle noch nicht zugeordneten Anfragen – egal ob per E-Mail, Telefon oder manuell erfasst. Alles landet automatisch hier.
- **Projektart-Filter**: Ohne Filter zeigt das Board die übergeordneten Phasen (Neu → In Klärung → Angebot → Auftrag → In Umsetzung → Abschluss), weil jede Projektart eigene Stufen hat. Wählst du z. B. „Badsanierung", siehst du deren echte 16 Stufen (Anfrage → Besichtigung → Planung → Angebot gesendet → Auftrag erhalten → Demontage → … → Übergabe) und kannst Projekte direkt zwischen ihnen ziehen.
- **Angebote** sind nicht ziehbar – ihre Spalte ergibt sich aus dem Beleg-Status.
- Über den Umschalter oben rechts kommst du zur **Anfragen-Liste** (Postfach-Arbeit, Filter, KI-Klassifizierung, manuelle Erfassung).

**Angebote nachfassen:** Wird ein Angebot versendet, plant die App automatisch eine Nachfass-Erinnerung (Standard: 5 Tage, einstellbar). Im CRM erscheint oben eine Leiste mit den fälligen Angeboten. Klick auf „Entwurf ansehen" öffnet die fertig formulierte Mail (offene Fragen zum Angebot, Terminwunsch) – du kannst sie ändern und mit einem Klick freigeben. **Es geht nie automatisch etwas an Kunden raus.** Mit dem ✕ stoppst du das Nachfassen, wenn sich die Sache erledigt hat; nimmt der Kunde das Angebot an oder lehnt ab, erledigt es sich von selbst.

**Automatische Verkettung Angebot ↔ Kunde ↔ Projekt:** Legst du ein Angebot aus einem Projekt heraus an, wird der Kunde automatisch übernommen. Beim Versand rückt das Projekt auf „Angebot gesendet" – aber nur vorwärts: Ein Nachtrag zu einer laufenden Baustelle wirft das Projekt nicht zurück.

**Einstellungen → CRM:** Aktivitätsarten (inkl. „zählt als Kontakt") und Pipeline-Stufen (Farbe, Wahrscheinlichkeit, Endstufe gewonnen/verloren) frei definieren. Verwendete Einträge werden beim Löschen nur deaktiviert, damit die Historie intakt bleibt.

## Technik

**Grundsatz:** Rund 70 % der Historie liegt bereits in der Datenbank. Diese Daten werden **nicht kopiert**, sondern über eine View zusammengeführt – dadurch ist die Akte ab dem ersten Tag rückwirkend gefüllt, ohne Datenmigration und ohne doppelte Wahrheit.

**Datenmodell** (Migrationen 0158–0163)
- `contact_events` – nur Ereignisse OHNE eigene Quelle (manuelle Gespräche/Notizen, ausgehende Mails, Stufenwechsel). Felder: `contact_id`, `contact_person_id`, `project_id`, `anfrage_id`, `activity_type_id`, `direction` (in/out/intern), `subject`, `note`, `occurred_at` (fachliches Datum ≠ `created_at`), `duration_minutes`, `transcript`, `source`, `source_ref_id`, `payload`, `organization_id`. Unique-Index `(organization_id, source, source_ref_id)` als Idempotenz-Anker.
- `crm_activity_types` – konfigurierbare Aktivitätsarten (`slug`, `label`, `icon`, `color`, `direction_default`, `counts_as_contact`, `active`, `sort_order`).
- `crm_pipeline_stages` – Stufen für Anfragen (`label`, `color`, `sort_order`, `is_won`, `is_lost`, `default_probability`, `active`, `crm_phase`).
- `crm_nachfass` (0164) – ein Datensatz je nachzufassendem Angebot: `offer_id` (unique je Org), `contact_id`, `project_id`, `faellig_am`, `status` (geplant→bereit→gesendet / erledigt / abgebrochen), `mail_betreff`, `mail_text`, `gesendet_am/-von`.
- `project_statuses_global.crm_phase` (0164) – ordnet jede Projektstufe einer der Phasen `neu|qualifizierung|angebot|auftrag|umsetzung|abschluss|verloren` zu. **Das ist der Kniff**, mit dem ein Board mehrere Projektarten mit unterschiedlichen Stufen gemeinsam darstellen kann. Die Zuordnung wurde automatisch aus den Stufennamen abgeleitet und ist per SQL/Einstellungen änderbar; die Achse selbst ist fix (sonst gäbe es keine gemeinsame Reihenfolge).
- `company_settings.crm_nachfass_tage` (Default 5) und `crm_nachfass_aktiv`.
- `contacts` erweitert: `owner_id`, `last_contact_at` (Trigger), `next_followup_at` (Trigger aus `tasks`), `crm_rating`.
- `tasks` erweitert: `contact_id` (+ Index) – Wiedervorlagen sind Aufgaben, kein zweites Modul.
- `anfragen` erweitert: `pipeline_stage_id`, `expected_value_net`, `probability`, `expected_close_date`, `lost_reason`, `stage_changed_at`.
- `incoming_mails` erweitert: `contact_id` (+ Index).
- RLS überall nach Standard: permissive `app_all` + restriktive `org_isolation` über `current_org_id()`.

**Views** (alle `security_invoker = true`, RLS der Quelltabellen greift)
- `crm_vorgaenge` (0164) – **die Board-Quelle**: UNION aus drei überschneidungsfreien Zweigen: Anfragen OHNE Projekt (sonst zeigt das Projekt den Vorgang), Projekte (nicht archiviert), Angebote OHNE Projekt und ohne Endstatus. Einheitliche Spalten `vorgang_id, quelle, titel, contact_id, kunde, project_id, projektart, stufe, phase, stufe_sort, wert_netto, termin, datum, route, unzugeordnet`.
- `contact_timeline` – UNION aus 8 Zweigen: `contact_events`, `documents_unified` (customer_id), `anfragen`, `planning_events`, `regie_reports`, `incoming_mails`, `projects`, `tasks`. Einheitliche Spalten `contact_id, occurred_at, kind, title, subtitle, note, amount_gross, status, route, ref_id, type_slug, color, icon, duration_minutes, created_by`. **Abfrage-Vertrag: immer mit `.eq('contact_id', …)`.**
- `contact_crm_stats` – Kennzahlen je Kunde aus `documents_unified` (Umsatz gesamt/12M, offene Angebote/Volumen, offene Forderungen, erster/letzter Beleg).

**Automatische Zuordnung** (Migrationen 0160–0162)
- `crm_match_contact_by_email(text, uuid)` / `crm_match_contact_by_phone(text, uuid)` – SQL-Funktionen, damit alle Einlieferwege dieselbe Logik nutzen. Telefon wird auf die letzten 9 Ziffern normalisiert (`crm_normalize_phone`), dadurch robust gegen `+43`/`0043`/`0`-Präfixe und Trennzeichen. **Nur bei genau einem Treffer wird zugeordnet, sonst NULL.**
- Trigger `trg_crm_assign_incoming_mail` (before insert auf `incoming_mails`) und `trg_crm_assign_anfrage_contact` (before insert auf `anfragen`) setzen den Kontakt und stempeln `last_contact_at`.
- **Wichtig (Fix 0162):** Diese Trigger legen **keine** `contact_events` an – Mails und Anfragen haben eigene Zweige in der View. Die erste Fassung tat das und erzeugte Doppeleinträge im Zeitstrahl.
- Ausgehende Mails: `logOutgoingMail()` wird zentral in `src/lib/microsoft/mailClient.ts#sendMail` aufgerufen (best effort, dynamischer Import, Fehler werden geschluckt – Protokollierung darf den Versand nie stören).

**Frontend**
- `src/lib/crm.ts` – Datenschicht (loadTimeline/loadActivityTypes/loadCrmStats/loadFollowUps/logContactEvent/createFollowUp/logOutgoingMail/seitLabel). Einziger Schreibweg in `contact_events`.
- `src/lib/crm-pipeline.ts` – Stufen/Chancen laden, `moveChance` (belegt Wahrscheinlichkeit aus der Zielstufe vor).
- `src/pages/ContactDetail.tsx` – die Akte (Bereichsnavigation: Sidebar am Desktop, Scroll-Tabs <1024px). Nicht-Kunden behalten die schlanke Stammdatenansicht; die View ist typunabhängig, eine Ausweitung wäre eine Einzeiler-Änderung.
- `src/components/crm/ContactTimeline.tsx` – Zeitstrahl mit Inline-Erfassung, Filterchips, Suche, „Ältere Einträge laden" (30er-Seiten).
- `src/components/crm/PipelineBoard.tsx` – Kanban (dnd-kit, optimistisches Verschieben).
- `src/components/settings/CrmSettings.tsx` – Einstellungen → CRM.
- Kontaktliste: Zeilenklick öffnet die Akte, Bearbeiten über das Stift-Icon.

**Nebenfix (blockierend, Migration-frei):** `contact_persons` wurden beim Speichern eines Kontakts gelöscht und neu eingefügt – dabei änderten sich alle Personen-IDs und Verweise aus `invoices.person_id`, `orders.person_id`, `project_participants`, `project_signatures` zeigten still ins Leere. Jetzt gezieltes Update/Insert/Delete über `dbPersonIdsRef` (`src/pages/Contacts.tsx`).

**Trigger-Kette rund um Angebote** (0164/0165)
- `crm_offer_kunde_ergaenzen` (before insert/update) – Kunde aus dem Projekt übernehmen. Bewusst als Trigger, weil Angebote an mehreren Stellen entstehen (Projekt, Dokumente-Übersicht, Sprach-Angebot).
- `crm_projekt_stufe_bei_versand` (after update of sent_at) – Projekt auf die `angebot`-Stufe seiner Projektart setzen, **nur vorwärts** (Vergleich über `crm_phase_rang`).
- `crm_plane_nachfass` (after update of sent_at) – Nachfass-Datensatz mit Fälligkeit anlegen.
- `crm_nachfass_abschliessen` (after update of status) – erledigt sich bei angenommen/abgelehnt/storniert.
- `crm_log_angebot_versand` – Versand im Kundenverlauf festhalten (hat keine eigene Zeitstrahl-Quelle).

**Frontend CRM-Board**
- `src/lib/crm-board.ts` – `loadVorgaenge`, `loadProjektarten` (Stufen je Art), `moveVorgang` (Projekt → `projects.stage`, Anfrage → Pipeline-Stufe, Angebot → nicht verschiebbar), `loadNachfass`, `stoppeNachfass`, `markiereNachfassGesendet`, Konstante `PHASEN`.
- `src/components/crm/VorgangsBoard.tsx` – Board mit Projektart-Filter und dynamischen Spalten.
- `src/components/crm/NachfassLeiste.tsx` – Erinnerungen + Entwurf + Freigabe (Versand über `sendMail`, danach `markiereNachfassGesendet`).
- `src/pages/Anfragen.tsx` – ist jetzt die **CRM-Seite** (Route `/crm`, Board als Standardansicht, Anfragen-Liste über den Umschalter). Alte Links `/anfragen` und `/anfragen/:id` leiten weiter.

**So erweitern**
- Neue Quelle im Zeitstrahl → weiteren UNION-Zweig in `contact_timeline` (Migration), Spaltenreihenfolge exakt einhalten, Icon/Farbe im `ICONS`/`TONE`-Mapping der Timeline-Komponente ergänzen.
- Neue Aktivitätsart/Stufe → über Einstellungen → CRM (keine Code-Änderung).
- Akte für Lieferanten/Subunternehmer → in `ContactDetail.tsx` die `istKunde`-Bedingung erweitern und die Kacheln typabhängig füllen (z. B. `eingangsrechnungen` statt Umsatz).

**Verknüpfungen**
[kontakte.md](kontakte.md) (Stammdaten), [smartes-ki-postfach.md](smartes-ki-postfach.md) (Mail-Zuordnung), [projekte.md](projekte.md), [angebote.md](angebote.md), [mandantenfaehigkeit.md](mandantenfaehigkeit.md).
