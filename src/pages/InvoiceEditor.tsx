import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { isUuid } from "../lib/documents-overview";
import { ArrowLeft, Lock } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Badge, Modal } from "../components/ui";
import { ErrorBanner, ConfirmDialog } from "../components/calc-ui";
import {
  Invoice, INVOICE_STATUS_LABEL, INVOICE_STATUS_COLOR,
  INVOICE_KIND_LABEL, INVOICE_DOC_STATUS_LABEL, invoiceDocStatusTone,
  deriveInvoiceStatus, updateOrderInvoiceStatus, refreshOrdersInvoiceStatus,
} from "../lib/invoice-types";
import { Contact, ContactPerson, Project } from "../lib/types";
import { contactDisplayName, resolveRecipientLines, RecipientOverride } from "../lib/contact-name";
import RecipientOverrideEditor from "../components/document/RecipientOverrideEditor";
import SignatureSourcePicker from "../components/document/SignatureSourcePicker";
import { SignatureSource, normalizeSignatureSource } from "../lib/document-signature";
import { eur, dateAt } from "../lib/format";
import { logProject } from "../lib/projectlog";
import { buildDocPlaceholders, resolveDocTexts } from "../lib/document-placeholders";
import { loadCompanySettings, CompanySettings } from "../lib/company";
import { OfferDisplay } from "../lib/offer-display";
import { isReverseCharge, withParagraph19Note, VatMode } from "../lib/offer-types";
import { loadTransitionFor, deriveFollowDoc } from "../lib/document-transitions";
import { useDocumentBuilder } from "../hooks/useDocumentBuilder";
import { useModalParam } from "../hooks/useModalParam";
import { rememberProjectSection } from "../lib/project-nav";
import { DocPosition, emptyPosition, isCommercial } from "../lib/document-types";
import {
  DocumentConditions, emptyDocumentConditions,
  conditionsFromSnapshot, conditionsToSnapshot,
} from "../lib/payment-conditions";
import DocumentWorkspace from "../components/document/DocumentWorkspace";
import ProjectContextChips from "../components/project/ProjectContextChips";
import { buildDocumentMoreActions } from "../lib/document-actions";
import { aiDocActionLabels } from "../lib/ai-doc-actions";
import { toastInfo } from "../lib/toast";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/permissions";
import { isDeletable, softDeleteDocument, DELETE_CONFIRM_TEXT, DELETE_GONE_TEXT } from "../lib/document-delete";
import { finalizeDocumentVersion, finalizeStamp, loadVersionFlags, VersionFlags } from "../lib/document-versions";
import VersionHistoryModal from "../components/document/VersionHistoryModal";
import { renderDocumentHtml } from "../components/document/printDocument";

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Eine flache Rechnungsposition (JSONB-Form in invoices.items). */
type InvoiceLine = {
  group: string;
  pos_no: string;
  short_text: string;
  long_text: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  source_order_id?: string | null;
  source_order_item_id?: string | null;
};

function calcLine(it: { qty: number; unit_price: number; discount_percent: number; vat_rate: number }) {
  const net = round2(it.qty * it.unit_price * (1 - it.discount_percent / 100));
  const gross = round2(net * (1 + it.vat_rate / 100));
  return { net, gross };
}

/** Auftrags-JSONB-Positionen (mit Titeln) → flache Rechnungspositionen mit Gewerk-Gruppe. */
function orderJsonToLines(jsonb: any[]): InvoiceLine[] {
  let group = "";
  let n = 0;
  const out: InvoiceLine[] = [];
  for (const p of jsonb) {
    if (p?.type === "title") { group = p.name || ""; continue; }
    if (p?.type !== "article" && p?.type !== "service" && p?.type !== "free") continue;
    n += 1;
    out.push({
      group,
      pos_no: p.number || String(n).padStart(2, "0"),
      short_text: p.name || "",
      long_text: p.long_text || "",
      qty: Number(p.qty) || 0,
      unit: p.unit || "Stk",
      unit_price: Number(p.unit_price) || 0,
      discount_percent: Number(p.discount_percent) || 0,
      vat_rate: Number(p.vat_rate) || 20,
    });
  }
  return out;
}

function linesToJson(items: InvoiceLine[]): any[] {
  return items.map((it) => {
    const { net, gross } = calcLine(it);
    return {
      group: it.group || "",
      pos_no: it.pos_no,
      short_text: it.short_text,
      long_text: it.long_text,
      qty: it.qty,
      unit: it.unit,
      unit_price: it.unit_price,
      discount_percent: it.discount_percent,
      vat_rate: it.vat_rate,
      net,
      gross,
      source_order_id: it.source_order_id ?? null,
      source_order_item_id: it.source_order_item_id ?? null,
    };
  });
}

/* ── Modell-Brücke: Rechnungs-JSONB ↔ gemeinsames DocPosition-Modell ──
   Gewerk-Gruppen werden als Titelzeilen abgebildet (wie bei Angebot/Auftrag).
   Quellverweise (Auftrag→Rechnung) werden als Zusatzfelder an der Position
   mitgeführt – renumber()/patch() spreaden die Position, daher bleiben sie
   über Bearbeiten/Sortieren erhalten. */
