# B4Y SuperAPP – UI-Richtlinien

## Tabellen: Sortierbare Spaltenköpfe (global, Stand 2026-07-06)

**Regel:** Alle Daten-Tabellen der App haben klickbar sortierbare Spaltenköpfe (1. Klick aufsteigend, 2. Klick absteigend, Pfeil-Indikator). Reine Checkbox-, Bild-, Farb- und Aktionsspalten bleiben unsortierbar. Kalender-Raster mit natürlicher Ordnung (KW 1–52, Mo–So in `WorkCalendar`/`BuakCalendar`/Wochenplan) werden bewusst NICHT sortierbar gemacht.

**Umsetzung (zentral, keine Doppellogik):**
- Hook `useTableSort` (`src/lib/useTableSort.ts`): typgerechte Sortierung (`text` de-AT-natural, `number`, `date`), leere Werte immer ans Ende, Persistenz pro Benutzer und Tabelle im localStorage (`b4y-sort:<userId>:<tableKey>`). Wirkt NUR auf die bereits gefilterte Liste – Suche/Filter/Tabs/Pagination bleiben unberührt (bei Pagination: sortieren VOR dem Slice, siehe `Anfragen.tsx`).
- Kopf-Komponente `SortHeader` (`src/components/SortHeader.tsx`): ersetzt ein `<th>` 1:1. Props: `align` (left/right/center), `padClass` (Default `px-4 py-3`, dichtere Tabellen z. B. `px-3 py-2`), `title` (Tooltip), `className`.
- **Serverseitig sortierte Tabellen** (z. B. `Documents.tsx` über `documents_unified`) behalten ihre Query-Sortierung und nutzen `SortHeader` nur für die Darstellung: `sort={{ key: sortBy, dir: sortDir }}` + eigenes `onSort`.
- Gruppierte Tabellen (z. B. Dokumentarten nach Kategorie): Sortierung wirkt innerhalb jeder Gruppe, Gruppen bleiben bestehen.

**Beispiel:**
```tsx
const sort = useTableSort<Row>("mein_table_key", {
  name: { get: (r) => r.name, type: "text" },
  net:  { get: (r) => r.net,  type: "number" },
  updated: { get: (r) => r.updated_at, type: "date" },
}, { userId, default: { key: "name", dir: "asc" } });
// im thead:  <SortHeader label="Name" sortKey="name" sort={sort.sort} onSort={sort.onSort} />
// im tbody:  {sort.sortRows(gefilterteListe).map(...)}
```

## Tabellen: Ganze Zeile klickbar (global, Stand 2026-07-06)

**Regel:** Führt eine Tabellenzeile fachlich zu einem Detail-/Bearbeiten-Ziel, öffnet ein Klick irgendwo in der Zeile dieses Ziel – nicht nur ein einzelner Link/Zelltext. Cursor + Hover zeigen die Klickbarkeit (`cursor-pointer hover:bg-…`).

- `<tr onClick={…} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5">`
- **Ausnahmen behalten ihre eigene Funktion:** Aktionsspalten, Checkboxen, Toggles, Dropdowns und Links mit eigener Aktion stoppen das Bubbling – am einfachsten auf der Zelle: `<td onClick={(e) => e.stopPropagation()}>`.
- Ohne Detailziel (reine Inline-Bearbeitungsraster wie `MediaCategoryManager`) gibt es keinen Zeilenklick und keinen `cursor-pointer`.
- Rechte beachten: Zeilenklick nur setzen, wenn der Benutzer das Ziel auch öffnen/bearbeiten darf (`canManage ? onClick : undefined`).

## Tabellen: Scrollbar-Geometrie & Kopfzeilen ohne Striche (Stand 2026-07-06)

Zentral in `src/index.css` gelöst – nichts pro Tabelle tun:
- Der vertikale Scrollbalken läuft nicht mehr in die runde obere Ecke der Tabellenkarte: `.overflow-x-auto:has(> table)::-webkit-scrollbar-track { margin: 14px; }` hält den Balken je Achse aus den Rundungen (12–16px Radius) heraus; `::-webkit-scrollbar-corner` ist transparent.
- Keine Striche in/zwischen Spaltenüberschriften: `thead th` deckt Sub-Pixel-Fugen (Windows-Skalierung 125 %/150 %) mit einem zusätzlichen `-1px`-Schatten in `var(--card)` ab, und `thead`/`thead[class]` sind einheitlich auf `var(--card)` gesetzt (die früheren `bg-slate-50`-Tönungen blitzten sonst als vertikale Linien durch die Fugen).

