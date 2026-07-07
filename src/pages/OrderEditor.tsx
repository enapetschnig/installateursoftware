import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { isUuid } from "../lib/documents-overview";
import { ArrowLeft } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Badge, Modal } from "../components/ui";
import { ErrorBanner, ConfirmDialog } from "../components/calc-ui";
import {
  Order, OrderItem, ORDER_STATUS, ORDER_STATUS_LABEL,
  ORDER_INVOICE_STATUS_LABEL, Contact, ContactPerson, Project,
} from "../lib/types";
import { dateAt } from "../lib/format";
import { logProject } from "../lib/projectlog";
import { useDocumentBuilder } from "../hooks/useDocumentBuilder";
import { useModalParam } from "../hooks/useModalParam";
import { rememberProjectSection } from "../lib/project-nav";
import { docPath } from "../lib/documents-overview";
import { ensureDocumentNumber } from "../lib/document-numbers";
import { DocPosition, normalizePositions, emptyPosition, lineNet, isCommercial, applySurchargeToPositions, computeSummary } from "../lib/document-types";
import {
  DocumentConditions, emptyDocumentConditions, resolveDocumentConditions,
  conditionsFromSnapshot, conditionsToSnapshot, conditionsToPaymentMeta, showPaymentForDoc,
} from "../lib/payment-conditions";
import ConditionsSettings from "../components/document/ConditionsSettings";
import DocumentWorkspace from "../components/document/DocumentWorkspace";
import ProjectContextChips from "../components/project/ProjectContextChips";
import { buildDocumentMoreActions } from "../lib/document-actions";
import { aiDocActionLabels } from "../lib/ai-doc-actions";
import { resolveRecipientLines, RecipientOverride } from "../lib/contact-name";
import RecipientOverrideEditor from "../components/document/RecipientOverrideEditor";
import SignatureSourcePicker from "../components/document/SignatureSourcePicker";
import { SignatureSource, normalizeSignatureSource } from "../lib/document-signature";
import { VatMode, withParagraph19Note } from "../lib/offer-types";
import { toast, toastError, toastInfo } from "../lib/toast";
import { buildDocPlaceholders, resolveDocTexts } from "../lib/document-placeholders";
import { loadCompanySettings, CompanySettings } from "../lib/company";
import { OfferDisplay } from "../lib/offer-display";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/permissions";
import { isDeletable, softDeleteDocument, DELETE_CONFIRM_TEXT, DELETE_GONE_TEXT } from "../lib/document-delete";
import { isOrderReadonly, canCancelOrder, isDraftOrder, orderStatusTone as statusTone } from "../lib/order-status";
import { canConvertOrder } from "../lib/document-transitions";
import { finalizeDocumentVersion, finalizeStamp, loadVersionFlags, loadDocumentVersions, logReopen, VersionFlags, DocVersion } from "../lib/document-versions";
import VersionHistoryModal from "../components/document/VersionHistoryModal";
import { renderDocumentHtml } from "../components/document/printDocument";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** order_items (relational) → DocPosition[] (für Altdaten ohne JSONB). */
function itemsToPositions(items: OrderItem[]): DocPosition[] {
  return items
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((i) => emptyPosition("free", {
      name: i.short_text ?? "",
      long_text: i.long_text ?? null,
      qty: Number(i.qty) || 1,
      unit: i.unit ?? "Stk",
      unit_price: Number(i.unit_price) || 0,
      discount_percent: Number(i.discount_percent) || 0,
      vat_rate: Number(i.vat_rate) || 20,
    }));
}

