// ============================================================
// B4Y SuperAPP – „Positionen einfügen" (EIN zentraler Mehrfach-Einstieg)
// Zwei Quellen:
//  1) Aus Stamm: mehrere Leistungen/Artikel gleichzeitig wählen & einfügen.
//  2) Aus Dokument übernehmen: Positionen aus MEHREREN bestehenden Dokumenten
//     (aktuelles oder – per Suche/Filter – andere berechtigte Projekte) KOPIEREN.
//     Reine Kopie, keine Dokumentkette/Verrechnung; Quelldokumente bleiben
//     unverändert. Mandanten-/Rechtetrennung über die Supabase-RLS.
// Einfügeort: „Einfügen nach Position" (Am Ende ODER gezielt nach einer
// vorhandenen Position/einem Titel des aktuellen Dokuments) – gilt für BEIDE Modi.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Wrench, Package, Plus, Check, Boxes, FileStack, ChevronDown, ChevronRight, Truck } from "lucide-react";
import { Modal } from "../ui";
import { eur } from "../../lib/format";
import { SidebarData, makeArticlePosition, makeServicePosition } from "../../lib/document-sources";
import { DocPosition, lineNet } from "../../lib/document-types";
import { CopyableDoc, loadCopyableDocuments, loadDocumentPositions, copyPositions, mergeCopiedByTitle } from "../../lib/document-copy";
import { statusLabel } from "../../lib/documents-overview";
import { searchCatalog, catalogHitToDocPosition, hitKey, normalizeCatalogUnit, formatHersteller, type CatalogHit } from "../../lib/wholesale";

type Mode = "stamm" | "document" | "grosshandel";
type Tab = "service" | "article";

/** Einfügeziel: null/"" = Am Ende; sonst ID der Position, NACH der eingefügt wird. */
export type InsertTarget = { afterId: string | null };

// ---- „Einfügen nach Position" (gemeinsam für beide Modi) ---------------------
const trunc = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function insertAfterLabel(p: DocPosition): string {
  const name = p.name || (p.type === "title" ? "Titel" : p.type === "text" ? "Textzeile" : "(ohne Bezeichnung)");
  return trunc([p.number, name].filter(Boolean).join(" "));
}

function InsertAfterSelect({ current, value, onChange }: {
  current: DocPosition[]; value: string; onChange: (v: string) => void;
}) {
  if (current.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-slate-500">
      <span className="shrink-0">Einfügen nach Position</span>
      <select className="input w-auto max-w-[260px] py-1.5 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Am Ende einfügen</option>
        {current.map((p) => (
          <option key={p.id} value={p.id}>Nach {insertAfterLabel(p)}</option>
        ))}
      </select>
    </label>
  );
}

