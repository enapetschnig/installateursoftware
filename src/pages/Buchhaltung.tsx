// ============================================================
// Installateur SuperAPP – Buchhaltung
// ------------------------------------------------------------
// Zwei Bereiche (Tabs):
//   • Eingangsrechnungen (Lieferantenrechnungen) – manuell ODER automatisch
//     aus dem smarten KI-Postfach (source='email'), inkl. Beleg-PDF.
//   • Offene Posten – unbezahlte AUSGANGSrechnungen (public.invoices).
// UI-Muster gespiegelt aus src/pages/Invoices.tsx (Header, KPI-Kacheln,
// Filter-Tabs, Glass-Tabelle mit SortHeader, Mobile-Karten). Rechte-Modul
// 'buchhaltung' (bereits vorhanden) via useCan.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Receipt, Trash2, Pencil, Paperclip, Mail, ExternalLink,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "../components/ui";
import { ConfirmDialog, ErrorBanner } from "../components/calc-ui";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/permissions";
import { eur, dateAt } from "../lib/format";
import { toast, toastError } from "../lib/toast";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";
import {
  type Eingangsrechnung, type EingangsrechnungStatus, type OpenPosten, type Beleg,
  EINGANG_STATUS_LABEL, EINGANG_STATUS_TONE, isOverdue, BELEG_ACCEPT,
  listEingangsrechnungen, listOpenPosten, createEingangsrechnung, updateEingangsrechnung,
  deleteEingangsrechnung, getEingangsrechnung, uploadBeleg, addBelegToInvoice, removeBeleg,
  belegUrl,
} from "../lib/buchhaltung";

type SupplierLite = { id: string; company: string | null; first_name: string | null; last_name: string | null; customer_type: string | null };
type ProjectLite = { id: string; title: string; project_number: string | null };

function supplierName(er: Eingangsrechnung, suppliers: SupplierLite[]): string {
  if (er.supplier_contact_id) {
    const s = suppliers.find((x) => x.id === er.supplier_contact_id);
    if (s) return s.customer_type === "firma" ? (s.company || "Firma") : [s.first_name, s.last_name].filter(Boolean).join(" ") || s.company || "Lieferant";
  }
  return er.supplier_name || "–";
}

// unbezahlt = weder bezahlt noch storniert (offen/geprueft/freigegeben)
const isUnpaid = (s: EingangsrechnungStatus) => s !== "bezahlt" && s !== "storniert";

const EINGANG_TABS: { key: "alle" | "offen" | "ueberfaellig" | "bezahlt" | "storniert"; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "offen", label: "Offen" },
  { key: "ueberfaellig", label: "Überfällig" },
  { key: "bezahlt", label: "Bezahlt" },
  { key: "storniert", label: "Storniert" },
];

