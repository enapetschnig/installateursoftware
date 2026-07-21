import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, LayoutGrid, List as ListIcon, ListTree, Pencil } from "lucide-react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { supabase } from "../lib/supabase";
import { Project, Contact, stageTone } from "../lib/types";
import { useProjectConfig, useEmployees } from "../lib/project-config";
import { buildStruktur } from "../lib/projekt-struktur";
import ProjektStrukturListe from "../components/project/ProjektStrukturListe";
import { projectRoute } from "../lib/documents-overview";
import { PageHeader, Spinner, Empty, Badge, TableCell } from "../components/ui";
import { SearchInput } from "../components/calc-ui";
import { eur, dateAt } from "../lib/format";
import { toast, toastError } from "../lib/toast";
import ProjectForm from "../components/ProjectForm";
import { contactDisplayName, formatAddressInline } from "../lib/contact-name";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";
import { useAuth } from "../lib/auth";
import { usePermissions } from "../lib/permissions";

const contactName = (c?: Contact) => contactDisplayName(c, { fallback: "–" });

// Projektjahr ermitteln: 1) Jahr aus Projektnummer (z.B. 2026-00123),
// 2) sonst Erstellungsdatum, 3) sonst letzte Änderung, 4) sonst kein Jahr.
function projectYear(p: Project): number | null {
  // Jahr aus der Projektnummer – letzten Treffer nehmen (Jahr steht am Ende, z.B. PROJEKT-0001-2026)
  const all = (p.project_number ?? "").match(/(?:19|20)\d{2}/g);
  if (all && all.length) return Number(all[all.length - 1]);
  const fromDate = (d?: string | null) => {
    if (!d) return null;
    const y = new Date(d).getFullYear();
    return Number.isNaN(y) ? null : y;
  };
  return fromDate(p.created_at) ?? fromDate(p.updated_at);
}

