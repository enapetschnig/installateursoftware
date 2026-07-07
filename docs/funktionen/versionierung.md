# Versionierung
> Abgeschlossene Dokumente werden eingefroren: Versionen, Audit-Log und unveränderlicher Druckstand.

## Für Anwender
Wird ein Dokument abgeschlossen/versendet, entsteht eine **Version** mit eingefrorenem Inhalt – auch wenn sich später Firmendaten, Logo oder Texte ändern, bleibt das versendete Dokument exakt erhalten. Jede Änderung ist im Audit-Log nachvollziehbar.

**Bedienung**: „Abschließen"/„Finalisieren" im Editor **vergibt – falls der Beleg noch keine hat – zuerst die Belegnummer aus dem Nummernkreis** (Entwürfe sind nummernlos, siehe [nummernkreise.md](nummernkreise.md)) und erzeugt dann die Version (+ PDF-/HTML-Druckstand-Snapshot, falls für die Dokumentart aktiv). Versionsliste je Dokument; eine Version erneut öffnen zeigt exakt den damaligen Stand.

**Versionen-Modal „Versionen & Protokoll"**: Spalten Version · Nummer · Netto · Brutto · Status · **Abgeschlossen am (Datum + Uhrzeit)** · **Von (abschließender Benutzer)** · Aktionen (PDF/Wiederherstellen). Breites Modal (`size="2xl"`), keine horizontale Scrollleiste auf Desktop. „Abgeschlossen am" nutzt den echten Abschlusszeitpunkt (`finalized_at`), Format `TT.MM.JJJJ, HH:mm` (de-AT). Die Spalte „Von" zeigt immer einen Namen (nie „–"): zuerst der im Snapshot gespeicherte Anzeigename, sonst über `created_by`→`profiles` bzw. Audit-Log rekonstruiert, sonst „Unbekannt".

**Dokumentdatum = Abschlussdatum**: Beim Finalisieren wird das Dokumentdatum automatisch auf den Abschlusszeitpunkt gesetzt (ein zentraler Zeitstempel `finalizeStamp()`), je Typ persistiert (Angebot **und Angebot Nachtrag**→`closed_at`, Auftrag→`order_date`, Rechnung/Gutschrift→`invoice_date`+Fälligkeit) und der PDF-Snapshot mit genau diesem Datum gerendert. Entwürfe zeigen weiter ihr Erstell-/Vorschaudatum. Re-Finalisierung stempelt ein neues Datum (neue Version); alte Versions-Snapshots bleiben unverändert und es wird **keine neue Belegnummer** vergeben (`ensure_document_number` ist idempotent – die Nummer bleibt über alle Versionen stabil). Auftrag SUB hat (noch) keinen eigenen Abschluss-/Versions-Flow; sein Dokumentdatum kommt aus `sub_orders.sub_date` (DB-Default = Vergabedatum). Ein künftiger SUB-Abschluss nutzt denselben `finalizeStamp`.

