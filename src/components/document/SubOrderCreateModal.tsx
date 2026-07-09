// ============================================================
// B4Y SuperAPP – Subunternehmer beauftragen (Auftrag SUB)
// Aus einem ODER MEHREREN bestehenden Hauptaufträgen Positionen/Teilmengen
// wählen (gruppiert nach Quellauftrag), einem Subunternehmer zuordnen,
// Konditionen + SUB-Preise festlegen → ein Auftrag-SUB (mode "merge") bzw.
// je Quellauftrag einer ("perSource") – analog zur Angebot→Auftrag-Umwandlung.
// Interne Kundenpreise/Marge nur HIER sichtbar (nicht im späteren SUB-PDF).
// Mengen-/Übervergabeschutz JE Quellauftrag über die zentrale Engine.
// Quelldokumente bleiben unverändert.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import SourceSelectLayout, { PreviewCard, PreviewNote } from "./SourceSelectLayout";
import { supabase } from "../../lib/supabase";
import { eur } from "../../lib/format";
import { normalizePositions, isCommercial } from "../../lib/document-types";
import { contactDisplayName } from "../../lib/contact-name";
import { resolvePaymentConditions } from "../../lib/payment-conditions";
import { subAllocatedAcross, createSubOrdersFromOrders, SubLine } from "../../lib/sub-orders";
import { OfferType, variantLabel } from "../../lib/offer-kinds";
import { loadTransitionFor, deriveFollowDoc, resolveFollowStandardTexts } from "../../lib/document-transitions";
import { logProject } from "../../lib/projectlog";
import { toast, toastError } from "../../lib/toast";
import SignatureSourcePicker from "./SignatureSourcePicker";
import { SignatureSource } from "../../lib/document-signature";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

type SrcOrder = { id: string; order_number?: string | null; title?: string | null; items?: unknown };
interface PosRow { key: string; orderId: string; orderLabel: string; title: string; posNo: string | null; name: string; longText: string | null; unit: string; qty: number; custEp: number; open: number }
interface Sel { qty: number; subEp: number }