export default function Buchhaltung() {
  const nav = useNavigate();
  const { session } = useAuth();
  const can = useCan();
  const mayCreate = can("buchhaltung", "create");
  const mayEdit = can("buchhaltung", "edit");
  const mayDelete = can("buchhaltung", "delete");

  const [mainTab, setMainTab] = useState<"eingang" | "offen">("eingang");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Eingangsrechnung[]>([]);
  const [posten, setPosten] = useState<OpenPosten[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [eTab, setETab] = useState<(typeof EINGANG_TABS)[number]["key"]>("alle");
  const [edit, setEdit] = useState<Eingangsrechnung | "new" | null>(null);
  const [del, setDel] = useState<Eingangsrechnung | null>(null);
  const [busy, setBusy] = useState(false);

  // `loading` gated NUR den Erst-Mount (Spinner). Reloads aus dem offenen Modal
  // laufen als „silent refresh" – sonst würde der loading-Spinner das Modal
  // unmounten und den Beleg-/Erst-Speichern-Flow abreißen.
  async function load(initial = false) {
    if (initial) setLoading(true);
    setErr(null);
    try {
      const [er, op, sup, proj] = await Promise.all([
        listEingangsrechnungen(),
        listOpenPosten().catch(() => [] as OpenPosten[]),
        supabase.from("contacts").select("id,company,first_name,last_name,customer_type").eq("type", "lieferant"),
        supabase.from("projects").select("id,title,project_number").eq("archived", false),
      ]);
      setRows(er);
      setPosten(op);
      setSuppliers((sup.data as SupplierLite[]) ?? []);
      setProjects((proj.data as ProjectLite[]) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Buchhaltung konnte nicht geladen werden.");
    } finally {
      if (initial) setLoading(false);
    }
  }
  useEffect(() => { load(true); }, []);

  // ── Filter Eingangsrechnungen ──
  const filtered = useMemo(() => rows.filter((r) => {
    switch (eTab) {
      case "offen": return isUnpaid(r.status);
      case "ueberfaellig": return isOverdue(r);
      case "bezahlt": return r.status === "bezahlt";
      case "storniert": return r.status === "storniert";
      default: return true;
    }
  }), [rows, eTab]);

  const sort = useTableSort<Eingangsrechnung>(
    "eingangsrechnungen",
    {
      supplier: { get: (r) => supplierName(r, suppliers), type: "text" },
      number: { get: (r) => r.invoice_number, type: "text" },
      date: { get: (r) => r.invoice_date, type: "date" },
      due: { get: (r) => r.due_date, type: "date" },
      gross: { get: (r) => r.gross, type: "number" },
      status: { get: (r) => EINGANG_STATUS_LABEL[r.status], type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "date", dir: "desc" } },
  );
  const sorted = useMemo(() => sort.sortRows(filtered), [sort, filtered]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const unpaid = rows.filter((r) => isUnpaid(r.status));
    return {
      offenCount: unpaid.length,
      offenSum: unpaid.reduce((s, r) => s + Number(r.gross || 0), 0),
      overdue: rows.filter((r) => isOverdue(r)).length,
      postenSum: posten.reduce((s, p) => s + Number(p.gross || 0), 0),
    };
  }, [rows, posten]);

  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    try {
      // Belege frisch laden (nicht den evtl. veralteten Snapshot) und aus dem
      // Storage entfernen, bevor die Zeile gelöscht wird.
      const fresh = await getEingangsrechnung(del.id).catch(() => null);
      for (const b of fresh?.belege ?? del.belege ?? []) {
        await removeBeleg(fresh ?? del, b).catch(() => {});
      }
      await deleteEingangsrechnung(del.id);
      toast("Eingangsrechnung gelöscht.");
      setDel(null);
      load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="pt-4"><Spinner /></div>;

  const postenSorted = [...posten];

  return (
    <div className="pt-2">
      {/* ── Header ── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Receipt size={22} style={{ color: "var(--accent)" }} /> Buchhaltung
          </h1>
          <ErrorBanner message={err} />
          <p className="mt-0.5 text-sm text-slate-400">
            Eingangsrechnungen (auch automatisch aus dem KI-Postfach) & offene Posten
          </p>
        </div>
        {mainTab === "eingang" && mayCreate && (
          <button className="btn-primary" data-tour-id="buchhaltung-new" onClick={() => setEdit("new")}>
            <Plus size={16} /> Neue Eingangsrechnung
          </button>
        )}
      </div>

      {/* ── KPI-Kacheln ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi value={String(kpis.offenCount)} label="Offen (Eingang)" sub="unbezahlt" />
        <Kpi value={String(kpis.overdue)} label="Überfällig" sub="Eingangsrechnungen" tone={kpis.overdue > 0 ? "red" : undefined} />
        <Kpi value={eur(kpis.offenSum)} label="Offener Betrag" sub="brutto (Eingang)" />
        <Kpi value={eur(kpis.postenSum)} label="Offene Posten" sub="brutto (Ausgang)" />
      </div>

      {/* ── Haupt-Tabs ── */}
      <div className="glass mb-4 flex gap-1 overflow-x-auto p-1">
        {([["eingang", "Eingangsrechnungen"], ["offen", "Offene Posten (Ausgang)"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setMainTab(key)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              mainTab === key ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            }`}
            style={mainTab === key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
            {label}
          </button>
        ))}
      </div>

      {mainTab === "eingang" ? (
        <>
          {/* Filter-Sub-Tabs */}
          <div className="glass mb-4 flex gap-1 overflow-x-auto p-1">
            {EINGANG_TABS.map((t) => (
              <button key={t.key} onClick={() => setETab(t.key)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  eTab === t.key ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                }`}
                style={eTab === t.key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
                {t.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Empty title="Keine Eingangsrechnungen" hint="Rechnungen aus dem KI-Postfach erscheinen automatisch hier – oder lege manuell eine an." />
          ) : (
            <>
              {/* Desktop-Tabelle */}
              <div className="glass hidden overflow-hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                      <tr>
                        <SortHeader label="Lieferant" sortKey="supplier" sort={sort.sort} onSort={sort.onSort} padClass="px-4 py-2.5" />
                        <SortHeader label="Rechnungs-Nr" sortKey="number" sort={sort.sort} onSort={sort.onSort} padClass="px-4 py-2.5" />
                        <SortHeader label="Datum" sortKey="date" sort={sort.sort} onSort={sort.onSort} padClass="px-4 py-2.5" />
                        <SortHeader label="Fällig" sortKey="due" sort={sort.sort} onSort={sort.onSort} padClass="px-4 py-2.5" />
                        <SortHeader label="Brutto" sortKey="gross" sort={sort.sort} onSort={sort.onSort} align="right" padClass="px-4 py-2.5" />
                        <SortHeader label="Status" sortKey="status" sort={sort.sort} onSort={sort.onSort} padClass="px-4 py-2.5" />
                        <th className="px-4 py-2.5">Belege</th>
                        <th className="px-4 py-2.5 text-right">Aktionen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {sorted.map((r) => {
                        const overdue = isOverdue(r);
                        return (
                          <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => setEdit(r)}>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="max-w-[180px] truncate font-medium">{supplierName(r, suppliers)}</span>
                                {r.source === "email" && <Mail size={13} className="shrink-0 text-slate-400" aria-label="aus E-Mail" />}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs">{r.invoice_number || <span className="italic text-slate-400">–</span>}</td>
                            <td className="px-4 py-2.5 text-xs text-slate-500">{dateAt(r.invoice_date)}</td>
                            <td className={`px-4 py-2.5 text-xs ${overdue ? "font-semibold text-rose-500" : "text-slate-500"}`}>
                              {r.due_date ? dateAt(r.due_date) : "–"}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{eur(r.gross)}</td>
                            <td className="px-4 py-2.5">
                              <Badge tone={overdue ? "red" : EINGANG_STATUS_TONE[r.status]}>
                                {overdue ? "Überfällig" : EINGANG_STATUS_LABEL[r.status]}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5">
                              {(r.belege?.length ?? 0) > 0 ? (
                                <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Paperclip size={13} /> {r.belege.length}</span>
                              ) : <span className="text-slate-300 dark:text-slate-600">–</span>}
                            </td>
                            <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit(r)}><Pencil size={15} /></button>
                                {mayDelete && (
                                  <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => setDel(r)}><Trash2 size={15} /></button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-slate-400" style={{ borderColor: "var(--border)" }}>
                  <span>{filtered.length} Eingangsrechnung{filtered.length === 1 ? "" : "en"}</span>
                  <span className="font-medium tabular-nums">{eur(filtered.reduce((s, r) => s + Number(r.gross || 0), 0))} brutto gesamt</span>
                </div>
              </div>

              {/* Mobile-Karten */}
              <div className="grid grid-cols-1 gap-2 md:hidden">
                {sorted.map((r) => {
                  const overdue = isOverdue(r);
                  return (
                    <button key={r.id} onClick={() => setEdit(r)} className="glass block p-3 text-left transition-colors hover:bg-[var(--hover)]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
                            {supplierName(r, suppliers)}
                            {r.source === "email" && <Mail size={12} className="shrink-0 text-slate-400" />}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-500">
                            {r.invoice_number ? `Nr. ${r.invoice_number}` : "ohne Nummer"}{r.due_date ? ` · fällig ${dateAt(r.due_date)}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold tabular-nums">{eur(r.gross)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone={overdue ? "red" : EINGANG_STATUS_TONE[r.status]}>{overdue ? "Überfällig" : EINGANG_STATUS_LABEL[r.status]}</Badge>
                        {(r.belege?.length ?? 0) > 0 && <Badge tone="slate"><span className="inline-flex items-center gap-1"><Paperclip size={11} /> {r.belege.length}</span></Badge>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        /* ── Offene Posten (Ausgang) ── */
        posten.length === 0 ? (
          <Empty title="Keine offenen Posten" hint="Alle finalisierten Ausgangsrechnungen sind bezahlt." />
        ) : (
          <div className="glass overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                  <tr>
                    <th className="px-4 py-2.5">Kunde</th>
                    <th className="px-4 py-2.5">RE-Nummer</th>
                    <th className="px-4 py-2.5">Datum</th>
                    <th className="px-4 py-2.5">Fällig</th>
                    <th className="px-4 py-2.5 text-right">Brutto</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {postenSorted.map((p) => (
                    <tr key={p.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => nav(`/rechnungen/${p.id}`)}>
                      <td className="px-4 py-2.5"><div className="max-w-[200px] truncate font-medium">{p.customer_name}</div></td>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.number || "–"}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{dateAt(p.invoice_date)}</td>
                      <td className={`px-4 py-2.5 text-xs ${p.overdue ? "font-semibold text-rose-500" : "text-slate-500"}`}>{p.due_date ? dateAt(p.due_date) : "–"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{eur(p.gross)}</td>
                      <td className="px-4 py-2.5"><Badge tone={p.overdue ? "red" : "amber"}>{p.overdue ? "Überfällig" : "Offen"}</Badge></td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <button className="btn-ghost px-2" title="Rechnung öffnen" onClick={() => nav(`/rechnungen/${p.id}`)}><ExternalLink size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-slate-400" style={{ borderColor: "var(--border)" }}>
              <span>{posten.length} offene{posten.length === 1 ? "r Posten" : " Posten"}</span>
              <span className="font-medium tabular-nums">{eur(kpis.postenSum)} brutto gesamt</span>
            </div>
          </div>
        )
      )}

      {edit !== null && (
        <EingangsrechnungForm
          value={edit === "new" ? null : edit}
          suppliers={suppliers}
          projects={projects}
          canEdit={edit === "new" ? mayCreate : mayEdit}
          onClose={() => setEdit(null)}
          onSaved={() => { load(); }}
        />
      )}

      <ConfirmDialog open={!!del} title="Eingangsrechnung löschen?" confirmLabel="Löschen"
        message={<><b>{del ? supplierName(del, suppliers) : ""}</b>{del?.invoice_number ? ` · Nr. ${del.invoice_number}` : ""} wird endgültig gelöscht (inkl. Belege).</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </div>
  );
}

// ── KPI-Kachel ────────────────────────────────────────────────────────
function Kpi({ value, label, sub, tone }: { value: string; label: string; sub?: string; tone?: "red" }) {
  return (
    <div className="glass rounded-xl p-3 text-center">
      <div className={`text-xl font-bold tabular-nums ${tone === "red" ? "text-rose-500" : ""}`}>{value}</div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

// ── Bearbeiten/Erfassen-Modal ─────────────────────────────────────────
const STATUS_OPTIONS: EingangsrechnungStatus[] = ["offen", "geprueft", "freigegeben", "bezahlt", "storniert"];

function EingangsrechnungForm({
  value, suppliers, projects, canEdit, onClose, onSaved,
}: {
  value: Eingangsrechnung | null;
  suppliers: SupplierLite[];
  projects: ProjectLite[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [current, setCurrent] = useState<Eingangsrechnung | null>(value);
  const [supplierName_, setSupplierName] = useState(value?.supplier_name ?? "");
  const [supplierId, setSupplierId] = useState<string>(value?.supplier_contact_id ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(value?.invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = useState(value?.invoice_date ?? "");
  const [dueDate, setDueDate] = useState(value?.due_date ?? "");
  const [gross, setGross] = useState(value?.gross != null ? String(value.gross) : "");
  const [net, setNet] = useState(value?.net != null ? String(value.net) : "");
  const [vatRate, setVatRate] = useState(value?.vat_rate != null ? String(value.vat_rate) : "20");
  const [iban, setIban] = useState(value?.iban ?? "");
  const [category, setCategory] = useState(value?.category ?? "");
  const [projectId, setProjectId] = useState<string>(value?.project_id ?? "");
  const [status, setStatus] = useState<EingangsrechnungStatus>(value?.status ?? "offen");
  const [paymentRef, setPaymentRef] = useState(value?.payment_reference ?? "");
  const [notes, setNotes] = useState(value?.notes ?? "");
  const [belege, setBelege] = useState<Beleg[]>(value?.belege ?? []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Robust gegen AT- ("2.480,00") und EN-Format ("2480.50"): das LETZTE
  // Trennzeichen ist der Dezimaltrenner.
  const num = (s: string): number | null => {
    const cleaned = s.trim().replace(/[^\d,.-]/g, "");
    if (!cleaned) return null;
    let normalized = cleaned;
    if (cleaned.includes(",") && cleaned.includes(".")) {
      normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
    } else if (cleaned.includes(",")) {
      normalized = cleaned.replace(",", ".");
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  };

  function buildPayload() {
    const g = num(gross);
    const n = num(net);
    const rate = num(vatRate);
    const vat = n != null && rate != null ? Math.round(n * rate) / 100 : (g != null && n != null ? Math.round((g - n) * 100) / 100 : null);
    return {
      supplier_name: supplierName_.trim() || null,
      supplier_contact_id: supplierId || null,
      invoice_number: invoiceNumber.trim() || null,
      invoice_date: invoiceDate || null,
      due_date: dueDate || null,
      gross: g,
      net: n,
      vat,
      vat_rate: rate,
      iban: iban.trim() || null,
      category: category.trim() || null,
      project_id: projectId || null,
      status,
      payment_reference: paymentRef.trim() || null,
      notes: notes.trim() || null,
    };
  }

  async function save() {
    if (!canEdit) return;
    setBusy(true);
    try {
      const payload = buildPayload();
      if (current) {
        await updateEingangsrechnung(current.id, payload);
        toast("Eingangsrechnung gespeichert.");
        onSaved();
        onClose();
      } else {
        const id = await createEingangsrechnung(payload);
        const fresh = await getEingangsrechnung(id);
        toast("Eingangsrechnung angelegt – Belege können jetzt hinzugefügt werden.");
        setCurrent(fresh);
        setBelege(fresh?.belege ?? []);
        onSaved();
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !current) return;
    setUploading(true);
    try {
      const b = await uploadBeleg(current.id, file);
      const next = await addBelegToInvoice({ ...current, belege }, b);
      setBelege(next);
      setCurrent({ ...current, belege: next });
      onSaved();
      toast("Beleg hochgeladen.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  async function viewBeleg(b: Beleg) {
    const url = await belegUrl(b);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toastError("Beleg konnte nicht geöffnet werden.");
  }

  async function delBeleg(b: Beleg) {
    if (!current) return;
    try {
      const next = await removeBeleg({ ...current, belege }, b);
      setBelege(next);
      setCurrent({ ...current, belege: next });
      onSaved();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Beleg konnte nicht entfernt werden.");
    }
  }

  return (
    <Modal open onClose={onClose} title={current ? "Eingangsrechnung bearbeiten" : "Neue Eingangsrechnung"} size="xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-tour-id="buchhaltung-form">
        <label className="flex flex-col text-sm sm:col-span-2">
          <span className="label">Lieferant</span>
          <input className="input" list="lieferanten-list" value={supplierName_}
            onChange={(e) => {
              setSupplierName(e.target.value);
              const match = suppliers.find((s) => (s.customer_type === "firma" ? s.company : [s.first_name, s.last_name].filter(Boolean).join(" ")) === e.target.value);
              setSupplierId(match?.id ?? "");
            }}
            placeholder="Lieferant / Firma" disabled={!canEdit} />
          <datalist id="lieferanten-list">
            {suppliers.map((s) => {
              const name = s.customer_type === "firma" ? (s.company || "") : [s.first_name, s.last_name].filter(Boolean).join(" ");
              return name ? <option key={s.id} value={name} /> : null;
            })}
          </datalist>
        </label>

        <label className="flex flex-col text-sm">
          <span className="label">Rechnungsnummer</span>
          <input className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Status</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as EingangsrechnungStatus)} disabled={!canEdit}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{EINGANG_STATUS_LABEL[s]}</option>)}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="label">Rechnungsdatum</span>
          <input type="date" className="input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Fällig am</span>
          <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={!canEdit} />
        </label>

        <label className="flex flex-col text-sm">
          <span className="label">Netto (€)</span>
          <input className="input text-right tabular-nums" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} placeholder="0,00" disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">USt-Satz (%)</span>
          <input className="input text-right tabular-nums" inputMode="decimal" value={vatRate} onChange={(e) => setVatRate(e.target.value)} placeholder="20" disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Brutto (€)</span>
          <input className="input text-right tabular-nums font-semibold" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0,00" disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Kategorie</span>
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="z. B. Material, Werkzeug, Subunternehmer" disabled={!canEdit} />
        </label>

        <label className="flex flex-col text-sm">
          <span className="label">Projekt</span>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!canEdit}>
            <option value="">– kein Projekt –</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_number ? `${p.project_number} · ${p.title}` : p.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">IBAN</span>
          <input className="input font-mono" value={iban} onChange={(e) => setIban(e.target.value)} disabled={!canEdit} />
        </label>

        <label className="flex flex-col text-sm sm:col-span-2">
          <span className="label">Zahlungsreferenz / Verwendungszweck</span>
          <input className="input" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm sm:col-span-2">
          <span className="label">Notizen</span>
          <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} />
        </label>
      </div>

      {/* Belege */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Belege {belege.length > 0 && <span className="text-slate-400">({belege.length})</span>}</span>
          {current && canEdit && (
            <label className={`btn-outline cursor-pointer text-xs ${uploading ? "pointer-events-none opacity-60" : ""}`}>
              <Paperclip size={14} /> {uploading ? "Lädt …" : "Beleg hinzufügen"}
              <input type="file" className="hidden" accept={BELEG_ACCEPT} onChange={onUpload} />
            </label>
          )}
        </div>
        {!current ? (
          <p className="text-xs text-slate-400">Belege können nach dem ersten Speichern hinzugefügt werden.</p>
        ) : belege.length === 0 ? (
          <p className="text-xs text-slate-400">Noch keine Belege.</p>
        ) : (
          <ul className="space-y-1.5">
            {belege.map((b) => (
              <li key={b.path} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <button className="flex min-w-0 items-center gap-2 text-left hover:underline" onClick={() => viewBeleg(b)}>
                  <Paperclip size={14} className="shrink-0 text-slate-400" />
                  <span className="truncate">{b.filename}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="btn-ghost px-2" title="Öffnen" onClick={() => viewBeleg(b)}><ExternalLink size={14} /></button>
                  {canEdit && <button className="btn-ghost px-2 text-rose-500" title="Entfernen" onClick={() => delBeleg(b)}><Trash2 size={14} /></button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Herkunft-Hinweis */}
      {current?.source === "email" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--accent-soft,rgba(239,68,68,0.08))] px-3 py-2 text-xs text-slate-500">
          <Mail size={14} style={{ color: "var(--accent)" }} /> Automatisch aus dem KI-Postfach erkannt und übernommen.
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>Schließen</button>
        {canEdit && (
          <button className="btn-primary" data-tour-id="buchhaltung-save" onClick={save} disabled={busy}>
            {busy ? "Speichere …" : current ? "Speichern" : "Anlegen"}
          </button>
        )}
      </div>
    </Modal>
  );
}