export default function MultiInsertModal({
  data, projectId, currentPositions, onInsert, onClose, initialMode, vatDefault,
}: {
  data: SidebarData;
  projectId?: string | null;
  /** Positionen des GEÖFFNETEN Dokuments – Quelle der „Einfügen nach Position"-Auswahl. */
  currentPositions?: DocPosition[];
  onInsert: (positions: DocPosition[], target?: InsertTarget) => void;
  onClose: () => void;
  /** Startmodus (Default „stamm"); der Umschalter im Dialog bleibt immer verfügbar. */
  initialMode?: Mode;
  /** USt-Satz des Dokuments (Reverse Charge §19 → 0) für Großhandels-Positionen. */
  vatDefault?: number;
}) {
  const [mode, setMode] = useState<Mode>(initialMode ?? "stamm");
  // Einfügeziel im Modal gehalten → bleibt beim Moduswechsel erhalten.
  const [afterId, setAfterId] = useState("");
  const current = currentPositions ?? [];
  const doInsert = (positions: DocPosition[]) => onInsert(positions, { afterId: afterId || null });
  const insertAfter = <InsertAfterSelect current={current} value={afterId} onChange={setAfterId} />;

  return (
    <Modal open onClose={onClose} title="Positionen einfügen" size="2xl">
      {/* Modus-Umschalter */}
      <div className="mb-3 flex gap-1 rounded-xl bg-[var(--hover)] p-1">
        <button className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold ${mode === "stamm" ? "bg-[var(--card)] shadow-sm" : "text-slate-400"}`}
          onClick={() => setMode("stamm")}><Boxes size={15} /> Aus Stamm</button>
        <button className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold ${mode === "grosshandel" ? "bg-[var(--card)] shadow-sm" : "text-slate-400"}`}
          onClick={() => setMode("grosshandel")}><Truck size={15} /> Großhandel</button>
        <button className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold ${mode === "document" ? "bg-[var(--card)] shadow-sm" : "text-slate-400"}`}
          onClick={() => setMode("document")}><FileStack size={15} /> Aus Dokument übernehmen</button>
      </div>

      {mode === "stamm"
        ? <StammPicker data={data} onInsert={doInsert} onClose={onClose} insertAfter={insertAfter} />
        : mode === "grosshandel"
        ? <CatalogPicker data={data} vatDefault={vatDefault} onInsert={doInsert} onClose={onClose} insertAfter={insertAfter} />
        : <DocumentPicker projectId={projectId ?? null} onInsert={doInsert} onClose={onClose} insertAfter={insertAfter} />}
    </Modal>
  );
}

// ---- Modus „Großhandel": serverseitige Katalog-Suche (641k+ Artikel) ---------
// Suche über die zentrale searchCatalog-RPC (org-isoliert, max. 40 Treffer),
// Bepreisung über catalogHitToDocPosition (EIN Preis-Kern mit der Voice-
// Pipeline: EK × (1+Materialaufschlag) [+ Montagezeit] × (1+Gesamtaufschlag)).
function CatalogPicker({ data, vatDefault, onInsert, onClose, insertAfter }: {
  data: SidebarData; vatDefault?: number;
  onInsert: (p: DocPosition[]) => void; onClose: () => void; insertAfter?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  // Auswahl: Key = hitKey (Katalog+Artikelnummer), Wert = Menge + optionale Montageminuten.
  const [sel, setSel] = useState<Map<string, { hit: CatalogHit; qty: number; minuten: number }>>(new Map());
  const runIdRef = useRef(0);

  // Debounced Suche (300 ms) mit Race-Schutz: veraltete Antworten verwerfen.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setHits([]); setSearched(false); return; }
    const runId = ++runIdRef.current;
    const timer = setTimeout(() => {
      setSearching(true);
      searchCatalog(query, 20)
        .then((res) => { if (runIdRef.current === runId) { setHits(res); setSearched(true); } })
        .finally(() => { if (runIdRef.current === runId) setSearching(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const toggle = (h: CatalogHit) => setSel((prev) => {
    const n = new Map(prev);
    const k = hitKey(h);
    n.has(k) ? n.delete(k) : n.set(k, { hit: h, qty: 1, minuten: 0 });
    return n;
  });
  const patchSel = (k: string, patch: Partial<{ qty: number; minuten: number }>) =>
    setSel((prev) => {
      const n = new Map(prev);
      const cur = n.get(k);
      if (cur) n.set(k, { ...cur, ...patch });
      return n;
    });

  const mehrereKataloge = useMemo(() => new Set(hits.map((h) => h.catalog_id ?? "")).size > 1, [hits]);
  const vkPreview = (h: CatalogHit, minuten = 0) =>
    catalogHitToDocPosition(h, { kalk: data.kalk, minuten, vatRate: vatDefault }).unit_price;

  function insert() {
    const positions = [...sel.values()].map(({ hit, qty, minuten }) =>
      catalogHitToDocPosition(hit, { kalk: data.kalk, qty, minuten, vatRate: vatDefault }));
    if (positions.length > 0) onInsert(positions);
    onClose();
  }

  return (
    <>
      <div className="relative mb-3">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9 text-sm" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Großhandelskatalog durchsuchen (Bezeichnung, Artikelnummer oder EAN) …" />
      </div>

      <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
        {searching && hits.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">Katalog wird durchsucht …</div>
        ) : !searched ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Suchbegriff eingeben – z. B. „NYM-J 3x1,5", „Steckdose Gira reinweiß" oder eine Artikelnummer.
          </div>
        ) : hits.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Keine Treffer. Prüfe die Schreibweise – oder es ist noch kein Großhandelskatalog importiert
            (Einstellungen → Großhandel &amp; Kataloge).
          </div>
        ) : hits.map((h) => {
          const k = hitKey(h);
          const entry = sel.get(k);
          const checked = !!entry;
          return (
            <div key={k}
              className={`rounded-xl border p-2.5 transition ${checked ? "border-brand-400 bg-brand-50/40 dark:bg-brand-500/10" : "hover:border-brand-300"}`}
              style={{ borderColor: checked ? undefined : "var(--border)" }}>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" className="h-4 w-4 shrink-0" checked={checked} onChange={() => toggle(h)} />
                <Truck size={15} className="shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded bg-[var(--hover)] px-1 font-mono text-[10px] text-slate-500">{h.artikelnummer}</span>
                    <span className="truncate text-sm font-semibold">{h.bezeichnung}</span>
                  </div>
                  <div className="truncate text-[11px] text-slate-400">
                    {[
                      formatHersteller(h.hersteller),
                      h.hersteller_artnr,
                      mehrereKataloge && h.katalog_name ? h.katalog_name : null,
                      `EK ${eur(h.ek_cent / 100)}`,
                      h.metall ? `zzgl. ${h.metall}-Metallzuschlag` : null,
                      `je ${normalizeCatalogUnit(h.einheit)}`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-medium text-[var(--accent)]">{eur(vkPreview(h, entry?.minuten ?? 0))}</div>
                  <div className="text-[10px] text-slate-400">VK kalkuliert</div>
                </div>
              </label>
              {checked && (
                <div className="mt-2 flex flex-wrap items-center gap-3 pl-7 text-xs text-slate-500">
                  <label className="flex items-center gap-1.5">
                    Menge
                    <input type="number" min={0.01} step={1} className="input w-20 py-1 text-xs" value={entry.qty}
                      onChange={(e) => patchSel(k, { qty: Math.max(0.01, Number(e.target.value) || 1) })} />
                  </label>
                  <label className="flex items-center gap-1.5" title="Montagezeit je Einheit – fließt mit dem Stundensatz in den VK ein">
                    Montage (min/Einheit)
                    <input type="number" min={0} step={5} className="input w-20 py-1 text-xs" value={entry.minuten}
                      onChange={(e) => patchSel(k, { minuten: Math.max(0, Number(e.target.value) || 0) })} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-400">{sel.size > 0 ? `${sel.size} ausgewählt` : "Nichts ausgewählt"}</span>
          {insertAfter}
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={insert} disabled={sel.size === 0}>
            {sel.size === 0 ? <Plus size={16} /> : <Check size={16} />} Ausgewählte einfügen{sel.size > 0 ? ` (${sel.size})` : ""}
          </button>
        </div>
      </div>
    </>
  );
}

// ---- Modus 1: Aus Stamm ----------------------------------------------------
function StammPicker({ data, onInsert, onClose, insertAfter }: {
  data: SidebarData; onInsert: (p: DocPosition[]) => void; onClose: () => void; insertAfter?: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("service");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const needle = q.trim().toLowerCase();

  const services = useMemo(() => data.services.filter((s) => {
    if (cat && s.category !== cat) return false;
    if (!needle) return true;
    return [s.name, s.service_number, s.category, s.short_text].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
  }), [data.services, needle, cat]);

  const articles = useMemo(() => data.articles.filter((a) => {
    if (cat && a.category !== cat) return false;
    if (!needle) return true;
    return [a.name, a.article_number, a.category, a.supplier].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
  }), [data.articles, needle, cat]);

  const toggle = (key: string) => setSel((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const selCount = sel.size;

  function insert() {
    const positions: DocPosition[] = [];
    for (const s of data.services) if (sel.has(`s:${s.id}`)) positions.push(makeServicePosition(s));
    for (const a of data.articles) if (sel.has(`a:${a.id}`)) positions.push(makeArticlePosition(a));
    if (positions.length > 0) onInsert(positions);
    onClose();
  }

  const list = tab === "service" ? services : articles;
  const keyOf = (id: string) => (tab === "service" ? `s:${id}` : `a:${id}`);

  return (
    <>
      <div className="mb-3 flex gap-1 rounded-xl bg-[var(--hover)] p-1">
        <button className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold ${tab === "service" ? "bg-[var(--card)] shadow-sm" : "text-slate-400"}`}
          onClick={() => setTab("service")}><Wrench size={15} /> Leistungen <span className="text-xs opacity-70">({services.length})</span></button>
        <button className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold ${tab === "article" ? "bg-[var(--card)] shadow-sm" : "text-slate-400"}`}
          onClick={() => setTab("article")}><Package size={15} /> Artikel <span className="text-xs opacity-70">({articles.length})</span></button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9 text-sm" placeholder="Artikel oder Leistung suchen" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {data.categories.length > 0 && (
          <select className="input w-auto py-1.5 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Alle Gewerke/Kategorien</option>
            {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
        {list.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">Keine Einträge gefunden.</div>
        ) : list.map((item: any) => {
          const key = keyOf(item.id);
          const checked = sel.has(key);
          const price = tab === "service" ? item._sale : item.sale_price;
          const sub = tab === "service" ? (item.category || item.short_text) : (item.category || item.supplier);
          const num = tab === "service" ? item.service_number : item.article_number;
          return (
            <label key={item.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition ${checked ? "border-brand-400 bg-brand-50/40 dark:bg-brand-500/10" : "hover:border-brand-300"}`}
              style={{ borderColor: checked ? undefined : "var(--border)" }}>
              <input type="checkbox" className="h-4 w-4 shrink-0" checked={checked} onChange={() => toggle(key)} />
              {tab === "service" ? <Wrench size={15} className="shrink-0 text-blue-500" /> : <Package size={15} className="shrink-0 text-amber-500" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {num && <span className="shrink-0 rounded bg-[var(--hover)] px-1 font-mono text-[10px] text-slate-500">{num}</span>}
                  <span className="truncate text-sm font-semibold">{item.name}</span>
                </div>
                <div className="truncate text-[11px] text-slate-400">{[sub, `je ${item.unit || "Stk"}`].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="shrink-0 text-right text-sm font-medium text-[var(--accent)]">{eur(price)}</div>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-400">{selCount > 0 ? `${selCount} ausgewählt` : "Nichts ausgewählt"}</span>
          {insertAfter}
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={insert} disabled={selCount === 0}>
            {selCount === 0 ? <Plus size={16} /> : <Check size={16} />} Ausgewählte einfügen{selCount > 0 ? ` (${selCount})` : ""}
          </button>
        </div>
      </div>
    </>
  );
}

