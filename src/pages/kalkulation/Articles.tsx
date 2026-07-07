import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Copy, Trash2, Power, Upload, Download, ImagePlus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner, Empty, Badge } from "../../components/ui";
import { ConfirmDialog, ErrorBanner, SearchInput } from "../../components/calc-ui";
import { SortHeader } from "../../components/SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";
import ArticleForm from "../../components/kalkulation/ArticleForm";
import SignedImage from "../../components/SignedImage";
import { Article, Trade, ARTICLE_UNITS, gewerkNo, suggestPosition } from "../../lib/calc-types";
import { eur, dateAt } from "../../lib/format";
import { sortAlphaStrings } from "../../lib/sortOptions";
import { round2 } from "../../lib/calc";

const CSV_COLS = ["article_number","name","description","category","unit","purchase_price","sale_price","list_price","vat_rate","supplier","supplier_email","calculation_text","is_stock","active"] as const;

export default function Articles() {
  const [list, setList] = useState<Article[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fTrade, setFTrade] = useState("");
  const [fSupplier, setFSupplier] = useState("");
  const [fUnit, setFUnit] = useState("");
  const [edit, setEdit] = useState<Article | "new" | null>(null);
  const [del, setDel] = useState<Article | null>(null);
  const [busy, setBusy] = useState(false);
  const [centralUnits, setCentralUnits] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  async function load() {
    setLoading(true);
    const [a, t, u] = await Promise.all([
      supabase.from("articles").select("*"),
      supabase.from("trades").select("*").order("sort_order"),
      supabase.from("units").select("code").eq("active", true).order("sort_order"),
    ]);
    if (a.error) setErr(a.error.message);
    const arts = ((a.data as Article[]) ?? []).slice()
      .sort((x, y) => (x.article_number || "~").localeCompare(y.article_number || "~", undefined, { numeric: true }));
    setList(arts);
    setTrades((t.data as Trade[]) ?? []);
    setCentralUnits(((u.data as { code: string }[]) ?? []).map((x) => x.code));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const tradeName = (id: string | null) => trades.find((t) => t.id === id)?.name ?? "–";
  const suppliers = sortAlphaStrings(Array.from(new Set(list.map((a) => a.supplier).filter(Boolean))) as string[]);
  const units = sortAlphaStrings(Array.from(new Set(list.map((a) => a.unit).filter(Boolean))) as string[]);

  const shown = list.filter((a) => {
    if (fTrade && a.trade_id !== fTrade) return false;
    if (fSupplier && a.supplier !== fSupplier) return false;
    if (fUnit && a.unit !== fUnit) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      const hit = [
        a.article_number, a.name, a.description, a.supplier, a.supplier_email,
        tradeName(a.trade_id), a.unit,
        a.purchase_price?.toString(), a.sale_price?.toString(),
      ].filter(Boolean).some((v) => v!.toLowerCase().includes(s));
      if (!hit) return false;
    }
    return true;
  });

  const artSort = useTableSort<Article>(
    "kalk_articles",
    {
      nr: { get: (a) => a.article_number, type: "text" },
      name: { get: (a) => a.name, type: "text" },
      trade: { get: (a) => tradeName(a.trade_id), type: "text" },
      unit: { get: (a) => a.unit, type: "text" },
      ek: { get: (a) => a.purchase_price, type: "number" },
      vk: { get: (a) => a.sale_price, type: "number" },
      vat: { get: (a) => a.vat_rate, type: "number" },
      stock: { get: (a) => (a.is_stock ? 0 : 1), type: "number" },
      status: { get: (a) => (a.active ? 0 : 1), type: "number" },
      updated: { get: (a) => a.updated_at, type: "date" },
    },
    { userId, default: { key: "nr", dir: "asc" } }
  );
  const shownSorted = artSort.sortRows(shown);

  async function toggleActive(a: Article) {
    const { error } = await supabase.from("articles").update({ active: !a.active }).eq("id", a.id);
    if (error) setErr(error.message); else load();
  }
  async function duplicate(a: Article) {
    const g = gewerkNo(trades.find((t) => t.id === a.trade_id)?.sort_order);
    const pos = g ? suggestPosition(list.filter((x) => x.trade_id === a.trade_id)
      .map((x) => x.positions_nummer || (x.article_number && x.article_number.includes("-") ? x.article_number.split("-")[1] : ""))
      .filter(Boolean) as string[]) : null;
    const { error } = await supabase.from("articles").insert({
      article_number: g && pos ? `${g}-${pos}` : null, positions_nummer: pos, trade_id: a.trade_id,
      name: `${a.name} (Kopie)`, description: a.description, category: a.category, unit: a.unit,
      purchase_price: a.purchase_price, sale_price: a.sale_price, list_price: a.list_price, vat_rate: a.vat_rate,
      supplier: a.supplier, supplier_email: a.supplier_email, image_url: a.image_url,
      calculation_text: a.calculation_text, is_stock: a.is_stock, active: a.active,
    });
    if (error) setErr(error.message); else load();
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    const { error } = await supabase.from("articles").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); }
  }

  function exportCsv() {
    const head = CSV_COLS.join(";");
    const rows = list.map((a) => CSV_COLS.map((c) => {
      const v = (a as any)[c]; if (v === null || v === undefined) return "";
      const sv = String(v).replace(/"/g, '""'); return /[;"\n]/.test(sv) ? `"${sv}"` : sv;
    }).join(";"));
    const csv = "﻿" + [head, ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url; link.download = `artikelstamm_${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  }
  async function importCsv(file: File) {
    setErr(null); setInfo(null);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) { setErr("CSV enthält keine Datenzeilen."); return; }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (c: string) => header.indexOf(c);
      const g = (r: string[], c: string) => (idx(c) >= 0 ? (r[idx(c)] ?? "").trim() : "");
      const numv = (str: string) => round2(Number((str || "0").replace(/\./g, "").replace(",", ".")) || 0);
      const recs = rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => {
        const an = g(r, "article_number") || g(r, "artikelnummer") || null;
        return ({
        article_number: an,
        positions_nummer: g(r, "positions_nummer") || g(r, "positionsnummer") || (an && an.includes("-") ? an.split("-")[1] : null),
        name: g(r, "name") || g(r, "bezeichnung") || g(r, "artikelname"),
        description: g(r, "description") || g(r, "beschreibung") || null,
        category: g(r, "category") || g(r, "kategorie") || null,
        unit: g(r, "unit") || g(r, "einheit") || "Stk",
        purchase_price: numv(g(r, "purchase_price") || g(r, "einkaufspreis")),
        sale_price: numv(g(r, "sale_price") || g(r, "verkaufspreis")),
        list_price: numv(g(r, "list_price") || g(r, "listenpreis")),
        vat_rate: numv(g(r, "vat_rate") || g(r, "mwst")) || 20,
        supplier: g(r, "supplier") || g(r, "lieferant") || null,
        supplier_email: g(r, "supplier_email") || g(r, "lieferanten-e-mail") || null,
        calculation_text: g(r, "calculation_text") || g(r, "berechnung") || null,
        is_stock: /^(1|true|ja|x)$/i.test(g(r, "is_stock") || g(r, "lagerartikel")),
        active: g(r, "active") || g(r, "aktiv") ? /^(1|true|ja|x)$/i.test(g(r, "active") || g(r, "aktiv")) : true,
      }); }).filter((rec) => rec.name);
      if (recs.length === 0) { setErr("Keine gültigen Zeilen (Spalte „name“/„Artikelname“ erforderlich)."); return; }
      const { error } = await supabase.from("articles").insert(recs);
      if (error) setErr(error.message); else { setInfo(`${recs.length} Artikel importiert.`); load(); }
    } catch (e: any) { setErr(e?.message ?? "Import fehlgeschlagen."); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Suche: Nr., Name, Beschreibung, Lieferant, Artikel-Mail" />
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
          <button className="btn-outline" onClick={() => fileRef.current?.click()}><Upload size={16} /> Import</button>
          <button className="btn-outline" onClick={exportCsv} disabled={list.length === 0}><Download size={16} /> Export</button>
          <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Neuer Artikel</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input max-w-[12rem]" value={fTrade} onChange={(e) => setFTrade(e.target.value)}>
          <option value="">Alle Gewerke</option>
          {trades.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input max-w-[12rem]" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}>
          <option value="">Alle Lieferanten</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-[10rem]" value={fUnit} onChange={(e) => setFUnit(e.target.value)}>
          <option value="">Alle Einheiten</option>
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        {(fTrade || fSupplier || fUnit || q) && (
          <button className="btn-ghost" onClick={() => { setFTrade(""); setFSupplier(""); setFUnit(""); setQ(""); }}>Filter zurücksetzen</button>
        )}
      </div>

      <ErrorBanner message={err} />
      {info && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">{info}</div>}

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Artikel" hint="Lege Artikel an (mit Bild, Gewerk, Einheit, Preisen netto) oder importiere per CSV." />
      ) : shown.length === 0 ? (
        <Empty title="Keine Treffer" hint="Suche oder Filter anpassen." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 w-16">Bild</th>
                <SortHeader label="Artikelnr." sortKey="nr" sort={artSort.sort} onSort={artSort.onSort} />
                <SortHeader label="Artikelname" sortKey="name" sort={artSort.sort} onSort={artSort.onSort} />
                <SortHeader label="Gewerk" sortKey="trade" sort={artSort.sort} onSort={artSort.onSort} />
                <SortHeader label="Einheit" sortKey="unit" sort={artSort.sort} onSort={artSort.onSort} />
                <SortHeader label="EK netto" sortKey="ek" sort={artSort.sort} onSort={artSort.onSort} align="right" />
                <SortHeader label="VK netto" sortKey="vk" sort={artSort.sort} onSort={artSort.onSort} align="right" />
                <SortHeader label="MwSt" sortKey="vat" sort={artSort.sort} onSort={artSort.onSort} align="right" />
                <SortHeader label="Lager" sortKey="stock" sort={artSort.sort} onSort={artSort.onSort} align="center" />
                <SortHeader label="Status" sortKey="status" sort={artSort.sort} onSort={artSort.onSort} />
                <SortHeader label="Letzte Änderung" sortKey="updated" sort={artSort.sort} onSort={artSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((a) => (
                <tr
                  key={a.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => setEdit(a)}
                >
                  <td className="px-4 py-2">
                    {a.image_url
                      ? <SignedImage bucket="article-images" value={a.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      : <div className="grid h-10 w-10 place-items-center rounded-lg text-slate-300" style={{ background: "var(--hover)" }}><ImagePlus size={16} /></div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{a.article_number ?? "–"}</td>
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-slate-500">{tradeName(a.trade_id)}</td>
                  <td className="px-4 py-3 text-slate-500">{a.unit ?? "–"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{eur(a.purchase_price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(a.sale_price)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{a.vat_rate}%</td>
                  <td className="px-4 py-3 text-center">{a.is_stock ? <Badge tone="green">Lager</Badge> : <span className="text-slate-400">–</span>}</td>
                  <td className="px-4 py-3">{a.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{dateAt(a.updated_at)}</td>
                  {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title={a.active ? "Deaktivieren" : "Aktivieren"} onClick={() => toggleActive(a)}><Power size={16} /></button>
                      <button className="btn-ghost px-2" title="Duplizieren" onClick={() => duplicate(a)}><Copy size={16} /></button>
                      <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit(a)}><Pencil size={16} /></button>
                      <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => setDel(a)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <ArticleForm article={edit === "new" ? null : edit} trades={trades} articles={list} unitOpts={centralUnits.length ? centralUnits : [...ARTICLE_UNITS]}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      <ConfirmDialog open={!!del} title="Artikel löschen?" message={<>Soll <b>{del?.name}</b> dauerhaft gelöscht werden?</>} busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </>
  );
}

function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, ""); // BOM entfernen
  const first = t.split("\n")[0];
  const delim = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