## Formulare: Enter löst die primäre Aktion aus (global, Stand 2026-07-06)

**Regel:** In Modals/Dialogen löst Enter in einem einzeiligen Eingabefeld die sichtbare primäre (blaue) Aktion aus – wie ein Klick auf Speichern/Anlegen. Zentral gelöst in `src/components/ui.tsx` (`handleModalEnter` am Modal-Sheet): geklickt wird der letzte aktive `btn-primary` im Modal → Busy/Disabled und Validierung wirken exakt wie beim Klick, kein Doppel-Submit.

**Ausnahmen (Enter behält lokale Bedeutung):** `textarea`/contenteditable/`<select>`; Comboboxen/Autocompletes, die Enter selbst verarbeiten (`preventDefault`, z. B. `CustomerSelect`, `AddressAutocomplete`, `ArticleSearchSelect`) oder `aria-expanded="true"` tragen; Felder mit `list`-Attribut (datalist); Bereiche mit `data-no-enter-submit`; Eingaben in echten `<form>`-Elementen (dort submittet Enter nativ – bestehende `onSubmit`-Formulare wie Login bleiben unverändert). ConfirmDialoge (destruktiv) haben keine Eingabefelder → Enter löst dort nichts aus.

**Neue Dialoge:** primäre Aktion als `btn-primary` im Fuß, eigene Enter-Logik in Popovern mit `preventDefault` bzw. `data-no-enter-submit` markieren – dann greift das Muster automatisch.

## Navigation: Inhalt startet oben (global, Stand 2026-07-06)

Beim Modul-/Routenwechsel (Sidebar/Hauptnavigation) wird der Inhaltsbereich (`<main>` in `src/components/Layout.tsx`) auf `scrollTop = 0` zurückgesetzt – gebunden NUR an `location.pathname`. Query-Änderungen (`?tab=…`, `?typ=…`) und In-Page-Aktionen (z. B. Scroll zu neu eingefügter Position) bleiben unberührt.

## Topbar-Indikatoren (global, Stand 2026-07-06)

`src/components/TopbarIndicators.tsx`: Benachrichtigungen (Projekt-Logbuch der Automationen), offene Aufgaben (`tasks`), neue Mails (Microsoft-Inbox, nur bei Verbindung). Zähler sind ausschließlich datenbasiert – ohne Daten/Verbindung erklärter Leerzustand, niemals Fake-Badges. Sichtbarkeit rechtegeprüft (`usePermissions`), Panels schließen mit ESC/Klick außerhalb.

## Auswahlfelder: native `<select>` vs. App-Combobox (Leitlinie, Stand 2026-07-06)

Native `<select>`-Menüs schließen betriebssystembedingt beim Fokusverlust (Taskleiste/App-Wechsel) und sind daher schwer zu screenshotten und bei langen Listen unübersichtlich.

- **Standard bleibt `<select>`** für kurze, statische Listen (Status, MwSt., Einheiten mit wenigen Einträgen) – am schnellsten, barrierefrei und mobil nativ.
- **Suchbare App-Combobox** für lange/wachsende Stammdatenlisten: `ArticleSearchSelect` (`src/components/kalkulation/ArticleSearchSelect.tsx`) ist die Referenz-Implementierung (Suchfeld im Popover, ↑/↓/Enter/ESC, Treffer-Limit, bleibt offen bis Klick außerhalb oder ESC → screenshot-freundlich). Bei Bedarf für weitere Felder (Lohngruppe, Kontakte, Projekte …) nach diesem Muster verallgemeinern – keine zweite, abweichende Dropdown-Logik bauen.

## Screenshot-Button in der Topbar (Stand 2026-07-06)

`src/components/ScreenshotButton.tsx` (Kamera-Symbol, immer sichtbar): Ein Klick → Bildschirmfreigabe → aktueller Frame wird sofort lokal als PNG heruntergeladen (kein Upload, Aufnahme wird direkt beendet; kein Countdown). Für Dropdowns im Bild: App-Popover sollen Pointer-Events auf `[data-screenshot-trigger]` in ihrer „Klick-außerhalb-schließt"-Logik ignorieren (Muster in `ArticleSearchSelect`), dann bleiben sie während der Aufnahme offen. Native `<select>`-Menüs schließt das Betriebssystem beim Klick – sie sind prinzipbedingt nur mit geteiltem gesamten Bildschirm und im Aufnahmemoment offenem Menü erfassbar. iOS/iPad-Safari ohne `getDisplayMedia` → Button wird dort ausgeblendet.

## Tabellen: Voller Zellinhalt beim Hover (global, Stand 2026-06-21)

