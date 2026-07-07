# Azure App Registration für b4y SuperAPP – Anleitung für IT-Admin

**Empfänger:** IT-Administrator mit Azure-Portal-Zugriff
**Zweck:** Microsoft 365 Email-Integration (Lesen + Senden) in der b4y SuperAPP
**Zeitaufwand:** ca. 15 Minuten
**Sicherheits-Level:** Multi-Tenant SaaS-App mit Delegated Permissions (kein App-Permission, kein Zugriff auf Mailboxen ohne explizite User-Einwilligung)

---

## Was wird benötigt zurück an Lukasz / Entwicklung

Nach dem Setup brauchen wir **drei Werte**:

1. **Application (client) ID** – sichtbar im "Overview"-Tab (UUID-Format, z.B. `b1234567-89ab-cdef-0123-456789abcdef`)
2. **Client Secret Value** – wird **NUR EINMAL** angezeigt nach Erstellung; muss sicher übermittelt werden (1Password, KeePass, verschlüsselte Mail)
3. **Tenant-Bestätigung** – dass die App als **Multi-Tenant** ("Accounts in any organizational directory") registriert wurde

---

## Schritt-für-Schritt-Anleitung

### Schritt 1 – Anmelden und zur App-Registrierung navigieren

1. Im Browser: https://portal.azure.com aufrufen
2. Mit IT-Admin-Account anmelden (Global Administrator oder Application Administrator)
3. Im Such-Feld oben: **"App registrations"** eingeben → Eintrag mit Icon anklicken
4. Oben links auf **`+ New registration`** klicken

### Schritt 2 – Registrierungs-Formular ausfüllen

Im "Register an application"-Formular:

| Feld | Wert |
|---|---|
| **Name** | `b4y SuperAPP` |
| **Supported account types** | **`Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)`** ⚠ wichtig — nicht "Single tenant"! |
| **Redirect URI – Platform** | `Web` |
| **Redirect URI – URL** | `https://b4y-superapp.app/api/auth/microsoft-callback` |

> 📝 **Hinweis zur Account-Type-Auswahl:** Wir brauchen Multi-Tenant, weil mehrere unabhängige Firmen die App nutzen werden — jede Firma hat ihre eigene Microsoft-365-Umgebung. Single-Tenant würde das verhindern.

Unten auf **`Register`** klicken.

### Schritt 3 – Application (Client) ID notieren

Nach Erstellung landest du im "Overview"-Tab der neuen App. Hier:

- **`Application (client) ID`** kopieren — das ist Wert #1 für Lukasz.
- (Optional: auch die `Directory (tenant) ID` kopieren — wir brauchen sie nicht, aber sie ist hilfreich für die Doku.)

### Schritt 4 – API Permissions setzen

Linke Seitenleiste der App → **`API permissions`** → **`+ Add a permission`**:

1. Im Picker: **`Microsoft Graph`** auswählen
2. **`Delegated permissions`** (nicht "Application permissions"!)
3. In der Suche **diese 7 Permissions einzeln finden und ankreuzen**:

   | Permission | Zweck |
   |---|---|
   | `offline_access` | Refresh-Tokens (sonst muss User alle 60 Min neu einloggen) |
   | `openid` | OpenID-Connect-Standard |
   | `profile` | Basis-Profilinformationen (Name) |
   | `email` | E-Mail-Adresse des Users |
   | `User.Read` | UPN + Mailbox-Adresse abrufen |
   | `Mail.Read` | Inbox lesen (für die App-interne Inbox-Ansicht) |
   | `Mail.Send` | Emails im Namen des Users senden (z.B. Angebote) |

4. Unten auf **`Add permissions`** klicken
5. **WICHTIG:** Im API-permissions-Tab nun oben auf **`Grant admin consent for <Tenant-Name>`** klicken — und bestätigen.
   - Falls dieser Button **nicht** klickbar ist: dein Account hat keine Admin-Consent-Berechtigung. Bitte einen Global Admin den Schritt durchführen lassen.

> 🛡️ **Sicherheit:** Wir nutzen ausschließlich **Delegated Permissions**, NICHT Application Permissions. Das bedeutet:
> - Die App kann NUR auf das Postfach zugreifen, in dessen Namen ein User explizit zugestimmt hat.
> - KEIN administrativer Zugriff auf alle Postfächer der Organisation.
> - Jeder einzelne User in einer Kundenfirma muss separat "Verbinden" klicken und sein eigenes Microsoft-Login durchgehen.

