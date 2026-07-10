# Großhandels-Kataloge (Datanorm) & Sprach-Angebot mit echten EK-Preisen
> Elektro-/Installateurbetriebe kalkulieren Material über die Preise ihres Großhändlers. Die App importiert den Datanorm-Katalog des Händlers (Listenpreise + kundenspezifische Rabatte + Nettopreise) und nutzt ihn im Sprach-Angebot: die KI kalkuliert Material mit dem **echten Einkaufspreis** des Betriebs.

## Für Anwender

**Was kann die Funktion?**
- Der komplette Katalog des Großhändlers (bei Sonepar: **641.000+ Artikel**) liegt durchsuchbar in der App – mit **deinem** Preis: Listenpreis minus deiner Rabattgruppe bzw. dein Netto-Sonderpreis.
- **Angebot per Sprachnachricht**: sprichst du z. B. „15 Meter NYM-J 3x1,5 verlegen und 8 Steckdosen setzen", findet die App die passenden Katalog-Artikel und kalkuliert das Material mit deinem echten EK plus deinem Materialaufschlag – statt zu schätzen. Die verwendete Artikelnummer steht in der Positionsbeschreibung.
- **Preise aktuell halten**: Der Händler liefert regelmäßig neue Datanorm-/Preisdateien. Ein erneuter Import aktualisiert alles; Rabattänderungen wirken sofort auf alle Artikel (der EK wird nie „eingefroren", sondern live berechnet).
- Kabel mit Kupferanteil sind gekennzeichnet („+CU-Zuschlag"): der tagesabhängige Metallzuschlag des Händlers wird im Angebot als Hinweis ausgewiesen.
- **Katalog in der normalen Angebotserstellung (Stand 2026-07-10)**: In jedem Dokument-Editor (Angebot, Auftrag, Rechnung, Nachtrag) über Toolbar „Positionen einfügen“ → Reiter **„Großhandel“**: Katalog durchsuchen (Bezeichnung/Artikelnummer/EAN), Menge und optionale Montageminuten je Treffer angeben, mehrfach auswählen, einfügen – der VK wird automatisch aus EK + Aufschlägen (+ Montagezeit × Stundensatz) kalkuliert. Am Desktop zusätzlich: Das Suchfeld der rechten Seitenleiste zeigt ab 3 Zeichen einen Abschnitt „Großhandelskatalog“ mit Treffern zum Ziehen/Plus-Einfügen.
- **Mehrere Großhändler**: Jeder weitere Katalog (z. B. Rexel neben Sonepar) wird mit eigenem `--name` importiert. Die Suche läuft über alle Kataloge, der Lieferantenname steht am Treffer. Verwaltung unter **Einstellungen → Großhandel & Kataloge** (Übersicht, Preisstand, Absender-Domains für Preis-Mails).
- **Handelsübliche Preise**: Unter Einstellungen → Kalkulation wirken die Aufschläge; zusätzlich hinterlegt `kalk_richtwerte` (Migr. 0150) handelsübliche VK-Spannen je Leistungskategorie – die Sprach-KI kalibriert sich daran ({{RICHTWERTE}}-Block) und Ausreißer werden als „Prüfen:“-Hinweis gemeldet.

**Bedienung (Erstimport / Update)**
Aktuell läuft der Import über das Betreuer-Skript (Terminal, im Projektordner):
```
node scripts/datanorm-import.mjs --dir <Ordner mit Datanorm-Dateien> --name "Sonepar Österreich"
```
Erwartet werden die Original-Dateien des Händlers: `DATANORM.001…` (Artikel), `DATANORM.rab` (Rabatte), `DATANORM.wrg` (Warengruppen), `DATPREIS.*` (Nettopreise), optional `Metallbasis.csv`. Der Import ist idempotent – ein erneuter Lauf aktualisiert.

**Woher bekommt man die Dateien?** Beim Händler das „B2B/Datanorm-Service" beantragen (bei Sonepar: e-business@sonepar.at, Stichwort „Automatische Preiswartung Datanorm"). Die Zugangsdaten für IDS/OCI sind die Webshop-Logindaten.

## Technik

**Datenmodell** (Migration `0144_grosshandel_kataloge.sql`)
- `supplier_catalogs` – ein Katalog je Lieferant (`name` UNIQUE je Org, `valid_from` aus dem Vorlaufsatz, `item_count`, `source_info`).
- `supplier_catalog_items` – die Artikel: `artikelnummer`, `kurztext1/2`, `matchcode`, `zusatz`, `einheit`, `preiseinheit` (Preis je 1/100/1000), `listenpreis_cent`, `nettopreis_cent` (DATPREIS, überschreibt Liste), `rabattgruppe`, `warengruppe`/`untergruppe`, `ean`, `metall`/`metall_gewicht`/`metall_basis` (Z-Satz, Rohwerte), generierte Spalte `search` (lower(kurztext1+2+matchcode+zusatz+artikelnummer)) mit **GIN pg_trgm-Index**. UNIQUE `(org, catalog, artikelnummer)`. *(Name wegen leerer B4Y-Altlast-Tabelle `catalog_items` – siehe Migrations-Kommentar.)*
- `catalog_discounts` – Rabattgruppen (`prozent`, z. B. 68.00), kundenspezifisch aus `.rab`.
- `catalog_groups` – Warengruppen-Hierarchie aus `.wrg`.
- `catalog_metal_rates` – CU/AL-Notierung aus `Metallbasis.csv`. **Die Zuschlagsformel wird erst gegen eine echte Händlerrechnung verifiziert, bevor sie automatisch aufgeschlagen wird** – bis dahin nur Kennzeichnung „zzgl. tagesaktueller Metallzuschlag".
- RLS überall: Post-0063-Standard (permissive `app_all` + restrictive `org_isolation`).

**EK-Berechnung (nie eingefroren)**
`ek = COALESCE(nettopreis_cent, listenpreis_cent × (1 − rabatt/100)) / preiseinheit` – berechnet in der DB-Funktion **`catalog_search(p_query, p_limit, p_catalog_id default null)`** (seit 0148/0149 SECURITY DEFINER mit hartem Org-Filter aus dem JWT; liefert zusätzlich `catalog_id` + `katalog_name` für Lieferanten-Badges und kollisionsfreie Schlüssel `hitKey()` bei mehreren Händlern). Suche über `word_similarity` (pg_trgm) + Exakt-Boost für Artikelnummer/EAN. Ein neues Rabattblatt (nur `.rab` neu importieren) ändert sofort alle EKs.

**Import** (`scripts/datanorm-import.mjs`)
Streaming-Parser für Datanorm 5 (V/A/Z-Sätze; T-Langtexte werden bewusst NICHT importiert – 10 Mio Zeilen, Kurztexte+Matchcode genügen). Encoding-Autodetect je Datei (Händler mischen CP850 und Latin-1!). Nettopreise werden vorab in eine Map geladen und beim A-Satz-Stream gemerged. Batch-Upserts à 2000 über PostgREST (Service-Role aus `.env.local`). PostgREST-Eigenheit: Bulk-Zeilen brauchen identische Schlüssel → alle Felder werden immer mitgeschickt.

**Deterministische Material-Bepreisung & Mitdenken (Stand 2026-07-10)**
Das LLM rechnet Preise NICHT selbst (es klebte nachweislich an unpassenden Preislisten-Positionen). Stattdessen liefert es je Material-Position nur Fakten (`material_artikelnummer` aus dem Katalog-Block, `material_menge_pro_einheit`, `arbeitszeit_min_einheit`); `applyWholesalePricing()` (in `src/lib/wholesale.ts`, aufgerufen im `VoiceAngebotDialog` vor der Calc-Pipeline) rechnet daraus deterministisch über den zentralen Preis-Kern **`calcWholesaleVk()`**: `(EK × Menge × (1+Materialaufschlag) + Minuten/60 × Stundensatz) × (1+Gesamtaufschlag)` – identisch zur Prompt-Formel und zum Editor-Picker (`catalogHitToDocPosition()`: fertige `DocPosition` mit `surcharge_baked=true` gegen Doppelaufschlag und dokumentspezifischem `vat_rate`, z. B. 0 bei §19 Reverse Charge). Ein Notnagel bepreist 0-€-Neu-Kalkulationen per Token-Match gegen die Katalog-Treffer nach („automatisch nachkalkuliert"). Zusätzlich „Mitdenken": Der Prompt ergänzt fachlich zwingende Nebenleistungen (Dosen, Absicherung, Eckventile, Silikon …) und liefert `fehlt_moeglicherweise[]` – diese Punkte landen als „Prüfen: …" in den internen Angebots-Notizen. Bei ungültigem KI-JSON gibt es einen automatischen zweiten Versuch. Live-Integrationstest: `VOICE_LIVE=1 npx vitest run src/lib/voice/voiceBrain.live.test.ts` (echte KI + echter Katalog); In-App-Test: `e2e/voice-angebot.pw.ts` (KI gemockt, Rest echt). Performance-Lektion: `catalog_search` ist SECURITY DEFINER mit hartem Org-Filter, weil RLS + nicht-leakproof Trigram-Operator den GIN-Index aushebelt (Seq-Scan → Timeout); Migrationen 0145–0148.

**Sprach-Angebot: Retrieval statt Prompt-Stuffing** (`src/lib/wholesale.ts`)
Die Voice-KI sah bisher max. 100 Zeilen der eigenen Leistungs-Preisliste. Neu: `searchCatalogForTranscript(transkript)` zerlegt das Transkript in Suchbegriffe (Stoppwort-Filter, Dimensionen wie „3x1,5" bleiben erhalten), fragt je Begriff `catalog_search` ab und liefert die ~36 besten Artikel dedupliziert. `buildWholesaleBlock()` baut daraus den Prompt-Block „GROSSHANDELSKATALOG" (Artikelnummer | Bezeichnung | Einheit | EK). Eingehängt in `VoiceAngebotDialog.tsx` (additiv – ohne importierten Katalog leerer Block = Verhalten wie bisher). Die Prompt-Regeln in `komplettangebot.ts` verpflichten die KI: bei passendem Artikel EK × (1 + Materialaufschlag) statt Schätzung, Artikelnummer in der Beschreibung, keine erfundenen Artikelnummern.

**Ausbaustufen (Konzept, noch nicht gebaut)**
1. **Import-UI** in den Einstellungen (Datei-Upload im Browser, Fortschritt, Katalog-Status) – ersetzt das Betreuer-Skript für Endkunden.
2. ~~Automatische Preiswartung~~ **UMGESETZT**: Händler-Preisdateien per E-Mail → der Mail-Poller (`api/mail/poll.js`) erkennt Datanorm-Anhänge am Dateinamen (`api/_lib/datanorm.js`: `isDatanormFile`/`parseDatanorm`/`applyDatanormUpdates`), aktualisiert Nettopreise (nur existierende Artikel), Rabattgruppen, Artikel-Deltas und Metallkurse und protokolliert das Ergebnis im KI-Postfach. Einrichtung: beim Händler die „Automatische Preiswartung (Datanorm) per E-Mail“ an die Postfach-Adresse der App beantragen. **Mehrkatalogfähig (Migr. 0151)**: Bei mehreren Katalogen entscheidet die Absender-Domain (`supplier_catalogs.sender_domains`, Pflege unter Einstellungen → Großhandel & Kataloge), in welchen Katalog die Preise fließen; ohne eindeutige Zuordnung wird NICHT angewendet, sondern im KI-Postfach „manuell zuordnen“ protokolliert – nie stilles Überschreiben des falschen Händler-Katalogs.
3. ~~Katalog-Suche in der Positionserfassung~~ **UMGESETZT (2026-07-10)**: Modus „Großhandel“ im zentralen `MultiInsertModal` (alle Dokument-Editoren, iPad-tauglich als Vollbild-Sheet) + Abschnitt „Großhandelskatalog“ in der `ContentSidebar` (Drag&Drop/Plus, debounced Serversuche ab 3 Zeichen). Zentrale Bausteine: `searchCatalog()`, `catalogHitToDocPosition()`, `normalizeCatalogUnit()` in `src/lib/wholesale.ts`; Kalk-Parameter über `SidebarData.kalk` (loadSidebarData).
4. **IDS-Connect / OCI-Punchout**: Warenkorb-Roundtrip mit dem Händler-Webshop (Zugangsdaten = Webshop-Login; OCI-Handler-URL des Händlers + HOOK_URL). Für Bestellungen direkt aus dem Auftrag.
5. **UGL-Belegaustausch**: Bestellung/Auftragsbestätigung/Lieferschein/Rechnung elektronisch – Eingangsrechnungen fließen dann automatisch in die Buchhaltung.
6. **Metallzuschlag rechnen**: Formel (Kurs − Basis) × Gewicht gegen echte Rechnung verifizieren, dann automatisch in die EK-Berechnung.

**Verknüpfungen**
[ki-assistent-isabella.md](ki-assistent-isabella.md) (Voice-Pipeline), [kalkulation.md](kalkulation.md) (Aufschläge), [buchhaltung.md](buchhaltung.md) (später UGL-Rechnungen), [smartes-ki-postfach.md](smartes-ki-postfach.md) (später Auto-Preiswartung), [mandantenfaehigkeit.md](mandantenfaehigkeit.md).