// ---- Modus 2: Aus Dokument übernehmen (MEHRERE Quelldokumente) --------------
const posKey = (docId: string, posId: string) => `${docId}::${posId}`;
const isCommercial = (p: DocPosition) => p.type !== "title" && p.type !== "text";

function DocumentPicker({ projectId, onInsert, onClose, insertAfter }: {
  projectId: string | null; onInsert: (p: DocPosition[]) => void; onClose: () => void; insertAfter?: React.ReactNode;
}) {
  const [onlyCurrent, setOnlyCurrent] = useState<boolean>(!!projectId);
  const [docs, setDocs] = useState<CopyableDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);
  const [docSearch, setDocSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");

  // Mehrfachauswahl: gewählte Quelldokumente + je Dokument geladene Positionen (Cache)
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [posByDoc, setPosByDoc] = useState<Map<string, DocPosition[]>>(new Map());
  const [loadingPosIds, setLoadingPosIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [posSel, setPosSel] = useState<Set<string>>(new Set());
  const [withTitles, setWithTitles] = useState(true);
  const [mergeTitles, setMergeTitles] = useState(true); // gleiche Titel zusammenführen (Standard)

  // Dokumentliste laden (RLS = nur eigener Mandant / zugängliche Projekte). Bei
  // Scope-Wechsel die gesamte Auswahl zurücksetzen (saubere Ausgangslage).
  useEffect(() => {
    let cancelled = false;
    setLoadingDocs(true); setDocErr(null);
    setSelectedDocIds(new Set()); setPosByDoc(new Map()); setPosSel(new Set()); setExpanded(new Set());
    loadCopyableDocuments({ projectId: onlyCurrent ? projectId : null })
      .then((rows) => { if (!cancelled) setDocs(rows); })
      .catch((e) => { if (!cancelled) setDocErr(e?.message ?? "Dokumente konnten nicht geladen werden."); })
      .finally(() => { if (!cancelled) setLoadingDocs(false); });
    return () => { cancelled = true; };
  }, [onlyCurrent, projectId]);

  const types = useMemo(() => Array.from(new Set(docs.map((d) => d.type_name).filter(Boolean) as string[])).sort(), [docs]);
  const statuses = useMemo(() => Array.from(new Set(docs.map((d) => d.status).filter(Boolean) as string[])).sort(), [docs]);
  const years = useMemo(() => Array.from(new Set(
    docs.map((d) => (d.last_change ? new Date(d.last_change).getFullYear() : null)).filter(Boolean) as number[],
  )).sort((a, b) => b - a), [docs]);

  const shownDocs = useMemo(() => {
    const n = docSearch.trim().toLowerCase();
    return docs.filter((d) => {
      if (typeFilter && d.type_name !== typeFilter) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (yearFilter && String(d.last_change ? new Date(d.last_change).getFullYear() : "") !== yearFilter) return false;
      if (!n) return true;
      return [d.doc_number, d.type_name, d.project_number, d.project_title, d.customer_name, d.title]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(n));
    });
  }, [docs, docSearch, typeFilter, statusFilter, yearFilter]);

  // Dokument an-/abwählen. Beim Anwählen Positionen laden (Cache) + kaufmännische
  // Positionen vorauswählen; beim Abwählen dessen Positionsauswahl entfernen.
  async function toggleDoc(d: CopyableDoc) {
    const id = d.id;
    if (selectedDocIds.has(id)) {
      setSelectedDocIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setPosSel((prev) => { const n = new Set(prev); [...n].forEach((k) => { if (k.startsWith(id + "::")) n.delete(k); }); return n; });
      return;
    }
    setSelectedDocIds((prev) => new Set(prev).add(id));
    setExpanded((prev) => new Set(prev).add(id));
    const preselect = (pos: DocPosition[]) =>
      setPosSel((prev) => { const n = new Set(prev); pos.filter(isCommercial).forEach((p) => n.add(posKey(id, p.id))); return n; });
    const cached = posByDoc.get(id);
    if (cached) { preselect(cached); return; }
    setLoadingPosIds((prev) => new Set(prev).add(id));
    try {
      const pos = await loadDocumentPositions(d.kind, id);
      setPosByDoc((prev) => new Map(prev).set(id, pos));
      preselect(pos);
    } catch (e: any) {
      setDocErr(e?.message ?? "Positionen konnten nicht geladen werden.");
    } finally {
      setLoadingPosIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }

  const toggleExpand = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePos = (docId: string, posId: string) =>
    setPosSel((prev) => { const n = new Set(prev); const k = posKey(docId, posId); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Alle kaufmännischen Positionen eines Dokuments umschalten
  function toggleDocAll(docId: string) {
    const keys = (posByDoc.get(docId) ?? []).filter(isCommercial).map((p) => posKey(docId, p.id));
    const allOn = keys.length > 0 && keys.every((k) => posSel.has(k));
    setPosSel((prev) => { const n = new Set(prev); keys.forEach((k) => allOn ? n.delete(k) : n.add(k)); return n; });
  }

  // Abschnitt (Titel + Folgepositionen bis zum nächsten Titel) eines Dokuments umschalten
  function toggleSection(docId: string, titleIdx: number) {
    const ps = posByDoc.get(docId) ?? [];
    const keys: string[] = [];
    for (let i = titleIdx + 1; i < ps.length; i++) {
      if (ps[i].type === "title") break;
      if (ps[i].type !== "text") keys.push(posKey(docId, ps[i].id));
    }
    const allOn = keys.length > 0 && keys.every((k) => posSel.has(k));
    setPosSel((prev) => { const n = new Set(prev); keys.forEach((k) => allOn ? n.delete(k) : n.add(k)); return n; });
  }

  // Gewählte Dokumente in Listenreihenfolge (stabile Reihenfolge für Anzeige + Einfügen)
  const selectedDocs = useMemo(() => docs.filter((d) => selectedDocIds.has(d.id)), [docs, selectedDocIds]);

  // Alle wähl-/abwählbaren Keys über ALLE gewählten Dokumente (für „Alle wählen/abwählen")
  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const d of selectedDocs) for (const p of (posByDoc.get(d.id) ?? [])) if (isCommercial(p)) keys.push(posKey(d.id, p.id));
    return keys;
  }, [selectedDocs, posByDoc]);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => posSel.has(k));
  const toggleAllGlobal = () => setPosSel((prev) => { const n = new Set(prev); allKeys.forEach((k) => allSelected ? n.delete(k) : n.add(k)); return n; });

  // Ausgewählte Positionen (für Anzahl + Netto-Summe)
  const selected = useMemo(() => {
    const arr: DocPosition[] = [];
    for (const d of selectedDocs) for (const p of (posByDoc.get(d.id) ?? [])) if (posSel.has(posKey(d.id, p.id))) arr.push(p);
    return arr;
  }, [selectedDocs, posByDoc, posSel]);
  const selCount = selected.length;
  const netSum = useMemo(() => selected.reduce((s, p) => s + lineNet(p), 0), [selected]);

  function insert() {
    // Pro Quelldokument die geordneten, ausgewählten Positionen (inkl. zugehöriger
    // Titel) kopieren – copyPositions vergibt neue IDs, remappt Regie-Bezüge und
    // setzt die copied_from_*-Quellhinweise (KEINE Dokumentkette).
    const perDoc: DocPosition[][] = [];
    for (const d of selectedDocs) {
      const ps = posByDoc.get(d.id) ?? [];
      const ordered: DocPosition[] = [];
      let pendingTitle: DocPosition | null = null;
      for (const p of ps) {
        if (p.type === "title") { pendingTitle = p; continue; }
        if (posSel.has(posKey(d.id, p.id))) {
          if (withTitles && pendingTitle) { ordered.push(pendingTitle); pendingTitle = null; }
          ordered.push(p);
        }
      }
      if (ordered.length === 0) continue;
      perDoc.push(copyPositions(ordered, d, { withTitles }));
    }
    // Zusammenführen: bei „gleiche Titel zusammenführen" Positionen gleichnamiger
    // Titel unter EINEM Titel bündeln; sonst Dokumente einfach hintereinander.
    const result = (withTitles && mergeTitles) ? mergeCopiedByTitle(perDoc) : perDoc.flat();
    if (result.length > 0) onInsert(result);
    onClose();
  }

  return (
    <>
      {/* Projekt-Scope + Suche + Filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {projectId && (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={onlyCurrent} onChange={(e) => setOnlyCurrent(e.target.checked)} />
            Nur aktuelles Projekt
          </label>
        )}
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9 text-sm" placeholder="Dokument/Projekt/Kunde suchen" value={docSearch} onChange={(e) => setDocSearch(e.target.value)} />
        </div>
        {types.length > 0 && (
          <select className="input w-auto py-1.5 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Alle Typen</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {statuses.length > 0 && (
          <select className="input w-auto py-1.5 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Alle Status</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {years.length > 0 && (
          <select className="input w-auto py-1.5 text-sm" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">Alle Jahre</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        )}
      </div>

      {docErr && <div className="mb-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{docErr}</div>}

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Dokumentliste (Mehrfachauswahl per Checkbox) */}
        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
          {loadingDocs ? (
            <div className="py-8 text-center text-sm text-slate-400">Lädt …</div>
          ) : shownDocs.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">Keine Dokumente gefunden.</div>
          ) : shownDocs.map((d) => {
            const checked = selectedDocIds.has(d.id);
            return (
              <label key={d.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-left transition ${checked ? "border-brand-400 bg-brand-50/40 dark:bg-brand-500/10" : "hover:border-brand-300"}`}
                style={{ borderColor: checked ? undefined : "var(--border)" }}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} onChange={() => toggleDoc(d)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{d.doc_number || "(ohne Nr.)"}</span>
                    <span className="shrink-0 rounded bg-[var(--hover)] px-1.5 text-[10px] uppercase text-slate-400">{d.type_name}</span>
                  </div>
                  <div className="truncate text-[11px] text-slate-400">
                    {[d.project_number, d.customer_name, d.title].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px]">
                    {/* Stornierte Quellen bleiben kopierbar (reine Kopie, keine Kette) – aber
                        UNÜBERSEHBAR rot markiert, damit die Übernahme bewusst passiert. */}
                    <span className={d.is_canceled ? "font-semibold text-rose-500" : "text-slate-400"}>
                      {statusLabel(d.status_norm ?? d.status)}{d.is_locked && !d.is_canceled ? " · gesperrt" : ""}
                    </span>
                    <span className="font-medium text-[var(--accent)]">{eur(d.net)}</span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Positionen – gruppiert nach gewähltem Dokument */}
        <div className="max-h-[52vh] overflow-y-auto rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
          {selectedDocs.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">Dokument(e) links auswählen …</div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <button className="text-xs font-medium text-[var(--accent)] hover:underline" onClick={toggleAllGlobal}>
                  {allSelected ? "Alle abwählen" : "Alle wählen"}
                </button>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={withTitles} onChange={(e) => setWithTitles(e.target.checked)} />
                    Titel/Abschnitte mitkopieren
                  </label>
                  <label className={`flex items-center gap-1 text-[11px] ${withTitles ? "text-slate-500" : "text-slate-300 dark:text-slate-600"}`}>
                    <input type="checkbox" className="h-3.5 w-3.5" disabled={!withTitles} checked={mergeTitles} onChange={(e) => setMergeTitles(e.target.checked)} />
                    Gleiche Titel zusammenführen
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                {selectedDocs.map((d) => {
                  const ps = posByDoc.get(d.id) ?? [];
                  const loading = loadingPosIds.has(d.id);
                  const open = expanded.has(d.id);
                  const docKeys = ps.filter(isCommercial).map((p) => posKey(d.id, p.id));
                  const docSel = docKeys.filter((k) => posSel.has(k)).length;
                  return (
                    <div key={d.id} className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center gap-2 rounded-t-lg bg-[var(--hover)] px-2 py-1.5">
                        <button className="shrink-0 text-slate-400 hover:text-[var(--text)]" onClick={() => toggleExpand(d.id)} title={open ? "Einklappen" : "Ausklappen"}>
                          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                        <span className="truncate text-xs font-bold">{d.doc_number || "(ohne Nr.)"}</span>
                        <span className="shrink-0 text-[10px] uppercase text-slate-400">{d.type_name}</span>
                        {d.is_canceled && <span className="shrink-0 rounded bg-rose-500/15 px-1.5 text-[10px] font-semibold uppercase text-rose-500">Storniert</span>}
                        <span className="ml-auto shrink-0 text-[11px] text-slate-400">{docSel}/{docKeys.length}</span>
                        {docKeys.length > 0 && (
                          <button className="shrink-0 text-[11px] font-medium text-[var(--accent)] hover:underline" onClick={() => toggleDocAll(d.id)}>
                            {docSel === docKeys.length ? "keine" : "alle"}
                          </button>
                        )}
                      </div>
                      {open && (
                        <div className="space-y-1 px-2 py-1.5">
                          {loading ? (
                            <div className="py-4 text-center text-xs text-slate-400">Positionen werden geladen …</div>
                          ) : ps.length === 0 ? (
                            <div className="py-4 text-center text-xs text-slate-400">Keine Positionen.</div>
                          ) : ps.map((p, idx) => p.type === "title" ? (
                            <button key={p.id} onClick={() => toggleSection(d.id, idx)}
                              className="flex w-full items-center gap-2 rounded-lg bg-[var(--hover)] px-2 py-1 text-left text-xs font-semibold text-slate-500 hover:text-[var(--text)]">
                              <span className="font-mono">{p.number}</span> {p.name || "Titel"} <span className="ml-auto text-[10px] opacity-70">Abschnitt</span>
                            </button>
                          ) : p.type === "text" ? (
                            <div key={p.id} className="px-2 py-1 text-[11px] italic text-slate-400">{p.name || "Text"}</div>
                          ) : (
                            <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-[var(--hover)]">
                              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={posSel.has(posKey(d.id, p.id))} onChange={() => togglePos(d.id, p.id)} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm">{p.number ? `${p.number} · ` : ""}{p.name || "(ohne Bezeichnung)"}</div>
                                <div className="text-[11px] text-slate-400">{Number(p.qty) || 0} {p.unit} · {eur(p.unit_price)} → <b className="text-[var(--accent)]">{eur(lineNet(p))}</b></div>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-400">
            {selCount > 0 ? `${selCount} Position(en) · ${eur(netSum)} netto` : "Nichts ausgewählt"}
          </span>
          {insertAfter}
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={insert} disabled={selCount === 0}>
            {selCount === 0 ? <Plus size={16} /> : <Check size={16} />} Kopieren &amp; einfügen{selCount > 0 ? ` (${selCount})` : ""}
          </button>
        </div>
      </div>
    </>
  );
}
