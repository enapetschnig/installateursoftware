import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Pencil, Archive, ArchiveRestore, Plus, Trash2,
  BookText, Camera, FileText, Receipt, ListTodo, CalendarRange, Users, CheckSquare,
  StickyNote, FileStack, ClipboardList, Clock, Banknote, Package, BarChart2, CheckCircle2,
  AlertTriangle, Eye, ChevronDown, ChevronRight, FolderArchive, Building2, PenLine,
} from "lucide-react";
import ProjectMeetings from "../components/project/ProjectMeetings";
import ProjectSignatures from "../components/project/ProjectSignatures";
import { supabase } from "../lib/supabase";
import {
  Project, Contact, ContactPerson, ProjectParticipant, ProjectAppointment, ProjectChecklist,
  ProjectChecklistItem, ProjectLogEntry, Order, ORDER_STATUS_LABEL, ORDER_INVOICE_STATUS_LABEL,
  PARTICIPANT_ROLES, APPOINTMENT_KINDS, PROJECT_PRIORITIES, stageTone,
} from "../lib/types";
import { Spinner, Empty, Badge, Modal, TONES, DateStack } from "../components/ui";
import { ConfirmDialog } from "../components/calc-ui";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";
import { usePermissions } from "../lib/permissions";
import { formatAddressInline } from "../lib/contact-name";
import { isUuid, docPath } from "../lib/documents-overview";
import { useProjectConfig } from "../lib/project-config";
import { eur, dateAt, dateTimeAt, timeAt } from "../lib/format";
import { canConvertOffer } from "../lib/document-transitions";
import { loadVersionMap } from "../lib/document-versions";
import { logProject } from "../lib/projectlog";
import Avatar from "../components/Avatar";
import { runStageAutomations } from "../lib/automations";
import DocumentCreateMenu, { ChainKind, DocumentCreateOpts } from "../components/document/DocumentCreateMenu";
import SelectOfferPositionsModal from "../components/document/SelectOfferPositionsModal";
import SubOrderCreateModal from "../components/document/SubOrderCreateModal";
import SourceSelectLayout, { PreviewCard, PreviewNote, summarizeNumbers } from "../components/document/SourceSelectLayout";
import { openSubOrderPdf } from "../components/document/subOrderPdf";
import { Repeat, HardHat } from "lucide-react";
import { OfferType, loadOfferTypes, variantLabel, variantTone } from "../lib/offer-kinds";
import ProjectForm from "../components/ProjectForm";
import EntityHeader, { HeaderChip } from "../components/EntityHeader";
import { projectContextChips } from "../components/project/ProjectContextChips";
import ProjectDocuments from "../components/project/ProjectDocuments";
import { DocumentType, loadDocumentTypes, NATIVE_SLUGS } from "../lib/documents";
import { useAuth } from "../lib/auth";
import ProjectMediaGallery from "../components/media/ProjectMediaGallery";
import { Offer, OfferLine, OFFER_STATUS_LABEL, OFFER_STATUS_TONE } from "../lib/offer-types";
import {
  createOrderFromOffers, createOrdersPerOffer,
  createInvoiceFromOrders, createInvoicesPerOrder,
  hasVariantConflict, ChainMode, ItemFilter,
} from "../lib/document-chain";
import {
  createOfferDraft, createNachtragDraft, createOrderDraft, invoiceNewRoute, createGenericDocument,
} from "../lib/document-create";
import { refreshOrdersInvoiceStatus } from "../lib/invoice-types";
import { loadEvents, EventWithLinks } from "../lib/planning";
import { Appointment, fetchAppointments, materializeOccurrences } from "../lib/appointments";
import { isDraftOrder } from "../lib/order-status";
import { toast, toastError, toastInfo } from "../lib/toast";
import { isDeletable, softDeleteDocument, DELETE_CONFIRM_TEXT } from "../lib/document-delete";