export default function Projects() {
  const [list, setList] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [orderVol, setOrderVol] = useState<Record<string, number>>({}); // project_id -> Auftragsvolumen netto
  const [loading, setLoading] = useState(true);
  // Ansicht: Struktur (Art → Stufen, Default) | Liste | Board.
  // Die Wahl wird gemerkt – wer bewusst umschaltet, landet dort wieder.
  const [view, setView] = useState<"struktur" | "list" | "board">(() => {
    const ausUrl = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("ansicht");
    if (ausUrl === "liste") return "list";
    if (ausUrl === "board") return "board";
    if (ausUrl === "struktur") return "struktur";
    const gemerkt = localStorage.getItem("b4y-projekte-ansicht");
    return gemerkt === "list" || gemerkt === "board" ? gemerkt : "struktur";
  });
  const setViewGemerkt = (v: "struktur" | "list" | "board") => {
    setView(v);
    localStorage.setItem("b4y-projekte-ansicht", v);
  };
  const [edit, setEdit] = useState<Project | "new" | null>(null);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const cfg = useProjectConfig();
  const { names: employeeNames } = useEmployees();
  // Projekttyp aus URL (?typ=…, z.B. Sidebar-Unterkategorie).
  const typParam = params.get("typ");
  // Direkteinstieg aus dem Dashboard: ?art=Badsanierung&status=Angebot%20gesendet
  const artParam = params.get("art");
  const statusParam = params.get("status");

  const [q, setQ] = useState("");
  const [fType, setFType] = useState("");          // gewählter Projekttyp (= projects.category); "" = alle
  const [fStatus, setFStatus] = useState("");
  const [fResp, setFResp] = useState("");
  const [fArchived, setFArchived] = useState(false);
  const [fYear, setFYear] = useState("");

  // Projekttyp-Filter aus der URL ableiten: Mit ?typ=… auf die Kategorie setzen,
  // OHNE typ-Param (Klick auf Hauptmenü „Projekte") wieder auf „Alle" zurücksetzen.
  // Kein Hardcoding – Typen stammen aus den Stammdaten (cfg.types).
  useEffect(() => {
    if (!typParam) { setFType(""); return; }
    const t = cfg.types.find((x) => x.slug === typParam);
    if (t) setFType(t.category);
  }, [typParam, cfg.types]);

  // Aus der Dashboard-Kachel kommend: Projektart + Stufe direkt vorbelegen.
  useEffect(() => {
    if (artParam) setFType(artParam);
    if (statusParam) setFStatus(statusParam);
  }, [artParam, statusParam]);

  // Aktuell gewählter Typ als Objekt (für Titel + passende Statusliste).
  const selType = cfg.types.find((t) => t.category === fType) ?? null;
  // Eindeutige Projekttypen (nach category) für das Filter-Dropdown – nur aktive (cfg.types ist bereits aktiv-gefiltert).
  const typeOptions = useMemo(() => {
    const seen = new Set<string>(); const out: { category: string; label: string }[] = [];
    for (const t of cfg.types) if (t.category && !seen.has(t.category)) { seen.add(t.category); out.push({ category: t.category, label: t.label }); }
    return out;
  }, [cfg.types]);

  // Mitarbeiter-Filteroptionen: echte (aktive) Mitarbeiter aus der DB +
  // evtl. in Altprojekten gespeicherte Namen (damit Bestandsdaten filterbar bleiben).
  const responsibleOptions = useMemo(() => {
    const set = new Set<string>(employeeNames);
    for (const p of list) if (p.responsible) set.add(p.responsible);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  }, [employeeNames, list]);

  // Stabil via useCallback, damit der Re-Load-Effekt darunter eine feste Referenz
  // als Dependency nutzen kann (keine Endlosschleife – nur Setter im Body).
  const load = useCallback(async () => {
    setLoading(true);
    const [p, c, o] = await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("contacts").select("*"),
      // Auftragsvolumen netto je Projekt: nur gültige Aufträge (nicht gelöscht/storniert/archiviert).
      supabase.from("orders").select("project_id, net")
        .is("deleted_at", null).is("archived_at", null).neq("status", "storniert"),
    ]);
    setList((p.data as Project[]) ?? []);
    const map: Record<string, Contact> = {};
    for (const ct of ((c.data as Contact[]) ?? [])) map[ct.id] = ct;
    setContacts(map);
    const vol: Record<string, number> = {};
    for (const r of ((o.data as { project_id: string | null; net: number | null }[]) ?? [])) {
      if (!r.project_id) continue;
      vol[r.project_id] = (vol[r.project_id] ?? 0) + (Number(r.net) || 0);
    }
    setOrderVol(vol);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Re-Load, wenn die Liste wieder sichtbar/fokussiert wird: Nach einem
  // Statuswechsel in der Projekt-Detailseite (oder anderen Änderungen) und
  // Rückkehr zur Liste/zum Board zeigt der State sonst veraltete Daten,
  // weil load() nur einmal beim Mount lief. So aktualisieren sich Liste UND
  // Board/Bucket ohne harten Browser-Reload.
  useEffect(() => {
    const reloadIfVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", reloadIfVisible);
    return () => {
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", reloadIfVisible);
    };
  }, [load]);

  // Jahre automatisch aus den vorhandenen Projekten, absteigend sortiert.
  const yearInfo = useMemo(() => {
    const set = new Set<number>();
    let hasNone = false;
    for (const p of list) { const y = projectYear(p); if (y) set.add(y); else hasNone = true; }
    return { years: [...set].sort((a, b) => b - a), hasNone };
  }, [list]);

  const shown = useMemo(() => list.filter((p) => {
    if (fType && p.category !== fType) return false;
    if (fArchived ? !p.archived : p.archived) return false;
    if (fStatus && p.stage !== fStatus) return false;
    if (fResp && p.responsible !== fResp) return false;
    if (fYear) {
      const y = projectYear(p);
      if (fYear === "__none__") { if (y !== null) return false; }
      else if (String(y) !== fYear) return false;
    }
    if (q.trim()) {
      const s = q.toLowerCase();
      const cn = contactName(p.contact_id ? contacts[p.contact_id] : undefined);
      const hit = [p.project_number, p.title, cn, p.street, p.city, p.category, p.stage, p.responsible, p.internal_note, p.description]
        .filter(Boolean).some((v) => v!.toLowerCase().includes(s));
      if (!hit) return false;
    }
    return true;
  }), [list, contacts, fType, fArchived, fStatus, fResp, fYear, q]);

  const { session } = useAuth();
  const { can, isAdmin } = usePermissions();
  const mayEditStage = isAdmin || can("projects", "edit");
  const userId = session?.user?.id ?? null;

  // Statusfarben (project_statuses_global) für die Board-Spalten – zentral aus den
  // Stammdaten, keine Hardcodierung. label -> color.
  const [stageColors, setStageColors] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from("project_statuses_global").select("label,color").then(({ data }) => {
      const m: Record<string, string> = {};
      for (const r of ((data as { label: string; color: string | null }[]) ?? [])) if (r.color) m[r.label] = r.color;
      setStageColors(m);
    });
  }, []);

  // Board-Spalten = geordnete Projektstufen der aktuellen Pipeline (Projekttyp).
  // Ohne Typ-Filter: alle global aktiven Status; zusätzlich in Projekten real
  // vorkommende Status ans Ende, damit keine Karte verschwindet.
  const boardColumns = useMemo(() => {
    const base = selType ? cfg.statusLabelsFor(selType.category) : cfg.allStatusLabels;
    const cols = [...base];
    const extra = new Set<string>();
    for (const p of shown) if (p.stage && !cols.includes(p.stage)) extra.add(p.stage);
    return [...cols, ...Array.from(extra)];
  }, [selType, cfg, shown]);

  // Projektstatus per Drag&Drop ändern (optimistic). Rollback rollt gezielt NUR
  // die betroffene Zeile auf ihren alten Status zurück (funktionales setList),
  // damit ein paralleler Move eines anderen Projekts nicht überschrieben wird.
  const moveProjectToStage = useCallback(async (projectId: string, stage: string) => {
    let prevStage: string | null = null;
    setList((cur) => cur.map((p) => {
      if (p.id !== projectId) return p;
      prevStage = p.stage;
      return { ...p, stage };
    }));
    const { error } = await supabase.from("projects").update({ stage }).eq("id", projectId);
    if (error) {
      setList((cur) => cur.map((p) => (p.id === projectId ? { ...p, stage: prevStage ?? p.stage } : p)));
      toastError("Status konnte nicht geändert werden.");
    } else {
      toast(`Status: ${stage}`);
    }
  }, []);
  const projSort = useTableSort<Project>(
    "projects",
    {
      nr: { get: (p) => p.project_number, type: "text" },
      title: { get: (p) => p.title, type: "text" },
      customer: { get: (p) => contactName(p.contact_id ? contacts[p.contact_id] : undefined), type: "text" },
      address: { get: (p) => formatAddressInline(p), type: "text" },
      category: { get: (p) => p.category, type: "text" },
      stage: { get: (p) => p.stage, type: "text" },
      responsible: { get: (p) => p.responsible, type: "text" },
      volume: { get: (p) => orderVol[p.id], type: "number" },
      updated: { get: (p) => p.updated_at ?? p.created_at, type: "date" },
    },
    { userId, default: { key: "updated", dir: "desc" } }
  );
  const shownSorted = useMemo(() => projSort.sortRows(shown), [projSort, shown]);

  // Struktur "Projektart → Stufe" aus den bereits geladenen Projekten: keine
  // zusätzliche Abfrage, und die Zähler stimmen exakt mit der Liste darunter
  // überein (folgen also den aktiven Filtern).
  const struktur = useMemo(
    () => buildStruktur(shown, {
      artReihenfolge: cfg.types.map((t) => t.category),
      stufenFuerArt: (art) => cfg.statusLabelsFor(art),
      farben: stageColors,
    }),
    [shown, cfg, stageColors],
  );

  return (
    <>
      <PageHeader title={selType ? `Projekte – ${selType.label}` : "Projekte"}
        subtitle={`${shown.length} ${fArchived ? "archiviert" : "aktiv"}`}
        action={
          <div className="flex gap-2">
            <div className="flex rounded-xl border border-slate-200 p-1 dark:border-white/10">
              <button title="Struktur: Projektart → Stufen" onClick={() => setViewGemerkt("struktur")} className={`rounded-lg p-2 ${view === "struktur" ? "bg-brand-600 text-white" : "text-slate-500"}`}><ListTree size={16} /></button>
              <button title="Liste" onClick={() => setViewGemerkt("list")} className={`rounded-lg p-2 ${view === "list" ? "bg-brand-600 text-white" : "text-slate-500"}`}><ListIcon size={16} /></button>
              <button title="Board" onClick={() => setViewGemerkt("board")} className={`rounded-lg p-2 ${view === "board" ? "bg-brand-600 text-white" : "text-slate-500"}`}><LayoutGrid size={16} /></button>
            </div>
            <button className="btn-primary" data-tour-id="project-create-button" onClick={() => setEdit("new")}><Plus size={18} /> Neues Projekt</button>
          </div>
        } />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Suche: Nr., Projekt, Kunde, Adresse, Status, Mitarbeiter" />
        <select className="input max-w-[12rem]" value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">Alle Projekttypen</option>
          {typeOptions.map((t) => <option key={t.category} value={t.category}>{t.label}</option>)}
        </select>
        <select className="input max-w-[12rem]" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Alle Status</option>
          {(selType ? cfg.statusLabelsFor(selType.category) : cfg.allStatusLabels).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-[12rem]" value={fResp} onChange={(e) => setFResp(e.target.value)}>
          <option value="">Alle Mitarbeiter</option>
          {responsibleOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="input max-w-[10rem]" value={fArchived ? "1" : "0"} onChange={(e) => setFArchived(e.target.value === "1")}>
          <option value="0">Aktiv</option>
          <option value="1">Archiviert</option>
        </select>
        <select className="input max-w-[10rem]" value={fYear} onChange={(e) => setFYear(e.target.value)}>
          <option value="">Alle Jahre</option>
          {yearInfo.years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          {yearInfo.hasNone && <option value="__none__">Ohne Jahr</option>}
        </select>
        {(q || fType || fStatus || fResp || fYear) && <button className="btn-ghost" onClick={() => { setQ(""); setFType(""); setFStatus(""); setFResp(""); setFYear(""); }}>Filter zurücksetzen</button>}
      </div>

      {loading ? <Spinner /> : shown.length === 0 ? (
        <Empty title="Keine Projekte" hint="Lege ein Projekt an oder passe Suche/Filter an." />
      ) : view === "struktur" ? (
        <div className="glass p-3 sm:p-4">
          <p className="mb-3 text-xs text-slate-400">
            Projektart anklicken, um die Stufen zu sehen. Klick auf eine Stufe zeigt die Projekte.
            Die Zähler folgen den aktiven Filtern.
          </p>
          <ProjektStrukturListe
            struktur={struktur}
            offenInitial={fType || undefined}
            onStufe={(art, stufe) => { setFType(art); setFStatus(stufe); setViewGemerkt("list"); }}
            onArt={(art) => { setFType(art); setFStatus(""); setViewGemerkt("list"); }}
          />
        </div>
      ) : view === "board" ? (
        <Board list={shown} contacts={contacts} columns={boardColumns} stageColors={stageColors}
          mayEdit={mayEditStage} onMove={moveProjectToStage} onOpen={(p) => nav(projectRoute(p))} />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nr." sortKey="nr" sort={projSort.sort} onSort={projSort.onSort} />
                <SortHeader label="Betreff" sortKey="title" sort={projSort.sort} onSort={projSort.onSort} />
                <SortHeader label="Kunde" sortKey="customer" sort={projSort.sort} onSort={projSort.onSort} />
                <SortHeader label="Adresse" sortKey="address" sort={projSort.sort} onSort={projSort.onSort} />
                <SortHeader label="Typ" sortKey="category" sort={projSort.sort} onSort={projSort.onSort} />
                <SortHeader label="Status" sortKey="stage" sort={projSort.sort} onSort={projSort.onSort} />
                <SortHeader label="Mitarbeiter" sortKey="responsible" sort={projSort.sort} onSort={projSort.onSort} />
                <SortHeader label="Auftragsvolumen netto" sortKey="volume" sort={projSort.sort} onSort={projSort.onSort} align="right"
                  title="Summe der Netto-Beträge aller gültigen Aufträge des Projekts (ohne gelöschte/stornierte/archivierte)" />
                <SortHeader label="Letzte Änderung" sortKey="updated" sort={projSort.sort} onSort={projSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => nav(projectRoute(p))}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.project_number ?? "–"}</td>
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-2">
                      {p.title}
                      {p.archived && <Badge tone="red">Archiviert</Badge>}
                    </span>
                  </td>
                  <TableCell tdClassName="text-slate-500" maxW="200px">{contactName(p.contact_id ? contacts[p.contact_id] : undefined)}</TableCell>
                  <TableCell tdClassName="text-slate-500" maxW="220px">{formatAddressInline(p) || "–"}</TableCell>
                  <TableCell tdClassName="text-slate-500" maxW="160px">{p.category ?? "–"}</TableCell>
                  <td className="px-4 py-3"><Badge tone={stageTone(p.stage)}>{p.stage}</Badge></td>
                  <TableCell tdClassName="text-slate-500" maxW="160px">{p.responsible ?? "–"}</TableCell>
                  <td className="px-4 py-3 text-right tabular-nums" title="Auftragsvolumen netto">{orderVol[p.id] ? eur(orderVol[p.id]) : "–"}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{dateAt(p.updated_at ?? p.created_at)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end">
                      <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit(p)}><Pencil size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <ProjectForm project={edit === "new" ? null : edit} onClose={() => setEdit(null)}
        onSaved={(id) => { setEdit(null); if (edit === "new") nav(`/projekte/${id}`); else load(); }} />}
    </>
  );
}

// ── Pipeline-Board (Kanban) mit Projektstufen der aktuellen Pipeline ─────────
// Spalten = geordnete Projektstufen (auch leere), Karten per Drag&Drop zwischen
// Stufen verschiebbar (Statuswechsel). Klick öffnet das Projekt.
function ProjectCard({
  p, contacts, mayEdit, onOpen, dragging,
}: {
  p: Project; contacts: Record<string, Contact>; mayEdit: boolean;
  onOpen: (p: Project) => void; dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: p.id, disabled: !mayEdit });
  return (
    <div
      ref={setNodeRef}
      {...(mayEdit ? { ...listeners, ...attributes } : {})}
      onClick={() => onOpen(p)}
      className={`glass glass-hover block cursor-pointer p-3 transition hover:border-brand-400 hover:shadow-md ${
        isDragging ? "opacity-40" : ""} ${dragging ? "shadow-xl ring-2 ring-brand-400" : ""}`}
      style={{ touchAction: "none" }}
    >
      <div className="text-sm font-semibold">{p.title}</div>
      {p.project_number && <div className="text-xs text-slate-400">{p.project_number}</div>}
      <div className="mt-1 text-xs text-slate-500">{contactName(p.contact_id ? contacts[p.contact_id] : undefined)}</div>
      {p.city && <div className="text-xs text-slate-500">{[p.zip, p.city].filter(Boolean).join(" ")}</div>}
    </div>
  );
}

function BoardColumn({
  stage, items, color, contacts, mayEdit, onOpen,
}: {
  stage: string; items: Project[]; color?: string; contacts: Record<string, Contact>;
  mayEdit: boolean; onOpen: (p: Project) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${stage}`, disabled: !mayEdit });
  return (
    <div className="w-72 shrink-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color || "var(--accent)" }} />
          {stage}
        </span>
        <Badge>{items.length}</Badge>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[80px] space-y-2 rounded-xl p-1 transition ${
          isOver ? "bg-brand-500/10 ring-2 ring-brand-400" : ""}`}
      >
        {items.map((p) => (
          <ProjectCard key={p.id} p={p} contacts={contacts} mayEdit={mayEdit} onOpen={onOpen} />
        ))}
        {items.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-slate-400">Keine Projekte</div>
        )}
      </div>
    </div>
  );
}

function Board({
  list, contacts, columns, stageColors, mayEdit, onMove, onOpen,
}: {
  list: Project[]; contacts: Record<string, Contact>; columns: string[];
  stageColors: Record<string, string>; mayEdit: boolean;
  onMove: (projectId: string, stage: string) => void; onOpen: (p: Project) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const activeProject = list.find((p) => p.id === activeId) ?? null;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !overId.startsWith("col:")) return;
    const stage = overId.slice(4);
    const p = list.find((x) => x.id === String(e.active.id));
    if (p && p.stage !== stage) onMove(p.id, stage);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((stage) => (
          <BoardColumn key={stage} stage={stage} color={stageColors[stage]}
            items={list.filter((p) => p.stage === stage)}
            contacts={contacts} mayEdit={mayEdit} onOpen={onOpen} />
        ))}
      </div>
      <DragOverlay>
        {activeProject ? (
          <ProjectCard p={activeProject} contacts={contacts} mayEdit={false} onOpen={() => {}} dragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
