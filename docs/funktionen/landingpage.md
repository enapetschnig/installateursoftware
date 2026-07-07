# Öffentliche Landingpage
> Statische Marketing-Seite auf der Hauptdomain `/` – verkauft die B4Y SuperAPP an Bau- & Handwerksbetriebe. Bewusst getrennt von der React-App unter `/app`.

## Für Anwender
**Was ist das?** Die Seite, die Besucher auf `https://b4y-superapp.app/` sehen. Sie erklärt Problem, Lösung, die echten Module, die KI, Preise (auf Anfrage), enthält einen ROI-Beispielrechner und einen FAQ-Bereich. CTAs führen zu „Demo anfragen" (E-Mail an `office@bau4you.at`) und „Zur App / Login" (`/app/login`).

**Inhaltliche Grundregel (wichtig):** Es werden **nur tatsächlich nutzbare Funktionen** als fertig dargestellt. Bereiche, die nur Platzhalter/„in Vorbereitung" sind (E-Mail-Versand/Graph-Anbindung, Zeiterfassung, Buchhaltung, Baustellendoku, Wartung, Büro-Organisation, News, Delegieren), stehen ehrlich im Abschnitt **„Diese Bereiche sind in Vorbereitung"** und werden **nicht** als fertige Kernmodule beworben. Kein Versprechen von automatischem E-Mail-Versand (gibt es nirgends).

**Seitenstruktur (Reihenfolge der Sections in `public/landingpage.html`):**
1. Header (sticky) – Logo, Anker-Navigation, Login + Demo-CTA
2. Hero (hell) – Headline, Foto `hero-baustelle-tablet.jpg`, KI-Hinweis-Chip
3. Zielgruppen (3 Foto-Karten) – Bauunternehmen / Handwerk / Subunternehmer
4. Problem („Kennst du das?") – 8 Icon-Karten
5. Kostenfaktor (**dunkles Band**) – Verlust-Richtwerte
6. Lösung – Struktur / Kontrolle / Tempo
7. Module (`#funktionen`) – 12 Modul-Karten mit konkreten Fähigkeiten + Hinweis auf Auswertungen
8. Spotlight – Dokumente/Versionierung (Foto `plaene-dokumente.jpg`)
9. KI (`#ki`, **dunkles Band**) – Isabella, Pills, Foto `ki-tablet-industrie.jpg`, Chat-Beispiel
10. „In Vorbereitung"-Band – geplante Module
11. Story – Foto `portrait-meister.jpg`, 25+ Jahre
12. Vorher/Nachher
13. ROI-Rechner (`#roi`)
14. Vergleich
15. Schritte (Onboarding)
16. Preise (`#preise`)
17. Anwendungsfälle (Fotos, **keine** erfundenen Namen/Kunden)
18. FAQ (`#faq`)
19. Final-CTA (**dunkles Band**)
20. Footer

## Technik
**Datei:** [`public/landingpage.html`](../../public/landingpage.html) – **self-contained**: nur Inline-CSS + Inline-JS, **keine** externen Fonts/CDNs (CSP-konform, siehe `vercel.json`). System-Font-Stack (Inter bevorzugt). Icons als Inline-SVG-Sprite (`<symbol>` + `<use href="#i-…">`). Design: heller Premium-Look mit gezielten dunklen Akzentbändern (`.band-dark`), Marke BAU4YOU-Rot `--brand:#e11d2a`.

**Auslieferung:** [`scripts/prepare-static-entrypoints.mjs`](../../scripts/prepare-static-entrypoints.mjs) kopiert nach `npm run build` die `dist/landingpage.html` → `dist/index.html` (= Startseite `/`) und den App-Build → `dist/app/index.html`. `vercel.json`-Rewrites: `/` = Landingpage, `/app/*` = React-App. Statische Dateien (z. B. `/landing/*.jpg`, `/favicon.svg`) werden direkt ausgeliefert (Filesystem vor Rewrite).

**Routing-Schutz (im `<head>`, nicht entfernen):** Inline-Script leitet alte App-Hash-Routen (`#/login`, `#/projekte` …) auf `/app/...` um und Supabase-Auth-Callbacks auf `/app/login`. In-Page-Anker (`#funktionen`, `#faq` …) bleiben unberührt. `/app/login`-Links müssen erhalten bleiben.

**Bilder:** lokal unter [`public/landing/`](../../public/landing/) (selbst gehostet, kein Hotlinking). Lizenz/Quelle & Austausch-Anleitung: [`public/landing/README.md`](../../public/landing/README.md). Im `<head>` zeigt `og:image` auf `hero-baustelle-tablet.jpg`.

**Interaktiv (Inline-JS):** ROI-Rechner (Regler → Echtzeit-Beispielwerte, `de-AT`-Formatierung) und FAQ-Akkordeon (dynamisch erzeugt).

**SEO:** `<title>`, `description`, OpenGraph/Twitter, `canonical` und JSON-LD (`SoftwareApplication` mit ehrlicher `featureList`). Produktname/Domain stehen hier statisch; in der App kommen sie aus [`src/lib/branding.ts`](../../src/lib/branding.ts).

## So ändert man die Seite
- **Texte/Module:** direkt im jeweiligen `<section>` in `public/landingpage.html`. Modul-Aussagen müssen zum echten Code passen (Quelle: Funktions-Doku in diesem Ordner). Nichts erfinden.
- **Neues Modul wird fertig:** Karte aus dem „In Vorbereitung"-Band in den Modul-Grid hochziehen und mit konkreten, belegten Fähigkeiten beschreiben; `featureList` im JSON-LD ergänzen.
- **Fotos:** siehe `public/landing/README.md` (gleicher Dateiname = automatisch übernommen; sonst `<img src>` + `alt` anpassen).
- **Neues Icon:** `<symbol id="i-…">` im Sprite ergänzen, per `<svg class="ic"><use href="#i-…"/></svg>` nutzen.
- **Responsiv:** keine horizontale Überbreite bei 390 px (Guards: `body{overflow-x:hidden}`, `img{max-width:100%}`, Grids brechen per Media-Query auf 1 Spalte).

**Verknüpfungen:** [[einstellungen]] (Branding/Firmendaten in der App), [[ki-assistent-isabella]], [[dokumente]], [[versionierung]], [[nummernkreise]], [[kalkulation]] – die Seite spiegelt deren echten Stand wider.
