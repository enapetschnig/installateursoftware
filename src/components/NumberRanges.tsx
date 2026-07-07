import { useEffect, useMemo, useState } from "react";
import { Lock, ShieldCheck, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { NumberRange, numberPreview } from "../lib/types";
import { Toggle, ErrorBanner } from "./calc-ui";
import { DocumentType, loadDocumentTypes } from "../lib/documents";
import { groupNumberRanges } from "../lib/number-range-groups";

const slugPrefix = (s: string) =>
  s.toUpperCase().replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE").replace(/ß/g, "SS")
    .replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18) || "DOK";

export default function NumberRanges({ canManage }: { canManage: boolean }) {
  const [list, setList] = useState<NumberRange[]>([]);
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [addId, setAddId] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const [nr, dt] = await Promise.all([
      supabase.from("number_ranges").select("*").order("label"),
      loadDocumentTypes(true).catch(() => [] as DocumentType[]),
    ]);
    if (nr.error) setErr(nr.error.message);
    setList((nr.data as NumberRange[]) ?? []);
    setDocTypes(dt);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Dokumentarten, die noch keinen Nummernkreis haben (per ID oder Slug abgedeckt)
  const available = useMemo(() => {
    const byId = new Set(list.map((r) => r.document_type_id).filter(Boolean) as string[]);
    const bySlug = new Set(list.map((r) => (r.doc_type || "").toLowerCase()));
    return docTypes.filter((d) => !byId.has(d.id) && !bySlug.has(d.slug.toLowerCase()));
  }, [list, docTypes]);

  async function addRange() {
    const dt = docTypes.find((d) => d.id === addId);
    if (!dt) return;
    setAdding(true); setErr(null);
    const { error } = await supabase.from("number_ranges").insert({
      doc_type: dt.slug, document_type_id: dt.id, label: dt.name,
      prefix: slugPrefix(dt.slug), use_year: false, separator: "-",
      min_digits: 4, next_number: 1, active: true, protected: false,
    });
    setAdding(false);
    if (error) {
      setErr(/duplicate|unique|uniq_number_ranges|23505/i.test(`${error.message} ${(error as any).code ?? ""}`)
        ? "Für diese Dokumentart existiert bereits ein Nummernkreis."
        : error.message);
      return;
    }
    setAddId(""); load();
  }

  if (!canManage) {
    return (
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Nummernkreise</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nummernkreise können nur von Administrator, Geschäftsführung oder Buchhaltung verwaltet werden.
        </p>
      </div>
    );
  }

  return (
    <div className="glass p-4">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><ShieldCheck size={20} /> Nummernkreise</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Zentrale Verwaltung der Dokumentnummern – für jede Dokumentart eigener Nummernkreis möglich.
        Rechnungs- und Gutschriftnummern sind geschützt (fortlaufend, nicht rückwirkend änderbar).
      </p>
      <ErrorBanner message={err} />

      {/* Neuen Nummernkreis für eine Dokumentart anlegen */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-[16rem] flex-1">
          <label className="label">Nummernkreis für Dokumentart anlegen</label>
          <select className="input" value={addId} onChange={(e) => setAddId(e.target.value)} disabled={available.length === 0}>
            <option value="">{available.length === 0 ? "Alle Dokumentarten haben bereits einen Nummernkreis" : "Dokumentart wählen …"}</option>
            {available.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button className="btn-primary" disabled={!addId || adding} onClick={addRange}>
          <Plus size={16} /> {adding ? "Anlegen …" : "Anlegen"}
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-400">Lädt …</p> : (
        <div className="space-y-5">
          {groupNumberRanges(list, docTypes).map((g) => (
            <div key={g.title}>
              <h3 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{g.title}</h3>
              <div className="space-y-3">
                {g.rows.map((x) => <RangeRow key={x.range.id} range={x.range} displayLabel={x.label} onSaved={load} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RangeRow({ range, displayLabel, onSaved }: { range: NumberRange; displayLabel?: string; onSaved: () => void }) {
  const [f, setF] = useState({ ...range });
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const set = (k: keyof NumberRange, v: any) => { setF((p) => ({ ...p, [k]: v })); setSavedAt(null); };
  const dirty = JSON.stringify(f) !== JSON.stringify(range);

  async function save() {
    setBusy(true);
    const payload: any = {
      prefix: f.prefix, use_year: f.use_year, separator: f.separator,
      min_digits: Math.max(1, Number(f.min_digits) || 1), active: f.active, updated_at: new Date().toISOString(),
    };
    if (!range.protected) payload.next_number = Math.max(1, Number(f.next_number) || 1);
    const { error } = await supabase.from("number_ranges").update(payload).eq("id", range.id);
    setBusy(false);
    if (!error) { setSavedAt(new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })); onSaved(); }
  }

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          {displayLabel || f.label}
          {range.protected && <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Lock size={11} /> geschützt</span>}
        </div>
        <div className="text-sm">Vorschau: <b className="font-mono" style={{ color: "var(--accent)" }}>{numberPreview(f)}</b></div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-6">
        <div><label className="label">Präfix</label>
          <input className="input" value={f.prefix} disabled={range.protected} onChange={(e) => set("prefix", e.target.value)} /></div>
        <div><label className="label">Trennzeichen</label>
          <input className="input" value={f.separator} maxLength={2} onChange={(e) => set("separator", e.target.value)} /></div>
        <div><label className="label">Mindeststellen</label>
          <input type="number" min="1" max="8" className="input" value={f.min_digits} onChange={(e) => set("min_digits", Number(e.target.value))} /></div>
        <div><label className="label">Nächste Nr.</label>
          <input type="number" min="1" className="input" value={f.next_number} disabled={range.protected} onChange={(e) => set("next_number", Number(e.target.value))} />
          {range.protected && <p className="mt-0.5 text-[10px] text-slate-400">automatisch fortlaufend</p>}</div>
        <div className="flex items-end pb-1"><Toggle checked={f.use_year} onChange={(v) => set("use_year", v)} label="Jahr" /></div>
        <div className="flex items-end pb-1"><Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" disabled={range.protected} />
          {range.protected && <span className="ml-2 text-[10px] text-slate-400">geschützt – nicht deaktivierbar</span>}</div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-3">
        {savedAt && <span className="text-xs text-emerald-500">gespeichert {savedAt}</span>}
        <button className="btn-primary px-3 py-1.5 text-sm" disabled={busy || !dirty} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </div>
  );
}