const dt = (s?: string | null) =>
  s ? new Date(s).toLocaleString("de-AT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) : "–";

const cName = (c?: Contact | null) =>
  !c ? "–"
    : c.customer_type === "firma"
      ? (c.company || "Firma")
      : [c.salutation, c.title, c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "–";

/* ──────────────────────────────────────────────────────────────
   Navigation-Reiter (Reihenfolge laut Vorgabe)
────────────────────────────────────────────────────────────── */
// Oben (vor der Dokumente-Gruppe)
const SECTIONS_TOP = [
  { key: "logbuch", label: "Logbuch", icon: BookText },
  { key: "bilder",  label: "Bilder & Videos", icon: Camera },
] as const;
// Leistung & Abrechnung (nach der Dokumente-Gruppe)
const SECTIONS_LEISTUNG = [
  { key: "regiestunden",  label: "Regiestunden", icon: Clock },
  { key: "zeitlohn",      label: "Zeit & Lohn", icon: Banknote },
  { key: "material",      label: "Material", icon: Package },
  { key: "belege",        label: "Belege", icon: Receipt },
] as const;
// Bereich „Organisation" – projektbezogene organisatorische Funktionen (gebündelt)
const SECTIONS_ORGANISATION = [
  { key: "termine",          label: "Termine", icon: CalendarRange },
  { key: "baubesprechungen", label: "Baubesprechungen", icon: ClipboardList },
  { key: "aufgaben",         label: "Aufgaben", icon: ListTodo },
  { key: "checklisten",      label: "Checklisten", icon: CheckSquare },
  { key: "beteiligte",       label: "Projektbeteiligte", icon: Users },
  { key: "notizen",          label: "Notizen", icon: StickyNote },
  { key: "unterschriften",   label: "Subunternehmer-Unterschriften", icon: PenLine },
] as const;
// Abschluss
const SECTIONS_ABSCHLUSS = [
  { key: "sollist",       label: "Soll/Ist-Vergleich", icon: BarChart2 },
  { key: "abschluss",     label: "Projektabschluss", icon: CheckCircle2 },
] as const;
type SectionKey = string;

/* ──────────────────────────────────────────────────────────────
   Aktiver Projektbereich – zentrale, projektbezogene Persistenz
   Speichert je Projekt-ID den zuletzt aktiven Sidebar-Bereich, damit nach
   Öffnen einer Detailansicht + Zurück wieder DERSELBE Bereich aktiv ist
   (statt immer „Logbuch"). Gilt allgemein für ALLE Bereiche – keine
   Sonderlösung. Fallback-Kette: gespeicherter gültiger Bereich → „logbuch".
────────────────────────────────────────────────────────────── */
const VALID_SECTIONS = new Set<string>([
  ...SECTIONS_TOP.map((s) => s.key),
  "dok_overview", "angebote", "auftraege", "rechnungen",
  ...SECTIONS_ORGANISATION.map((s) => s.key),
  ...SECTIONS_LEISTUNG.map((s) => s.key),
  ...SECTIONS_ABSCHLUSS.map((s) => s.key),
]);
const isValidSection = (s: string | null | undefined): s is string =>
  !!s && (VALID_SECTIONS.has(s) || s.startsWith("doktype:"));
const secStorageKey = (projectId?: string) => `b4y:lastProjectSection:${projectId ?? ""}`;
function readStoredSection(projectId?: string): SectionKey {
  if (!projectId) return "logbuch";
  try {
    const v = sessionStorage.getItem(secStorageKey(projectId));
    return isValidSection(v) ? v : "logbuch";
  } catch { return "logbuch"; }
}

/* ──────────────────────────────────────────────────────────────
   Helper: Status-Ton für Aufträge
────────────────────────────────────────────────────────────── */
function orderStatusTone(s: string): "slate" | "blue" | "green" | "amber" | "red" {
  if (s === "beauftragt" || s === "in_arbeit") return "blue";
  if (s === "voll_verrechnet") return "green";
  if (s === "teilw_verrechnet") return "amber";
  if (s === "storniert") return "red";
  return "slate";
}

/* ──────────────────────────────────────────────────────────────
   Params for createOrderCore
────────────────────────────────────────────────────────────── */
type CreateOrderCoreParams = {
  sourceOffers: Offer[];
  itemFilter?: Map<string, string[]>; // offerId → selected item IDs (undefined = all)
  title?: string;
  mode?: ChainMode;                   // "merge" (gemeinsam) | "perSource" (je Angebot eigener Auftrag)
  targetOfferTypeId?: string | null;  // bei gemischten Varianten Pflicht
};

type CreateInvoiceCoreParams = {
  sourceOrders: any[];
  itemFilter?: Map<string, string[]>; // orderId → selected item IDs (undefined = all)
  qtyFilter?: Map<string, Map<string, number>>; // orderId → (itemId → Teilmenge)
  mode?: ChainMode;                   // "merge" | "perSource"
  targetOfferTypeId?: string | null;
};

/* ──────────────────────────────────────────────────────────────
   Main Page
────────────────────────────────────────────────────────────── */
export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { session } = useAuth();
  const { can, isAdmin } = usePermissions();
  const canArchive = isAdmin || can("projects", "edit");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [p, setP] = useState<Project | null>(null);
  // Aufgelöste echte Projekt-UUID (Route-Param kann eine sprechende Projektnummer sein).
  const [pid, setPid] = useState<string | null>(isUuid(id) ? (id ?? null) : null);
  const cfg = useProjectConfig();
  const [contact, setContact] = useState<Contact | null>(null);
  const [persons, setPersons] = useState<ContactPerson[]>([]);
  const [loading, setLoading] = useState(true);
  // Aktiver Sidebar-Bereich – initial der je Projekt gespeicherte Bereich (sonst Logbuch).
  const [sec, setSecState] = useState<SectionKey>(() => readStoredSection(id));
  const secInit = useRef(true);
  // selectSec = setzen + projektbezogen merken (eine Quelle der Wahrheit).
  const setSec = (s: SectionKey) => {
    setSecState(s);
    const k = pid ?? id;
    try { if (k) sessionStorage.setItem(secStorageKey(k), s); } catch { /* ignore */ }
  };
  // Beim Erstellen/Öffnen eines Dokuments aus dem Projekt den fachlich passenden
  // Rücksprung-Bereich VORAB merken (nur Persistenz, kein Re-Render): goBack() aus dem
  // Editor führt nach /projekte/:id, das via readStoredSection genau diesen Bereich
  // aktiviert – zentral je Dokumenttyp, auch beim ERSTEN Angebot. Kein Rückfall auf Logbuch.
  const rememberSection = (s: SectionKey) => {
    const k = pid ?? id;
    try { if (k) sessionStorage.setItem(secStorageKey(k), s); } catch { /* ignore */ }
  };
  // Projektwechsel: Bereich des NEUEN Projekts laden – nie den des alten übernehmen.
  useEffect(() => {
    if (secInit.current) { secInit.current = false; return; } // Erstmount: bereits via useState-Init
    setSecState(readStoredSection(id));
  }, [id]);
  const [editOpen, setEditOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [docCounts, setDocCounts] = useState<{ angebote: number; auftraege: number; rechnungen: number; byType: Record<string, number> }>({ angebote: 0, auftraege: 0, rechnungen: 0, byType: {} });
  const [orderVolume, setOrderVolume] = useState(0); // Auftragsvolumen netto (Summe gültiger Aufträge)
  const [docRefresh, setDocRefresh] = useState(0);   // bumpt → Auftrags-/Listen-Komponenten neu mounten (frische Daten)
  const [docNames, setDocNames] = useState<Record<string, string>>({});
  const [docOpen, setDocOpen] = useState(true);
  const [orgOpen, setOrgOpen] = useState(true);
  // Auftrag-SUB aus dem „Dokument erstellen"-Menü: gewählte Variante + Quellauftrag-Auswahl.
  const [subVariant, setSubVariant] = useState<OfferType | null>(null);
  const [subPickOrders, setSubPickOrders] = useState<any[] | null>(null);

  async function loadDocMeta() {
    if (!pid) return;
    const [types, off, ord, inv, docs, profs, ordNet] = await Promise.all([
      loadDocumentTypes(true).catch(() => [] as DocumentType[]),
      supabase.from("offers").select("id", { count: "exact", head: true }).eq("project_id", pid),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("project_id", pid).is("deleted_at", null).neq("status", "storniert").neq("status", "archiviert"),
      supabase.from("invoices").select("id", { count: "exact", head: true }).eq("project_id", pid),
      supabase.from("documents").select("document_type_id").eq("project_id", pid).is("archived_at", null),
      supabase.from("profiles").select("id,name"),
      // Auftragsvolumen netto: Netto-Summe der gültigen Aufträge (nicht gelöscht/storniert/archiviert).
      supabase.from("orders").select("net").eq("project_id", pid).is("deleted_at", null).is("archived_at", null).neq("status", "storniert"),
    ]);
    setDocTypes(types as DocumentType[]);
    setOrderVolume(((ordNet.data as { net: number | null }[]) ?? []).reduce((s, r) => s + (Number(r.net) || 0), 0));
    const byType: Record<string, number> = {};
    for (const d of (docs.data ?? [])) { const k = (d as any).document_type_id; if (k) byType[k] = (byType[k] ?? 0) + 1; }
    setDocCounts({ angebote: off.count ?? 0, auftraege: ord.count ?? 0, rechnungen: inv.count ?? 0, byType });
    const m: Record<string, string> = {};
    (profs.data ?? []).forEach((pr: any) => { if (pr.id) m[pr.id] = pr.name || ""; });
    setDocNames(m);
  }
  useEffect(() => { loadDocMeta(); /* eslint-disable-line */ }, [pid, docRefresh]);

  async function load() {
    // Route-Param kann UUID ODER sprechende Projektnummer sein – beides auflösen.
    const { data } = await supabase.from("projects").select("*")
      .eq(isUuid(id) ? "id" : "project_number", id as string).maybeSingle();
    const proj = data as Project | null;
    setP(proj); setPid(proj?.id ?? null); setNote(proj?.internal_note ?? "");
    if (proj?.contact_id) {
      const [{ data: c }, { data: pp }] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", proj.contact_id).maybeSingle(),
        supabase.from("contact_persons").select("*").eq("contact_id", proj.contact_id).order("sort_order"),
      ]);
      setContact(c as Contact | null);
      setPersons((pp as ContactPerson[]) ?? []);
    } else { setContact(null); setPersons([]); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);

  async function changeStage(stage: string) {
    if (!p || stage === p.stage) return;
    const old = p.stage;
    setP({ ...p, stage }); // optimistisch
    // Persistieren und betroffene Zeilen prüfen: schlägt das Update fehl (Fehler ODER 0 Zeilen
    // wegen Rechte-/Mandantenkontext via RLS), rollen wir den Status zurück und melden es.
    const { data, error } = await supabase
      .from("projects")
      .update({ stage, updated_at: new Date().toISOString() })
      .eq("id", p.id)
      .select("id");
    if (error || !data || data.length === 0) {
      setP({ ...p, stage: old }); // Rollback
      toastError(error?.message || "Status konnte nicht gespeichert werden (fehlende Berechtigung oder Mandantenkontext).");
      return;
    }
    toast(`Status geändert auf „${stage}“.`);
    // Erst nach erfolgreichem DB-Update: Logbuch + Status-Automationen (best-effort).
    await logProject(p.id, "status", `Status geändert: ${old} → ${stage}`);
    await runStageAutomations({ projectId: p.id, stage, oldStage: old, createdBy: session?.user.id ?? null });
  }
  async function toggleArchive() {
    if (!p || !canArchive) return;
    const archived = !p.archived;
    setArchiveBusy(true);
    const { data, error } = await supabase.from("projects")
      .update({ archived, updated_at: new Date().toISOString() }).eq("id", p.id).select("id");
    setArchiveBusy(false);
    if (error || !data || data.length === 0) { toastError(error?.message || "Archivieren fehlgeschlagen (Berechtigung/Mandantenkontext)."); return; }
    setP({ ...p, archived });                 // sofortige sichtbare Rückmeldung im Kopf (Badge + Icon)
    setArchiveOpen(false);
    await logProject(p.id, "projekt", archived ? "Projekt wurde archiviert." : "Projekt wurde reaktiviert.");
  }
  async function saveNote() {
    if (!p) return;
    setNoteSaving(true);
    const { data, error } = await supabase.from("projects")
      .update({ internal_note: note, updated_at: new Date().toISOString() }).eq("id", p.id).select("id");
    setNoteSaving(false);
    if (error || !data || data.length === 0) { toastError(error?.message || "Notiz konnte nicht gespeichert werden."); return; }
    setP({ ...p, internal_note: note });
    toast("Notiz gespeichert.");
  }

  /* ── Angebot erstellen ── */
  async function createOffer() {
    if (!p) return;
    // OHNE Nummer: Entwürfe verbrauchen keine Nummer – Vergabe erst beim Abschließen.
    const res = await supabase.from("offers")
      .insert({ project_id: p.id, contact_id: p.contact_id, title: p.title, status: "entwurf", number: null })
      .select("id").single();
    if (res.error || !res.data) { toastError(res.error?.message || "Angebot konnte nicht angelegt werden."); return; }
    // Kein Logbuch-Eintrag beim bloßen Anlegen eines Entwurfs.
    // Der Logbuch-Eintrag erfolgt erst beim Abschließen/Versenden (siehe OfferEditor).
    nav(docPath("offer", res.data.id, null));
  }

  /* ── Auftrag erstellen (leer) ── */
  async function createOrder() {
    if (!p) return;
    const { data: numData } = await supabase.rpc("next_document_number", { p_doc_type: "auftrag" });
    const { data, error } = await supabase.from("orders").insert({
      order_number: numData as string,
      order_date: new Date().toISOString().slice(0, 10),
      title: p.title,
      project_id: p.id,
      contact_id: p.contact_id,
      status: "beauftragt",
      invoice_status: "offen",
      net: 0, vat: 0, gross: 0,
      offer_ids: [],
    }).select("id").single();
    if (error || !data) { toastError(error?.message || "Auftrag konnte nicht angelegt werden."); return; }
    await logProject(p.id, "auftrag", `Auftrag ${numData} erstellt`);
    nav(docPath("order", data.id, numData as string));
  }

  /* ── Zentrale Dokument-Erstellung aus dem „Dokument erstellen"-Menü ──
     Projektkontext (Projekt, Kunde, Titel, Nummernkreis) + optional gewählte
     Variante (offer_type) werden übernommen; danach Editor-Navigation. */
  async function createChainDoc(kind: ChainKind, offerType: OfferType | null, opts?: DocumentCreateOpts) {
    if (!p) return;
    const ctx = { projectId: p.id, contactId: p.contact_id, title: p.title, offerType };
    if (kind === "offer") {
      const r = await createOfferDraft({ ...ctx, voice: opts?.voice });
      if (r.error || !r.route) { if (r.error) toastError(r.error); return; }
      rememberSection("angebote");
      nav(r.route);
      return;
    }
    if (kind === "nachtrag") {
      const r = await createNachtragDraft(ctx);
      if (r.error || !r.route) { if (r.error) window.alert(r.error); return; }
      await logProject(p.id, "angebot", `Angebot-Nachtrag ${r.number || r.id} als Entwurf erstellt`);
      rememberSection("angebote");
      nav(r.route);
      return;
    }
    if (kind === "order") {
      const r = await createOrderDraft(ctx);
      if (r.error || !r.route) { if (r.error) toastError(r.error); return; }
      // Manueller Auftrag = Entwurf (frei bearbeitbar + löschbar); verbindlich erst via „Beauftragen".
      await logProject(p.id, "auftrag", `Auftrag ${r.number || r.id} als Entwurf erstellt`);
      rememberSection("auftraege");
      nav(r.route);
      return;
    }
    // Rechnung: bestehender Neu-Flow, Projekt + (optional) Variante übergeben
    rememberSection("rechnungen");
    nav(invoiceNewRoute({ projectId: p.id, offerType }));
  }

  /* ── Auftrag SUB aus dem Erstell-Menü: Variante voreingestellt, dann Vergabe.
     SUB braucht einen beauftragten Hauptauftrag als Quelle → Auftrag wählen
     (1 = direkt, mehrere = Auswahl), danach SubOrderCreateModal mit Variante. */
  async function createSubDoc(variant: OfferType | null) {
    if (!p) return;
    const { data } = await supabase.from("orders")
      .select("id,order_number,title,items,status")
      .eq("project_id", p.id).is("deleted_at", null)
      .not("status", "in", "(entwurf,storniert,archiviert)");
    const orders = (data as any[]) ?? [];
    if (orders.length === 0) {
      window.alert("Für eine Subunternehmer-Vergabe wird ein beauftragter Auftrag als Quelle benötigt. Bitte zuerst einen Auftrag erstellen und beauftragen.");
      return;
    }
    setSubVariant(variant);
    setSubPickOrders(orders);
  }

  /* ── Generische (Nicht-Ketten-)Dokumenttypen des Mandanten ──
     Legt einen documents-Datensatz als Entwurf im Projektkontext an und
     schreibt einen Logbuch-Eintrag. Identisch für beide „Dokument erstellen"-
     Buttons (Projektkopf + Dokumente-Bereich). */
  async function createGenericDoc(docType: DocumentType) {
    if (!p) return;
    // Zentrale Verzweigung nach Dokumentstruktur (Migr. 0084) – siehe createGenericDocument.
    const r = await createGenericDocument({
      projectId: p.id, docType,
      customerId: (p as any).customer_id ?? null,
      title: p.title || docType.name, createdBy: session?.user.id ?? null,
    });
    if ("error" in r) { toastError(r.error); return; }
    if (r.kind === "info") { toastInfo(r.message); return; }
    if (r.kind === "navigate") {
      await logProject(p.id, "dokument", `${docType.name} erstellt`);
      nav(r.route);
      return;
    }
    // kind === "refresh"
    await logProject(p.id, "dokument", `Dokument erstellt: ${p.title || docType.name} (${docType.name})`);
    loadDocMeta();
  }

  // Nach Auftragserstellung im Projekt: in den Reiter „Aufträge" wechseln,
  // Zähler neu laden und die Auftragsliste frisch mounten (zeigt den neuen Auftrag).
  async function goToOrdersTab() {
    setSec("auftraege");
    await loadDocMeta();
    setDocRefresh((x) => x + 1);
  }

  // Nach Rechnungserstellung im Projekt bleiben + Reiter „Rechnungen" frisch zeigen
  // (vermeidet Sprung auf die separate Route /rechnungen/:id).
  async function goToInvoicesTab() {
    setSec("rechnungen");
    await loadDocMeta();
    setDocRefresh((x) => x + 1);
  }

  /* ── Auftrag aus Angeboten erstellen (Snapshot-Prinzip, Phase 3) ──
     Unterstützt:
     - Einzelnes Angebot, alle Positionen  (itemFilter = undefined)
     - Einzelnes Angebot, Positionen-Auswahl  (itemFilter = Map mit 1 Eintrag)
     - Mehrere Angebote zusammengeführt  (sourceOffers.length > 1)
  ────────────────────────────────────────────────────────────── */
  async function createOrderCore({ sourceOffers, itemFilter, title, mode, targetOfferTypeId }: CreateOrderCoreParams) {
    if (!p) return;
    const offerNums = sourceOffers.map((o) => o.number || o.id.slice(0, 8)).join(", ");

    // Mehrere Angebote → je Angebot ein eigener Auftrag
    if (mode === "perSource") {
      const r = await createOrdersPerOffer({
        projectId: p.id, contactId: p.contact_id, offers: sourceOffers, itemFilter,
      });
      if (r.error) { window.alert(r.error); return; }
      await logProject(p.id, "auftrag",
        `${r.numbers.length} Aufträge aus Angeboten ${offerNums} erstellt: ${r.numbers.join(", ")}`);
      if (r.ids.length > 1) window.alert(`${r.ids.length} Aufträge erstellt: ${r.numbers.join(", ")}`);
      await goToOrdersTab();   // im Projekt bleiben und Reiter „Aufträge" zeigen
      return;
    }

    // 1 Angebot bzw. mehrere Angebote → 1 gemeinsamer Auftrag (zentrale Engine)
    const r = await createOrderFromOffers({
      projectId: p.id, contactId: p.contact_id, offers: sourceOffers, itemFilter,
      title: title ?? null, targetOfferTypeId: targetOfferTypeId ?? null,
    });
    if (r.error) { window.alert(r.error); return; }
    await logProject(p.id, "auftrag",
      `Auftrag ${r.number} aus Angebot${sourceOffers.length > 1 ? "en" : ""} ${offerNums} erstellt`);
    await goToOrdersTab();   // im Projekt bleiben und Reiter „Aufträge" zeigen (statt zur Einzelseite zu springen)
  }

  /* ── Rechnung aus Auftrag/Aufträgen erstellen (zentrale Engine) ──
     - 1 Auftrag → 1 Rechnung
     - mehrere Aufträge → 1 gemeinsame Rechnung   (mode "merge")
     - mehrere Aufträge → je Auftrag eine Rechnung (mode "perSource")
     jeweils mit optionaler Positionsauswahl je Auftrag. */
  async function createInvoiceCore({ sourceOrders, itemFilter, qtyFilter, mode, targetOfferTypeId }: CreateInvoiceCoreParams) {
    if (!p) return;
    const orderNums = sourceOrders.map((o) => o.order_number || o.id.slice(0, 8)).join(", ");
    if (mode === "perSource") {
      const r = await createInvoicesPerOrder({ projectId: p.id, orders: sourceOrders, itemFilter, qtyFilter });
      if (r.error) { toastError(r.error); return; }
      await logProject(p.id, "rechnung", `${r.ids.length} Rechnungen aus Aufträgen ${orderNums} erstellt`);
      // Verrechnungsstatus der Quell-Aufträge aktualisieren (offen/teilweise/voll verrechnet)
      await refreshOrdersInvoiceStatus(supabase, sourceOrders.map((o) => o.id));
      toast(r.ids.length === 1 ? "Rechnung wurde erstellt." : `${r.ids.length} Rechnungen wurden erstellt.`);
      await goToInvoicesTab();
      return;
    }
    const r = await createInvoiceFromOrders({
      projectId: p.id, orders: sourceOrders, itemFilter, qtyFilter, targetOfferTypeId: targetOfferTypeId ?? null,
    });
    if (r.error) { toastError(r.error); return; }
    await logProject(p.id, "rechnung",
      `Rechnung (Entwurf) aus Auftrag${sourceOrders.length > 1 ? "en" : ""} ${orderNums} erstellt`);
    // Verrechnungsstatus der Quell-Aufträge aktualisieren (offen/teilweise/voll verrechnet)
    await refreshOrdersInvoiceStatus(supabase, sourceOrders.map((o) => o.id));
    toast("Rechnung wurde erstellt.");
    await goToInvoicesTab();
  }

  if (loading) return <div className="pt-4"><Spinner /></div>;
  if (!p) return (
    <div className="pt-4">
      <button onClick={() => nav("/projekte")} className="btn-ghost mb-4 px-2"><ArrowLeft size={18} /> Zurück</button>
      <Empty title="Projekt nicht gefunden" />
    </div>
  );

  return (
    <div className="pt-2">
      <button onClick={() => nav("/projekte")} className="btn-ghost mb-3 px-2">
        <ArrowLeft size={18} /> Projekte
      </button>

      {/* ── Kopf (einheitliche Meta-Zeile) – Projektkontext zentral (auch in den
             Dokumenteditoren identisch, siehe ProjectContextChips) ── */}
      <EntityHeader
        kind="Projekt"
        chips={[
          ...projectContextChips(p, cName(contact)),
          ...(p.reminder_date && !p.reminder_done
            ? [{ value: `⏰ ${dateAt(p.reminder_date)}${p.reminder_text ? ` – ${p.reminder_text}` : ""}`, tone: "amber" as const }]
            : []),
          ...(p.archived ? [{ value: "Archiviert", tone: "red" as const }] : []),
        ] as HeaderChip[]}
        actions={
          <>
            {/* Projektstatus/Workflow: farbiger Button + dezentes Glas-Popover.
                Statusänderung läuft unverändert über changeStage (speichert + loggt). */}
            <StatusSelect value={p.stage} options={cfg.statusLabelsFor(p.category)} onChange={changeStage} />
            {/* Hauptaktion – farbig (btn-primary), identische zentrale Dokument-Erstellen-Logik */}
            <DocumentCreateMenu onCreate={createChainDoc} onCreateGeneric={createGenericDoc} onCreateSub={createSubDoc} label="Dokument erstellen" buttonClassName="btn-primary" />
            <button className="btn-outline" onClick={() => setEditOpen(true)}><Pencil size={15} /> Bearbeiten</button>
            {/* Archivieren/Reaktivieren – archivierter Zustand klar rot, mit Bestätigung + Rechteprüfung */}
            <button
              className={`px-2 transition ${p.archived
                ? "rounded-lg border border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300"
                : "btn-ghost"} ${!canArchive ? "cursor-not-allowed opacity-40" : ""}`}
              title={!canArchive ? "Keine Berechtigung zum Archivieren"
                : p.archived ? "Projekt ist archiviert – klicken zum Reaktivieren" : "Projekt archivieren"}
              disabled={!canArchive}
              onClick={() => canArchive && setArchiveOpen(true)}>
              {p.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)_310px]">
        {/* ── Linke Navigation ── */}
        <nav className="glass h-max p-2">
          <div className="flex gap-1 overflow-x-auto lg:flex-col">
            {SECTIONS_TOP.map((s) => (
              <button key={s.key} onClick={() => setSec(s.key)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${sec === s.key ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
                style={sec === s.key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
                <s.icon size={16} /> {s.label}
              </button>
            ))}

            {/* Dokumente-Gruppe (aufklappbar, dynamische Unterordner) */}
            <button onClick={() => { setDocOpen((o) => !o); setSec("dok_overview"); }}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${sec === "dok_overview" || sec.startsWith("doktype:") ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
              style={sec === "dok_overview" || sec.startsWith("doktype:") ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
              <FolderArchive size={16} /> <span className="flex-1 text-left">Dokumente</span>
              {docOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {docOpen && (
              <div className="space-y-0.5 lg:ml-3 lg:border-l lg:pl-2" style={{ borderColor: "var(--border)" }}>
                {([
                  { key: "dok_overview", label: "Übersicht", n: null as number | null },
                  ...(docCounts.angebote > 0 ? [{ key: "angebote", label: "Angebote", n: docCounts.angebote }] : []),
                  ...(docCounts.auftraege > 0 ? [{ key: "auftraege", label: "Aufträge", n: docCounts.auftraege }] : []),
                  ...(docCounts.rechnungen > 0 ? [{ key: "rechnungen", label: "Rechnungen", n: docCounts.rechnungen }] : []),
                  ...docTypes.filter((t) => !(NATIVE_SLUGS as readonly string[]).includes(t.slug) && (docCounts.byType[t.id] || 0) > 0)
                    .map((t) => ({ key: `doktype:${t.id}`, label: t.name, n: docCounts.byType[t.id] })),
                ]).map((c) => (
                  <button key={c.key} onClick={() => setSec(c.key)}
                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition ${sec === c.key ? "font-semibold text-brand-600 dark:text-brand-300" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"}`}
                    style={sec === c.key ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)" } : undefined}>
                    <span className="min-w-0 flex-1 truncate text-left">{c.label}</span>
                    {c.n != null && <span className="rounded-full bg-slate-200 px-1.5 text-[11px] dark:bg-white/10">{c.n}</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Organisation-Gruppe (aufklappbar) – direkt nach „Dokumente", bündelt projektbezogene organisatorische Funktionen */}
            <button onClick={() => { setOrgOpen((o) => !o); }}
              className="flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5">
              <Building2 size={16} /> <span className="flex-1 text-left">Organisation</span>
              {orgOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {orgOpen && (
              <div className="space-y-0.5 lg:ml-3 lg:border-l lg:pl-2" style={{ borderColor: "var(--border)" }}>
                {SECTIONS_ORGANISATION.map((s) => (
                  <button key={s.key} onClick={() => setSec(s.key)}
                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition ${sec === s.key ? "font-semibold text-brand-600 dark:text-brand-300" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"}`}
                    style={sec === s.key ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)" } : undefined}>
                    <s.icon size={15} /> <span className="min-w-0 flex-1 truncate text-left">{s.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Leistung & Abrechnung: noch nicht gebaut → als „in Vorbereitung" ausgegraut/deaktiviert (kein Funktions-Schein). */}
            {SECTIONS_LEISTUNG.map((s) => (
              <button key={s.key} type="button" disabled title="In Vorbereitung – Funktion folgt"
                className="flex cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-slate-400 opacity-60 dark:text-slate-500">
                <s.icon size={16} /> <span className="flex-1 text-left">{s.label}</span>
                <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-400">in Vorbereitung</span>
              </button>
            ))}

            {/* Abschluss-Bereiche: noch nicht gebaut → als „in Vorbereitung" ausgegraut/deaktiviert. */}
            {SECTIONS_ABSCHLUSS.map((s) => (
              <button key={s.key} type="button" disabled title="In Vorbereitung – Funktion folgt"
                className="flex cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-slate-400 opacity-60 dark:text-slate-500">
                <s.icon size={16} /> <span className="flex-1 text-left">{s.label}</span>
                <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-400">in Vorbereitung</span>
              </button>
            ))}
          </div>
        </nav>

        {/* ── Hauptbereich ── */}
        <main className="min-w-0">
          {sec === "logbuch"       && <Logbuch projectId={p.id} />}
          {sec === "bilder"        && <ProjectMediaGallery projectId={p.id} uploadedBy={session?.user?.id ?? null} />}
          {(sec === "dok_overview" || sec.startsWith("doktype:")) && (
            <ProjectDocuments
              projectId={p.id}
              customerId={p.contact_id ?? null}
              types={docTypes}
              names={docNames}
              filterTypeId={sec.startsWith("doktype:") ? sec.slice("doktype:".length) : null}
              onCreated={loadDocMeta}
              onCreate={createChainDoc}
              onCreateGeneric={createGenericDoc}
              onCreateSub={createSubDoc}
            />
          )}
          {sec === "angebote"      && (
            <Angebote
              projectId={p.id}
              onCreate={createOffer}
              onCreateOrderCore={createOrderCore}
            />
          )}
          {sec === "auftraege"     && (
            <Auftraege
              key={`auf-${docRefresh}`}
              projectId={p.id}
              onCreate={createOrder}
              onCreateOrderCore={createOrderCore}
              onCreateInvoiceCore={createInvoiceCore}
              onChanged={loadDocMeta}
            />
          )}
          {sec === "rechnungen"    && <Rechnungen key={`rng-${docRefresh}`} projectId={p.id} onCreateInvoiceCore={createInvoiceCore} />}
          {sec === "regiestunden"  && <Empty title="Regiestunden" hint="Regiestunden-Erfassung und Berichte – in Vorbereitung." />}
          {sec === "zeitlohn"      && <Empty title="Zeit & Lohn" hint="Zeiterfassung und Lohnauswertung je Projekt – in Vorbereitung." />}
          {sec === "material"      && <Empty title="Material" hint="Materialbedarf, Bestellungen, Lagerbestand – in Vorbereitung." />}
          {sec === "belege"        && <Empty title="Belege" hint="Eingangsrechnungen, Lieferscheine und Belege – in Vorbereitung." />}
          {sec === "aufgaben"      && <Aufgaben projectId={p.id} />}
          {sec === "baubesprechungen" && <ProjectMeetings projectId={p.id} />}
          {sec === "unterschriften"   && <ProjectSignatures projectId={p.id} />}
          {sec === "termine"       && <Termine projectId={p.id} />}
          {sec === "beteiligte"    && <Beteiligte projectId={p.id} contact={contact} persons={persons} />}
          {sec === "checklisten"   && <Checklisten projectId={p.id} />}
          {sec === "notizen"       && (
            <div className="glass p-4">
              <h3 className="mb-3 font-bold">Interne Projektnotiz</h3>
              <textarea className="input min-h-[200px]" value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Dauerhafte interne Informationen – erscheinen nicht in Angeboten/Rechnungen." />
              <div className="mt-3 flex justify-end">
                <button className="btn-primary" disabled={noteSaving} onClick={saveNote}>
                  {noteSaving ? "Speichern …" : "Notiz speichern"}
                </button>
              </div>
            </div>
          )}
          {sec === "sollist"       && <Empty title="Soll/Ist-Vergleich" hint="Budgetkontrolle und Abweichungsanalyse – in Vorbereitung." />}
          {sec === "abschluss"     && <Empty title="Projektabschluss" hint="Abschlussdokumentation, Übergabe und Archivierung – in Vorbereitung." />}
        </main>

        {/* ── Rechte Seitenleiste ── */}
        <aside className="space-y-4">
          <div className="glass p-4">
            <h3 className="mb-2 text-sm font-bold">Notizen</h3>
            <textarea className="input min-h-[90px] text-sm" value={note}
              onChange={(e) => setNote(e.target.value)} placeholder="Interne Notiz …" />
            <div className="mt-2 flex justify-end">
              <button className="btn-outline px-3 py-1.5 text-sm" disabled={noteSaving} onClick={saveNote}>
                {noteSaving ? "…" : "Speichern"}
              </button>
            </div>
          </div>
          <ProjectAppointments projectId={p.id} heroProjektnummer={p.project_number ?? null} />
          <div className="glass p-4">
            <h3 className="mb-2 text-sm font-bold">Projektdaten</h3>
            <Dl rows={[
              ["Betreff", p.title], ["Nummer", p.project_number ?? "–"], ["Typ", p.category ?? "–"],
              ["Status", p.stage], ["Auftragsvolumen netto", orderVolume ? eur(orderVolume) : "–"],
              ["Mitarbeiter", p.responsible ?? "–"], ["Erstellt", dateAt(p.created_at)],
              ["Letzte Änderung", dateAt(p.updated_at ?? p.created_at)],
            ]} />
          </div>
          <div className="glass p-4">
            <h3 className="mb-2 text-sm font-bold">Kundenprojekt</h3>
            {contact ? (
              <Dl rows={[
                ["Kunde", cName(contact)], ["E-Mail", contact.email ?? "–"],
                ["Rechnungs-Mail", contact.invoice_email ?? "–"],
                ["Telefon", contact.phone ?? contact.mobile ?? "–"],
                ["Adresse", formatAddressInline(contact) || "–"],
              ]} />
            ) : <p className="text-sm text-slate-400">Kein Kunde verknüpft.</p>}
          </div>
        </aside>
      </div>

      {editOpen && (
        <ProjectForm project={p} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); load(); }} />
      )}

      <ConfirmDialog
        open={archiveOpen}
        title={p.archived ? "Projekt reaktivieren?" : "Projekt archivieren?"}
        message={p.archived
          ? <>Das Projekt <b>{p.title}</b> wird wieder zu den aktiven Projekten hinzugefügt.</>
          : <>Das Projekt <b>{p.title}</b> wird aus den aktiven Projekten ausgeblendet und kann über den Filter „Archiviert" jederzeit wieder angezeigt und reaktiviert werden.</>}
        confirmLabel={p.archived ? "Reaktivieren" : "Archivieren"}
        busy={archiveBusy}
        onConfirm={toggleArchive}
        onClose={() => setArchiveOpen(false)}
      />


      {subPickOrders && subPickOrders.length > 0 && (
        <SubOrderCreateModal
          orders={subPickOrders}
          projectId={p.id}
          variant={subVariant}
          createdBy={session?.user.id ?? null}
          onClose={() => { setSubPickOrders(null); setSubVariant(null); }}
          onCreated={() => { setSubPickOrders(null); setSubVariant(null); loadDocMeta(); }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Shared helpers
────────────────────────────────────────────────────────────── */
// DateStack (Datum oben, Uhrzeit darunter) ist jetzt zentral in components/ui.tsx.

// Kommende Termine dieses Projekts – EINE Karte, die Einzeltermine (Planung)
// UND die nächsten Vorkommen aus Terminserien (appointments) gemeinsam zeigt.
type UpcomingItem = { id: string; title: string; start: string; timed: boolean; recurring: boolean };
function ProjectAppointments({ projectId, heroProjektnummer }: { projectId: string; heroProjektnummer: string | null }) {
  const [items, setItems] = useState<UpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(); to.setMonth(to.getMonth() + 12);
    let alive = true;
    (async () => {
      setLoading(true);
      const [evs, appts] = await Promise.all([
        loadEvents(from.toISOString(), to.toISOString(), { projectId }).catch(() => [] as EventWithLinks[]),
        heroProjektnummer
          ? fetchAppointments({ from, to, heroProjektnummer }).then((rows) => materializeOccurrences(rows, from, to)).catch(() => [] as Appointment[])
          : Promise.resolve([] as Appointment[]),
      ]);
      if (!alive) return;
      const merged: UpcomingItem[] = [
        ...evs.map((e) => ({ id: `pe-${e.id}`, title: e.title || "Termin", start: e.start_at, timed: true, recurring: false })),
        ...appts
          .filter((a) => new Date(a.end_datetime).getTime() >= from.getTime())
          .map((a) => ({ id: `ap-${a.id}`, title: a.title || "Termin", start: a.start_datetime, timed: !a.all_day, recurring: !!(a.is_recurring || a.recurrence_parent_id) })),
      ].sort((x, y) => x.start.localeCompare(y.start));
      setItems(merged);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [projectId, heroProjektnummer]);
  return (
    <div className="glass p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold">Kommende Termine</h3>
        <Link to={`/planung?project=${projectId}&new=1`} className="text-xs font-medium text-[var(--accent)] hover:underline">+ Termin</Link>
      </div>
      {loading ? <p className="text-sm text-slate-400">Lädt …</p> : items.length === 0 ? (
        <p className="text-sm text-slate-400">Keine geplanten Termine.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.slice(0, 6).map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
              <span className="flex-1 truncate">{e.title}</span>
              {e.recurring && <Repeat size={11} className="shrink-0 text-slate-400" />}
              <span className="shrink-0 text-xs text-slate-400">{dateAt(e.start)}{e.timed ? `, ${timeAt(e.start)}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   StatusSelect – farbiger Status-Button + dezentes Glas-Popover
   Ersetzt das native <select> (das den Listenhintergrund einfärbte).
   Der Button bleibt farbig (stageTone), das aufgeklappte Menü ist ruhig
   im App-Glas-Stil mit dezenten Tone-Punkten. Auswahl ruft onChange
   (= changeStage) → Statuslogik/Logbuch unverändert. Per Portal an <body>,
   damit es nicht im .glass-Kopf (backdrop-filter) eingeklemmt wird.
────────────────────────────────────────────────────────────── */
function StatusSelect({ value, options, onChange }: {
  value: string; options: readonly string[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    place();
    const onDown = (e: MouseEvent) => { if (!btnRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)} title={`Projektstatus: ${value}`}
        className={`inline-flex w-auto cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-semibold outline-none transition focus:ring-2 focus:ring-[var(--accent)] ${TONES[stageTone(value)]}`}>
        <span className="truncate">{value}</span>
        <ChevronDown size={14} className="shrink-0 opacity-70" />
      </button>
      {open && pos && createPortal(
        <div className="glass fixed z-[120] max-h-[60vh] overflow-y-auto p-1 shadow-xl"
          style={{ top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 210), borderColor: "var(--border)" }}>
          {options.map((s) => {
            const active = s === value;
            return (
              <button key={s} type="button"
                onClick={() => { setOpen(false); if (s !== value) onChange(s); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-[var(--hover)]"
                style={active ? { background: "var(--hover)" } : undefined}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONES[stageTone(s)]}`} />
                <span className={`min-w-0 flex-1 truncate ${active ? "font-semibold" : ""}`}>{s}</span>
                {active && <CheckCircle2 size={14} className="shrink-0 opacity-70" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

function Dl({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="shrink-0 text-slate-400">{k}</dt>
          <dd className="truncate text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionCard({ title, action, children }: {
  title: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="glass p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>{action}
      </div>
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Logbuch
────────────────────────────────────────────────────────────── */
function Logbuch({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ProjectLogEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string | null>>({}); // auth_user_id -> photo_url
  const [validOffers, setValidOffers] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const [{ data }, { data: profs }, { data: offs }, { data: emps }] = await Promise.all([
      supabase.from("project_log").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,name"),
      // Nur noch vorhandene (nicht gelöschte) Angebote → Logbuch-Links bleiben klickbar/sicher.
      supabase.from("offers").select("id").eq("project_id", projectId),
      // Mitarbeiterfotos für die Autor-Avatare (auth_user_id → photo_url); bei fehlendem
      // Leserecht (RLS) bleibt die Map leer → Avatar fällt sauber auf Initialen zurück.
      supabase.from("employees").select("auth_user_id, photo_url").not("auth_user_id", "is", null),
    ]);
    setItems((data as ProjectLogEntry[]) ?? []);
    const map: Record<string, string> = {};
    (profs ?? []).forEach((pr: any) => { if (pr.id) map[pr.id] = pr.name || ""; });
    setNames(map);
    const ph: Record<string, string | null> = {};
    ((emps as { auth_user_id: string | null; photo_url: string | null }[]) ?? []).forEach((e) => { if (e.auth_user_id) ph[e.auth_user_id] = e.photo_url; });
    setPhotos(ph);
    setValidOffers(new Set(((offs as { id: string }[]) ?? []).map((o) => o.id)));
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    // created_by wird per DB-Default (auth.uid()) gesetzt
    await supabase.from("project_log").insert({ project_id: projectId, kind: "notiz", entry: text.trim() });
    setBusy(false); setText(""); load();
  }
  const creator = (uidv?: string | null) => (uidv && names[uidv] ? names[uidv] : "Ersteller unbekannt");
  const shown = items.filter((i) => {
    // Einträge zu nicht mehr vorhandenen (gelöschten) Angeboten ganz ausblenden
    const oid = (i as any).offer_id;
    if (oid && !validOffers.has(oid)) return false;
    return !q.trim() || (i.entry + " " + (i.kind ?? "")).toLowerCase().includes(q.toLowerCase());
  });
  return (
    <SectionCard title="Logbuch">
      <div className="mb-3 flex gap-2">
        <input className="input" placeholder="Neuer Eintrag …" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn-primary whitespace-nowrap" disabled={busy || !text.trim()} onClick={add}>
          <Plus size={16} /> Eintrag
        </button>
      </div>
      <input className="input mb-3" placeholder="Logbuch durchsuchen …" value={q}
        onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Noch keine Einträge.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => {
            const who = creator((i as any).created_by);
            return (
              <li key={i.id} className="flex gap-3 rounded-xl border p-3 text-sm"
                style={{ borderColor: "var(--border)" }}>
                {/* Größeres Autorenfoto nur im Logbuch (gezielt, nicht global) – Person gut
                    erkennbar; self-start hält es bei langen Einträgen oben bündig. */}
                <Avatar name={who} url={photos[(i as any).created_by]} size={56} title={who} className="self-start" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {i.kind && <Badge tone="slate">{i.kind}</Badge>}
                    <span className="text-xs text-slate-400">{dt(i.created_at)}</span>
                  </div>
                  {(i as any).offer_id ? (
                    <Link to={`/angebote/${(i as any).offer_id}`} className="mt-1 block whitespace-pre-wrap font-medium hover:underline" style={{ color: "var(--accent)" }}>{i.entry}</Link>
                  ) : (
                    <div className="mt-1 whitespace-pre-wrap">{i.entry}</div>
                  )}
                  <div className="mt-1 text-xs text-slate-400">Erstellt von: {who}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────────
   Angebote (Phase 3: mit Positions-Auswahl-Picker + beauftragt-Badge)
────────────────────────────────────────────────────────────── */
function Angebote({
  projectId, onCreate, onCreateOrderCore,
}: {
  projectId: string;
  onCreate: () => void;
  onCreateOrderCore: (p: CreateOrderCoreParams) => void;
}) {
  const nav = useNavigate();
  const [items, setItems] = useState<Offer[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [usedOfferIds, setUsedOfferIds] = useState<Set<string>>(new Set());
  const [pickerOffer, setPickerOffer] = useState<Offer | null>(null);
  const [multiOfferModal, setMultiOfferModal] = useState(false);
  const [offerTypes, setOfferTypes] = useState<OfferType[]>([]);
  const [mergePick, setMergePick] = useState<{ offers: Offer[]; targetOfferTypeId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verMap, setVerMap] = useState<Map<string, number>>(new Map());
  const typeOf = (id: string | null | undefined) => offerTypes.find((t) => t.id === id) ?? null;
  const { session } = useAuth();

  const offerSort = useTableSort<Offer>(
    "project_offers",
    {
      number: { get: (o) => o.number, type: "text" },
      title: { get: (o) => o.title, type: "text" },
      status: { get: (o) => OFFER_STATUS_LABEL[o.status as keyof typeof OFFER_STATUS_LABEL] ?? o.status, type: "text" },
      net: { get: (o) => o.net, type: "number" },
      created: { get: (o) => o.created_at, type: "date" },
      closed: { get: (o) => (o as any).closed_at, type: "date" },
      sent: { get: (o) => (o as any).sent_at, type: "date" },
      createdBy: { get: (o) => (o.created_by ? names[o.created_by] : null), type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "created", dir: "desc" } }
  );

  async function load() {
    const [{ data: offerData }, { data: orderData }, { data: profs }, ots] = await Promise.all([
      supabase.from("offers").select("*").eq("project_id", projectId)
        .neq("kind", "nachtrag")
        .order("created_at", { ascending: false }),
      supabase.from("orders").select("offer_ids").eq("project_id", projectId)
        .is("deleted_at", null).neq("status", "storniert"),
      supabase.from("profiles").select("id,name"),
      loadOfferTypes(false).catch(() => [] as OfferType[]),
    ]);
    setOfferTypes(ots as OfferType[]);
    const offerRows = (offerData as Offer[]) ?? [];
    setItems(offerRows);
    loadVersionMap(offerRows.map((o) => o.id)).then(setVerMap).catch(() => {});
    const m: Record<string, string> = {};
    (profs ?? []).forEach((pr: any) => { if (pr.id) m[pr.id] = pr.name || ""; });
    setNames(m);
    const used = new Set<string>();
    for (const o of orderData ?? []) {
      for (const oid of (o.offer_ids ?? [])) used.add(oid as string);
    }
    setUsedOfferIds(used);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);

  async function handlePickerConfirm(offer: Offer, selectedIds: string[]) {
    setBusy(true);
    await onCreateOrderCore({
      sourceOffers: [offer],
      itemFilter: new Map([[offer.id, selectedIds]]),
    });
    setBusy(false);
    setPickerOffer(null);
  }

  async function handleMultiConfirm(selectedOffers: Offer[], mode: ChainMode, targetOfferTypeId: string | null) {
    setMultiOfferModal(false);
    if (mode === "merge") {
      // Gemeinsamer Auftrag: erst Einzel-Positionen über alle gewählten Angebote auswählen.
      setMergePick({ offers: selectedOffers, targetOfferTypeId });
      return;
    }
    setBusy(true);
    await onCreateOrderCore({ sourceOffers: selectedOffers, mode, targetOfferTypeId });
    setBusy(false);
  }

  // Positionsauswahl bestätigt → gemeinsamen Auftrag mit gewählten Positionen erstellen.
  async function handleMergePositions(itemFilter: ItemFilter) {
    if (!mergePick) return;
    setBusy(true);
    await onCreateOrderCore({ sourceOffers: mergePick.offers, mode: "merge", targetOfferTypeId: mergePick.targetOfferTypeId, itemFilter });
    setBusy(false);
    setMergePick(null);
  }

  return (
    <SectionCard title="Angebote" action={
      <div className="flex flex-wrap gap-2">
        <button className="btn-outline text-sm" disabled={items.length < 2}
          title={items.length < 2 ? "Mindestens 2 Angebote benötigt" : "Mehrere Angebote zu einem Auftrag (gemeinsam oder je Angebot einzeln)"}
          onClick={() => setMultiOfferModal(true)}>
          <FileStack size={14} /> Mehrere → Auftrag
        </button>
        <button className="btn-primary" onClick={onCreate}><Plus size={16} /> Angebot</button>
      </div>
    }>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Noch keine Angebote.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nummer" sortKey="number" sort={offerSort.sort} onSort={offerSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Betreff" sortKey="title" sort={offerSort.sort} onSort={offerSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Status" sortKey="status" sort={offerSort.sort} onSort={offerSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Netto" sortKey="net" sort={offerSort.sort} onSort={offerSort.onSort} align="right" padClass="px-3 py-2" />
                <SortHeader label="Erstellt" sortKey="created" sort={offerSort.sort} onSort={offerSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Abgeschl." sortKey="closed" sort={offerSort.sort} onSort={offerSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Versendet" sortKey="sent" sort={offerSort.sort} onSort={offerSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Erstellt von" sortKey="createdBy" sort={offerSort.sort} onSort={offerSort.onSort} padClass="px-3 py-2" />
                <th className="px-3 py-2 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {offerSort.sortRows(items).map((o) => {
                const st = o.status as keyof typeof OFFER_STATUS_LABEL;
                return (
                  <tr key={o.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                    onClick={() => nav(docPath("offer", o.id, o.number))}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {o.number || <span className="italic text-slate-400">Entwurf</span>}
                      {verMap.get(o.id) ? <span className="ml-1.5 rounded bg-[var(--hover)] px-1 text-[10px] font-semibold text-slate-500" title={`Aktuelle Version: V${verMap.get(o.id)}`}>V{verMap.get(o.id)}</span> : null}
                    </td>
                    <td className="px-3 py-2 max-w-[160px]"><div className="truncate font-medium">{o.title || "–"}</div></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={OFFER_STATUS_TONE[st] ?? "slate"}>{OFFER_STATUS_LABEL[st] ?? o.status}</Badge>
                        <Badge tone={variantTone(typeOf(o.offer_type_id))}>{variantLabel("angebot", typeOf(o.offer_type_id))}</Badge>
                        {usedOfferIds.has(o.id) && <Badge tone="amber">beauftragt</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold">{o.net ? eur(o.net) : "–"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500"><DateStack d={o.created_at} /></td>
                    <td className="px-3 py-2 text-xs text-slate-500"><DateStack d={o.closed_at} /></td>
                    <td className="px-3 py-2 text-xs text-slate-500"><DateStack d={o.sent_at} /></td>
                    <td className="px-3 py-2 text-xs text-slate-500">{o.created_by ? (names[o.created_by] || "–") : "–"}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const conv = canConvertOffer(o as any);
                        return (
                          <button className="btn-outline whitespace-nowrap px-2 py-1 text-xs disabled:opacity-40"
                            title={conv.ok ? "Positionen auswählen und Auftrag erstellen" : "Erst abschließen"}
                            disabled={busy || !conv.ok}
                            onClick={() => conv.ok && setPickerOffer(o)}>
                            <ClipboardList size={13} /> → Auftrag
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pickerOffer && (
        <OfferPositionPicker
          offer={pickerOffer}
          projectId={projectId}
          onConfirm={(ids) => handlePickerConfirm(pickerOffer, ids)}
          onClose={() => setPickerOffer(null)}
        />
      )}

      {/* Mehrfachauswahl direkt im Angebote-Reiter (auch wenn es noch keinen Auftrag gibt) */}
      {multiOfferModal && (
        <MultiOfferPicker
          offers={items}
          usedOfferIds={usedOfferIds}
          onConfirm={handleMultiConfirm}
          onClose={() => setMultiOfferModal(false)}
        />
      )}

      {/* Positionsauswahl über alle gewählten Angebote → gemeinsamer Auftrag */}
      {mergePick && (
        <SelectOfferPositionsModal
          offers={mergePick.offers}
          busy={busy}
          onConfirm={handleMergePositions}
          onClose={() => setMergePick(null)}
        />
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────────
   Aufträge (Phase 3: Übersicht + Multi-Angebot + Positions-Picker)
────────────────────────────────────────────────────────────── */
function Auftraege({
  projectId, onCreate, onCreateOrderCore, onCreateInvoiceCore, onChanged,
}: {
  projectId: string;
  onCreate: () => void;
  onCreateOrderCore: (p: CreateOrderCoreParams) => void;
  onCreateInvoiceCore: (p: CreateInvoiceCoreParams) => void;
  onChanged?: () => void;   // meldet der Projektseite, dass sich Aufträge geändert haben (Zähler neu laden)
}) {
  const nav = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [singleOfferModal, setSingleOfferModal] = useState(false);
  const [multiOfferModal, setMultiOfferModal] = useState(false);
  const [pickerOffer, setPickerOffer] = useState<Offer | null>(null);
  // Nach „Mehrere Angebote → gemeinsamer Auftrag": Positionsauswahl über alle gewählten Angebote.
  const [mergePick, setMergePick] = useState<{ offers: Offer[]; targetOfferTypeId: string | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Order | null>(null);   // Archivieren erst nach Bestätigung
  const [showArchived, setShowArchived] = useState(false);                  // archivierte Aufträge einblenden
  const [orderTypes, setOrderTypes] = useState<OfferType[]>([]);            // Varianten (für Badge wie bei Angeboten)
  const [invoices, setInvoices] = useState<any[]>([]);                      // für offene Mengen / Überverrechnungsschutz
  const [invoicePick, setInvoicePick] = useState<string[] | null>(null);    // offen = Rechnungs-Picker (Vorauswahl-IDs)
  const [delTarget, setDelTarget] = useState<Order | null>(null);           // Entwurf löschen (nur Entwürfe)
  const [subPickOrder, setSubPickOrder] = useState<Order | null>(null);     // Subunternehmer beauftragen aus diesem Auftrag
  const [subOrders, setSubOrders] = useState<any[]>([]);                    // SUB-Vergaben des Projekts
  const [busy, setBusy] = useState(false);
  const { session } = useAuth();
  const typeOf = (id: string | null | undefined) => orderTypes.find((t) => t.id === id) ?? null;

  async function load() {
    const [{ data: orderData }, { data: offerData }, ots, { data: invData }, { data: subData }] = await Promise.all([
      supabase.from("orders").select("*").eq("project_id", projectId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("offers").select("*").eq("project_id", projectId)
        .neq("kind", "nachtrag")
        .order("created_at", { ascending: false }),
      loadOfferTypes(false).catch(() => [] as OfferType[]),
      supabase.from("invoices").select("*").eq("project_id", projectId),
      supabase.from("sub_orders").select("id,sub_number,status,net,order_id,subcontractor:contacts(company,first_name,last_name)").eq("project_id", projectId).order("created_at", { ascending: false }),
    ]);
    setOrders((orderData as Order[]) ?? []);
    setOffers((offerData as Offer[]) ?? []);
    setOrderTypes(ots as OfferType[]);
    setInvoices((invData as any[]) ?? []);
    setSubOrders((subData as any[]) ?? []);
  }

  // Bereits verrechnete Menge je Auftragsposition (wie im Rechnungen-Tab) – Schutz vor Überverrechnung.
  const invoicedByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of invoices) {
      if (inv.doc_status === "storniert" || inv.storno_of) continue;
      for (const it of (Array.isArray(inv.items) ? inv.items : [])) {
        const sid = it?.source_order_item_id;
        if (sid) m.set(sid, (m.get(sid) || 0) + (Number(it.qty) || 0));
      }
    }
    return m;
  }, [invoices]);

  // Abrechenbare Aufträge: keine Entwürfe (erst beauftragen), keine stornierten/archivierten.
  const billableOrders = orders.filter((o) => !isDraftOrder(o) && o.status !== "storniert" && o.status !== "archiviert");

  async function confirmDeleteOrder() {
    if (!delTarget) return;
    setBusy(true);
    const { error } = await softDeleteDocument("order", delTarget.id, session?.user.id ?? null);
    setBusy(false);
    if (error) { window.alert(error); return; }
    setDelTarget(null);
    await load();
    onChanged?.();
  }

  async function handleInvoiceConfirm(selectedOrders: any[], mode: ChainMode, itemFilter: ItemFilter | undefined, qtyFilter: Map<string, Map<string, number>> | undefined, targetType: string | null) {
    setBusy(true);
    await onCreateInvoiceCore({ sourceOrders: selectedOrders, itemFilter, qtyFilter, mode, targetOfferTypeId: targetType });
    setBusy(false);
    setInvoicePick(null);
  }

  // Status eines SUB-Auftrags ändern (z. B. Entwurf → Freigegeben). Versand braucht E-Mail-Zugang.
  async function setSubStatus(s: any, status: string) {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    await supabase.from("sub_orders").update(patch).eq("id", s.id);
    if (projectId) await logProject(projectId, "auftrag", `Auftrag-SUB ${s.sub_number || ""}: Status → ${status}.`);
    await load();
  }
  async function openSubPdf(id: string) {
    const r = await openSubOrderPdf(id);
    if (r.error) toastError(r.error);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);

  // Derived: which offer IDs are already in an active order
  const usedOfferIds = new Set<string>(
    orders
      .filter((o) => o.status !== "storniert")
      .flatMap((o) => (o.offer_ids as string[] | null) ?? [])
  );


  function openAmountText(o: Order): { text: string; warn: boolean } {
    const g = Number(o.net || 0);   // führende Summe der App ist Netto
    if (o.invoice_status === "voll_verrechnet") return { text: eur(0), warn: false };
    if (o.invoice_status === "storniert" || o.status === "storniert") return { text: "–", warn: false };
    if (o.invoice_status === "teilw_verrechnet") return { text: "Teilweise", warn: true };
    return { text: eur(g), warn: g > 0 };
  }

  async function archiveOrder(o: Order) {
    setBusy(true);
    await supabase.from("orders").update({ status: "archiviert", updated_at: new Date().toISOString() }).eq("id", o.id);
    await logProject(projectId, "auftrag", `Auftrag ${o.order_number || o.id} archiviert`);
    await load();
    onChanged?.();   // Eltern-Zähler (Sidebar-Badge „Aufträge") sofort aktualisieren
    setBusy(false);
    setArchiveTarget(null);
  }

  // Versehentlich archivierten Auftrag wieder aktiv setzen (Status zurück auf „beauftragt").
  async function reactivateOrder(o: Order) {
    setBusy(true);
    await supabase.from("orders").update({ status: "beauftragt", updated_at: new Date().toISOString() }).eq("id", o.id);
    await logProject(projectId, "auftrag", `Auftrag ${o.order_number || o.id} reaktiviert`);
    await load();
    onChanged?.();
    setBusy(false);
  }

  async function handleFullOffer(offer: Offer) {
    setBusy(true);
    setSingleOfferModal(false);
    await onCreateOrderCore({ sourceOffers: [offer] });
    setBusy(false);
  }

  function handlePickPositions(offer: Offer) {
    setSingleOfferModal(false);
    setPickerOffer(offer);
  }

  async function handlePositionPickerConfirm(offer: Offer, selectedIds: string[]) {
    setBusy(true);
    await onCreateOrderCore({
      sourceOffers: [offer],
      itemFilter: new Map([[offer.id, selectedIds]]),
    });
    setBusy(false);
    setPickerOffer(null);
  }

  async function handleMultiConfirm(selectedOffers: Offer[], mode: ChainMode, targetOfferTypeId: string | null) {
    setMultiOfferModal(false);
    if (mode === "merge") {
      // Gemeinsamer Auftrag: erst Einzel-Positionen über alle gewählten Angebote auswählen.
      setMergePick({ offers: selectedOffers, targetOfferTypeId });
      return;
    }
    setBusy(true);
    await onCreateOrderCore({ sourceOffers: selectedOffers, mode, targetOfferTypeId });
    setBusy(false);
  }

  // Positionsauswahl bestätigt → gemeinsamen Auftrag mit gewählten Positionen erstellen.
  async function handleMergePositions(itemFilter: ItemFilter) {
    if (!mergePick) return;
    setBusy(true);
    await onCreateOrderCore({ sourceOffers: mergePick.offers, mode: "merge", targetOfferTypeId: mergePick.targetOfferTypeId, itemFilter });
    setBusy(false);
    setMergePick(null);
  }

  const active = orders.filter((o) => o.status !== "archiviert");
  const archived = orders.filter((o) => o.status === "archiviert");

  const orderSort = useTableSort<Order>(
    "project_orders",
    {
      number: { get: (o) => o.order_number, type: "text" },
      title: { get: (o) => o.title, type: "text" },
      status: { get: (o) => ORDER_STATUS_LABEL[o.status] ?? o.status, type: "text" },
      net: { get: (o) => o.net, type: "number" },
      // „Offen netto": voll verrechnet = 0, storniert = leer (ans Ende); Teil-
      // verrechnung hat keinen exakten Betrag → Zwischenwert für stabile Ordnung.
      open: {
        get: (o) => {
          if (o.invoice_status === "voll_verrechnet") return 0;
          if (o.invoice_status === "storniert" || o.status === "storniert") return null;
          if (o.invoice_status === "teilw_verrechnet") return Number(o.net || 0) / 2;
          return Number(o.net || 0);
        },
        type: "number",
      },
      created: { get: (o) => o.created_at, type: "date" },
      invStatus: { get: (o) => ORDER_INVOICE_STATUS_LABEL[o.invoice_status] ?? o.invoice_status, type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "created", dir: "desc" } }
  );
  const sumNet = active.reduce((a, o) => a + Number(o.net || 0), 0);
  const sumOpen = active
    .filter((o) => o.invoice_status !== "voll_verrechnet" && o.invoice_status !== "storniert" && o.status !== "storniert")
    .reduce((a, o) => a + Number(o.net || 0), 0);

  return (
    <SectionCard title="Aufträge" action={
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-outline text-sm"
          onClick={() => setMultiOfferModal(true)}
          disabled={offers.length < 2}
          title={offers.length < 2 ? "Mindestens 2 Angebote benötigt" : "Mehrere Angebote zu einem Auftrag zusammenführen"}>
          <FileStack size={14} /> Mehrere Angebote
        </button>
        <button
          className="btn-outline text-sm"
          onClick={() => setSingleOfferModal(true)}
          disabled={offers.length === 0}
          title="Auftrag aus einem Angebot erstellen">
          <FileText size={14} /> Aus Angebot
        </button>
        <button
          className="btn-outline text-sm"
          onClick={() => setInvoicePick([])}
          disabled={billableOrders.length === 0}
          title={billableOrders.length === 0 ? "Keine abrechenbaren Aufträge" : "Aus einem oder mehreren Aufträgen eine Rechnung erstellen"}>
          <Receipt size={14} /> Mehrere → Rechnung
        </button>
        <button className="btn-primary" onClick={onCreate}>
          <Plus size={16} /> Neuer Auftrag
        </button>
      </div>
    }>

      {/* ── Übersichts-Kacheln ── */}
      {active.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)" }}>
            <div className="text-2xl font-bold">{active.length}</div>
            <div className="text-xs text-slate-400">Aufträge</div>
          </div>
          <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)" }}>
            <div className="text-xl font-bold tabular-nums">{eur(sumNet)}</div>
            <div className="text-xs text-slate-400">Auftragssumme netto</div>
          </div>
          <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)" }}>
            <div className={`text-xl font-bold tabular-nums ${sumOpen > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600"}`}>
              {eur(sumOpen)}
            </div>
            <div className="text-xs text-slate-400">Noch offen netto</div>
          </div>
        </div>
      )}

      {active.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">
          Noch keine Aufträge. Erstelle einen neuen oder importiere aus einem Angebot.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nummer" sortKey="number" sort={orderSort.sort} onSort={orderSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Betreff" sortKey="title" sort={orderSort.sort} onSort={orderSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Status" sortKey="status" sort={orderSort.sort} onSort={orderSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Netto" sortKey="net" sort={orderSort.sort} onSort={orderSort.onSort} align="right" padClass="px-3 py-2" />
                <SortHeader label="Offen netto" sortKey="open" sort={orderSort.sort} onSort={orderSort.onSort} align="right" padClass="px-3 py-2" />
                <SortHeader label="Erstellt" sortKey="created" sort={orderSort.sort} onSort={orderSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="RG-Status" sortKey="invStatus" sort={orderSort.sort} onSort={orderSort.onSort} padClass="px-3 py-2" />
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {orderSort.sortRows(active).map((o) => {
                const openAmt = openAmountText(o);
                return (
                  <tr key={o.id}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                    onClick={() => nav(docPath("order", o.id, o.order_number))}>
                    <td className="px-3 py-2 font-mono text-xs">{o.order_number || "–"}</td>
                    <td className="px-3 py-2 max-w-[160px]">
                      <div className="truncate font-medium">{o.title || "Auftrag"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={orderStatusTone(o.status)}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Badge>
                        <Badge tone={variantTone(typeOf(o.offer_type_id))}>{variantLabel("auftrag", typeOf(o.offer_type_id))}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold">{o.net ? eur(o.net) : "–"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      <span className={openAmt.warn ? "text-amber-600 dark:text-amber-400 font-medium" : "text-slate-400"}>
                        {openAmt.text}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500"><DateStack d={o.created_at} /></td>
                    <td className="px-3 py-2">
                      <Badge tone="slate">
                        {ORDER_INVOICE_STATUS_LABEL[o.invoice_status] ?? o.invoice_status ?? "–"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost px-1.5" title="Öffnen / Bearbeiten"
                          onClick={() => nav(docPath("order", o.id, o.order_number))}>
                          <Eye size={14} />
                        </button>
                        <button className="btn-ghost px-1.5" title="Subunternehmer beauftragen"
                          disabled={isDraftOrder(o) || o.status === "storniert"}
                          onClick={() => setSubPickOrder(o)}>
                          <HardHat size={14} />
                        </button>
                        <button
                          className="btn-outline whitespace-nowrap px-2 py-1 text-xs"
                          title={isDraftOrder(o) ? "Auftrag zuerst beauftragen" : "Rechnung aus diesem Auftrag erstellen"}
                          disabled={o.invoice_status === "voll_verrechnet" || o.status === "storniert" || isDraftOrder(o)}
                          onClick={() => setInvoicePick([o.id])}>
                          <Receipt size={12} /> Rechnung
                        </button>
                        {isDeletable("order", o) ? (
                          <button className="btn-ghost px-1.5 text-rose-500" title="Entwurf löschen"
                            onClick={() => setDelTarget(o)}>
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <button className="btn-ghost px-1.5 text-amber-500" title="Archivieren"
                            onClick={() => setArchiveTarget(o)} disabled={o.status === "archiviert"}>
                            <Archive size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Archivierte Aufträge: einblendbar + reaktivierbar ── */}
      {archived.length > 0 && (
        <div className="mt-4">
          <button className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-[var(--accent)]"
            onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {archived.length} archivierte{archived.length === 1 ? "r Auftrag" : " Aufträge"} {showArchived ? "ausblenden" : "anzeigen"}
          </button>
          {showArchived && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border dark:divide-white/5" style={{ borderColor: "var(--border)" }}>
              {archived.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-slate-400">{o.order_number || "–"}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-500">{o.title || "Auftrag"}</span>
                  <span className="shrink-0 tabular-nums text-xs text-slate-400">{eur(o.net)}</span>
                  <Badge tone="slate">archiviert</Badge>
                  <button className="btn-outline whitespace-nowrap px-2 py-1 text-xs" disabled={busy}
                    title="Auftrag wieder aktiv setzen" onClick={() => reactivateOrder(o)}>
                    <ArchiveRestore size={13} /> Reaktivieren
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Modal: Aus einzelnem Angebot ── */}
      <Modal open={singleOfferModal} onClose={() => setSingleOfferModal(false)}
        title="Aus Angebot erstellen">
        <p className="mb-4 text-sm text-slate-400">
          Wähle ein Angebot — komplett oder nur ausgewählte Positionen übernehmen.
        </p>
        {offers.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">Keine Angebote vorhanden.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {offers.map((of_) => (
              <li key={of_.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{of_.number || of_.title || "Angebot"}</span>
                    {usedOfferIds.has(of_.id) && (
                      <Badge tone="amber">bereits beauftragt</Badge>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    {dateAt(of_.created_at)} · {eur(of_.net || 0)} netto
                    · {Array.isArray(of_.items) ? of_.items.length : 0} Positionen
                  </div>
                </div>
                <Badge tone="slate">{of_.status ?? "entwurf"}</Badge>
                <div className="flex gap-1.5">
                  <button className="btn-outline whitespace-nowrap px-2 py-1 text-xs"
                    disabled={busy}
                    title="Positionen einzeln auswählen"
                    onClick={() => handlePickPositions(of_)}>
                    Auswählen
                  </button>
                  <button className="btn-primary whitespace-nowrap px-2 py-1 text-xs"
                    disabled={busy}
                    title="Alle Positionen übernehmen"
                    onClick={() => handleFullOffer(of_)}>
                    Ganz
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <button className="btn-outline" onClick={() => setSingleOfferModal(false)}>Schließen</button>
        </div>
      </Modal>

      {/* ── Modal: Mehrere Angebote ── */}
      {multiOfferModal && (
        <MultiOfferPicker
          offers={offers}
          usedOfferIds={usedOfferIds}
          onConfirm={handleMultiConfirm}
          onClose={() => setMultiOfferModal(false)}
        />
      )}

      {/* ── Modal: Positions-Picker ── */}
      {pickerOffer && (
        <OfferPositionPicker
          offer={pickerOffer}
          projectId={projectId}
          onConfirm={(ids) => handlePositionPickerConfirm(pickerOffer, ids)}
          onClose={() => setPickerOffer(null)}
        />
      )}

      {/* ── Positionsauswahl über alle gewählten Angebote → gemeinsamer Auftrag ── */}
      {mergePick && (
        <SelectOfferPositionsModal
          offers={mergePick.offers}
          busy={busy}
          onConfirm={handleMergePositions}
          onClose={() => setMergePick(null)}
        />
      )}

      {/* ── Bestätigung vor dem Archivieren eines Auftrags ── */}
      <ConfirmDialog
        open={!!archiveTarget}
        title="Auftrag archivieren?"
        confirmLabel="Archivieren"
        message={<>Der Auftrag <b>{archiveTarget?.order_number || archiveTarget?.title || "ohne Nummer"}</b> wird aus der aktiven Auftragsliste entfernt (archiviert). Wirklich fortfahren?</>}
        busy={busy}
        onConfirm={() => { if (archiveTarget) archiveOrder(archiveTarget); }}
        onClose={() => setArchiveTarget(null)}
      />

      {/* ── Bestätigung: Auftragsentwurf löschen (nur Entwürfe) ── */}
      <ConfirmDialog
        open={!!delTarget}
        title="Entwurf löschen?"
        confirmLabel="Entwurf löschen"
        message={<><b>{delTarget?.order_number || delTarget?.title || "Auftrag"}</b>: {DELETE_CONFIRM_TEXT}</>}
        busy={busy}
        onConfirm={confirmDeleteOrder}
        onClose={() => setDelTarget(null)}
      />

      {/* ── Rechnung aus Auftrag/Aufträgen (zentraler Picker, in-Kontext) ── */}
      {invoicePick && (
        <MultiOrderPicker
          orders={billableOrders}
          invoicedByItem={invoicedByItem}
          preselectIds={invoicePick}
          onConfirm={handleInvoiceConfirm}
          onClose={() => setInvoicePick(null)}
        />
      )}

      {/* ── Subunternehmer-Vergaben (SUB) ── */}
      {subOrders.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><HardHat size={13} /> Subunternehmer-Vergaben</div>
          <ul className="divide-y divide-slate-100 rounded-xl border dark:divide-white/5" style={{ borderColor: "var(--border)" }}>
            {subOrders.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-slate-400">{s.sub_number || "–"}</span>
                <span className="min-w-0 flex-1 truncate">{s.subcontractor?.company || [s.subcontractor?.first_name, s.subcontractor?.last_name].filter(Boolean).join(" ") || "Subunternehmer"}</span>
                <Badge tone="slate">{s.status}</Badge>
                <span className="shrink-0 tabular-nums text-xs text-slate-500">{eur(s.net)}</span>
                <button className="btn-ghost px-1.5" title="Öffnen / Bearbeiten"
                  onClick={() => nav(`/auftraege-sub/${s.sub_number ? encodeURIComponent(s.sub_number) : s.id}`)}>
                  <Pencil size={14} />
                </button>
                <button className="btn-ghost px-1.5" title="PDF / Vorschau" onClick={() => openSubPdf(s.id)}>
                  <FileText size={14} />
                </button>
                {s.status === "entwurf" && (
                  <button className="btn-ghost px-1.5 text-[var(--accent)]" title="Freigeben" onClick={() => setSubStatus(s, "freigegeben")}>
                    <CheckCircle2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Modal: Subunternehmer beauftragen ── */}
      {subPickOrder && (
        <SubOrderCreateModal
          orders={[subPickOrder]}
          projectId={projectId}
          createdBy={session?.user.id ?? null}
          onClose={() => setSubPickOrder(null)}
          onCreated={() => { setSubPickOrder(null); load(); onChanged?.(); }}
        />
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────────
   Rechnungen (Phase 4: vollständige Rechnungs-Engine)
────────────────────────────────────────────────────────────── */
function Rechnungen({ projectId, onCreateInvoiceCore }: {
  projectId: string;
  onCreateInvoiceCore: (p: CreateInvoiceCoreParams) => void;
}) {
  const nav = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [orderModal, setOrderModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const { session } = useAuth();

  async function load() {
    const [{ data: inv }, { data: ord }] = await Promise.all([
      supabase.from("invoices").select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      // volle Auftragsdaten (items/offer_type_id) für Mehrfachauswahl + Positionsauswahl
      supabase.from("orders").select("*")
        .eq("project_id", projectId).is("deleted_at", null).neq("status", "storniert").neq("status", "archiviert"),
    ]);
    setItems(inv ?? []);
    setOrders(ord ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);

  // Bereits verrechnete Menge je Auftragsposition (positionId == source_order_item_id der
  // Rechnungspositionen). Stornierte Rechnungen + Storno-Belege zählen NICHT → Restmenge
  // wird automatisch wieder frei. Basis für „offene Menge" + Schutz vor Überverrechnung.
  const invoicedByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of items) {
      if (inv.doc_status === "storniert" || inv.storno_of) continue;
      for (const it of (Array.isArray(inv.items) ? inv.items : [])) {
        const sid = it?.source_order_item_id;
        if (sid) m.set(sid, (m.get(sid) || 0) + (Number(it.qty) || 0));
      }
    }
    return m;
  }, [items]);

  async function handleConfirm(selectedOrders: any[], mode: ChainMode, itemFilter: ItemFilter | undefined, qtyFilter: Map<string, Map<string, number>> | undefined, targetType: string | null) {
    setBusy(true);
    await onCreateInvoiceCore({ sourceOrders: selectedOrders, itemFilter, qtyFilter, mode, targetOfferTypeId: targetType });
    setBusy(false);
    setOrderModal(false);
  }

  function statusTone(inv: any): "slate" | "blue" | "green" | "amber" | "red" {
    if (inv.doc_status === "storniert") return "red";
    if (!inv.locked) return "slate";
    if (inv.payment_status === "bezahlt") return "green";
    if (inv.due_date && new Date(inv.due_date) < new Date()) return "red";
    return "blue";
  }
  function statusLabel(inv: any): string {
    if (inv.doc_status === "storniert") return "Storniert";
    if (!inv.locked) return "Entwurf";
    if (inv.payment_status === "bezahlt") return "Bezahlt";
    if (inv.due_date && new Date(inv.due_date) < new Date()) return "Überfällig";
    return "Finalisiert";
  }

  const sumFinalized = items
    .filter((i) => i.doc_status === "finalisiert" && !i.storno_of)
    .reduce((s, i) => s + Number(i.gross || 0), 0);

  const invSort = useTableSort<any>(
    "project_invoices",
    {
      number: { get: (r) => r.number, type: "text" },
      date: { get: (r) => r.invoice_date ?? r.created_at, type: "date" },
      gross: { get: (r) => r.gross, type: "number" },
      due: { get: (r) => r.due_date, type: "date" },
      status: { get: (r) => statusLabel(r), type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "date", dir: "desc" } }
  );

  return (
    <SectionCard title="Rechnungen" action={
      <div className="flex flex-wrap gap-2">
        <button className="btn-outline text-sm"
          onClick={() => setOrderModal(true)}
          disabled={orders.length === 0 || busy}
          title="Rechnung aus einem oder mehreren Aufträgen erstellen">
          <FileText size={14} /> Aus Auftrag/Aufträgen
        </button>
        <button className="btn-primary"
          onClick={() => nav(`/rechnungen/new?projectId=${projectId}`)}>
          <Plus size={16} /> Freie Rechnung
        </button>
      </div>
    }>
      {items.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)" }}>
            <div className="text-2xl font-bold">{items.length}</div>
            <div className="text-xs text-slate-400">Rechnungen</div>
          </div>
          <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)" }}>
            <div className="text-lg font-bold tabular-nums">{eur(sumFinalized)}</div>
            <div className="text-xs text-slate-400">Verrechnet brutto</div>
          </div>
          <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)" }}>
            <div className="text-lg font-bold tabular-nums">
              {items.filter((i) => !i.locked && i.doc_status !== "storniert").length}
            </div>
            <div className="text-xs text-slate-400">Entwürfe</div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">
          Noch keine Rechnungen. Erstelle eine freie Rechnung oder aus einem Auftrag.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="RE-Nummer" sortKey="number" sort={invSort.sort} onSort={invSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Datum" sortKey="date" sort={invSort.sort} onSort={invSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Brutto" sortKey="gross" sort={invSort.sort} onSort={invSort.onSort} align="right" padClass="px-3 py-2" />
                <SortHeader label="Fällig" sortKey="due" sort={invSort.sort} onSort={invSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Status" sortKey="status" sort={invSort.sort} onSort={invSort.onSort} padClass="px-3 py-2" />
                <th className="px-3 py-2 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {invSort.sortRows(items).map((r) => (
                <tr key={r.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => nav(docPath("invoice", r.id, r.number))}>
                  <td className="px-3 py-2 font-mono text-xs font-semibold">
                    {r.number || <span className="italic text-slate-400">Entwurf</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{dateAt(r.invoice_date ?? r.created_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold">{r.gross ? eur(r.gross) : "–"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.due_date ? dateAt(r.due_date) : "–"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(r)}>{statusLabel(r)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <button className="btn-ghost px-2" title="Öffnen"
                      onClick={() => nav(docPath("invoice", r.id, r.number))}>
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal: Aus Auftrag/Aufträgen (gemeinsam/getrennt + Positionsauswahl) ── */}
      {orderModal && (
        <MultiOrderPicker
          orders={orders}
          invoicedByItem={invoicedByItem}
          onConfirm={handleConfirm}
          onClose={() => setOrderModal(false)}
        />
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────────
   MultiOrderPicker
   Mehrere Aufträge auswählen → gemeinsame Rechnung ODER je Auftrag
   eine Rechnung. Optional je Auftrag Positionen wählen. Zielvariante
   bei gemischten Varianten (nur gemeinsame Rechnung).
────────────────────────────────────────────────────────────── */
function MultiOrderPicker({
  orders, invoicedByItem, onConfirm, onClose, preselectIds = [],
}: {
  orders: any[];
  invoicedByItem: Map<string, number>;
  onConfirm: (selectedOrders: any[], mode: ChainMode, itemFilter: ItemFilter | undefined, qtyFilter: Map<string, Map<string, number>> | undefined, targetType: string | null) => void;
  onClose: () => void;
  preselectIds?: string[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preselectIds));
  const [mode, setMode] = useState<ChainMode>("merge");
  const [types, setTypes] = useState<OfferType[]>([]);
  const [targetType, setTargetType] = useState<string>("");
  // Positionsauswahl je Auftrag: orderId → Set(selektierte Positions-IDs). Fehlt = alle.
  const [posSel, setPosSel] = useState<Map<string, Set<string>>>(new Map());
  // Teilmengen je Auftrag: orderId → (positionId → abzurechnende Menge). Fehlt = offene Menge.
  const [posQty, setPosQty] = useState<Map<string, Map<string, number>>>(new Map());
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { loadOfferTypes(true).then(setTypes).catch(() => setTypes([])); }, []);

  // Verrechnungsstatus: voll/überverrechnete Aufträge dürfen nicht erneut (voll) abgerechnet werden.
  const isFullyInvoiced = (o: any) => o.invoice_status === "voll_verrechnet" || o.invoice_status === "ueberverrechnet";
  const invTone = (s?: string): "slate" | "amber" | "green" | "red" =>
    s === "voll_verrechnet" ? "green" : s === "teilw_verrechnet" ? "amber" : s === "ueberverrechnet" ? "red" : "slate";

  const toggle = (id: string) => {
    const o = orders.find((x) => x.id === id);
    if (o && isFullyInvoiced(o)) return; // gesperrt – Schutz vor Doppelverrechnung
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // kaufmännische Positionen eines Auftrags (aus JSONB; leer = keine granulare Auswahl)
  type Pos = { id: string; name: string; number: string; qty: number; unit: string; price: number; disc: number; vat: number };
  const orderPositions = (o: any): Pos[] => {
    const raw = Array.isArray(o.items) ? o.items : [];
    return raw
      .filter((p: any) => p?.type === "article" || p?.type === "service" || p?.type === "free")
      .map((p: any) => ({
        id: p.id, name: p.name || "–", number: p.number || "",
        qty: Number(p.qty) || 0, unit: p.unit || "Stk", price: Number(p.unit_price) || 0,
        disc: Number(p.discount_percent) || 0, vat: Number(p.vat_rate) || 20,
      }));
  };

  // Offene (noch nicht verrechnete) Menge einer Position.
  const openOf = (pos: Pos) => Math.max(0, Math.round((pos.qty - (invoicedByItem.get(pos.id) || 0)) * 1000) / 1000);
  // Ist eine Position ausgewählt? (kein Eintrag = Default „alle offenen ausgewählt")
  const isPosSelected = (orderId: string, posId: string) => {
    const sel = posSel.get(orderId);
    return sel ? sel.has(posId) : true;
  };
  // Abzurechnende Menge (Default = offene Menge), gekappt auf [0, offen].
  const qtyOf = (orderId: string, pos: Pos) => {
    const open = openOf(pos);
    const v = posQty.get(orderId)?.get(pos.id);
    return v != null ? Math.min(Math.max(0, v), open) : open;
  };

  const togglePos = (orderId: string, posId: string, openIds: string[]) => {
    setPosSel((prev) => {
      const next = new Map(prev);
      const cur = new Set(next.get(orderId) ?? openIds); // Default: alle offenen ausgewählt
      if (cur.has(posId)) cur.delete(posId); else cur.add(posId);
      next.set(orderId, cur);
      return next;
    });
  };
  const setQty = (orderId: string, posId: string, v: number) => {
    setPosQty((prev) => {
      const next = new Map(prev);
      const cur = new Map(next.get(orderId) ?? new Map<string, number>());
      cur.set(posId, v);
      next.set(orderId, cur);
      return next;
    });
  };

  const selected = orders.filter((o) => selectedIds.has(o.id));
  const variantConflict = mode === "merge" && hasVariantConflict(selected as any);
  const needsTarget = variantConflict && !targetType;

  // Summen für die Vorschau – nur offene, ausgewählte Positionen mit ihrer Teilmenge.
  const sums = (() => {
    let net = 0, vat = 0, count = 0;
    for (const o of selected) {
      for (const pos of orderPositions(o)) {
        if (openOf(pos) <= 0) continue;
        if (!isPosSelected(o.id, pos.id)) continue;
        const q = qtyOf(o.id, pos);
        if (q <= 0) continue;
        const ln = q * pos.price * (1 - pos.disc / 100);
        net += ln; vat += ln * pos.vat / 100; count += 1;
      }
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return { net: r2(net), vat: r2(vat), gross: r2(net + vat), count };
  })();

  // Erzeugt itemFilter (welche Positionen) + qtyFilter (welche Menge je Position).
  // Bereits vollständig verrechnete Positionen (offen ≤ 0) werden nie übernommen → keine Überverrechnung.
  function buildFilters(): { itemFilter: ItemFilter | undefined; qtyFilter: Map<string, Map<string, number>> | undefined } {
    const itemFilter: ItemFilter = new Map();
    const qtyFilter: Map<string, Map<string, number>> = new Map();
    let any = false;
    for (const o of selected) {
      const ids: string[] = [];
      const qmap = new Map<string, number>();
      for (const pos of orderPositions(o)) {
        if (openOf(pos) <= 0) continue;
        if (!isPosSelected(o.id, pos.id)) continue;
        const q = qtyOf(o.id, pos);
        if (q <= 0) continue;
        ids.push(pos.id);
        qmap.set(pos.id, q);
      }
      itemFilter.set(o.id, ids);
      if (qmap.size) qtyFilter.set(o.id, qmap);
      any = true;
    }
    return { itemFilter: any ? itemFilter : undefined, qtyFilter: any ? qtyFilter : undefined };
  }

  const canCreate = selected.length > 0 && !needsTarget && sums.count > 0;

  const header = (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Aufträge wählen, optional einzelne Positionen — dann gemeinsame Rechnung
        oder je Auftrag eine eigene Rechnung.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMode("merge")}
          className={`rounded-xl border px-3 py-2 text-left text-sm transition ${mode === "merge" ? "border-transparent text-white" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
          style={mode === "merge" ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : { borderColor: "var(--border)" }}>
          <div className="font-semibold">Gemeinsame Rechnung</div>
          <div className={`text-xs ${mode === "merge" ? "text-white/80" : "text-slate-400"}`}>Alle Aufträge in einer Rechnung</div>
        </button>
        <button type="button" onClick={() => setMode("perSource")}
          className={`rounded-xl border px-3 py-2 text-left text-sm transition ${mode === "perSource" ? "border-transparent text-white" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
          style={mode === "perSource" ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : { borderColor: "var(--border)" }}>
          <div className="font-semibold">Je Auftrag eine Rechnung</div>
          <div className={`text-xs ${mode === "perSource" ? "text-white/80" : "text-slate-400"}`}>Pro Auftrag eine eigene Rechnung</div>
        </button>
      </div>
      {variantConflict && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="mb-1 flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle size={15} /> Unterschiedliche Varianten — bitte Zielvariante wählen:
          </div>
          <select className="input w-full" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
            <option value="">– Zielvariante (Rechnung) wählen –</option>
            {types.map((t) => <option key={t.id} value={t.id}>{variantLabel("rechnung", t)}</option>)}
          </select>
        </div>
      )}
    </div>
  );

  const list = (
      orders.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Keine aktiven Aufträge vorhanden.</p>
      ) : (
        <ul className="divide-y divide-slate-100 px-3 dark:divide-white/5">
          {orders.map((o) => {
            const isSel = selectedIds.has(o.id);
            const positions = orderPositions(o);
            const openIds = positions.filter((p) => openOf(p) > 0).map((p) => p.id);
            const selCount = positions.filter((p) => openOf(p) > 0 && isPosSelected(o.id, p.id)).length;
            const locked = isFullyInvoiced(o);
            return (
              <li key={o.id} className="py-2">
                <div className={`flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors ${locked ? "cursor-not-allowed opacity-55" : "cursor-pointer"} ${isSel ? "bg-brand-50 dark:bg-brand-500/10" : !locked ? "hover:bg-slate-50 dark:hover:bg-white/3" : ""}`}
                  onClick={() => toggle(o.id)}>
                  <input type="checkbox" checked={isSel} disabled={locked} onChange={() => toggle(o.id)}
                    onClick={(e) => e.stopPropagation()} className="h-4 w-4 shrink-0 disabled:cursor-not-allowed" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{o.order_number || "Auftrag"}</div>
                    <div className="text-xs text-slate-400">
                      {o.title || "–"} · {eur(o.net || 0)} netto
                      {positions.length > 0 && ` · ${selCount}/${positions.length} Positionen`}
                    </div>
                  </div>
                  {o.invoice_status && o.invoice_status !== "offen" && (
                    <Badge tone={invTone(o.invoice_status)}>{ORDER_INVOICE_STATUS_LABEL[o.invoice_status] ?? o.invoice_status}</Badge>
                  )}
                  <Badge tone="slate">{o.status}</Badge>
                  {!locked && isSel && positions.length > 0 && (
                    <button className="btn-ghost px-2 text-xs" onClick={(e) => { e.stopPropagation(); setExpanded(expanded === o.id ? null : o.id); }}>
                      {expanded === o.id ? "Positionen ▲" : "Positionen ▼"}
                    </button>
                  )}
                </div>
                {isSel && expanded === o.id && positions.length > 0 && (
                  <div className="ml-7 mt-1 rounded-lg border p-2 text-xs" style={{ borderColor: "var(--border)" }}>
                    <div className="mb-1 flex gap-2">
                      <button className="btn-outline px-2 py-0.5" onClick={() => setPosSel((m) => new Map(m).set(o.id, new Set(openIds)))}>Alle offenen</button>
                      <button className="btn-outline px-2 py-0.5" onClick={() => setPosSel((m) => new Map(m).set(o.id, new Set()))}>Keine</button>
                    </div>
                    {positions.map((pos) => {
                      const open = openOf(pos);
                      const invoiced = invoicedByItem.get(pos.id) || 0;
                      const fully = open <= 0;
                      const checked = !fully && isPosSelected(o.id, pos.id);
                      return (
                        <div key={pos.id} className={`flex flex-wrap items-center gap-2 py-1 ${fully ? "opacity-50" : ""}`}>
                          <input type="checkbox" checked={checked} disabled={fully}
                            onChange={() => togglePos(o.id, pos.id, openIds)} onClick={(e) => e.stopPropagation()} />
                          <span className="font-mono text-slate-400">{pos.number}</span>
                          <span className="min-w-0 flex-1 truncate">{pos.name}</span>
                          {fully ? (
                            <span className="text-emerald-600 dark:text-emerald-400">vollständig verrechnet</span>
                          ) : (
                            <span className="flex items-center gap-1.5 tabular-nums text-slate-400">
                              {invoiced > 0 && <span title="bereits verrechnet">verr. {invoiced}</span>}
                              <span title="offene Menge">offen {open} {pos.unit}</span>
                              <input type="number" min={0} max={open} step="any"
                                className="input w-20 px-2 py-1 text-right text-xs"
                                value={qtyOf(o.id, pos)} disabled={!checked}
                                onChange={(e) => setQty(o.id, pos.id, Number(e.target.value))}
                                onClick={(e) => e.stopPropagation()} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )
  );

  const previewCol = (
    <>
      <PreviewCard title="Vorschau">
        <div>Ziel: {mode === "merge" ? "eine gemeinsame Rechnung" : `${selected.length} einzelne Rechnungen`}</div>
        <div>Ausgewählt: {selected.length} Auftrag{selected.length !== 1 ? "/Aufträge" : ""}</div>
        {selected.length > 0 && <div className="break-words">Aufträge: {summarizeNumbers(selected.map((o) => o.order_number))}</div>}
        <div>Übernommene Positionen: {sums.count}</div>
        {variantConflict && targetType && (
          <div className="text-amber-600 dark:text-amber-400">Zielvariante: {variantLabel("rechnung", types.find((t) => t.id === targetType))}</div>
        )}
        <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 tabular-nums">
          <span className="text-slate-400">Netto {eur(sums.net)}</span>
          <span className="text-slate-400">MwSt. {eur(sums.vat)}</span>
          <span className="font-semibold">Brutto {eur(sums.gross)}</span>
        </div>
      </PreviewCard>
      {needsTarget && <PreviewNote>Bitte Zielvariante (Rechnung) wählen.</PreviewNote>}
      {selected.length === 0 && <PreviewNote>Noch keine Auswahl – bitte mindestens einen Auftrag wählen.</PreviewNote>}
      {selected.length > 0 && sums.count === 0 && <PreviewNote>Keine offenen Positionen zum Abrechnen in der Auswahl.</PreviewNote>}
    </>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <button className="btn-outline" onClick={onClose}>Zurück</button>
      <button className="btn-primary" disabled={!canCreate}
        title={!canCreate
          ? (selected.length === 0 ? "Mindestens 1 Auftrag wählen" : needsTarget ? "Zielvariante wählen" : "Keine offenen Positionen zum Abrechnen")
          : undefined}
        onClick={() => { const f = buildFilters(); onConfirm(selected, mode, f.itemFilter, f.qtyFilter, mode === "merge" ? (targetType || null) : null); }}>
        {mode === "merge" ? "Rechnung erstellen" : `${selected.length} Rechnungen erstellen`}
      </button>
    </div>
  );

  return (
    <SourceSelectLayout title="Rechnung aus Auftrag/Aufträgen" onClose={onClose}
      header={header} listLabel="Aufträge wählen" list={list} preview={previewCol} footer={footer} />
  );
}

/* ──────────────────────────────────────────────────────────────
   Aufgaben
────────────────────────────────────────────────────────────── */
function Aufgaben({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [prio, setPrio] = useState("Normal");
  async function load() {
    const { data } = await supabase.from("tasks").select("*").eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setItems(data ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);
  async function add() {
    if (!title.trim()) return;
    await supabase.from("tasks").insert({
      project_id: projectId, title: title.trim(), due_date: due || null, priority: prio, done: false,
    });
    await logProject(projectId, "aufgabe", `Aufgabe erstellt: ${title.trim()}`);
    setTitle(""); setDue(""); load();
  }
  async function toggle(t: any) {
    await supabase.from("tasks").update({ done: !t.done }).eq("id", t.id);
    await logProject(projectId, "aufgabe",
      `${!t.done ? "Aufgabe erledigt" : "Aufgabe wieder offen"}: ${t.title}`);
    load();
  }
  return (
    <SectionCard title="Aufgaben">
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input className="input" placeholder="Aufgabentitel …" value={title}
          onChange={(e) => setTitle(e.target.value)} />
        <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        <select className="input" value={prio} onChange={(e) => setPrio(e.target.value)}>
          {PROJECT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn-primary whitespace-nowrap" disabled={!title.trim()} onClick={add}>
          <Plus size={16} /> Aufgabe
        </button>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Noch keine Aufgaben.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-white/5">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <input type="checkbox" checked={!!t.done} onChange={() => toggle(t)} className="h-4 w-4" />
              <div className={`min-w-0 flex-1 ${t.done ? "text-slate-400 line-through" : ""}`}>{t.title}</div>
              {t.priority && (
                <Badge tone={t.priority === "Dringend" || t.priority === "Hoch" ? "amber" : "slate"}>
                  {t.priority}
                </Badge>
              )}
              <span className="text-xs text-slate-400">{t.due_date ? dateAt(t.due_date) : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────────
   Termine
────────────────────────────────────────────────────────────── */
function Termine({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ProjectAppointment[]>([]);
  const [f, setF] = useState({
    title: "", kind: APPOINTMENT_KINDS[0] as string,
    date: "", time: "", location: "", description: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function load() {
    const { data } = await supabase.from("project_appointments").select("*")
      .eq("project_id", projectId).order("date", { ascending: true });
    setItems((data as ProjectAppointment[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);
  async function add() {
    if (!f.title.trim() || !f.date) return;
    await supabase.from("project_appointments").insert({
      project_id: projectId, title: f.title.trim(), kind: f.kind, date: f.date,
      time: f.time || null, location: f.location || null,
      description: f.description || null, status: "geplant",
    });
    await logProject(projectId, "termin", `Termin erstellt: ${f.title.trim()} (${dateAt(f.date)})`);
    setF({ title: "", kind: APPOINTMENT_KINDS[0], date: "", time: "", location: "", description: "" });
    load();
  }
  async function cancel(a: ProjectAppointment) {
    await supabase.from("project_appointments").update({ status: "abgesagt" }).eq("id", a.id); load();
  }
  return (
    <SectionCard title="Termine">
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input className="input" placeholder="Titel …" value={f.title} onChange={(e) => set("title", e.target.value)} />
        <select className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
          {APPOINTMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input type="date" className="input" value={f.date} onChange={(e) => set("date", e.target.value)} />
        <input type="time" className="input" value={f.time} onChange={(e) => set("time", e.target.value)} />
        <input className="input sm:col-span-2" placeholder="Ort" value={f.location}
          onChange={(e) => set("location", e.target.value)} />
        <div className="sm:col-span-2 flex justify-end">
          <button className="btn-primary" disabled={!f.title.trim() || !f.date} onClick={add}>
            <Plus size={16} /> Termin
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Noch keine Termine.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-white/5">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className={`font-medium ${a.status === "abgesagt" ? "text-slate-400 line-through" : ""}`}>
                  {a.title}
                </div>
                <div className="text-xs text-slate-400">
                  {a.kind} · {dateAt(a.date)}{a.time ? ` ${a.time}` : ""}
                  {a.location ? ` · ${a.location}` : ""}
                </div>
              </div>
              {a.status !== "abgesagt" && (
                <button className="btn-ghost px-2 text-rose-500" title="Absagen" onClick={() => cancel(a)}>
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────────
   Projektbeteiligte
────────────────────────────────────────────────────────────── */
function Beteiligte({
  projectId, contact, persons,
}: { projectId: string; contact: Contact | null; persons: ContactPerson[] }) {
  const [items, setItems] = useState<ProjectParticipant[]>([]);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [f, setF] = useState({ role: PARTICIPANT_ROLES[0] as string, contact_id: "", name: "", email: "", phone: "", note: "" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function load() {
    const { data } = await supabase.from("project_participants").select("*")
      .eq("project_id", projectId).order("sort_order");
    setItems((data as ProjectParticipant[]) ?? []);
  }
  useEffect(() => {
    load();
    supabase.from("contacts").select("*").order("contact_number")
      .then(({ data }) => setAllContacts((data as Contact[]) ?? []));
    /* eslint-disable-next-line */
  }, [projectId]);
  function pickContact(cid: string) {
    const c = allContacts.find((x) => x.id === cid);
    setF((p) => ({
      ...p, contact_id: cid,
      name: c ? cName(c) : p.name,
      email: c?.email ?? p.email,
      phone: c?.phone ?? c?.mobile ?? p.phone,
    }));
  }
  async function add() {
    if (!f.role || (!f.contact_id && !f.name.trim())) return;
    await supabase.from("project_participants").insert({
      project_id: projectId, role: f.role,
      contact_id: f.contact_id || null, name: f.name || null,
      email: f.email || null, phone: f.phone || null,
      note: f.note || null, sort_order: items.length,
    });
    await logProject(projectId, "beteiligte",
      `Beteiligter hinzugefügt: ${f.name || cName(allContacts.find((x) => x.id === f.contact_id))} (${f.role})`);
    setF({ role: PARTICIPANT_ROLES[0], contact_id: "", name: "", email: "", phone: "", note: "" });
    load();
  }
  async function remove(x: ProjectParticipant) {
    await supabase.from("project_participants").delete().eq("id", x.id); load();
  }
  return (
    <SectionCard title="Projektbeteiligte">
      {contact && persons.length > 0 && (
        <p className="mb-2 text-xs text-slate-400">
          Ansprechpartner des Kunden: {persons.map((pp) =>
            [pp.first_name, pp.last_name].filter(Boolean).join(" ")
          ).join(", ")}
        </p>
      )}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select className="input" value={f.role} onChange={(e) => set("role", e.target.value)}>
          {PARTICIPANT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="input" value={f.contact_id} onChange={(e) => pickContact(e.target.value)}>
          <option value="">– aus Kontakten wählen (optional) –</option>
          {allContacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.contact_number ? `${c.contact_number} · ` : ""}{cName(c)}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Name / Firma" value={f.name}
          onChange={(e) => set("name", e.target.value)} />
        <input className="input" placeholder="E-Mail" value={f.email}
          onChange={(e) => set("email", e.target.value)} />
        <input className="input" placeholder="Telefon" value={f.phone}
          onChange={(e) => set("phone", e.target.value)} />
        <input className="input" placeholder="Notiz" value={f.note}
          onChange={(e) => set("note", e.target.value)} />
        <div className="sm:col-span-2 flex justify-end">
          <button className="btn-primary"
            disabled={!f.role || (!f.contact_id && !f.name.trim())} onClick={add}>
            <Plus size={16} /> Beteiligten hinzufügen
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Noch keine Beteiligten.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-white/5">
          {items.map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-2">
              <Badge tone="blue">{x.role}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{x.name ?? "–"}</div>
                <div className="text-xs text-slate-400">
                  {[x.email, x.phone].filter(Boolean).join(" · ") || ""}
                </div>
              </div>
              <button className="btn-ghost px-2 text-rose-500" title="Entfernen" onClick={() => remove(x)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────────
   Checklisten
────────────────────────────────────────────────────────────── */
function Checklisten({ projectId }: { projectId: string }) {
  const [lists, setLists] = useState<ProjectChecklist[]>([]);
  const [itemsByList, setItemsByList] = useState<Record<string, ProjectChecklistItem[]>>({});
  const [newName, setNewName] = useState("");
  async function load() {
    const { data: cl } = await supabase.from("project_checklists").select("*")
      .eq("project_id", projectId).order("sort_order");
    const ls = (cl as ProjectChecklist[]) ?? [];
    setLists(ls);
    if (ls.length) {
      const { data: it } = await supabase.from("project_checklist_items").select("*")
        .in("checklist_id", ls.map((l) => l.id)).order("sort_order");
      const map: Record<string, ProjectChecklistItem[]> = {};
      for (const i of ((it as ProjectChecklistItem[]) ?? [])) (map[i.checklist_id] ||= []).push(i);
      setItemsByList(map);
    } else setItemsByList({});
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);
  async function addList() {
    if (!newName.trim()) return;
    await supabase.from("project_checklists").insert({
      project_id: projectId, name: newName.trim(), sort_order: lists.length,
    });
    setNewName(""); load();
  }
  async function delList(l: ProjectChecklist) {
    await supabase.from("project_checklists").delete().eq("id", l.id); load();
  }
  async function addItem(listId: string, label: string) {
    if (!label.trim()) return;
    const n = (itemsByList[listId] ?? []).length;
    await supabase.from("project_checklist_items").insert({
      checklist_id: listId, label: label.trim(), sort_order: n,
    });
    load();
  }
  async function toggleItem(i: ProjectChecklistItem) {
    await supabase.from("project_checklist_items").update({ done: !i.done }).eq("id", i.id); load();
  }
  return (
    <SectionCard title="Checklisten" action={
      <div className="flex items-center gap-2">
        <input className="input w-44" placeholder="Neue Checkliste" value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addList()} />
        <button className="btn-primary whitespace-nowrap" disabled={!newName.trim()} onClick={addList}>
          <Plus size={16} />
        </button>
      </div>
    }>
      {lists.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Noch keine Checklisten.</p>
      ) : (
        <div className="space-y-4">
          {lists.map((l) => {
            const its = itemsByList[l.id] ?? [];
            const done = its.filter((i) => i.done).length;
            return (
              <div key={l.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="font-semibold">
                    {l.name}{" "}
                    <span className="text-xs font-normal text-slate-400">({done}/{its.length})</span>
                  </div>
                  <button className="btn-ghost px-2 text-rose-500" onClick={() => delList(l)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <ul className="mb-2 space-y-1">
                  {its.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={i.done} onChange={() => toggleItem(i)} className="h-4 w-4" />
                      <span className={i.done ? "text-slate-400 line-through" : ""}>{i.label}</span>
                    </li>
                  ))}
                </ul>
                <ItemAdder onAdd={(label) => addItem(l.id, label)} />
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function ItemAdder({ onAdd }: { onAdd: (label: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <input className="input" placeholder="Punkt hinzufügen …" value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onAdd(v); setV(""); } }} />
      <button className="btn-outline whitespace-nowrap" disabled={!v.trim()}
        onClick={() => { onAdd(v); setV(""); }}>
        <Plus size={15} />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PHASE 3 – Neue Komponenten
══════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────
   OfferPositionPicker
   Zeigt alle Positionen eines Angebots mit Checkboxen.
   Bereits in einem aktiven Auftrag enthaltene Positionen werden
   mit Warnung markiert.
────────────────────────────────────────────────────────────── */
function OfferPositionPicker({
  offer, projectId, onConfirm, onClose,
}: {
  offer: Offer;
  projectId: string;
  onConfirm: (selectedIds: string[]) => void;
  onClose: () => void;
}) {
  const items: OfferLine[] = Array.isArray(offer.items) ? offer.items : [];
  const [selected, setSelected] = useState<Set<string>>(
    new Set(items.map((i) => i.id).filter(Boolean))
  );
  const [usedIds, setUsedIds] = useState<Set<string>>(new Set());
  const [loadingUsed, setLoadingUsed] = useState(true);

  useEffect(() => {
    async function checkUsed() {
      const { data: orderData } = await supabase
        .from("orders").select("id")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .neq("status", "storniert");
      if (orderData?.length) {
        const { data: usedData } = await supabase
          .from("order_items").select("source_offer_item_id")
          .in("order_id", orderData.map((o: any) => o.id))
          .eq("source_offer_id", offer.id)
          .not("source_offer_item_id", "is", null);
        const used = new Set<string>((usedData ?? []).map((i: any) => i.source_offer_item_id as string));
        setUsedIds(used);
        // Bereits beauftragte Positionen aus der Vorauswahl entfernen.
        setSelected((prev) => new Set([...prev].filter((id) => !used.has(id))));
      }
      setLoadingUsed(false);
    }
    checkUsed();
  }, [offer.id, projectId]);

  const toggle = (id: string) => {
    if (usedIds.has(id)) return;   // bereits beauftragt → nicht auswählbar
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selItems = items.filter((i) => selected.has(i.id));
  const selNet = selItems.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
  const allIds = items.map((i) => i.id).filter(Boolean);
  const selectableIds = allIds.filter((id) => !usedIds.has(id));
  const allOrdered = !loadingUsed && allIds.length > 0 && selectableIds.length === 0;

  const header = (
    <div className="flex items-center gap-2 text-xs">
      <button className="btn-outline px-2 py-1" disabled={allOrdered}
        onClick={() => setSelected(new Set(selectableIds))}>Alle</button>
      <button className="btn-outline px-2 py-1"
        onClick={() => setSelected(new Set())}>Keine</button>
    </div>
  );

  const previewCol = (
    <>
      <PreviewCard title="Vorschau">
        <div>Ausgewählt: {selected.size} / {selectableIds.length} offen</div>
        <div className="mt-1 font-semibold tabular-nums">Netto {eur(selNet)}</div>
      </PreviewCard>
      {allOrdered && <PreviewNote>Alle Positionen dieses Angebots wurden bereits beauftragt – kein weiterer Auftrag möglich.</PreviewNote>}
      {!allOrdered && selected.size === 0 && <PreviewNote>Bitte mindestens eine Position wählen.</PreviewNote>}
    </>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <button className="btn-outline" onClick={onClose}>Zurück</button>
      <button className="btn-primary" disabled={selected.size === 0}
        onClick={() => onConfirm(Array.from(selected).filter((id) => !usedIds.has(id)))}>
        <ClipboardList size={16} /> {selected.size} Position{selected.size !== 1 ? "en" : ""} übernehmen
      </button>
    </div>
  );

  return (
    <SourceSelectLayout
      title={`Positionen aus ${offer.number ? `Angebot ${offer.number}` : (offer.title || "Angebot")}`}
      onClose={onClose} header={header} listLabel="Positionen" preview={previewCol} footer={footer}
      list={
        <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="w-8 px-2 py-2">
                <input type="checkbox" disabled={allOrdered}
                  checked={selected.size === selectableIds.length && selectableIds.length > 0}
                  onChange={(e) => e.target.checked
                    ? setSelected(new Set(selectableIds))
                    : setSelected(new Set())} />
              </th>
              <th className="px-2 py-2 w-16">Pos.</th>
              <th className="px-2 py-2">Bezeichnung</th>
              <th className="px-2 py-2 text-right">Menge</th>
              <th className="px-2 py-2 text-right">EP netto</th>
              <th className="px-2 py-2 text-right">Gesamt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {items.map((item) => {
              const isUsed = usedIds.has(item.id);
              const isSel = selected.has(item.id);
              return (
                <tr key={item.id}
                  className={`transition-colors ${
                    isUsed
                      ? "cursor-not-allowed bg-amber-50/40 opacity-60 dark:bg-amber-500/5"
                      : `cursor-pointer ${isSel ? "" : "opacity-50"} hover:bg-slate-50 dark:hover:bg-white/3`
                  }`}
                  onClick={() => toggle(item.id)}>
                  <td className="px-2 py-2" onClick={(e) => { e.stopPropagation(); toggle(item.id); }}>
                    <input type="checkbox" checked={isSel} disabled={isUsed} onChange={() => toggle(item.id)} />
                  </td>
                  <td className="px-2 py-2 font-mono">{item.number || "–"}</td>
                  <td className="px-2 py-2 max-w-[160px]">
                    <div className="truncate font-medium">{item.name || "–"}</div>
                    {isUsed && (
                      <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertTriangle size={10} /> bereits beauftragt
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{item.qty} {item.unit}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{eur(item.unit_price || 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">
                    {eur((item.qty || 0) * (item.unit_price || 0))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      }
    />
  );
}

/* ──────────────────────────────────────────────────────────────
   MultiOfferPicker
   Mehrere Angebote auswählen → gemeinsamer Auftrag ODER je Angebot
   ein eigener Auftrag. Bei gemischten Varianten muss für den
   gemeinsamen Auftrag eine Zielvariante gewählt werden.
────────────────────────────────────────────────────────────── */
function MultiOfferPicker({
  offers, usedOfferIds, onConfirm, onClose,
}: {
  offers: Offer[];
  usedOfferIds: Set<string>;
  onConfirm: (selectedOffers: Offer[], mode: ChainMode, targetOfferTypeId: string | null) => void;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ChainMode>("merge");
  const [types, setTypes] = useState<OfferType[]>([]);
  const [targetType, setTargetType] = useState<string>("");

  useEffect(() => { loadOfferTypes(true).then(setTypes).catch(() => setTypes([])); }, []);

  // Nur abgeschlossene/finalisierte Angebote sind fachlich gültig – Entwürfe nie.
  const convertible = (o: Offer) => canConvertOffer(o as any).ok;
  const toggle = (o: Offer) => {
    if (!convertible(o)) return; // Entwürfe sind nicht auswählbar
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
      return next;
    });
  };

  const selected = offers.filter((o) => selectedIds.has(o.id) && convertible(o));
  const hasConflict = selected.some((o) => usedOfferIds.has(o.id));
  const totalGross = selected.reduce((s, o) => s + Number(o.gross || 0), 0);
  const totalNet = selected.reduce((s, o) => s + Number(o.net || 0), 0);
  const totalItems = selected.reduce((s, o) => s + (Array.isArray(o.items) ? o.items.length : 0), 0);

  const contactIds = new Set(selected.map((o) => o.contact_id).filter(Boolean));
  const contactMismatch = contactIds.size > 1;
  // Varianten-Konflikt nur relevant beim gemeinsamen Auftrag
  const variantConflict = mode === "merge" && hasVariantConflict(selected as any);
  const needsTarget = variantConflict && !targetType;

  const canCreate = (mode === "merge" ? selected.length >= 2 : selected.length >= 1) && !needsTarget;

  // Fixer Kopf: Modusumschaltung + (bei Bedarf) Zielvariante
  const header = (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Nur abgeschlossene Angebote können weitergeführt werden – Entwürfe sind ausgegraut.
        Dann entscheiden: ein gemeinsamer Auftrag oder je Angebot ein eigener Auftrag.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMode("merge")}
          className={`rounded-xl border px-3 py-2 text-left text-sm transition ${mode === "merge" ? "border-transparent text-white" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
          style={mode === "merge" ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : { borderColor: "var(--border)" }}>
          <div className="font-semibold">Gemeinsamer Auftrag</div>
          <div className={`text-xs ${mode === "merge" ? "text-white/80" : "text-slate-400"}`}>Alle Angebote in einem Auftrag</div>
        </button>
        <button type="button" onClick={() => setMode("perSource")}
          className={`rounded-xl border px-3 py-2 text-left text-sm transition ${mode === "perSource" ? "border-transparent text-white" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
          style={mode === "perSource" ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : { borderColor: "var(--border)" }}>
          <div className="font-semibold">Je Angebot ein Auftrag</div>
          <div className={`text-xs ${mode === "perSource" ? "text-white/80" : "text-slate-400"}`}>Pro Angebot ein eigener Auftrag</div>
        </button>
      </div>
      {variantConflict && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="mb-1 flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle size={15} /> Unterschiedliche Varianten — bitte Zielvariante (Auftrag) wählen:
          </div>
          <select className="input w-full" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
            <option value="">– Zielvariante (Auftrag) wählen –</option>
            {types.map((t) => <option key={t.id} value={t.id}>{variantLabel("auftrag", t)}</option>)}
          </select>
        </div>
      )}
    </div>
  );

  // Linke Spalte: nur diese scrollt
  const list = (
    <ul className="divide-y divide-slate-100 dark:divide-white/5">
      {offers.map((o) => {
        const canConv = convertible(o);
        const isSel = selectedIds.has(o.id) && canConv;
        const isUsed = usedOfferIds.has(o.id);
        const itemCount = Array.isArray(o.items) ? o.items.length : 0;
        return (
          <li key={o.id}
            className={`flex items-center gap-3 px-3 py-3 transition-colors
              ${!canConv ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              ${isSel ? "bg-brand-50 dark:bg-brand-500/10" : canConv ? "hover:bg-slate-50 dark:hover:bg-white/3" : ""}`}
            onClick={() => toggle(o)}>
            <input type="checkbox" checked={isSel} disabled={!canConv} onChange={() => toggle(o)}
              onClick={(e) => e.stopPropagation()} className="h-4 w-4 shrink-0 disabled:cursor-not-allowed" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{o.number || o.title || "Angebot"}</span>
                {isUsed && <Badge tone="amber">bereits beauftragt</Badge>}
                {!canConv && <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Entwurf – erst abschließen</span>}
              </div>
              <div className="text-xs text-slate-400">
                {dateTimeAt(o.created_at)} · {itemCount} Positionen · {eur(o.net || 0)} netto
              </div>
            </div>
            <Badge tone="slate">{o.status ?? "entwurf"}</Badge>
          </li>
        );
      })}
    </ul>
  );

  // Rechte Spalte: dauerhaft sichtbare Vorschau + Validierung
  const previewCol = (
    <>
      <PreviewCard title="Vorschau">
        <div>Ziel: {mode === "merge" ? "ein gemeinsamer Auftrag" : `${selected.length} einzelne Aufträge`}</div>
        <div>Ausgewählt: {selected.length} Angebot{selected.length !== 1 ? "e" : ""}</div>
        {selected.length > 0 && <div className="break-words">Nummern: {summarizeNumbers(selected.map((o) => o.number))}</div>}
        <div>Positionen gesamt: {totalItems}</div>
        {variantConflict && targetType && (
          <div className="text-amber-600 dark:text-amber-400">Zielvariante: {variantLabel("auftrag", types.find((t) => t.id === targetType))}</div>
        )}
        <div className="mt-2 flex flex-wrap justify-between gap-2 tabular-nums">
          <span className="text-slate-400">Netto {eur(totalNet)}</span>
          <span className="font-semibold">Brutto {eur(totalGross)}</span>
        </div>
      </PreviewCard>
      {contactMismatch && <PreviewNote tone="red">Unterschiedliche Kunden — bitte prüfen.</PreviewNote>}
      {hasConflict && <PreviewNote>Einige gewählte Angebote sind bereits in einem aktiven Auftrag enthalten — Doppelbeauftragung prüfen!</PreviewNote>}
      {needsTarget && <PreviewNote>Bitte Zielvariante (Auftrag) wählen.</PreviewNote>}
      {selected.length === 0 && <PreviewNote>Noch keine gültige Auswahl – bitte abgeschlossene Angebote markieren.</PreviewNote>}
    </>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <button className="btn-outline" onClick={onClose}>Zurück</button>
      <button className="btn-primary" disabled={!canCreate}
        title={!canCreate
          ? (mode === "merge" ? "Mindestens 2 abgeschlossene Angebote auswählen" : needsTarget ? "Zielvariante wählen" : "Mindestens 1 abgeschlossenes Angebot auswählen")
          : undefined}
        onClick={() => onConfirm(selected, mode, mode === "merge" ? (targetType || null) : null)}>
        {mode === "merge" ? "Gemeinsamen Auftrag erstellen" : `${selected.length} Aufträge erstellen`}
      </button>
    </div>
  );

  return (
    <SourceSelectLayout title="Auftrag aus mehreren Angeboten" onClose={onClose}
      header={header} listLabel="Angebote wählen" list={list} preview={previewCol} footer={footer} />
  );
}