### Schritt 5 – Client Secret erstellen

Linke Seitenleiste → **`Certificates & secrets`** → Tab **`Client secrets`** → **`+ New client secret`**:

| Feld | Wert |
|---|---|
| **Description** | `b4y SuperAPP Production` |
| **Expires** | `24 months` (Maximum; danach Rotation – Erinnerung in Kalender setzen!) |

Auf **`Add`** klicken.

> ⚠️ **WICHTIG:** Der Wert in der Spalte **"Value"** wird **NUR JETZT EINMAL** angezeigt. Sobald du die Seite verlässt, ist der Wert weg und ein neues Secret muss erstellt werden.
>
> **Jetzt sofort:**
> 1. Den **"Value"** kopieren (NICHT die "Secret ID"!)
> 2. In ein Passwort-Tool (1Password, KeePass, Bitwarden) ablegen mit Label `b4y SuperAPP Client Secret`
> 3. An Lukasz übermitteln über sicheren Kanal (verschlüsselte Mail, Passwort-Manager-Share, NICHT Slack-Klartext)

### Schritt 6 – Authentication-Konfiguration prüfen

Linke Seitenleiste → **`Authentication`**:

Prüfen, dass folgende Werte gesetzt sind:

- **Platform configurations / Web / Redirect URIs:**
  - `https://b4y-superapp.app/api/auth/microsoft-callback` ✅
  - `https://b4y-superapp.vercel.app/api/auth/microsoft-callback` nur optional als alte Uebergangs-/Fallback-URI; der produktive Vercel-Env-Wert muss auf die `.app`-Domain zeigen.

- **Implicit grant and hybrid flows:**
  - Beide Checkboxen (`Access tokens` und `ID tokens`) **NICHT** angekreuzt — wir nutzen Authorization Code Flow mit PKCE.

- **Supported account types:**
  - Sollte auf `Accounts in any organizational directory and personal Microsoft accounts` ODER `Accounts in any organizational directory (Multitenant)` stehen.
  - Falls "Single tenant" hier steht: das war beim Setup falsch konfiguriert — bitte umstellen. Falls Azure das nicht erlaubt: neue App-Registrierung mit korrektem Typ.

- **Advanced settings → Allow public client flows:** `No` (Default, beibehalten)

### Schritt 7 – Bestätigung an Lukasz

Sende per sicherem Kanal:

```
Subject: Azure App Registration "b4y SuperAPP" fertig

1. Application (client) ID:
   <hier den UUID einfügen>

2. Client Secret Value (sensibel — bitte sicher speichern):
   <hier den Secret-Value einfügen>

3. Tenant-Type bestätigt:
   Multi-Tenant ("Accounts in any organizational directory")

4. Admin Consent gegeben:
   Ja, für alle 7 Permissions (offline_access, openid, profile, email,
   User.Read, Mail.Read, Mail.Send)

5. Optional - Directory (tenant) ID der Setup-Organisation:
   <UUID, nur zur Dokumentation>

6. Client Secret läuft ab am:
   <Datum + 24 Monate; Erinnerung im Kalender setzen für Rotation>
```

---

## Zusätzliche Optionale Schritte (später, wenn die Integration produktiv läuft)

### Branding (für den Microsoft-Consent-Screen)

Linke Seitenleiste → **`Branding & properties`**:

- **Publisher domain:** verified Domain eintragen (z.B. `bau4you.at`)
- **Logo:** 240x240 px PNG des b4y-Logos hochladen
- **Privacy statement URL:** Link zur b4y-Datenschutzerklärung
- **Terms of service URL:** Link zur b4y-AGB

Das verbessert den Vertrauenseindruck beim ersten OAuth-Consent.

### Publisher Verification

Wenn die App von vielen externen Firmen genutzt wird, kann eine Publisher Verification beantragt werden. Reduziert "Unverified Publisher"-Warnungen im Consent-Screen. Voraussetzung: MPN-Account (Microsoft Partner Network).

### Redirect URIs für Preview/Dev

