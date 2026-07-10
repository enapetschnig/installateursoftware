// ============================================================
// B4Y SuperAPP – DocumentWorkspace
// Zentrale, wiederverwendbare Editor-Oberfläche:
// DnD-Kontext + Toolbar + Canvas + Seitenleiste + Übersicht + Gliederung.
// Verwendet von Angeboten, Aufträgen, Rechnungen, Nachträgen,
// Regieberichten und Leistungsverzeichnissen.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  pointerWithin, closestCenter, CollisionDetection, DragStartEvent, DragOverEvent, DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import ContentSidebar from "./ContentSidebar";
import DocumentCanvas from "./DocumentCanvas";
import DocumentOutline from "./DocumentOutline";
import DocumentSummary from "./DocumentSummary";
import DocumentToolbar, { MoreAction } from "./DocumentToolbar";
import MultiInsertModal from "./MultiInsertModal";
import QuickCreate, { QuickKind } from "./QuickCreate";
import TemplatesModal from "./TemplatesModal";
import TimesModal from "./TimesModal";
import { RegieHourModal, RegieMaterialModal } from "./RegieModals";
import ArticleForm from "../kalkulation/ArticleForm";
import NewServiceForm from "../kalkulation/NewServiceForm";
import { Modal } from "../ui";
import { eur } from "../../lib/format";
import { ARTICLE_UNITS, Article, Service } from "../../lib/calc-types";
import { PrintMeta } from "./printDocument";
import { openDocumentPdf, openSnapshotPdf, openPdfWindow, buildDocumentPdfFileName } from "../../lib/pdf";
import { loadDocumentVersions } from "../../lib/document-versions";

import { DocumentBuilder } from "../../hooks/useDocumentBuilder";
import { DocPosition, emptyPosition } from "../../lib/document-types";
import { loadSidebarData, SidebarData, makeVariablePosition, makeRegieMaterialPosition } from "../../lib/document-sources";
import { DEFAULT_KALK_SETTINGS } from "../../lib/calc/types";
import { usePermissions } from "../../lib/permissions";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { rememberProjectSection } from "../../lib/project-nav";

const EMPTY_DATA: SidebarData = {
  articles: [], services: [], hourlyRates: [], texts: [], titles: [], suppliers: [], tradeNames: {}, trades: [], unitCodes: [], categories: [],
  kalk: DEFAULT_KALK_SETTINGS,
};

// „Zum Projekt": fachlich passender Projekt-Sidebar-Bereich je Dokumenttyp
// (gültige Keys siehe VALID_SECTIONS in ProjectDetail.tsx).
const PROJECT_SECTION_BY_DOCTYPE: Record<string, string> = {
  angebot: "angebote", nachtrag: "angebote", auftrag: "auftraege", auftrag_sub: "auftraege", rechnung: "rechnungen",
};

