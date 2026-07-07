# E-Mail (Microsoft 365 / Outlook)
> E-Mail-Modul mit **echter Microsoft-Graph-Anbindung** (Stand 2026-07-06): Lesen, Beantworten, Weiterleiten und Senden über das verbundene Microsoft-365-Konto. Ohne Verbindung zeigt die Seite einen Connect-Leerzustand (kein Demo-Mock mehr).

## Für Anwender

**Was kann die Funktion?**
Unter **E-Mail** (`/email`) verbindet jeder Benutzer sein eigenes Microsoft-365-Konto (OAuth, „Mit Microsoft verbinden"). Danach: links **Ordner** (Posteingang, Gesendet, Entwürfe) + Filter, in der Mitte die **Nachrichtenliste** (Suche, Auto-Aktualisierung alle 60 s, Nachladen), rechts der **Lesebereich** (sicher gerenderter Inhalt, Anhänge herunterladbar). **Antworten / Allen antworten / Weiterleiten / Neue E-Mail** öffnen den Compose-Dialog; Versand erfolgt echt über Microsoft.

In der **Topbar** zeigt das Brief-Symbol die Zahl der ungelesenen Posteingangs-Mails (nur bei verbundenem Konto und `email`-Recht); ohne Verbindung erklärt das Panel den Zustand und verlinkt zur E-Mail-Seite.

**Wichtige Grenze:** Ohne verbundenes Microsoft-Konto gibt es keine Mail-Funktionen und keine Zähler – es werden keine Fake-Daten angezeigt.

## Technik

**Routing & Rechte**
`/email` in `src/App.tsx` → `<Guard module="email"><Email/></Guard>`. Permission-Modul **`email`**; ohne Recht weder Nav-Eintrag noch Topbar-Mail-Indikator.

**Frontend**
- `src/pages/Email.tsx` (Orchestrator: Verbindung, Ordner/Filter/Auswahl, Reply/Forward-Zitate, Compose).
- `src/components/email/`: `MailFolders`, `MailList`, `MailPreview` (Sandbox-Iframe + `sanitizeHtml`), `ComposeDialog`, `ConnectEmptyState`.
- Hooks: `src/hooks/useMicrosoftConnection.ts` (Status/Connect/Disconnect über `/api/auth/microsoft-*`), `src/hooks/useMicrosoftMail.ts` (`useMailList` mit Debounce-Suche, 60-s-Auto-Refresh, LoadMore; `useMailDetail`).
- Client: `src/lib/microsoft/mailClient.ts` (`fetchMailList/fetchMailDetail/sendMail/fetchMailAttachment`, Typen `MailListItem`/`MailDetail`; 401 → „Nicht angemeldet").
- Topbar-Indikator: `src/components/TopbarIndicators.tsx` (ungelesene = `isRead=false` der zuletzt geladenen Inbox-Seite).

**Backend (Vercel-Functions, Token NIE im Browser)**
`api/auth/microsoft-link|callback|status|unlink.js` (OAuth-Flow, Token verschlüsselt serverseitig gespeichert, `api/_lib/encryption.js`), `api/microsoft/mail-list|mail-detail|mail-attachment|mail-send.js` (Graph-Proxy mit Supabase-Bearer-Auth). Audit: `microsoft_mail_audit_log` (Migr. 0123).

**Sicherheit**
HTML-Mailinhalt nur über `sanitizeHtml()` (DOMPurify) im Sandbox-Iframe. Keine Secrets/Token im Frontend; Graph-Aufrufe laufen ausschließlich über die eigenen `/api/*`-Endpunkte mit Supabase-Auth. Mandantentrennung: Verbindung ist pro Benutzer.

**Erweitern**
Neue Mail-Aktion = Endpunkt unter `api/microsoft/` + Client-Funktion in `mailClient.ts` + UI-Aktion. Ordnerumfang erweitern über `FOLDER_TO_GRAPH` (mailClient) + Backend-Whitelist. Composer-Vorbelegung kann `renderTemplate`/`loadTemplatesByContext` aus [textbausteine.md](textbausteine.md) nutzen.

**Verknüpfungen**
[textbausteine.md](textbausteine.md) · [rechte-rollen.md](rechte-rollen.md) · [sicherheit.md](sicherheit.md) · [einstellungen.md](einstellungen.md) · [azure-app-setup-itler.md](azure-app-setup-itler.md)