Falls Preview-Branches getestet werden sollen, können weitere Redirect URIs hinzugefügt werden. Aktuell pflegen wir aber nur Production. Lokale Entwicklung läuft über Vercel-Dev-Mode mit `localhost:5173` — falls nötig, gibt Lukasz Bescheid.

---

## Häufige Fragen

**F: Kann die App auch ohne Admin-Consent installiert werden?**
A: Ja — wenn keine Permission "Admin-only" markiert ist. Unsere 7 Permissions sind alle "User can consent" — d.h. jeder einzelne User kann beim ersten Verbinden selbst zustimmen, ohne dass ein Admin involviert sein muss. Der Admin-Consent in Schritt 4 ist eine Optimierung (User sieht die Permissions nur einmal angezeigt statt jeden einzelnen abnicken zu müssen).

**F: Was passiert wenn der Client Secret abläuft?**
A: Bestehende User-Tokens funktionieren weiter, ABER neue Refreshes scheitern. User müssten sich neu verbinden. Daher: 60 Tage vor Ablauf rotieren. Lukasz erinnert.

**F: Kann ich die App löschen?**
A: Ja, aber dann sind ALLE User in ALLEN Firmen ausgesperrt und müssten neu verbinden. Nur in Absprache mit Lukasz.

**F: Welche Daten sieht die App?**
A: Nur die Daten der User die explizit zugestimmt haben. Pro User: dessen Inbox + Send-API. KEIN Zugriff auf Kalender, OneDrive, Teams, SharePoint oder andere User in derselben Org.

**F: Wo werden die Tokens gespeichert?**
A: In der b4y-Supabase-Datenbank (Region Frankfurt), verschlüsselt mit XChaCha20-Poly1305 (libsodium), Schlüssel liegt in Vercel-Environment (nicht in DB). Tokens sind pro User durch Row-Level-Security isoliert.

---

## Sicherheits-Checkliste (Verifikation nach Setup)

- [ ] App ist als **Multi-Tenant** registriert (nicht Single-Tenant)
- [ ] Produktive Redirect-URI ist genau `https://b4y-superapp.app/api/auth/microsoft-callback`
- [ ] Vercel Production Env `MICROSOFT_REDIRECT_URI` zeigt ebenfalls exakt auf `https://b4y-superapp.app/api/auth/microsoft-callback`
- [ ] **Implicit grant** ist DEAKTIVIERT (kein Häkchen bei "Access tokens" oder "ID tokens")
- [ ] **Delegated Permissions** statt Application Permissions
- [ ] Genau 7 Permissions (siehe oben), nicht mehr und nicht weniger
- [ ] **Admin Consent** wurde gegeben (Status "Granted for <Tenant>")
- [ ] Client Secret ist in Passwort-Manager + an Lukasz übermittelt
- [ ] Erinnerung zur Secret-Rotation in 22 Monaten ist im Kalender

---

## Datenschutz / DSGVO

Die b4y SuperAPP arbeitet als **Auftragsverarbeiter** (gemäß Art. 28 DSGVO) für die Mail-Daten der User. Der Auftraggeber ist die jeweilige Firma die die App nutzt. Microsoft tritt als Unterauftragsverarbeiter auf (Microsoft Services Agreement deckt DSGVO ab, EU-Region).

Datenflüsse:
- **OAuth-Tokens:** Frankfurt (Supabase EU)
- **Email-Versand:** über Microsoft Graph (Microsoft-EU-Datacenter, vom User-Account abhängig)
- **Audit-Log:** Frankfurt (nur Metadaten + 500 Zeichen Body-Vorschau, kein vollständiger Email-Inhalt)

Der Auftragsverarbeitungsvertrag (AVV) zwischen Endkunden-Firma und b4y wird separat geschlossen — nicht Teil dieser Azure-Konfiguration.

---

## Bei Problemen

- Lukasz Baranowski (User-Owner)
- Dev: Christoph Napetschnig
- Vercel-Projekt: https://vercel.com/MUSHLUKASZ/b4y-superapp
- GitHub: https://github.com/MUSHLUKASZ/b4y-superapp

Falls beim Setup unklar: bitte **stopp und nachfragen**, lieber 5 Minuten Klärung als ein Fehler den wir später mühsam suchen.