export default function OrderEditor() {
  const { id } = useParams();
  const nav = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [head, setHead] = useState({
    order_number: "", order_date: new Date().toISOString().slice(0, 10),
    title: "", project_id: "", contact_id: "", person_id: "",
    payment_term_days: 14 as number | string, internal_note: "",
    status: "beauftragt", invoice_status: "offen", service_period: "",
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [persons, setPersons] = useState<ContactPerson[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmStorno, setConfirmStorno] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Versionshistorie URL-gekoppelt (?versions=1) → Escape aus dem PDF kehrt exakt hierher zurück.
  const [versionsOpen, setVersionsOpen] = useModalParam("versions");
  const [vFlags, setVFlags] = useState<VersionFlags | null>(null);
  const snapRef = useRef<{ positions: any; summary: any; meta: any } | null>(null);
  const { session, profile } = useAuth();
  const can = useCan();

  const [conditions, setConditions] = useState<DocumentConditions>(emptyDocumentConditions());
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [recipientOverride, setRecipientOverride] = useState<RecipientOverride | null>(null);
  const [vatMode, setVatMode] = useState<VatMode>("standard");
  const [signatureSource, setSignatureSource] = useState<SignatureSource>("company");
  const vatOverride = vatMode === "par19" ? 0 : null;
  const builder = useDocumentBuilder([], vatOverride, conditions.discountPercent);
  const [restoreVer, setRestoreVer] = useState<DocVersion | null>(null);
  const [workingBaseVer, setWorkingBaseVer] = useState<number | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    const [o, c, p, vf, co] = await Promise.all([
      supabase.from("orders").select("*").eq(isUuid(id) ? "id" : "order_number", id).maybeSingle(),
      supabase.from("contacts").select("*").order("contact_number"),
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      loadVersionFlags("auftraege").catch(() => null),
      loadCompanySettings().catch(() => null),
    ]);
    setVFlags(vf);
    setCompany(co);
    if (o.error) { setErr(o.error.message); setLoading(false); return; }
    const ord = o.data as Order | null;
    setOrder(ord);
    if (ord) {
      setHead({
        order_number: ord.order_number ?? "", order_date: ord.order_date ?? new Date().toISOString().slice(0, 10),
        title: ord.title ?? "", project_id: ord.project_id ?? "", contact_id: ord.contact_id ?? "",
        person_id: ord.person_id ?? "", payment_term_days: ord.payment_term_days ?? 14,
        internal_note: ord.internal_note ?? "", status: ord.status ?? "beauftragt",
        invoice_status: ord.invoice_status ?? "offen", service_period: ord.service_period ?? "",
      });
      // JSONB-Positionen bevorzugen, sonst aus order_items migrieren – über die AUFGELÖSTE
      // Auftrags-UUID (ord.id), NICHT den Route-Param (kann eine Auftragsnummer sein) →
      // verhindert leeres Laden + Datenverlust bei Alt-Aufträgen mit relationalen Positionen.
      const jsonbItems = Array.isArray((ord as any).items) ? (ord as any).items : [];
      if (jsonbItems.length > 0) builder.reset(normalizePositions(jsonbItems));
      else {
        const { data: oiData } = await supabase.from("order_items").select("*").eq("order_id", ord.id).order("sort_order");
        builder.reset(itemsToPositions((oiData as OrderItem[]) ?? []));
      }
      if (ord.contact_id) {
        const { data: pp } = await supabase.from("contact_persons").select("*").eq("contact_id", ord.contact_id).order("sort_order");
        setPersons((pp as ContactPerson[]) ?? []);
      }
      setWorkingBaseVer((ord as any).working_base_version_no ?? null);
      setRecipientOverride(((ord as any).recipient_override as RecipientOverride) ?? null);
      setVatMode(((ord as any).vat_mode as VatMode) ?? "standard");
      setSignatureSource(normalizeSignatureSource((ord as any).signature_source));
      // Konditionen: Snapshot bevorzugen; fehlt er, beim Entwurf vom Kunden ableiten.
      const condSnap = conditionsFromSnapshot((ord as any).conditions_snapshot);
      if (condSnap) setConditions(condSnap);
      else {
        const cust = ((c.data as Contact[]) ?? []).find((x) => x.id === ord.contact_id) ?? null;
        const isDraft = (ord.status ?? "") === "entwurf";
        setConditions(isDraft && cust ? resolveDocumentConditions(cust, "out")
          : { ...emptyDocumentConditions(), termDays: ord.payment_term_days ?? null });
      }
    }
    setContacts((c.data as Contact[]) ?? []);
    setProjects((p.data as Project[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);

  const setH = (k: keyof typeof head, v: any) => {
    setHead((p) => ({ ...p, [k]: v }));
    builder.setDirty(true);
    if (k === "contact_id" && v) {
      supabase.from("contact_persons").select("*").eq("contact_id", v).order("sort_order")
        .then(({ data }) => setPersons((data as ContactPerson[]) ?? []));
    } else if (k === "contact_id") setPersons([]);
  };

  async function save(nextStatus?: string) {
    if (!order) return;
    setSaving(true); setErr(null);
    const status = nextStatus ?? head.status;
    // Standardaufschlag (intern) guarded einrechnen – inkl. nachträglich eingefügter Positionen.
    let positions = builder.positions;
    const surchargePct = Number(conditions.surchargePercent) || 0;
    if (surchargePct > 0) { positions = applySurchargeToPositions(positions, surchargePct); builder.setPositions(positions); }
    const condSave: DocumentConditions = { ...conditions, surchargeApplied: conditions.surchargeApplied || surchargePct > 0 };
    if (condSave.surchargeApplied !== conditions.surchargeApplied) setConditions(condSave);
    const s = computeSummary(positions, vatOverride, condSave.discountPercent);
    const { error: oErr } = await supabase.from("orders").update({
      // order_number wird bewusst NICHT mitgeschrieben: die Nummer vergibt ausschließlich
      // ensure_document_number beim Beauftragen/Abschließen (kein Zurück-Nullen durch Save).
      order_date: head.order_date,
      title: head.title || null, project_id: head.project_id || null,
      contact_id: head.contact_id || null, person_id: head.person_id || null,
      service_period: head.service_period || null,
      payment_term_days: condSave.termDays ?? (Number(head.payment_term_days) || null),
      discount_percent: 0, internal_note: head.internal_note || null,
      status, invoice_status: head.invoice_status,
      conditions_snapshot: conditionsToSnapshot(condSave),
      working_base_version_no: workingBaseVer,
      recipient_override: recipientOverride,
      vat_mode: vatMode,
      signature_source: signatureSource,
      items: positions, net: s.net, vat: s.vat, gross: s.gross,
      updated_at: new Date().toISOString(),
    }).eq("id", order.id);
    if (oErr) { setErr(oErr.message); setSaving(false); return; }

    // order_items (relational) für die Verrechnungslogik synchron halten
    await supabase.from("order_items").delete().eq("order_id", order.id);
    const commercial = positions.filter((p) => isCommercial(p.type));
    if (commercial.length > 0) {
      const rows = commercial.map((p, i) => {
        const net = lineNet(p);
        const gross = round2(net * (1 + (Number(p.vat_rate) || 0) / 100));
        return {
          order_id: order.id, pos_no: p.number || String(i + 1).padStart(2, "0"),
          service_number: null, short_text: p.name || null, long_text: p.long_text || null,
          qty: p.qty, unit: p.unit, unit_price: p.unit_price,
          discount_percent: p.discount_percent, vat_rate: p.vat_rate,
          net, gross, source_offer_id: null, source_offer_item_id: null,
          invoiced_qty: 0, sort_order: i,
        };
      });
      const { error: iErr } = await supabase.from("order_items").insert(rows);
      if (iErr) { setErr(iErr.message); setSaving(false); return; }
    }
    if (head.project_id) {
      await logProject(head.project_id, "auftrag",
        `Auftrag ${head.order_number || order.id} gespeichert (${ORDER_STATUS_LABEL[status] ?? status})`);
    }
    setSaving(false);
    if (nextStatus) setHead((p) => ({ ...p, status: nextStatus }));
    builder.markSaved();
  }

  // Wiederherstellen einer früheren Version als bearbeitbarer Arbeitsstand (App-Dialog).
  function restoreVersion(v: DocVersion) { setRestoreVer(v); }
  async function doRestore() {
    const v = restoreVer;
    if (!v || !order) return;
    const d = (v.data || {}) as { head?: Record<string, any>; positions?: unknown };
    const h = d.head ?? {};
    setHead((p) => ({
      ...p,
      status: "entwurf",
      title: typeof h.title === "string" ? h.title : p.title,
      service_period: typeof h.service_period === "string" ? h.service_period : p.service_period,
      internal_note: typeof h.internal_note === "string" ? h.internal_note : p.internal_note,
      payment_term_days: h.payment_term_days ?? p.payment_term_days,
    }));
    if (Array.isArray(d.positions)) builder.reset(normalizePositions(d.positions));
    builder.setDirty(true);
    setWorkingBaseVer(v.version_no);
    setVersionsOpen(false);
    setRestoreVer(null);
    await save("entwurf");
    if (err) { toastError("Wiederherstellen fehlgeschlagen – bitte erneut versuchen."); return; }
    if (head.project_id) await logProject(head.project_id, "auftrag", `Version V${v.version_no} als Arbeitsstand wiederhergestellt`);
    toast(`Version V${v.version_no} wurde als Arbeitsstand wiederhergestellt.`);
  }

  // Auto-Korrektur aus dem Canvas (erste Umreihung/Bearbeitung eines abgeschlossenen Auftrags).
  // Revisionssicher: Status→Entwurf + Bezug auf die letzte Version; alte Version/Snapshot bleiben,
  // neue Version erst beim Abschließen.
  async function beginCorrection(): Promise<boolean> {
    if (!order) return false;
    if (!isReadonly) return true;
    try {
      let baseVer: number | null = workingBaseVer;
      try {
        const vs = await loadDocumentVersions("order", order.id);
        const maxV = vs.reduce((m, v) => Math.max(m, v.version_no || 0), 0);
        if (maxV > 0) baseVer = maxV;
      } catch { /* ignore */ }
      setWorkingBaseVer(baseVer);
      setHead((p) => ({ ...p, status: "entwurf" }));
      await save("entwurf");
      if (baseVer != null) await supabase.from("orders").update({ working_base_version_no: baseVer }).eq("id", order.id);
      await logReopen("order", order.id, `Auftrag ${head.order_number || ""} zur Korrektur entsperrt (Umreihung/Bearbeitung)`);
      if (head.project_id) await logProject(head.project_id, "auftrag", `Auftrag ${head.order_number || ""} zur Korrektur entsperrt – neue Version beim Abschließen`);
      return true;
    } catch { return false; }
  }

  // Abschließen = Status setzen + (bei aktiver Versionierung) unveränderliche Version + PDF-Snapshot.
  async function finalizeOrder() {
    if (!order) return;
    // Auftragsnummer JETZT atomar sicherstellen (Entwürfe haben keine); idempotent –
    // Re-Finalize/Korrekturversionen behalten die bestehende Nummer.
    const ensured = await ensureDocumentNumber("order", order.id);
    if (!ensured.number) { setErr(ensured.error ?? "Auftragsnummer konnte nicht vergeben werden."); return; }
    const docNumber = ensured.number;
    if (head.order_number !== docNumber) setHead((p) => ({ ...p, order_number: docNumber }));
    await save("in_arbeit");
    // Dokumentdatum = Abschlussdatum: Auftragsdatum auf heute setzen (persistieren + UI).
    const finalizedDate = finalizeStamp().date;
    await supabase.from("orders").update({ order_date: finalizedDate, working_base_version_no: null }).eq("id", order.id);
    setWorkingBaseVer(null);
    setHead((p) => ({ ...p, order_date: finalizedDate }));
    setOrder((o) => (o ? { ...o, order_date: finalizedDate } : o));
    if (vFlags?.versioning_enabled && snapRef.current) {
      let printHtml: string | null = null;
      if (vFlags.create_pdf_snapshot_on_finalize) {
        // Snapshot mit dem Abschlussdatum rendern – inkl. Platzhalter ({{dokument.datum}} etc.)
        // auf Basis des FINALEN Datums neu auflösen, damit der Snapshot-Text nicht das alte
        // Entwurfsdatum konserviert (Header zeigt sonst Abschlussdatum, Text das Entwurfsdatum).
        const finalCustomer = contacts.find((c) => c.id === head.contact_id) ?? null;
        const finalProject = projects.find((p) => p.id === head.project_id) || null;
        const finalPh = buildDocPlaceholders({
          customer: finalCustomer, project: finalProject,
          docNumber, docDate: finalizedDate,
          docLabel: (order as any).pdf_label || "Auftrag", company, bearbeiter: profile?.name ?? "",
          conditions: { paymentTermDays: conditions.termDays, skontoPercent: conditions.skontoPercent, skontoDays: conditions.skontoDays },
        });
        const finalTexts = resolveDocTexts(
          {
            intro: (order as any).doc_intro_text,
            prePositions: (order as any).pre_positions_text,
            closing: (order as any).doc_closing_text,
          },
          finalPh,
        );
        try { printHtml = await renderDocumentHtml(snapRef.current.positions, snapRef.current.summary, { ...snapRef.current.meta, number: docNumber, date: dateAt(finalizedDate), ...finalTexts }); } catch { /* Druckstand optional */ }
      }
      await finalizeDocumentVersion({
        sourceTable: "order", sourceId: order.id, status: "in_arbeit",
        title: head.title || null, docNumber,
        data: { head: { ...head, order_number: docNumber, order_date: finalizedDate }, positions: snapRef.current.positions }, summary: snapRef.current.summary, printHtml,
        withAudit: vFlags.audit_log_enabled, auditDetail: `Auftrag ${docNumber} abgeschlossen`,
        finalizedByName: profile?.name ?? session?.user.email ?? null,
      });
    }
    // Nach erfolgreichem Abschluss zurück in den Projektbereich „Aufträge" (frische Listen/Version).
    leaveAfterFinalize();
  }

  async function changeStatus(status: string) {
    if (!order) return;
    // Beauftragen = erster verbindlicher Schritt → Auftragsnummer atomar vergeben
    // (idempotent; Storno/Archiv eines Entwurfs verbraucht bewusst KEINE Nummer).
    let docNumber = head.order_number || null;
    if (status === "beauftragt" && !docNumber) {
      const ensured = await ensureDocumentNumber("order", order.id);
      if (!ensured.number) { setErr(ensured.error ?? "Auftragsnummer konnte nicht vergeben werden."); return; }
      docNumber = ensured.number;
      setHead((p) => ({ ...p, order_number: ensured.number! }));
    }
    await supabase.from("orders").update({ status, updated_at: new Date().toISOString() }).eq("id", order.id);
    if (head.project_id) await logProject(head.project_id, "auftrag", `Auftrag ${docNumber || order.id}: Status → ${ORDER_STATUS_LABEL[status] ?? status}`);
    setHead((p) => ({ ...p, status }));
    setOrder((o) => (o ? { ...o, status } : o));
  }

  async function duplicate() {
    if (!order) return;
    // Kopie = neuer Entwurf OHNE Nummer (Vergabe erst beim Beauftragen).
    const { data: newOrder, error } = await supabase.from("orders").insert({
      order_number: null, order_date: new Date().toISOString().slice(0, 10),
      title: `${head.title || "Auftrag"} (Kopie)`, project_id: head.project_id || null,
      contact_id: head.contact_id || null, person_id: head.person_id || null,
      service_period: head.service_period || null, payment_term_days: Number(head.payment_term_days) || null,
      discount_percent: 0, internal_note: head.internal_note || null, status: "entwurf", invoice_status: "offen",
      net: builder.summary.net, vat: builder.summary.vat, gross: builder.summary.gross,
      offer_ids: order.offer_ids ?? [], snapshot: order.snapshot, items: builder.positions,
      conditions_snapshot: conditionsToSnapshot(conditions),
    }).select("id").single();
    if (error || !newOrder) { setErr(error?.message ?? "Fehler beim Kopieren"); return; }
    nav(docPath("order", newOrder.id, null));
  }

  if (loading) return <div className="pt-4"><Spinner /></div>;
  if (!order || (order as any).deleted_at) return (
    <div className="pt-4">
      <button onClick={() => nav(-1)} className="btn-ghost mb-4 px-2"><ArrowLeft size={18} /> Zurück</button>
      <div className="glass p-4 text-center text-slate-400">{DELETE_GONE_TEXT}</div>
    </div>
  );

  const cName = (c: Contact) =>
    c.customer_type === "firma" ? (c.company || "Firma")
      : [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "–";
  const isReadonly = isOrderReadonly(head);
  const customer = contacts.find((c) => c.id === head.contact_id);
  const orderProject = projects.find((p) => p.id === head.project_id) || null;
  // Kunde des PROJEKTS (für den Projektkontext im Kopf – wie in der Projektakte).
  const projectCustomer = contacts.find((c) => c.id === orderProject?.contact_id);
  const projectCustomerName = projectCustomer ? cName(projectCustomer) : (customer ? cName(customer) : "");

  // Vollständige PDF-Meta (für Anzeige UND Versions-Snapshot beim Abschließen).
  const orderDocLabel = (order as any).pdf_label || "Auftrag";
  // Platzhalter in den Snapshot-Texten auflösen (Kunde/Projekt/Dokument), damit im PDF keine
  // rohen {{…}} stehen. Idempotent: bereits aufgelöste Texte (ohne {{…}}) bleiben unverändert.
  const orderPh = buildDocPlaceholders({
    customer: customer ?? null, project: orderProject,
    docNumber: head.order_number, docDate: head.order_date,
    docLabel: orderDocLabel, company, bearbeiter: profile?.name ?? "",
    conditions: { paymentTermDays: conditions.termDays, skontoPercent: conditions.skontoPercent, skontoDays: conditions.skontoDays },
  });
  const orderTexts = resolveDocTexts(
    {
      intro: (order as any).doc_intro_text,
      prePositions: (order as any).pre_positions_text,
      closing: (order as any).doc_closing_text,
    },
    orderPh,
  );
  const orderMeta = {
    docLabel: orderDocLabel, vatLabel: vatMode === "par19" ? "MwSt §19 (0 %)" : "MwSt", numberLabel: "Auftrag",
    number: head.order_number, title: head.title,
    customer: customer ? cName(customer) : "", date: dateAt(head.order_date),
    notes: head.internal_note,
    projectNumber: orderProject?.project_number ?? null,
    display: ((order as any).display_settings_snapshot as OfferDisplay) || undefined,
    // Zentrale Regel: Auftrag zeigt KEINE automatische Zahlungsbox nach der Summe –
    // Zahlungsbedingungen kommen dort nur über Textbausteine/Platzhalter in den Text.
    payment: showPaymentForDoc("auftrag") ? conditionsToPaymentMeta(conditions) : undefined,
    introHtml: orderTexts.introHtml,
    prePositionsHtml: orderTexts.prePositionsHtml,
    closingHtml: withParagraph19Note(orderTexts.closingHtml, vatMode === "par19"),
    recipientLines: resolveRecipientLines(recipientOverride, customer),
    createdBy: (order as any).created_by ?? null,
    signatureSource,
  };
  snapRef.current = { positions: builder.positions, summary: builder.summary, meta: orderMeta };

  // „Aus Angebot übernehmen" + „Archivieren" bewusst entfernt (Stand 2026-07-06):
  // Positionsübernahme läuft über die Toolbar-Aktion „Positionen einfügen" (Modus
  // „Aus Dokument übernehmen", zentrale Kopierlogik, gleiche/andere Projekte);
  // Projekt-Archivierung nur noch in der Projektübersicht – nicht missverständlich
  // aus dem Dokumenteditor.
  const moreActions = buildDocumentMoreActions({
    kind: "order",
    isDraft: isDraftOrder(head),
    canConvert: canConvertOrder(head as any).ok,
    canCancel: canCancelOrder(head),
    canDelete: isDeletable("order", order) && can("orders", "delete"),
    onBeauftragen: () => changeStatus("beauftragt"),
    onCopy: duplicate,
    onCreateInvoice: () => { const c = canConvertOrder(head as any); if (!c.ok) { window.alert(c.reason); return; } nav(`/rechnungen/new?orderId=${order.id}`); },
    onStorno: () => setConfirmStorno(true),
    onDelete: () => setDelOpen(true),
  });

  // Kontextsensitiv zurück: zum Projekt, wenn der Auftrag zu einem Projekt gehört.
  const goBack = () => (head.project_id ? nav(`/projekte/${head.project_id}`) : nav(-1));

  // Nach erfolgreichem Abschluss zurück in den passenden Projektbereich (Aufträge).
  const leaveAfterFinalize = () => {
    if (head.project_id) rememberProjectSection(head.project_id, "auftraege");
    goBack();
  };

  async function deleteDraft() {
    if (!order) return;
    const { error } = await softDeleteDocument("order", order.id, session?.user.id ?? null);
    if (error) { setErr(error); return; }
    goBack();
  }

  return (
    <div className="pt-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* Zurück nur bei freistehenden Dokumenten (ohne Projekt) – sonst übernimmt „Zum Projekt" in der Toolbar. */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {!head.project_id && <button onClick={goBack} className="btn-ghost px-2"><ArrowLeft size={18} /> Zurück</button>}
          {/* Ausführlicher Projektkontext – zentral, identisch zur Projektakte. */}
          <ProjectContextChips project={orderProject} customerName={projectCustomerName} />
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(head.status)}>{ORDER_STATUS_LABEL[head.status] ?? head.status}</Badge>
          <Badge tone="slate">{ORDER_INVOICE_STATUS_LABEL[head.invoice_status] ?? head.invoice_status}</Badge>
          {workingBaseVer != null && (
            <span className="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              title="Bearbeitbarer Arbeitsstand auf Basis einer früheren Version – beim Abschließen entsteht eine neue Version.">
              Arbeitsstand aus V{workingBaseVer}
            </span>
          )}
        </div>
      </div>
      <ErrorBanner message={err} />

      {isReadonly && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          Dieser Auftrag ist {ORDER_STATUS_LABEL[head.status]}: Positionen sind gesperrt. Die Einstellungen lassen sich weiterhin öffnen, anpassen und speichern – ohne neue Version.
        </div>
      )}

      <DocumentWorkspace
        builder={builder}
        docType="auftrag"
        docLabel={(order as any).pdf_label || "Auftrag"}
        numberLabel="Auftrag"
        projectId={head.project_id || null}
        sourceTable="order"
        sourceId={order.id}
        vatOverride={vatOverride}
        vatLabel={vatMode === "par19" ? "MwSt §19 (0 %)" : "MwSt"}
        printMeta={orderMeta}
        onSave={() => save()}
        saving={saving}
        onFinalize={finalizeOrder}
        onSettings={() => setSettingsOpen(true)}
        onHistory={() => setVersionsOpen(true)}
        moreActions={moreActions}
        readOnly={isReadonly}
        correctable={isReadonly && !isDraftOrder(head)}
        onBeginCorrection={beginCorrection}
        correctionPending={isDraftOrder(head) && workingBaseVer != null}
        aiActions={aiDocActionLabels("auftrag", (order as any)?.pdf_label).map((label) => ({
          label, onClick: () => toastInfo("Die KI-Erzeugung wird in Kürze verfügbar sein."),
        }))}
      />

      {/* Auftragseinstellungen (ausgelagerter Stammdaten-Block – gleiche Optik wie Angebot) */}
      {settingsOpen && (
        <Modal open onClose={() => setSettingsOpen(false)} title="Auftragseinstellungen" size="xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label">Auftragstitel (Betreff)</label>
              <input className="input" value={head.title} placeholder="z.B. Arbeiten im Büro" onChange={(e) => setH("title", e.target.value)} /></div>
            <div><label className="label">Auftragsnummer</label>
              <input className="input cursor-not-allowed opacity-70" value={head.order_number || ""} readOnly title="Wird automatisch über den Nummernkreis vergeben." /></div>
            <div><label className="label">Auftragsdatum</label>
              <input type="date" className="input" value={head.order_date} onChange={(e) => setH("order_date", e.target.value)} /></div>
            <div><label className="label">Status</label>
              <select className="input" value={head.status} disabled={isReadonly} onChange={(e) => setH("status", e.target.value)}>
                {ORDER_STATUS.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
              </select></div>
            <div><label className="label">Rechnungsstatus</label>
              <select className="input" value={head.invoice_status} onChange={(e) => setH("invoice_status", e.target.value)}>
                {Object.entries(ORDER_INVOICE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="label">Kunde</label>
              <select className="input" value={head.contact_id} onChange={(e) => setH("contact_id", e.target.value)}>
                <option value="">– kein Kunde –</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.contact_number ? `${c.contact_number} · ` : ""}{cName(c)}</option>)}
              </select></div>
            <div><label className="label">Projekt</label>
              <select className="input" value={head.project_id} onChange={(e) => setH("project_id", e.target.value)}>
                <option value="">– kein Projekt –</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.project_number ? `${p.project_number} · ` : ""}{p.title}</option>)}
              </select></div>
            {persons.length > 0 && (
              <div><label className="label">Ansprechpartner</label>
                <select className="input" value={head.person_id} onChange={(e) => setH("person_id", e.target.value)}>
                  <option value="">– keine Auswahl –</option>
                  {persons.map((pp) => <option key={pp.id} value={pp.id}>{[pp.first_name, pp.last_name].filter(Boolean).join(" ")}</option>)}
                </select></div>
            )}
            <div className="sm:col-span-2"><label className="label">Leistungszeitraum</label>
              <input className="input" value={head.service_period} placeholder="z.B. Juli – September 2026" onChange={(e) => setH("service_period", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">MwSt-Modus</label>
              <select className="input" value={vatMode} onChange={(e) => { setVatMode(e.target.value as VatMode); builder.setDirty(true); }}>
                <option value="standard">Regulär 20 %</option>
                <option value="par19">§19 Bauleistung (Reverse Charge, 0 %)</option>
              </select></div>
            <SignatureSourcePicker value={signatureSource} createdBy={(order as any).created_by ?? null}
              onChange={(v) => { setSignatureSource(v); builder.setDirty(true); }} />
            <div className="sm:col-span-2"><label className="label">Interne Notiz</label>
              <textarea className="input min-h-[60px]" value={head.internal_note} onChange={(e) => setH("internal_note", e.target.value)} /></div>
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
          <div className="mt-4 flex justify-end"><button className="btn-primary" onClick={() => setSettingsOpen(false)}>Fertig</button></div>
        </Modal>
      )}

      <ConfirmDialog open={!!restoreVer} title="Version wiederherstellen?" confirmLabel="Version wiederherstellen" tone="info"
        message={<>Version V{restoreVer?.version_no} als aktuellen Arbeitsstand übernehmen? Beim erneuten Abschließen entsteht eine neue Version. Die alte Version bleibt unverändert erhalten.</>}
        onConfirm={doRestore} onClose={() => setRestoreVer(null)} />

      <ConfirmDialog
        open={confirmStorno}
        title="Auftrag stornieren?"
        confirmLabel="Stornieren"
        message={<>Soll Auftrag <b>{head.order_number || order.id}</b> storniert werden? Diese Aktion kann nicht rückgängig gemacht werden.</>}
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

      {versionsOpen && (
        <VersionHistoryModal
          sourceTable="order"
          sourceId={order.id}
          baseLabel="Auftrag"
          currentNumber={head.order_number}
          canRestore={!isReadonly && can("orders", "update")}
          onRestore={restoreVersion}
          onClose={() => setVersionsOpen(false)}
        />
      )}
    </div>
  );
}

// Der frühere lokale OfferImportPicker („Positionen aus Angebot übernehmen") wurde
// entfernt – die Übernahme läuft zentral über die Toolbar-Aktion „Positionen einfügen"
// (MultiInsertModal, Modus „Aus Dokument übernehmen" → document-copy.ts).