**Regel:** Abgeschnittene Tabellenzellen müssen den vollständigen Inhalt beim Hover zeigen – ohne Layout-Sprung, kompakt, kompatibel mit sticky Headern und allen Themes.

**Umsetzung:** Zentrale Komponente `TableCell` in `src/components/ui.tsx` (`truncate` + nativer `title`-Tooltip; bei String-Inhalt wird der Titel automatisch gesetzt, sonst `title`-Prop). Verwendung: `<TableCell maxW="200px">{text}</TableCell>` (rendert ein `<td>`; `as="div"` für Karten). Wo `TableCell` (noch) nicht eingesetzt ist, mindestens `title={…}` an der vorhandenen `truncate`-Zelle ergänzen. Eingesetzt u. a. in Kontakte, Projekte, Dokumente; sukzessive app-weit ausrollen.

## Tabellen: Sticky Spaltenüberschriften (global)

**Regel:** Alle Tabellen in der B4Y SuperAPP müssen bei vertikalem Scrollen sticky Spaltenüberschriften haben. Diese Regel gilt global für bestehende und zukünftige Tabellen.

### Umsetzung (zentral, ohne Komponente)
Gelöst rein über globales CSS in `src/index.css`:

```css
thead th {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--card);          /* deckend, theme-aware – nie transparent */
  box-shadow: inset 0 -1px 0 var(--border);
}
.overflow-x-auto:has(> table) {
  overflow: auto;
  max-height: calc(100dvh - 210px); /* macht den Wrapper zum Scrollbereich */
}
```

### Warum der Wrapper beschränkt wird
`position: sticky` klebt relativ zum nächsten Scroll-Container. Ein `overflow-x-auto`-Wrapper erzeugt bereits einen Scroll-Kontext (overflow-y wird zu „auto"), hat aber ohne Höhenbegrenzung keinen echten vertikalen Scroll – dadurch würde der Header beim Seiten-Scroll mitwandern. Mit `max-height` + `overflow:auto` wird der Wrapper zum echten Scrollbereich; der Header bleibt sichtbar – auch bei breiten, horizontal scrollbaren Tabellen.

### So baut man neue Tabellen
Einfach wie bisher wickeln – der Header klebt automatisch:

```tsx
<div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
  <table className="w-full text-sm">
    <thead>{/* … */}</thead>
    <tbody>{/* … */}</tbody>
  </table>
</div>
```

### Hinweise
- **Deckende Farbe:** Der Header nutzt `var(--card)` und ist in allen Modi (Hell, Dunkel, Augenschon Hell/Dunkel, alle Akzent-Schemata) deckend.
- **Gruppierte Tabellen** (z. B. Dokumentarten): Die Spaltenüberschrift (`thead`) bleibt sticky; Gruppen-Zwischenüberschriften (in `tbody`) scrollen normal mit.
- **Theme-Tokens:** Farben immer über Design-Tokens (`var(--card)`, `var(--border)` …), nie hart kodieren.

## Einheitlichkeit (Stand 2026-07-09)

**Seitenkopf:** Jede Listen-/Modulseite nutzt `PageHeader` aus `src/components/ui.tsx`
(`title` akzeptiert jetzt `ReactNode`, damit Icon-Titel möglich sind). Kein handgebauter `h1`-Block mehr.

**Sekundärtext:** die Utility **`.text-muted`** (an `var(--text2)` gebunden) statt gemischtem
`text-slate-400` / `text-slate-500`. Sie ist in allen 4 Themes korrekt (auch warm).

**Farben:** ausschließlich die kanonische Badge-Palette (`slate | blue | green | amber | red`) bzw. `var(--accent)`.
Off-Palette (violet/sky/green-600) wurde ersetzt.

**Breite Tabellen:** Kernspalten immer sichtbar, Nebenspalten über Breakpoint-Klassen im `cls`-Slot der
Spaltendefinition ausblenden (`hidden md:table-cell`, `lg:`, `xl:`, `2xl:`). Beispiel: `src/pages/Documents.tsx`
zeigt auf dem iPad 8 statt 15 Spalten – ohne Datenverlust und ohne horizontales Scrollen der Seite.

**Touch (iPad):** Komfortregeln hängen an **`@media (pointer: coarse)`** statt an der Bildschirmbreite –
44 px Touch-Ziele und 16 px Eingabefelder gelten damit auch auf dem iPad (768–1024 px), der Desktop mit Maus bleibt unberührt.
Vollflächen-Sheet-Modals bleiben dem Handy vorbehalten.
