# Sicherheitsbericht B4Y SuperAPP — 2026-06-19

Defensive Sicherheitsprüfung (OWASP Top 10 / ASVS, Supabase RLS, Vercel, Tenant-Isolation, RBAC, Datei-/PDF-Zugriff). Geprüft: Supabase (RLS aller Tabellen, Policies, RPCs, Storage, Advisor), Codebasis (`src/`, `api/`), Vercel-Konfiguration, Dependencies.

## Gesamteinschätzung

Solide Grundabsicherung: **RLS ist auf ALLEN 78 public-Tabellen aktiv**, zusätzlich liegt auf den sensiblen Tabellen eine **restriktive `org_isolation`-Policy** (Mandantentrennung greift unabhängig von den Frontend-Checks). Der **anon-Key ist nur im Client, der service_role-Key ausschließlich serverseitig** (api/), beide AI-Endpunkte erzwingen JWT-Auth und arbeiten unter dem User-Token (RLS greift). **0 npm-Vulnerabilities**, keine Source-Maps in Prod, keine Secret-Logs, keine Open-Redirects, Audit-Logs vorhanden.

Schwerpunkte für die Härtung: **ungeschützter PDF-Render-Endpunkt**, **öffentliche Storage-Buckets** mit sensiblen Projektmedien, **fehlende HTML-Sanitisierung (Stored-XSS)** und **fehlende RBAC auf `employees`/`documents`**.

---

## Funde

### P0 — Kritisch

**F-01 · API · `api/render-pdf.js` ohne Authentifizierung**
- Schweregrad: Kritisch · Quick-Fix: ja · Regressionsrisiko: mittel (Client muss Token mitsenden)
- Datei: `api/render-pdf.js` (Z. 15–54), Client: `src/lib/pdf.ts` (`htmlToPdfBlob`)
- Beschreibung: Der Endpunkt rendert **beliebiges, vom Aufrufer geliefertes HTML** zu PDF (PDFShift) — **ohne jede Auth-Prüfung**.
- Auswirkung: Offener PDF-Render-Proxy → fremder PDFShift-Kostenmissbrauch; SSRF-Effekt (PDFShift lädt im HTML referenzierte URLs serverseitig); DoS/Kosten.
- Empfehlung: Bearer-Token verlangen und via Supabase `/auth/v1/user` verifizieren (analog `api/ai/chat.js`). Client sendet `Authorization: Bearer <access_token>`.
- Test: Aufruf ohne Token → 401; mit gültigem Token → PDF; PDF-Vorschau/Download/Versions-PDF weiterhin ok.

**F-02 · Storage · Öffentliche + listbare Buckets `project-files` & `article-images`**
- Schweregrad: Kritisch · Quick-Fix: nein (Lesepfade auf signierte URLs umstellen) · Regressionsrisiko: hoch
- Belege: `storage.buckets.public = true` für beide; Advisor `public_bucket_allows_listing`; Client nutzt überall `getPublicUrl` (kein `createSignedUrl`): `src/lib/media.ts:129,141`, `src/lib/documents.ts:170`, `src/pages/ProjectDetail.tsx:1030`, `src/components/PhotoUpload.tsx:41`, `src/components/CompanySettings.tsx:50`, `src/components/BuakCalendar.tsx:119`.
- Beschreibung: `project-files` enthält Projektfotos/-videos/-dokumente/Logos. Der Bucket ist **öffentlich** → Dateibytes sind ohne Auth und ohne Ablauf abrufbar; SELECT-Policy erlaubt **Auflisten**. Die RLS auf der Tabelle `project_media` schützt nur die Metadaten, nicht die Dateibytes.
- Auswirkung: Vertraulichkeitsleck bei Projektmedien; bei echtem Mehrmandantenbetrieb mandantenübergreifender Dateizugriff über erratbare/geteilte URLs.
- Empfehlung: `project-files` auf **privat** + **signierte URLs mit Ablauf** umstellen. Logos in einen separaten öffentlichen `branding`-Bucket auslagern (Login-/PDF-Logo bleibt öffentlich). `article-images` Listing entfernen.
- Hinweis: Hoher Umbau (alle Lesepfade), daher Migrationsplan nötig — siehe „Umsetzungsplan“.
- Test: Direkter Bucket-URL ohne Auth → kein Zugriff; signierte URL läuft nach Ablauf ab; Foto-/PDF-Anzeige in App funktioniert weiter.

