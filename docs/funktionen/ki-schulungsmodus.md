# KI-Schulungsmodus (virtueller Cursor)
> Isabella zeigt Abläufe direkt in der Web-App: ein künstlicher Cursor bewegt sich zu echten Bedienelementen, hebt sie hervor und erklärt Schritt für Schritt – ohne den echten Mauszeiger zu steuern und ohne ungewollte Datenänderungen.

## Für Anwender

**Was kann die Funktion?**
Frag Isabella „Zeig mir, wie man ein Projekt anlegt“ – sie startet eine geführte Tour. Ein virtueller Cursor wandert zu den richtigen Stellen (Navigation, Button, Formularfelder), hebt sie dezent hervor und erklärt jeden Schritt in einer kleinen Sprechblase.

**Vier Modi:**
- **Erklären** – nur ansehen: Cursor, Highlight, Texte. Keine Datenänderung. (Modal/Seiten werden zum Zeigen geöffnet – das ist keine Datenänderung.)
- **Mitmachen** – du klickst selbst; Isabella erkennt automatisch, wenn der Schritt geklappt hat (z. B. das Formular sich öffnet) und geht weiter.
- **Demo** – wie Erklären, füllt aber klar markierte **DEMO‑Werte** in die Felder (nichts wird gespeichert).
- **Live** – echte Daten: Isabella legt am Schluss wirklich an, aber **nur nach ausdrücklicher Bestätigung** („Soll ich das Projekt jetzt wirklich anlegen?“) – mit Audit-Eintrag.

**Bedienung:** Isabella öffnen → fragen („wie lege ich ein Projekt an?“) → Modus wählen (Erklären/Mitmachen/Demo/Live) → mit „Weiter“/„Zurück“ durch die Schritte, „Beenden“ jederzeit möglich. Sichtbar in Hell/Dunkel/Augenschon, auf PC und iPad.

## Technik

**Komponenten**
- `src/lib/ai-tour.ts` – zentrale, datengetriebene **Tour-Engine** (Store + Tour-Katalog). Schritt-Felder: `id`, `targetTourId`, `text`, `action`, `navigateTo`, `waitFor`, `optional`, `requiresConfirmation`, `confirmText`, `demoValue`. Modi: `explain | coach | demo | live`. API: `startTour(id, mode)`, `nextStep()`, `prevStep()`, `endTour()`, `subscribeTour()`, `findTourEl()`.
- `src/components/ai/AiTourOverlay.tsx` – Orchestrator (Portal an `body`): dezente Abdunkelung mit Highlight‑Cutout, Cursor + Sprechblase, verfolgt das Ziel laufend (Modal/Scroll). Löst in Erklär-/Demo-Modus UI-Schritte (Modal öffnen) per **DOM-Klick auf das App-eigene Element** aus – **kein OS-Klick**. Live-Bestätigungsschritt klickt erst nach Bestätigung den echten Speichern-Button.
- `src/components/ai/AiDemoCursor.tsx` – virtueller Cursor (SVG), `pointer-events:none`, Theme-Token `var(--accent)`.
- `src/components/ai/AiTourBubble.tsx` – Sprechblase/Panel pro Schritt (klickbar), Fortschritt + Modus-Hinweis.
- Eingebunden global in `src/components/Layout.tsx` (neben `<Isabella/>`).

**Zielerkennung (keine Pixelkoordinaten!)**
Ziele werden **ausschließlich** über stabile `data-tour-id`-Attribute gefunden (`findTourEl`). Gesetzte Anker für die Tour „Projekt anlegen“: `project-nav` (Layout), `project-create-button` (Projects), sowie im `ProjectForm`-Modal `project-form-modal`, `project-form-customer`, `project-form-type`, `project-form-address`, `project-form-status`, `project-form-responsible`, `project-form-internal-note`, `project-form-save`. `waitFor` (z. B. `project-form-modal`) lässt die Tour warten, bis das Element sichtbar ist (Mitklick-Modus).

**Sicherheit**
Overlay-Schicht ist `pointer-events:none` (nur die Sprechblase ist klickbar) → die App bleibt bedienbar. Keine echten Datenänderungen ohne Bestätigung; der Live-Schritt schreibt einen Best-Effort-Audit-Eintrag in `ai_action_logs` (`action_level 3`, `confirmation_required`, `confirmed_at`). Demo-Daten sind als „DEMO – …“ gekennzeichnet. Die eigentliche Anlage nutzt die bestehende `ProjectForm`-Speicherlogik (keine zweite Geschäftslogik).

**Start durch Isabella**
`src/components/Isabella.tsx` erkennt Schulungs-Absichten lokal (`detectTourIntent`) und bietet die Modus-Auswahl an; zusätzlich kann das Backend-Tool `startTour` (in `api/ai/chat.js`) die Tour auslösen (Antwort-Typ `start_tour`). Isabella schließt sich beim Start, damit das Overlay frei sichtbar ist.

**Erweitern**
Neue Tour = Eintrag in `TOURS` (`ai-tour.ts`) + `data-tour-id` an den Zielelementen + ggf. `startTour`-Enum in `chat.js` und Intent in `detectTourIntent`. Texte/Schritte rein datengetrieben, später leicht erweiterbar.

**Verknüpfungen**
[ki-assistent-isabella.md](ki-assistent-isabella.md) · [projekte.md](projekte.md)

## Verfügbare Touren (Stand 2026-07-09)

| Tour-ID | Titel | Bereich |
|---|---|---|
| `project-create` | Projekt anlegen | Projekte |
| `marketing-post` | Social-Beitrag mit KI planen | Marketing |
| `eingangsrechnung-erfassen` | Eingangsrechnung erfassen | Buchhaltung |

Neue Tour ergänzen: (1) `data-tour-id` an den Ziel-Elementen setzen, (2) Definition in `src/lib/ai-tour.ts` (`TOURS`) anlegen,
(3) Tour-ID in `api/ai/chat.js` bei `TOUR_IDS` **und** im `startTour`-Tool-Enum registrieren.
Jeder Menüpunkt ist über `nav-<slug>` adressierbar (Ausnahme: Projekte = `project-nav`).
