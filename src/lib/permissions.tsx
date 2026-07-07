import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

// ===== Typen =====
export type Scope = "none" | "own" | "assigned" | "department" | "all";
export const SCOPE_ORDER: Scope[] = ["none", "own", "assigned", "department", "all"];
export const SCOPE_LABEL: Record<Scope, string> = {
  none: "Kein Zugriff",
  own: "Eigene Daten",
  assigned: "Zugewiesene Daten",
  department: "Abteilung / Niederlassung",
  all: "Alle Daten",
};

export const ACTION_LABEL: Record<string, string> = {
  view: "Anzeigen", create: "Erstellen", edit: "Bearbeiten", delete: "Löschen",
  archive: "Archivieren", export: "Exportieren", print: "Drucken", share: "Freigeben / Versenden",
  upload: "Hochladen", download: "Herunterladen", forward: "Weiterleiten", release: "Für Kunden freigeben",
};

export type PermGroup = { key: string; label: string; sort_order: number };
export type PermModule = {
  key: string; label: string; group_key: string | null; parent_key: string | null;
  supports_scope: boolean; actions: string[]; active: boolean; sort_order: number;
};
export type Role = {
  id: string; key: string | null; name: string; description: string | null;
  is_system: boolean; is_admin: boolean; active: boolean;
  // Rollenbasierte Sichtbarkeits-/Scope-Flags (Migration 0106)
  see_archived?: boolean; see_deleted?: boolean; restore_deleted?: boolean;
  default_project_scope?: Scope; organization_id?: string | null;
};
// Sichtbarkeits-/Scope-Flags – jetzt rollenbasiert abgeleitet (nicht mehr pro User).
export type UserAccessFlags = {
  see_archived: boolean; see_deleted: boolean;
  restore_deleted: boolean; default_project_scope: Scope;
};

type PermState = {
  loading: boolean;
  isAdmin: boolean;
  can: (moduleKey: string, action?: string) => boolean;
  scope: (moduleKey: string) => Scope;
  access: UserAccessFlags | null;
  groups: PermGroup[];
  modules: PermModule[];
  reload: () => void;
};

const Ctx = createContext<PermState>({} as PermState);