### P1 — Hoch

**F-03 · XSS · Rich-Text/Textbausteine & Signatur unsanitisiert (Stored-XSS)**
- Schweregrad: Hoch · Quick-Fix: ja (DOMPurify) · Regressionsrisiko: mittel
- Dateien: `src/components/document/printDocument.ts` (introHtml/prePositionsHtml/closingHtml/legalHtml roh in PDF-HTML), `src/pages/EmployeeDetail.tsx:497` (`dangerouslySetInnerHTML={{__html: signature_html}}`); Quellen: `RichTextEditor.tsx`, `src/lib/text-blocks.ts` (`blockHtml`, `applyPlaceholders`). Kein DOMPurify/sanitize-html in `package.json`.
- Auswirkung: Schädliches HTML/Script in Textbaustein/Angebotstext/Signatur wird im App-Origin (PDF-Vorschaufenster via `document.write`) bzw. im DOM ausgeführt → Stored-XSS.
- Empfehlung: DOMPurify einführen; Rich-Text/Textbaustein-HTML an allen Render-/PDF-Sinks und `signature_html` sanitisieren (idealerweise zusätzlich beim Speichern).
- Test: Textbaustein mit `<img onerror=…>`/`<script>` → wird beim PDF/Anzeige neutralisiert; normale Formatierung bleibt erhalten.

**F-04 · RBAC/RLS · `employees` ohne Rollen-/Rechteprüfung**
- Schweregrad: Hoch · Quick-Fix: ja (Policy) · Regressionsrisiko: mittel
- Beleg: Policy `app_all` `USING(true) WITH CHECK(true)` für ALL; nur restriktive `org_isolation` zusätzlich. Keine `employees`-Rechteprüfung (anders als contacts/offers/invoices, die per `b4y_has_permission` gaten).
- Auswirkung: Jeder authentifizierte Nutzer des Mandanten kann **alle Mitarbeiterdaten (Lohn/Personaldaten) lesen und ändern** — unabhängig von Rolle/Recht.
- Empfehlung: `app_all` durch rechtegeprüfte Policies ersetzen (`b4y_is_admin(uid) OR b4y_has_permission(uid,'employees',<view/create/edit/delete>)`). Modul `employees` existiert bereits.
- Test: Nutzer ohne `employees`-Recht → kein Lesen/Ändern; Admin → voller Zugriff.

**F-05 · RBAC/RLS · `documents` ohne Rollen-/Rechteprüfung**
- Schweregrad: Hoch · Quick-Fix: ja · Regressionsrisiko: mittel
- Beleg: `app_all USING(true)`; nur org_isolation + `hide_soft_deleted`. Kein `documents`-Recht-Gate.
- Auswirkung: Jeder authentifizierte Mandantennutzer kann generische Dokumente lesen/ändern/löschen ohne Rechteprüfung.
- Empfehlung: rechtegeprüfte Policies (`b4y_has_permission(uid,'documents',…)`), Soft-Delete-Schutz beibehalten.
- Test: wie F-04 mit Modul `documents`.

