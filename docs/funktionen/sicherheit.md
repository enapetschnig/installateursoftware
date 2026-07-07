# Sicherheit & Härtung
> Übergreifende Sicherheitsmechanismen: API-Auth, Rate-Limit, RBAC, private Storage-Buckets mit signierten URLs, HTML-Sanitisierung, Security-Header.

## Für Anwender
**Was bedeutet das?** – Vertrauliche Daten (Projektfotos, Mitarbeiter-/Lohndaten, Dokumente) sind technisch geschützt: nur angemeldete Nutzer mit passender Rolle sehen/ändern sie, Dateien sind nicht mehr über offene Links abrufbar, und schädliche Inhalte in Texten werden neutralisiert.

**Was ändert sich spürbar?**
- Das **Firmenlogo** muss nach dem Sicherheits-Update **einmal in den Einstellungen neu hochgeladen** werden (es wandert in den öffentlichen Branding-Speicher; bis dahin zeigt die App das Standard-Logo).
- Bild-/Datei-Links laufen jetzt über zeitlich begrenzte, signierte Adressen (für Nutzer transparent).

## Technik

**API-Endpunkte (`api/`)**
- `api/render-pdf.js`, `api/ai/chat.js`, `api/ai/transcribe.js` verlangen ein gültiges **Supabase-JWT** (`Authorization: Bearer <token>`) → sonst `401`. Gemeinsame Helfer in [`api/_lib/security.js`](../../api/_lib/security.js): `verifyUser(token)`, `checkRateLimit(userId)` (In-Memory, 20 Anfragen/Min/User → sonst `429`). Client sendet das Token via `supabase.auth.getSession()` (siehe `src/lib/pdf.ts`, `src/lib/ai.ts`).

**RBAC / RLS**
- `employees` und `documents` sind über `b4y_is_admin(uid) OR b4y_has_permission(uid,'<modul>','<aktion>')` gegated (Migration `0061`), Muster identisch zu `orders`/`sub_orders`. Die frühere `app_all`-Policy (`USING(true)`) ist entfernt. Restriktive `org_isolation` + `hide_soft_deleted` bleiben AND-verknüpft aktiv. Details: [rechte-rollen.md](rechte-rollen.md).
- Sensible SECURITY-DEFINER-Funktionen sind für `anon` gesperrt (Migration `0062`): `next_document_number`, `b4y_admin_count`, `b4y_is_admin`, `b4y_has_permission`, `current_org_id`, `handle_new_user`, `b4y_guard*` – `authenticated` behält Zugriff.

**Storage – private Buckets + signierte URLs**
- `project-files` und `article-images` sind **privat** (Migration `0064`). Dateibytes nur noch über zeitlich begrenzte signierte URLs.
- Zentrale Helfer in [`src/lib/storage.ts`](../../src/lib/storage.ts): `storagePath(bucket, urlOderPfad)` (verarbeitet Alt-URLs **und** Pfade), `signedUrl(...)` (gecacht), `useSignedUrl(...)`-Hook, `openSignedUrl(...)`. Komponente [`src/components/SignedImage.tsx`](../../src/components/SignedImage.tsx) für `<img>`.
- **Logos** liegen im **öffentlichen** Bucket `branding` (Login-Seite vor Auth + PDF-Einbettung); `CompanySettings.tsx` lädt dorthin.

**HTML-Sanitisierung (Stored-XSS)**
- Zentral [`src/lib/sanitize.ts`](../../src/lib/sanitize.ts) (`sanitizeHtml`) auf Basis DOMPurify. Angewendet an allen Rich-Text-/Textbaustein-Sinks: `printDocument.ts` (intro/prePositions/closing/legal), `EmployeeDetail.tsx` (Signatur), `RichTextEditor.tsx`, `MailTemplatesManager.tsx`.

**Security-Header** – in [`vercel.json`](../../vercel.json): `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy` (`camera=(self), microphone=(self), geolocation=()` – Kamera/Mikro bleiben für Foto-/Videoaufnahme & Spracheingabe nutzbar) sowie eine **Content-Security-Policy (CSP)**. Die CSP beschränkt u. a. `connect-src` auf `'self'`, Supabase (`*.supabase.co`, `*.functions.supabase.co`) und `https://api.open-meteo.com` (Wetter). **Neue externe Fetch-/WebSocket-Ziele müssen dort ergänzt werden**, sonst blockiert der Browser sie.

**Erweitern**
- **Jede neue Storage-Anzeige** aus `project-files`/`article-images` → `SignedImage`/`useSignedUrl`/`signedUrl` nutzen, NIE `getPublicUrl` zur Anzeige. Schreiben (`upload`) darf den `getPublicUrl`-String weiter als stabilen Referenzwert speichern – die Anzeige löst ihn auf.
- **Jede neue HTML-Ausgabe** von Nutzerinhalten → durch `sanitizeHtml()` leiten.
- **Neue API-Route** → `verifyUser` + `checkRateLimit` aus `api/_lib/security.js` voranstellen.
- **Neue Tabelle mit sensiblen Daten** → RBAC-Policies nach `0061`-Muster + `org_isolation`.
- **Neuer externer Fetch-/WebSocket-Endpunkt** (z. B. weitere API) → Domain in der CSP `connect-src` (`vercel.json`) ergänzen, sonst Browser-Block. Keine Wildcard-Lockerung; nur die konkrete Domain aufnehmen.

**Behoben (Migration 0080, 2026-06-23):** Die globale Tabelle `appointments` (Planung/Termine) hatte SELECT `using(true)` und keine `org_isolation` → org-übergreifend lesbar. `appointments` hat bereits eine Org-Spalte `org_id`; Migration 0080 setzt `org_id`-Default = `current_org_id()` und ergänzt eine **restriktive `org_isolation`-Policy** (`for all using/with check (org_id = current_org_id())`), konsistent zu `project_appointments`. Tabelle war leer → kein Backfill/Datenverlust. Mandantentrennung damit auch hier durchgesetzt.

**Verknüpfungen** – [rechte-rollen.md](rechte-rollen.md), [mandantenfaehigkeit.md](mandantenfaehigkeit.md), [pdf-engine.md](pdf-engine.md), [mitarbeiter.md](mitarbeiter.md), Audit: [`../security-audit-2026-06-19.md`](../security-audit-2026-06-19.md).