export default function DocumentWorkspace({
  builder, docType, docLabel, numberLabel, projectId, vatOverride, vatLabel, printMeta,
  onSave, saving, onFinalize, onSettings, onHistory, moreActions, readOnly,
  autoSave, saveStatus, onRetry, sourceTable, sourceId, aiActions,
  correctable, onBeginCorrection, correctionPending, onResend, resendLabel,
}: {
  builder: DocumentBuilder;
  docType: string;
  docLabel: string;
  /** Grund-Dokumenttyp für Dateiname/PDF-Titel ("Angebot"|"Auftrag"|"Rechnung"). Default: docLabel. */
  numberLabel?: string;
  projectId?: string | null;
  vatOverride: number | null;
  vatLabel: string;
  printMeta: Omit<PrintMeta, "docLabel" | "vatLabel" | "numberLabel">;
  // Quelle (für Re-Print aus eingefrorenem Snapshot finalisierter Dokumente)
  sourceTable?: string;
  sourceId?: string | null;
  onSave: () => void;
  saving?: boolean;
  onFinalize: () => void;
  onSettings?: () => void;
  onHistory?: () => void;
  moreActions?: MoreAction[];
  readOnly?: boolean;
  autoSave?: boolean;
  saveStatus?: "saved" | "saving" | "dirty" | "error";
  onRetry?: () => void;
  aiActions?: MoreAction[];
  // Abgeschlossenes Dokument (Angebot/Auftrag) ist korrigierbar: Griffe/Pfeile bleiben aktiv;
  // die erste Umreihung fragt nach und erzeugt über onBeginCorrection einen Korrekturstand.
  // onBeginCorrection muss den Beleg entsperren (Status→Entwurf, working_base_version_no) und
  // true zurückgeben, wenn jetzt bearbeitet werden darf. Rechnungen sind NICHT korrigierbar.
  correctable?: boolean;
  onBeginCorrection?: () => Promise<boolean>;
  correctionPending?: boolean;
  /** Abgeschlossenes Dokument ohne Änderung (erneut) versenden – ohne neue Version. */
  onResend?: () => void;
  resendLabel?: string;
}) {
  const navigate = useNavigate();
  // Korrektur-Rückfrage (Promise-basiert): wird vor der ersten Mutation eines abgeschlossenen,
  // korrigierbaren Dokuments angezeigt.
  const [correctionAsk, setCorrectionAsk] = useState<null | { resolve: (ok: boolean) => void }>(null);
  const [data, setData] = useState<SidebarData>(EMPTY_DATA);
  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfCreatedAt, setPdfCreatedAt] = useState<string | null>(null);
  // Stammpreise-Vorschau: betroffene Positionen mit alt→neu EP + Auswahl.
  type PriceRow = { id: string; name: string; number: string | null; oldEp: number; newEp: number; manual: boolean };
  const [priceReview, setPriceReview] = useState<PriceRow[] | null>(null);
  const [priceSel, setPriceSel] = useState<Set<string>>(new Set());
  const [priceEmpty, setPriceEmpty] = useState(false);

  const [quickKind, setQuickKind] = useState<QuickKind | null>(null);
  // Zentrale Anlegemasken (Artikel/Leistung) + Gewerk-Kontext aus dem aktuellen Filter
  const [articleOpen, setArticleOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [createTradeId, setCreateTradeId] = useState<string | null>(null);
  const [calcHint, setCalcHint] = useState<Service | null>(null); // „Jetzt kalkulieren?" nach Leistungsanlage
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  // „Positionen einfügen": EIN zentraler Toolbar-Einstieg – im Dialog wird
  // zwischen „Aus Stamm" und „Aus Dokument übernehmen" umgeschaltet.
  const [multiOpen, setMultiOpen] = useState(false);
  const [regieHourOpen, setRegieHourOpen] = useState(false);
  const [regieMatOpen, setRegieMatOpen] = useState(false);

  // Mandanten-Standard für Regiematerial (company_settings). 'ask' = Dialog zeigen.
  const [regieMatDefault, setRegieMatDefault] = useState<{ mode: "manual" | "percent" | "fixed"; percent: number }>(
    { mode: "percent", percent: 20 }
  );

  // Drag-Zustand
  const [activeDrag, setActiveDrag] = useState<{ from: "sidebar" | "canvas"; name: string; id?: string } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Rechte: Stammdaten dauerhaft anlegen nur mit passender Berechtigung (Admin immer).
  // Einfügen, variable Positionen und freier Text bleiben für alle möglich.
  const { can } = usePermissions();
  const canCreate = {
    article: can("kalkulation.articles", "create"),
    service: can("kalkulation.services", "create"),
    text: can("kalkulation", "create"),
    title: can("kalkulation", "create"),
  };
  const { session } = useAuth();

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try { setData(await loadSidebarData()); }
    finally { setLoadingData(false); }
  }, []);
  useEffect(() => { loadData(); }, [loadData]);

  // Mandanten-Standard für Regiematerial laden (einmalig). 'ask'/'none' → Dialog
  // mit sinnvoller Vorbelegung 'percent'; konkrete Modi werden vorausgewählt.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("company_settings")
        .select("regie_material_default_mode,regie_material_default_percent").limit(1).maybeSingle();
      const m = (data?.regie_material_default_mode as string) ?? "ask";
      const mode = (m === "manual" || m === "percent" || m === "fixed") ? m : "percent";
      setRegieMatDefault({ mode, percent: Number(data?.regie_material_default_percent) || 20 });
    })();
  }, []);

  // MwSt-Vorgabe für neu eingefügte Regie-/Variable-Positionen.
  const vatDefault = vatOverride ?? 20;
  // Vorhandene Regiestunden im Dokument (für Material-Verknüpfung).
  const regieHours = useMemo(() => builder.positions.filter((p) => p.is_regie_hour), [builder.positions]);

  // Variable Position → echte Stammleistung speichern (nur mit Recht). Danach wird die
  // Dokumentposition mit der neuen Stammleistung verknüpft (service_id) und ist keine
  // variable Position mehr; die Liste wird neu geladen, damit die Leistung erscheint.
  // (MUSS nach loadData stehen – sonst „used before declaration" → Build-Stopp.)
  const saveVariableAsMaster = useCallback(async (p: DocPosition) => {
    if (!canCreate.service) return;
    if (!p.name.trim()) { window.alert("Bitte zuerst eine Bezeichnung eingeben."); return; }
    const { data, error } = await supabase.from("services").insert({
      name: p.name.trim(), unit: p.unit || "Stk", short_text: p.description ?? null,
      long_text: p.long_text ?? null, vat_rate: Number(p.vat_rate) || 20,
      vk_net_manual: Number(p.unit_price) || 0, material_mode: "kein", aufschlag_percent: 0,
      active: true, created_by: session?.user.id ?? null,
    }).select("id").single();
    if (error) { window.alert(error.message); return; }
    builder.patch(p.id, { service_id: data.id, is_variable: false });
    loadData();
    window.alert("Leistung wurde im Leistungsstamm gespeichert und mit dieser Position verknüpft.");
  }, [canCreate.service, session, builder, loadData]);

  // Nutzungshäufigkeit hochzählen (fire & forget)
  const bumpUsage = useCallback((pos: DocPosition) => {
    if (pos.type === "article" && pos.article_id) supabase.rpc("b4y_bump_usage", { p_kind: "article", p_ids: [pos.article_id] }).then(() => {});
    else if (pos.type === "service" && pos.service_id) supabase.rpc("b4y_bump_usage", { p_kind: "service", p_ids: [pos.service_id] }).then(() => {});
    else if ((pos.type === "text" || pos.type === "title") && pos.text_block_id) supabase.rpc("b4y_bump_usage", { p_kind: "text", p_ids: [pos.text_block_id] }).then(() => {});
  }, []);

  const quickAdd = useCallback((pos: DocPosition) => {
    builder.append(pos);
    bumpUsage(pos);
  }, [builder, bumpUsage]);

  // „+ Artikel"/„+ Leistung" öffnen die ZENTRALE Kalkulationsmaske (keine Parallelmaske).
  // Gewerk-Kontext aus dem aktuellen Sidebar-Filter (Kategorie-Name → Gewerk) vorbelegen.
  const openCreate = useCallback((kind: "article" | "service" | "text" | "title", categoryHint?: string) => {
    const tradeId = categoryHint ? (data.trades.find((t) => t.name === categoryHint)?.id ?? null) : null;
    setCreateTradeId(tradeId);
    if (kind === "article") setArticleOpen(true);
    else if (kind === "service") setServiceOpen(true);
    else setQuickKind(kind); // Text/Titel weiterhin über QuickCreate
  }, [data.trades]);

  // Neuer Artikel zentral gespeichert → optional direkt einfügen + Sidebar nachladen.
  const onArticleCreated = useCallback((saved?: Article) => {
    setArticleOpen(false);
    if (saved) {
      quickAdd(emptyPosition("article", {
        article_id: saved.id,
        name: saved.name,
        description: saved.category ?? saved.description ?? null,
        unit: saved.unit ?? "Stk",
        qty: 1,
        unit_price: Number(saved.sale_price) || 0,
        unit_cost: Number(saved.purchase_price) || 0,
        material_cost: Number(saved.purchase_price) || 0,
        vat_rate: Number(saved.vat_rate) || 20,
      }));
    }
    loadData();
  }, [quickAdd, loadData]);

  // Neue Leistung zentral gespeichert → einfügen (Preis 0 bis kalkuliert), Sidebar nachladen,
  // danach optional „Jetzt kalkulieren" (zentrale Kalkseite in neuem Tab).
  const onServiceCreated = useCallback((s: Service) => {
    setServiceOpen(false);
    builder.append(emptyPosition("service", {
      service_id: s.id,
      name: s.name,
      description: s.short_text ?? null,
      long_text: s.long_text ?? null,
      unit: s.unit ?? "Stk",
      qty: 1,
      unit_price: 0,
      unit_cost: 0,
      vat_rate: Number(s.vat_rate) || 20,
    }));
    setCalcHint(s);
    loadData();
  }, [builder, loadData]);

  // Regiematerial (prozentual) direkt nach einer Regiestunde einfügen, mit Bezug verknüpft.
  const addRegieMaterialFor = useCallback((regieId: string) => {
    const idx = builder.positions.findIndex((p) => p.id === regieId);
    const pos = makeRegieMaterialPosition({
      mode: "percent", percent: regieMatDefault.percent, linkedRegieId: regieId, vatRate: vatDefault,
    });
    if (idx < 0) builder.append(pos); else builder.insertAt(idx + 1, pos);
  }, [builder, regieMatDefault.percent, vatDefault]);

  // ---- DnD-Handler ----
  const indexOfId = useCallback((id: string) => builder.positions.findIndex((p) => p.id === id), [builder.positions]);

  // Kollisionserkennung hybrid: Sidebar-Drops via pointerWithin (kein Einfügen beim Zurückziehen),
  // Canvas-Umsortierung via closestCenter (zuverlässiges Reorder, auch zwischen Zeilen/Lücken).
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const from = (args.active?.data?.current as any)?.from;
    return from === "sidebar" ? pointerWithin(args) : closestCenter(args);
  }, []);

  // Stellt sicher, dass mutiert werden darf. Bei abgeschlossenen, korrigierbaren Dokumenten
  // wird einmalig nachgefragt und über onBeginCorrection ein Korrekturstand erzeugt.
  const ensureEditable = useCallback((): Promise<boolean> => {
    if (!readOnly) return Promise.resolve(true);
    if (!(correctable && onBeginCorrection)) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => setCorrectionAsk({ resolve }));
  }, [readOnly, correctable, onBeginCorrection]);

  async function confirmCorrection() {
    const ask = correctionAsk; setCorrectionAsk(null);
    let ok = false;
    try { ok = onBeginCorrection ? await onBeginCorrection() : false; } catch { ok = false; }
    ask?.resolve(ok);
  }
  function cancelCorrection() { const ask = correctionAsk; setCorrectionAsk(null); ask?.resolve(false); }

  function onDragStart(e: DragStartEvent) {
    const d = e.active.data.current as any;
    if (d?.from === "sidebar") {
      let name = "Element";
      try { name = (d.build() as DocPosition).name || "Element"; } catch { /* ignore */ }
      setActiveDrag({ from: "sidebar", name });
    } else {
      const p = builder.positions.find((x) => x.id === e.active.id);
      setActiveDrag({ from: "canvas", name: p?.name || "Position", id: String(e.active.id) });
    }
  }

  // Liefert den Einfüge-/Drop-Index ODER null, wenn KEIN gültiges Ziel unter dem Zeiger
  // liegt (z. B. Cursor außerhalb der Dokumentfläche zurückgezogen). Gültige Ziele:
  // "doc-end" (Ende des Dokuments) oder eine vorhandene Positions-ID. null = nichts einfügen.
  // Wichtig: Mit der collisionDetection=pointerWithin meldet over nur dann ein Ziel, wenn der
  // Zeiger tatsächlich darüber liegt – beim Zurückziehen ist over null → kein ungewolltes Einfügen.
  function computeDropIndex(e: DragOverEvent | DragEndEvent): number | null {
    const over = e.over;
    if (!over) return null;
    if (over.id === "doc-end") return builder.positions.length;
    const i = indexOfId(String(over.id));
    return i >= 0 ? i : null;
  }

  function onDragOver(e: DragOverEvent) {
    setDropIndex(computeDropIndex(e));
  }

  async function onDragEnd(e: DragEndEvent) {
    const d = e.active.data.current as any;
    setActiveDrag(null);
    setDropIndex(null);
    if (d?.from === "sidebar") {
      // Sidebar-Drag: NUR einfügen, wenn ein gültiges Ziel unter dem Zeiger liegt.
      // Zurückgezogen/außerhalb (idx == null) → bewusst nichts tun (kein Insert/bumpUsage/Dirty).
      const idx = computeDropIndex(e);
      if (idx == null) return; // kein gültiges Ziel
      if (!(await ensureEditable())) return; // abgeschlossen + abgebrochen → nichts tun
      try {
        const pos = d.build() as DocPosition;
        builder.insertAt(idx, pos);
        bumpUsage(pos);
      } catch { /* ignore */ }
    } else {
      // Canvas-Sortierung: nur verschieben, wenn ein gültiges, anderes Ziel unter dem Zeiger liegt.
      const overId = e.over?.id;
      const activeId = String(e.active.id);
      const valid = overId != null && overId !== e.active.id
        && (overId === "doc-end" || indexOfId(String(overId)) >= 0);
      if (!valid) return;
      if (!(await ensureEditable())) return; // abgeschlossen + abgebrochen → keine Umreihung
      if (overId === "doc-end") builder.moveToIndex(activeId, builder.positions.length);
      else builder.moveOver(activeId, String(overId));
    }
  }

  // ---- Zeilen-API für Canvas ----
  const moveDir = useCallback(async (id: string, dir: -1 | 1) => {
    const i = indexOfId(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= builder.positions.length) return;
    if (!(await ensureEditable())) return; // abgeschlossen + abgebrochen → keine Umreihung
    builder.moveOver(id, builder.positions[j].id);
  }, [builder, indexOfId, ensureEditable]);

  const rowApi = useMemo(() => ({ patch: builder.patch, remove: builder.remove, move: moveDir }), [builder.patch, builder.remove, moveDir]);

  // ---- Stammpreise: Vorschau aufbauen (keine stille Überschreibung) ----
  // Sammelt alle mit Artikel-/Leistungsstamm verknüpften Positionen, deren EP sich
  // geändert hat (alt→neu). Manuell geänderte Positionen (price_overridden) werden
  // angezeigt, aber NICHT vorausgewählt. Freie/Titel/Text bleiben unberührt.
  async function refreshPrices() {
    setRefreshing(true);
    setPriceEmpty(false);
    try {
      const fresh = await loadSidebarData();
      setData(fresh);
      const aMap = new Map(fresh.articles.map((a) => [a.id, a]));
      const sMap = new Map(fresh.services.map((s) => [s.id, s]));
      const rows: PriceRow[] = [];
      for (const p of builder.positions) {
        let newEp: number | null = null;
        if (p.type === "article" && p.article_id && aMap.has(p.article_id)) newEp = Number(aMap.get(p.article_id)!.sale_price) || 0;
        else if (p.type === "service" && p.service_id && sMap.has(p.service_id)) newEp = Number(sMap.get(p.service_id)!._sale) || 0;
        if (newEp == null) continue;
        const oldEp = Number(p.unit_price) || 0;
        if (Math.abs(newEp - oldEp) < 0.005) continue; // unveränderte überspringen
        rows.push({ id: p.id, name: p.name || "—", number: p.number, oldEp, newEp, manual: !!p.price_overridden });
      }
      if (rows.length === 0) { setPriceEmpty(true); return; }
      setPriceReview(rows);
      setPriceSel(new Set(rows.filter((r) => !r.manual).map((r) => r.id))); // manuell geänderte abgewählt
    } finally {
      setRefreshing(false);
    }
  }

  // Bestätigte Stammpreis-Übernahme: nur ausgewählte Positionen aktualisieren.
  function applyPriceReview() {
    const sel = priceSel;
    const aMap = new Map(data.articles.map((a) => [a.id, a]));
    const sMap = new Map(data.services.map((s) => [s.id, s]));
    const next = builder.positions.map((p) => {
      if (!sel.has(p.id)) return p;
      if (p.type === "article" && p.article_id && aMap.has(p.article_id)) {
        const a = aMap.get(p.article_id)!;
        return { ...p, unit_price: Number(a.sale_price) || 0, unit_cost: Number(a.purchase_price) || 0, material_cost: Number(a.purchase_price) || 0, price_overridden: false, surcharge_baked: false };
      }
      if (p.type === "service" && p.service_id && sMap.has(p.service_id)) {
        const s = sMap.get(p.service_id)!;
        return { ...p, unit_price: Number(s._sale) || 0, unit_cost: Number(s._cost) || 0, material_cost: Number(s._material) || 0, labor_minutes: Number(s._laborMin) || 0, price_overridden: false, surcharge_baked: false };
      }
      return p;
    });
    builder.setPositions(next);
    setPriceReview(null);
  }

  async function doPdf() {
    setPdfCreatedAt(new Date().toISOString());
    const win = openPdfWindow(); // sofort Feedback (im Klick geöffnet)
    // Zentraler, sauberer Dateiname aus der echten Dokumentnummer (Grund-Dokumenttyp).
    const baseLabel = numberLabel || docLabel;
    const fileName = buildDocumentPdfFileName({ number: printMeta.number, baseLabel });
    // NUR gesperrte/abgeschlossene Dokumente zeigen den eingefrorenen Snapshot der letzten
    // Version. Ein entsperrtes Dokument in Korrektur (readOnly=false) zeigt den LIVE-Stand,
    // sonst sähe man während der Bearbeitung weiter den alten Stand.
    if (readOnly && sourceTable && sourceId) {
      try {
        const versions = await loadDocumentVersions(sourceTable, sourceId);
        const snapVersion = versions.find((v) => v.print_html);
        if (snapVersion?.print_html) {
          // Persistenter PDF-Cache je finaler Version: einmal gerendert = sofort offen.
          await openSnapshotPdf(snapVersion.print_html, win, fileName, {
            cacheRef: { sourceTable, sourceId, versionNo: snapVersion.version_no },
          });
          return;
        }
      } catch { /* Fallback: Live-PDF */ }
    }
    await openDocumentPdf(builder.positions, builder.summary, { ...printMeta, docLabel, numberLabel: baseLabel, vatLabel }, win, fileName, {
      // Entwurfs-/Live-Cache (version 0): unverändertes Dokument öffnet ohne neuen PDFShift-Lauf.
      cacheRef: sourceTable && sourceId ? { sourceTable, sourceId, versionNo: 0 } : null,
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection}
      onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveDrag(null); setDropIndex(null); }}>
      <div className="space-y-2">
        <DocumentToolbar
          projectId={projectId}
          onJumpProject={() => {
            // React-Router-Navigation (BrowserRouter, kein Hash) + fachlich passenden
            // Projekt-Bereich vormerken – ProjectDetail aktiviert ihn beim Mount.
            if (!projectId) return;
            rememberProjectSection(projectId, PROJECT_SECTION_BY_DOCTYPE[docType] ?? "dok_overview");
            navigate(`/projekte/${projectId}`);
          }}
          onRefreshPrices={refreshPrices}
          refreshing={refreshing}
          onInsertTimes={() => setTimesOpen(true)}
          onHistory={onHistory}
          onCreateArticle={readOnly ? undefined : () => openCreate("article")}
          onCreateService={readOnly ? undefined : () => openCreate("service")}
          onMultiInsert={readOnly ? undefined : () => setMultiOpen(true)}
          aiActions={aiActions}
          docTypeKey={docType}
          docTypeLabel={numberLabel || docLabel}
          docNumber={printMeta.number ?? null}
          onTemplates={() => setTemplatesOpen(true)}
          onSettings={onSettings}
          onUndo={builder.undo}
          onRedo={builder.redo}
          canUndo={builder.canUndo}
          canRedo={builder.canRedo}
          onSave={onSave}
          saving={saving}
          dirty={builder.dirty}
          onFinalize={onFinalize}
          onPdf={doPdf}
          moreActions={moreActions}
          readOnly={readOnly}
          autoSave={autoSave}
          saveStatus={saveStatus}
          correctionPending={correctionPending}
          onRetry={onRetry}
          onResend={onResend}
          resendLabel={resendLabel}
        />

        <div className="doc-workspace-grid grid gap-3 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px]">
          {/* Dokument + Übersicht */}
          <div className="space-y-3">
            <SortableContext items={builder.positions.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <DocumentCanvas
                positions={builder.positions}
                dropIndex={dropIndex}
                activeId={activeDrag?.from === "canvas" ? activeDrag.id ?? null : null}
                api={rowApi}
                readOnly={readOnly}
                correctable={correctable}
                canSaveMaster={canCreate.service}
                onSaveMaster={saveVariableAsMaster}
                onAddRegieMaterial={addRegieMaterialFor}
                lastInserted={builder.lastInserted}
              />
            </SortableContext>
            <DocumentOutline entries={builder.outline} />
            <DocumentSummary summary={builder.summary} vatLabel={vatLabel} pdfCreatedAt={pdfCreatedAt} />
          </div>

          {/* Rechte Seitenleiste (dauerhaft) */}
          <div className="xl:sticky xl:top-16 xl:h-[calc(100vh-5rem)]">
            <div className="glass h-full p-3">
              <ContentSidebar
                data={data}
                loading={loadingData}
                onQuickAdd={quickAdd}
                onCreate={openCreate}
                onInsertVariable={readOnly ? undefined : () => builder.append(makeVariablePosition(vatDefault))}
                onInsertRegieHour={readOnly ? undefined : () => setRegieHourOpen(true)}
                onInsertRegieMaterial={readOnly ? undefined : () => setRegieMatOpen(true)}
                onReload={loadData}
                canCreate={canCreate}
                vatDefault={vatDefault}
              />
            </div>
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeDrag ? (
          <div className="rounded-xl border bg-[var(--card)] px-3 py-2 text-sm font-semibold shadow-lg" style={{ borderColor: "var(--accent)" }}>
            {activeDrag.name}
          </div>
        ) : null}
      </DragOverlay>

      {quickKind && (
        <QuickCreate
          kind={quickKind}
          onClose={() => setQuickKind(null)}
          onCreated={(pos, reload) => { quickAdd(pos); if (reload) loadData(); }}
        />
      )}
      {articleOpen && (
        <ArticleForm
          article={null}
          trades={data.trades}
          articles={data.articles}
          unitOpts={data.unitCodes.length ? data.unitCodes : [...ARTICLE_UNITS]}
          initialTradeId={createTradeId}
          onClose={() => setArticleOpen(false)}
          onSaved={onArticleCreated}
        />
      )}
      {serviceOpen && (
        <NewServiceForm
          trades={data.trades}
          services={data.services}
          unitOpts={data.unitCodes.length ? data.unitCodes : [...ARTICLE_UNITS]}
          initialTradeId={createTradeId}
          submitLabel="Anlegen & einfügen"
          onClose={() => setServiceOpen(false)}
          onCreated={onServiceCreated}
        />
      )}
      {calcHint && (
        <Modal open onClose={() => setCalcHint(null)} title="Leistung angelegt">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <b>{calcHint.name}</b> wurde im Leistungsstamm gespeichert und ins Dokument eingefügt.
            Möchtest du sie jetzt kalkulieren (Lohn, Material, Aufschlag)? Das öffnet die zentrale
            Kalkulationsseite in einem neuen Tab – dein Dokument bleibt hier offen.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setCalcHint(null)}>Später</button>
            <button className="btn-primary" onClick={() => {
              // Direkte App-URL (BrowserRouter, basename /app) statt Hash-Altlast.
              window.open(`${window.location.origin}/app/kalkulation/leistungen/${calcHint.id}?tab=calc`, "_blank", "noopener");
              setCalcHint(null);
            }}>Jetzt kalkulieren</button>
          </div>
        </Modal>
      )}
      {templatesOpen && (
        <TemplatesModal
          docType={docType}
          currentPositions={builder.positions}
          onLoad={(items) => {
            builder.setPositions([...builder.positions, ...items]);
            if (items.length) builder.markInserted(items[items.length - 1].id, "append");
          }}
          onClose={() => setTemplatesOpen(false)}
        />
      )}
      {timesOpen && projectId && (
        <TimesModal
          projectId={projectId}
          onInsert={(items) => {
            builder.setPositions([...builder.positions, ...items]);
            if (items.length) builder.markInserted(items[items.length - 1].id, "append");
          }}
          onClose={() => setTimesOpen(false)}
        />
      )}
      {multiOpen && (
        <MultiInsertModal
          data={data}
          projectId={projectId}
          vatDefault={vatDefault}
          currentPositions={builder.positions}
          onInsert={(positions, target) => {
            if (positions.length === 0) return;
            // Gezieltes Einfügen: „Einfügen nach Position" (afterId) ODER ans Ende.
            // Die Reihenfolge der übernommenen Positionen bleibt erhalten; renumber()
            // im Builder vergibt Nummern/Gliederung danach neu.
            const cur = builder.positions;
            const afterIdx = target?.afterId ? cur.findIndex((p) => p.id === target.afterId) : -1;
            const insertIdx = afterIdx >= 0 ? afterIdx + 1 : cur.length;
            builder.setPositions([...cur.slice(0, insertIdx), ...positions, ...cur.slice(insertIdx)]);
            // Scroll/Highlight zentral: ans Ende = "append" (unten sichtbar), gezielt = "insert" (mittig).
            builder.markInserted(positions[positions.length - 1].id, insertIdx >= cur.length ? "append" : "insert");
            positions.forEach(bumpUsage);
          }}
          onClose={() => setMultiOpen(false)}
        />
      )}
      {regieHourOpen && (
        <RegieHourModal
          rates={data.hourlyRates}
          vatDefault={vatDefault}
          onInsert={(pos) => builder.append(pos)}
          onClose={() => setRegieHourOpen(false)}
        />
      )}
      {regieMatOpen && (
        <RegieMaterialModal
          regieHours={regieHours}
          defaultMode={regieMatDefault.mode}
          defaultPercent={regieMatDefault.percent}
          vatDefault={vatDefault}
          onInsert={(pos) => builder.append(pos)}
          onClose={() => setRegieMatOpen(false)}
        />
      )}

      {/* Stammpreise – „nichts zu aktualisieren" */}
      {priceEmpty && (
        <Modal open onClose={() => setPriceEmpty(false)} title="Preise aktualisieren">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Alle mit dem Artikel-/Leistungsstamm verknüpften Positionen sind bereits aktuell – es gibt keine
            Preisänderungen zu übernehmen. Freie Positionen, Titel und Textzeilen werden nie automatisch geändert.
          </p>
          <div className="mt-5 flex justify-end"><button className="btn-primary" onClick={() => setPriceEmpty(false)}>OK</button></div>
        </Modal>
      )}

      {/* Stammpreise – Vorschau & Bestätigung */}
      {priceReview && (
        <Modal open onClose={() => setPriceReview(null)} title="Preise aktualisieren – Stammpreise übernehmen" size="xl">
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            Diese verknüpften Positionen haben im Stamm einen anderen Einzelpreis. Wähle aus, welche aktualisiert werden sollen.
            <b> Manuell geänderte Positionen</b> sind zur Sicherheit nicht vorausgewählt. Freie Positionen, Titel und Texte bleiben unverändert.
          </p>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="p-2"></th><th className="p-2">Nr.</th><th className="p-2">Bezeichnung</th>
                  <th className="p-2 text-right">Alter EP</th><th className="p-2 text-right">Neuer EP</th>
                </tr>
              </thead>
              <tbody>
                {priceReview.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="p-2">
                      <input type="checkbox" checked={priceSel.has(r.id)} onChange={(e) => {
                        setPriceSel((prev) => { const n = new Set(prev); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; });
                      }} />
                    </td>
                    <td className="p-2 tabular-nums text-slate-500">{r.number ?? "–"}</td>
                    <td className="p-2">{r.name}{r.manual && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-600">manuell geändert</span>}</td>
                    <td className="p-2 text-right tabular-nums text-slate-500">{eur(r.oldEp)}</td>
                    <td className="p-2 text-right tabular-nums font-semibold">{eur(r.newEp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex gap-2 text-xs">
              <button className="btn-ghost px-2 py-1" onClick={() => setPriceSel(new Set(priceReview.map((r) => r.id)))}>Alle</button>
              <button className="btn-ghost px-2 py-1" onClick={() => setPriceSel(new Set(priceReview.filter((r) => !r.manual).map((r) => r.id)))}>Nur unveränderte</button>
              <button className="btn-ghost px-2 py-1" onClick={() => setPriceSel(new Set())}>Keine</button>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline" onClick={() => setPriceReview(null)}>Abbrechen</button>
              <button className="btn-primary" disabled={priceSel.size === 0} onClick={applyPriceReview}>
                {priceSel.size} Position(en) aktualisieren
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Korrektur-Rückfrage: abgeschlossenes Dokument umreihen/bearbeiten → Korrekturstand. */}
      {correctionAsk && (
        <Modal open onClose={cancelCorrection} title="Abgeschlossenes Dokument korrigieren?">
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Dieses Dokument ist bereits abgeschlossen. Beim Umreihen/Bearbeiten wird ein
              <b> Korrekturstand </b> erstellt. Die abgeschlossene Version und ihr PDF-Snapshot
              bleiben unverändert erhalten – eine <b>neue Version</b> entsteht erst, wenn du erneut
              auf „Abschließen" klickst.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={cancelCorrection}>Abbrechen</button>
              <button className="btn-primary" onClick={confirmCorrection}>Korrekturstand erstellen</button>
            </div>
          </div>
        </Modal>
      )}
    </DndContext>
  );
}
