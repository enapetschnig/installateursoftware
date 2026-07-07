import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, ExternalLink, Download, Trash2, FileText, Search,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { openSignedUrl } from "../../lib/storage";
import { Spinner, Empty, Badge, Modal } from "../ui";
import { ErrorBanner, ConfirmDialog } from "../calc-ui";
import { dateAt, eur } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { logProject } from "../../lib/projectlog";
import {
  DocumentType, DocumentRow, loadProjectDocuments, uploadProjectDocument,
  UPLOAD_ACCEPT, parseEmlMeta, DOC_STATUS_TONE, docStatusLabel,
} from "../../lib/documents";
import { OFFER_STATUS_LABEL, OFFER_STATUS_TONE } from "../../lib/offer-types";
import { ORDER_STATUS_LABEL } from "../../lib/types";
import { orderStatusTone } from "../../lib/order-status";
import DocumentCreateMenu, { ChainKind, DocumentCreateOpts } from "../document/DocumentCreateMenu";
import { OfferType } from "../../lib/offer-kinds";
import { loadVersionMap } from "../../lib/document-versions";
import { docPath } from "../../lib/documents-overview";
import { SortHeader } from "../SortHeader";
import { useTableSort } from "../../lib/useTableSort";

type Tone = "slate" | "blue" | "green" | "amber" | "red";
type Item = {
  key: string; art: string; number: string; title: string;
  status: string; tone: Tone; date: string; rawDate: string | null; who: string;
  fileUrl?: string | null; href?: string | null; net?: number | null; gross?: number | null;
  source: "native" | "upload"; docId?: string; version?: number | null;
};

