// ============================================================
// B4Y SuperAPP – Rechte Dokument-Seitenleiste (HERO-Stil)
// Tabs: „Artikel & Leistungen" / „Texte & Titel"
// Suche, Filter, +Buttons, kompakte Ergebnisliste, Drag&Drop.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Search, Plus, GripVertical, Package, Wrench, FileText, Heading,
  RefreshCw, ChevronDown, Truck,
} from "lucide-react";
import { eur } from "../../lib/format";
import {
  SidebarData, SidebarArticle, SidebarService, TextBlock,
  makeArticlePosition, makeServicePosition, makeTextPosition, makeTitlePosition,
} from "../../lib/document-sources";
import { DocPosition } from "../../lib/document-types";
import { searchCatalog, catalogHitToDocPosition, hitKey, normalizeCatalogUnit, type CatalogHit } from "../../lib/wholesale";

type Tab = "items" | "texts";

export type SidebarHandlers = {
  data: SidebarData;
  loading: boolean;
  onQuickAdd: (pos: DocPosition) => void;
  // categoryHint = aktueller Gewerk-/Kategorie-Filter → zentrale Maske kann ihn vorbelegen.
  onCreate: (kind: "article" | "service" | "text" | "title", categoryHint?: string) => void;
  // Direkt im Editor einzufügende Sonderpositionen (kein Stammdatensatz):
  onInsertVariable?: () => void;       // freie, anpassbare Position
  onInsertRegieHour?: () => void;      // Regiestunde aus Stundensatz wählen
  onInsertRegieMaterial?: () => void;  // Regiematerial (Modus wählen)
  onReload: () => void;
  // Rechte: Stammdaten dauerhaft anlegen nur mit passender Berechtigung.
  // Einfügen/Variable Positionen/freier Text bleiben für alle möglich.
  canCreate: { article: boolean; service: boolean; text: boolean; title: boolean };
  /** USt-Satz des Dokuments (Reverse Charge §19 → 0) für Großhandels-Positionen. */
  vatDefault?: number;
};

// Eindeutige Drag-ID je Quellelement (kein Konflikt mit Canvas-IDs).
const dragId = (kind: string, id: string) => `src:${kind}:${id}`;

function DraggableRow({
  id, build, onQuickAdd, children,
}: {
  id: string;
  build: () => DocPosition;
  onQuickAdd: (pos: DocPosition) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { from: "sidebar", build },
  });
  return (
    // Die GANZE Karte ist Drag-Fläche (nicht nur der Griff). Der Plus-Button bleibt klickbar:
    // sein PointerDown wird gestoppt, damit der Drag-Sensor nicht anspringt.
    <div
      ref={setNodeRef}
      className={`group flex items-stretch gap-1 rounded-xl border bg-[var(--card)] transition cursor-grab touch-none active:cursor-grabbing ${
        isDragging ? "opacity-40" : "hover:border-brand-400"
      }`}
      style={{ borderColor: "var(--border)" }}
      {...attributes}
      {...listeners}
    >
      <span
        className="flex items-center px-1 text-slate-300 transition group-hover:text-slate-500"
        title="Ziehen zum Einfügen"
        aria-hidden="true"
      >
        <GripVertical size={16} />
      </span>
      <div className="min-w-0 flex-1 py-2 pr-1">{children}</div>
      <button
        type="button"
        className="flex items-center px-2 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-[var(--accent)]"
        title="Ans Ende einfügen"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onQuickAdd(build()); }}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