**F-06 · DB · anon-ausführbare SECURITY-DEFINER-RPCs (v. a. `next_document_number`)**
- Schweregrad: Hoch (Nummernkreis) / Mittel (Rest) · Quick-Fix: ja · Regressionsrisiko: niedrig
- Beleg: Advisor `anon_security_definer_function_executable` für `next_document_number`, `b4y_admin_count`, `b4y_is_admin`, `b4y_has_permission`, `current_org_id`, `handle_new_user`, `b4y_guard_*` u. a.
- Auswirkung: Nicht angemeldete Aufrufer können u. a. `next_document_number` aufrufen und **Nummernkreise „verbrennen“** (Lücken/DoS); Info-Leaks (`b4y_admin_count`).
- Empfehlung: `REVOKE EXECUTE … FROM anon` auf diesen Funktionen (für `authenticated` bleibt der Zugriff, RLS-Helper funktionieren weiter). `handle_new_user` ist ein Trigger — `anon`-EXECUTE entziehen.
- Test: anon-RPC → 401/permission denied; eingeloggte Doku-Erstellung vergibt weiter korrekt Nummern.

**F-07 · API · Kein Rate-Limiting (OpenAI/PDFShift Kostenmissbrauch)**
- Schweregrad: Hoch/Mittel · Quick-Fix: teilweise · Regressionsrisiko: niedrig
- Dateien: `api/ai/chat.js`, `api/ai/transcribe.js`, `api/render-pdf.js`.
- Empfehlung: einfaches Pro-User-Rate-Limit (z. B. Zähler in Tabelle/Upstash) + harte Obergrenzen; render-pdf nach F-01 zusätzlich auth-gebunden.

### P2 — Mittel

**F-08 · Headers · Fehlende Security-Headers** (`vercel.json` ohne `headers`): keine CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS. Empfehlung: sichere Header ergänzen; CSP vorsichtig (PDF-Viewer nutzt inline-Script/blob: in separaten Fenstern; Supabase/PDFShift in connect/img-src). Quick-Fix: ja (ohne CSP); CSP separat & getestet.

**F-09 · Storage · Keine Bucket-Limits + SVG-Logo-Upload** (`file_size_limit`/`allowed_mime_types` = null bei beiden Buckets; `CompanySettings.tsx:149` erlaubt SVG → script-fähig). Empfehlung: pro Bucket `file_size_limit` + `allowed_mime_types` setzen; SVG-Logo entweder verbieten oder serverseitig bereinigen. Quick-Fix: ja.

**F-10 · Upload · Inkonsistente Client-Validierung** (`PhotoUpload` ok; `ArticleForm.tsx`/`media.ts` ohne Größenlimit). Server/Bucket-Limit (F-09) ist die eigentliche Kontrolle. Quick-Fix: ja.

**F-11 · Auth · Leaked-Password-Protection deaktiviert** (Supabase Advisor). Empfehlung: in Supabase → Auth → Passwortschutz aktivieren (HaveIBeenPwned). Quick-Fix: ja (Dashboard-Toggle).

**F-12 · RLS · `OR organization_id IS NULL` in `org_isolation`** — NULL-org-Zeilen sind für alle Mandanten sichtbar/änderbar. Bewusste Übergangslösung der Single-Tenant-Phase; **vor echtem Mehrmandantenbetrieb** schließen (alle Zeilen mit `organization_id` befüllen, dann `IS NULL`-Klausel entfernen). Quick-Fix: nein (Datenmigration).

### P3 — Niedrig

- **F-13** `company_branding` SECURITY-DEFINER-View — exponiert nur `logo_url`/`icon_logo_url` (für Login), harmlos; optional auf `security_invoker` + Public-Read-Policy.
- **F-14** `function_search_path_mutable` (`prevent_delete_system_doctype`, `appointments_set_updated_at`) — `SET search_path = ''` ergänzen.
- **F-15** LLM-Tool-Argumente werden in PostgREST-Filter interpoliert (`api/ai/chat.js:157,163`) — durch RLS unter User-Token gemildert; UUIDs zusätzlich strikt validieren.
- **F-16** Hardcodierte anon-Key/Projektref-Fallbacks im Source — public-by-design, reine Hygiene.

---

