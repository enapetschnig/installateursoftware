// ============================================================
// B4Y SuperAPP – Editor für Auftrag-SUB (Subunternehmer)
// ------------------------------------------------------------
// Schlank-vollständiger Editor analog zu OrderEditor (DocumentWorkspace +
// useDocumentBuilder), aber OHNE Versionierung/Finalisierung (SUB hat das nicht).
// Bearbeitbar: Positionen (SUB-Preise), Konditionen, Status, Subunternehmer +
// Ansprechpartner, abweichende Empfängeranschrift, PDF-Label, Vor-/Nachtext,
// Signaturquelle, MwSt-Modus. Speichern schreibt sub_orders.items (JSONB) +
// net/vat/gross/cost_basis_net/margin_net und synchronisiert sub_order_items
// relational (Muster aus sub-orders.ts/SubOrderCreateModal).
//
// INTERN vs. EXTERN: Kundenpreis (custEp) + Marge werden NUR in der Editor-UI
// angezeigt (Konditionen-Box). sub_orders.items enthält keine Kundenpreise →
// das SUB-PDF (subOrderPdf.ts) zeigt sie nicht. Quelldokumente bleiben unberührt.
//
// ÜBER-VERGABE-GUARD: Beim Speichern (und live als Warnung) wird je Quellposition
// geprüft, dass die an SUBs vergebene Menge die im Hauptauftrag verfügbare Menge
// nicht übersteigt. Dazu wird die zentrale Engine `subAllocatedAcross` genutzt und
// die EIGENE bereits gespeicherte Vergabe dieses SUB abgezogen (Ausschluss), bevor
// gegen die Quell-Verfügbarkeit geprüft wird.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Ban, Trash2 } from "lucide-react";
import { isUuid } from "../lib/documents-overview";
import { supabase } from "../lib/supabase";
import { Spinner, Badge, Modal } from "../components/ui";
import { ErrorBanner, ConfirmDialog } from "../components/calc-ui";
import { Contact, ContactPerson, Project } from "../lib/types";
import { eur, dateAt } from "../lib/format";
import { logProject } from "../lib/projectlog";
import { useDocumentBuilder } from "../hooks/useDocumentBuilder";
import {
  DocPosition, normalizePositions, lineNet, isCommercial, computeSummary,
} from "../lib/document-types";
import {
  DocumentConditions, emptyDocumentConditions, conditionsToPaymentMeta,
} from "../lib/payment-conditions";
import ConditionsSettings from "../components/document/ConditionsSettings";
import DocumentWorkspace from "../components/document/DocumentWorkspace";
import ProjectContextChips from "../components/project/ProjectContextChips";
import { MoreAction } from "../components/document/DocumentToolbar";
import { resolveRecipientLines, RecipientOverride, contactDisplayName } from "../lib/contact-name";
import { ensureDocumentNumber } from "../lib/document-numbers";
import RecipientOverrideEditor from "../components/document/RecipientOverrideEditor";
import SignatureSourcePicker from "../components/document/SignatureSourcePicker";
import { SignatureSource, normalizeSignatureSource } from "../lib/document-signature";
import { VatMode, withParagraph19Note } from "../lib/offer-types";
import { toastError } from "../lib/toast";
import { buildDocPlaceholders, resolveDocTexts } from "../lib/document-placeholders";
import { loadCompanySettings, CompanySettings } from "../lib/company";
import { OfferDisplay } from "../lib/offer-display";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/permissions";
import { DELETE_CONFIRM_TEXT, DELETE_GONE_TEXT, deleteDraftDocument } from "../lib/document-delete";
import { subAllocatedAcross } from "../lib/sub-orders";
import { openSubOrderPdf } from "../components/document/subOrderPdf";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// SUB-Status (dokumentiert: entwurf|versendet|akzeptiert|storniert). Tolerant gegenüber
// Altbeständen (z. B. 'freigegeben' aus der Vergabe-Übersicht) → Label-Fallback.
const SUB_STATUS = ["entwurf", "versendet", "akzeptiert", "storniert"] as const;
const SUB_STATUS_LABEL: Record<string, string> = {
  entwurf: "Entwurf", versendet: "Versendet", akzeptiert: "Akzeptiert",
  storniert: "Storniert", freigegeben: "Freigegeben",
};
function subStatusTone(s: string): "slate" | "blue" | "green" | "amber" | "red" {
  if (s === "versendet") return "blue";
  if (s === "akzeptiert" || s === "freigegeben") return "green";
  if (s === "storniert") return "red";
  return "slate";
}

