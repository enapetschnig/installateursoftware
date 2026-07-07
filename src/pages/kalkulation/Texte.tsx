import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Copy, Trash2, Power, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "../../components/ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "../../components/calc-ui";
import { Trade } from "../../lib/calc-types";
import { dateAt } from "../../lib/format";
import RichTextEditor from "../../components/RichTextEditor";
import {
  TextBlock, TEXT_BLOCK_COLUMNS, TEXT_TYPES, TextType, textTypeLabel,
  htmlToPlain, blockHtml,
} from "../../lib/text-blocks";
import { DOC_PLACEHOLDER_CATALOG } from "../../lib/document-placeholders";
import { DocumentType, loadDocumentTypes, DocumentSubtype, loadDocumentSubtypes } from "../../lib/documents";
import { SortHeader } from "../../components/SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";

type ProjectType = { id: string; label: string; active: boolean; sort_order: number };

const CUSTOMER_TYPES = [
  { value: "", label: "Alle Kundentypen" },
  { value: "firma", label: "Firma" },
  { value: "privat", label: "Privat" },
];

const ALL = "ALL"; // Sentinel für „Alle Dokumententypen"

export default function Texte() {
  const [list, setList] = useState<TextBlock[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [subtypes, setSubtypes] = useState<DocumentSubtype[]>([]);
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filter
  const [q, setQ] = useState("");
  const [fType, setFType] = useState("");
  const [fDoc, setFDoc] = useState("");
  const [fProj, setFProj] = useState("");
  const [fActive, setFActive] = useState(""); // ""|"1"|"0"

  const [edit, setEdit] = useState<TextBlock | "new" | null>(null);
  const [del, setDel] = useState<TextBlock | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    const [t, tr, dt, st, pt] = await Promise.all([
      supabase.from("text_blocks").select(TEXT_BLOCK_COLUMNS).eq("type", "text").order("sort_order").order("title"),
      supabase.from("trades").select("*").eq("active", true).order("sort_order").order("name"),
      loadDocumentTypes(false).catch(() => [] as DocumentType[]),
      loadDocumentSubtypes(false).catch(() => [] as DocumentSubtype[]),
      supabase.from("project_types").select("id,label,active,sort_order").eq("active", true).order("sort_order").order("label"),
    ]);
    if (t.error) setErr(t.error.message);
    setList((t.data as unknown as TextBlock[]) ?? []);
    setTrades((tr.data as Trade[]) ?? []);
    setDocTypes(dt);
    setSubtypes(st);
    setProjectTypes((pt.data as ProjectType[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const docName = useMemo(() => new Map(docTypes.map((d) => [d.id, d.name])), [docTypes]);
  const subName = useMemo(() => new Map(subtypes.map((s) => [s.id, s.name])), [subtypes]);
  const projName = useMemo(() => new Map(projectTypes.map((p) => [p.id, p.label])), [projectTypes]);

  const nextSort = list.length ? Math.max(...list.map((r) => r.sort_order)) + 10 : 10;

  const shown = list.filter((r) => {
    if (fType && r.text_type !== fType) return false;
    if (fDoc) {
      if (fDoc === ALL ? !r.applies_to_all_doctypes : r.document_type_id !== fDoc) return false;
    }
    if (fProj && r.project_type_id !== fProj) return false;
    if (fActive === "1" && !r.active) return false;
    if (fActive === "0" && r.active) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return [r.title, r.category, r.content, htmlToPlain(r.content_html)]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
  });

  const docLabelOf = (r: TextBlock) =>
    r.applies_to_all_doctypes ? "Alle" : (r.document_type_id ? docName.get(r.document_type_id) ?? "–" : "–");

  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const textSort = useTableSort<TextBlock>(
    "kalk_texte",
    {
      nr: { get: (r) => r.sort_order, type: "number" },
      title: { get: (r) => r.title, type: "text" },
      textType: { get: (r) => textTypeLabel(r.text_type), type: "text" },
      docType: { get: (r) => docLabelOf(r), type: "text" },
      subtype: { get: (r) => (r.document_subtype_id ? subName.get(r.document_subtype_id) : null), type: "text" },
      projType: { get: (r) => (r.project_type_id ? projName.get(r.project_type_id) : null), type: "text" },
      custType: { get: (r) => r.customer_type, type: "text" },
      status: { get: (r) => (r.active ? 0 : 1), type: "number" },
      updated: { get: (r) => r.updated_at, type: "date" },
    },
    { userId, default: { key: "nr", dir: "asc" } }
  );
  const shownSorted = textSort.sortRows(shown);

  async function toggleActive(r: TextBlock) {
    const { error } = await supabase.from("text_blocks").update({ active: !r.active }).eq("id", r.id);
    if (error) setErr(error.message); else load();
  }
  async function duplicate(r: TextBlock) {
    const { error } = await supabase.from("text_blocks").insert({
      type: "text", title: `${r.title} (Kopie)`, content: r.content, content_html: r.content_html,
      text_type: r.text_type, category: r.category, doc_type: r.doc_type,
      document_type_id: r.document_type_id, document_subtype_id: r.document_subtype_id,
      project_type_id: r.project_type_id, customer_type: r.customer_type, trade_id: r.trade_id,
      language: r.language, is_default: false, applies_to_all_doctypes: r.applies_to_all_doctypes,
      sort_order: nextSort, active: r.active,
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Text suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">Alle Texttypen</option>
            {TEXT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <select className="input w-auto" value={fDoc} onChange={(e) => setFDoc(e.target.value)}>
            <option value="">Alle Dokumentarten</option>
            <option value={ALL}>Alle Dokumententypen (allgemein)</option>
            {docTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="input w-auto" value={fProj} onChange={(e) => setFProj(e.target.value)}>
            <option value="">Alle Projektarten</option>
            {projectTypes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select className="input w-auto" value={fActive} onChange={(e) => setFActive(e.target.value)}>
            <option value="">Aktiv & inaktiv</option>
            <option value="1">Nur aktive</option>
            <option value="0">Nur inaktive</option>
          </select>
        </div>
        <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Neuer Textbaustein</button>
      </div>
      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Textbausteine" hint="Vor-/Nachtexte, Leistungstexte, Rechtstexte u.v.m. zentral für alle Dokumententypen verwalten." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nr." sortKey="nr" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" className="w-12" />
                <SortHeader label="Bezeichnung" sortKey="title" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" />
                <SortHeader label="Texttyp" sortKey="textType" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" />
                <SortHeader label="Dokumententyp" sortKey="docType" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" />
                <SortHeader label="Untertyp" sortKey="subtype" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" />
                <SortHeader label="Projektart" sortKey="projType" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" />
                <SortHeader label="Kundentyp" sortKey="custType" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" />
                <SortHeader label="Status" sortKey="status" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" />
                <SortHeader label="Geändert" sortKey="updated" sort={textSort.sort} onSort={textSort.onSort} padClass="px-3 py-3" />
                <th className="px-3 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => setEdit(r)}
                >
                  <td className="px-3 py-3 tabular-nums font-semibold text-slate-400">{r.sort_order}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{r.title}</div>
                    {(r.content_html || r.content) && (
                      <div className="line-clamp-1 max-w-xs text-xs text-slate-400">{htmlToPlain(r.content_html) || r.content}</div>
                    )}
                  </td>
                  <td className="px-3 py-3"><Badge tone="blue">{textTypeLabel(r.text_type)}</Badge></td>
                  <td className="px-3 py-3 text-slate-500">{docLabelOf(r)}</td>
                  <td className="px-3 py-3 text-slate-500">{r.document_subtype_id ? subName.get(r.document_subtype_id) ?? "–" : "–"}</td>
                  <td className="px-3 py-3 text-slate-500">{r.project_type_id ? projName.get(r.project_type_id) ?? "–" : "–"}</td>
                  <td className="px-3 py-3 text-slate-500">{r.customer_type ? (r.customer_type === "firma" ? "Firma" : "Privat") : "–"}</td>
                  <td className="px-3 py-3">{r.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  <td className="px-3 py-3 text-xs text-slate-400">{dateAt(r.updated_at)}</td>
                  {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
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

      {edit && (
        <TextForm
          row={edit === "new" ? null : edit}
          trades={trades} docTypes={docTypes} subtypes={subtypes} projectTypes={projectTypes}
          nextSort={nextSort} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }}
        />
      )}
      <ConfirmDialog open={!!del} title="Textbaustein löschen?"
        message={<>Soll <b>{del?.title}</b> gelöscht werden? Bereits in Dokumente eingefügte Texte bleiben dort erhalten.</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </>
  );
}

function TextForm({ row, trades, docTypes, subtypes, projectTypes, nextSort, onClose, onSaved }: {
  row: TextBlock | null; trades: Trade[]; docTypes: DocumentType[]; subtypes: DocumentSubtype[];
  projectTypes: ProjectType[]; nextSort: number; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    title: row?.title ?? "",
    content_html: row ? blockHtml(row) : "",
    text_type: (row?.text_type ?? "dokument_nachtext") as TextType,
    category: row?.category ?? "",
    // "ALL" = alle Dokumententypen, sonst document_type_id
    docSel: row ? (row.applies_to_all_doctypes ? ALL : (row.document_type_id ?? ALL)) : ALL,
    document_subtype_id: row?.document_subtype_id ?? "",
    project_type_id: row?.project_type_id ?? "",
    customer_type: row?.customer_type ?? "",
    trade_id: row?.trade_id ?? "",
    language: row?.language ?? "de",
    is_default: row?.is_default ?? false,
    sort_order: row?.sort_order ?? nextSort,
    active: row?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  const isLeistung = f.text_type === "leistungstext";
  const isAllDocs = f.docSel === ALL;
  const availSubtypes = isAllDocs ? [] : subtypes.filter((s) => s.document_type_id === f.docSel);

  async function save() {
    setErr(null);
    if (!f.title.trim()) { setErr("Bitte eine Bezeichnung eingeben."); return; }
    setBusy(true);
    const html = f.content_html;
    const payload = {
      type: "text",
      title: f.title.trim(),
      content: htmlToPlain(html),     // Plaintext-Fallback
      content_html: html || null,
      text_type: f.text_type,
      category: f.category.trim() || null,
      document_type_id: isAllDocs ? null : f.docSel,
      applies_to_all_doctypes: isAllDocs,
      document_subtype_id: isAllDocs ? null : (f.document_subtype_id || null),
      project_type_id: f.project_type_id || null,
      customer_type: f.customer_type || null,
      trade_id: isLeistung ? (f.trade_id || null) : null,
      language: f.language || "de",
      is_default: f.is_default,
      sort_order: Number(f.sort_order) || 0,
      active: f.active,
    };
    const res = row
      ? await supabase.from("text_blocks").update(payload).eq("id", row.id)
      : await supabase.from("text_blocks").insert(payload);
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
    <Modal open onClose={onClose} title={row ? "Textbaustein bearbeiten" : "Neuer Textbaustein"} size="xl">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label label-req">Bezeichnung</label>
          <input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="z.B. Allgemeiner Nachtext Angebote" /></div>

        <div><label className="label label-req">Texttyp</label>
          <select className="input" value={f.text_type} onChange={(e) => set("text_type", e.target.value)}>
            {TEXT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-400">{TEXT_TYPES.find((t) => t.key === f.text_type)?.help}</p>
        </div>
        <div><label className="label">Kategorie</label>
          <input className="input" value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="z.B. Zahlung, Hinweis …" /></div>

        <div><label className="label">Dokumentart</label>
          <select className="input" value={f.docSel} onChange={(e) => { set("docSel", e.target.value); set("document_subtype_id", ""); }}>
            <option value={ALL}>Alle Dokumententypen (allgemein)</option>
            {docTypes.map((d) => <option key={d.id} value={d.id}>{d.name}{d.is_active ? "" : " (inaktiv)"}</option>)}
          </select>
        </div>
        <div><label className="label">Dokument-Untertyp</label>
          <select className="input" value={f.document_subtype_id} disabled={isAllDocs || availSubtypes.length === 0}
            onChange={(e) => set("document_subtype_id", e.target.value)}>
            <option value="">{availSubtypes.length === 0 ? "– keine Untertypen –" : "Alle Untertypen"}</option>
            {availSubtypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div><label className="label">Projektart</label>
          <select className="input" value={f.project_type_id} onChange={(e) => set("project_type_id", e.target.value)}>
            <option value="">Alle Projektarten</option>
            {projectTypes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div><label className="label">Kundentyp</label>
          <select className="input" value={f.customer_type} onChange={(e) => set("customer_type", e.target.value)}>
            {CUSTOMER_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        {isLeistung && (
          <div><label className="label">Gewerk (optional)</label>
            <select className="input" value={f.trade_id} onChange={(e) => set("trade_id", e.target.value)}>
              <option value="">– kein Gewerk –</option>
              {trades.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <div><label className="label">Sprache</label>
          <select className="input" value={f.language} onChange={(e) => set("language", e.target.value)}>
            <option value="de">Deutsch</option>
            <option value="en">Englisch</option>
          </select>
        </div>
        <div><label className="label">Sortierreihenfolge</label>
          <input type="number" className="input" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} /></div>

        <div className="sm:col-span-2"><label className="label">Textinhalt</label>
          <RichTextEditor value={f.content_html} onChange={(html) => set("content_html", html)} minHeight={180}
            placeholders={DOC_PLACEHOLDER_CATALOG}
            placeholder="Rich-Text mit Absätzen, Fett, Kursiv, Aufzählungen … Platzhalter z.B. {{kunde.name}}" />
          <p className="mt-1 text-xs text-slate-400">
            Platzhalter über die Schaltfläche „Platzhalter" einfügen – sie werden beim Erstellen des Dokuments automatisch gefüllt.
          </p>
        </div>

        <div className="flex items-center gap-6 pb-1 sm:col-span-2">
          <Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" />
          <Toggle checked={f.is_default} onChange={(v) => set("is_default", v)} label="Standardtext automatisch einfügen" />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !f.title.trim()} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}
