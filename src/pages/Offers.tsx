import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import { supabase } from "../lib/supabase";
import { PageHeader, Spinner, Empty, Badge, Modal } from "../components/ui";
import { ConfirmDialog, ErrorBanner } from "../components/calc-ui";
import { Offer, OFFER_STATUS_LABEL, OFFER_STATUS_TONE, OfferStatus } from "../lib/offer-types";
import { OfferType, loadOfferTypes, variantLabel, variantTone, variantFamily } from "../lib/offer-kinds";
import { Contact } from "../lib/types";
import { eur, dateAt } from "../lib/format";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/permissions";
import { isDeletable, softDeleteDocument, DELETE_CONFIRM_TEXT } from "../lib/document-delete";
import { createOrderFromOffers, createOrdersPerOffer, ItemFilter } from "../lib/document-chain";
import { docPath, docRouteById } from "../lib/documents-overview";
import SelectOfferPositionsModal from "../components/document/SelectOfferPositionsModal";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";

export default function Offers() {
  const [list, setList] = useState<Offer[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [types, setTypes] = useState<OfferType[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const nav = useNavigate();
  const { session } = useAuth();
  const can = useCan();
  const mayDelete = can("offers", "delete");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [posPick, setPosPick] = useState<Offer[] | null>(null);   // offen = Positionsauswahl-Dialog
  const [fVariant, setFVariant] = useState("");   // Varianten-Filter: "" | standard | pauschal | regie
  const typeOf = (id: string | null | undefined) => types.find((t) => t.id === id) ?? null;

  const toggleSel = (id: string) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const selOffers = () => list.filter((o) => selected.has(o.id));
  // Gemeinsamer Auftrag nur sinnvoll, wenn alle gewählten Angebote zum selben Projekt gehören.
  const sameProject = () => {
    const offers = selOffers();
    if (offers.length === 0) return false;
    const first = offers[0].project_id || "";
    return first !== "" && offers.every((o) => (o.project_id || "") === first);
  };

  async function convertSelected(mode: "merge" | "perSource") {
    const offers = selOffers();
    if (offers.length === 0) return;
    if (mode === "merge") {
      // Gemeinsamer Auftrag: erst Positionen auswählen, dann konvertieren.
      const projectId = offers[0].project_id;
      if (!projectId) { setErr("Gemeinsamer Auftrag braucht ein gemeinsames Projekt."); return; }
      setErr(null);
      setPosPick(offers);
      return;
    }
    // Je Angebot ein Auftrag (unverändert)
    setBusy(true); setErr(null);
    try {
      const r = await createOrdersPerOffer({ projectId: offers[0].project_id || "", offers });
      if (r.error) { setErr(r.error); return; }
      setSelected(new Set());
      if (r.ids.length === 1) nav(await docRouteById("order", r.ids[0]));
      else { window.alert(`${r.ids.length} Aufträge erstellt: ${r.numbers.join(", ")}`); load(); }
    } finally { setBusy(false); }
  }

  // Aus der Positionsauswahl: gemeinsamen Auftrag mit gewählten Positionen erstellen.
  async function confirmMerge(itemFilter: ItemFilter) {
    const offers = posPick;
    if (!offers || offers.length === 0) return;
    const projectId = offers[0].project_id;
    if (!projectId) { setErr("Gemeinsamer Auftrag braucht ein gemeinsames Projekt."); setPosPick(null); return; }
    setBusy(true); setErr(null);
    try {
      const r = await createOrderFromOffers({ projectId, offers, itemFilter });
      if (r.error) { setErr(r.error); setPosPick(null); return; } // Dialog schließen, Fehler sichtbar machen
      setPosPick(null);
      setSelected(new Set());
      if (r.id) nav(await docRouteById("order", r.id));
    } finally { setBusy(false); }
  }

  async function load() {
    setLoading(true);
    const [o, c, t] = await Promise.all([
      supabase.from("offers").select("*").is("deleted_at", null).neq("kind", "nachtrag").order("created_at", { ascending: false }),
      supabase.from("contacts").select("*"),
      loadOfferTypes(false).catch(() => [] as OfferType[]),
    ]);
    if (o.error) setErr(o.error.message);
    setList((o.data as Offer[]) ?? []);
    setContacts((c.data as Contact[]) ?? []);
    setTypes(t);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const contactName = (id: string | null) => {
    const c = contacts.find((x) => x.id === id);
    if (!c) return "–";
    return [c.salutation, c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "–";
  };

  // Beim Anlegen nur AKTIVE Varianten anbieten (Liste/Map nutzt auch inaktive für Anzeige).
  const activeTypes = types.filter((t) => t.is_active);
  function startCreate() {
    setErr(null);
    if (activeTypes.length <= 1) createOffer(activeTypes[0] ?? null);   // kein/ein Typ → direkt anlegen
    else setPickOpen(true);
  }

  async function createOffer(type: OfferType | null) {
    setPickOpen(false);
    setCreating(true); setErr(null);
    // OHNE Nummer: Entwürfe verbrauchen keine Nummer – Vergabe erst beim Abschließen.
    const { data, error } = await supabase.from("offers").insert({
      title: "Neues Angebot", number: null, status: "entwurf", items: [], net: 0, vat: 0, gross: 0,
      offer_type_id: type?.id ?? null,
      offer_intro_text: type?.intro_text ?? null,
      offer_closing_text: type?.closing_text ?? null,
      notes: type?.closing_text ?? null,
      use_global_display: true,
      display_settings_snapshot: type?.display ?? null,
    }).select("id").single();
    setCreating(false);
    if (error || !data) setErr(error?.message ?? "Fehler"); else nav(docPath("offer", data.id, null));
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    // Soft-Delete: nur Entwürfe; Zeile bleibt erhalten, wird aber ausgeblendet.
    const { error } = await softDeleteDocument("offer", del.id, session?.user.id ?? null);
    setBusy(false);
    if (error) setErr(error); else { setDel(null); load(); }
  }

  // Varianten-Filter
  const shown = list.filter((o) => !fVariant || variantFamily(typeOf(o.offer_type_id)) === fVariant);
  const sum = shown.reduce((a, o) => a + Number(o.net || 0), 0);

  const offerSort = useTableSort<Offer>(
    "offers",
    {
      number: { get: (o) => o.number ?? o.title, type: "text" },
      customer: { get: (o) => { const n = contactName(o.contact_id); return n === "–" ? null : n; }, type: "text" },
      date: { get: (o) => o.created_at, type: "date" },
      status: { get: (o) => OFFER_STATUS_LABEL[o.status as OfferStatus] ?? o.status, type: "text" },
      net: { get: (o) => o.net, type: "number" },
    },
    { userId: session?.user?.id ?? null, default: { key: "date", dir: "desc" } }
  );
  const shownSorted = offerSort.sortRows(shown);

  return (
    <div className="pt-4">
      <PageHeader
        title="Angebote"
        subtitle={`${shown.length} Angebote · Volumen netto ${eur(sum)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={fVariant} onChange={(e) => setFVariant(e.target.value)} title="Nach Variante filtern">
              <option value="">Alle Varianten</option>
              <option value="standard">Standard</option>
              <option value="pauschal">Pauschal</option>
              <option value="regie">Regie</option>
            </select>
            <button className="btn-primary" onClick={startCreate} disabled={creating}><Plus size={18} /> {creating ? "…" : "Neues Angebot"}</button>
          </div>
        }
      />
      <ErrorBanner message={err} />

      {/* Sammelaktion bei Mehrfachauswahl */}
      {selected.size > 0 && (
        <div className="glass mb-3 flex flex-wrap items-center gap-2 px-4 py-2.5">
          <span className="text-sm font-medium">{selected.size} Angebot{selected.size !== 1 ? "e" : ""} ausgewählt</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn-outline text-sm" disabled={busy} onClick={() => setSelected(new Set())}>Auswahl aufheben</button>
            <button className="btn-outline text-sm" disabled={busy || !sameProject()}
              title={sameProject() ? "Alle gewählten Angebote in EINEN gemeinsamen Auftrag" : "Nur möglich, wenn alle zum selben Projekt gehören"}
              onClick={() => convertSelected("merge")}>
              <FileText size={14} /> Gemeinsamer Auftrag
            </button>
            <button className="btn-primary text-sm" disabled={busy}
              title="Für jedes gewählte Angebot einen eigenen Auftrag erstellen"
              onClick={() => convertSelected("perSource")}>
              <FileText size={14} /> Je Angebot ein Auftrag
            </button>
          </div>
        </div>
      )}

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Angebote" hint="Erstelle ein Angebot und füge Leistungen aus der Kalkulation ein – Preise werden als Snapshot eingefroren." />
      ) : shown.length === 0 ? (
        <Empty title="Keine Treffer" hint="Für diese Variante gibt es keine Angebote – Filter anpassen." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <th className="w-10 px-4 py-3"></th>
                <SortHeader label="Nummer / Titel" sortKey="number" sort={offerSort.sort} onSort={offerSort.onSort} />
                <SortHeader label="Kunde" sortKey="customer" sort={offerSort.sort} onSort={offerSort.onSort} />
                <SortHeader label="Datum" sortKey="date" sort={offerSort.sort} onSort={offerSort.onSort} />
                <SortHeader label="Status" sortKey="status" sort={offerSort.sort} onSort={offerSort.onSort} />
                <SortHeader label="Netto" sortKey="net" sort={offerSort.sort} onSort={offerSort.onSort} align="right" />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => nav(docPath("offer", o.id, o.number))}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="h-4 w-4" checked={selected.has(o.id)} onChange={() => toggleSel(o.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{o.title || "Ohne Titel"}</span>
                      <Badge tone={variantTone(typeOf(o.offer_type_id))}>{variantLabel("angebot", typeOf(o.offer_type_id))}</Badge>
                    </div>
                    <div className="text-xs text-slate-400">{o.number ?? "–"} · {(o.items?.length ?? 0)} Positionen</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{contactName(o.contact_id)}</td>
                  <td className="px-4 py-3 text-slate-500">{dateAt(o.created_at)}</td>
                  <td className="px-4 py-3"><Badge tone={OFFER_STATUS_TONE[o.status as OfferStatus] ?? "slate"}>{OFFER_STATUS_LABEL[o.status as OfferStatus] ?? o.status}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{eur(o.net)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title="Öffnen" onClick={() => nav(docPath("offer", o.id, o.number))}><Pencil size={16} /></button>
                      {mayDelete && isDeletable("offer", o) && (
                        <button className="btn-ghost px-2 text-rose-500" title="Entwurf löschen" onClick={() => setDel(o)}><Trash2 size={16} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {posPick && (
        <SelectOfferPositionsModal
          offers={posPick}
          busy={busy}
          onConfirm={confirmMerge}
          onClose={() => setPosPick(null)}
        />
      )}

      <ConfirmDialog open={!!del} title="Entwurf löschen?" confirmLabel="Entwurf löschen"
        message={<><b>{del?.title || del?.number}</b>: {DELETE_CONFIRM_TEXT}</>} busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />

      {pickOpen && (
        <Modal open onClose={() => setPickOpen(false)} title="Welchen Angebotstyp möchten Sie erstellen?">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {activeTypes.map((t) => (
              <button key={t.id} className="glass glass-hover flex flex-col items-start gap-1 p-4 text-left"
                onClick={() => createOffer(t)} disabled={creating}>
                <div className="flex items-center gap-2 font-semibold"><FileText size={16} /> {t.name}</div>
                {t.description && <div className="text-xs text-slate-400">{t.description}</div>}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
