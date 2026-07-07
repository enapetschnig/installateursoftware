// ============================================================
// B4Y SuperAPP – Einstellungen: ZENTRALE (globale) Projektstatus
// Eine globale Statusliste je Firma (project_statuses_global). Diese Status gelten
// grundsätzlich für alle Projekte; je Projekttyp werden sie im Reiter „Projekttypen"
// nur aktiviert/deaktiviert. Bestehende Projekte (projects.stage = Text) bleiben erhalten.
// ============================================================
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, ListChecks } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Modal } from "./ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "./calc-ui";
import { GlobalStatusRow, emitProjectConfigChange } from "../lib/project-config";

export default function ProjectStatusManager({ canManage }: { canManage: boolean }) {
  const [statuses, setStatuses] = useState<GlobalStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [editRow, setEditRow] = useState<GlobalStatusRow | null>(null);
  const [delRow, setDelRow] = useState<GlobalStatusRow | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("project_statuses_global").select("*").order("sort_order").order("label");
    if (error) setErr(error.message);
    setStatuses((data as GlobalStatusRow[]) ?? []);
    setLoading(false);
    emitProjectConfigChange();
  }
  useEffect(() => { load(); }, []);

  async function addStatus() {
    const label = newLabel.trim();
    if (!label) return;
    if (statuses.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
      setErr(`Der Status „${label}" existiert bereits.`); return;
    }
    const maxSort = statuses.reduce((m, s) => Math.max(m, s.sort_order), 0);
    const { error } = await supabase.from("project_statuses_global")
      .insert({ label, sort_order: maxSort + 1, active: true });
    if (error) setErr(error.message); else { setNewLabel(""); setErr(null); load(); }
  }
  async function saveStatus(label: string, row: GlobalStatusRow) {
    const name = label.trim();
    if (!name) return;
    const { error } = await supabase.from("project_statuses_global")
      .update({ label: name, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) setErr(error.message); else { setEditRow(null); load(); }
  }
  async function toggleStatus(s: GlobalStatusRow) {
    const { error } = await supabase.from("project_statuses_global")
      .update({ active: !s.active, updated_at: new Date().toISOString() }).eq("id", s.id);
    if (error) setErr(error.message); else load();
  }
  async function confirmDel() {
    if (!delRow) return;
    const { error } = await supabase.from("project_statuses_global").delete().eq("id", delRow.id);
    if (error) setErr(error.message);
    setDelRow(null); load();
  }
  async function move(s: GlobalStatusRow, dir: -1 | 1) {
    const sorted = [...statuses].sort((a, b) => a.sort_order - b.sort_order);
    const i = sorted.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const a = sorted[i], b = sorted[j];
    await Promise.all([
      supabase.from("project_statuses_global").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("project_statuses_global").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    load();
  }

  if (!canManage) {
    return (
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Projektstatus</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Projektstatus können nur von Administrator, Geschäftsführung oder Buchhaltung verwaltet werden.
        </p>
      </div>
    );
  }

  return (
    <div className="glass p-4">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><ListChecks size={20} /> Projektstatus (zentral)</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Globale Statusliste für alle Projekte. Welche Status bei einem bestimmten Projekttyp auswählbar sind,
        legst du im Reiter <b>„Projekttypen"</b> fest (aktivieren/deaktivieren). Bestehende Projekte behalten ihre Werte.
      </p>
      <ErrorBanner message={err} />

      {loading ? <p className="text-sm text-slate-400">Lädt …</p> : (
        <div className="max-w-xl">
          <div className="mb-3 flex gap-2">
            <input className="input" placeholder="Neuer Status …" value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addStatus(); }} />
            <button className="btn-primary px-3 py-1.5 text-sm" onClick={addStatus} disabled={!newLabel.trim()}>
              <Plus size={16} /> Neu
            </button>
          </div>
          <div className="space-y-1">
            {statuses.length === 0 && <p className="py-2 text-sm text-slate-400">Noch keine globalen Status.</p>}
            {[...statuses].sort((a, b) => a.sort_order - b.sort_order).map((s, i, arr) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/5">
                <span className={`min-w-0 flex-1 truncate text-sm ${s.active ? "" : "text-slate-400 line-through"}`}>{s.label}</span>
                <button className="btn-ghost px-1" title="Nach oben" disabled={i === 0} onClick={() => move(s, -1)}><ChevronUp size={15} /></button>
                <button className="btn-ghost px-1" title="Nach unten" disabled={i === arr.length - 1} onClick={() => move(s, 1)}><ChevronDown size={15} /></button>
                <Toggle checked={s.active} onChange={() => toggleStatus(s)} />
                <button className="btn-ghost px-1" title="Bearbeiten" onClick={() => setEditRow(s)}><Pencil size={15} /></button>
                <button className="btn-ghost px-1 text-rose-500" title="Löschen" onClick={() => setDelRow(s)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editRow && <StatusForm row={editRow} onClose={() => setEditRow(null)} onSave={saveStatus} />}
      <ConfirmDialog open={!!delRow} title="Status löschen?"
        message={<>Soll der globale Status <b>{delRow?.label}</b> gelöscht werden? Er wird damit aus allen Projekttypen entfernt. Bestehende Projekte behalten ihren gespeicherten Status-Text.</>}
        onConfirm={confirmDel} onClose={() => setDelRow(null)} />
    </div>
  );
}

function StatusForm({ row, onClose, onSave }: { row: GlobalStatusRow; onClose: () => void; onSave: (label: string, row: GlobalStatusRow) => void }) {
  const [label, setLabel] = useState(row.label);
  return (
    <Modal open onClose={onClose} title="Status bearbeiten">
      <label className="label label-req">Bezeichnung</label>
      <input className="input" value={label} autoFocus onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(label, row); }} />
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={!label.trim()} onClick={() => onSave(label, row)}>Speichern</button>
      </div>
    </Modal>
  );
}