export default function SubOrderCreateModal({
  orders, projectId, onClose, onCreated, createdBy, variant,
}: {
  orders: SrcOrder[];
  projectId?: string | null;
  onClose: () => void;
  onCreated: () => void;
  createdBy?: string | null;
  variant?: OfferType | null;   // gewählte Variante (Standard/Pauschal/Regie) – setzt das SUB-PDF-Label
}) {
  const subVariantLabel = variant ? `${variantLabel("auftrag", variant)} SUB` : null;
  const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const multi = orders.length > 1;
  const [subs, setSubs] = useState<any[]>([]);
  const [subId, setSubId] = useState("");
  const [allocated, setAllocated] = useState<Map<string, number>>(new Map()); // key `${orderId}::${posId}`
  const [sel, setSel] = useState<Map<string, Sel>>(new Map());
  const [mode, setMode] = useState<"merge" | "perSource">("merge");
  const [busy, setBusy] = useState(false);
  // Konditionen
  const [c, setC] = useState({ paymentTermDays: "", skontoPercent: "", skontoDays: "", retentionPercent: "", servicePeriod: "" });
  const [globalDiscount, setGlobalDiscount] = useState(""); // % Nachlass auf Kundenpreis → SUB-EP
  const [signatureSource, setSignatureSource] = useState<SignatureSource>("company"); // Signaturquelle des SUB-PDFs

  const aKey = (orderId: string, posId: string) => `${orderId}::${posId}`;

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("contacts").select("*").eq("type", "subunternehmer").order("company");
        setSubs(data ?? []);
      } catch { setSubs([]); }
      try {
        setAllocated(await subAllocatedAcross(orderIds));
      } catch { setAllocated(new Map()); }
    })();
    // Stabiler String-Key statt Array-Referenz (Aufrufer erzeugen je Render neue Arrays).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIds.join(",")]);

  // Beim Wählen des Subunternehmers dessen EINGANGS-Konditionen vorschlagen
  // (zentrale Logik; nur befüllen, wenn gesetzt – Werte bleiben überschreibbar).
  useEffect(() => {
    if (!subId) return;
    const sub = subs.find((s: any) => s.id === subId);
    if (!sub) return;
    const pc = resolvePaymentConditions(sub as any, "in");
    setC((prev) => ({
      ...prev,
      paymentTermDays: pc.termDays != null ? String(pc.termDays) : "",
      skontoPercent: pc.skontoPercent != null ? String(pc.skontoPercent) : "",
      skontoDays: pc.skontoDays != null ? String(pc.skontoDays) : "",
    }));
    // Eingangs-Standardnachlass des Subunternehmers als globalen SUB-Nachlass vorbelegen
    // (z. B. 20 % → SUB-EP = Kundenpreis − 20 %). Überschreibbar; Stammdaten bleiben unberührt.
    const inDisc = Number((sub as any).in_discount_percent);
    if (Number.isFinite(inDisc) && inDisc > 0) setGlobalDiscount(String(inDisc));
  }, [subId, subs]);

  // Positionen aus allen gewählten Hauptaufträgen (je Auftrag, je Titel) + offene Menge
  const rows = useMemo<PosRow[]>(() => {
    const out: PosRow[] = [];
    for (const o of orders) {
      const label = o.order_number || o.title || o.id.slice(0, 8);
      let curTitle = "";
      for (const p of normalizePositions(o.items)) {
        if (p.type === "title") { curTitle = p.name || ""; continue; }
        if (!isCommercial(p.type)) continue;
        const qty = Number(p.qty) || 0;
        const open = round2(qty - (allocated.get(aKey(o.id, p.id)) || 0));
        out.push({ key: aKey(o.id, p.id), orderId: o.id, orderLabel: label, title: curTitle, posNo: p.number, name: p.name || "(ohne Bezeichnung)", longText: p.long_text, unit: p.unit || "Stk", qty, custEp: Number(p.unit_price) || 0, open });
      }
    }
    return out;
  }, [orders, allocated]);

  // Gruppierung: Quellauftrag → Titel → Positionen
  const grouped = useMemo(() => {
    const byOrder: { orderId: string; label: string; titles: { title: string; rows: PosRow[] }[] }[] = [];
    for (const r of rows) {
      let og = byOrder.find((x) => x.orderId === r.orderId);
      if (!og) { og = { orderId: r.orderId, label: r.orderLabel, titles: [] }; byOrder.push(og); }
      let tg = og.titles.find((t) => t.title === r.title);
      if (!tg) { tg = { title: r.title, rows: [] }; og.titles.push(tg); }
      tg.rows.push(r);
    }
    return byOrder;
  }, [rows]);

  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const subEpFor = (r: PosRow) => round2(r.custEp * (1 - (Number(globalDiscount) || 0) / 100));

  const toggle = (r: PosRow) => setSel((prev) => {
    const m = new Map(prev);
    if (m.has(r.key)) m.delete(r.key);
    else m.set(r.key, { qty: r.open, subEp: subEpFor(r) });
    return m;
  });
  const setSelField = (key: string, f: keyof Sel, v: number) => setSel((prev) => {
    const m = new Map(prev); const s = m.get(key); if (!s) return prev; m.set(key, { ...s, [f]: v }); return m;
  });
  const toggleTitleAll = (rs: PosRow[], on: boolean) => setSel((prev) => {
    const m = new Map(prev);
    for (const r of rs.filter((x) => x.open > 0.0001)) {
      if (on) { if (!m.has(r.key)) m.set(r.key, { qty: r.open, subEp: subEpFor(r) }); }
      else m.delete(r.key);
    }
    return m;
  });
  const applyGlobalDiscount = () => setSel((prev) => {
    const m = new Map(prev); const d = Number(globalDiscount) || 0;
    for (const [k, s] of m) { const r = rowByKey.get(k); if (r) m.set(k, { ...s, subEp: round2(r.custEp * (1 - d / 100)) }); }
    return m;
  });

  const selRows = rows.filter((r) => sel.has(r.key));
  const subNet = round2(selRows.reduce((a, r) => a + (sel.get(r.key)!.qty * sel.get(r.key)!.subEp), 0));
  const custNet = round2(selRows.reduce((a, r) => a + (sel.get(r.key)!.qty * r.custEp), 0));
  const margin = round2(custNet - subNet);
  const selOrderCount = new Set(selRows.map((r) => r.orderId)).size;

  async function create() {
    if (!subId) { toastError("Bitte einen Subunternehmer auswählen."); return; }
    const lines: SubLine[] = selRows
      .filter((r) => (sel.get(r.key)!.qty || 0) > 0)
      .map((r) => ({
        sourceKey: r.orderId === "" ? r.key : r.key.split("::")[1], // reine Position-ID
        sourceOrderId: r.orderId,
        posNo: r.posNo, shortText: r.name, longText: r.longText, unit: r.unit,
        qty: sel.get(r.key)!.qty, customerUnitPrice: r.custEp, unitPrice: sel.get(r.key)!.subEp, vatRate: 20,
      }));
    if (!lines.length) { toastError("Bitte mindestens eine Position mit Menge auswählen."); return; }
    setBusy(true);
    // Varianten-Texte (Label/Vor-/Nachtext) der gewählten Variante für den SUB ziehen (Migr. 0075).
    const subTrans = variant?.id ? await loadTransitionFor(variant.id) : null;
    const subFollow = deriveFollowDoc("sub_order", { offer_type_id: variant?.id ?? null, display_settings_snapshot: (variant?.display as any) ?? null }, subTrans, variant ?? null);
    // Vor-/Nachtext zentral aus den Standardtexten (text_blocks) je Doctype/Variante (Legacy gewinnt, falls gesetzt).
    const subTexts = await resolveFollowStandardTexts("sub_order", variant?.id ?? null, subTrans);
    const r = await createSubOrdersFromOrders({
      orderIds, projectId: projectId ?? null, mode, createdBy: createdBy ?? null,
      group: {
        subcontractorId: subId,
        conditions: {
          paymentTermDays: c.paymentTermDays ? Number(c.paymentTermDays) : null,
          skontoPercent: c.skontoPercent ? Number(c.skontoPercent) : null,
          skontoDays: c.skontoDays ? Number(c.skontoDays) : null,
          retentionPercent: c.retentionPercent ? Number(c.retentionPercent) : null,
          servicePeriod: c.servicePeriod || null,
          pdfLabel: subFollow.pdf_label ?? subVariantLabel,
          introText: subTexts.intro,
          closingText: subTexts.closing,
          signatureSource,
        },
        lines,
      },
    });
    setBusy(false);
    if (r.error) { toastError(r.error); return; }
    const subName = contactDisplayName(subs.find((s) => s.id === subId) ?? null, { fallback: "Subunternehmer" });
    const made = r.created ?? [];
    const totalNet = round2(made.reduce((a, x) => a + (x.net || 0), 0));
    const totalCount = made.reduce((a, x) => a + (x.count || 0), 0);
    if (projectId && made.length) {
      await logProject(projectId, "auftrag", `${made.length} Auftrag-SUB an ${subName} erstellt (${made.map((x) => x.number || "").filter(Boolean).join(", ")}). ${totalCount} Position(en) aus ${selOrderCount} Auftrag(en), netto ${eur(totalNet)}.`);
    }
    toast(made.length === 1 ? `Auftrag-SUB ${made[0].number || ""} an ${subName} erstellt.` : `${made.length} Auftrag-SUB an ${subName} erstellt.`);
    onCreated();
  }

  const subLabel = (s: any) => contactDisplayName(s, { fallback: s?.email || "—" });

  const header = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-slate-500">Subunternehmer
        <select className="input mt-1" value={subId} onChange={(e) => setSubId(e.target.value)}>
          <option value="">– auswählen –</option>
          {subs.map((s) => <option key={s.id} value={s.id}>{subLabel(s)}</option>)}
        </select>
        {subs.length === 0 && <span className="mt-1 block text-[11px] text-amber-600">Keine Kontakte vom Typ „Subunternehmer" vorhanden.</span>}
      </label>
      <label className="text-xs font-medium text-slate-500">Nachlass auf Kundenpreis (%) → SUB-EP
        <div className="mt-1 flex gap-2">
          <input type="number" className="input" value={globalDiscount} onChange={(e) => setGlobalDiscount(e.target.value)} placeholder="z. B. 15" />
          <button type="button" className="btn-outline whitespace-nowrap px-2 text-xs" onClick={applyGlobalDiscount}>Anwenden</button>
        </div>
      </label>
      {multi && (
        <label className="text-xs font-medium text-slate-500 sm:col-span-2">Aus mehreren Aufträgen
          <select className="input mt-1" value={mode} onChange={(e) => setMode(e.target.value as "merge" | "perSource")}>
            <option value="merge">Ein gemeinsamer Auftrag-SUB (alle Aufträge zusammenführen)</option>
            <option value="perSource">Je Quellauftrag ein eigener Auftrag-SUB</option>
          </select>
        </label>
      )}
    </div>
  );

  const previewCol = (
    <>
      <PreviewCard title="Konditionen">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-500">Zahlungsziel (Tage)<input type="number" className="input mt-1" value={c.paymentTermDays} onChange={(e) => setC({ ...c, paymentTermDays: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">Skonto %<input type="number" className="input mt-1" value={c.skontoPercent} onChange={(e) => setC({ ...c, skontoPercent: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">Skonto Tage<input type="number" className="input mt-1" value={c.skontoDays} onChange={(e) => setC({ ...c, skontoDays: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">Haftrücklass %<input type="number" className="input mt-1" value={c.retentionPercent} onChange={(e) => setC({ ...c, retentionPercent: e.target.value })} /></label>
          <label className="col-span-2 text-[11px] text-slate-500">Ausführung<input className="input mt-1" value={c.servicePeriod} onChange={(e) => setC({ ...c, servicePeriod: e.target.value })} placeholder="z. B. KW 30–32" /></label>
        </div>
        <div className="mt-2">
          <SignatureSourcePicker value={signatureSource} createdBy={createdBy ?? null} onChange={setSignatureSource} />
        </div>
      </PreviewCard>
      <PreviewCard title="Vorschau (intern)">
        <div className="flex justify-between"><span>SUB netto</span><b className="tabular-nums text-slate-700 dark:text-slate-200">{eur(subNet)}</b></div>
        <div className="flex justify-between"><span>Kunde netto</span><span className="tabular-nums">{eur(custNet)}</span></div>
        <div className="flex justify-between"><span>Marge</span><b className={`tabular-nums ${margin >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{eur(margin)}</b></div>
        {multi && selOrderCount > 0 && <div className="mt-1 text-[11px] text-slate-400">{mode === "merge" ? `1 SUB aus ${selOrderCount} Auftrag(en)` : `${selOrderCount} SUB (je Quellauftrag)`}</div>}
      </PreviewCard>
      {!subId && <PreviewNote>Bitte einen Subunternehmer auswählen.</PreviewNote>}
      {subId && selRows.length === 0 && <PreviewNote>Bitte mindestens eine Position mit Menge wählen.</PreviewNote>}
    </>
  );

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button className="btn-ghost" onClick={onClose} disabled={busy}>Zurück</button>
      <button className="btn-primary" onClick={create} disabled={busy || !subId || selRows.length === 0}>
        {busy ? "Erstelle …" : "Auftrag-SUB erstellen"}
      </button>
    </div>
  );

  return (
    <SourceSelectLayout
      title={subVariantLabel ? `Subunternehmer beauftragen – ${subVariantLabel}` : "Subunternehmer beauftragen"}
      onClose={onClose} header={header} listLabel={multi ? "Positionen aus gewählten Aufträgen" : "Positionen aus Hauptauftrag"} preview={previewCol} footer={footer}
      list={
        <div>
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-slate-400">Die gewählten Aufträge enthalten keine verrechenbaren Positionen.</div>
        ) : grouped.map((og) => (
          <div key={og.orderId}>
            {multi && (
              <div className="bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-slate-300">
                Auftrag {og.label}
              </div>
            )}
            {og.titles.map((tg) => (
              <div key={og.orderId + "::" + (tg.title || "__none")} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-white/5">
                  <span className="flex-1">{tg.title || "Positionen"}</span>
                  <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => toggleTitleAll(tg.rows, true)}>Alle</button>
                  <button type="button" className="text-slate-400 hover:underline" onClick={() => toggleTitleAll(tg.rows, false)}>Keine</button>
                </div>
                {tg.rows.map((r) => {
                  const s = sel.get(r.key);
                  const disabled = r.open <= 0.0001;
                  return (
                    <div key={r.key} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${disabled ? "opacity-50" : ""}`}>
                      <input type="checkbox" className="h-4 w-4 shrink-0" checked={!!s} disabled={disabled} onChange={() => toggle(r)} />
                      <span className="font-mono text-xs text-slate-400">{r.posNo || "–"}</span>
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <span className="shrink-0 text-xs text-slate-400">offen {r.open} {r.unit}</span>
                      {s ? (
                        <>
                          <input type="number" className="input w-20" title="Menge" value={s.qty} max={r.open}
                            onChange={(e) => setSelField(r.key, "qty", Math.min(r.open, Math.max(0, Number(e.target.value) || 0)))} />
                          <span className="shrink-0 text-[11px] text-slate-400" title="Kundenpreis netto (intern)">K: {eur(r.custEp)}</span>
                          <input type="number" step="0.01" className="input w-24" title="SUB-Einheitspreis netto" value={s.subEp}
                            onChange={(e) => setSelField(r.key, "subEp", Number(e.target.value) || 0)} />
                          <span className="shrink-0 w-24 text-right tabular-nums text-xs font-semibold">{eur(s.qty * s.subEp)}</span>
                        </>
                      ) : (
                        <span className="shrink-0 text-xs text-slate-400">EP {eur(r.custEp)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
      }
    />
  );
}
