# Landingpage-Bilder (`/public/landing/`)

Diese Bilder werden von der öffentlichen Landingpage (`public/landingpage.html`) genutzt und
sind **lokal selbst gehostet** (kein Hotlinking → CSP-/DSGVO-sicher, `img-src 'self'`).

## Herkunft & Lizenz
Alle Fotos stammen von **Pexels** und stehen unter der **Pexels-Lizenz**: kostenlos für
kommerzielle Nutzung, **keine Namensnennung erforderlich**, Bearbeitung erlaubt.
Quelle: https://www.pexels.com/license/

Die Bilder werden **rein illustrativ/atmosphärisch** verwendet – **nicht** als echte
Kund:innen, Mitarbeiter:innen oder mit erfundenen Namen/Bewertungen.

| Datei | Motiv | Pexels-Foto-ID |
|---|---|---|
| `hero-baustelle-tablet.jpg` | Fachkraft mit Tablet auf der Baustelle (Hero) | 8961008 |
| `team-besprechung.jpg` | Bauleiterin & Polier besprechen sich | 8961034 |
| `praxis-rohbau.jpg` | Handwerker am Rohbau | 11429201 |
| `portrait-meister.jpg` | Portrait Handwerksmeister | 7788227 |
| `ki-tablet-industrie.jpg` | Fachkraft mit Tablet (dunkler KI-Block) | 32845692 |
| `chef-buero.jpg` | Geschäftsführer am Schreibtisch | 10376252 |
| `plaene-dokumente.jpg` | Pläne & Dokumente am Tisch | 6615095 |
| `qualitaet-fenster.jpg` | Qualitätskontrolle / Aufmaß | 8293699 |
| `handwerk-detail.jpg` | Handwerk in Aktion (Trennschleifer) | 1216544 |

## Durch eigene Betriebsfotos ersetzen (empfohlen)
Diese Stockfotos sind als **austauschbare Platzhalter** gedacht. So tauscht man sie:
1. Eigenes Foto unter gleichem Dateinamen in diesen Ordner legen (gleiches Seitenverhältnis
   wählen: Hero/Bänder ~3:2 quer, Portrait ~2:3 hoch), oder neuen Namen wählen.
2. Bei neuem Namen die `<img src="/landing/…">`-Referenz in `public/landingpage.html` anpassen
   (und ggf. `og:image` im `<head>`).
3. `alt`-Text in `landingpage.html` an das neue Motiv anpassen.
4. Bilder vorher web-optimieren (Breite ~1280–1600 px, JPG/WebP, < ~250 KB).

Details zur Seitenstruktur: `docs/funktionen/landingpage.md`.