// Fallback-Admin-Namen für profiles.role (nur falls noch KEIN user_roles-Eintrag existiert –
// Aussperr-Schutz, kein zweites Rechtesystem). Muss mit der Edge Function invite-employee
// übereinstimmen. „gesellschafter" ist ein Vollzugriffs-Name (siehe Migr. 0111).
const ADMIN_ROLE_NAMES = [
  "admin", "administrator",
  "geschaeftsfuehrer", "geschäftsführer", "geschaeftsfuehrung", "geschäftsfuehrung",
  "gf", "gesellschafter",
];

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { session, profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  // User-ID, für die der aktuelle Rechte-Stand tatsächlich geladen wurde.
  //  undefined = noch nie geladen · null = Stand für "abgemeldet" · "<uid>" = Stand für diesen User.
  // Verhindert, dass nach Session-Wiederherstellung kurz ein veralteter (leerer) Rechte-Stand
  // greift und fälschlich "Keine Berechtigung" anzeigt.
  const [loadedUid, setLoadedUid] = useState<string | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allow, setAllow] = useState<Set<string>>(new Set());
  const [deny, setDeny] = useState<Set<string>>(new Set());
  const [scopes, setScopes] = useState<Record<string, Scope>>({});
  const [access, setAccess] = useState<UserAccessFlags | null>(null);
  const [groups, setGroups] = useState<PermGroup[]>([]);
  const [modules, setModules] = useState<PermModule[]>([]);

  const load = useCallback(async () => {
    // Robust: bei transientem Fehler bis zu 3 Versuche. Schlägt alles fehl,
    // bleibt der BISHERIGE Rechte-Stand erhalten – kein versehentliches Aussperren.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        setLoading(true);
        // Katalog (für Menü/Validierung) – für alle Eingeloggten lesbar
        const [g, m] = await Promise.all([
          supabase.from("permission_groups").select("*").order("sort_order"),
          supabase.from("permission_modules").select("*").order("sort_order"),
        ]);
        if (g.error) throw g.error;
        if (m.error) throw m.error;
        setGroups((g.data as PermGroup[]) ?? []);
        setModules((m.data as PermModule[]) ?? []);

        if (!session?.user) { setLoadedUid(null); setLoading(false); return; }
        const uid = session.user.id;

        const myRoles = await supabase.from("user_roles").select("role_id").eq("user_id", uid);
        if (myRoles.error) throw myRoles.error;
        const roleIds = (myRoles.data ?? []).map((r: any) => r.role_id);

        // Admin? – primär über die zugewiesene is_admin-Rolle. profiles.role dient NUR
        // als Sicherheits-Fallback, falls (noch) KEINE Rolle zugewiesen ist, damit niemand
        // ausgesperrt wird. Für Nutzer MIT Rolle gibt es keine zweite, parallele Rechtewelt.
        let admin = false;
        let acc: UserAccessFlags = {
          see_archived: false, see_deleted: false, restore_deleted: false, default_project_scope: "own",
        };

        const allowSet = new Set<string>();
        const denySet = new Set<string>();
        const scopeMap: Record<string, Scope> = {};

        if (roleIds.length) {
          // Rollen-Stammdaten inkl. rollenbasierter Sichtbarkeits-/Scope-Flags
          const rolesData = await supabase
            .from("roles")
            .select("id,is_admin,active,see_archived,see_deleted,restore_deleted,default_project_scope")
            .in("id", roleIds);
          if (rolesData.error) throw rolesData.error;
          (rolesData.data ?? []).forEach((r: any) => {
            if (!r.active) return;
            if (r.is_admin) admin = true;
            // Großzügigster Wert über alle aktiven Rollen gewinnt
            acc.see_archived = acc.see_archived || !!r.see_archived;
            acc.see_deleted = acc.see_deleted || !!r.see_deleted;
            acc.restore_deleted = acc.restore_deleted || !!r.restore_deleted;
            const rscope = (r.default_project_scope as Scope) ?? "own";
            if (SCOPE_ORDER.indexOf(rscope) > SCOPE_ORDER.indexOf(acc.default_project_scope)) {
              acc.default_project_scope = rscope;
            }
          });

          const rp = await supabase
            .from("role_permissions").select("module_key,action,allowed").in("role_id", roleIds).eq("allowed", true);
          if (rp.error) throw rp.error;
          (rp.data ?? []).forEach((p: any) => allowSet.add(`${p.module_key}|${p.action}`));

          const rs = await supabase.from("role_scopes").select("module_key,scope").in("role_id", roleIds);
          if (rs.error) throw rs.error;
          (rs.data ?? []).forEach((s: any) => {
            const cur = scopeMap[s.module_key];
            if (!cur || SCOPE_ORDER.indexOf(s.scope) > SCOPE_ORDER.indexOf(cur)) scopeMap[s.module_key] = s.scope;
          });
        } else {
          // Kein user_roles-Eintrag → Sicherheits-Fallback auf Alt-Profilrolle (Aussperr-Schutz).
          admin = ADMIN_ROLE_NAMES.includes((profile?.role || "").toLowerCase());
        }

        // Admins sehen/verwalten grundsätzlich alles.
        if (admin) acc = { see_archived: true, see_deleted: true, restore_deleted: true, default_project_scope: "all" };

        setAccess(acc);
        setIsAdmin(admin);
        setAllow(allowSet);
        setDeny(denySet);
        setScopes(scopeMap);
        setLoadedUid(uid);
        setLoading(false);
        return; // Erfolg → Schleife verlassen
      } catch (e) {
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 400 * attempt)); continue; }
        // Alle Versuche fehlgeschlagen: bisherigen Stand behalten, NICHT herabstufen.
        console.warn("[permissions] Laden fehlgeschlagen – behalte bisherigen Rechte-Stand:", e);
        setLoading(false);
        return;
      }
    }
  }, [session, profile]);

  useEffect(() => { load(); }, [load]);

  const can = useCallback((moduleKey: string, action = "view") => {
    if (isAdmin) return true;
    const k = `${moduleKey}|${action}`;
    if (deny.has(k)) return false;
    return allow.has(k);
  }, [isAdmin, allow, deny]);

  const scope = useCallback((moduleKey: string): Scope => {
    if (isAdmin) return "all";
    return scopes[moduleKey] ?? "none";
  }, [isAdmin, scopes]);

  // Effektiver Ladezustand für Guards: gilt als "lädt noch", solange
  //  – die Auth-Session noch wiederhergestellt wird (authLoading),
  //  – ein Rechte-Ladevorgang läuft (loading), ODER
  //  – ein User eingeloggt ist, dessen Rechte noch nicht (für genau diese uid) geladen wurden.
  // Dadurch erscheint "Keine Berechtigung" erst nach gesichertem, vollständigem Laden –
  // ohne die echte Rechteprüfung abzuschwächen.
  const effectiveLoading =
    authLoading || loading || (!!session?.user && loadedUid !== session.user.id);

  return (
    <Ctx.Provider value={{ loading: effectiveLoading, isAdmin, can, scope, access, groups, modules, reload: load }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePermissions = () => useContext(Ctx);
/** Komfort-Hook: can("projects","edit") */
export function useCan() {
  const { can } = usePermissions();
  return can;
}
