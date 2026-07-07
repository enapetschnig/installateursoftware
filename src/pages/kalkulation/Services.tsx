import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Pencil, Copy, Trash2, Power, Calculator } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner, Empty, Badge } from "../../components/ui";
import { ConfirmDialog, ErrorBanner, SearchInput } from "../../components/calc-ui";
import { SortHeader } from "../../components/SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";
import NewServiceForm from "../../components/kalkulation/NewServiceForm";
import { Service, ServiceComponent, Trade, ARTICLE_UNITS } from "../../lib/calc-types";
import { eur, dateAt } from "../../lib/format";
import { calcServiceV2, marginTone, CalcComponent, ServiceCalcV2 } from "../../lib/calc";

type Row = Service & { _calc: ServiceCalcV2 };

function calcOf(svc: Service, comps: ServiceComponent[]): ServiceCalcV2 {
  return calcServiceV2({
    components: comps as CalcComponent[],
    aufschlag_percent: svc.aufschlag_percent, vat_rate: svc.vat_rate, vk_net_manual: svc.vk_net_manual,
    material_mode: svc.material_mode, pauschale_type: svc.pauschale_type,
    pauschale_fix: svc.pauschale_fix, pauschale_percent: svc.pauschale_percent,
  });
}

export default function Services() {
  const [list, setList] = useState<Row[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<Service | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  async function load() {
    setLoading(true);
    const [s, c, t, u] = await Promise.all([
      supabase.from("services").select("*").order("sort_order").order("created_at", { ascending: false }),
      supabase.from("service_components").select("*"),
      supabase.from("trades").select("*").order("sort_order"),
      supabase.from("units").select("code").eq("active", true).order("sort_order"),
    ]);
    if (s.error) setErr(s.error.message);
    const comps = (c.data as ServiceComponent[]) ?? [];
    const rows: Row[] = ((s.data as Service[]) ?? []).map((svc) => ({ ...svc, _calc: calcOf(svc, comps.filter((x) => x.service_id === svc.id)) }));
    rows.sort((a, b) => (a.service_number || "~").localeCompare(b.service_number || "~"));
    setList(rows);
    setTrades((t.data as Trade[]) ?? []);
    setUnits(((u.data as { code: string }[]) ?? []).map((x) => x.code));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const tradeName = (id: string | null) => trades.find((t) => t.id === id)?.name ?? "–";
  const shown = list.filter((s) => {
    if (!q.trim()) return true;
    const x = q.toLowerCase();
    return [
      s.service_number, s.name, s.long_text, tradeName(s.trade_id), s.unit,
      s._calc.ekTotal?.toString(), s._calc.vkNetFinal?.toString(), s.vat_rate?.toString(),
    ].filter(Boolean).some((v) => v!.toLowerCase().includes(x));
  });

  const svcSort = useTableSort<Row>(
    "kalk_services",
    {
      nr: { get: (s) => s.service_number, type: "text" },
      name: { get: (s) => s.name, type: "text" },
      trade: { get: (s) => tradeName(s.trade_id), type: "text" },
      category: { get: (s) => s.category, type: "text" },
      unit: { get: (s) => s.unit, type: "text" },
      ek: { get: (s) => s._calc.ekTotal, type: "number" },
      vk: { get: (s) => s._calc.vkNetFinal, type: "number" },
      vat: { get: (s) => s.vat_rate, type: "number" },
      status: { get: (s) => (s.active ? 0 : 1), type: "number" },
      updated: { get: (s) => s.updated_at, type: "date" },
    },
    { userId, default: { key: "nr", dir: "asc" } }
  );
  const shownSorted = svcSort.sortRows(shown);

  async function toggleActive(s: Service) {
    const { error } = await supabase.from("services").update({ active: !s.active }).eq("id", s.id);
    if (error) setErr(error.message); else load();
  }

  async function duplicate(s: Service) {
    setErr(null);
    const { data, error } = await supabase.from("services").insert({
      service_number: s.service_number ? `${s.service_number}-K` : null, name: `${s.name} (Kopie)`,
      internal_name: s.internal_name, short_text: s.short_text, long_text: s.long_text, trade_id: s.trade_id,
      category: s.category, unit: s.unit, vat_rate: s.vat_rate, internal_note: s.internal_note, sort_order: s.sort_order,
      aufschlag_percent: s.aufschlag_percent, vk_net_manual: s.vk_net_manual, material_mode: s.material_mode,
      pauschale_active: s.pauschale_active, pauschale_type: s.pauschale_type, pauschale_fix: s.pauschale_fix,
      pauschale_percent: s.pauschale_percent, active: s.active,
    }).select("id").single();
    if (error || !data) { setErr(error?.message ?? "Fehler"); return; }
    const { data: comps } = await supabase.from("service_components").select("*").eq("service_id", s.id);
    if (comps && comps.length) {
      await supabase.from("service_components").insert((comps as ServiceComponent[]).map((c) => ({
        service_id: data.id, kind: c.kind, sort_order: c.sort_order, label: c.label, hourly_rate_id: c.hourly_rate_id,
        article_id: c.article_id, minutes: c.minutes, quantity: c.quantity, unit: c.unit, cost_rate: c.cost_rate, sale_rate: c.sale_rate, percent: c.percent, note: c.note,
      })));
    }
    load();
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    const { error } = await supabase.from("services").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Suche: Nr., Kurztext, Langtext, Gewerk, Einheit" />
        <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={18} /> Neue Leistung</button>
      </div>
      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Leistungen" hint="Eine Leistung wird aus Lohn, Material, Pauschalen und Aufschlag kalkuliert." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nr." sortKey="nr" sort={svcSort.sort} onSort={svcSort.onSort} />
                <SortHeader label="Kurztext" sortKey="name" sort={svcSort.sort} onSort={svcSort.onSort} />
                <SortHeader label="Gewerk" sortKey="trade" sort={svcSort.sort} onSort={svcSort.onSort} />
                <SortHeader label="Kategorie" sortKey="category" sort={svcSort.sort} onSort={svcSort.onSort} />
                <SortHeader label="Einheit" sortKey="unit" sort={svcSort.sort} onSort={svcSort.onSort} />
                <SortHeader label="EK gesamt" sortKey="ek" sort={svcSort.sort} onSort={svcSort.onSort} align="right" />
                <SortHeader label="VK netto final" sortKey="vk" sort={svcSort.sort} onSort={svcSort.onSort} align="right" />
                <SortHeader label="MwSt" sortKey="vat" sort={svcSort.sort} onSort={svcSort.onSort} align="right" />
                <SortHeader label="Status" sortKey="status" sort={svcSort.sort} onSort={svcSort.onSort} />
                <SortHeader label="Letzte Änderung" sortKey="updated" sort={svcSort.sort} onSort={svcSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => nav(`/kalkulation/leistungen/${s.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{s.service_number ?? "–"}</td>
                  <td className="px-4 py-3">
                    <Link to={`/kalkulation/leistungen/${s.id}`} className="font-medium hover:text-brand-600">{s.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{tradeName(s.trade_id)}</td>
                  <td className="px-4 py-3 text-slate-500">{s.category ?? "–"}</td>
                  <td className="px-4 py-3 text-slate-500">{s.unit ?? "–"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{eur(s._calc.ekTotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(s._calc.vkNetFinal)}<div className="text-[10px] font-normal"><Badge tone={marginTone(s._calc.marginPct)}>{s._calc.marginPct}%</Badge></div></td>
                  <td className="px-4 py-3 text-right text-slate-500">{s.vat_rate}%</td>
                  <td className="px-4 py-3">{s.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{dateAt(s.updated_at)}</td>
                  {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title="Kalkulieren" onClick={() => nav(`/kalkulation/leistungen/${s.id}`)}><Calculator size={16} /></button>
                      <button className="btn-ghost px-2" title={s.active ? "Deaktivieren" : "Aktivieren"} onClick={() => toggleActive(s)}><Power size={16} /></button>
                      <button className="btn-ghost px-2" title="Duplizieren" onClick={() => duplicate(s)}><Copy size={16} /></button>
                      <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => nav(`/kalkulation/leistungen/${s.id}`)}><Pencil size={16} /></button>
                      <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => setDel(s)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <NewServiceForm trades={trades} services={list} unitOpts={units.length ? units : [...ARTICLE_UNITS]} onClose={() => setOpen(false)} onCreated={(s) => nav(`/kalkulation/leistungen/${s.id}?tab=calc`)} />}
      <ConfirmDialog open={!!del} title="Leistung löschen?" message={<>Soll <b>{del?.name}</b> samt allen Bestandteilen gelöscht werden?</>} busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </>
  );
}

