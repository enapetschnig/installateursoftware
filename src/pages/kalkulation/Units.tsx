import { useEffect, useState } from "react";
import { Plus, Pencil, Copy, Trash2, Power, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "../../components/ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "../../components/calc-ui";
import { Unit, unitSchema } from "../../lib/calc-types";
import { dateAt } from "../../lib/format";
import { SortHeader } from "../../components/SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";

export default function Units() {
  const [list, setList] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Unit | "new" | null>(null);
  const [del, setDel] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("units").select("*").order("sort_order").order("name");
    if (error) setErr(error.message);
    setList((data as Unit[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const nextSort = list.length ? Math.max(...list.map((u) => u.sort_order)) + 1 : 1;
  const shown = list.filter((u) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return u.name.toLowerCase().includes(s) || u.code.toLowerCase().includes(s);
  });

  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const unitSort = useTableSort<Unit>(
    "kalk_units",
    {
      nr: { get: (u) => u.sort_order, type: "number" },
      name: { get: (u) => u.name, type: "text" },
      code: { get: (u) => u.code, type: "text" },
      status: { get: (u) => (u.active ? 0 : 1), type: "number" },
      updated: { get: (u) => u.updated_at, type: "date" },
    },
    { userId, default: { key: "nr", dir: "asc" } }
  );
  const shownSorted = unitSort.sortRows(shown);

  async function toggleActive(u: Unit) {
    const { error } = await supabase.from("units").update({ active: !u.active }).eq("id", u.id);
    if (error) setErr(error.message); else load();
  }
  async function duplicate(u: Unit) {
    const { error } = await supabase.from("units").insert({ name: `${u.name} (Kopie)`, code: `${u.code}-K`, sort_order: nextSort, active: u.active });
    if (error) setErr(error.message); else load();
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    // Verwendung prüfen (nur löschen, wenn nirgends verwendet)
    const [a, s, c] = await Promise.all([
      supabase.from("articles").select("id", { count: "exact", head: true }).eq("unit", del.code),
      supabase.from("services").select("id", { count: "exact", head: true }).eq("unit", del.code),
      supabase.from("service_components").select("id", { count: "exact", head: true }).eq("unit", del.code),
    ]);
    const used = (a.count ?? 0) + (s.count ?? 0) + (c.count ?? 0);
    if (used > 0) {
      setBusy(false);
      setErr(`„${del.name}" wird bereits verwendet (${used}×) und kann nicht gelöscht werden – nur deaktivieren.`);
      setDel(null);
      return;
    }
    const { error } = await supabase.from("units").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Einheit suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Neue Einheit</button>
      </div>
      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Einheiten" hint="Einheiten werden zentral verwaltet und stehen später für Artikel, Leistungen, Kalkulationen und Leistungsverzeichnisse zur Verfügung." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nr." sortKey="nr" sort={unitSort.sort} onSort={unitSort.onSort} className="w-14" />
                <SortHeader label="Bezeichnung" sortKey="name" sort={unitSort.sort} onSort={unitSort.onSort} />
                <SortHeader label="Kurzbezeichnung" sortKey="code" sort={unitSort.sort} onSort={unitSort.onSort} />
                <SortHeader label="Status" sortKey="status" sort={unitSort.sort} onSort={unitSort.onSort} />
                <SortHeader label="Letzte Änderung" sortKey="updated" sort={unitSort.sort} onSort={unitSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((u) => (
                <tr
                  key={u.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => setEdit(u)}
                >
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-400">{u.sort_order}</td>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{u.code}</td>
                  <td className="px-4 py-3">{u.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{dateAt(u.updated_at)}</td>
                  {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title={u.active ? "Deaktivieren" : "Aktivieren"} onClick={() => toggleActive(u)}><Power size={16} /></button>
                      <button className="btn-ghost px-2" title="Kopieren" onClick={() => duplicate(u)}><Copy size={16} /></button>
                      <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit(u)}><Pencil size={16} /></button>
                      <button className="btn-ghost px-2 text-rose-500" title="Löschen (nur wenn unbenutzt)" onClick={() => setDel(u)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <UnitForm unit={edit === "new" ? null : edit} nextSort={nextSort} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      <ConfirmDialog open={!!del} title="Einheit löschen?" message={<>Soll <b>{del?.name}</b> gelöscht werden? Das geht nur, wenn die Einheit noch nirgends verwendet wird.</>} busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </>
  );
}

function UnitForm({ unit, nextSort, onClose, onSaved }: { unit: Unit | null; nextSort: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: unit?.name ?? "", code: unit?.code ?? "", sort_order: unit?.sort_order ?? nextSort, active: unit?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setErr(null);
    const parsed = unitSchema.safeParse(f);
    if (!parsed.success) { setErr(parsed.error.issues[0].message); return; }
    setBusy(true);
    const res = unit
      ? await supabase.from("units").update(parsed.data).eq("id", unit.id)
      : await supabase.from("units").insert(parsed.data);
    setBusy(false);
    if (res.error) {
      setErr(/duplicate|unique/i.test(res.error.message) ? "Diese Kurzbezeichnung gibt es bereits – sie muss eindeutig sein." : res.error.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={unit ? "Einheit bearbeiten" : "Neue Einheit"}>
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="col-span-2"><label className="label label-req">Bezeichnung</label>
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="z.B. Quadratmeter" /></div>
        <div><label className="label label-req">Kurzbezeichnung</label>
          <input className="input" value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="z.B. m²" /></div>
        <div><label className="label">Sortierreihenfolge</label>
          <input type="number" className="input" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} /></div>
        <div className="flex items-end pb-1"><Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !f.name.trim() || !f.code.trim()} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}
