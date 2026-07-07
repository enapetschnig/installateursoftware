// ============================================================
// B4Y SuperAPP – Zentrale Dokumentenübersicht (/dokumente)
// Eine projektübergreifende Übersicht ALLER Dokumente (Angebote, Aufträge,
// Rechnungen, Uploads, kundenspezifische Typen). Server-seitige Pagination,
// Suche, Filterung & Sortierung über die View documents_unified.
// Dokumenttypen dynamisch aus den Einstellungen, mandantenfähig, RBAC-geprüft.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Files, Search, SlidersHorizontal, MoreVertical,
  Archive, ArchiveRestore, Trash2, ArrowRightCircle, Download, X, ExternalLink, Sparkles,
} from "lucide-react";
import { SortHeader } from "../components/SortHeader";
import { aiAsk, loadAiSettings, aiModuleEnabled } from "../lib/ai";
import { Badge, Empty, Spinner, Modal } from "../components/ui";
import { ConfirmDialog, ErrorBanner } from "../components/calc-ui";
import { useAuth } from "../lib/auth";
import { usePermissions } from "../lib/permissions";
import { eur, dateAt, dateTimeAt } from "../lib/format";
import {
  UnifiedDoc, QueryParams, DocFilters, QuickFilter, SortKey,
  queryDocuments, fetchForExport, rowsToCsv,
  loadDocTypeOptions, loadVariantOptions, loadEditorOptions, loadCustomerOptions, loadProjectOptions,
  DocTypeOption, VariantOption, EditorOption, CustomerOption, ProjectOption,
  statusLabel, statusTone, STATUS_LABEL, editorRoute, setArchived,
  KIND_MODULE, docRouteById, projectRoute,
} from "../lib/documents-overview";
import {
  createOrderFromOffers, createOrdersPerOffer, createInvoiceFromOrders, createInvoicesPerOrder,
} from "../lib/document-chain";
import DocumentCreateMenu, { ChainKind, DocumentCreateOpts } from "../components/document/DocumentCreateMenu";
import SubOrderCreateModal from "../components/document/SubOrderCreateModal";
import { VoiceAngebotPrestepModal, type VoiceAngebotPrestepResult } from "../components/voice/VoiceAngebotPrestepModal";
import { OfferType } from "../lib/offer-kinds";
import { DocumentType } from "../lib/documents";
import {
  createOfferDraft, createOrderDraft, createNachtragDraft, invoiceNewRoute, createGenericDocument, DraftResult,
} from "../lib/document-create";
import { deleteDraftDocument, DELETE_CONFIRM_TEXT } from "../lib/document-delete";
import { supabase } from "../lib/supabase";

const CHAIN_SLUGS = ["angebote", "auftraege", "rechnungen"];

const QUICK_CHIPS: { key: QuickFilter; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "entwuerfe", label: "Entwürfe" },
  { key: "abgeschlossen", label: "Abgeschlossen" },
  { key: "versendet", label: "Versendet" },
  { key: "rechnungen_offen", label: "Rechnungen offen" },
  { key: "dieses_jahr", label: "Dieses Jahr" },
  { key: "letzte_30", label: "Letzte 30 Tage" },
  { key: "archiviert", label: "Archiviert" },
];

const PAGE_SIZES = [25, 50, 100];

type Col = { key: SortKey; label: string; align?: "right"; cls?: string };
const COLS: Col[] = [
  { key: "doc_number", label: "Nummer" },
  { key: "type_name", label: "Typ" },
  { key: "variant_name", label: "Variante" },
  { key: "status_norm", label: "Status" },
  { key: "customer_name", label: "Kunde" },
  { key: "project_number", label: "Projekt" },
  { key: "object_address", label: "Adresse / Objekt" },
  { key: "title", label: "Betreff" },
  { key: "doc_date", label: "Datum" },
  { key: "net", label: "Netto", align: "right" },
  { key: "gross", label: "Brutto", align: "right" },
  { key: "editor_name", label: "Bearbeiter" },
  { key: "last_change", label: "Letzte Änderung" },
];

