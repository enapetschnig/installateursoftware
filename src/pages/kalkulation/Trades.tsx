import { useEffect, useState } from "react";
import { Plus, Pencil, Copy, Trash2, Power } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "../../components/ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "../../components/calc-ui";
import { Trade, tradeSchema, gewerkNo } from "../../lib/calc-types";
import { SortHeader } from "../../components/SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";

export default function Trades() {
  const [list, setList] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Trade | "new" | null>(null);
  const [del, setDel] = useState<Trade | null>(null);
  const [busy, setBusy] = useState(false);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const tradeSort = useTableSort<Trade>(
    "kalk_trades",
    {
      nr: { get: (t) => t.sort_order, type: "number" },
      name: { get: (t) => t.name, type: "text" },
      code: { get: (t) => t.code, type: "text" },
      status: { get: (t) => (t.active ? 0 : 1), type: "number" },
    },
    { userId, default: { key: "nr", dir: "asc" } }
  );

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) setErr(error.message);
    setList((data as Trade[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  const nextSort = list.length ? Math.max(...list.map((t) => t.sort_order)) + 1 : 1;

  async function toggleActive(t: Trade) {
    setErr(null);
    const { error } = await supabase.from("trades").update({ active: !t.active }).eq("id", t.id);
    if (error) setErr(error.message);
    else load();
  }

  async function duplicate(t: Trade) {
    setErr(null);
    const { error } = await supabase.from("trades").insert({
      name: `${t.name} (Kopie)`,
      code: t.code, description: t.description,
      sort_order: t.sort_order, active: t.active,
    });
    if (error) setErr(error.message);
    else load();
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("trades").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message);
    else { setDel(null); load(); }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-slate-500">{list.length} Gewerke</div>
        <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Neues Gewerk</button>
      </div>
      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Gewerke" hint="Lege z.B. Malerarbeiten, Trockenbau, Verputz oder Fliesenarbeiten an." />
      ) : (
        <div className="glass overflow-x-auto">          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nr." sortKey="nr" sort={tradeSort.sort} onSort={tradeSort.onSort} className="w-14" />
                <SortHeader label="Gewerk" sortKey="name" sort={tradeSort.sort} onSort={tradeSort.onSort} />
                <SortHeader label="Kürzel" sortKey="code" sort={tradeSort.sort} onSort={tradeSort.onSort} />
                <SortHeader label="Status" sortKey="status" sort={tradeSort.sort} onSort={tradeSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {tradeSort.sortRows(list).map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => setEdit(t)}
                >
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-400">{gewerkNo(t.sort_order) ?? t.sort_order}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.name}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{t.code ?? "–"}</td>
                  <td className="px-4 py-3">
                    {t.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}
                  </td>
                  {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title={t.active ? "Deaktivieren" : "Aktivieren"} onClick={() => toggleActive(t)}><Power size={16} /></button>
                      <button className="btn-ghost px-2" title="Duplizieren" onClick={() => duplicate(t)}><Copy size={16} /></button>
                      <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit(t)}><Pencil size={16} /></button>
                      <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => setDel(t)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <TradeForm trade={edit === "new" ? null : edit} nextSort={nextSort} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      <ConfirmDialog
        open={!!del}
        title="Gewerk löschen?"
        message={<>Soll das Gewerk <b>{del?.name}</b> dauerhaft gelöscht werden? Zugehörige Stundensätze werden ebenfalls entfernt.</>}
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDel(null)}
      />
    </>
  );
}

function TradeForm({ trade, nextSort, onClose, onSaved }: { trade: Trade | null; nextSort: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: trade?.name ?? "",
    code: trade?.code ?? "",
    sort_order: trade?.sort_order ?? nextSort,
    active: trade?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setErr(null);
    const parsed = tradeSchema.safeParse(f);
    if (!parsed.success) { setErr(parsed.error.issues[0].message); return; }
    setBusy(true);
    const payload = {
      ...parsed.data,
      code: parsed.data.code || null,
      description: null,
      color: null,
    };
    const res = trade
      ? await supabase.from("trades").update(payload).eq("id", trade.id)
      : await supabase.from("trades").insert(payload);
    setBusy(false);
    if (res.error) setErr(res.error.message);
    else onSaved();
  }

  return (
    <Modal open onClose={onClose} title={trade ? "Gewerk bearbeiten" : "Neues Gewerk"}>
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="col-span-2"><label className="label label-req">Bezeichnung</label>
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="z.B. Malerarbeiten" /></div>
        <div><label className="label">Kürzel</label>
          <input className="input" value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="MAL" /></div>
        <div><label className="label">Sortierung</label>
          <input type="number" className="input" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} />
          <p className="mt-1 text-[11px] text-slate-400">Position in der Liste. Neue Gewerke landen am Ende – zum Einfügen dazwischen die Zahl anpassen.</p></div>
        <div className="flex items-end pb-1"><Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}