## Was bereits gut ist (keine Aktion nötig)
RLS auf allen Tabellen + restriktive org_isolation; service_role nur serverseitig; AI-Endpunkte mit JWT-Auth + RLS unter User-Token; granulare RBAC auf projects/contacts/offers/orders/invoices/sub_orders/project_media (`b4y_has_permission`); Soft-Delete-Schutz + Audit-Logs (`document_audit_log`, `perm_audit_log`, `calc_audit_log`, `automation_runs`, `ai_*_logs`); transcribe mit MIME+Size-Validierung; keine Open-Redirects; keine Secret-Logs; 0 npm-Vulnerabilities; keine Prod-Source-Maps.

---

## Umsetzungsplan (priorisiert)

**Sofort & risikoarm (umsetzbar ohne Fachlogik-Bruch):**
1. F-06 — `REVOKE EXECUTE … FROM anon` (Migration).
2. F-03 — DOMPurify + Sanitisierung an PDF-/DOM-Sinks.
3. F-04/F-05 — RBAC-Policies für `employees`/`documents`.
4. F-09 — Bucket-Limits (Größe/MIME) + SVG-Logo restriktiver.
5. F-08 — sichere Security-Headers (ohne CSP) in `vercel.json`.
6. F-01 — Auth für `api/render-pdf.js` + Token im Client.

**Mit Migrationsplan / Rücksprache (höheres Regressionsrisiko):**
7. F-02 — `project-files` privat + signierte URLs (+ separater Logo-Bucket).
8. F-08 — vollständige CSP (getestet gegen PDF-Viewer/Supabase/PDFShift).
9. F-12 — `IS NULL`-Klausel vor Mehrmandantenbetrieb schließen.
10. F-11 — Leaked-Password-Protection im Dashboard aktivieren (manuell).

Alle DB-Änderungen als rückwärtskompatible Migration in `supabase/migrations/`, Admin-Zugriff bleibt über `b4y_is_admin` erhalten; nach jeder Änderung Build + Live-Gegenprobe.

---

## Umsetzungsstand (2026-06-19, Code)

Übersicht: [`funktionen/sicherheit.md`](funktionen/sicherheit.md).

| Fund | Status | Umsetzung |
|---|---|---|
| F-01 | ✅ behoben | `api/render-pdf.js` JWT-Auth + `429`-Rate-Limit; Client sendet Token (`src/lib/pdf.ts`). Gemeinsame Helfer `api/_lib/security.js`. |
| F-02 | ✅ Code, ⚠️ Migration + Logo-Neuupload | Migration `0064` (Buckets privat + öffentlicher `branding`-Bucket). Lesepfade über signierte URLs (`src/lib/storage.ts`, `src/components/SignedImage.tsx`). Logo einmal neu hochladen. |
| F-03 | ✅ behoben | DOMPurify (`src/lib/sanitize.ts`) an allen Rich-Text-/Signatur-Sinks. `dompurify` in `package.json`. |
| F-04/F-05 | ✅ Code, ⚠️ Migration | RBAC-Policies `employees`/`documents` (Migration `0061`). |
| F-06 | ✅ Code, ⚠️ Migration | `REVOKE … FROM anon` (Migration `0062`). |
| F-07 | ✅ behoben | Pro-User-Rate-Limit (20/Min) auf chat/transcribe/render-pdf. |
| F-08 | ✅ behoben | Security-Header in `vercel.json` (ohne CSP). |
| F-11 | 📝 Dashboard | Hinweis in `0062`: HaveIBeenPwned manuell aktivieren. |
| F-12 | ✅ Code, ⚠️ Migration | Frontend-Queries ohne `org_id IS NULL`. Policy-NULL-Klausel-Schließung als geschützte Migration `0063` (läuft nur bei genau 1 Org). |

**Wichtig:** Migrationen `0061`–`0064` müssen noch auf Supabase angewendet werden (in dieser Sitzung kein Supabase-MCP verbunden). Reihenfolge: `0061`, `0062`, `0063` (optional/Single-Tenant), `0064`. Danach: Logo neu hochladen, Foto-/PDF-/Dokumentanzeige live gegenprüfen, anon-RPC-Sperre testen.

Offen (nicht Teil dieser Runde): F-09, F-10, F-13–F-16.
