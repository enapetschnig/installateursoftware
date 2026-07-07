import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Receipt, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Empty, Badge } from "../components/ui";
import { ConfirmDialog, ErrorBanner } from "../components/calc-ui";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/permissions";
import { isDeletable, softDeleteDocument, DELETE_CONFIRM_TEXT } from "../lib/document-delete";
import {
  Invoice, InvoiceStatus, INVOICE_STATUS_LABEL, INVOICE_STATUS_COLOR,
  INVOICE_KIND_LABEL,
  deriveInvoiceStatus,
} from "../lib/invoice-types";
import { Contact, Project } from "../lib/types";
import { OfferType, loadOfferTypes, variantLabel, variantTone } from "../lib/offer-kinds";
import { docPath } from "../lib/documents-overview";
import { eur, dateAt } from "../lib/format";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";

/* ──────────────────────────────────────────────────────────────
   Filter-Tabs
────────────────────────────────────────────────────────────── */
const FILTER_TABS: { key: "alle" | InvoiceStatus; label: string }[] = [
  { key: "alle",       label: "Alle" },
  { key: "entwurf",   label: "Entwurf" },
  { key: "finalisiert", label: "Finalisiert" },
  { key: "bezahlt",   label: "Bezahlt" },
  { key: "überfällig", label: "Überfällig" },
  { key: "storniert", label: "Storniert" },
];

