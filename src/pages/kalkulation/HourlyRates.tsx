import { useEffect, useState } from "react";
import { Plus, Pencil, Copy, Trash2, Power } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "../../components/ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "../../components/calc-ui";
import { HourlyRate, Trade, hourlyRateSchema } from "../../lib/calc-types";
import { eur } from "../../lib/format";
import { round2 } from "../../lib/calc";
import { SortHeader } from "../../components/SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";

const margeOf = (r: HourlyRate) => (r.sale_rate > 0 ? round2(((r.sale_rate - r.internal_rate) / r.sale_rate) * 100) : 0);

export default function HourlyRates() {
  const [list, setList] = useState<HourlyRate[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [edit, setEdit] = useState<HourlyRate | "new" | null>(null);
  const [del, setDel] = useState<HourlyRate | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const [r, t] = await Promise.all([
      supabase.from("hourly_rates").select("*").order("created_at", { ascending: false }),
      supabase.from("trades").select("*").order("name"),
    ]);
    if (r.error) setErr(r.error.message);
    setList((r.data as HourlyRate[]) ?? []);
    setTrades((t.data as Trade[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const tradeName = (id: string | null) => trades.find((t) => t.id === id)?.name ?? "– kein Gewerk –";
  const shown = filter ? list.filter((r) => r.trade_id === filter) : list;

  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const rateSort = useTableSort<HourlyRate>(
    "kalk_hourly_rates",
    {
      label: { get: (r) => r.label, type: "text" },
      trade: { get: (r) => tradeName(r.trade_id), type: "text" },
      internal: { get: (r) => r.internal_rate, type: "number" },
      sale: { get: (r) => r.sale_rate, type: "number" },
      marge: { get: (r) => margeOf(r), type: "number" },
      status: { get: (r) => (r.active ? 0 : 1), type: "number" },
    },
    { userId, default: { key: "label", dir: "asc" } }
  );
  const shownSorted = rateSort.sortRows(shown);

  async function toggleActive(r: HourlyRate) {
    const { error } = await supabase.from("hourly_rates").update({ active: !r.active }).eq("id", r.id);
    if (error) setErr(error.message); else load();
  }
  async function duplicate(r: HourlyRate) {
    const { error } = await supabase.from("hourly_rates").insert({
      trade_id: r.trade_id, label: `${r.label} (Kopie)`, internal_rate: r.internal_rate,
      sale_rate: r.sale_rate, valid_from: r.valid_from, valid_to: r.valid_to, active: r.active, note: r.note,
    });
    if (error) setErr(error.message); else load();
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    const { error } = await supabase.from("hourly_rates").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <select className="input max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Alle Gewerke ({list.length})</option>
          {trades.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Neuer Stundensatz</button>
      </div>
      <ErrorBanner message={err} />

      {loading ? <Spinner /> : shown.length === 0 ? (
        <Empty title="Keine Stundensätze" hint="Lege je Gewerk interne Kosten- und Verkaufssätze an." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Bezeichnung" sortKey="label" sort={rateSort.sort} onSort={rateSort.onSort} />
                <SortHeader label="Gewerk" sortKey="trade" sort={rateSort.sort} onSort={rateSort.onSort} />
                <SortHeader label="Intern netto" sortKey="internal" sort={rateSort.sort} onSort={rateSort.onSort} align="right" />
                <SortHeader label="Verkauf netto" sortKey="sale" sort={rateSort.sort} onSort={rateSort.onSort} align="right" />
                <SortHeader label="Marge" sortKey="marge" sort={rateSort.sort} onSort={rateSort.onSort} align="right" />
                <SortHeader label="Status" sortKey="status" sort={rateSort.sort} onSort={rateSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((r) => {
                const marge = margeOf(r);
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                    onClick={() => setEdit(r)}
                  >
                    <td className="px-4 py-3 font-medium">{r.label}</td>
                    <td className="px-4 py-3 text-slate-500">{tradeName(r.trade_id)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{eur(r.internal_rate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{eur(r.sale_rate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <Badge tone={marge >= 25 ? "green" : marge >= 10 ? "amber" : "red"}>{marge}%</Badge>
                    </td>
                    <td className="px-4 py-3">{r.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                    {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost px-2" title={r.active ? "Deaktivieren" : "Aktivieren"} onClick={() => toggleActive(r)}><Power size={16} /></button>
                        <button className="btn-ghost px-2" title="Duplizieren" onClick={() => duplicate(r)}><Copy size={16} /></button>
                        <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit(r)}><Pencil size={16} /></button>
                        <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => setDel(r)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {edit && <RateForm rate={edit === "new" ? null : edit} trades={trades} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      <ConfirmDialog open={!!del} title="Stundensatz löschen?" message={<>Soll <b>{del?.label}</b> dauerhaft gelöscht werden?</>} busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </>
  );
}

function RateForm({ rate, trades, onClose, onSaved }: { rate: HourlyRate | null; trades: Trade[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    trade_id: rate?.trade_id ?? (trades[0]?.id ?? ""),
    label: rate?.label ?? "",
    internal_rate: rate?.internal_rate ?? 0,
    sale_rate: rate?.sale_rate ?? 0,
    valid_from: rate?.valid_from ?? "",
    valid_to: rate?.valid_to ?? "",
    active: rate?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setErr(null);
    const parsed = hourlyRateSchema.safeParse({ ...f, trade_id: f.trade_id || null });
    if (!parsed.success) { setErr(parsed.error.issues[0].message); return; }
    setBusy(true);
    const payload = {
      ...parsed.data,
      valid_from: parsed.data.valid_from || null,
      valid_to: parsed.data.valid_to || null,
      note: null,
    };
    const res = rate
      ? await supabase.from("hourly_rates").update(payload).eq("id", rate.id)
      : await supabase.from("hourly_rates").insert(payload);
    setBusy(false);
    if (res.error) setErr(res.error.message); else onSaved();
  }

  return (
    <Modal open onClose={onClose} title={rate ? "Stundensatz bearbeiten" : "Neuer Stundensatz"}>
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="col-span-2"><label className="label label-req">Bezeichnung</label>
          <input className="input" value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="z.B. Facharbeiter, Lehrling, Vorarbeiter" /></div>
        <div className="col-span-2"><label className="label">Gewerk</label>
          <select className="input" value={f.trade_id} onChange={(e) => set("trade_id", e.target.value)}>
            <option value="">– kein Gewerk –</option>
            {trades.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div><label className="label">Interner Satz netto €/h</label>
          <input type="number" step="0.01" className="input" value={f.internal_rate || ""} onChange={(e) => set("internal_rate", Number(e.target.value))} /></div>
        <div><label className="label">Verkaufssatz netto €/h</label>
          <input type="number" step="0.01" className="input" value={f.sale_rate || ""} onChange={(e) => set("sale_rate", Number(e.target.value))} /></div>
        <div className="flex items-end pb-1"><Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !f.label.trim()} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}