**Nach dem Abschließen**: Der Editor springt automatisch zurück in den passenden Projektbereich (Angebot→„Angebote", Auftrag→„Aufträge", Rechnung→„Rechnungen"); Listen/Beträge/Versionen sind dort frisch. Beim Angebot mit „Abschließen und versenden" erfolgt der Rücksprung erst nach dem Versand-Dialog. Ohne Projektkontext: normaler Rücksprung.

## Technik

**Datenbank – exakte Felder (Migr. 0024–0027)**
- **`document_versions`**: `id, organization_id, source_table, source_id, version_no, status, title, doc_number, data(jsonb), summary(jsonb), print_html, created_by, finalized_at, created_at`
- **`document_audit_log`**: `id, organization_id, source_table, source_id, version_no, action, detail, user_id, created_at`
- Steuer-Flags je Dokumentart (`document_types`): `versioning_enabled, versioning_required, finalization_required, lock_finalized_versions, create_pdf_snapshot_on_finalize, audit_log_enabled, is_accounting_relevant, is_tax_relevant`.

**Zentrale Logik**
`finalizeDocumentVersion(...)`, `loadDocumentVersions(...)`, `loadDocumentAudit(...)` (Dokument-Lib, `src/lib/document-versions.ts`). `print_html` = Druckstand-Snapshot; erneutes Drucken über `printStoredHtml`/`openSnapshotPdf` ([pdf-engine.md](pdf-engine.md)) – der gespeicherte HTML-Stand wird **nicht** verändert (Viewer-Leiste nur transient injiziert). DB-Trigger erzwingen Compliance je `document_types`-Flags.

**PDF je Version persistent (Stand 2026-07-07):** Nach jedem Abschluss mit `print_html` bereitet `finalizeDocumentVersion` das echte PDF **im Hintergrund** vor (`prepareDocumentPdf`, fire-and-forget) und legt es im persistenten PDF-Cache ab (Bucket `document-pdfs` + Tabelle `document_pdf_cache`, Migr. 0129 – bewusst **eigene** Tabelle, damit `document_versions` unveränderlich bleibt). „PDF öffnen" in Versionshistorie/gesperrtem Editor lädt dann das gespeicherte PDF sofort statt erneut über PDFShift zu rendern; Gültigkeit über SHA-256 des `print_html`. Details [pdf-engine.md](pdf-engine.md).

Benutzer-Auflösung der Historie: `resolveVersionUser(v, { profiles, audit })` (Kette `data.finalizedByName` → `profiles[created_by]` → `document_audit_log.user_id` der `finalize`-Aktion → „Unbekannt"); `loadProfileNames()` liefert die `id→name`-Map. Die Versionshistorie ist URL-gekoppelt (`?versions=1` via Hook `src/hooks/useModalParam.ts`) – so kehrt der PDF-Viewer per Escape exakt zur geöffneten Historie zurück. Rücksprung nach Abschluss: `rememberProjectSection(projectId, section)` (`src/lib/project-nav.ts`) merkt den Sidebar-Bereich, den `ProjectDetail` beim Mount liest.

**Erweitern**
Versionsverhalten je Dokumentart über die Flags konfigurieren (kein Code). Snapshots/History **nie** nachträglich mutieren. Österr. Aufbewahrung (7 Jahre) + Audit beibehalten. `source_table`/`source_id` referenzieren den Beleg (offers/orders/invoices/…).

**Finalisierte Dokumente korrigieren (revisionssicher):** Abgeschlossene Belege werden nie still überschrieben. **Angebot/Auftrag:** Button „Korrekturversion" (`reopenForCorrection` setzt Status → `entwurf` → Editor entsperrt; beim erneuten Abschließen entsteht eine **neue Version**, die alte Version + PDF-Snapshot bleiben). „Wiederherstellen" (`doRestore`) macht eine alte Version zum neuen Arbeitsstand (alte bleibt). **Rechnung:** bleibt nach Finalisierung §11-gesperrt; Korrektur ausschließlich über **Storno** (`createStorno` → neue Rechnung, negativ). So sind Einstellungen/Seiten/Preise nach Abschluss wieder bearbeitbar, ohne Snapshots zu zerstören.

**Auto-Korrektur beim Umreihen + Toolbar-Status (Stand 2026-06-28):** Die 6-Punkte-Griffe (links) und Hoch/Runter-Pfeile (rechts) im Positions-Canvas sind wieder zuverlässig sichtbar/nutzbar (Kollisionserkennung hybrid: `closestCenter` fürs Umsortieren, `pointerWithin` für Sidebar-Einfügen → kein Einfügen beim Zurückziehen, `DocumentWorkspace.tsx`). Bei **abgeschlossenen Angeboten/Aufträgen** bleiben Griffe/Pfeile aktiv (`DocumentCanvas` Prop `correctable`); die **erste Umreihung/Bearbeitung** öffnet eine Hinweis-Rückfrage und erzeugt über `onBeginCorrection` (in `OfferEditor`/`OrderEditor`) revisionssicher einen Korrekturstand (Status→`entwurf`, `working_base_version_no` = letzte Version). Die abgeschlossene Version + PDF-Snapshot bleiben unverändert; eine neue Version entsteht erst beim Abschließen. Die Toolbar zeigt dann „**Korrektur offen – neue Version noch nicht abgeschlossen**" (`DocumentToolbar` Prop `correctionPending`). **Rechnungen** sind nicht korrigierbar (kein `correctable`) – Korrektur nur via Storno.

**Verknüpfungen**
[pdf-engine.md](pdf-engine.md) · [rechnungen.md](rechnungen.md) · [angebote.md](angebote.md)
