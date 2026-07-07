# KI-Assistent (Isabella)

> Sprach- und Chat-Assistent in der App – hilft bei Organisation, Texten und einfachen Aktionen.

## Für Anwender

„Isabella" ist der eingebaute KI-Assistent: per Text oder Spracheingabe Fragen stellen, Texte formulieren, Informationen finden, einfache Aktionen anstoßen. Spracheingabe wird transkribiert und beantwortet.

**Bedienung**: Assistent im UI öffnen, tippen oder Mikrofon nutzen. Das Eingabefeld ist **mehrzeilig und wächst automatisch** mit (max. Höhe + interner Scroll); **Enter** sendet, **Shift+Enter** macht eine neue Zeile; der Senden-Pfeil bleibt dauerhaft erreichbar. Der Floating-Button ist **dragbar bis nahe an alle Bildschirmränder** (Stand 2026-07-06; begrenzt nur durch die Button-Größe + kleiner Randabstand) und speichert seine Position im Browser lokal – sie bleibt nach einem Reload erhalten und wird bei geänderter Fenstergröße automatisch in den sichtbaren Bereich zurückgeholt. Das Chat-Panel öffnet unter dem Button; ist dort zu wenig Platz (Button nahe der Unterkante), öffnet es **über** dem Button und bleibt immer vollständig im Viewport. KI-Verhalten/Schlüssel werden serverseitig verwaltet; Nutzung wird protokolliert. Isabella kann zusätzlich **Abläufe direkt in der App vorführen** (KI-Schulungsmodus, virtueller Cursor) – siehe [ki-schulungsmodus.md](ki-schulungsmodus.md).

## Technik

**Komponenten & Endpunkte**
`src/components/Isabella.tsx`; Backend `api/ai/*` (`transcribe`, `chat`). API-Key **serverseitig** (nie im Client); Fallback auf Claude-Assistent.

**Floating-Button & Navigation (Stand 2026-07-06)**
- Position im `localStorage`-Key **`b4y-isabella-position`** (`{x,y}`); beim Laden **und** bei `resize` per `clampPosition()` auf die Button-Maße (56 px + 8 px Rand) begrenzt – nicht mehr auf Panel-Maße, dadurch ist die rechte untere Ecke erreichbar. Panel-Platzierung über `panelPlacement()` (unter dem Button, bei Platzmangel darüber; dynamische `maxHeight` hält es im Viewport).
- Navigation (`goto()`, z. B. „öffnen"-Aktionen und Dokumentketten-Ergebnisse) läuft über **React Router `useNavigate`** (BrowserRouter, basename `/app`) – die alte Hash-Navigation war wirkungslos. Beleg-Routen über `docPath()` (sprechende Nummer, UUID-Fallback). Der Chat-Kontext (`deriveContext()`) und die Transcribe-Route kommen aus `location.pathname` statt aus dem Hash.

**Datenbank – exakte Felder**

- **`ai_settings`**: `id, org_id, active, allowed_modules(ARRAY), auto_suggestions, language, provider, model, api_key, system_prompt, created_at, updated_at`
- **`ai_usage_logs`**: `id, organization_id, user_id, action_type, model, provider, input_length, output_length, tokens_input, tokens_output, cost_estimate, context_type, route, success, error, created_at`
- **`ai_action_logs`**: `id, organization_id, user_id, user_input_summary, tool_name, tool_arguments_summary, action_level, target_type, target_id, status, confirmation_required, confirmed_at, error_message, created_at`
- **`ai_logs`**: `id, org_id, user_id, module, context_id, context_type, action, prompt, response, adopted, created_at`

**Zentrale Logik**
Spracheingabe → `api/ai/transcribe`; Chat → `api/ai/chat` (OpenAI `gpt-4o-mini`, Key serverseitig; Fallback Edge-Function `ai-assistant`). Tool-/Function-Calling: Lese-/Navigations-Tools (suchen/öffnen/`navigateTo`) laufen serverseitig **mit dem User-JWT → Supabase-RLS erzwingt Mandantentrennung**; `service_role` wird **ausschließlich fürs Logging** genutzt, nie für Datenzugriff. Dokumentketten (Angebot→Auftrag→Rechnung) nur über die Vorschau-Tools (`continueOfferToOrderPreview`/`continueOrderToInvoicePreview`) → bestätigungspflichtig, die Ausführung nutzt zentrale `src/lib/document-chain.ts`. `startTour` startet den Schulungsmodus.

**Sicherheitsstufen (`action_level`, Integer in `ai_action_logs`)**: 1 Lesen/Suchen/Navigieren (ohne Bestätigung) · 2 Texte/Entwürfe vorbereiten (nur Chat-Vorschau, **kein** DB-Write) · 3 Datenänderungen (Status/Zuständigkeit/Termine) · 4 finanzielle/finalisierende Dokumentaktionen · 5 Löschen/Storno/Senden/Rechte · 6 Admin/Security/Mandant/Nummernkreise. Ab Stufe 3 nur mit ausdrücklicher Bestätigung; schreibende/sendende/löschende Aktionen sind **nicht** als ausführbare Tools freigegeben (nur Vorschau + Nutzerbestätigung). Audit in `ai_action_logs` (Level + `confirmation_required` + `confirmed_at`), Nutzung/Kosten in `ai_usage_logs`. Rate-Limit pro Nutzer in `api/_lib/security.js`.

**Erweitern**
Neue KI-Aktionen serverseitig in `api/ai/chat.js` als Tool kapseln (Key bleibt am Server, User-JWT für Datenzugriff). Lesen = Level 1, Entwürfe = Level 2 (nur Chat), echte Änderungen = Vorschau-Tool + Bestätigung (≥3) + Audit. Keine erfundenen Daten/Preise – Vorschläge immer aus echten Stammdaten. Datenschutz: keine sensiblen Daten unnötig an externe Modelle; Protokolle/Settings je Mandant (`org_id`/`organization_id`).

**Verknüpfungen**
[ki-schulungsmodus.md](ki-schulungsmodus.md) · [automationen.md](automationen.md) · [dokumentketten.md](dokumentketten.md) · [einstellungen.md](einstellungen.md)
