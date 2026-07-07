import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Ban, Archive, Eye, Trash2, Receipt } from "lucide-react";
import { supabase } from "../lib/supabase";
import { PageHeader, Spinner, Empty, Badge } from "../components/ui";
import { ErrorBanner, ConfirmDialog } from "../components/calc-ui";
import {
  Order, ORDER_STATUS_LABEL, ORDER_INVOICE_STATUS_LABEL, Contact,
} from "../lib/types";
import { eur, dateAt } from "../lib/format";
import { logProject } from "../lib/projectlog";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/permissions";
import { isDeletable, softDeleteDocument, DELETE_CONFIRM_TEXT } from "../lib/document-delete";
import { toast } from "../lib/toast";
import { createInvoiceFromOrders, createInvoicesPerOrder } from "../lib/document-chain";
import { docPath, docRouteById } from "../lib/documents-overview";
import { OfferType, loadOfferTypes, variantLabel, variantTone } from "../lib/offer-kinds";
import { orderStatusTone as statusTone } from "../lib/order-status";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";

function invTone(s: string): "slate" | "green" | "amber" | "red" {
  if (s === "voll_verrechnet") return "green";
  if (s === "teilw_verrechnet") return "amber";
  if (s === "storniert" || s === "ueberverrechnet") return "red";
  return "slate";
}