export default function Documents() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { session } = useAuth();
  const { can, isAdmin } = usePermissions();
  const uid = session?.user.id ?? null;

  // ── Filter-/Query-State (Init aus URL) ──
  const [searchInput, setSearchInput] = useState(sp.get("q") ?? "");
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [quick, setQuick] = useState<QuickFilter>((sp.get("quick") as QuickFilter) || "alle");
  const [filters, setFilters] = useState<DocFilters>({
    typeSlug: sp.get("typ") || null,
    archived: "active",
    canceled: "all",
  });
  const [sortBy, setSortBy] = useState<SortKey>("last_change");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [showFilters, setShowFilters] = useState(false);

  // ── Daten ──
  const [rows, setRows] = useState<UnifiedDoc[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ── Optionen ──
  const [types, setTypes] = useState<DocTypeOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [editors, setEditors] = useState<EditorOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  // ── Auswahl & Aktionen ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<UnifiedDoc | null>(null);
  // Erstellen ohne festen Projektkontext: Typen, die ein Projekt brauchen
  // (Nachtrag, Auftrag-SUB, generische Dokumente), fragen es in einem Schritt ab.
  const [projectPick, setProjectPick] = useState<
    | { kind: "nachtrag"; offerType: OfferType | null }
    | { kind: "sub"; offerType: OfferType | null }
    | { kind: "generic"; docType: DocumentType }
    | null
  >(null);
  const [pickProjectId, setPickProjectId] = useState("");
  const [pickBusy, setPickBusy] = useState(false);
  const [subPick, setSubPick] = useState<{ projectId: string; orders: any[]; variant: OfferType | null } | null>(null);

  // Voice-Pre-Step: vor dem Sprach-Angebote-Flow muss erst Kunde + (optional)
  // Projekt gewaehlt werden. Wir halten die offene Voice-Variante (offerType)
  // im State, damit handleVoicePrestepConfirm den Insert mit den korrekten
  // Snapshot-Daten ausfuehren kann.
  const [voicePrestepOpen, setVoicePrestepOpen] = useState(false);
  const [voicePrestepOfferType, setVoicePrestepOfferType] = useState<OfferType | null>(null);
  const [voicePrestepBusy, setVoicePrestepBusy] = useState(false);

  // ── KI-Analyse ──
  const [aiOn, setAiOn] = useState(true);
  const [aiDoc, setAiDoc] = useState<UnifiedDoc | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => { loadAiSettings().then((s) => setAiOn(aiModuleEnabled(s, "dokumente"))); }, []);
  async function aiAnalyze(d: UnifiedDoc) {
    setAiDoc(d); setAiText(null); setAiBusy(true); setMenuId(null);
    const info = `Typ: ${d.type_name}${d.variant_name ? ` (${d.variant_name})` : ""}\nNummer: ${d.doc_number || "-"}\n` +
      `Status: ${statusLabel(d.status_norm)}\nKunde: ${d.customer_name || "-"}\nProjekt: ${d.project_number || ""} ${d.project_title || ""}\n` +
      `Adresse: ${d.object_address || "-"}\nBetreff: ${d.title || "-"}\nDatum: ${d.doc_date || "-"}\nNetto: ${d.net ?? "-"} Brutto: ${d.gross ?? "-"}`;
    const prompt = `Analysiere dieses Dokument einer Bau-/Handwerksfirma. Gib auf Deutsch knapp und praxisnah: ` +
      `1) eine 1–2-Satz-Zusammenfassung, 2) einen sinnvollen nächsten Schritt.\n\n${info}`;
    const r = await aiAsk(prompt, { module: "dokumente", action: "analyse", context_id: d.id, context_type: d.kind });
    setAiBusy(false);
    setAiText(r.error ? r.error : (r.text || "Keine Antwort."));
  }

  // ── Suche debouncen ──
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Optionen laden ──
  useEffect(() => {
    loadDocTypeOptions().then(setTypes).catch(() => {});
    loadVariantOptions().then(setVariants).catch(() => {});
    loadEditorOptions().then(setEditors).catch(() => {});
    loadCustomerOptions().then(setCustomers).catch(() => {});
    loadProjectOptions().then(setProjects).catch(() => {});
  }, []);

  // ── URL synchronisieren (teilbar / Redirects) ──
  useEffect(() => {
    const next = new URLSearchParams(sp);
    filters.typeSlug ? next.set("typ", filters.typeSlug) : next.delete("typ");
    quick && quick !== "alle" ? next.set("quick", quick) : next.delete("quick");
    search ? next.set("q", search) : next.delete("q");
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.typeSlug, quick, search]);

  // ── Seite zurücksetzen, wenn sich Filter ändern ──
  // JSON.stringify als stabiler Vergleichs-Key (filters ist je Render ein neues Objekt).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); setSelected(new Set()); }, [search, quick, JSON.stringify(filters), sortBy, sortDir, pageSize]);

  // ── Daten laden ──
  const reqRef = useRef(0);
  useEffect(() => {
    const params: QueryParams = { ...filters, search, quick, sortBy, sortDir, page, pageSize };
    const reqId = ++reqRef.current;
    setLoading(true); setErr(null);
    queryDocuments(params)
      .then((r) => { if (reqId === reqRef.current) { setRows(r.rows); setCount(r.count); } })
      .catch((e) => { if (reqId === reqRef.current) setErr(e.message || "Fehler beim Laden."); })
      .finally(() => { if (reqId === reqRef.current) setLoading(false); });
  }, [filters, search, quick, sortBy, sortDir, page, pageSize]);

  function reload() { setFilters((f) => ({ ...f })); }

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir(key === "doc_date" || key === "last_change" || key === "net" || key === "gross" ? "desc" : "asc"); }
  }

  const setF = (patch: Partial<DocFilters>) => setFilters((f) => ({ ...f, ...patch }));

  // Variante nur bei Dokumentkette anbieten (passend zum Typ)
  const isChainType = filters.typeSlug ? CHAIN_SLUGS.includes(filters.typeSlug) : false;

  // ── Rechte-Helfer ──
  const mayCreateAny = isAdmin || ["offers", "orders", "invoices", "documents"].some((m) => can(m, "create"));
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  function canDelete(d: UnifiedDoc) { return d.is_draft && (isAdmin || can(KIND_MODULE[d.kind], "delete")); }
  // Auftrag-SUB hat (noch) keine Archiv-Spalte → nicht archivierbar (verhindert DB-Fehler).
  function canArchive(d: UnifiedDoc) { return d.kind !== "sub_order" && (isAdmin || can(KIND_MODULE[d.kind], "archive")); }
  function canForward(d: UnifiedDoc) {
    if (!d.convertible) return false;
    if (d.kind === "offer") return isAdmin || can("orders", "create");
    if (d.kind === "order") return isAdmin || can("invoices", "create");
    return false;
  }

  // ── Auswahl ──
  function toggleSel(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelAll() {
    setSelected((s) => s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));
  }
  const selectedDocs = useMemo(
    () => [...selected].map((id) => rowById.get(id)).filter(Boolean) as UnifiedDoc[],
    [selected, rowById],
  );

  // ── Aktionen ──
  async function doArchive(d: UnifiedDoc, archived: boolean) {
    setBusy(true); setMenuId(null);
    const { error } = await setArchived(d.kind, d.id, archived, uid);
    setBusy(false);
    if (error) setErr(error); else reload();
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    const { error } = await deleteDraftDocument(del.kind, del.id);
    setBusy(false);
    if (error) setErr(error); else { setDel(null); reload(); }
  }

  /** Einzelnes Dokument in die nächste Stufe überführen. */
  async function forwardOne(d: UnifiedDoc) {
    setBusy(true); setMenuId(null); setErr(null);
    try {
      if (d.kind === "offer") {
        const { data } = await supabase.from("offers").select("*").eq("id", d.id).single();
        const r = await createOrderFromOffers({ projectId: (data as any).project_id, offers: [data] });
        if (r.error) setErr(r.error); else if (r.id) nav(await docRouteById("order", r.id));
      } else if (d.kind === "order") {
        const { data } = await supabase.from("orders").select("*").eq("id", d.id).single();
        const r = await createInvoiceFromOrders({ orders: [data], projectId: (data as any).project_id });
        if (r.error) setErr(r.error); else if (r.id) nav(await docRouteById("invoice", r.id));
      }
    } catch (e: any) { setErr(e.message || "Weiterführen fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  /** Sammel-Weiterführung (alle gleiche Art + berechtigt). */
  async function forwardBulk() {
    const docs = selectedDocs;
    if (!docs.length) return;
    const kinds = new Set(docs.map((d) => d.kind));
    if (kinds.size > 1) { setErr("Bitte nur Dokumente derselben Art gemeinsam weiterführen."); return; }
    if (!docs.every(canForward)) { setErr("Mindestens ein Dokument ist nicht weiterführbar (Status/Rechte)."); return; }
    setBusy(true); setErr(null);
    try {
      const kind = docs[0].kind;
      const ids = docs.map((d) => d.id);
      if (kind === "offer") {
        const { data } = await supabase.from("offers").select("*").in("id", ids);
        const offers = (data as any[]) ?? [];
        const sameProject = offers.every((o) => o.project_id && o.project_id === offers[0].project_id);
        const r = sameProject
          ? await createOrderFromOffers({ projectId: offers[0].project_id, offers })
          : await createOrdersPerOffer({ projectId: offers[0].project_id || "", offers });
        if (r.error) setErr(r.error);
        else { setSelected(new Set()); const id = (r as any).id ?? (r as any).ids?.[0]; if (id) nav(await docRouteById("order", id)); else reload(); }
      } else if (kind === "order") {
        const { data } = await supabase.from("orders").select("*").in("id", ids);
        const orders = (data as any[]) ?? [];
        const sameProject = orders.every((o) => o.project_id && o.project_id === orders[0].project_id);
        const r = sameProject
          ? await createInvoiceFromOrders({ orders, projectId: orders[0].project_id })
          : await createInvoicesPerOrder({ orders });
        if (r.error) setErr(r.error);
        else { setSelected(new Set()); const id = (r as any).id ?? (r as any).ids?.[0]; if (id) nav(await docRouteById("invoice", id)); else reload(); }
      }
    } catch (e: any) { setErr(e.message || "Sammel-Weiterführung fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function bulkArchive(archived: boolean) {
    const docs = selectedDocs.filter(canArchive);
    if (!docs.length) { setErr("Keine berechtigten Dokumente ausgewählt."); return; }
    setBusy(true); setErr(null);
    for (const d of docs) await setArchived(d.kind, d.id, archived, uid);
    setBusy(false); setSelected(new Set()); reload();
  }

  async function exportCsv() {
    setBusy(true); setErr(null);
    try {
      const data = await fetchForExport({ ...filters, search, quick });
      const csv = rowsToCsv(data);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `dokumente_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message || "Export fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  function openRow(d: UnifiedDoc) {
    const r = editorRoute(d);
    if (!r) return;
    if (r.startsWith("http")) window.open(r, "_blank", "noopener");
    else nav(r);
  }

  // ── Dokument erstellen (zentrales Menü, globaler Kontext) ──────────────────
  // Angebot/Auftrag/Rechnung lassen sich projektlos anlegen (wie bisher). Nachtrag,
  // Auftrag-SUB und generische Typen brauchen einen Projektkontext → Projektauswahl.
  function finishDraft(r: DraftResult) {
    if (r.error) { setErr(r.error === "PROJECT_REQUIRED" ? "Für diesen Dokumenttyp wird ein Projekt benötigt." : r.error); return; }
    if (r.route) nav(r.route);
  }
  async function onMenuCreate(kind: ChainKind, offerType: OfferType | null, opts?: DocumentCreateOpts) {
    setErr(null);
    if (kind === "offer") {
      // Sprach-Angebote zuerst durch den Kunden-/Projekt-Picker leiten —
      // ohne diese Auswahl kommt es im OfferEditor nachher zu einer leeren
      // Kunden-/Adressanzeige (alte Beschwerde "uebernimmt nichts ins Angebot").
      if (opts?.voice) {
        setVoicePrestepOfferType(offerType);
        setVoicePrestepOpen(true);
        return;
      }
      return finishDraft(await createOfferDraft({ offerType }));
    }
    if (kind === "order") return finishDraft(await createOrderDraft({ offerType }));
    if (kind === "invoice") { nav(invoiceNewRoute({ offerType })); return; }
    if (kind === "nachtrag") { setPickProjectId(""); setProjectPick({ kind: "nachtrag", offerType }); }
  }

  async function handleVoicePrestepConfirm(r: VoiceAngebotPrestepResult) {
    if (voicePrestepBusy) return;
    setVoicePrestepBusy(true);
    try {
      const draft = await createOfferDraft({
        offerType: voicePrestepOfferType,
        contactId: r.contactId,
        projectId: r.projectId,
        voice: true,
      });
      if (draft.error) {
        setErr(draft.error);
        return;
      }
      setVoicePrestepOpen(false);
      setVoicePrestepOfferType(null);
      if (draft.route) nav(draft.route);
    } finally {
      setVoicePrestepBusy(false);
    }
  }
  function onMenuGeneric(docType: DocumentType) { setErr(null); setPickProjectId(""); setProjectPick({ kind: "generic", docType }); }
  function onMenuSub(offerType: OfferType | null) { setErr(null); setPickProjectId(""); setProjectPick({ kind: "sub", offerType }); }

  function closeProjectPick() { setProjectPick(null); setPickProjectId(""); }

  async function confirmProjectPick() {
    if (!projectPick || !pickProjectId) return;
    const pid = pickProjectId;
    setPickBusy(true); setErr(null);
    try {
      const { data: proj } = await supabase.from("projects").select("contact_id,title").eq("id", pid).maybeSingle();
      const contactId = (proj as any)?.contact_id ?? null;
      const title = (proj as any)?.title ?? null;
      if (projectPick.kind === "nachtrag") {
        const r = await createNachtragDraft({ projectId: pid, contactId, title, offerType: projectPick.offerType });
        if (r.error) { setErr(r.error); return; }
        closeProjectPick(); if (r.route) nav(r.route);
        return;
      }
      if (projectPick.kind === "generic") {
        const r = await createGenericDocument({ projectId: pid, docType: projectPick.docType, customerId: contactId, title, createdBy: uid });
        if ("error" in r) { setErr(r.error); return; }
        if (r.kind === "navigate") { closeProjectPick(); nav(r.route); return; }
        if (r.kind === "info") { setErr(r.message); closeProjectPick(); return; }
        // kind === "refresh": Datensatz im Projekt angelegt → zum Projekt wechseln
        closeProjectPick(); nav(projectRoute({ id: pid }));
        return;
      }
      // kind === "sub": beauftragten Auftrag des Projekts als Quelle wählen
      const { data } = await supabase.from("orders")
        .select("id,order_number,title,items,status")
        .eq("project_id", pid).is("deleted_at", null)
        .not("status", "in", "(entwurf,storniert,archiviert)");
      const orders = (data as any[]) ?? [];
      if (orders.length === 0) {
        setErr("Für eine Subunternehmer-Vergabe wird ein beauftragter Auftrag als Quelle benötigt. Bitte zuerst im Projekt einen Auftrag erstellen und beauftragen.");
        return;
      }
      const variant = projectPick.offerType;
      closeProjectPick();
      setSubPick({ projectId: pid, orders, variant });
    } finally {
      setPickBusy(false);
    }
  }

  // Aktiver erweiterter Filter? (für Badge am Button)
  const activeAdvanced =
    !!(filters.variantId || filters.statusNorm || filters.customerId || filters.projectId ||
      filters.editorId || filters.year || filters.dateFrom || filters.dateTo ||
      filters.amountMin != null || filters.amountMax != null ||
      (filters.archived && filters.archived !== "active") || (filters.canceled && filters.canceled !== "all"));

  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="pt-2" onClick={() => menuId && setMenuId(null)}>
      {/* ── Header ── */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Files size={24} /> Dokumente
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Zentrale Übersicht aller Dokumente</p>
        </div>
        {mayCreateAny && (
          <DocumentCreateMenu
            onCreate={onMenuCreate}
            onCreateGeneric={onMenuGeneric}
            onCreateSub={onMenuSub}
            label="Dokument erstellen"
            buttonClassName="btn-primary"
          />
        )}
      </div>

      <ErrorBanner message={err} />

      {/* ── Such- & Filterleiste ── */}
      <div className="glass mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Suchen: Nummer, Kunde, Projekt, Adresse, Betreff …"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                onClick={() => setSearchInput("")} aria-label="Suche leeren"><X size={15} /></button>
            )}
          </div>

          {/* Dokumenttyp (dynamisch aus Einstellungen) */}
          <select className="input w-auto min-w-[160px]" value={filters.typeSlug ?? ""}
            onChange={(e) => setF({ typeSlug: e.target.value || null, variantId: null })}>
            <option value="">Alle Dokumenttypen</option>
            {types.map((t) => (
              <option key={t.id} value={t.slug}>{t.name}{t.is_active ? "" : " (inaktiv)"}</option>
            ))}
          </select>

          {/* Variante – nur passend zur Dokumentkette */}
          {isChainType && (
            <select className="input w-auto min-w-[150px]" value={filters.variantId ?? ""}
              onChange={(e) => setF({ variantId: e.target.value || null })}>
              <option value="">Alle Varianten</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}

          <button className={`btn-outline ${activeAdvanced ? "ring-1 ring-[var(--accent)]" : ""}`}
            onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal size={16} /> Filter{activeAdvanced ? " •" : ""}
          </button>
          <button className="btn-outline" disabled={busy || count === 0} onClick={exportCsv} title="Gefilterte Liste als CSV exportieren">
            <Download size={16} /> Export
          </button>
        </div>

        {/* Erweiterte Filter */}
        {showFilters && (
          <div className="mt-3 grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3"
            style={{ borderColor: "var(--border)" }}>
            <label className="text-xs font-medium text-slate-500">Status
              <select className="input mt-1" value={filters.statusNorm ?? ""} onChange={(e) => setF({ statusNorm: e.target.value || null })}>
                <option value="">Alle</option>
                {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">Kunde
              <select className="input mt-1" value={filters.customerId ?? ""} onChange={(e) => setF({ customerId: e.target.value || null })}>
                <option value="">Alle</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">Projekt
              <select className="input mt-1" value={filters.projectId ?? ""} onChange={(e) => setF({ projectId: e.target.value || null })}>
                <option value="">Alle</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">Bearbeiter
              <select className="input mt-1" value={filters.editorId ?? ""} onChange={(e) => setF({ editorId: e.target.value || null })}>
                <option value="">Alle</option>
                {editors.map((u) => <option key={u.id} value={u.id}>{u.name || "—"}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">Jahr
              <input className="input mt-1" type="number" placeholder="z. B. 2026" value={filters.year ?? ""}
                onChange={(e) => setF({ year: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <div className="flex gap-2">
              <label className="flex-1 text-xs font-medium text-slate-500">Von
                <input className="input mt-1" type="date" value={filters.dateFrom ?? ""} onChange={(e) => setF({ dateFrom: e.target.value || null })} />
              </label>
              <label className="flex-1 text-xs font-medium text-slate-500">Bis
                <input className="input mt-1" type="date" value={filters.dateTo ?? ""} onChange={(e) => setF({ dateTo: e.target.value || null })} />
              </label>
            </div>
            <div className="flex gap-2">
              <label className="flex-1 text-xs font-medium text-slate-500">Betrag ab (brutto)
                <input className="input mt-1" type="number" value={filters.amountMin ?? ""} onChange={(e) => setF({ amountMin: e.target.value ? Number(e.target.value) : null })} />
              </label>
              <label className="flex-1 text-xs font-medium text-slate-500">bis
                <input className="input mt-1" type="number" value={filters.amountMax ?? ""} onChange={(e) => setF({ amountMax: e.target.value ? Number(e.target.value) : null })} />
              </label>
            </div>
            <label className="text-xs font-medium text-slate-500">Archiviert
              <select className="input mt-1" value={filters.archived ?? "active"} onChange={(e) => setF({ archived: e.target.value as any })}>
                <option value="active">Nur aktive</option>
                <option value="archived">Nur archivierte</option>
                <option value="all">Alle</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">Storniert
              <select className="input mt-1" value={filters.canceled ?? "all"} onChange={(e) => setF({ canceled: e.target.value as any })}>
                <option value="all">Alle</option>
                <option value="active">Nicht storniert</option>
                <option value="canceled">Nur stornierte</option>
              </select>
            </label>
            <div className="flex items-end">
              <button className="btn-ghost text-sm text-slate-500"
                onClick={() => setFilters({ typeSlug: filters.typeSlug ?? null, archived: "active", canceled: "all" })}>
                Filter zurücksetzen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Schnellfilter-Chips ── */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK_CHIPS.map((c) => (
          <button key={c.key} onClick={() => setQuick(c.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              quick === c.key ? "text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            }`}
            style={quick === c.key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Sammelaktionsleiste ── */}
      {selected.size > 0 && (
        <div className="glass mb-3 flex flex-wrap items-center gap-2 p-2.5 text-sm">
          <span className="font-semibold">{selected.size} ausgewählt</span>
          <button className="btn-outline" disabled={busy} onClick={forwardBulk}><ArrowRightCircle size={15} /> Weiterführen</button>
          <button className="btn-outline" disabled={busy} onClick={() => bulkArchive(true)}><Archive size={15} /> Archivieren</button>
          <button className="btn-outline" disabled={busy} onClick={() => bulkArchive(false)}><ArchiveRestore size={15} /> Reaktivieren</button>
          <button className="btn-ghost ml-auto text-slate-500" onClick={() => setSelected(new Set())}>Auswahl aufheben</button>
        </div>
      )}

      {/* ── Tabelle ── */}
      {loading ? (
        <Spinner />
      ) : count === 0 ? (
        <Empty
          title="Noch keine Dokumente vorhanden."
          hint="Erstelle ein neues Dokument oder lege Dokumente direkt aus einem Projekt an."
        />
      ) : (
        <div className="glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelAll} aria-label="Alle auswählen" />
                  </th>
                  {/* Serverseitige Sortierung (documents_unified) – nur die Kopf-
                      Darstellung nutzt den einheitlichen SortHeader der App. */}
                  {COLS.map((c) => (
                    <SortHeader key={c.key} label={c.label} sortKey={c.key}
                      sort={{ key: sortBy, dir: sortDir }}
                      onSort={(k) => toggleSort(k as SortKey)}
                      align={c.align === "right" ? "right" : "left"}
                      padClass="px-3 py-2.5" className="whitespace-nowrap" />
                  ))}
                  <th className="px-3 py-2.5 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map((d) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => openRow(d)}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSel(d.id)} aria-label="Zeile auswählen" />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-semibold">
                      {d.doc_number || <span className="italic text-slate-400">Entwurf</span>}
                      {d.version_no ? (
                        <span className="ml-1.5 rounded bg-[var(--hover)] px-1 text-[10px] font-semibold text-slate-500" title={`Aktuelle Version: V${d.version_no}`}>V{d.version_no}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5"><Badge tone="blue">{d.type_name}</Badge></td>
                    <td className="px-3 py-2.5">{d.variant_name ? <Badge tone="slate">{d.variant_name}</Badge> : <span className="text-slate-400">–</span>}</td>
                    <td className="px-3 py-2.5"><Badge tone={statusTone(d.status_norm)}>{statusLabel(d.status_norm)}</Badge></td>
                    <td className="px-3 py-2.5"><div className="max-w-[160px] truncate" title={d.customer_name || undefined}>{d.customer_name || "–"}</div></td>
                    <td className="px-3 py-2.5" onClick={(e) => { if (d.project_id) { e.stopPropagation(); nav(projectRoute({ id: d.project_id, project_number: d.project_number })); } }}>
                      <div className="max-w-[170px] truncate" title={[d.project_number, d.project_title].filter(Boolean).join(" · ") || undefined}>
                        {d.project_number || d.project_title
                          ? <span className="text-[var(--accent)] hover:underline">{d.project_number ? `${d.project_number} · ` : ""}{d.project_title}</span>
                          : <span className="text-slate-400">–</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><div className="max-w-[180px] truncate text-xs text-slate-500" title={d.object_address || undefined}>{d.object_address || "–"}</div></td>
                    <td className="px-3 py-2.5"><div className="max-w-[180px] truncate" title={d.title || undefined}>{d.title || "–"}</div></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{dateAt(d.doc_date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-xs">{d.net != null ? eur(d.net) : "–"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-xs font-semibold">{d.gross != null ? eur(d.gross) : "–"}</td>
                    <td className="px-3 py-2.5"><div className="max-w-[120px] truncate text-xs text-slate-500" title={d.editor_name || undefined}>{d.editor_name || "–"}</div></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{dateTimeAt(d.last_change)}</td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="relative inline-block">
                        <button className="btn-ghost px-2" onClick={() => setMenuId(menuId === d.id ? null : d.id)} aria-label="Aktionen">
                          <MoreVertical size={16} />
                        </button>
                        {menuId === d.id && (
                          <div className="glass absolute right-0 z-30 mt-1 w-48 p-1 text-left text-sm" style={{ borderColor: "var(--border)" }}>
                            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)]" onClick={() => { setMenuId(null); openRow(d); }}>
                              <ExternalLink size={15} /> Öffnen
                            </button>
                            {aiOn && (
                              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)]" onClick={() => aiAnalyze(d)}>
                                <Sparkles size={15} /> KI-Analyse
                              </button>
                            )}
                            {canForward(d) && (
                              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)]" disabled={busy} onClick={() => forwardOne(d)}>
                                <ArrowRightCircle size={15} /> Weiterführen
                              </button>
                            )}
                            {canArchive(d) && !d.is_archived && (
                              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)]" disabled={busy} onClick={() => doArchive(d, true)}>
                                <Archive size={15} /> Archivieren
                              </button>
                            )}
                            {canArchive(d) && d.is_archived && (
                              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)]" disabled={busy} onClick={() => doArchive(d, false)}>
                                <ArchiveRestore size={15} /> Reaktivieren
                              </button>
                            )}
                            {canDelete(d) && (
                              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => { setMenuId(null); setDel(d); }}>
                                <Trash2 size={15} /> Löschen
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-slate-500"
            style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2">
              <span>{count.toLocaleString("de-AT")} Dokumente</span>
              <select className="input h-7 w-auto py-0 text-xs" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / Seite</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost px-2" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Zurück</button>
              <span>Seite {page + 1} / {totalPages}</span>
              <button className="btn-ghost px-2" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Weiter</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Löschen-Dialog ── */}
      <ConfirmDialog open={!!del} title="Entwurf löschen?" confirmLabel="Entwurf löschen"
        message={<><b>{del?.doc_number || "Entwurf"}</b>: {DELETE_CONFIRM_TEXT}</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />

      {/* ── Projektauswahl für projektpflichtige Erstellung (Nachtrag/SUB/generisch) ── */}
      {projectPick && (
        <Modal open onClose={closeProjectPick} title={
          projectPick.kind === "nachtrag" ? "Nachtrag – Projekt wählen"
            : projectPick.kind === "sub" ? "Auftrag SUB – Projekt wählen"
              : `${projectPick.docType.name} – Projekt wählen`
        }>
          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {projectPick.kind === "sub"
                ? "Für eine Subunternehmer-Vergabe wird ein Projekt mit beauftragtem Auftrag benötigt."
                : "Dieser Dokumenttyp wird einem Projekt zugeordnet."}
            </p>
            <select className="input" value={pickProjectId} onChange={(e) => setPickProjectId(e.target.value)} autoFocus>
              <option value="">Projekt wählen …</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={closeProjectPick}>Abbrechen</button>
              <button className="btn-primary" disabled={!pickProjectId || pickBusy} onClick={confirmProjectPick}>Weiter</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Auftrag SUB: Vergabe-Modal mit gewähltem Projekt/Auftrag/Variante ── */}
      {subPick && (
        <SubOrderCreateModal
          orders={subPick.orders}
          projectId={subPick.projectId}
          variant={subPick.variant}
          createdBy={uid}
          onClose={() => setSubPick(null)}
          onCreated={() => { setSubPick(null); reload(); }}
        />
      )}

      {/* KI-Analyse eines Dokuments */}
      {aiDoc && (
        <Modal open onClose={() => setAiDoc(null)} title={`KI-Analyse · ${aiDoc.doc_number || aiDoc.type_name}`}>
          {aiBusy ? <Spinner /> : <div className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{aiText}</div>}
        </Modal>
      )}

      {/* Sprach-Angebot Pre-Step: Kunde + Projekt waehlen, dann Voice-Editor */}
      <VoiceAngebotPrestepModal
        open={voicePrestepOpen}
        onClose={() => { setVoicePrestepOpen(false); setVoicePrestepOfferType(null); }}
        onConfirm={handleVoicePrestepConfirm}
        submitting={voicePrestepBusy}
      />
    </div>
  );
}

