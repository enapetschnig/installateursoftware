# Rechte & Rollen
> Schlankes, rein rollenbasiertes RBAC mit Datenbank-Absicherung (RLS). Keine Pro-User-Ausnahmen.

## Für Anwender
Wer was sehen/tun darf, steuert ein frei definierbares **Rollensystem**. Eine Rolle bündelt Rechte je Modul (Aktionen wie ansehen/erstellen/bearbeiten/löschen), einen optionalen Datenbereich (Scope) je Modul sowie Sichtbarkeits-Einstellungen (archivierte/gelöschte Daten sehen, wiederherstellen, Standard-Projekt-Sichtbarkeit). Jeder Mitarbeiter bekommt **genau eine Rolle** – es gibt keine getrennten „Mitarbeiterrechte" mehr. Standardrollen sind als Vorlage geseedet und frei änderbar/kopierbar/löschbar; eine Rolle mit „Vollzugriff" (Administrator) darf alles.

**Bedienung**: Einstellungen → Zugriffsrechte mit vier Reitern:
1. **Rollen** – Liste + voller Editor: Stammdaten, Vollzugriff, Sichtbarkeit, Rechte nach Gruppen (inkl. Dokumente & Auswertungen) + Datenbereich/Scope.
2. **Rollenzuweisung** – Mitarbeiter → eine Rolle (auch im Mitarbeiter-Detail möglich).
3. **Ansicht als** – zeigt die effektiven (rein rollenbasierten) Rechte eines Mitarbeiters zum Test.
4. **Protokoll** – DB-seitiges Audit aller Rollen-/Rechteänderungen.

## Technik

**Komponenten**: `src/components/access/AccessControl.tsx` (4 Panels: RolesPanel + RoleEditor, AssignPanel, PreviewPanel, AuditPanel). Hook `usePermissions()` → `can(moduleKey, action)`, `isAdmin`, `scope(moduleKey)`, `access` (rollenbasierte Sichtbarkeits-Flags). Rollenzuweisung zusätzlich in `src/pages/EmployeeDetail.tsx`.

**Datenbank – exakte Felder (Basis Migr. 0006–0009, vereinfacht in Migr. 0106)**
- **`roles`**: `id, key, name, description, is_system, is_admin, active, organization_id, see_archived, see_deleted, restore_deleted, default_project_scope` — die vier letzten Flags (seit 0106) führen die Sichtbarkeit/Standard-Scope **rollenbasiert**.
- **`permission_modules`**: `id, key, label, group_key, parent_key, supports_scope, actions(ARRAY), is_system, active, sort_order`
- **`permission_groups`**: `id, key, label, sort_order` (u. a. `dokumente`, `auswertungen` – normale Rechtegruppen, keine Sonderreiter)
- **`role_permissions`**: `id, role_id, module_key, action, allowed, organization_id`
- **`role_scopes`**: `id, role_id, module_key, scope, organization_id`
- **`user_roles`**: `id, user_id, role_id, organization_id`
- Protokoll **`perm_audit_log`**: `id, actor_id, actor_email, action, entity_type, entity_id, entity_label, before(jsonb), after(jsonb), created_at, organization_id` — **automatisch per DB-Trigger** auf `roles`, `role_permissions`, `role_scopes`, `user_roles` befüllt. Schutz-Trigger `trg_guard_role_admin` (Admin-Rolle) und `trg_guard_last_admin_userrole` (letzter Admin) verhindern das Aussperren.
- **Entfernt (Migr. 0106, weil ungenutzt – 0 Datensätze):** `user_permission_overrides`, `user_scope_overrides`.
- **`user_access`** (`user_id, see_archived, …`): physisch erhalten, aber **nicht mehr** Rechtequelle (Daten wurden rollenbasiert übernommen). Spätere Aufräum-Migration nur mit ausdrücklicher Freigabe.

