# Kalkulation
> Stammdaten + Editor für die Preisbildung: Gewerke, Artikel, Leistungen, Stundensätze, Einheiten, Texte.

## Für Anwender

**Was kann die Funktion?**
Liefert die Bausteine für Angebote: Gewerke (Gliederung), Artikel (Material), Leistungen (zusammengesetzt aus Artikeln/Stunden + Zuschläge), Stundensätze, Einheiten, Textbausteine. Pro Angebot wird ein Snapshot gezogen → spätere Stammdatenänderungen verändern alte Angebote nicht.

**Bedienung**
Bereich „Kalkulation" mit Unterseiten: Gewerke, Einheiten, Stundensätze, Artikel, Leistungen, Titel, Texte. Leistungen im `ServiceEditor` aus Komponenten (Artikel/Stunden) zusammensetzen.

## Technik

**Routen & Komponenten**
`/kalkulation` (+ Kinder `gewerke`, `einheiten`, `stundensaetze`, `artikel`, `leistungen`, `titel`, `texte`), `/kalkulation/leistungen/:id`, `/artikel`. Dateien: `src/pages/kalkulation/{Trades,Units,HourlyRates,Articles,Services,ServiceEditor,Titel,Texte,KalkLayout}.tsx`.

**Datenbank – exakte Felder**
- **`trades`**: `id, name, code, description, color, sort_order, active, organization_id`
  - **Gewerk-Nummer = `sort_order`, 1-basiert (Stand 2026-06-26).** `gewerkNo(sort_order)` (`src/lib/calc-types.ts`) liefert die 2-stellige Nummer (`1→"01"`, `0→null`). Die Nummern decken sich mit den Präfixen der Leistungs-/Artikelnummern (Gemeinkosten=01, Abbruch=02, … Reinigung=13, Elektrozuleitung=16). Korrigiert über Migr. **0094** (+1) und **0095** (datengetrieben am häufigsten Leistungs-/Artikel-Präfix ausgerichtet, mit Dublettenschutz). `import-hero-to-b4y.ts` setzt `sort_order` aus dem kanonischen Präfix (`GEWERK_PREFIX_MAP`, z. B. Reinigung=13, Elektrozuleitung=16), Fallback Reihenfolge-Index+1 – so bleibt ein Re-Import deckungsgleich mit den Nummern-Präfixen (ohne erneuten 0095-Lauf). `trade_id`-Referenzen unberührt; `service_number`/`article_number` werden NICHT umnummeriert.
- **`units`**: `id, name, code, sort_order, active, organization_id`
- **`hourly_rates`**: `id, trade_id, label, internal_rate, sale_rate, valid_from, valid_to, active, note, organization_id`
- **`articles`**: `id, article_number, name, description, category, unit, purchase_price, sale_price, supplier, is_stock, active, trade_id, supplier_email, list_price, vat_rate, image_url, positions_nummer, calculation_text, usage_count, organization_id`
  - **`calculation_text`** (Migr. **0128**, Feld „Berechnung"): Berechnungs-/Staffelpreis-Text analog zu `services.calculation_text`. Gepflegt im `ArticleForm` direkt bei den Preisfeldern (EK/Aufschlag/VK/Listenpreis); in CSV-Export/-Import als Spalte `calculation_text` (Import auch Header „berechnung") enthalten; beim Duplizieren mitkopiert.
- **`services`**: `id, service_number, name, short_text, long_text, calculation_text, image_url, trade_id, unit, overhead_percent, active, internal_name, category, vat_rate, internal_note, sort_order, aufschlag_percent, vk_net_manual, material_mode, pauschale_active, pauschale_type, pauschale_fix, pauschale_percent, positions_nummer, usage_count, organization_id`
  - **`calculation_text`** (Migr. 0096, Feld „Berechnung"): Berechnungs-/Staffelpreis-Text, zuvor als „Berechnung:"-Block im `long_text` vermischt → per Migr. **0097** herausgelöst (long_text = nur noch Beschreibung). Quelle für die Staffelpreis-/KI-Logik: `servicesToCatalog` (`loadStammdatenForVoice.ts`) hängt `"Berechnung: "+calculation_text` an den Katalogtext, damit `parseStaffelPreis` u. a. unverändert funktioniert. Im `NewServiceForm` sowie im `ServiceEditor` als Feld „Berechnung" pflegbar – im Editor seit 2026-07-06 im Reiter **Kalkulation** (eigenes Panel unter dem Materialmodus, damit der Text beim Kalkulieren sichtbar ist; zuvor Reiter „Informationen").
  - **`image_url`** (Migr. 0096): Leistungsfoto im **privaten, mandantengetrennten** Bucket `service-images` (Migr. 0098 Bucket + **0099 Org-Isolation**). Pfadschema **`<organization_id>/<datei>`**; die Storage-Policies erlauben SELECT/INSERT/UPDATE/DELETE nur im eigenen Org-Ordner (`storage.foldername(name)[1] = current_org_id()`). Upload in `ServiceEditor`/`NewServiceForm` präfixiert den Pfad per `rpc('current_org_id')`; Anzeige/Entfernen über `SignedImage` (signierte URLs, `src/lib/storage.ts`). Das Foto wird beim Einsetzen ins Dokument als Snapshot in die Position (`DocPosition.image_url`) übernommen, in der Positions-Vollmaske dokumentlokal bearbeitbar (Bucket `document-images`, Migr. 0100) und im PDF unter der Position angezeigt, gesteuert über `show_service_images` (Artikel analog über `show_article_images`). Details: [pdf-engine.md](pdf-engine.md).