export default function Invoices() {
  const nav = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [offerTypes, setOfferTypes] = useState<OfferType[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"alle" | InvoiceStatus>("alle");
  const [del, setDel] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { session } = useAuth();
  const can = useCan();
  const mayDelete = can("invoices", "delete");

  async function load() {
    setLoading(true);
    const [{ data: inv }, { data: cont }, { data: proj }, ots] = await Promise.all([
      supabase.from("invoices").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("contacts").select("id, company, first_name, last_name, customer_type, contact_number"),
      supabase.from("projects").select("id, title, project_number"),
      loadOfferTypes(false).catch(() => [] as OfferType[]),
    ]);
    setInvoices((inv as Invoice[]) ?? []);
    setContacts((cont as Contact[]) ?? []);
    setProjects((proj as Project[]) ?? []);
    setOfferTypes(ots as OfferType[]);
    setLoading(false);
  }
  const typeOf = (id: string | null) => offerTypes.find((t) => t.id === id) ?? null;

  useEffect(() => { load(); }, []);

  async function createNew() {
    nav("/rechnungen/new");
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    const { error } = await softDeleteDocument("invoice", del.id, session?.user.id ?? null);
    setBusy(false);
    if (error) setErr(error); else { setDel(null); load(); }
  }

  const cName = (contactId: string | null) => {
    if (!contactId) return "–";
    const c = contacts.find((x) => x.id === contactId);
    if (!c) return "–";
    return c.customer_type === "firma"
      ? (c.company || "Firma")
      : [c.first_name, c.last_name].filter(Boolean).join(" ") || "–";
  };

  const pName = (projectId: string | null) => {
    if (!projectId) return "–";
    const p = projects.find((x) => x.id === projectId);
    if (!p) return "–";
    return p.project_number ? `${p.project_number} · ${p.title}` : p.title;
  };

  const filtered = invoices.filter((inv) => {
    if (tab === "alle") return true;
    return deriveInvoiceStatus(inv) === tab;
  });

  const invSort = useTableSort<Invoice>(
    "invoices",
    {
      number: { get: (i) => i.number, type: "text" },
      date: { get: (i) => i.invoice_date, type: "date" },
      kind: { get: (i) => INVOICE_KIND_LABEL[(i as any).invoice_kind as keyof typeof INVOICE_KIND_LABEL], type: "text" },
      project: { get: (i) => { const n = pName(i.project_id); return n === "–" ? null : n; }, type: "text" },
      customer: { get: (i) => { const n = cName(i.contact_id); return n === "–" ? null : n; }, type: "text" },
      net: { get: (i) => i.net, type: "number" },
      gross: { get: (i) => i.gross, type: "number" },
      status: { get: (i) => INVOICE_STATUS_LABEL[deriveInvoiceStatus(i)], type: "text" },
      due: { get: (i) => i.due_date, type: "date" },
    },
    { userId: session?.user?.id ?? null, default: { key: "date", dir: "desc" } }
  );
  const filteredSorted = invSort.sortRows(filtered);

  const totals = {
    count: filtered.length,
    gross: filtered.reduce((s, i) => s + Number(i.gross || 0), 0),
  };

  if (loading) return <div className="pt-4"><Spinner /></div>;

  return (
    <div className="pt-2">
      {/* ── Header ── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Receipt size={22} /> Rechnungen
          </h1>
          <ErrorBanner message={err} />
          <p className="mt-0.5 text-sm text-slate-400">
            Alle Rechnungen · §11 UStG-konform
          </p>
        </div>
        <button className="btn-primary" onClick={createNew}>
          <Plus size={16} /> Neue Rechnung
        </button>
      </div>

      {/* ── Kacheln ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Gesamt", value: invoices.length.toString(), sub: "Rechnungen" },
          { label: "Entwürfe", value: invoices.filter((i) => deriveInvoiceStatus(i) === "entwurf").length.toString(), sub: "" },
          { label: "Überfällig", value: invoices.filter((i) => deriveInvoiceStatus(i) === "überfällig").length.toString(), sub: "offene Posten" },
          { label: "Volumen", value: eur(invoices.filter((i) => !["storniert", "entwurf"].includes(deriveInvoiceStatus(i))).reduce((s, i) => s + Number(i.net || 0), 0)), sub: "netto" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="glass rounded-xl p-3 text-center">
            <div className="text-xl font-bold tabular-nums">{value}</div>
            <div className="text-xs font-medium text-slate-500">{label}</div>
            {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Filter-Tabs ── */}
      <div className="glass mb-4 flex gap-1 overflow-x-auto p-1">
        {FILTER_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? "text-white"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            }`}
            style={tab === t.key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tabelle ── */}
      {filtered.length === 0 ? (
        <Empty title="Keine Rechnungen" hint={`Klicke auf „+ Neue Rechnung“ um zu beginnen.`} />
      ) : (
        <div className="glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                <tr>
                  <SortHeader label="RE-Nummer" sortKey="number" sort={invSort.sort} onSort={invSort.onSort} padClass="px-4 py-2.5" />
                  <SortHeader label="Datum" sortKey="date" sort={invSort.sort} onSort={invSort.onSort} padClass="px-4 py-2.5" />
                  <SortHeader label="Art" sortKey="kind" sort={invSort.sort} onSort={invSort.onSort} padClass="px-4 py-2.5" />
                  <SortHeader label="Projekt" sortKey="project" sort={invSort.sort} onSort={invSort.onSort} padClass="px-4 py-2.5" />
                  <SortHeader label="Kunde" sortKey="customer" sort={invSort.sort} onSort={invSort.onSort} padClass="px-4 py-2.5" />
                  <SortHeader label="Netto" sortKey="net" sort={invSort.sort} onSort={invSort.onSort} align="right" padClass="px-4 py-2.5" />
                  <SortHeader label="Brutto" sortKey="gross" sort={invSort.sort} onSort={invSort.onSort} align="right" padClass="px-4 py-2.5" />
                  <SortHeader label="Status" sortKey="status" sort={invSort.sort} onSort={invSort.onSort} padClass="px-4 py-2.5" />
                  <SortHeader label="Fällig" sortKey="due" sort={invSort.sort} onSort={invSort.onSort} padClass="px-4 py-2.5" />
                  <th className="px-4 py-2.5 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filteredSorted.map((inv) => {
                  const st = deriveInvoiceStatus(inv);
                  return (
                    <tr key={inv.id}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                      onClick={() => nav(docPath("invoice", inv.id, inv.number))}>
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold">
                        {inv.number || <span className="text-slate-400 italic">Entwurf</span>}
                        <div className="mt-1"><Badge tone={variantTone(typeOf((inv as any).offer_type_id))}>{variantLabel("rechnung", typeOf((inv as any).offer_type_id))}</Badge></div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {dateAt(inv.invoice_date)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {INVOICE_KIND_LABEL[(inv as any).invoice_kind as keyof typeof INVOICE_KIND_LABEL] ?? "–"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="max-w-[160px] truncate text-xs">{pName(inv.project_id)}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="max-w-[140px] truncate text-xs">{cName(inv.contact_id)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                        {eur(inv.net)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs font-semibold">
                        {eur(inv.gross)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={INVOICE_STATUS_COLOR[st]}>
                          {INVOICE_STATUS_LABEL[st]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {inv.due_date ? dateAt(inv.due_date) : "–"}
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          {mayDelete && isDeletable("invoice", inv) && (
                            <button className="btn-ghost px-2 text-rose-500" title="Entwurf löschen"
                              onClick={() => setDel(inv)}><Trash2 size={16} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-slate-400"
              style={{ borderColor: "var(--border)" }}>
              <span>{totals.count} Einträge</span>
              <span className="tabular-nums font-medium">{eur(totals.gross)} brutto gesamt</span>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog open={!!del} title="Entwurf löschen?" confirmLabel="Entwurf löschen"
        message={<><b>{del?.number || "Entwurf"}</b>: {DELETE_CONFIRM_TEXT}</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </div>
  );
}