export default function Orders() {
  const [list, setList] = useState<Order[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [offerTypes, setOfferTypes] = useState<OfferType[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("alle");
  const [storno, setStorno] = useState<Order | null>(null);
  const [del, setDel] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { session } = useAuth();
  const can = useCan();
  const mayDelete = can("orders", "delete");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSel = (id: string) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  async function convertSelected(mode: "merge" | "perSource") {
    const orders = list.filter((o) => selected.has(o.id));
    if (orders.length === 0) return;
    setBusy(true); setErr(null);
    try {
      if (mode === "merge") {
        const projectId = orders[0].project_id || null;
        const r = await createInvoiceFromOrders({ projectId, orders });
        if (r.error) { setErr(r.error); return; }
        setSelected(new Set());
        if (r.id) nav(await docRouteById("invoice", r.id));
      } else {
        const r = await createInvoicesPerOrder({ orders });
        if (r.error) { setErr(r.error); return; }
        setSelected(new Set());
        if (r.ids.length === 1) nav(await docRouteById("invoice", r.ids[0]));
        else { toast(`${r.ids.length} Rechnungen wurden erstellt.`); load(); }
      }
    } finally { setBusy(false); }
  }
  const selOrders = () => list.filter((o) => selected.has(o.id));
  const sameProject = () => {
    const os = selOrders();
    if (os.length === 0) return false;
    const first = os[0].project_id || "";
    return first !== "" && os.every((o) => (o.project_id || "") === first);
  };

  async function load() {
    setLoading(true);
    const [o, c, ots] = await Promise.all([
      supabase.from("orders").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("contacts").select("*"),
      loadOfferTypes(false).catch(() => [] as OfferType[]),
    ]);
    if (o.error) setErr(o.error.message);
    setList((o.data as Order[]) ?? []);
    setContacts((c.data as Contact[]) ?? []);
    setOfferTypes(ots as OfferType[]);
    setLoading(false);
  }
  const typeOf = (id: string | null) => offerTypes.find((t) => t.id === id) ?? null;
  useEffect(() => { load(); }, []);

  const contactName = (id: string | null) => {
    const c = contacts.find((x) => x.id === id);
    if (!c) return "–";
    return c.customer_type === "firma"
      ? (c.company || "Firma")
      : [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "–";
  };

  async function createOrder() {
    // OHNE Nummer: Entwürfe verbrauchen keine Nummer – Vergabe erst beim Beauftragen.
    const { data, error } = await supabase.from("orders").insert({
      order_number: null,
      order_date: new Date().toISOString().slice(0, 10),
      title: "Neuer Auftrag",
      status: "entwurf",   // manuell angelegt = Entwurf (frei bearbeitbar + löschbar); via „Beauftragen" verbindlich
      invoice_status: "offen",
      net: 0, vat: 0, gross: 0,
      offer_ids: [],
    }).select("id").single();
    if (error || !data) { setErr(error?.message ?? "Fehler"); return; }
    nav(docPath("order", data.id, null));
  }

  async function confirmStorno() {
    if (!storno) return;
    setBusy(true);
    await supabase.from("orders").update({ status: "storniert", updated_at: new Date().toISOString() }).eq("id", storno.id);
    if (storno.project_id) {
      await logProject(storno.project_id, "auftrag", `Auftrag ${storno.order_number || storno.id} storniert`);
    }
    setBusy(false);
    setStorno(null);
    load();
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    const { error } = await softDeleteDocument("order", del.id, session?.user.id ?? null);
    setBusy(false);
    if (error) setErr(error); else { setDel(null); load(); }
  }

  async function archiveOrder(o: Order) {
    await supabase.from("orders").update({ status: "archiviert", updated_at: new Date().toISOString() }).eq("id", o.id);
    if (o.project_id) {
      await logProject(o.project_id, "auftrag", `Auftrag ${o.order_number || o.id} archiviert`);
    }
    load();
  }

  const shown = filter === "alle"
    ? list.filter((o) => o.status !== "archiviert")
    : filter === "archiviert"
      ? list.filter((o) => o.status === "archiviert")
      : list.filter((o) => o.status === filter);

  const sumNet = shown.reduce((a, o) => a + Number(o.net || 0), 0);

  const orderSort = useTableSort<Order>(
    "orders",
    {
      number: { get: (o) => o.order_number, type: "text" },
      date: { get: (o) => o.order_date, type: "date" },
      title: { get: (o) => o.title, type: "text" },
      customer: { get: (o) => { const n = contactName(o.contact_id); return n === "–" ? null : n; }, type: "text" },
      net: { get: (o) => o.net, type: "number" },
      status: { get: (o) => ORDER_STATUS_LABEL[o.status] ?? o.status, type: "text" },
      invStatus: { get: (o) => ORDER_INVOICE_STATUS_LABEL[o.invoice_status] ?? o.invoice_status, type: "text" },
      updated: { get: (o) => o.updated_at ?? o.created_at, type: "date" },
    },
    { userId: session?.user?.id ?? null, default: { key: "date", dir: "desc" } }
  );
  const shownSorted = orderSort.sortRows(shown);

  return (
    <div className="pt-4">
      <PageHeader
        title="Aufträge"
        subtitle={`${shown.length} Aufträge · Volumen netto ${eur(sumNet)}`}
        action={
          <button className="btn-primary" onClick={createOrder}>
            <Plus size={18} /> Neuer Auftrag
          </button>
        }
      />
      <ErrorBanner message={err} />

      {/* Filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { k: "alle", l: "Alle aktiven" },
          { k: "entwurf", l: "Entwurf" },
          { k: "beauftragt", l: "Beauftragt" },
          { k: "in_arbeit", l: "In Arbeit" },
          { k: "teilw_verrechnet", l: "Teil-verrechnet" },
          { k: "voll_verrechnet", l: "Voll verrechnet" },
          { k: "storniert", l: "Storniert" },
          { k: "archiviert", l: "Archiviert" },
        ].map(({ k, l }) => (
          <button key={k}
            className={`rounded-xl border px-3 py-1.5 text-sm transition ${filter === k ? "text-white border-transparent" : "border-current text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-white/5"}`}
            style={filter === k ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}
            onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>

      {/* Sammelaktion bei Mehrfachauswahl */}
      {selected.size > 0 && (
        <div className="glass mb-3 flex flex-wrap items-center gap-2 px-4 py-2.5">
          <span className="text-sm font-medium">{selected.size} Auftrag{selected.size !== 1 ? "/Aufträge" : ""} ausgewählt</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn-outline text-sm" disabled={busy} onClick={() => setSelected(new Set())}>Auswahl aufheben</button>
            <button className="btn-outline text-sm" disabled={busy || !sameProject()}
              title={sameProject() ? "Alle gewählten Aufträge in EINE gemeinsame Rechnung" : "Nur möglich, wenn alle zum selben Projekt gehören"}
              onClick={() => convertSelected("merge")}>
              <Receipt size={14} /> Gemeinsame Rechnung
            </button>
            <button className="btn-primary text-sm" disabled={busy}
              title="Für jeden gewählten Auftrag eine eigene Rechnung erstellen"
              onClick={() => convertSelected("perSource")}>
              <Receipt size={14} /> Je Auftrag eine Rechnung
            </button>
          </div>
        </div>
      )}

      {loading ? <Spinner /> : shown.length === 0 ? (
        <Empty title="Keine Aufträge" hint="Erstelle einen neuen Auftrag oder importiere ihn aus einem Angebot." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <th className="w-10 px-4 py-3"></th>
                <SortHeader label="Auftragsnummer" sortKey="number" sort={orderSort.sort} onSort={orderSort.onSort} />
                <SortHeader label="Auftragsdatum" sortKey="date" sort={orderSort.sort} onSort={orderSort.onSort} />
                <SortHeader label="Titel" sortKey="title" sort={orderSort.sort} onSort={orderSort.onSort} />
                <SortHeader label="Kunde" sortKey="customer" sort={orderSort.sort} onSort={orderSort.onSort} />
                <SortHeader label="Netto" sortKey="net" sort={orderSort.sort} onSort={orderSort.onSort} align="right" />
                <SortHeader label="Status" sortKey="status" sort={orderSort.sort} onSort={orderSort.onSort} />
                <SortHeader label="Rechnungsstatus" sortKey="invStatus" sort={orderSort.sort} onSort={orderSort.onSort} />
                <SortHeader label="Geändert" sortKey="updated" sort={orderSort.sort} onSort={orderSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((o) => (
                <tr key={o.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => nav(docPath("order", o.id, o.order_number))}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="h-4 w-4" checked={selected.has(o.id)} onChange={() => toggleSel(o.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs">{o.order_number || "–"}</div>
                    <div className="mt-1"><Badge tone={variantTone(typeOf((o as any).offer_type_id))}>{variantLabel("auftrag", typeOf((o as any).offer_type_id))}</Badge></div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{dateAt(o.order_date)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{o.title || "Ohne Titel"}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{contactName(o.contact_id)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(o.net)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(o.status)}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={invTone(o.invoice_status)}>
                      {ORDER_INVOICE_STATUS_LABEL[o.invoice_status] ?? o.invoice_status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{dateAt(o.updated_at ?? o.created_at)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title="Öffnen"
                        onClick={() => nav(docPath("order", o.id, o.order_number))}><Eye size={16} /></button>
                      <button className="btn-ghost px-2" title="Bearbeiten"
                        onClick={() => nav(docPath("order", o.id, o.order_number))}><Pencil size={16} /></button>
                      <button className="btn-ghost px-2 text-amber-500" title="Archivieren"
                        onClick={() => archiveOrder(o)} disabled={o.status === "archiviert"}>
                        <Archive size={16} />
                      </button>
                      <button className="btn-ghost px-2 text-rose-500" title="Stornieren"
                        onClick={() => setStorno(o)} disabled={o.status === "storniert"}>
                        <Ban size={16} />
                      </button>
                      {mayDelete && isDeletable("order", o) && (
                        <button className="btn-ghost px-2 text-rose-500" title="Entwurf löschen"
                          onClick={() => setDel(o)}><Trash2 size={16} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!storno}
        title="Auftrag stornieren?"
        confirmLabel="Stornieren"
        message={<>Soll <b>{storno?.order_number || storno?.title}</b> storniert werden?</>}
        busy={busy}
        onConfirm={confirmStorno}
        onClose={() => setStorno(null)}
      />

      <ConfirmDialog
        open={!!del}
        title="Entwurf löschen?"
        confirmLabel="Entwurf löschen"
        message={<><b>{del?.order_number || del?.title}</b>: {DELETE_CONFIRM_TEXT}</>}
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDel(null)}
      />
    </div>
  );
}
