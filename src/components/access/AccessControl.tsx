import { Fragment, useEffect, useState } from "react";
import {
  Shield, Users, History, Eye, Plus, Pencil, Copy, Trash2, Power,
  ChevronDown, ChevronRight, Search, Check, ArrowLeft,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { assignSingleRole } from "../../lib/user-roles";
import {
  Role, PermGroup, PermModule, Scope, SCOPE_ORDER, SCOPE_LABEL, ACTION_LABEL,
} from "../../lib/permissions";
import { Spinner, Empty, Badge } from "../ui";
import { ConfirmDialog, ErrorBanner, Toggle } from "../calc-ui";
import { SortHeader } from "../SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";

// Vereinfachtes Rechte-Modell (Stand 2026-06-27):
//  • Rollen        – Liste + voller Inline-Editor (Stammdaten, Vollzugriff, Sichtbarkeit,
//                    Rechte nach Gruppen INKL. Dokumente & Auswertungen + Datenbereich/Scope).
//  • Zuweisung     – Mitarbeiter → genau eine Rolle (keine Pro-User-Ausnahmen mehr).
//  • Ansicht als   – Test: zeigt die EFFEKTIVEN Rechte eines Mitarbeiters (rein rollenbasiert).
//  • Protokoll     – DB-seitiges Audit (perm_audit_log) aller Rollen-/Rechteänderungen.
// Frühere Reiter „Mitarbeiterrechte / Rechte-Matrix / Dokumentenrechte / Auswertungen" sind
// entfallen: Dokumente/Auswertungen sind normale Rechtegruppen im Rollen-Editor; die ungenutzten
// Pro-User-Overrides wurden mit Migration 0106 entfernt.

type SubTab = "rollen" | "zuweisung" | "vorschau" | "protokoll";
const SUBTABS: { key: SubTab; label: string; icon: any }[] = [
  { key: "rollen", label: "Rollen", icon: Shield },
  { key: "zuweisung", label: "Rollenzuweisung", icon: Users },
  { key: "vorschau", label: "Ansicht als", icon: Eye },
  { key: "protokoll", label: "Protokoll", icon: History },
];
const SUBTAB_KEYS: SubTab[] = ["rollen", "zuweisung", "vorschau", "protokoll"];
// Alte Deep-Links (z. B. aus dem Mitarbeiter-Detail) auf die neuen Reiter abbilden,
// damit Bestandsverweise nicht ins Leere bzw. auf „rollen" zurückfallen.
const LEGACY_SUB: Record<string, SubTab> = {
  mitarbeiter: "zuweisung", matrix: "rollen", dokumente: "rollen", auswertungen: "rollen",
};

type Profile = { id: string; name: string | null; email: string | null; role: string | null };

export default function AccessControl({ canManage, initialSub }: { canManage: boolean; initialSub?: string | null }) {
  const [sub, setSub] = useState<SubTab>(() => {
    const raw = initialSub ?? "";
    if ((SUBTAB_KEYS as string[]).includes(raw)) return raw as SubTab;
    return LEGACY_SUB[raw] ?? "rollen";
  });
  // ?sub= reagiert auch nachträglich (z. B. „Modul öffnen" wechselt den Unterreiter,
  // während AccessControl bereits gemountet ist) – useState liest den Initialwert nur einmal.
  useEffect(() => {
    const raw = initialSub ?? "";
    if (!raw) return;
    const next = (SUBTAB_KEYS as string[]).includes(raw) ? (raw as SubTab) : LEGACY_SUB[raw];
    if (next) setSub(next);
  }, [initialSub]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<PermGroup[]>([]);
  const [modules, setModules] = useState<PermModule[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<{ user_id: string; role_id: string }[]>([]);

  async function loadBase() {
    setLoading(true);
    const [r, g, m, u, ur] = await Promise.all([
      supabase.from("roles").select("*").order("is_admin", { ascending: false }).order("name"),
      supabase.from("permission_groups").select("*").order("sort_order"),
      supabase.from("permission_modules").select("*").order("sort_order"),
      supabase.from("profiles").select("id,name,email,role").order("name"),
      supabase.from("user_roles").select("user_id,role_id"),
    ]);
    if (r.error) setErr(r.error.message);
    setRoles((r.data as Role[]) ?? []);
    setGroups((g.data as PermGroup[]) ?? []);
    setModules((m.data as PermModule[]) ?? []);
    setUsers((u.data as Profile[]) ?? []);
    setUserRoles((ur.data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { loadBase(); }, []);

  const roleUserCount = (roleId: string) => userRoles.filter((x) => x.role_id === roleId).length;

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={err} />
      {!canManage && (
        <div className="glass border-l-4 border-amber-400 p-3 text-sm text-amber-700 dark:text-amber-300">
          Du kannst diese Einstellungen ansehen, aber nur Administratoren dürfen sie ändern.
        </div>
      )}

      {/* Unter-Navigation */}
      <div className="flex flex-wrap gap-1 rounded-2xl border bg-[var(--card)] p-1" style={{ borderColor: "var(--border)" }}>
        {SUBTABS.map((t) => {
          const active = sub === t.key;
          return (
            <button key={t.key} onClick={() => setSub(t.key)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? "text-white" : "text-slate-500 hover:bg-[var(--hover)] dark:text-slate-400"}`}
              style={active ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))" } : undefined}>
              <t.icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {sub === "rollen" && (
        <RolesPanel roles={roles} groups={groups} modules={modules} canManage={canManage}
          userCount={roleUserCount} onChanged={loadBase} setErr={setErr} />
      )}
      {sub === "zuweisung" && (
        <AssignPanel users={users} roles={roles} userRoles={userRoles}
          canManage={canManage} setErr={setErr} onChanged={loadBase} />
      )}
      {sub === "vorschau" && (
        <PreviewPanel users={users} roles={roles} userRoles={userRoles} groups={groups} modules={modules} />
      )}
      {sub === "protokoll" && <AuditPanel />}
    </div>
  );
}

/* ============================= Rollen (Liste + Editor) ============================= */
function RolesPanel({ roles, groups, modules, canManage, userCount, onChanged, setErr }: {
  roles: Role[]; groups: PermGroup[]; modules: PermModule[]; canManage: boolean;
  userCount: (id: string) => number; onChanged: () => void; setErr: (s: string | null) => void;
}) {
  const [edit, setEdit] = useState<Role | "new" | null>(null);
  const [del, setDel] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  const { session } = useAuth();
  const roleSort = useTableSort<Role>(
    "access_roles",
    {
      name: { get: (r) => r.name, type: "text" },
      description: { get: (r) => r.description, type: "text" },
      status: { get: (r) => (r.active ? 0 : 1), type: "number" },
      users: { get: (r) => userCount(r.id), type: "number" },
    },
    { userId: session?.user?.id ?? null, default: { key: "name", dir: "asc" } }
  );

  async function toggleActive(r: Role) {
    const { error } = await supabase.from("roles").update({ active: !r.active }).eq("id", r.id);
    if (error) setErr(error.message); else onChanged();
  }
  async function copy(r: Role) {
    setErr(null);
    const { data, error } = await supabase.from("roles")
      .insert({
        name: `${r.name} (Kopie)`, description: r.description, is_admin: false, is_system: false, active: true,
        see_archived: r.see_archived ?? false, see_deleted: r.see_deleted ?? false,
        restore_deleted: r.restore_deleted ?? false, default_project_scope: r.default_project_scope ?? "own",
      })
      .select("id").single();
    if (error) { setErr(error.message); return; }
    const newId = (data as any).id;
    const [rp, rs] = await Promise.all([
      supabase.from("role_permissions").select("module_key,action,allowed").eq("role_id", r.id),
      supabase.from("role_scopes").select("module_key,scope").eq("role_id", r.id),
    ]);
    if (rp.data?.length) await supabase.from("role_permissions").insert(rp.data.map((p: any) => ({ ...p, role_id: newId })));
    if (rs.data?.length) await supabase.from("role_scopes").insert(rs.data.map((s: any) => ({ ...s, role_id: newId })));
    onChanged();
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    const { error } = await supabase.from("roles").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); onChanged(); }
  }

  // Editor (Vollbild-Panel statt Tabelle)
  if (edit) {
    return (
      <RoleEditor
        role={edit === "new" ? null : edit}
        groups={groups} modules={modules} canManage={canManage} setErr={setErr}
        onBack={() => setEdit(null)}
        onSaved={() => { onChanged(); }}
      />
    );
  }

  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="text-sm text-slate-500 dark:text-slate-400">Standardrollen sind nur Vorlagen – frei änder-, kopier- und löschbar. Rechte werden je Rolle gesetzt.</div>
        {canManage && <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Neue Rolle</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
            <tr>
              <SortHeader label="Rolle" sortKey="name" sort={roleSort.sort} onSort={roleSort.onSort} />
              <SortHeader label="Beschreibung" sortKey="description" sort={roleSort.sort} onSort={roleSort.onSort} />
              <SortHeader label="Status" sortKey="status" sort={roleSort.sort} onSort={roleSort.onSort} />
              <SortHeader label="Mitarbeiter" sortKey="users" sort={roleSort.sort} onSort={roleSort.onSort} align="center" />
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {roleSort.sortRows(roles).map((r) => {
              const cnt = userCount(r.id);
              return (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => setEdit(r)}>
                  <td className="px-4 py-3 font-medium">
                    {r.name}{" "}
                    {r.is_admin && <Badge tone="red">Vollzugriff</Badge>}{" "}
                    {r.is_system && <Badge tone="slate">Vorlage</Badge>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.description ?? "–"}</td>
                  <td className="px-4 py-3">{r.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  <td className="px-4 py-3 text-center tabular-nums">{cnt}</td>
                  {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title={canManage ? "Bearbeiten" : "Ansehen"} onClick={() => setEdit(r)}>
                        {canManage ? <Pencil size={16} /> : <Eye size={16} />}
                      </button>
                      {canManage && <>
                        <button className="btn-ghost px-2" title={r.active ? "Deaktivieren" : "Aktivieren"} onClick={() => toggleActive(r)}><Power size={16} /></button>
                        <button className="btn-ghost px-2" title="Kopieren" onClick={() => copy(r)}><Copy size={16} /></button>
                        <button className="btn-ghost px-2 text-rose-500 disabled:opacity-30" title={cnt > 0 ? "Erst Mitarbeiter neu zuweisen" : r.is_admin ? "Admin-Rolle geschützt" : "Löschen"}
                          disabled={cnt > 0 || r.is_admin} onClick={() => setDel(r)}><Trash2 size={16} /></button>
                      </>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={!!del} title="Rolle löschen?" message={<>Soll <b>{del?.name}</b> dauerhaft gelöscht werden?</>} busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </div>
  );
}

/* ---- Rollen-Editor: Stammdaten + Sichtbarkeit + Rechte nach Gruppen ---- */
function RoleEditor({ role, groups, modules, canManage, setErr, onBack, onSaved }: {
  role: Role | null; groups: PermGroup[]; modules: PermModule[]; canManage: boolean;
  setErr: (s: string | null) => void; onBack: () => void; onSaved: () => void;
}) {
  const [roleId, setRoleId] = useState<string | null>(role?.id ?? null);
  const [f, setF] = useState({
    name: role?.name ?? "",
    description: role?.description ?? "",
    active: role?.active ?? true,
    is_admin: role?.is_admin ?? false,
    see_archived: role?.see_archived ?? false,
    see_deleted: role?.see_deleted ?? false,
    restore_deleted: role?.restore_deleted ?? false,
    default_project_scope: (role?.default_project_scope ?? "own") as Scope,
  });
  const isSystem = role?.is_system ?? false;
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  // Rechte/Scopes der Rolle
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [scopes, setScopes] = useState<Record<string, Scope>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [permsLoading, setPermsLoading] = useState(false);

  async function loadPerms(id: string) {
    setPermsLoading(true);
    const [rp, rs] = await Promise.all([
      supabase.from("role_permissions").select("module_key,action,allowed").eq("role_id", id).eq("allowed", true),
      supabase.from("role_scopes").select("module_key,scope").eq("role_id", id),
    ]);
    setPerms(new Set((rp.data ?? []).map((p: any) => `${p.module_key}|${p.action}`)));
    const sc: Record<string, Scope> = {};
    (rs.data ?? []).forEach((s: any) => { sc[s.module_key] = s.scope; });
    setScopes(sc);
    setPermsLoading(false);
  }
  useEffect(() => { if (roleId) loadPerms(roleId); /* eslint-disable-next-line */ }, [roleId]);

  async function saveHeader() {
    if (!f.name.trim()) { setErr("Bitte einen Rollennamen eingeben."); return; }
    setBusy(true); setErr(null);
    const payload = {
      name: f.name.trim(), description: f.description || null, active: f.active, is_admin: f.is_admin,
      see_archived: f.see_archived, see_deleted: f.see_deleted, restore_deleted: f.restore_deleted,
      default_project_scope: f.default_project_scope,
    };
    if (roleId) {
      const { error } = await supabase.from("roles").update(payload).eq("id", roleId);
      setBusy(false);
      if (error) { setErr(error.message); return; }
      setSavedAt(Date.now()); onSaved();
    } else {
      const { data, error } = await supabase.from("roles")
        .insert({ ...payload, is_system: false }).select("id").single();
      setBusy(false);
      if (error) { setErr(error.message); return; }
      setRoleId((data as any).id); setSavedAt(Date.now()); onSaved();
    }
  }

  async function toggle(mod: string, action: string) {
    if (!canManage || !roleId) return;
    const k = `${mod}|${action}`;
    const next = new Set(perms);
    const willAllow = !next.has(k);
    if (willAllow) next.add(k); else next.delete(k);
    setPerms(next);
    const { error } = willAllow
      ? await supabase.from("role_permissions").upsert({ role_id: roleId, module_key: mod, action, allowed: true }, { onConflict: "role_id,module_key,action" })
      : await supabase.from("role_permissions").delete().match({ role_id: roleId, module_key: mod, action });
    if (error) setErr(error.message); else setSavedAt(Date.now());
  }
  async function setScope(mod: string, scope: Scope) {
    if (!canManage || !roleId) return;
    setScopes((p) => ({ ...p, [mod]: scope }));
    const { error } = await supabase.from("role_scopes").upsert({ role_id: roleId, module_key: mod, scope }, { onConflict: "role_id,module_key" });
    if (error) setErr(error.message); else setSavedAt(Date.now());
  }

  const filterMod = (m: PermModule) => !q || m.label.toLowerCase().includes(q.toLowerCase()) || m.key.includes(q.toLowerCase());

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button className="btn-outline" onClick={onBack}><ArrowLeft size={16} /> Zurück zur Liste</button>
        <span className="text-xs text-emerald-500">{savedAt ? <span className="flex items-center gap-1"><Check size={14} /> Gespeichert</span> : null}</span>
      </div>

      {/* Stammdaten + Sichtbarkeit */}
      <div className="glass p-4">
        <h3 className="mb-3 text-sm font-bold">{roleId ? "Rolle bearbeiten" : "Neue Rolle"}{isSystem && <span className="ml-2"><Badge tone="slate">Vorlage</Badge></span>}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label label-req">Name</label>
            <input className="input" disabled={!canManage} value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="z.B. Projektleiter" /></div>
          <div><label className="label">Beschreibung</label>
            <input className="input" disabled={!canManage} value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
          <Toggle checked={f.active} onChange={(v) => setF((p) => ({ ...p, active: v }))} label="Aktiv" />
          <Toggle checked={f.is_admin} onChange={(v) => setF((p) => ({ ...p, is_admin: v }))} label="Vollzugriff (Administrator)" />
        </div>
        {f.is_admin && (
          <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
            Vollzugriff: Diese Rolle darf alles. Einzelrechte und Sichtbarkeits-Einstellungen unten werden ignoriert.
          </div>
        )}
        {!f.is_admin && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Standard-Projekt-Sichtbarkeit</label>
              <select className="input" disabled={!canManage} value={f.default_project_scope}
                onChange={(e) => setF((p) => ({ ...p, default_project_scope: e.target.value as Scope }))}>
                {SCOPE_ORDER.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <Toggle checked={f.see_archived} onChange={(v) => setF((p) => ({ ...p, see_archived: v }))} label="Archivierte Daten sehen" />
              <Toggle checked={f.see_deleted} onChange={(v) => setF((p) => ({ ...p, see_deleted: v }))} label="Gelöschte Daten sehen" />
              <Toggle checked={f.restore_deleted} onChange={(v) => setF((p) => ({ ...p, restore_deleted: v }))} label="Gelöschte wiederherstellen" />
            </div>
          </div>
        )}
        {canManage && (
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={busy || !f.name.trim()} onClick={saveHeader}>{busy ? "Speichern …" : (roleId ? "Stammdaten speichern" : "Rolle anlegen")}</button>
          </div>
        )}
      </div>

      {/* Rechte nach Gruppen (inkl. Dokumente & Auswertungen) */}
      {!roleId ? (
        <div className="glass p-4 text-sm text-slate-500">Rechte können vergeben werden, sobald die Rolle angelegt ist.</div>
      ) : f.is_admin ? (
        <div className="glass p-4 text-sm text-slate-500">Vollzugriff aktiv – diese Rolle hat automatisch alle Rechte.</div>
      ) : (
        <>
          <div className="glass flex flex-wrap items-center gap-3 p-3">
            <h3 className="text-sm font-bold">Rechte</h3>
            <div className="relative ml-auto w-56">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9 py-1.5" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Modul filtern …" />
            </div>
          </div>
          {permsLoading ? <Spinner /> : groups.map((g) => {
            const mods = modules.filter((m) => m.group_key === g.key).filter(filterMod);
            if (!mods.length) return null;
            const isOpen = open.has(g.key) || !!q;
            return (
              <div key={g.key} className="glass overflow-hidden">
                <button className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold hover:bg-[var(--hover)]"
                  onClick={() => setOpen((p) => { const n = new Set(p); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}>
                  <span className="flex items-center gap-2">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {g.label}</span>
                  <span className="text-xs text-slate-400">{mods.length} Module</span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto border-t" style={{ borderColor: "var(--border)" }}>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {mods.map((m) => (
                          <tr key={m.key} className="align-top">
                            <td className="px-4 py-3 font-medium" style={{ minWidth: 200 }}>
                              {m.parent_key && <span className="mr-1 text-slate-300">↳</span>}{m.label}
                              <div className="text-[11px] text-slate-400">{m.key}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                {m.actions.map((a) => {
                                  const on = perms.has(`${m.key}|${a}`);
                                  return (
                                    <label key={a} className="flex cursor-pointer items-center gap-1.5 text-xs">
                                      <input type="checkbox" checked={on} disabled={!canManage} onChange={() => toggle(m.key, a)} />
                                      {ACTION_LABEL[a] ?? a}
                                    </label>
                                  );
                                })}
                              </div>
                              {m.supports_scope && (
                                <div className="mt-2 flex items-center gap-2 text-xs">
                                  <span className="text-slate-400">Datenbereich:</span>
                                  <select className="input max-w-[220px] py-1 text-xs" disabled={!canManage}
                                    value={scopes[m.key] ?? "none"} onChange={(e) => setScope(m.key, e.target.value as Scope)}>
                                    {SCOPE_ORDER.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                                  </select>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ============================= Rollenzuweisung (schlank) ============================= */
function AssignPanel({ users, roles, userRoles, canManage, setErr, onChanged }: {
  users: Profile[]; roles: Role[]; userRoles: { user_id: string; role_id: string }[];
  canManage: boolean; setErr: (s: string | null) => void; onChanged: () => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const roleOf = (uid: string) => userRoles.find((x) => x.user_id === uid)?.role_id ?? "";
  const activeRoles = roles.filter((r) => r.active);

  const { session } = useAuth();
  const assignSort = useTableSort<Profile>(
    "access_assign",
    {
      name: { get: (u) => u.name, type: "text" },
      email: { get: (u) => u.email, type: "text" },
      role: { get: (u) => roles.find((r) => r.id === roleOf(u.id))?.name ?? null, type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "name", dir: "asc" } }
  );

  async function changeRole(userId: string, roleId: string) {
    if (!canManage) return;
    setErr(null); setSavingId(userId);
    // Zentrale, idempotente Zuweisung (genau eine Rolle je Mitarbeiter; gleiche Rolle = No-Op,
    // kein Duplicate-Key). organization_id per DB-Default current_org_id().
    const { error } = await assignSingleRole(userId, roleId);
    if (error) { setErr(error); setSavingId(null); return; }
    setSavingId(null); setSavedId(userId); onChanged();
    setTimeout(() => setSavedId((cur) => (cur === userId ? null : cur)), 2500);
  }

  if (!users.length) return <Empty title="Keine Mitarbeiter" hint="Lege zuerst Mitarbeiter mit Login an." />;

  return (
    <div className="glass overflow-hidden">
      <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
        Jeder Mitarbeiter erhält genau eine Rolle. Die Rechte ergeben sich vollständig aus der Rolle
        (zu finden im Reiter „Rollen"). Die Zuweisung ist auch im Mitarbeiter-Detail möglich.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
            <tr>
              <SortHeader label="Mitarbeiter" sortKey="name" sort={assignSort.sort} onSort={assignSort.onSort} />
              <SortHeader label="E-Mail" sortKey="email" sort={assignSort.sort} onSort={assignSort.onSort} />
              <SortHeader label="Rolle" sortKey="role" sort={assignSort.sort} onSort={assignSort.onSort} />
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {assignSort.sortRows(users).map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{u.name || "–"}</td>
                <td className="px-4 py-3 text-slate-500">{u.email || "–"}</td>
                <td className="px-4 py-3">
                  <select className="input max-w-xs" value={roleOf(u.id)} disabled={!canManage || savingId === u.id}
                    onChange={(e) => changeRole(u.id, e.target.value)}>
                    <option value="">– keine Rolle –</option>
                    {activeRoles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_admin ? " (Vollzugriff)" : ""}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-right text-xs text-emerald-500">
                  {savedId === u.id ? <span className="flex items-center justify-end gap-1"><Check size={14} /> Gespeichert</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================= Ansicht als (effektive Rollenrechte) ============================= */
function PreviewPanel({ users, roles, userRoles, groups, modules }: {
  users: Profile[]; roles: Role[]; userRoles: { user_id: string; role_id: string }[];
  groups: PermGroup[]; modules: PermModule[];
}) {
  const [userId, setUserId] = useState<string>(users[0]?.id ?? "");
  const [allow, setAllow] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleName, setRoleName] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function compute(id: string) {
    if (!id) return;
    setLoading(true);
    const roleIds = userRoles.filter((x) => x.user_id === id).map((x) => x.role_id);
    let admin = false;
    const set = new Set<string>();
    const names: string[] = [];
    if (roleIds.length) {
      roleIds.forEach((rid) => { const r = roles.find((x) => x.id === rid); if (r) names.push(r.name); });
      const { data: rdata } = await supabase.from("roles").select("id,is_admin,active").in("id", roleIds);
      admin = (rdata ?? []).some((r: any) => r.is_admin && r.active);
      const { data: rp } = await supabase.from("role_permissions").select("module_key,action").in("role_id", roleIds).eq("allowed", true);
      (rp ?? []).forEach((p: any) => set.add(`${p.module_key}|${p.action}`));
    }
    setRoleName(names.join(", ") || "– keine Rolle –");
    setIsAdmin(admin); setAllow(set); setLoading(false);
  }
  // compute bewusst nicht in den Deps: Rechte nur bei User-/Rollenwechsel neu laden.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { compute(userId); }, [userId, userRoles]);

  const visible = (m: PermModule) => isAdmin || m.actions.some((a) => allow.has(`${m.key}|${a}`));

  return (
    <div className="space-y-3">
      <div className="glass p-4">
        <label className="label">Ansicht als Mitarbeiter</label>
        <select className="input max-w-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
        <div className="mt-2 text-xs text-slate-400">Rolle: <span className="font-medium text-slate-500 dark:text-slate-300">{roleName}</span></div>
        {isAdmin && <div className="mt-1 text-sm text-rose-500">Dieser Mitarbeiter hat Vollzugriff (Admin) – alles sichtbar.</div>}
      </div>
      {loading ? <Spinner /> : groups.map((g) => {
        const mods = modules.filter((m) => m.group_key === g.key && visible(m));
        if (!mods.length) return null;
        return (
          <div key={g.key} className="glass p-4">
            <h3 className="mb-2 text-sm font-bold">{g.label}</h3>
            <div className="space-y-1.5">
              {mods.map((m) => (
                <div key={m.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-[200px] font-medium">{m.label}</span>
                  {m.actions.filter((a) => isAdmin || allow.has(`${m.key}|${a}`)).map((a) => (
                    <Badge key={a} tone="green">{ACTION_LABEL[a] ?? a}</Badge>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================= Protokoll ============================= */
function AuditPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("perm_audit_log").select("*").order("created_at", { ascending: false }).limit(300)
      .then(({ data }) => { setRows(data ?? []); setLoading(false); });
  }, []);

  const { session } = useAuth();
  const auditSort = useTableSort<any>(
    "access_audit",
    {
      created: { get: (r) => r.created_at, type: "date" },
      actor: { get: (r) => r.actor_email, type: "text" },
      action: { get: (r) => r.action, type: "text" },
      entity: { get: (r) => r.entity_type, type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "created", dir: "desc" } }
  );

  if (loading) return <Spinner />;
  if (!rows.length) return <Empty title="Noch keine Einträge" hint="Rechte-Änderungen werden hier protokolliert." />;
  return (
    <div className="glass overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
          <tr>
            <SortHeader label="Zeitpunkt" sortKey="created" sort={auditSort.sort} onSort={auditSort.onSort} />
            <SortHeader label="Benutzer" sortKey="actor" sort={auditSort.sort} onSort={auditSort.onSort} />
            <SortHeader label="Aktion" sortKey="action" sort={auditSort.sort} onSort={auditSort.onSort} />
            <SortHeader label="Bereich" sortKey="entity" sort={auditSort.sort} onSort={auditSort.onSort} />
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {auditSort.sortRows(rows).map((r) => (
            <Fragment key={r.id}>
              <tr className="hover:bg-slate-50 dark:hover:bg-white/5">
                <td className="px-4 py-2.5 tabular-nums text-slate-500">{new Date(r.created_at).toLocaleString("de-AT")}</td>
                <td className="px-4 py-2.5">{r.actor_email ?? "–"}</td>
                <td className="px-4 py-2.5">{r.action}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.entity_type}</td>
                <td className="px-4 py-2.5 text-right">
                  <button className="btn-ghost px-2 text-xs" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "schließen" : "Details"}</button>
                </td>
              </tr>
              {open === r.id && (
                <tr><td colSpan={5} className="bg-slate-50 px-4 py-3 dark:bg-white/5">
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    <div><div className="mb-1 font-semibold text-slate-400">Vorher</div><pre className="overflow-x-auto whitespace-pre-wrap">{r.before ? JSON.stringify(r.before, null, 1) : "–"}</pre></div>
                    <div><div className="mb-1 font-semibold text-slate-400">Nachher</div><pre className="overflow-x-auto whitespace-pre-wrap">{r.after ? JSON.stringify(r.after, null, 1) : "–"}</pre></div>
                  </div>
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
