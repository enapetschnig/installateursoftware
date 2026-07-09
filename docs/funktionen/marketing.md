# Marketing (Social-Beiträge & Werbeanzeigen)
> Redaktionsplanung für Facebook-/Instagram-Beiträge mit **echtem KI-Textvorschlag** und Live-Vorschau, plus Verwaltung von Werbekampagnen (Budget, Laufzeit, Zielgruppe, Ergebnisse).

## Für Anwender

**Was kann die Funktion?**
Unter **Marketing** (`/marketing`) gibt es vier Bereiche:
- **Übersicht** – Kennzahlen (geplante Beiträge, Reichweite, aktive Kampagnen, genutztes Werbebudget), die nächsten geplanten Beiträge und die Kampagnen-Leistung.
- **Redaktionsplan** – alle Beiträge als Liste oder **Monatskalender**. Filter nach Entwurf/Geplant/Veröffentlicht.
- **Werbeanzeigen** – Kampagnen mit Budget-Fortschritt, Laufzeit, Zielgruppe und Ergebnissen (Impressionen, Klicks, CTR, Anfragen, Kosten pro Anfrage).
- **Kanäle** – Verbindungszustand von Facebook, Instagram und Google Ads.

**Beitrag erstellen**
1. **Neuer Beitrag** → Thema in einem Satz beschreiben (z. B. „Vorher/Nachher Badsanierung in Linz, 9 Tage, bodengleiche Dusche").
2. Tonalität wählen → **Vorschlag erstellen**: Die KI schreibt Titel, Beitragstext, Hashtags und empfiehlt eine Uhrzeit.
3. Text anpassen, Kanäle (Facebook/Instagram) wählen, optional Bild und Link ergänzen.
4. Rechts läuft eine **Live-Vorschau**, die zeigt, wie der Beitrag für Kunden aussieht.
5. Status setzen: **Entwurf** → **Geplant** (mit Termin) → **Veröffentlicht**.

> **Wichtige Abgrenzung (ehrlich):** Die automatische Veröffentlichung auf Facebook/Instagram ist **noch nicht angebunden**. Alles andere funktioniert vollständig: texten (auch mit KI), planen, freigeben, im Kalender verwalten. Solange kein Kanal verbunden ist, ist „Veröffentlicht" ein **bewusster manueller Statuswechsel** – die App behauptet nie, etwas gepostet zu haben, was nicht gepostet wurde.

**Wichtige Einstellungen (pro Firma)**
Rechte über das Modul **`marketing`** (view/create/edit/delete/export/print, je Rolle vergebbar). Beitragsbilder liegen im privaten, mandantengetrennten Bucket **`marketing`**.

## Technik

**Routing & Rechte**
`/marketing` in `src/App.tsx` → `<Guard module="marketing"><Marketing/></Guard>`. Modul-Key `marketing` wird in Migration `0143` in `permission_modules` registriert. Nav-Eintrag in `src/components/Layout.tsx` (Sektion „Kommunikation"). Button-Gating via `useCan("marketing", <action>)`.

**Frontend**
- `src/pages/Marketing.tsx` – Seite mit vier Tabs, KPI-Kacheln, Redaktionsplan (Liste + `MonthCalendar`), Beitrags-Modal mit KI-Assistent und `PostPreview` (Facebook-/Instagram-Darstellung), Kampagnen-Karten + Kampagnen-Modal (inkl. Zielgruppe), Kanal-Karten.
- `src/lib/marketing.ts` – Typen, CRUD (`listPosts`/`createPost`/`updatePost`/`deletePost`, analog Kampagnen), Kanäle, Bild-Upload (`uploadPostImage`, `postImageUrl`), KI-Client (`generatePost`), Kennzahlen-Helfer.

**Serverless**
- `api/marketing/generate-post.js` – **echte** OpenAI-Generierung (`gpt-4o-mini`, JSON-Modus). Auth über User-JWT + Rate-Limit. Liefert `{title, content, hashtags[], best_time_hint}`, validiert/normalisiert. Der Prompt verbietet erfundene Preise, Zahlen, Auszeichnungen und Kundenstimmen. **Es wird nichts veröffentlicht.**

**Datenbank** (Migration `0143_marketing.sql`)
- **`public.social_posts`**: `id`, `organization_id`, `title`, `content`, `platforms text[]`, `status` (`entwurf|geplant|veroeffentlicht|archiviert`), `scheduled_at`, `published_at`, `image_path` (Bucket `marketing`), `link_url`, `hashtags text[]`, `ai_generated`, `campaign_id` (FK `ad_campaigns`), `project_id` (FK `projects`), `metrics jsonb` (`reach, likes, comments, shares, clicks`), `created_by`, Zeitstempel.
- **`public.ad_campaigns`**: `name`, `platform` (`facebook|instagram|google_ads`), `objective` (`reichweite|traffic|leads|conversions`), `status` (`entwurf|aktiv|pausiert|beendet`), `budget_total`, `budget_daily`, `start_date`, `end_date`, `target_audience jsonb` (`ort, radius_km, alter_von, alter_bis, interessen[]`), `metrics jsonb` (`impressions, clicks, leads, spend, ctr, cpl`), `notes`.
- **`public.social_accounts`**: `platform`, `account_name`, `status` (`nicht_verbunden|verbunden|fehler`), `external_id`, `connected_at`. UNIQUE `(organization_id, platform)`.
- **RLS** überall: permissive `*_app_all` + restrictive `*_org_isolation` (`organization_id = current_org_id()`).
- **Bucket `marketing`**: privat, 10 MB, `image/jpeg|png|webp`; org-isolierte Storage-Policies (`(storage.foldername(name))[1] = current_org_id()::text`), Pfad `<orgId>/posts/<datei>`. Anzeige über signierte URLs (`src/lib/storage.ts`).
- **Startinhalte**: Kanäle als `nicht_verbunden`, ein gefüllter Redaktionsplan und zwei Kampagnen als Ausgangsbeispiel (idempotent, nur wenn noch keine Daten vorhanden).

**Erweitern**
- **Echte Veröffentlichung**: `social_accounts` um OAuth-Token erweitern, Publish-Job (Cron) analog `api/mail/poll.js` bauen, der fällige `geplant`-Beiträge postet und `published_at` + `metrics` zurückschreibt. Erst dann darf `status='veroeffentlicht'` automatisch gesetzt werden.
- **Kennzahlen**: `metrics` per Insights-API nachladen statt manuell pflegen.
- **Mehr Kanäle**: `platform`-CHECK erweitern (LinkedIn ist in `social_accounts` bereits erlaubt).
- **Projektbezug**: `social_posts.project_id` erlaubt „Vorher/Nachher"-Beiträge direkt aus einem Projekt (Fotos aus `project-photos`).

**Verknüpfungen**
[email.md](email.md), [smartes-ki-postfach.md](smartes-ki-postfach.md), [rechte-rollen.md](rechte-rollen.md), [mandantenfaehigkeit.md](mandantenfaehigkeit.md), [sicherheit.md](sicherheit.md).