export default function ContentSidebar({ data, loading, onQuickAdd, onCreate, onInsertVariable, onInsertRegieHour, onInsertRegieMaterial, onReload, canCreate, vatDefault }: SidebarHandlers) {
  const [tab, setTab] = useState<Tab>("items");
  const [q, setQ] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const needle = q.trim().toLowerCase();

  // Großhandelskatalog: serverseitige Suche (641k+ Artikel – NIE in den Client
  // laden). Debounced 300 ms ab 3 Zeichen, Race-Schutz über runId. Kein Katalog
  // importiert → leere Treffer, Abschnitt degradiert still.
  const [catalogHits, setCatalogHits] = useState<CatalogHit[]>([]);
  const catalogRunRef = useRef(0);
  useEffect(() => {
    if (tab !== "items" || needle.length < 3) { setCatalogHits([]); return; }
    const runId = ++catalogRunRef.current;
    const timer = setTimeout(() => {
      searchCatalog(needle, 8).then((res) => {
        if (catalogRunRef.current === runId) setCatalogHits(res);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [tab, needle]);

  const articles = useMemo(() => data.articles.filter((a) => {
    if (filterSupplier && a.supplier !== filterSupplier) return false;
    if (filterCategory && a.category !== filterCategory) return false;
    if (!needle) return true;
    return [a.name, a.article_number, a.category, a.supplier].filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  }), [data.articles, needle, filterSupplier, filterCategory]);

  const services = useMemo(() => data.services.filter((s) => {
    if (filterCategory && s.category !== filterCategory) return false;
    if (!needle) return true;
    return [s.name, s.service_number, s.category, s.short_text].filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  }), [data.services, needle, filterCategory]);

  const texts = useMemo(() => data.texts.filter((t) =>
    !needle || [t.title, t.content, t.category, t.sort_order].some((v) => String(v).toLowerCase().includes(needle))
  ), [data.texts, needle]);

  const titles = useMemo(() => data.titles.filter((t) =>
    !needle || [t.title, t.sort_order].some((v) => String(v).toLowerCase().includes(needle))
  ), [data.titles, needle]);

  return (
    <aside className="flex h-full flex-col">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-[var(--hover)] p-1">
        <TabBtn active={tab === "items"} onClick={() => setTab("items")}>Artikel &amp; Leistungen</TabBtn>
        <TabBtn active={tab === "texts"} onClick={() => setTab("texts")}>Texte &amp; Titel</TabBtn>
      </div>

      {/* 1) Schnellaktionen – nur dokumentbezogene Positionen (Stammdaten-Anlage liegt oben in der Toolbar) */}
      {tab === "items" ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {onInsertVariable && <button className="btn-outline px-2 py-1 text-xs" title="Variable Position: freie, im Dokument anpassbare Position" onClick={onInsertVariable}><Plus size={13} /> Variable Position</button>}
          {onInsertRegieHour && <button className="btn-outline px-2 py-1 text-xs" title="Regieleistung aus Stundensatz einfügen" onClick={onInsertRegieHour}><Plus size={13} /> Regieleistung</button>}
          {onInsertRegieMaterial && <button className="btn-outline px-2 py-1 text-xs" title="Regie-Material einfügen (manuell / % / fix)" onClick={onInsertRegieMaterial}><Plus size={13} /> Regie-Material</button>}
          <button className="btn-ghost ml-auto px-2 py-1 text-xs" title="Liste neu laden" onClick={onReload}><RefreshCw size={13} /></button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {canCreate.text && <button className="btn-outline px-2 py-1 text-xs" onClick={() => onCreate("text")}><Plus size={13} /> Textbaustein</button>}
          {canCreate.title && <button className="btn-outline px-2 py-1 text-xs" onClick={() => onCreate("title")}><Plus size={13} /> Titel</button>}
          <button className="btn-ghost ml-auto px-2 py-1 text-xs" title="Liste neu laden" onClick={onReload}><RefreshCw size={13} /></button>
        </div>
      )}

      {/* 2) Suchfeld */}
      <div className="relative mt-2">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9 text-sm"
          placeholder={tab === "items" ? "Artikel oder Leistung suchen" : "Text oder Titel suchen"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* 3) Filter – direkt oberhalb der Ergebnisliste, weil er sich genau darauf bezieht */}
      {tab === "items" && (
        <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <button
            className="flex items-center gap-1 self-start text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-[var(--text)]"
            onClick={() => setShowFilters((v) => !v)}
          >
            <ChevronDown size={13} className={`transition ${showFilters ? "rotate-180" : ""}`} /> Filter für Liste
          </button>
          {showFilters && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select className="input py-1 text-xs" value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
                <option value="">Lieferant: alle</option>
                {data.suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input py-1 text-xs" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                <option value="">Gewerk/Kategorie: alle</option>
                {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Ergebnisliste */}
      <div className="mt-3 flex-1 space-y-4 overflow-y-auto pr-1">
        {loading ? (
          <div className="py-10 text-center text-sm text-slate-400">Lädt …</div>
        ) : tab === "items" ? (
          <>
            <Section title="Leistungen" count={services.length}>
              {services.map((s) => (
                <DraggableRow key={s.id} id={dragId("service", s.id)} build={() => makeServicePosition(s)} onQuickAdd={onQuickAdd}>
                  <ServiceCard s={s} />
                </DraggableRow>
              ))}
              {services.length === 0 && <Empty />}
            </Section>
            <Section title="Artikel" count={articles.length}>
              {articles.map((a) => (
                <DraggableRow key={a.id} id={dragId("article", a.id)} build={() => makeArticlePosition(a)} onQuickAdd={onQuickAdd}>
                  <ArticleCard a={a} />
                </DraggableRow>
              ))}
              {articles.length === 0 && <Empty />}
            </Section>
            {needle.length >= 3 && catalogHits.length > 0 && (
              <Section title="Großhandelskatalog" count={catalogHits.length}>
                {catalogHits.map((h) => (
                  <DraggableRow key={hitKey(h)} id={dragId("catalog", hitKey(h))}
                    build={() => catalogHitToDocPosition(h, { kalk: data.kalk, vatRate: vatDefault })}
                    onQuickAdd={onQuickAdd}>
                    <CatalogCard h={h} kalk={data.kalk} vatDefault={vatDefault} />
                  </DraggableRow>
                ))}
              </Section>
            )}
          </>
        ) : (
          <>
            <Section title="Titel / Überschriften" count={titles.length}>
              {titles.map((t) => (
                <DraggableRow key={t.id} id={dragId("title", t.id)} build={() => makeTitlePosition(t)} onQuickAdd={onQuickAdd}>
                  <TextCard t={t} isTitle />
                </DraggableRow>
              ))}
              {titles.length === 0 && <Empty />}
            </Section>
            <Section title="Textbausteine" count={texts.length}>
              {texts.map((t) => (
                <DraggableRow key={t.id} id={dragId("text", t.id)} build={() => makeTextPosition(t)} onQuickAdd={onQuickAdd}>
                  <TextCard t={t} />
                </DraggableRow>
              ))}
              {texts.length === 0 && <Empty />}
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
        active ? "bg-[var(--card)] text-[var(--text)] shadow-sm" : "text-slate-400 hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>{title}</span><span>{count}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

const Empty = () => <div className="px-1 py-2 text-xs text-slate-400">Keine Einträge.</div>;

// Kleine Nummern-Plakette (Leistungs-/Artikelnummer bzw. Sortier-Nr. bei Texten/Titeln).
function NumberTag({ value }: { value: string | number }) {
  return (
    <span className="shrink-0 rounded bg-[var(--hover)] px-1 font-mono text-[10px] text-slate-500" title="Nummer">
      {value}
    </span>
  );
}

function ArticleCard({ a }: { a: SidebarArticle }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Package size={13} className="shrink-0 text-amber-500" />
        {a.article_number && <NumberTag value={a.article_number} />}
        <span className="truncate text-sm font-semibold">{a.name}</span>
      </div>
      <div className="truncate text-[11px] text-slate-400">
        {[a.category || a.description, a.usage_count ? `${a.usage_count}x benutzt` : null].filter(Boolean).join(" | ")}
      </div>
      <div className="text-[11px] font-medium text-[var(--accent)]">{eur(a.sale_price)} / {a.unit || "Stk"}</div>
    </div>
  );
}

function ServiceCard({ s, variable }: { s: SidebarService; variable?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Wrench size={13} className={`shrink-0 ${variable ? "text-emerald-500" : "text-blue-500"}`} />
        {!variable && s.service_number && <NumberTag value={s.service_number} />}
        <span className="truncate text-sm font-semibold">{s.name}</span>
        {variable && <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[10px] font-medium text-emerald-600">variabel</span>}
      </div>
      <div className="truncate text-[11px] text-slate-400">
        {[s.category || s.short_text, !variable && s.usage_count ? `${s.usage_count}x benutzt` : null].filter(Boolean).join(" | ")}
      </div>
      {variable
        ? <div className="text-[11px] font-medium text-emerald-600">frei anpassbar – Preis im Dokument</div>
        : <div className="text-[11px] font-medium text-[var(--accent)]">{eur(s._sale)} / {s.unit || "Stk"}</div>}
    </div>
  );
}

// Karte eines Großhandels-Treffers: EK + kalkulierter VK (zentrale Formel) +
// Metallzuschlags-Hinweis. Tokens statt fixer Farben (Dark/Light/Augenschon).
function CatalogCard({ h, kalk, vatDefault }: { h: CatalogHit; kalk: SidebarData["kalk"]; vatDefault?: number }) {
  const vk = catalogHitToDocPosition(h, { kalk, vatRate: vatDefault }).unit_price;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Truck size={13} className="shrink-0 text-amber-500" />
        <NumberTag value={h.artikelnummer} />
        <span className="truncate text-sm font-semibold">{h.bezeichnung}</span>
      </div>
      <div className="truncate text-[11px] text-slate-400">
        {[h.katalog_name, `EK ${eur(h.ek_cent / 100)}`, h.metall ? `zzgl. ${h.metall}-Zuschlag` : null]
          .filter(Boolean).join(" · ")}
      </div>
      <div className="text-[11px] font-medium text-[var(--accent)]">{eur(vk)} / {normalizeCatalogUnit(h.einheit)}</div>
    </div>
  );
}

function TextCard({ t, isTitle }: { t: TextBlock; isTitle?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {isTitle ? <Heading size={13} className="shrink-0" style={{ color: "var(--accent)" }} /> : <FileText size={13} className="shrink-0 text-slate-400" />}
        {t.sort_order ? <NumberTag value={t.sort_order} /> : null}
        <span className="truncate text-sm font-semibold">{t.title}</span>
      </div>
      <div className="text-[11px] text-slate-400">
        <span className="mr-1 rounded bg-[var(--hover)] px-1">{isTitle ? "Titel" : "Text"}</span>
        {!isTitle && t.content && <span className="line-clamp-2">{t.content}</span>}
      </div>
    </div>
  );
}
