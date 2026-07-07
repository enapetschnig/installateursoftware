// ============================================================
// B4Y SuperAPP – Einstellungen: Projekttypen & Status-Aktivierung
// Linke Spalte: Projekttypen (CRUD, Reihenfolge, aktiv/inaktiv)
// Rechte Spalte: ZENTRALE (globale) Status – je Typ nur aktivieren/deaktivieren.
//   Das Anlegen/Bearbeiten/Löschen der Status erfolgt global im Reiter „Projektstatus".
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, FolderTree, ListChecks } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Modal, Badge } from "./ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "./calc-ui";
import { ProjectTypeRow, GlobalStatusRow, TypeStatusRow, emitProjectConfigChange } from "../lib/project-config";

const slugify = (s: string) =>
  s.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "typ";

export default function ProjectTypesManager({ canManage }: { canManage: boolean }) {
  const [types, setTypes] = useState<ProjectTypeRow[]>([]);
  const [globalStatuses, setGlobalStatuses] = useState<GlobalStatusRow[]>([]);
  const [typeStatuses, setTypeStatuses] = useState<TypeStatusRow[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [editType, setEditType] = useState<ProjectTypeRow | "new" | null>(null);
  const [delType, setDelType] = useState<ProjectTypeRow | null>(null);

  async function load() {
    setLoading(true);
    const [t, g, ts] = await Promise.all([
      supabase.from("project_types").select("*").order("sort_order").order("label"),
      supabase.from("project_statuses_global").select("*").order("sort_order").order("label"),
      supabase.from("project_type_statuses").select("*"),
    ]);
    if (t.error) setErr(t.error.message);
    const tl = (t.data as ProjectTypeRow[]) ?? [];
    setTypes(tl);
    setGlobalStatuses((g.data as GlobalStatusRow[]) ?? []);
    setTypeStatuses((ts.data as TypeStatusRow[]) ?? []);
    setSelId((cur) => cur && tl.some((x) => x.id === cur) ? cur : (tl[0]?.id ?? null));
    setLoading(false);
    // Sidebar, Projektformular und Filter sofort mitziehen
    emitProjectConfigChange();
  }
  useEffect(() => { load(); }, []);

  const selType = types.find((t) => t.id === selId) || null;
  // Zuordnung (Typ → Status) als Map für schnelles Nachschlagen.
  const mapFor = useMemo(() => {
    const m = new Map<string, TypeStatusRow>();
    for (const ts of typeStatuses) if (ts.project_type_id === selId) m.set(ts.status_id, ts);
    return m;
  }, [typeStatuses, selId]);

  // ---- Typen ----
  async function saveType(label: string, row: ProjectTypeRow | null) {
    const name = label.trim();
    if (!name) { setErr("Bitte eine Bezeichnung eingeben."); return; }
    setErr(null);
    if (row) {
      const { error } = await supabase.from("project_types")
        .update({ label: name, updated_at: new Date().toISOString() }).eq("id", row.id);
      if (error) { setErr(error.message); return; }
    } else {
      const maxSort = types.reduce((m, t) => Math.max(m, t.sort_order), 0);
      let slug = slugify(name);
      if (types.some((t) => t.slug === slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      const { data, error } = await supabase.from("project_types")
        .insert({ label: name, slug, category: name, sort_order: maxSort + 1 })
        .select("id").single();
      if (error || !data) { setErr(error?.message ?? "Fehler"); return; }
      // Neuer Typ startet mit ALLEN globalen Status aktiviert (Zuordnungen anlegen).
      if (globalStatuses.length) {
        await supabase.from("project_type_statuses").insert(
          globalStatuses.map((g, i) => ({ project_type_id: data.id, status_id: g.id, active: true, sort_order: i + 1 }))
        );
      }
      setSelId(data.id);
    }
    setEditType(null);
    load();
  }
  async function toggleType(t: ProjectTypeRow) {
    const { error } = await supabase.from("project_types")
      .update({ active: !t.active, updated_at: new Date().toISOString() }).eq("id", t.id);
    if (error) setErr(error.message); else load();
  }
  async function confirmDelType() {
    if (!delType) return;
    const { error } = await supabase.from("project_types").delete().eq("id", delType.id);
    if (error) setErr(error.message);
    setDelType(null); load();
  }
  async function moveType(t: ProjectTypeRow, dir: -1 | 1) {
    const sorted = [...types].sort((a, b) => a.sort_order - b.sort_order);
    const i = sorted.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const a = sorted[i], b = sorted[j];
    await Promise.all([
      supabase.from("project_types").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("project_types").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    load();
  }

  // ---- Status je Typ aktivieren/deaktivieren (Zuordnung) ----
  async function toggleTypeStatus(g: GlobalStatusRow) {
    if (!selId) return;
    setBusyStatus(g.id);
    const existing = mapFor.get(g.id);
    if (existing) {
      await supabase.from("project_type_statuses").update({ active: !existing.active }).eq("id", existing.id);
    } else {
      const maxSort = typeStatuses.filter((m) => m.project_type_id === selId).reduce((mx, m) => Math.max(mx, m.sort_order), 0);
      await supabase.from("project_type_statuses")
        .insert({ project_type_id: selId, status_id: g.id, active: true, sort_order: maxSort + 1 });
    }
    setBusyStatus(null);
    load();
  }

  if (!canManage) {
    return (
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Projekttypen</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Projekttypen können nur von Administrator, Geschäftsführung oder Buchhaltung verwaltet werden.
        </p>
      </div>
    );
  }

  return (
    <div className="glass p-4">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><FolderTree size={20} /> Projekttypen & Status</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Projekttypen verwalten und je Typ festlegen, welche <b>globalen Status</b> gelten. Die Status selbst
        werden zentral im Reiter <b>„Projektstatus"</b> angelegt/bearbeitet. Bestehende Projekte behalten ihre Werte.
      </p>
      <ErrorBanner message={err} />

      {loading ? <p className="text-sm text-slate-400">Lädt …</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Typen */}
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">Projekttypen</h3>
              <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => setEditType("new")}>
                <Plus size={16} /> Neu
              </button>
            </div>
            <div className="space-y-1">
              {types.length === 0 && <p className="py-3 text-sm text-slate-400">Noch keine Projekttypen.</p>}
              {[...types].sort((a, b) => a.sort_order - b.sort_order).map((t, i, arr) => (
                <div key={t.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${t.id === selId ? "bg-slate-100 dark:bg-white/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelId(t.id)}>
                    <span className={`truncate text-sm ${t.active ? "" : "text-slate-400 line-through"}`}>{t.label}</span>
                    {!t.active && <Badge tone="slate">inaktiv</Badge>}
                  </button>
                  <button className="btn-ghost px-1" title="Nach oben" disabled={i === 0} onClick={() => moveType(t, -1)}><ChevronUp size={15} /></button>
                  <button className="btn-ghost px-1" title="Nach unten" disabled={i === arr.length - 1} onClick={() => moveType(t, 1)}><ChevronDown size={15} /></button>
                  <Toggle checked={t.active} onChange={() => toggleType(t)} />
                  <button className="btn-ghost px-1" title="Bearbeiten" onClick={() => setEditType(t)}><Pencil size={15} /></button>
                  <button className="btn-ghost px-1 text-rose-500" title="Löschen" onClick={() => setDelType(t)}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Globale Status – je Typ aktivieren/deaktivieren */}
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              <ListChecks size={18} /> Status aktivieren {selType ? `– ${selType.label}` : ""}
            </h3>
            {!selType ? (
              <p className="py-3 text-sm text-slate-400">Bitte links einen Projekttyp wählen.</p>
            ) : globalStatuses.length === 0 ? (
              <p className="py-3 text-sm text-slate-400">Noch keine globalen Status – bitte im Reiter „Projektstatus" anlegen.</p>
            ) : (
              <div className="space-y-1">
                {globalStatuses.map((g) => {
                  const m = mapFor.get(g.id);
                  const activeForType = !!m && m.active;
                  return (
                    <div key={g.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/5">
                      <span className={`min-w-0 flex-1 truncate text-sm ${activeForType ? "" : "text-slate-400"}`}>{g.label}</span>
                      {!g.active && <Badge tone="slate">global inaktiv</Badge>}
                      <Toggle checked={activeForType} onChange={() => toggleTypeStatus(g)} disabled={busyStatus === g.id} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {editType && <TypeForm row={editType === "new" ? null : editType} onClose={() => setEditType(null)} onSave={saveType} />}
      <ConfirmDialog open={!!delType} title="Projekttyp löschen?"
        message={<>Soll der Projekttyp <b>{delType?.label}</b> samt seinen Status-Zuordnungen gelöscht werden? Bestehende Projekte bleiben erhalten.</>}
        onConfirm={confirmDelType} onClose={() => setDelType(null)} />
    </div>
  );
}

function TypeForm({ row, onClose, onSave }: { row: ProjectTypeRow | null; onClose: () => void; onSave: (label: string, row: ProjectTypeRow | null) => void }) {
  const [label, setLabel] = useState(row?.label ?? "");
  return (
    <Modal open onClose={onClose} title={row ? "Projekttyp bearbeiten" : "Neuer Projekttyp"}>
      <label className="label label-req">Bezeichnung</label>
      <input className="input" value={label} autoFocus onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(label, row); }} placeholder="z.B. Dachsanierung" />
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={!label.trim()} onClick={() => onSave(label, row)}>Speichern</button>
      </div>
    </Modal>
  );
}