function invoiceJsonToPositions(raw: any[]): DocPosition[] {
  const out: DocPosition[] = [];
  let curGroup = "";
  for (const it of raw) {
    const g = (it.group || "").trim();
    if (g && g !== curGroup) {
      curGroup = g;
      out.push(emptyPosition("title", { name: g }));
    }
    const pos = emptyPosition("free", {
      name: it.short_text || "",
      long_text: it.long_text || null,
      qty: Number(it.qty) || 0,
      unit: it.unit || "Stk",
      unit_price: Number(it.unit_price) || 0,
      discount_percent: Number(it.discount_percent) || 0,
      vat_rate: Number(it.vat_rate) || 20,
    });
    (pos as any).source_order_id = it.source_order_id ?? null;
    (pos as any).source_order_item_id = it.source_order_item_id ?? null;
    out.push(pos);
  }
  return out;
}

/** DocPosition[] → flache Rechnungspositionen (Gruppe aus vorausgehender Titelzeile). */
function positionsToLines(positions: DocPosition[]): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  let curGroup = "";
  let n = 0;
  for (const p of positions) {
    if (p.type === "title") { curGroup = p.name || ""; continue; }
    if (!isCommercial(p.type)) continue; // reine Textzeilen sind in Rechnungen nicht vorgesehen
    n += 1;
    out.push({
      group: curGroup || "",
      pos_no: p.number || String(n).padStart(2, "0"),
      short_text: p.name || "",
      long_text: p.long_text || "",
      qty: Number(p.qty) || 0,
      unit: p.unit || "Stk",
      unit_price: Number(p.unit_price) || 0,
      discount_percent: Number(p.discount_percent) || 0,
      vat_rate: Number(p.vat_rate) || 0,
      source_order_id: (p as any).source_order_id ?? null,
      source_order_item_id: (p as any).source_order_item_id ?? null,
    });
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────
   Main component
────────────────────────────────────────────────────────────── */
export default function InvoiceEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();

  const isNew = id === "new";
  const paramOrderId = searchParams.get("orderId");
  const paramProjectId = searchParams.get("projectId");

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmStorno, setConfirmStorno] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Versionshistorie URL-gekoppelt (?versions=1) → Escape aus dem PDF kehrt exakt hierher zurück.
  const [versionsOpen, setVersionsOpen] = useModalParam("versions");
  const [vFlags, setVFlags] = useState<VersionFlags | null>(null);
  const { session, profile } = useAuth();
  useEffect(() => { loadVersionFlags("rechnungen").then(setVFlags).catch(() => {}); }, []);
  const can = useCan();

  const [head, setHead] = useState({
    title: "",
    invoice_date: new Date().toISOString().slice(0, 10),
    service_period: "",
    payment_term_days: 30 as number | string,
    notes: "",
    project_id: paramProjectId || "",
    contact_id: "",
    person_id: "",
    order_ids: paramOrderId ? [paramOrderId] : [] as string[],
    invoice_kind: "normal" as string,
    with_skonto: false,
    skonto_percent: 3 as number | string,
  });
  const [conditions, setConditions] = useState<DocumentConditions>(emptyDocumentConditions());
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [recipientOverride, setRecipientOverride] = useState<RecipientOverride | null>(null);
  const [vatMode, setVatMode] = useState<VatMode>("standard");
  const [signatureSource, setSignatureSource] = useState<SignatureSource>("company");
  const vatOverride = vatMode === "par19" ? 0 : null;
  const builder = useDocumentBuilder([], vatOverride, conditions.discountPercent);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [persons, setPersons] = useState<ContactPerson[]>([]);
  const [priorInvoices, setPriorInvoices] = useState<any[]>([]);

  /* ── Create new invoice in DB, then redirect ── */
  async function initNew() {
    setLoading(true);
    setErr(null);

    let orderData: any = null;
    let orderItemRows: any[] = [];

    if (paramOrderId) {
      const [{ data: o }, { data: oi }] = await Promise.all([
        supabase.from("orders").select("*").eq("id", paramOrderId).maybeSingle(),
        supabase.from("order_items").select("*").eq("order_id", paramOrderId).order("sort_order"),
      ]);
      orderData = o;
      orderItemRows = oi ?? [];
    }

    // Bevorzugt die JSONB-Positionen des Auftrags (enthalten Gewerk-Titel),
    // sonst Fallback auf die relationale order_items-Tabelle (ohne Gruppen).
    const orderJsonb = Array.isArray(orderData?.items) ? orderData.items : [];
    const initItems: InvoiceLine[] = orderJsonb.length
      ? orderJsonToLines(orderJsonb)
      : orderItemRows.map((oi, i) => ({
          group: "",
          pos_no: oi.pos_no || String(i + 1).padStart(2, "0"),
          short_text: oi.short_text || "",
          long_text: oi.long_text || "",
          qty: Number(oi.qty),
          unit: oi.unit || "Stk",
          unit_price: Number(oi.unit_price),
          discount_percent: Number(oi.discount_percent),
          vat_rate: Number(oi.vat_rate),
        }));

    let totalNet = 0, totalVat = 0;
    for (const it of initItems) {
      const { net, gross } = calcLine(it);
      totalNet += net;
      totalVat += (gross - net);
    }
    totalNet = round2(totalNet);
    totalVat = round2(totalVat);

    // Typ-Durchzug: Angebotstyp + Darstellung + Texte aus dem Auftrag ableiten
    const transition = await loadTransitionFor(orderData?.offer_type_id ?? null);
    let invType: { slug?: string | null; name?: string | null } | null = null;
    if (orderData?.offer_type_id) {
      const { data: ot } = await supabase.from("offer_types").select("slug,name").eq("id", orderData.offer_type_id).maybeSingle();
      invType = ot ? { slug: (ot as any).slug, name: (ot as any).name } : null;
    }
    const follow = deriveFollowDoc("invoice", {
      offer_type_id: orderData?.offer_type_id ?? null,
      display_settings_snapshot: orderData?.display_settings_snapshot ?? null,
      pre_positions_text: orderData?.pre_positions_text ?? null,
    }, transition, invType);

    const { data: newInv, error } = await supabase.from("invoices").insert({
      title: orderData?.title || null,
      invoice_date: new Date().toISOString().slice(0, 10),
      service_period: orderData?.service_period || null,
      payment_term_days: orderData?.payment_term_days || 30,
      project_id: orderData?.project_id || paramProjectId || null,
      contact_id: orderData?.contact_id || null,
      order_ids: paramOrderId ? [paramOrderId] : [],
      conditions_snapshot: (orderData as any)?.conditions_snapshot ?? null,
      items: linesToJson(initItems),
      net: totalNet,
      vat: totalVat,
      gross: round2(totalNet + totalVat),
      doc_status: "entwurf",
      locked: false,
      offer_type_id: follow.offer_type_id,
      pdf_label: follow.pdf_label,
      doc_intro_text: follow.doc_intro_text,
      doc_closing_text: follow.doc_closing_text,
      pre_positions_text: follow.pre_positions_text,
      display_settings_snapshot: follow.display_settings_snapshot,
      snapshot: paramOrderId ? { created_from_order: paramOrderId } : null,
    }).select("id").single();

    if (error || !newInv) {
      setErr(error?.message || "Fehler beim Erstellen der Rechnung");
      setLoading(false);
      return;
    }

    nav(`/rechnungen/${newInv.id}`, { replace: true });
  }

  /* ── Load existing invoice ── */
  async function load() {
    if (!id || isNew) return;
    setLoading(true);
    const [{ data: inv }, { data: cont }, { data: proj }, co] = await Promise.all([
      supabase.from("invoices").select("*").eq(isUuid(id) ? "id" : "number", id).maybeSingle(),
      supabase.from("contacts").select("*").order("contact_number"),
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      loadCompanySettings().catch(() => null),
    ]);
    if (!inv) { setLoading(false); return; }

    const invData = inv as Invoice;
    setInvoice(invData);
    setContacts((cont as Contact[]) ?? []);
    setProjects((proj as Project[]) ?? []);
    setCompany(co);
    setRecipientOverride(((invData as any).recipient_override as RecipientOverride) ?? null);
    setVatMode(((invData as any).vat_mode as VatMode) ?? "standard");
    setSignatureSource(normalizeSignatureSource((invData as any).signature_source));

    setHead({
      title: invData.title || "",
      invoice_date: invData.invoice_date,
      service_period: invData.service_period || "",
      payment_term_days: invData.payment_term_days || 30,
      notes: invData.notes || "",
      project_id: invData.project_id || "",
      contact_id: invData.contact_id || "",
      person_id: (invData as any).person_id || "",
      order_ids: invData.order_ids || [],
      invoice_kind: (invData as any).invoice_kind || "normal",
      with_skonto: Boolean((invData as any).with_skonto),
      skonto_percent: Number((invData as any).skonto_percent) || 3,
    });

    // Konditionen-Snapshot bevorzugen; sonst aus den vorhandenen Rechnungsfeldern ableiten.
    const condSnap = conditionsFromSnapshot((invData as any).conditions_snapshot);
    setConditions(condSnap ?? {
      ...emptyDocumentConditions(),
      termDays: invData.payment_term_days ?? null,
      skontoPercent: Number((invData as any).skonto_percent) || null,
      discountPercent: Number((invData as any).discount_percent) || null,
    });

    if (invData.contact_id) {
      const { data: pp } = await supabase.from("contact_persons").select("*")
        .eq("contact_id", invData.contact_id).order("sort_order");
      setPersons((pp as ContactPerson[]) ?? []);
    }

    const rawItems: any[] = Array.isArray(invData.items) ? invData.items : [];
    builder.reset(invoiceJsonToPositions(rawItems));

    // Bereits gestellte (finalisierte, nicht stornierte) Rechnungen desselben Auftrags/Projekts
    const oids = invData.order_ids || [];
    if (oids.length || invData.project_id) {
      let pq = supabase.from("invoices")
        .select("id,number,invoice_date,net,vat,gross,invoice_kind")
        .neq("id", invData.id).neq("doc_status", "storniert").not("number", "is", null);
      pq = oids.length ? pq.overlaps("order_ids", oids) : pq.eq("project_id", invData.project_id);
      const { data: pri } = await pq.order("invoice_date");
      setPriorInvoices((pri as any[]) ?? []);
    } else {
      setPriorInvoices([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (isNew) { initNew(); } else { load(); }
    // initNew/isNew/load bewusst nicht in den Deps: Neuladen nur bei Routenwechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ── Head helper ── */
  const setH = (k: keyof typeof head, v: any) => {
    setHead((p) => ({ ...p, [k]: v }));
    builder.setDirty(true);
    if (k === "contact_id" && v) {
      supabase.from("contact_persons").select("*")
        .eq("contact_id", v).order("sort_order")
        .then(({ data }) => setPersons((data as ContactPerson[]) ?? []));
    } else if (k === "contact_id") {
      setPersons([]);
    }
  };

  /* ── Totals (aus dem gemeinsamen Builder) ── */
  const totals = builder.summary;

  /* ── Teilrechnungs-Verrechnung (automatisch, zur Kontrolle) ── */
  const verrechnung = useMemo(() => {
    const prior = priorInvoices;
    const priorGross = round2(prior.reduce((s, p) => s + Number(p.gross || 0), 0));
    const open = round2(totals.gross - priorGross);
    return { has: prior.length > 0, prior, priorGross, open };
  }, [priorInvoices, totals.gross]);

  /* ── Save ── */
  // Konditionen-Snapshot aus den §11-Feldern (term/skonto) + getragenem Nachlass/Aufschlag/Skontoziel.
  const buildCondSave = (): DocumentConditions => ({
    ...conditions,
    termDays: Number(head.payment_term_days) || conditions.termDays,
    skontoPercent: Number(head.skonto_percent) || conditions.skontoPercent,
  });

  async function doSave(): Promise<boolean> {
    // Auch finalisierte (gesperrte) Rechnungen dürfen über die Einstellungen gespeichert
    // werden – es wird ausschließlich der LIVE-Datensatz (invoices) aktualisiert. Der
    // unveränderliche Versions-/PDF-Snapshot (document_versions) wird hier NICHT angefasst;
    // er entsteht nur in finalize(). Die Positionen/Canvas bleiben gesperrt (readOnly), daher
    // werden über items nur die unveränderten Positionen zurückgeschrieben.
    if (!invoice) return false;
    setSaving(true); setErr(null);
    const { error } = await supabase.from("invoices").update({
      title: head.title || null,
      invoice_date: head.invoice_date,
      service_period: head.service_period || null,
      payment_term_days: Number(head.payment_term_days) || 30,
      notes: head.notes || null,
      project_id: head.project_id || null,
      contact_id: head.contact_id || null,
      person_id: head.person_id || null,
      order_ids: head.order_ids,
      invoice_kind: head.invoice_kind,
      with_skonto: head.with_skonto,
      skonto_percent: Number(head.skonto_percent) || 0,
      conditions_snapshot: conditionsToSnapshot(buildCondSave()),
      recipient_override: recipientOverride,
      vat_mode: vatMode,
      signature_source: signatureSource,
      items: linesToJson(positionsToLines(builder.positions)),
      net: totals.net,
      vat: totals.vat,
      gross: totals.gross,
      updated_at: new Date().toISOString(),
    }).eq("id", invoice.id);
    if (error) { setErr(error.message); setSaving(false); return false; }
    if (head.project_id) {
      await logProject(head.project_id, "rechnung", `Rechnung (Entwurf) gespeichert`);
    }
    setSaving(false);
    builder.markSaved();
    load();
    return true;
  }

  /* ── Finalisieren ── */
  async function finalize() {
    if (!invoice) return;
    if (!head.invoice_date) { setErr("Rechnungsdatum ist erforderlich!"); return; }
    const lines = positionsToLines(builder.positions);
    if (lines.length === 0) { setErr("Mindestens eine Position ist erforderlich!"); return; }

    setSaving(true); setErr(null);

    // Dokumentdatum = Abschlussdatum: Rechnungsdatum beim Finalisieren auf heute setzen
    // (Fälligkeit zählt ab diesem Datum). Re-/Storno-Anlagen erzeugen eigene Belege.
    const finalizedDate = finalizeStamp().date;
    const ptDays = Number(head.payment_term_days) || 30;
    const dueDate = new Date(finalizedDate);
    dueDate.setDate(dueDate.getDate() + ptDays);

    // Get document number (atomic RPC)
    const { data: docNum, error: rpcErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "rechnung",
    });
    if (rpcErr) { setErr(rpcErr.message); setSaving(false); return; }

    const isGutschrift = head.invoice_kind === "gutschrift" || head.invoice_kind === "storno";
    const { error } = await supabase.from("invoices").update({
      title: head.title || null,
      invoice_date: finalizedDate,
      service_period: head.service_period || null,
      payment_term_days: ptDays,
      notes: head.notes || null,
      project_id: head.project_id || null,
      contact_id: head.contact_id || null,
      person_id: head.person_id || null,
      order_ids: head.order_ids,
      invoice_kind: head.invoice_kind,
      with_skonto: head.with_skonto,
      skonto_percent: Number(head.skonto_percent) || 0,
      conditions_snapshot: conditionsToSnapshot({ ...buildCondSave(), termDays: ptDays }),
      vat_mode: vatMode,
      signature_source: signatureSource,
      items: linesToJson(lines),
      net: totals.net,
      vat: totals.vat,
      gross: totals.gross,
      number: docNum as string,
      locked: true,
      doc_status: "finalisiert",
      due_date: isGutschrift ? null : dueDate.toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }).eq("id", invoice.id);

    if (error) { setErr(error.message); setSaving(false); return; }

    // Update each linked order's invoice status
    for (const oid of head.order_ids) {
      await updateOrderInvoiceStatus(oid, supabase);
    }

    if (head.project_id) {
      await logProject(head.project_id, "rechnung", `Rechnung ${docNum} finalisiert`);
    }

    // Unveränderliche Version + PDF-Snapshot (Rechnung bleibt §11-gesperrt; Korrektur via Storno).
    if (vFlags?.versioning_enabled) {
      let printHtml: string | null = null;
      // Snapshot mit dem Abschlussdatum (Rechnungsdatum = heute) rendern. Platzhalter im Text
      // mit der FINALEN Nummer + Datum neu auflösen, damit {{dokument.nummer}}/{{dokument.datum}}
      // im Snapshot nicht leer (Entwurf hatte noch keine Nummer) bzw. veraltet stehen.
      const finalPh = buildDocPlaceholders({
        customer: c ?? null, project,
        docNumber: docNum as string, docDate: finalizedDate,
        docLabel, company, bearbeiter: profile?.name ?? "",
        conditions: { paymentTermDays: Number(head.payment_term_days) || null, skontoPercent: Number(head.skonto_percent) || conditions.skontoPercent, skontoDays: conditions.skontoDays },
      });
      const finalTexts = resolveDocTexts({ intro: invIntro, prePositions: invPrePos, closing: invClosing }, finalPh);
      // §19-Hinweis auch im finalen Snapshot fest einbetten (alle Varianten, idempotent).
      finalTexts.closingHtml = withParagraph19Note(finalTexts.closingHtml, isReverseCharge(totals.net, totals.vat));
      const snapMeta = { ...printMeta, number: docNum as string, docLabel, vatLabel: vatMode === "par19" ? "MwSt §19 (0 %)" : "MwSt", numberLabel: "Rechnung", date: dateAt(finalizedDate), ...finalTexts };
      if (vFlags.create_pdf_snapshot_on_finalize) {
        try { printHtml = await renderDocumentHtml(builder.positions, totals, snapMeta); } catch { /* Druckstand optional */ }
      }
      await finalizeDocumentVersion({
        sourceTable: "invoice", sourceId: invoice.id, status: "finalisiert",
        title: head.title || null, docNumber: docNum as string,
        data: { head: { ...head, invoice_date: finalizedDate }, positions: builder.positions }, summary: totals, printHtml,
        withAudit: vFlags.audit_log_enabled, auditDetail: `Rechnung ${docNum} finalisiert`,
        finalizedByName: profile?.name ?? session?.user.email ?? null,
      });
    }

    setSaving(false);
    builder.markSaved();
    // Nach erfolgreichem Finalisieren zurück in den Projektbereich „Rechnungen"
    // (frische Liste/Beträge/Version). Ohne Projekt: normale Historie.
    if (head.project_id) rememberProjectSection(head.project_id, "rechnungen");
    goBack();
  }

  /* ── Storno ── */
  async function createStorno() {
    if (!invoice || !invoice.locked) return;
    setSaving(true); setErr(null);

    const stornoItems = (Array.isArray(invoice.items) ? invoice.items : []).map((it: any) => ({
      ...it,
      qty: -Math.abs(Number(it.qty || 1)),
      net: -Math.abs(Number(it.net || 0)),
      gross: -Math.abs(Number(it.gross || 0)),
    }));

    const { data: stornoInv, error } = await supabase.from("invoices").insert({
      project_id: invoice.project_id,
      contact_id: invoice.contact_id,
      person_id: invoice.person_id,
      title: `Storno zu ${invoice.number || invoice.id.slice(0, 8)}`,
      invoice_date: new Date().toISOString().slice(0, 10),
      service_period: invoice.service_period,
      payment_term_days: invoice.payment_term_days || 30,
      order_ids: invoice.order_ids,
      offer_ids: invoice.offer_ids,
      items: stornoItems,
      net: -Math.abs(Number(invoice.net)),
      vat: -Math.abs(Number(invoice.vat)),
      gross: -Math.abs(Number(invoice.gross)),
      doc_status: "entwurf",
      storno_of: invoice.id,
      locked: false,
      snapshot: { storno_of: invoice.id, original_number: invoice.number },
    }).select("id").single();

    if (error || !stornoInv) {
      setErr(error?.message || "Fehler beim Erstellen der Stornorechnung");
      setSaving(false);
      return;
    }

    // Mark original as storniert
    await supabase.from("invoices").update({
      doc_status: "storniert",
      updated_at: new Date().toISOString(),
    }).eq("id", invoice.id);

    // Quell-Aufträge nach Storno wieder freigeben (Verrechnungsstatus neu berechnen,
    // stornierte Rechnungen zählen nicht mehr → ggf. zurück auf offen/teilweise).
    if (Array.isArray(invoice.order_ids) && invoice.order_ids.length > 0) {
      await refreshOrdersInvoiceStatus(supabase, invoice.order_ids as string[]);
    }

    if (invoice.project_id) {
      await logProject(
        invoice.project_id,
        "rechnung",
        `Stornorechnung zu ${invoice.number || invoice.id} erstellt`
      );
    }

    setConfirmStorno(false);
    setSaving(false);
    nav(`/rechnungen/${stornoInv.id}`);
  }

  // Kontextsensitiv zurück: zum Projekt, wenn die Rechnung zu einem Projekt gehört.
  const goBack = () => (head.project_id ? nav(`/projekte/${head.project_id}`) : nav(-1));

  async function deleteDraft() {
    if (!invoice) return;
    const { error } = await softDeleteDocument("invoice", invoice.id, session?.user.id ?? null);
    if (error) { setErr(error); return; }
    goBack();
  }

  /* ── Render ── */
  if (loading) return <div className="pt-4"><Spinner /></div>;
  if (!isNew && (!invoice || (invoice as any).deleted_at)) return (
    <div className="pt-4">
      <button onClick={() => nav(-1)} className="btn-ghost mb-4 px-2"><ArrowLeft size={18} /> Zurück</button>
      <div className="glass p-4 text-center text-slate-400">{DELETE_GONE_TEXT}</div>
    </div>
  );
  if (!invoice) return <div className="pt-4"><Spinner /></div>;

  const isLocked = invoice.locked;
  const status = deriveInvoiceStatus(invoice);
  const statusColor = INVOICE_STATUS_COLOR[status];
  const statusLabel = INVOICE_STATUS_LABEL[status];
  const docStatusLabel = INVOICE_DOC_STATUS_LABEL[(invoice as any).doc_status ?? "entwurf"] ?? (invoice as any).doc_status;
  const docStatusTone = invoiceDocStatusTone((invoice as any).doc_status ?? "entwurf");
  const kindLabel = INVOICE_KIND_LABEL[(invoice as any).invoice_kind as keyof typeof INVOICE_KIND_LABEL] ?? (invoice as any).invoice_kind;

  const cName = (c: Contact) => contactDisplayName(c, { fallback: "–" });

  const customer = contacts.find((c) => c.id === head.contact_id) || null;
  const project = projects.find((p) => p.id === head.project_id) || null;
  const c: any = customer;
  // Kunde des PROJEKTS (für den Projektkontext im Kopf – wie in der Projektakte).
  const projectCustomer = contacts.find((x) => x.id === project?.contact_id) ?? customer;
  const projectCustomerName = projectCustomer ? cName(projectCustomer) : "";

  // Dokumentbezeichnung je Rechnungsart (für PDF-Überschrift/Dateiname-Basis bleibt „Rechnung").
  const docLabel =
    head.invoice_kind === "teilrechnung" ? "Teilrechnung"
    : head.invoice_kind === "schlussrechnung" ? "Schlussrechnung"
    : head.invoice_kind === "gutschrift" ? "Gutschrift"
    : head.invoice_kind === "storno" ? "Stornorechnung"
    : ((invoice as any)?.pdf_label || "Rechnung");
  const kindLbl = INVOICE_KIND_LABEL[head.invoice_kind as keyof typeof INVOICE_KIND_LABEL] || "Rechnung";

  // Zahlungs-/Verrechnungs-/Skonto-Block für das PDF (unverändert zur Vorlogik).
  const open = verrechnung.has ? verrechnung.open : totals.gross;
  const skP = Number(head.skonto_percent) || 0;
  const skontoAmount = head.with_skonto && skP > 0 ? Math.round(open * skP) / 100 : 0;
  // Skontoziel = echtes Skontoziel aus den Konditionen (NICHT das Zahlungsziel, KEIN harter
  // 14-Tage-Fallback). Ohne gepflegtes Skontoziel wird keine feste Frist/Datum erzeugt –
  // das PDF formuliert dann „innerhalb der Skontofrist" statt einer falschen Tageszahl.
  const skontoDays = Number(conditions.skontoDays) > 0 ? Number(conditions.skontoDays) : null;
  let skontoDate: string | null = null;
  if (head.with_skonto && head.invoice_date && skontoDays) {
    const d = new Date(head.invoice_date); d.setDate(d.getDate() + skontoDays);
    skontoDate = d.toLocaleDateString("de-AT");
  }
  const overview = verrechnung.has
    ? [
        ...verrechnung.prior.map((p) => ({
          label: `${INVOICE_KIND_LABEL[p.invoice_kind as keyof typeof INVOICE_KIND_LABEL] || "Rechnung"} ${p.number}`,
          date: dateAt(p.invoice_date), net: Number(p.net) || 0, vat: Number(p.vat) || 0, gross: Number(p.gross) || 0,
        })),
        { label: `${docLabel} ${invoice?.number || ""}`.trim(), date: dateAt(head.invoice_date), net: totals.net, vat: totals.vat, gross: totals.gross },
      ]
    : undefined;

  const recipientLines = resolveRecipientLines(recipientOverride, c);
  const subtitleLines = [
    invoice?.number ? `${kindLbl} ${invoice.number}` : "",
    head.service_period ? `Leistungszeitraum: ${head.service_period}` : "",
  ].filter(Boolean);

  const invDisplay = (invoice as any)?.display_settings_snapshot as OfferDisplay | undefined;
  const invIntro = (invoice as any)?.doc_intro_text as string | null;
  const invClosing = (invoice as any)?.doc_closing_text as string | null;
  const invPrePos = (invoice as any)?.pre_positions_text as string | null;
  // Platzhalter in den Snapshot-Texten auflösen (Kunde/Projekt/Dokument); idempotent
  // (bereits aufgelöste Texte ohne {{…}} bleiben unverändert).
  const invPh = buildDocPlaceholders({
    customer: c ?? null, project,
    docNumber: invoice?.number, docDate: head.invoice_date,
    docLabel, company, bearbeiter: profile?.name ?? "",
    conditions: { paymentTermDays: Number(head.payment_term_days) || null, skontoPercent: Number(head.skonto_percent) || conditions.skontoPercent, skontoDays: conditions.skontoDays },
  });
  const invTexts = resolveDocTexts({ intro: invIntro, prePositions: invPrePos, closing: invClosing }, invPh);

  const printMeta = {
    number: invoice?.number || "Entwurf",
    title: head.title,
    customer: c ? cName(c) : "",
    date: dateAt(head.invoice_date),
    notes: head.notes || null,
    display: invDisplay || undefined,
    introHtml: invTexts.introHtml,
    prePositionsHtml: invTexts.prePositionsHtml,
    // §19-Bauleistung (Reverse Charge): gesetzlichen Hinweis an den Schlusstext anhängen –
    // gilt für ALLE Rechnungsvarianten (Standard/Pauschal/Regie), idempotent.
    closingHtml: withParagraph19Note(invTexts.closingHtml, isReverseCharge(totals.net, totals.vat)),
    projectNumber: project?.project_number ?? null,
    customerVatId: c?.uid ?? c?.vat_id ?? null,
    recipientLines,
    subtitleLines,
    createdBy: (invoice as any)?.created_by ?? null,
    signatureSource,
    payment: {
      dueDate: invoice?.due_date ? dateAt(invoice.due_date) : null,
      termDays: Number(head.payment_term_days) || undefined,
      withSkonto: head.with_skonto, skontoPercent: skP || undefined,
      skontoDays: skontoDays ?? undefined, skontoAmount, skontoDate, openAmount: open,
      totalGross: verrechnung.has ? totals.gross : undefined,
      alreadyInvoiced: verrechnung.has ? verrechnung.priorGross : undefined,
      overview,
    },
  };

  const moreActions = buildDocumentMoreActions({
    kind: "invoice",
    isLocked: !!isLocked,
    isStorniert: invoice.doc_status === "storniert",
    hasStornoOf: !!invoice.storno_of,
    canDelete: isDeletable("invoice", invoice) && can("invoices", "delete"),
    onStorno: () => setConfirmStorno(true),
    onToOriginal: () => nav(`/rechnungen/${invoice.storno_of}`),
    onDelete: () => setDelOpen(true),
  });

  return (
    <div className="pt-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* Zurück nur bei freistehenden Rechnungen (ohne Projekt) – sonst übernimmt „Zum Projekt" in der Toolbar. */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {!head.project_id && <button onClick={goBack} className="btn-ghost px-2"><ArrowLeft size={18} /> Zurück</button>}
          {/* Ausführlicher Projektkontext – zentral, identisch zur Projektakte. */}
          <ProjectContextChips project={project} customerName={projectCustomerName} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg px-2 py-0.5 font-mono text-xs" style={{ background: "var(--hover)" }}>
            {invoice.number || "Entwurf"}
          </span>
          <Badge tone={docStatusTone}>{docStatusLabel}</Badge>
          {kindLabel && <Badge tone="slate">{kindLabel}</Badge>}
          <Badge tone={statusColor as any}>{statusLabel}</Badge>
          {invoice.storno_of && <Badge tone="red">Storno</Badge>}
          {isLocked && <span title="Finalisiert – gesperrt"><Lock size={14} className="text-slate-400" /></span>}
        </div>
      </div>
      <ErrorBanner message={err} />

      {isLocked && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          Diese Rechnung ist finalisiert: Positionen und Beträge sind gesperrt (Korrekturen über Storno). Die Einstellungen lassen sich weiterhin öffnen, anpassen und speichern – ohne neue Version.
        </div>
      )}

      <DocumentWorkspace
        builder={builder}
        docType="rechnung"
        docLabel={docLabel}
        numberLabel="Rechnung"
        projectId={head.project_id || null}
        sourceTable="invoice"
        sourceId={invoice.id}
        vatOverride={vatOverride}
        vatLabel={vatMode === "par19" ? "MwSt §19 (0 %)" : "MwSt"}
        printMeta={printMeta}
        onSave={() => { doSave(); }}
        saving={saving}
        onFinalize={() => setConfirmFinalize(true)}
        onSettings={() => setSettingsOpen(true)}
        onHistory={() => setVersionsOpen(true)}
        moreActions={moreActions}
        readOnly={isLocked}
        aiActions={aiDocActionLabels("rechnung").map((label) => ({
          label, onClick: () => toastInfo("Die KI-Erzeugung wird in Kürze verfügbar sein."),
        }))}
      />

      {/* ── Teilrechnungs-Verrechnung (automatisch – zur Kontrolle) ── */}
      {verrechnung.has && (
        <div className="glass mt-3 p-4">
          <div className="ml-auto max-w-sm rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/20 dark:bg-amber-500/10">
            <div className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              Teilrechnungs-Verrechnung (automatisch – bitte prüfen)
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Gesamtsumme brutto</span>
              <span className="tabular-nums">{eur(totals.gross)}</span>
            </div>
            {verrechnung.prior.map((p) => (
              <div key={p.id} className="flex justify-between gap-4 text-xs text-slate-500">
                <span>{INVOICE_KIND_LABEL[p.invoice_kind as keyof typeof INVOICE_KIND_LABEL] || "Rechnung"} {p.number} · {dateAt(p.invoice_date)}</span>
                <span className="tabular-nums">−{eur(Number(p.gross) || 0)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between gap-4 border-t border-amber-200 pt-1 font-bold dark:border-amber-500/20">
              <span>Offener Betrag</span>
              <span className="tabular-nums">{eur(verrechnung.open)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Rechnungseinstellungen (ausgelagerter Stammdaten-Block – gleiche Optik wie Auftrag) */}
      {settingsOpen && (
        <Modal open onClose={() => setSettingsOpen(false)} title="Rechnungseinstellungen" size="xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">Rechnungsart</label>
              <select className="input" value={head.invoice_kind} onChange={(e) => setH("invoice_kind", e.target.value)}>
                {Object.entries(INVOICE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="label">Rechnungsnummer</label>
              <input className="input cursor-not-allowed opacity-70" value={invoice.number || "wird bei Finalisierung vergeben"} readOnly title="Wird bei der Finalisierung über den Nummernkreis vergeben (§ 11 UStG)." /></div>
            <div className="sm:col-span-2"><label className="label">MwSt-Modus</label>
              <select className="input" value={vatMode} onChange={(e) => { setVatMode(e.target.value as VatMode); builder.setDirty(true); }}>
                <option value="standard">Regulär 20 %</option>
                <option value="par19">§19 Bauleistung (Reverse Charge, 0 %)</option>
              </select></div>
            <SignatureSourcePicker value={signatureSource} createdBy={(invoice as any)?.created_by ?? null}
              onChange={(v) => { setSignatureSource(v); builder.setDirty(true); }} />
            <div className="sm:col-span-2"><label className="label">Titel / Betreff</label>
              <input className="input" value={head.title} placeholder="z.B. Arbeiten im Büro" onChange={(e) => setH("title", e.target.value)} /></div>
            <div><label className="label">Rechnungsdatum</label>
              <input type="date" className="input" value={head.invoice_date} onChange={(e) => setH("invoice_date", e.target.value)} /></div>
            <div><label className="label">Zahlungsziel (Tage)</label>
              <input type="number" className="input" min={0} value={head.payment_term_days} onChange={(e) => setH("payment_term_days", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">Skonto</label>
              <div className="input flex items-center gap-2">
                <input type="checkbox" checked={head.with_skonto} onChange={(e) => setH("with_skonto", e.target.checked)} />
                <input type="number" step="0.1" min={0} className="w-16 bg-transparent text-right tabular-nums outline-none"
                  value={head.skonto_percent} disabled={!head.with_skonto} onChange={(e) => setH("skonto_percent", e.target.value)} />
                <span className="text-xs text-slate-400">% bei Zahlung in 14 Tagen</span>
              </div></div>
            <div><label className="label">Skontoziel (Tage)</label>
              <input type="number" min={0} className="input"
                value={conditions.skontoDays ?? ""} onChange={(e) => setConditions({ ...conditions, skontoDays: e.target.value === "" ? null : Number(e.target.value) })} placeholder="z.B. 14" /></div>
            <div><label className="label">Standardnachlass %</label>
              <input type="number" min={0} step="0.1" className="input"
                value={conditions.discountPercent ?? ""} onChange={(e) => setConditions({ ...conditions, discountPercent: e.target.value === "" ? null : Number(e.target.value) })} placeholder="0" /></div>
            <div className="sm:col-span-2"><label className="label">Standardaufschlag % <span className="font-normal text-slate-400">(intern, unsichtbar)</span></label>
              <input type="number" min={0} step="0.1" className="input"
                value={conditions.surchargePercent ?? ""} onChange={(e) => setConditions({ ...conditions, surchargePercent: e.target.value === "" ? null : Number(e.target.value) })} placeholder="0" />
              <p className="mt-1 text-[11px] text-slate-400">Wird vom Vorgängerdokument übernommen und erscheint nicht im PDF.</p></div>
            <div className="sm:col-span-2"><label className="label">Leistungszeitraum</label>
              <input className="input" placeholder="z.B. 01.05.2025 – 31.05.2025" value={head.service_period} onChange={(e) => setH("service_period", e.target.value)} /></div>
            <div><label className="label">Kunde</label>
              <select className="input" value={head.contact_id} onChange={(e) => setH("contact_id", e.target.value)}>
                <option value="">– kein Kunde –</option>
                {contacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.contact_number ? `${ct.contact_number} · ` : ""}{cName(ct)}</option>)}
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
            {head.order_ids.length > 0 && (
              <div className="sm:col-span-2"><label className="label">Auftrags-Referenz</label>
                <div className="input bg-slate-50 dark:bg-white/5 font-mono text-xs">{head.order_ids.join(", ")}</div></div>
            )}
            <div className="sm:col-span-2"><label className="label">Interne Notiz</label>
              <textarea className="input min-h-[60px]" value={head.notes} rows={2} onChange={(e) => setH("notes", e.target.value)} /></div>
          </div>
          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-sm font-bold">Abweichende Empfängeranschrift</div>
            <RecipientOverrideEditor value={recipientOverride}
              onChange={(next) => { setRecipientOverride(next); }} />
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary" onClick={() => setSettingsOpen(false)}>Fertig</button></div>
        </Modal>
      )}

      {/* ── Finalisierungs-Bestätigung (AT-konform) ── */}
      <ConfirmDialog
        open={confirmFinalize}
        title="Rechnung finalisieren?"
        confirmLabel="Jetzt finalisieren"
        message={
          <>
            <p className="mb-2">
              Nach der Finalisierung wird die Rechnung <b>gesperrt</b> und bekommt eine
              fortlaufende Rechnungsnummer (§ 11 UStG, AT-konform).
            </p>
            <ul className="list-disc pl-4 text-sm text-slate-500 space-y-1">
              <li>Die Rechnung kann danach <b>nicht mehr bearbeitet</b> werden.</li>
              <li>Korrekturen erfordern eine Storno-Rechnung.</li>
              <li>Fälligkeitsdatum wird automatisch berechnet.</li>
            </ul>
          </>
        }
        onConfirm={() => { setConfirmFinalize(false); finalize(); }}
        onClose={() => setConfirmFinalize(false)}
      />

      {/* ── Storno-Bestätigung ── */}
      <ConfirmDialog
        open={confirmStorno}
        title="Storno erstellen"
        message={`Soll zu Rechnung ${invoice.number || invoice.id.slice(0, 8)} eine Stornorechnung erstellt werden? Die Original-Rechnung wird als storniert markiert.`}
        confirmLabel="Storno erstellen"
        onConfirm={createStorno}
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
          sourceTable="invoice"
          sourceId={invoice.id}
          baseLabel="Rechnung"
          currentNumber={invoice.number}
          canRestore={false}
          restoreDisabledNote="Rechnungen können aus rechtlichen Gründen (§ 11 UStG, lückenlose Nummerierung, Aufbewahrungspflicht) nicht wiederhergestellt werden. Korrektur erfolgt über Storno + neue Rechnung."
          onClose={() => setVersionsOpen(false)}
        />
      )}
    </div>
  );
}