export default function SubOrderEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const can = useCan();

  const [sub, setSub] = useState<any | null>(null);
  const [head, setHead] = useState({
    sub_number: "", sub_date: new Date().toISOString().slice(0, 10),
    title: "", project_id: "", subcontractor_id: "", contact_person_id: "",
    status: "entwurf", service_period: "",
    pdf_label: "", doc_intro_text: "", doc_closing_text: "",
  });

  const [subs, setSubs] = useState<Contact[]>([]);          // Subunternehmer (contacts type=subunternehmer)
  const [persons, setPersons] = useState<ContactPerson[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);

  const [conditions, setConditions] = useState<DocumentConditions>(emptyDocumentConditions());
  const [recipientOverride, setRecipientOverride] = useState<RecipientOverride | null>(null);
  const [vatMode, setVatMode] = useState<VatMode>("standard");
  const [signatureSource, setSignatureSource] = useState<SignatureSource>("company");

  // INTERNE Kalkulation: Kundenpreis netto je Position (aus sub_order_items) → Marge.
  // Schlüssel = JSONB-Positions-id (== source_order_item_key der relationalen Zeile).
  const [custPriceByKey, setCustPriceByKey] = useState<Map<string, number>>(new Map());
  // Bereits an SUBs vergebene Menge je (Quellauftrag, Position) – inkl. dieses SUB.
  const [allocatedAcross, setAllocatedAcross] = useState<Map<string, number>>(new Map());
  // Eigene gespeicherte Vergabe dieses SUB je (Quellauftrag, Position) → Ausschluss beim Guard.
  const [ownAlloc, setOwnAlloc] = useState<Map<string, number>>(new Map());
  // Quellauftrag je Position (JSONB-id → source_order_id) für die Verfügbarkeitsprüfung.
  const [sourceOrderByKey, setSourceOrderByKey] = useState<Map<string, string>>(new Map());
  // Im jeweiligen Quellauftrag insgesamt verfügbare Menge je (Quellauftrag, Position).
  const [availByAllocKey, setAvailByAllocKey] = useState<Map<string, number>>(new Map());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmStorno, setConfirmStorno] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  const vatOverride = vatMode === "par19" ? 0 : null;
  const builder = useDocumentBuilder([], vatOverride, conditions.discountPercent);

  const allocKey = (orderId: string, key: string) => `${orderId}::${key}`;

  async function load() {
    if (!id) return;
    setLoading(true);
    const [s, subRes, projRes, co] = await Promise.all([
      supabase.from("sub_orders").select("*").eq(isUuid(id) ? "id" : "sub_number", id).maybeSingle(),
      supabase.from("contacts").select("*").eq("type", "subunternehmer").order("company"),
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      loadCompanySettings().catch(() => null),
    ]);
    setCompany(co);
    setSubs((subRes.data as Contact[]) ?? []);
    setProjects((projRes.data as Project[]) ?? []);
    if (s.error) { setErr(s.error.message); setLoading(false); return; }
    const so = s.data as any | null;
    setSub(so);
    if (so) {
      setHead({
        sub_number: so.sub_number ?? "", sub_date: so.sub_date ?? new Date().toISOString().slice(0, 10),
        title: so.title ?? "", project_id: so.project_id ?? "",
        subcontractor_id: so.subcontractor_id ?? "", contact_person_id: so.contact_person_id ?? "",
        status: so.status ?? "entwurf", service_period: so.service_period ?? "",
        pdf_label: so.pdf_label ?? "", doc_intro_text: so.doc_intro_text ?? "", doc_closing_text: so.doc_closing_text ?? "",
      });
      builder.reset(normalizePositions(so.items));
      setRecipientOverride((so.recipient_override as RecipientOverride) ?? null);
      setVatMode((so.vat_mode as VatMode) ?? "standard");
      setSignatureSource(normalizeSignatureSource(so.signature_source));
      // Konditionen: aus den gespeicherten SUB-Spalten ableiten (SUB hat keinen
      // conditions_snapshot wie Angebot/Auftrag → Zahlungskonditionen direkt).
      setConditions({
        ...emptyDocumentConditions(),
        termDays: so.payment_term_days ?? null,
        skontoPercent: so.skonto_percent ?? null,
        skontoDays: so.skonto_days ?? null,
        discountPercent: so.discount_percent ?? null,
      });

      // Ansprechpartner des Subunternehmers laden.
      if (so.subcontractor_id) {
        const { data: pp } = await supabase.from("contact_persons").select("*")
          .eq("contact_id", so.subcontractor_id).order("sort_order");
        setPersons((pp as ContactPerson[]) ?? []);
      }

      // Relationale SUB-Positionen: interne Kundenpreise + eigene Vergabe + Quellauftrag je Position.
      const { data: items } = await supabase.from("sub_order_items")
        .select("source_order_id, source_order_item_key, customer_unit_price, qty, is_title")
        .eq("sub_order_id", so.id);
      const cust = new Map<string, number>();
      const own = new Map<string, number>();
      const srcByKey = new Map<string, string>();
      const srcOrderIds = new Set<string>();
      for (const it of (items ?? []) as any[]) {
        if (it.is_title) continue;
        const key = it.source_order_item_key as string | null;
        const oid = it.source_order_id as string | null;
        if (key) cust.set(key, Number(it.customer_unit_price) || 0);
        if (key && oid) {
          srcByKey.set(key, oid);
          own.set(allocKey(oid, key), (own.get(allocKey(oid, key)) || 0) + (Number(it.qty) || 0));
          srcOrderIds.add(oid);
        }
      }
      setCustPriceByKey(cust);
      setOwnAlloc(own);
      setSourceOrderByKey(srcByKey);

      // Verfügbare Menge je (Quellauftrag, Position) aus den Quellaufträgen + Gesamt-Vergabe.
      const ids = [...srcOrderIds];
      if (ids.length) {
        const [{ data: srcOrders }, across] = await Promise.all([
          supabase.from("orders").select("id, items").in("id", ids),
          subAllocatedAcross(ids),
        ]);
        const avail = new Map<string, number>();
        for (const o of (srcOrders ?? []) as any[]) {
          for (const p of normalizePositions(o.items)) {
            if (isCommercial(p.type)) avail.set(allocKey(o.id, p.id), Number(p.qty) || 0);
          }
        }
        setAvailByAllocKey(avail);
        setAllocatedAcross(across);
      }
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);

  const setH = (k: keyof typeof head, v: any) => {
    setHead((p) => ({ ...p, [k]: v }));
    builder.setDirty(true);
    if (k === "subcontractor_id" && v) {
      supabase.from("contact_persons").select("*").eq("contact_id", v).order("sort_order")
        .then(({ data }) => setPersons((data as ContactPerson[]) ?? []));
      setHead((p) => ({ ...p, contact_person_id: "" }));
    } else if (k === "subcontractor_id") { setPersons([]); setHead((p) => ({ ...p, contact_person_id: "" })); }
  };

  const isStorno = head.status === "storniert";

  // ── Über-Vergabe-Guard ──────────────────────────────────────────────────
  // Prüft je Position dieses SUB, ob die geplante (aktuell im Editor stehende) Menge
  // die im Quellauftrag noch verfügbare Menge übersteigt. Verfügbar = Auftragsmenge
  // − (an alle aktiven SUB vergeben − EIGENE bereits gespeicherte Vergabe dieses SUB).
  // Positionen ohne bekannten Quellauftrag (freie Zugaben ohne Herkunft) werden nicht
  // limitiert (keine Quelle = keine Begrenzung möglich). Liefert die erste Fehlermeldung
  // oder null (alles ok).
  function checkOverAllocation(positions: DocPosition[]): string | null {
    for (const p of positions) {
      if (!isCommercial(p.type)) continue;
      const key = p.id;
      const orderId = sourceOrderByKey.get(key);
      if (!orderId) continue; // keine bekannte Quelle → nicht begrenzbar
      const ak = allocKey(orderId, key);
      const available = availByAllocKey.get(ak);
      if (available == null) continue; // Quellposition nicht (mehr) auffindbar → nicht begrenzen
      const allocOthers = (allocatedAcross.get(ak) || 0) - (ownAlloc.get(ak) || 0); // Fremd-Vergabe
      const planned = Number(p.qty) || 0;
      if (round2(allocOthers + planned) > round2(available) + 0.0001) {
        const free = round2(available - allocOthers);
        return `Übervergabe bei „${p.name || p.number || key}": maximal ${free < 0 ? 0 : free} ${p.unit || ""} verfügbar (Quellauftrag-Menge ${available}).`;
      }
    }
    return null;
  }

  // Live-Warnung bei Mengeneingabe (blockiert nicht; harte Sperre erfolgt beim Speichern).
  const overAllocWarning = useMemo(
    () => checkOverAllocation(builder.positions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [builder.positions, sourceOrderByKey, availByAllocKey, allocatedAcross, ownAlloc],
  );

  async function save(nextStatus?: string) {
    if (!sub) return;
    const status = nextStatus ?? head.status;
    const positions = builder.positions;

    // Erster verbindlicher Statuswechsel aus dem Entwurf (versendet/akzeptiert/freigegeben)
    // → SUB-Nummer atomar vergeben (idempotent). Entwurf speichern/stornieren zieht KEINE Nummer.
    let docNumber = head.sub_number || null;
    if (!docNumber && nextStatus && !["entwurf", "storniert"].includes(nextStatus)) {
      const ensured = await ensureDocumentNumber("sub_order", sub.id);
      if (!ensured.number) { setErr(ensured.error ?? "SUB-Nummer konnte nicht vergeben werden."); toastError(ensured.error ?? "SUB-Nummer konnte nicht vergeben werden."); return; }
      docNumber = ensured.number;
      setHead((p) => ({ ...p, sub_number: ensured.number! }));
    }

    // Harter Über-Vergabe-Guard (Quellverfügbarkeit, eigener SUB ausgeschlossen).
    // Beim Stornieren NICHT prüfen – Storno gibt Mengen frei und muss immer möglich sein.
    if (status !== "storniert") {
      const overErr = checkOverAllocation(positions);
      if (overErr) { setErr(overErr); toastError(overErr); return; }
    }

    setSaving(true); setErr(null);

    const p19 = vatMode === "par19";
    const s = computeSummary(positions, p19 ? 0 : null, conditions.discountPercent);
    // Selbstkosten (intern) = Σ Menge × Kundenpreis netto je Position (aus custPriceByKey).
    let cost = 0;
    for (const p of positions) {
      if (!isCommercial(p.type)) continue;
      cost += round2((Number(p.qty) || 0) * (custPriceByKey.get(p.id) || 0));
    }
    cost = round2(cost);

    const { error: sErr } = await supabase.from("sub_orders").update({
      sub_date: head.sub_date,
      title: head.title || null,
      project_id: head.project_id || null,
      subcontractor_id: head.subcontractor_id || null,
      contact_person_id: head.contact_person_id || null,
      status,
      service_period: head.service_period || null,
      payment_term_days: conditions.termDays ?? null,
      skonto_percent: conditions.skontoPercent ?? null,
      skonto_days: conditions.skontoDays ?? null,
      // Haftrücklass hat kein Feld in DocumentConditions → bestehenden Wert erhalten
      // (wird im Vergabe-Modal gesetzt; hier nicht editierbar, aber nicht verlieren).
      retention_percent: (sub as any).retention_percent ?? null,
      discount_percent: conditions.discountPercent ?? null,
      vat_mode: p19 ? "par19" : "standard",
      pdf_label: head.pdf_label || null,
      doc_intro_text: head.doc_intro_text || null,
      doc_closing_text: head.doc_closing_text || null,
      recipient_override: recipientOverride,
      signature_source: signatureSource,
      items: positions,
      net: s.net, vat: s.vat, gross: s.gross,
      cost_basis_net: cost, margin_net: round2(cost - s.net),
      updated_at: new Date().toISOString(),
    }).eq("id", sub.id);
    if (sErr) { setErr(sErr.message); setSaving(false); return; }

    // sub_order_items relational synchron halten (Muster aus sub-orders.ts):
    // Quellverweise (source_order_id/source_order_item_key) + interne Kundenpreise erhalten.
    await supabase.from("sub_order_items").delete().eq("sub_order_id", sub.id);
    const rows = positions.map((p, i) => {
      const title = p.type === "title";
      const key = p.id;
      const oid = title ? null : (sourceOrderByKey.get(key) ?? sub.order_id ?? null);
      return {
        sub_order_id: sub.id,
        source_order_id: oid,
        source_order_item_key: title ? null : key,
        pos_no: p.number ?? null,
        short_text: title ? (p.name || null) : (p.name || null),
        long_text: p.long_text || null,
        qty: title ? 0 : (Number(p.qty) || 0),
        unit: p.unit ?? null,
        customer_unit_price: title ? 0 : (custPriceByKey.get(key) || 0),
        unit_price: title ? 0 : (Number(p.unit_price) || 0),
        discount_percent: Number(p.discount_percent) || 0,
        vat_rate: Number(p.vat_rate) || 20,
        net: lineNet(p),
        is_title: title,
        sort_order: i,
      };
    });
    if (rows.length) {
      const { error: iErr } = await supabase.from("sub_order_items").insert(rows);
      if (iErr) { setErr(iErr.message); setSaving(false); return; }
    }

    if (head.project_id) {
      await logProject(head.project_id, "auftrag",
        `Auftrag-SUB ${docNumber || sub.id} gespeichert (${SUB_STATUS_LABEL[status] ?? status}).`);
    }
    setSaving(false);
    if (nextStatus) { setHead((p) => ({ ...p, status: nextStatus })); setSub((o: any) => (o ? { ...o, status: nextStatus } : o)); }
    builder.markSaved();
    // Eigene Vergabe-/Gesamtwerte nach dem Speichern frisch laden (für korrekten Live-Guard).
    await load();
  }

  async function changeStatus(status: string) {
    if (!sub) return;
    await save(status);
  }

  async function deleteDraft() {
    if (!sub) return;
    // Zentrales Hard-Delete für Entwürfe (Status-Guard + RLS-konform, siehe document-delete.ts).
    const { error } = await deleteDraftDocument("sub_order", sub.id);
    if (error) { setErr(error); return; }
    goBack();
  }

  async function openPdf() {
    // Erst speichern (falls dirty), dann das zentrale SUB-PDF erzeugen (subOrderPdf.ts) –
    // keine zweite PDF-Logik, Empfänger = Subunternehmer, ohne Kundenpreise/Marge.
    // Bei ungespeicherten Änderungen zuerst den Über-Vergabe-Guard prüfen (kein PDF mit
    // ungültiger Menge); save() blockiert bei Verstoß ohnehin.
    if (builder.dirty) {
      const overErr = checkOverAllocation(builder.positions);
      if (overErr) { setErr(overErr); toastError(overErr); return; }
      await save();
    }
    const r = await openSubOrderPdf(sub.id);
    if (r.error) toastError(r.error);
  }

  if (loading) return <div className="pt-4"><Spinner /></div>;
  if (!sub || (sub as any).deleted_at) return (
    <div className="pt-4">
      <button onClick={() => nav(-1)} className="btn-ghost mb-4 px-2"><ArrowLeft size={18} /> Zurück</button>
      <div className="glass p-4 text-center text-slate-400">{DELETE_GONE_TEXT}</div>
    </div>
  );

  const subName = (c: Contact) => contactDisplayName(c as any, { fallback: "Subunternehmer" });
  const subcontractor = subs.find((c) => c.id === head.subcontractor_id);
  const subProject = projects.find((p) => p.id === head.project_id) || null;

  const goBack = () => (head.project_id ? nav(`/projekte/${head.project_id}`) : nav(-1));

  // Marge live (intern): Kundenpreis netto je Position − SUB-Netto.
  const internalCost = round2(builder.positions.reduce((a, p) =>
    a + (isCommercial(p.type) ? round2((Number(p.qty) || 0) * (custPriceByKey.get(p.id) || 0)) : 0), 0));
  const margin = round2(internalCost - builder.summary.net);

  // PDF-Meta (Empfänger = Subunternehmer, keine internen Werte). Platzhalter zentral auflösen.
  const subDocLabel = head.pdf_label || "Auftrag SUB";
  const subPh = buildDocPlaceholders({
    customer: subcontractor ?? null, project: subProject,
    docNumber: head.sub_number, docDate: head.sub_date,
    docLabel: subDocLabel, company, bearbeiter: profile?.name ?? "",
    conditions: { paymentTermDays: conditions.termDays, skontoPercent: conditions.skontoPercent, skontoDays: conditions.skontoDays },
  });
  const subTexts = resolveDocTexts({ intro: head.doc_intro_text, closing: head.doc_closing_text }, subPh);

  const subtitleLines: string[] = [];
  if (head.service_period) subtitleLines.push(`Ausführungszeitraum: ${head.service_period}`);
  if ((sub as any).retention_percent) subtitleLines.push(`Haftrücklass: ${(sub as any).retention_percent} %`);

  const subMeta = {
    docLabel: subDocLabel, vatLabel: vatMode === "par19" ? "MwSt §19 (0 %)" : "MwSt", numberLabel: "Auftrag",
    number: head.sub_number, title: head.title,
    customer: subcontractor ? subName(subcontractor) : "", date: dateAt(head.sub_date),
    projectNumber: subProject?.project_number ?? null,
    display: ((sub as any).display_settings_snapshot as OfferDisplay) || undefined,
    payment: conditionsToPaymentMeta(conditions),
    introHtml: subTexts.introHtml,
    closingHtml: withParagraph19Note(subTexts.closingHtml, vatMode === "par19"),
    recipientLines: resolveRecipientLines(recipientOverride, subcontractor),
    subtitleLines: subtitleLines.length ? subtitleLines : undefined,
    createdBy: (sub as any).created_by ?? null,
    signatureSource,
  };

  const moreActions: MoreAction[] = [
    { label: "PDF / Vorschau", icon: <FileText size={15} />, onClick: openPdf },
    ...(!isStorno ? [{ label: "Stornieren", icon: <Ban size={15} />, onClick: () => setConfirmStorno(true), danger: true }] : []),
    ...(head.status === "entwurf" && can("orders", "delete")
      ? [{ label: "Entwurf löschen", icon: <Trash2 size={15} />, onClick: () => setDelOpen(true), danger: true }]
      : []),
  ];

  return (
    <div className="pt-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {!head.project_id && <button onClick={goBack} className="btn-ghost px-2"><ArrowLeft size={18} /> Zurück</button>}
          {/* Ausführlicher Projektkontext – zentral, identisch zur Projektakte.
              (Kein Kunde-Chip: hier sind nur Subunternehmer-Kontakte geladen.) */}
          <ProjectContextChips project={subProject} />
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="slate">Auftrag SUB</Badge>
          <Badge tone={subStatusTone(head.status)}>{SUB_STATUS_LABEL[head.status] ?? head.status}</Badge>
        </div>
      </div>
      <ErrorBanner message={err} />

      {isStorno && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          Dieser Auftrag-SUB ist storniert: Positionen sind gesperrt. Die Einstellungen lassen sich weiterhin öffnen, anpassen und speichern.
        </div>
      )}

      {overAllocWarning && !isStorno && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          {overAllocWarning} – Speichern wird blockiert, bis die Menge die verfügbare Quellmenge nicht mehr übersteigt.
        </div>
      )}

      <DocumentWorkspace
        builder={builder}
        docType="auftrag_sub"
        docLabel={subDocLabel}
        numberLabel="Auftrag"
        projectId={head.project_id || null}
        sourceTable="sub_order"
        sourceId={sub.id}
        vatOverride={vatOverride}
        vatLabel={vatMode === "par19" ? "MwSt §19 (0 %)" : "MwSt"}
        printMeta={subMeta}
        onSave={() => save()}
        saving={saving}
        onFinalize={() => save()}
        onSettings={() => setSettingsOpen(true)}
        moreActions={moreActions}
        readOnly={isStorno}
      />

      {settingsOpen && (
        <Modal open onClose={() => setSettingsOpen(false)} title="Auftrag-SUB-Einstellungen" size="xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label">Betreff / Titel</label>
              <input className="input" value={head.title} placeholder="z. B. Trockenbau Obergeschoss" onChange={(e) => setH("title", e.target.value)} /></div>
            <div><label className="label">SUB-Nummer</label>
              <input className="input cursor-not-allowed opacity-70" value={head.sub_number || ""} readOnly title="Wird automatisch über den Nummernkreis vergeben." /></div>
            <div><label className="label">Datum</label>
              <input type="date" className="input" value={head.sub_date} onChange={(e) => setH("sub_date", e.target.value)} /></div>
            <div><label className="label">Status</label>
              <select className="input" value={head.status} onChange={(e) => setH("status", e.target.value)}>
                {SUB_STATUS.map((s) => <option key={s} value={s}>{SUB_STATUS_LABEL[s]}</option>)}
                {!SUB_STATUS.includes(head.status as any) && <option value={head.status}>{SUB_STATUS_LABEL[head.status] ?? head.status}</option>}
              </select></div>
            <div><label className="label">MwSt-Modus</label>
              <select className="input" value={vatMode} onChange={(e) => { setVatMode(e.target.value as VatMode); builder.setDirty(true); }}>
                <option value="standard">Regulär 20 %</option>
                <option value="par19">§19 Bauleistung (Reverse Charge, 0 %)</option>
              </select></div>
            <div><label className="label">Subunternehmer</label>
              <select className="input" value={head.subcontractor_id} onChange={(e) => setH("subcontractor_id", e.target.value)}>
                <option value="">– auswählen –</option>
                {subs.map((c) => <option key={c.id} value={c.id}>{c.contact_number ? `${c.contact_number} · ` : ""}{subName(c)}</option>)}
              </select></div>
            <div><label className="label">Projekt</label>
              <select className="input" value={head.project_id} onChange={(e) => setH("project_id", e.target.value)}>
                <option value="">– kein Projekt –</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.project_number ? `${p.project_number} · ` : ""}{p.title}</option>)}
              </select></div>
            {persons.length > 0 && (
              <div><label className="label">Ansprechpartner</label>
                <select className="input" value={head.contact_person_id} onChange={(e) => setH("contact_person_id", e.target.value)}>
                  <option value="">– keine Auswahl –</option>
                  {persons.map((pp) => <option key={pp.id} value={pp.id}>{[pp.first_name, pp.last_name].filter(Boolean).join(" ")}</option>)}
                </select></div>
            )}
            <div className="sm:col-span-2"><label className="label">Ausführungszeitraum</label>
              <input className="input" value={head.service_period} placeholder="z. B. KW 30–32" onChange={(e) => setH("service_period", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">PDF-Bezeichnung</label>
              <input className="input" value={head.pdf_label} placeholder="z. B. Auftrag SUB" onChange={(e) => setH("pdf_label", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">Einleitungstext (vor Positionen)</label>
              <textarea className="input min-h-[60px]" value={head.doc_intro_text} onChange={(e) => setH("doc_intro_text", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">Schlusstext (nach Positionen)</label>
              <textarea className="input min-h-[60px]" value={head.doc_closing_text} onChange={(e) => setH("doc_closing_text", e.target.value)} /></div>
            <SignatureSourcePicker value={signatureSource} createdBy={(sub as any).created_by ?? null}
              onChange={(v) => { setSignatureSource(v); builder.setDirty(true); }} />
          </div>
          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <ConditionsSettings conditions={conditions}
              onChange={(next) => { setConditions(next); builder.setDirty(true); }} />
          </div>
          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-sm font-bold">Abweichende Empfängeranschrift</div>
            <RecipientOverrideEditor value={recipientOverride}
              onChange={(next) => { setRecipientOverride(next); builder.setDirty(true); }} />
          </div>
          {/* Interne Marge-Vorschau (NICHT im SUB-PDF) */}
          <div className="mt-4 rounded-xl border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
            <div className="mb-1 text-sm font-bold">Kalkulation (intern)</div>
            <div className="flex justify-between"><span>SUB netto</span><b className="tabular-nums">{eur(builder.summary.net)}</b></div>
            <div className="flex justify-between"><span>Kunde netto</span><span className="tabular-nums">{eur(internalCost)}</span></div>
            <div className="flex justify-between"><span>Marge</span><b className={`tabular-nums ${margin >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{eur(margin)}</b></div>
            <p className="mt-1 text-[11px] text-slate-400">Kundenpreise/Marge sind intern und erscheinen nicht im SUB-PDF.</p>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary" onClick={() => setSettingsOpen(false)}>Fertig</button></div>
        </Modal>
      )}

      <ConfirmDialog
        open={confirmStorno}
        title="Auftrag-SUB stornieren?"
        confirmLabel="Stornieren"
        message={<>Soll Auftrag-SUB <b>{head.sub_number || sub.id}</b> storniert werden? Stornierte SUB geben vergebene Mengen wieder frei.</>}
        onConfirm={() => { changeStatus("storniert"); setConfirmStorno(false); }}
        onClose={() => setConfirmStorno(false)}
      />

      <ConfirmDialog
        open={delOpen}
        title="Entwurf löschen?"
        confirmLabel="Entwurf löschen"
        message={DELETE_CONFIRM_TEXT}
        onConfirm={() => { setDelOpen(false); deleteDraft(); }}
        onClose={() => setDelOpen(false)}
      />
    </div>
  );
}