export default function ProjectDocuments({
  projectId, customerId, types, names, filterTypeId, onCreated,
  onCreate, onCreateGeneric, onCreateSub,
}: {
  projectId: string;
  customerId: string | null;
  types: DocumentType[];
  names: Record<string, string>;
  filterTypeId?: string | null;       // gesetzt → nur Upload-Dokumente dieser Art
  onCreated: () => void;              // Counts neu laden
  // Zentrale Dokument-Erstellung (identisch zum Projektkopf-Button):
  onCreate: (kind: ChainKind, offerType: OfferType | null, opts?: DocumentCreateOpts) => void;
  onCreateGeneric?: (docType: DocumentType) => void | Promise<void>;
  onCreateSub?: (offerType: OfferType | null) => void;
}) {
  const nav = useNavigate();
  const { session } = useAuth();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [del, setDel] = useState<DocumentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [verMap, setVerMap] = useState<Map<string, number>>(new Map());

  const filterType = filterTypeId ? types.find((t) => t.id === filterTypeId) : null;
  const typeName = (id: string | null) => types.find((t) => t.id === id)?.name ?? "Dokument";

  // Zeile öffnet das Dokument: native Dokumente (Angebot/Auftrag/Rechnung) per Route,
  // hochgeladene Dokumente per Datei-Link. Zentral genutzt von Zeilen-Klick + „Öffnen"-Button.
  const isOpenable = (i: Item) => !!(i.href || i.fileUrl);
  const openItem = (i: Item) => {
    if (i.href) nav(i.href);
    // project-files ist privat (F-02) → signierte URL auflösen und öffnen.
    else if (i.fileUrl) openSignedUrl("project-files", i.fileUrl);
  };

  async function load() {
    setLoading(true); setErr(null);
    try {
      const d = await loadProjectDocuments(projectId);
      setDocs(d);
      if (!filterTypeId) {
        const [o, a, r] = await Promise.all([
          supabase.from("offers").select("id,number,title,status,net,gross,created_at,created_by").eq("project_id", projectId),
          // Storniert ist NICHT gelöscht: stornierte Aufträge bleiben sichtbar/suchbar
          // (klar rot markiert); nur gelöschte bleiben über die Soft-Delete-RLS ausgeblendet.
          supabase.from("orders").select("id,order_number,title,status,gross,order_date,created_at").eq("project_id", projectId),
          supabase.from("invoices").select("id,number,gross,doc_status,locked,payment_status,invoice_date,created_at").eq("project_id", projectId),
        ]);
        setOffers(o.data ?? []); setOrders(a.data ?? []); setInvoices(r.data ?? []);
        // Aktuelle Versionsnummer je Dokument (für das V-Badge in der Liste)
        const ids = [
          ...((o.data as any[]) ?? []).map((x) => x.id),
          ...((a.data as any[]) ?? []).map((x) => x.id),
          ...((r.data as any[]) ?? []).map((x) => x.id),
        ];
        setVerMap(await loadVersionMap(ids));
      }
    } catch (e: any) { setErr(e?.message ?? "Fehler beim Laden."); }
    setLoading(false);
  }
  // load bewusst nicht in den Deps: Neuladen nur bei Projekt-/Filterwechsel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [projectId, filterTypeId]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (!filterTypeId) {
      for (const o of offers) out.push({
        key: "o" + o.id, art: "Angebot", number: o.number || "Entwurf", title: o.title || "–",
        status: OFFER_STATUS_LABEL[o.status as keyof typeof OFFER_STATUS_LABEL] ?? o.status,
        tone: (OFFER_STATUS_TONE[o.status as keyof typeof OFFER_STATUS_TONE] ?? "slate") as Tone,
        date: dateAt(o.created_at), rawDate: o.created_at ?? null, who: o.created_by ? (names[o.created_by] || "–") : "–",
        net: o.net, gross: o.gross, href: docPath("offer", o.id, o.number), source: "native", version: verMap.get(o.id) ?? null,
      });
      for (const a of orders) out.push({
        key: "a" + a.id, art: "Auftrag", number: a.order_number || "–", title: a.title || "–",
        status: ORDER_STATUS_LABEL[a.status as keyof typeof ORDER_STATUS_LABEL] ?? a.status,
        tone: orderStatusTone(a.status),
        date: dateAt(a.order_date || a.created_at), rawDate: a.order_date || a.created_at || null, who: "–", gross: a.gross,
        href: docPath("order", a.id, a.order_number), source: "native", version: verMap.get(a.id) ?? null,
      });
      for (const r of invoices) out.push({
        key: "r" + r.id, art: "Rechnung", number: r.number || "Entwurf", title: "–",
        status: r.doc_status === "storniert" ? "Storniert" : (!r.locked ? "Entwurf" : (r.payment_status === "bezahlt" ? "Bezahlt" : "Finalisiert")),
        tone: (r.doc_status === "storniert" ? "red" : !r.locked ? "slate" : r.payment_status === "bezahlt" ? "green" : "blue") as Tone,
        date: dateAt(r.invoice_date || r.created_at), rawDate: r.invoice_date || r.created_at || null, who: "–", gross: r.gross,
        href: docPath("invoice", r.id, r.number), source: "native", version: verMap.get(r.id) ?? null,
      });
    }
    for (const d of docs) {
      if (filterTypeId && d.document_type_id !== filterTypeId) continue;
      out.push({
        key: "d" + d.id, art: typeName(d.document_type_id), number: d.document_number || "–",
        title: d.title || d.file_name || "–", status: docStatusLabel(d.status),
        tone: (DOC_STATUS_TONE[d.status] ?? "slate") as Tone,
        date: dateAt(d.doc_date || d.created_at),
        rawDate: d.doc_date || d.created_at || null,
        who: (d.uploaded_by && names[d.uploaded_by]) || (d.created_by && names[d.created_by]) || "–",
        // Hochgeladene Datei → Download; in der App erstelltes (Text-)Dokument → eigener Editor.
        fileUrl: d.file_url, href: d.file_url ? null : `/dokumente/${d.id}`,
        source: "upload", docId: d.id,
      });
    }
    const s = q.trim().toLowerCase();
    return out
      .filter((i) => !s || [i.art, i.number, i.title, i.status].some((v) => v.toLowerCase().includes(s)));
    // typeName hängt nur von der types-Prop ab (stabil je Projektakte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, offers, orders, invoices, q, filterTypeId, names, verMap]);

  const itemSort = useTableSort<Item>(
    "project_documents",
    {
      art: { get: (i) => i.art, type: "text" },
      number: { get: (i) => (i.number === "–" ? null : i.number), type: "text" },
      title: { get: (i) => (i.title === "–" ? null : i.title), type: "text" },
      status: { get: (i) => i.status, type: "text" },
      gross: { get: (i) => i.gross, type: "number" },
      date: { get: (i) => i.rawDate, type: "date" },
      who: { get: (i) => (i.who === "–" ? null : i.who), type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "date", dir: "desc" } }
  );
  const itemsSorted = useMemo(() => itemSort.sortRows(items), [itemSort, items]);

  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    const { error } = await supabase.from("documents").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); onCreated(); }
  }

  const heading = filterType ? filterType.name : "Dokumente";

  return (
    <div className="glass p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold"><FileText size={18} /> {heading}</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => setUploadOpen(true)}><Upload size={15} /> Hochladen</button>
          {/* Zentrale Dokument-Erstellung – identisch zum Button im Projektkopf */}
          <DocumentCreateMenu
            onCreate={onCreate}
            onCreateSub={onCreateSub}
            onCreateGeneric={onCreateGeneric ? async (dt) => { await onCreateGeneric(dt); await load(); onCreated(); } : undefined}
            label="Dokument erstellen"
            buttonClassName="btn-primary"
          />
        </div>
      </div>

      <div className="mb-3 relative max-w-xs">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Dokumente durchsuchen …" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <ErrorBanner message={err} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Empty title="Noch keine Dokumente" hint="Lade Dateien hoch oder erstelle ein Dokument (Angebot, Auftrag, Rechnung …)." />
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Art" sortKey="art" sort={itemSort.sort} onSort={itemSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Nummer" sortKey="number" sort={itemSort.sort} onSort={itemSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Betreff" sortKey="title" sort={itemSort.sort} onSort={itemSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Status" sortKey="status" sort={itemSort.sort} onSort={itemSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Brutto" sortKey="gross" sort={itemSort.sort} onSort={itemSort.onSort} align="right" padClass="px-3 py-2" />
                <SortHeader label="Datum" sortKey="date" sort={itemSort.sort} onSort={itemSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Von" sortKey="who" sort={itemSort.sort} onSort={itemSort.onSort} padClass="px-3 py-2" />
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {itemsSorted.map((i) => (
                <tr key={i.key}
                  className={`hover:bg-slate-50 dark:hover:bg-white/5 ${isOpenable(i) ? "cursor-pointer" : ""}`}
                  onClick={isOpenable(i) ? () => openItem(i) : undefined}
                  role={isOpenable(i) ? "button" : undefined}
                  tabIndex={isOpenable(i) ? 0 : undefined}
                  title={isOpenable(i) ? "Dokument öffnen" : undefined}
                  onKeyDown={isOpenable(i) ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openItem(i); } } : undefined}
                >
                  <td className="px-3 py-2"><Badge tone="slate">{i.art}</Badge></td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {i.number}
                    {i.version ? <span className="ml-1.5 rounded bg-[var(--hover)] px-1 text-[10px] font-semibold text-slate-500" title={`Aktuelle Version: V${i.version}`}>V{i.version}</span> : null}
                  </td>
                  <td className="px-3 py-2 max-w-[200px]"><div className="truncate">{i.title}</div></td>
                  <td className="px-3 py-2"><Badge tone={i.tone}>{i.status}</Badge></td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{i.gross != null ? eur(i.gross) : "–"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{i.date}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{i.who}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {i.href && <button className="btn-ghost px-2" title="Öffnen" onClick={(e) => { e.stopPropagation(); nav(i.href!); }}><ExternalLink size={15} /></button>}
                      {i.fileUrl && <button className="btn-ghost px-2" title="Datei herunterladen" onClick={(e) => { e.stopPropagation(); openSignedUrl("project-files", i.fileUrl); }}><Download size={15} /></button>}
                      {i.source === "upload" && i.docId && (
                        <button className="btn-ghost px-2 text-rose-500" title="Löschen"
                          onClick={(e) => { e.stopPropagation(); setDel(docs.find((d) => d.id === i.docId) ?? null); }}><Trash2 size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uploadOpen && (
        <UploadDialog
          projectId={projectId} customerId={customerId} types={types}
          defaultTypeId={filterTypeId ?? null} uploadedBy={session?.user.id ?? null}
          onClose={() => setUploadOpen(false)}
          onDone={() => { setUploadOpen(false); load(); onCreated(); }}
        />
      )}
      <ConfirmDialog open={!!del} title="Dokument löschen?"
        message={<>Soll <b>{del?.title || del?.file_name}</b> dauerhaft gelöscht werden?</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </div>
  );
}

// ───────────────────────── Hochladen ─────────────────────────
function UploadDialog({ projectId, customerId, types, defaultTypeId, uploadedBy, onClose, onDone }: {
  projectId: string; customerId: string | null; types: DocumentType[];
  defaultTypeId: string | null; uploadedBy: string | null;
  onClose: () => void; onDone: () => void;
}) {
  const uploadable = types.filter((t) => t.is_active && t.allow_upload);
  const [files, setFiles] = useState<File[]>([]);
  const [typeId, setTypeId] = useState(defaultTypeId || uploadable[0]?.id || "");
  const [f, setF] = useState({ title: "", subject: "", sender: "", recipient: "", version: "", docDate: "", note: "", status: "erhalten" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    const arr = Array.from(list);
    setFiles(arr);
    const meta = await parseEmlMeta(arr[0]);
    if (meta.subject || meta.from) setF((p) => ({ ...p, title: p.title || arr[0].name, subject: p.subject || meta.subject || "", sender: p.sender || meta.from || "" }));
    else if (!f.title) set("title", arr[0].name);
  }

  async function save() {
    setErr(null);
    if (!files.length) { setErr("Bitte mindestens eine Datei auswählen."); return; }
    const dt = uploadable.find((t) => t.id === typeId);
    if (!dt) { setErr("Bitte einen Dokumenttyp wählen."); return; }
    setBusy(true);
    try {
      for (const file of files) {
        await uploadProjectDocument({
          projectId, customerId, file, documentType: dt,
          title: files.length === 1 ? (f.title || file.name) : file.name,
          subject: f.subject || null, status: f.status, sender: f.sender || null,
          recipient: f.recipient || null, version: f.version || null,
          docDate: f.docDate || null, note: f.note || null, uploadedBy,
        });
        await logProject(projectId, "dokument", `Dokument hochgeladen: ${file.name} (${dt.name})`);
      }
      onDone();
    } catch (e: any) { setErr(e?.message ?? "Upload fehlgeschlagen."); }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title="Dokument hochladen" size="xl">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label label-req">Datei(en)</label>
          <input ref={fileRef} type="file" multiple accept={UPLOAD_ACCEPT} className="input"
            onChange={(e) => pick(e.target.files)} />
          {files.length > 0 && <p className="mt-1 text-xs text-slate-400">{files.length} Datei(en) ausgewählt: {files.map((x) => x.name).join(", ")}</p>}
        </div>
        <div><label className="label label-req">Dokumenttyp</label>
          <select className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {uploadable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div><label className="label">Status</label>
          <select className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="erhalten">Erhalten</option>
            <option value="unterschrieben">Unterschrieben</option>
            <option value="abgeschlossen">Abgeschlossen</option>
            <option value="versendet">Versendet</option>
          </select></div>
        <div className="sm:col-span-2"><label className="label">Betreff / Titel</label>
          <input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="optional – sonst Dateiname" /></div>
        <div><label className="label">Absender</label>
          <input className="input" value={f.sender} onChange={(e) => set("sender", e.target.value)} /></div>
        <div><label className="label">Empfänger</label>
          <input className="input" value={f.recipient} onChange={(e) => set("recipient", e.target.value)} /></div>
        <div><label className="label">Datum</label>
          <input type="date" className="input" value={f.docDate} onChange={(e) => set("docDate", e.target.value)} /></div>
        <div><label className="label">Version</label>
          <input className="input" value={f.version} onChange={(e) => set("version", e.target.value)} placeholder="z.B. v1" /></div>
        <div className="sm:col-span-2"><label className="label">Beschreibung / Bemerkung</label>
          <textarea className="input min-h-[60px]" value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !files.length} onClick={save}>{busy ? "Lädt …" : "Hochladen"}</button>
      </div>
    </Modal>
  );
}