- **`service_components`**: `id, service_id, kind, sort_order, label, hourly_rate_id, article_id, minutes, quantity, unit, cost_rate, sale_rate, percent, note, organization_id`
- Protokoll **`calc_audit_log`**: `id, entity_type, entity_id, action, changed_by, old_data(jsonb), new_data(jsonb), created_at, organization_id`

**Zentrale Logik**
Leistungspreis = Σ Komponenten (Artikel × Menge + Stunden × Satz) + Zuschläge (`overhead_percent`/`aufschlag_percent`) bzw. Pauschale (`pauschale_*`); `material_mode` steuert Materialbehandlung. Beim Einsetzen ins Angebot Snapshot (Entkopplung). Änderungen → `calc_audit_log`.

**Erweitern**
Neue Stammdatenart = eigene Tabelle (`organization_id`!) + Pflege-Seite + Verknüpfung im `ServiceEditor`. Audit-Log-Eintrag beibehalten. Keine Sätze/Zuschläge im Code hartcodieren.

**Tabellen-UI (Stand 2026-07-06):** Alle Kalkulations-Listen (Gewerke, Einheiten, Stundensätze, Artikel, Leistungen, Titel, Texte) haben sortierbare Spaltenköpfe über den zentralen Hook `useTableSort` + `SortHeader` (Persistenz je Benutzer/Tabelle im localStorage, Details [ui-guidelines](../ui-guidelines.md)). Leistungen sortieren u. a. Nr., Kurztext, Gewerk, Kategorie, Einheit, EK gesamt, VK netto final, MwSt, Status, Letzte Änderung. Zeilen sind komplett klickbar (Leistung → Editor, sonst Bearbeiten-Modal); Aktionsspalten stoppen das Bubbling.

**Artikel-Suchauswahl im ServiceEditor (Stand 2026-07-06):** „Material aus Artikelstamm" nutzt statt eines einfachen `<select>` die suchbare Combobox `ArticleSearchSelect` (`src/components/kalkulation/ArticleSearchSelect.tsx`): Suche über Nr./Name/Beschreibung/Gewerk/Kategorie/Einheit/Lieferant, Treffer mit Nr., Name, Gewerk, Einheit, EK/VK netto und Status, Tastatur ↑/↓/Enter/ESC, Anzeige auf 50 Treffer begrenzt. Die Auswahl übernimmt wie bisher `pickArticle` (Einheit, EK, Label in die Materialzeile).

**Leistungsformular-UI (Stand 2026-06-28):** In `NewServiceForm.tsx` (Anlegen) und `ServiceEditor.tsx` (Bearbeiten) steht das **Leistungsfoto ganz oben** (Upload/Ändern/Entfernen, Bucket `service-images`, `SignedImage`, Pfad `<org>/…` via `current_org_id` – Logik unverändert). Im **Lohn**-Block zeigt das Feld „Minuten" kein „min"-Suffix mehr (Überschrift bleibt „Minuten"). Im **Material**-Block sind **Menge (reine Zahl)** und **Einheit** getrennte Felder; die Artikelauswahl füllt die Einheit aus `articles.unit` vor (überschreibbar), persistiert in **`service_components.unit`** (keine Schemaänderung). Datalist `comp-unit-opts` aus den Stamm-Einheiten.

**Verknüpfungen**
[angebote.md](angebote.md) · [textbausteine.md](textbausteine.md)