**Zentrale Logik**
Frontend prüft `can(modul, aktion)` für UI/Aktionen; **maßgeblich** ist die DB-Absicherung über Supabase **RLS** (greift auch bei Umgehung des Frontends). Effektives Recht = **Rolle(n)**; Admin-Status kommt aus `roles.is_admin` der zugewiesenen Rolle(n). `profiles.role` dient **nur** als Sicherheits-Fallback, falls (noch) kein `user_roles`-Eintrag existiert (Aussperr-Schutz) – kein zweites Rechtesystem. Sichtbarkeits-Flags/Scope ergeben sich aus den aktiven Rollen (großzügigster Wert gewinnt; Admin = alles/„all").
RLS-Schreibrecht auf `roles`/`role_permissions`/`role_scopes`/`user_roles`/`user_access`: `b4y_is_admin()` **oder** `b4y_has_permission('settings.permissions','edit')`; durchgängig RESTRICTIVE `org_isolation` (`organization_id = current_org_id()`, per Default automatisch gesetzt).

**Erweitern**
Neues Modul = `permission_modules`-Eintrag (mit `actions`, ggf. `supports_scope`) + Frontend-`can(...)` + passende RLS-Policy. Rechte **nie** nur im Frontend prüfen. Mandantenbezug ([mandantenfaehigkeit.md](mandantenfaehigkeit.md)).

**Mitarbeiter-Einladung & Rollenvergabe:** Neue App-Zugänge entstehen über die Edge Function `invite-employee` (siehe [mitarbeiter.md](mitarbeiter.md)). Sie prüft **serverseitig**, dass nur Administratoren einladen dürfen (Legacy `profiles.role` ∈ Admin-Namen **oder** `roles.is_admin` via `user_roles`), nutzt `service_role` ausschließlich serverseitig und vergibt **standardmäßig keine Rolle** (kein Auto-Admin). Eine optionale Rolle kann bei der Einladung gewählt werden; Feineinstellungen unter Einstellungen → Zugriffsrechte.

**Rolle „Gesellschafter" + Robustheit (Stand 2026-06-28):**
- Neue System-Rolle **`gesellschafter`** (Name „Gesellschafter", `is_admin=true`, aktiv, volle Sichtbarkeit) je Organisation – idempotent geseedet (Migr. **0111**). Bestehende Rollen werden nicht überschrieben.
- **Fallback-Admin-Namen** sind zwischen Frontend (`src/lib/permissions.tsx` `ADMIN_ROLE_NAMES`) und der Edge Function `invite-employee` angeglichen und enthalten `gesellschafter` (greift nur als Aussperr-Schutz, wenn noch kein `user_roles`-Eintrag existiert). Maßgeblich bleibt `roles.is_admin` via `user_roles`.
- **Rollenzuweisung zentral & idempotent:** `src/lib/user-roles.ts` `assignSingleRole(userId, roleId)` (genutzt von `AccessControl.tsx` UND `EmployeeDetail.tsx`): löscht nur fremde Rollen und legt die Zielrolle per `upsert` mit `onConflict:"user_id,role_id", ignoreDuplicates` an. Dieselbe Rolle erneut wählen = No-Op (behebt `user_roles_user_id_role_id_key`-Duplicate-Key). `organization_id` per DB-Default `current_org_id()`.
- **Datennormalisierung (Migr. 0111):** bestehende `user_roles` ohne `organization_id` wurden auf die Membership-Org (sonst Rollen-Org) gesetzt – sonst machte die RESTRICTIVE `org_isolation` die Zeile beim Löschen unsichtbar (Ursache des Duplicate-Keys).
- **RLS-Fix (Migr. 0112):** `b4y_has_permission` referenzierte die in 0106 entfernte Tabelle `user_permission_overrides` und brach dadurch für Nicht-Admins (Admins funktionierten nur durch OR-Short-Circuit). Jetzt rein rollenbasiert.

**Verknüpfungen**
[mandantenfaehigkeit.md](mandantenfaehigkeit.md) · [einstellungen.md](einstellungen.md) · [mitarbeiter.md](mitarbeiter.md) · [sicherheit.md](sicherheit.md)
