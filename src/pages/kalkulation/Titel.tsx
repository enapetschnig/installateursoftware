import { useEffect, useState } from "react";
import { Plus, Pencil, Copy, Trash2, Power, Search, Wand2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "../../components/ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "../../components/calc-ui";
import { Trade } from "../../lib/calc-types";
import { dateAt } from "../../lib/format";
import { SortHeader } from "../../components/SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";

// Titel-Bezeichnung immer in Großbuchstaben (Umlaute bleiben erhalten: Ü, Ö, Ä …)
const toTitleCase = (s: string) => s.trim().toUpperCase();

type TitleRow = {
  id: string;
  type: "titel";
  title: string;
  trade_id: string | null;
  description: string | null;
  sort_order: number;
  active: boolean;
  updated_at: string | null;
};

export default function Titel() {
  const [list, setList] = useState<TitleRow[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<TitleRow | "new" | null>(null);
  const [del, setDel] = useState<TitleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);

  async function load() {
    setLoading(true);
    const [t, tr] = await Promise.all([
      supabase.from("text_blocks").select("id,type,title,trade_id,description,sort_order,active,updated_at").eq("type", "titel").order("sort_order").order("title"),
      supabase.from("trades").select("*").eq("active", true).order("sort_order").order("name"),
    ]);
    if (t.error) setErr(t.error.message);
    setList((t.data as TitleRow[]) ?? []);
    setTrades((tr.data as Trade[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const nextSort = list.length ? Math.max(...list.map((r) => r.sort_order)) + 10 : 10;
  const tradeName = (id: string | null) => trades.find((t) => t.id === id)?.name ?? "–";
  const shown = list.filter((r) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (r.title || "").toLowerCase().includes(s) || tradeName(r.trade_id).toLowerCase().includes(s);
  });

  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const titleSort = useTableSort<TitleRow>(
    "kalk_titel",
    {
      nr: { get: (r) => r.sort_order, type: "number" },
      title: { get: (r) => r.title, type: "text" },
      trade: { get: (r) => tradeName(r.trade_id), type: "text" },
      status: { get: (r) => (r.active ? 0 : 1), type: "number" },
      updated: { get: (r) => r.updated_at, type: "date" },
    },
    { userId, default: { key: "nr", dir: "asc" } }
  );
  const shownSorted = titleSort.sortRows(shown);

  // Titel automatisch aus bestehenden aktiven Gewerken erzeugen – ohne Duplikate,
  // ohne bestehende Titel zu überschreiben.
  async function seedFromTrades() {
    setSeeding(true); setErr(null);
    const usedTradeIds = new Set(list.map((r) => r.trade_id).filter(Boolean) as string[]);
    let maxSort = list.length ? Math.max(...list.map((r) => r.sort_order)) : 0;
    const rows = trades
      .filter((t) => !usedTradeIds.has(t.id))
      .map((t) => ({
        type: "titel",
        title: toTitleCase(t.name),
        content: "",
        trade_id: t.id,
        description: null as string | null,
        sort_order: Number.isFinite(t.sort_order) && t.sort_order ? t.sort_order : (maxSort += 10),
        active: true,
      }));
    if (rows.length === 0) { setSeeding(false); return; }
    const { error } = await supabase.from("text_blocks").insert(rows);
    setSeeding(false);
    if (error) setErr(error.message); else load();
  }

  async function toggleActive(r: TitleRow) {
    const { error } = await supabase.from("text_blocks").update({ active: !r.active }).eq("id", r.id);
    if (error) setErr(error.message); else load();
  }
  async function duplicate(r: TitleRow) {
    const { error } = await supabase.from("text_blocks").insert({
      type: "titel", title: toTitleCase(`${r.title} Kopie`), content: "",
      trade_id: r.trade_id, description: r.description, sort_order: nextSort, active: r.active,
    });
    if (error) setErr(error.message); else load();
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("text_blocks").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Titel suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-outline" onClick={seedFromTrades} disabled={seeding || loading} title="Für jedes aktive Gewerk ohne Titel automatisch einen Titel anlegen">
            <Wand2 size={18} /> {seeding ? "Erzeuge …" : "Aus Gewerken erzeugen"}
          </button>
          <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Neuer Titel</button>
        </div>
      </div>
      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Titel" hint="Titel/Überschriften für die Gliederung von Angeboten, Aufträgen, Rechnungen & Co. zentral verwalten – oder per „Aus Gewerken erzeugen“ automatisch anlegen." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nr." sortKey="nr" sort={titleSort.sort} onSort={titleSort.onSort} className="w-14" />
                <SortHeader label="Titel" sortKey="title" sort={titleSort.sort} onSort={titleSort.onSort} />
                <SortHeader label="Gewerk" sortKey="trade" sort={titleSort.sort} onSort={titleSort.onSort} />
                <SortHeader label="Status" sortKey="status" sort={titleSort.sort} onSort={titleSort.onSort} />
                <SortHeader label="Letzte Änderung" sortKey="updated" sort={titleSort.sort} onSort={titleSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => setEdit(r)}
                >
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-400">{r.sort_order}</td>
                  <td className="px-4 py-3 font-medium">{r.title}</td>
                  <td className="px-4 py-3 text-slate-500">{tradeName(r.trade_id)}</td>
                  <td className="px-4 py-3">{r.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{dateAt(r.updated_at)}</td>
                  {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title={r.active ? "Deaktivieren" : "Aktivieren"} onClick={() => toggleActive(r)}><Power size={16} /></button>
                      <button className="btn-ghost px-2" title="Kopieren" onClick={() => duplicate(r)}><Copy size={16} /></button>
                      <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit(r)}><Pencil size={16} /></button>
                      <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => setDel(r)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <TitleForm row={edit === "new" ? null : edit} trades={trades} nextSort={nextSort} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      <ConfirmDialog open={!!del} title="Titel löschen?" message={<>Soll der Titel <b>{del?.title}</b> gelöscht werden? Bereits in Dokumente eingefügte Titel bleiben dort erhalten.</>} busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </>
  );
}

function TitleForm({ row, trades, nextSort, onClose, onSaved }: {
  row: TitleRow | null; trades: Trade[]; nextSort: number; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    title: row?.title ?? "", trade_id: row?.trade_id ?? "",
    description: row?.description ?? "", sort_order: row?.sort_order ?? nextSort, active: row?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setErr(null);
    const title = toTitleCase(f.title);
    if (!title) { setErr("Bitte Titel/Bezeichnung eingeben."); return; }
    setBusy(true);
    const payload = {
      type: "titel", title,
      trade_id: f.trade_id || null, description: f.description.trim() || null,
      sort_order: Number(f.sort_order) || 0, active: f.active,
    };
    const res = row
      ? await supabase.from("text_blocks").update(payload).eq("id", row.id)
      : await supabase.from("text_blocks").insert({ ...payload, content: "" });
    setBusy(false);
    if (res.error) {
      setErr(/uq_text_blocks_sortorder|duplicate|unique/i.test(res.error.message)
        ? `Die Nummer ${payload.sort_order} ist bereits vergeben – bitte eine andere Nummer wählen.`
        : res.error.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={row ? "Titel bearbeiten" : "Neuer Titel"} size="xl">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label label-req">Bezeichnung / Titel</label>
          <input className="input uppercase" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="z.B. MALERARBEITEN" /></div>
        <div><label className="label">Gewerk</label>
          <select className="input" value={f.trade_id} onChange={(e) => set("trade_id", e.target.value)}>
            <option value="">– kein Gewerk –</option>
            {trades.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div><label className="label">Sortierreihenfolge</label>
          <input type="number" className="input" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} /></div>
        <div className="sm:col-span-2"><label className="label">Beschreibung (optional)</label>
          <textarea className="input min-h-[60px]" value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
        <div className="flex items-end pb-1"><Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !f.title.trim()} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}
