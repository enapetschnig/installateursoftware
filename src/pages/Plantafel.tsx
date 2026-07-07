// ============================================================
// B4Y SuperAPP – Plantafel (/plantafel)
// ------------------------------------------------------------
// Moderne Einsatzplanung im Stil einer Plantafel (Vorbild monti.pro,
// sauberer/moderner umgesetzt): Zeilen = Mitarbeiter (sticky linke
// Spalte), Spalten = Tage (Woche/Monat). Einsätze als farbige Balken mit
// Lane-Stacking bei Überlappung, verschiebbar per Drag (Maus/Touch/iPad),
// Klick auf leere Zelle = neuer Einsatz, Häkchen = erledigt.
//
// Baut vollständig auf dem bestehenden Planungs-Datenlayer
// (src/lib/planning.ts) auf – keine Doppellogik. Mandantenfähig über RLS,
// Rechte über usePermissions('plantafel'). Feiertage/Abwesenheiten werden
// aus den bestehenden Quellen gelesen und nur visualisiert.
// ============================================================
import {
  CSSProperties, PointerEvent as ReactPointerEvent,
  memo, useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Plus, Sun, Palmtree } from "lucide-react";
import { PageHeader, Empty, Spinner } from "../components/ui";
import { SearchInput } from "../components/calc-ui";
import { toast, toastError, toastInfo } from "../lib/toast";
import { supabase } from "../lib/supabase";
import { usePermissions } from "../lib/permissions";
import {
  loadEvents, loadAbsences, saveEvent, absenceLabel,
  startOfWeek, startOfMonth, addDays, isoWeek, fmtDate, fmtTime, pad,
  type EventWithLinks, type Absence,
} from "../lib/planning";
import { useEmployees, employeeDisplayName } from "../lib/project-config";
import { loadProjectOptions, type ProjectOption } from "../lib/documents-overview";
import { loadCompanyHolidays } from "../lib/time-entries";
import EinsatzBar from "../components/plantafel/EinsatzBar";
import EinsatzDialog from "../components/plantafel/EinsatzDialog";
import {
  buildDayGrid, eventDaySpan, barPosition, assignLanes, einsatzColor, autoContrastText, isoDate, sameDay,
  type DayCell, type DaySpan, type BarPos, type LaneItem,
} from "../components/plantafel/plantafelUtils";

// ── Layout-Konstanten ─────────────────────────────────────────
const NAME_W = 208;                 // Breite der (sticky) Mitarbeiter-Spalte
const COL_W = { week: 168, month: 46 } as const;
const LANE_H = 34;                  // Höhe eines Balkens
const LANE_GAP = 5;                 // Abstand zwischen Lanes
const PAD_Y = 7;                    // vertikales Innen-Padding einer Zeile
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const NONE_KEY = "__none__";

type RowLayout = {
  laid: LaneItem<EventWithLinks>[];
  laneCount: number;
  bands: { item: Absence; pos: BarPos }[];
  hours: number;
};
type RowDef = { key: string; empId: string | null; label: string };

function rowHeightFor(laneCount: number): number {
  const n = Math.max(1, laneCount);
  return PAD_Y * 2 + n * LANE_H + (n - 1) * LANE_GAP;
}
function eventHours(e: EventWithLinks): number {
  // Ganztägig: 8 h je abgedecktem Kalendertag (Mehrtageseinsätze korrekt zählen,
  // nicht pauschal 8 h). Getaktete Termine: reale Dauer, aber je Tag auf 24 h gedeckelt.
  if (e.all_day) {
    const start = new Date(e.start_at);
    const end = new Date(e.end_at);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
    return days * 8;
  }
  return Math.max(0, (new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 3_600_000);
}
function dayTintClass(d: DayCell): string {
  if (d.isHoliday) return "bg-rose-500/[0.10]";
  if (d.isWeekend) return "bg-slate-400/[0.08] dark:bg-white/[0.035]";
  return "";
}

export default function Plantafel() {
  const { can, isAdmin, loading: permLoading } = usePermissions();
  const mayEdit = isAdmin || can("plantafel", "edit") || can("plantafel", "create");
  const mayDelete = isAdmin || can("plantafel", "delete");
  const mayView = isAdmin || can("plantafel", "view") || mayEdit;

  const { employees, loading: empLoading } = useEmployees();

  // Ansicht / Navigation
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [search, setSearch] = useState("");

  // Daten
  const [events, setEvents] = useState<EventWithLinks[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectColorById, setProjectColorById] = useState<Map<string, string>>(new Map());
  const [dataLoading, setDataLoading] = useState(true);

  // Dialog
  const [dialog, setDialog] = useState<
    { event?: EventWithLinks; defaultDate?: Date; defaultEmployeeId?: string | null } | null
  >(null);

  const colW = COL_W[mode];

  // ── Sichtbarer Zeitraum + Tage-Raster ──
  const grid = useMemo(() => {
    if (mode === "week") return { start: startOfWeek(anchor), count: 7 };
    const start = startOfMonth(anchor);
    const count = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    return { start, count };
  }, [mode, anchor]);
  const gridStart = grid.start;
  const days = useMemo(() => buildDayGrid(grid.start, grid.count, holidays), [grid, holidays]);
  const dayCount = days.length;
  const refHours = (dayCount / 7) * 40;

  // ── Laden ──
  const reload = useCallback(() => {
    setDataLoading(true);
    const startISO = grid.start.toISOString();
    const endExcl = addDays(grid.start, grid.count);
    const endISO = endExcl.toISOString();
    Promise.all([
      loadEvents(startISO, endISO, {}),
      loadAbsences(isoDate(grid.start), isoDate(addDays(grid.start, grid.count - 1))),
      loadCompanyHolidays(grid.start.getFullYear(), endExcl.getFullYear()),
    ])
      .then(([ev, ab, hol]) => {
        setEvents(ev);
        setAbsences(ab);
        const m = new Map<string, string>();
        for (const h of hol) m.set(h.datum, h.bezeichnung);
        setHolidays(m);
      })
      .catch((e) => toastError(e?.message ?? "Fehler beim Laden der Plantafel."))
      .finally(() => setDataLoading(false));
  }, [grid]);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => { reload(); }, [reload]);

  // Projekte + Board-Farben (einmalig)
  useEffect(() => {
    loadProjectOptions().then(setProjects).catch(() => { /* Optionen sind unkritisch */ });
    supabase.from("projects").select("id,board_color").then(({ data }) => {
      const m = new Map<string, string>();
      for (const p of ((data as { id: string; board_color: string | null }[]) ?? [])) {
        if (p.board_color) m.set(p.id, p.board_color);
      }
      setProjectColorById(m);
    });
  }, []);

  // Realtime (optional, Best-Effort): fremde Änderungen -> sanftes Neuladen
  const reloadTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const scheduleReload = () => {
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => reloadRef.current(), 700);
    };
    const ch = supabase
      .channel(`plantafel-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "planning_events" }, scheduleReload)
      .subscribe();
    return () => {
      window.clearTimeout(reloadTimer.current);
      try { supabase.removeChannel(ch); } catch { /* ignore */ }
    };
  }, []);

  // ── Abgeleitete Nachschlage-Tabellen / Helfer ──
  const projectLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.label);
    return m;
  }, [projects]);

  const colorOf = useCallback(
    (e: EventWithLinks) =>
      einsatzColor({ eventColor: e.color, boardColor: projectColorById.get(e.project_id ?? "") ?? null, seed: e.project_id || e.id }),
    [projectColorById],
  );
  const colorOfRef = useRef(colorOf);
  colorOfRef.current = colorOf;

  const subtitleFor = useCallback(
    (e: EventWithLinks) => projectLabelById.get(e.project_id ?? "") ?? e.location ?? null,
    [projectLabelById],
  );
  const tooltipFor = useCallback((e: EventWithLinks) => {
    const when = e.all_day
      ? `${fmtDate(e.start_at)} (ganztägig)`
      : `${fmtDate(e.start_at)} ${fmtTime(e.start_at)}–${fmtTime(e.end_at)}`;
    const proj = projectLabelById.get(e.project_id ?? "");
    return [e.title || "(ohne Titel)", when, proj].filter(Boolean).join("\n");
  }, [projectLabelById]);

  // Suche (clientseitig über die geladenen Einsätze)
  const visibleEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      const proj = (projectLabelById.get(e.project_id ?? "") ?? "").toLowerCase();
      return (e.title ?? "").toLowerCase().includes(q)
        || (e.description ?? "").toLowerCase().includes(q)
        || proj.includes(q);
    });
  }, [events, search, projectLabelById]);

  // Layout je Zeile (Lane-Stacking + Abwesenheitsbänder + Stunden) – gecacht
  const layoutByKey = useMemo(() => {
    const map = new Map<string, RowLayout>();
    const build = (evs: EventWithLinks[], empId: string | null): RowLayout => {
      const entries = evs
        .map((e) => ({ item: e, span: eventDaySpan(e.start_at, e.end_at, gridStart, dayCount) }))
        .filter((x): x is { item: EventWithLinks; span: DaySpan } => x.span !== null);
      const { rows, laneCount } = assignLanes(entries);
      const bands = empId === null
        ? []
        : absences
            .filter((a) => a.employee_id === empId)
            .map((a) => {
              const span = eventDaySpan(`${a.start_date}T00:00:00`, `${a.end_date}T23:59:59`, gridStart, dayCount);
              return span ? { item: a, pos: barPosition(span, dayCount) } : null;
            })
            .filter((x): x is { item: Absence; pos: BarPos } => x !== null);
      const hours = evs.reduce((s, e) => s + eventHours(e), 0);
      return { laid: rows, laneCount, bands, hours };
    };
    for (const e of employees) map.set(e.id, build(visibleEvents.filter((ev) => ev.employee_ids.includes(e.id)), e.id));
    map.set(NONE_KEY, build(visibleEvents.filter((ev) => ev.employee_ids.length === 0), null));
    return map;
  }, [visibleEvents, absences, employees, gridStart, dayCount]);

  const rowDefs = useMemo<RowDef[]>(() => {
    const defs: RowDef[] = [];
    if ((layoutByKey.get(NONE_KEY)?.laid.length ?? 0) > 0) defs.push({ key: NONE_KEY, empId: null, label: "Ohne Zuordnung" });
    for (const e of employees) defs.push({ key: e.id, empId: e.id, label: employeeDisplayName(e) });
    return defs;
  }, [employees, layoutByKey]);

  // ── Aktionen: Verschieben & Erledigt (über Refs, damit Pointer-Handler frisch bleiben) ──
  const doMoveRef = useRef<(ev: EventWithLinks, newDate: Date, oldEmp: string | null, newEmp: string | null) => void>(() => {});
  doMoveRef.current = async (ev, newDate, oldEmp, newEmp) => {
    const start = new Date(ev.start_at);
    const end = new Date(ev.end_at);
    const dur = Math.max(0, end.getTime() - start.getTime());
    const ns = new Date(newDate);
    ns.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
    const ne = new Date(ns.getTime() + dur);

    let newEmpIds = ev.employee_ids;
    if (newEmp !== oldEmp) {
      if (oldEmp && ev.employee_ids.includes(oldEmp)) {
        const replaced = ev.employee_ids
          .map((id) => (id === oldEmp ? newEmp : id))
          .filter((id): id is string => !!id);
        newEmpIds = Array.from(new Set(replaced));
      } else if (newEmp) {
        newEmpIds = Array.from(new Set([...ev.employee_ids, newEmp]));
      }
    }

    const noDateChange = isoDate(ns) === isoDate(start);
    const noEmpChange = newEmpIds.length === ev.employee_ids.length && newEmpIds.every((id) => ev.employee_ids.includes(id));
    if (noDateChange && noEmpChange) return;

    const nsISO = ns.toISOString();
    const neISO = ne.toISOString();
    setEvents((prev) => prev.map((x) => (x.id === ev.id ? { ...x, start_at: nsISO, end_at: neISO, employee_ids: newEmpIds } : x)));
    const { error } = await saveEvent({
      id: ev.id, title: ev.title, start_at: nsISO, end_at: neISO, all_day: ev.all_day,
      employee_ids: newEmpIds, resource_ids: ev.resource_ids,
    });
    if (error) { toastError(error); reloadRef.current(); } else { toastInfo("Einsatz verschoben."); }
  };

  const toggleDoneRef = useRef<(ev: EventWithLinks) => void>(() => {});
  toggleDoneRef.current = async (ev) => {
    const newDone = ev.done_at ? null : new Date().toISOString();
    setEvents((prev) => prev.map((x) => (x.id === ev.id ? { ...x, done_at: newDone } : x)));
    const { error } = await saveEvent({
      id: ev.id, title: ev.title, start_at: ev.start_at, end_at: ev.end_at, all_day: ev.all_day,
      done_at: newDone, employee_ids: ev.employee_ids, resource_ids: ev.resource_ids,
    });
    if (error) { toastError(error); reloadRef.current(); } else { toast(newDone ? "Als erledigt markiert." : "Als offen markiert."); }
  };

  // ── Drag-State (Pointer-Events, Touch-/iPad-tauglich) ──
  const dragRef = useRef<{ ev: EventWithLinks; rowEmp: string | null; startX: number; startY: number; moved: boolean } | null>(null);
  const justDraggedRef = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; title: string; color: string } | null>(null);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved) {
        if (Math.hypot(dx, dy) < 6) return; // erst ab kleiner Schwelle als Drag werten
        d.moved = true;
        setDragId(d.ev.id);
      }
      setGhost({ x: e.clientX, y: e.clientY, title: d.ev.title, color: colorOfRef.current(d.ev) });
    }
    function finish(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDragId(null);
      setGhost(null);
      if (!d.moved) return; // war ein Tap -> Klick öffnet Bearbeiten
      justDraggedRef.current = true;
      window.setTimeout(() => { justDraggedRef.current = false; }, 250);
      // Ziel-Zelle bestimmen (elementsFromPoint sieht die Hintergrund-Zelle unter den Balken)
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      let cell: Element | null = null;
      for (const el of stack) {
        const c = el.closest?.("[data-date]");
        if (c) { cell = c; break; }
      }
      if (!cell) return;
      const dateStr = cell.getAttribute("data-date");
      if (!dateStr) return;
      const empAttr = cell.getAttribute("data-emp");
      const newEmp = empAttr ? empAttr : null;
      doMoveRef.current(d.ev, new Date(`${dateStr}T00:00:00`), d.rowEmp, newEmp);
    }
    function cancel() { dragRef.current = null; setDragId(null); setGhost(null); }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, []);

  // ── Stabile Callbacks für Zeilen/Balken ──
  const onBarPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, ev: EventWithLinks, rowEmp: string | null) => {
    if (!mayEdit) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { ev, rowEmp, startX: e.clientX, startY: e.clientY, moved: false };
  }, [mayEdit]);

  const onBarClick = useCallback((ev: EventWithLinks) => {
    if (justDraggedRef.current) return;
    setDialog({ event: ev });
  }, []);

  const onToggleDone = useCallback((ev: EventWithLinks) => { toggleDoneRef.current(ev); }, []);

  const onCreate = useCallback((empId: string | null, date: Date) => {
    if (!mayEdit || justDraggedRef.current) return;
    setDialog({ defaultDate: date, defaultEmployeeId: empId });
  }, [mayEdit]);

  // ── Navigation ──
  const rangeLabel = useMemo(() => {
    if (mode === "week") {
      const s = grid.start;
      const e = addDays(grid.start, grid.count - 1);
      return `KW ${isoWeek(s)} · ${pad(s.getDate())}.${pad(s.getMonth() + 1)}.–${fmtDate(e.toISOString())}`;
    }
    return anchor.toLocaleDateString("de-AT", { month: "long", year: "numeric" });
  }, [mode, grid, anchor]);

  const step = (dir: number) => {
    if (mode === "week") setAnchor((a) => addDays(a, dir * 7));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  };

  // ── Render ──
  if (permLoading || empLoading) return <div className="pt-6"><Spinner /></div>;
  if (!mayView) {
    return (
      <div className="pt-2">
        <PageHeader title="Plantafel" subtitle="Einsatzplanung" />
        <Empty title="Keine Berechtigung" hint="Für die Plantafel fehlt dir die Berechtigung. Wende dich an einen Administrator." />
      </div>
    );
  }

  const boardMinWidth = NAME_W + dayCount * colW;

  return (
    <div className="pt-2">
      <PageHeader
        title="Plantafel"
        subtitle="Einsätze planen – Mitarbeiter × Tage, per Drag verschieben"
        action={mayEdit ? (
          <button className="btn-primary" onClick={() => setDialog({ defaultDate: new Date(), defaultEmployeeId: null })}>
            <Plus size={16} /> Neuer Einsatz
          </button>
        ) : undefined}
      />

      <div className="glass overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-1.5">
            <button className="btn-outline px-3 py-1.5 text-sm" onClick={() => setAnchor(new Date())}>Heute</button>
            <button className="btn-ghost min-h-[44px] px-2" onClick={() => step(-1)} aria-label="Zurück"><ChevronLeft size={18} /></button>
            <button className="btn-ghost min-h-[44px] px-2" onClick={() => step(1)} aria-label="Vor"><ChevronRight size={18} /></button>
            <span className="ml-1 flex items-center gap-2 text-sm font-semibold">
              <CalendarRange size={16} className="text-slate-400" />
              {rangeLabel}
              {dataLoading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-full sm:w-auto">
              <SearchInput value={search} onChange={setSearch} placeholder="Einsatz/Projekt suchen …" />
            </div>
            <div className="seg">
              <button className="seg-btn" data-active={mode === "week"} onClick={() => setMode("week")}>Woche</button>
              <button className="seg-btn" data-active={mode === "month"} onClick={() => setMode("month")}>Monat</button>
            </div>
          </div>
        </div>

        {employees.length === 0 ? (
          <Empty title="Keine aktiven Mitarbeiter" hint="Lege in den Stammdaten Mitarbeiter an, um sie auf der Plantafel zu verplanen." />
        ) : (
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
            <div style={{ minWidth: boardMinWidth }}>
              {/* Kopfzeile (sticky oben) */}
              <div className="sticky top-0 z-30 flex border-b" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div
                  className="sticky left-0 z-40 flex items-center border-r px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  style={{ width: NAME_W, background: "var(--card)", borderColor: "var(--border)" }}
                >
                  Mitarbeiter
                </div>
                <div className="flex">
                  {days.map((d) => {
                    const todayStyle: CSSProperties | undefined = d.isToday
                      ? { boxShadow: "inset 2px 0 0 var(--accent), inset -2px 0 0 var(--accent)" }
                      : undefined;
                    return (
                      <div
                        key={d.iso}
                        className={`border-r px-1 py-1.5 text-center ${d.isToday ? "" : dayTintClass(d)}`}
                        style={{ width: colW, borderColor: "var(--border)", ...todayStyle }}
                        title={d.holidayName ?? undefined}
                      >
                        <div className={`text-[11px] font-medium ${d.isWeekend || d.isHoliday ? "text-rose-500 dark:text-rose-400" : "text-slate-400"}`}>
                          {WEEKDAYS[d.weekday]}
                        </div>
                        <div className="mt-0.5 flex items-center justify-center">
                          <span
                            className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-md px-1 text-sm font-semibold tabular-nums ${d.isToday ? "text-white" : ""}`}
                            style={d.isToday ? { background: "var(--accent)" } : undefined}
                          >
                            {d.date.getDate()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Zeilen */}
              {rowDefs.map((def) => (
                <BoardRow
                  key={def.key}
                  def={def}
                  days={days}
                  colW={colW}
                  dayCount={dayCount}
                  layout={layoutByKey.get(def.key)}
                  refHours={refHours}
                  mayEdit={mayEdit}
                  dragId={dragId}
                  colorOf={colorOf}
                  subtitleFor={subtitleFor}
                  tooltipFor={tooltipFor}
                  onCreate={onCreate}
                  onBarClick={onBarClick}
                  onBarPointerDown={onBarPointerDown}
                  onToggleDone={onToggleDone}
                />
              ))}
            </div>
          </div>
        )}

        {/* Legende */}
        <div className="flex flex-wrap items-center gap-4 border-t px-3 py-2 text-[11px] text-slate-500" style={{ borderColor: "var(--border)" }}>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ boxShadow: "inset 2px 0 0 var(--accent), inset -2px 0 0 var(--accent)" }} /> Heute</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-slate-400/20" /> Wochenende</span>
          <span className="inline-flex items-center gap-1.5"><Sun size={13} className="text-rose-500" /> Feiertag</span>
          <span className="inline-flex items-center gap-1.5"><Palmtree size={13} className="text-rose-500" /> Abwesenheit</span>
          {mayEdit && <span className="ml-auto hidden sm:inline">Leere Zelle klicken = Einsatz anlegen · Balken ziehen = verschieben</span>}
        </div>
      </div>

      {/* Ghost beim Ziehen (pointer-events:none -> stört elementsFromPoint nicht) */}
      {ghost && (
        <div
          className="pointer-events-none fixed z-[9999] max-w-[220px] -translate-x-1/2 -translate-y-1/2 truncate rounded-lg px-2 py-1 text-[12px] font-semibold shadow-lg ring-1 ring-black/20"
          style={{ left: ghost.x, top: ghost.y, background: ghost.color, color: autoContrastText(ghost.color) }}
        >
          {ghost.title || "(ohne Titel)"}
        </div>
      )}

      {dialog && (
        <EinsatzDialog
          open
          onClose={() => setDialog(null)}
          event={dialog.event ?? null}
          defaultDate={dialog.defaultDate ?? null}
          defaultEmployeeId={dialog.defaultEmployeeId ?? null}
          projects={projects}
          employees={employees}
          mayEdit={mayEdit}
          mayDelete={mayDelete}
          onSaved={() => { setDialog(null); reload(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// Eine Zeile der Plantafel (Mitarbeiter × Tage). memo: Zeilen, die sich
// beim Ziehen nicht ändern, werden nicht neu gerendert (Ghost aktualisiert
// nur den Seiten-Root).
// ============================================================
type BoardRowProps = {
  def: RowDef;
  days: DayCell[];
  colW: number;
  dayCount: number;
  layout: RowLayout | undefined;
  refHours: number;
  mayEdit: boolean;
  dragId: string | null;
  colorOf: (e: EventWithLinks) => string;
  subtitleFor: (e: EventWithLinks) => string | null;
  tooltipFor: (e: EventWithLinks) => string;
  onCreate: (empId: string | null, date: Date) => void;
  onBarClick: (e: EventWithLinks) => void;
  onBarPointerDown: (e: ReactPointerEvent<HTMLDivElement>, ev: EventWithLinks, rowEmp: string | null) => void;
  onToggleDone: (e: EventWithLinks) => void;
};

const BoardRow = memo(function BoardRow(p: BoardRowProps) {
  const { def, days, colW, dayCount, layout, refHours, mayEdit, dragId } = p;
  const laneCount = layout?.laneCount ?? 1;
  const rowHeight = rowHeightFor(laneCount);
  const timelineW = dayCount * colW;
  const hours = layout?.hours ?? 0;
  const pct = refHours > 0 ? Math.min(100, (hours / refHours) * 100) : 0;
  const over = hours > refHours;
  const empAttr = def.empId ?? "";

  return (
    <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
      {/* Name-Spalte (sticky links) */}
      <div
        className="sticky left-0 z-20 flex flex-col justify-center gap-1 border-r px-3 py-2"
        style={{ width: NAME_W, minHeight: rowHeight, background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="truncate text-sm font-semibold" title={def.label}>{def.label}</div>
        {def.empId !== null && (
          <div>
            <div className="flex items-center justify-between text-[10.5px] text-slate-400">
              <span>Auslastung</span>
              <span className="tabular-nums">{Math.round(hours * 10) / 10} h</span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-400/15 dark:bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "var(--c-red)" : "linear-gradient(90deg,var(--accent),var(--accent-h))" }} />
            </div>
          </div>
        )}
      </div>

      {/* Zeitleiste */}
      <div className="relative" style={{ width: timelineW, minHeight: rowHeight }}>
        {/* Hintergrund-Zellen (klickbar + Drop-Ziele) */}
        <div className="absolute inset-0 flex">
          {days.map((d) => {
            const isToday = d.isToday;
            const cellStyle: CSSProperties = { width: colW, borderColor: "var(--border)" };
            if (isToday) {
              cellStyle.background = "color-mix(in srgb, var(--accent) 9%, transparent)";
              cellStyle.boxShadow = "inset 2px 0 0 var(--accent), inset -2px 0 0 var(--accent)";
            }
            return (
              <div
                key={d.iso}
                data-emp={empAttr}
                data-date={d.iso}
                onClick={() => p.onCreate(def.empId, d.date)}
                className={`h-full border-r ${isToday ? "" : dayTintClass(d)} ${mayEdit ? "cursor-pointer hover:bg-[var(--hover)]" : ""}`}
                style={cellStyle}
              />
            );
          })}
        </div>

        {/* Abwesenheits-Bänder (hinter den Balken, nicht interaktiv) */}
        {layout?.bands.map(({ item, pos }) => {
          const c = item.color || "#ef4444";
          return (
            <div
              key={`abs-${item.id}`}
              className="pointer-events-none absolute overflow-hidden rounded-lg border border-dashed"
              style={{
                left: `calc(${pos.leftPct}% + 2px)`,
                width: `calc(${pos.widthPct}% - 4px)`,
                top: 4,
                bottom: 4,
                background: `color-mix(in srgb, ${c} 15%, transparent)`,
                borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
              }}
              title={`${absenceLabel(item.kind)} · ${fmtDate(item.start_date)}–${fmtDate(item.end_date)}`}
            >
              <span className="absolute left-1.5 top-1 truncate text-[10px] font-semibold" style={{ color: `color-mix(in srgb, ${c} 75%, var(--text))` }}>
                {absenceLabel(item.kind)}
              </span>
            </div>
          );
        })}

        {/* Einsatz-Balken */}
        {layout?.laid.map(({ item, span, lane }) => {
          const pos = barPosition(span, dayCount);
          const s = new Date(item.start_at);
          const e = new Date(item.end_at);
          const timeLabel = item.all_day
            ? null
            : (sameDay(s, e) ? `${fmtTime(item.start_at)}–${fmtTime(item.end_at)}` : fmtTime(item.start_at));
          const barStyle: CSSProperties = {
            left: `calc(${pos.leftPct}% + 3px)`,
            width: `calc(${pos.widthPct}% - 6px)`,
            top: PAD_Y + lane * (LANE_H + LANE_GAP),
            height: LANE_H,
          };
          return (
            <EinsatzBar
              key={item.id}
              title={item.title}
              timeLabel={timeLabel}
              subtitle={p.subtitleFor(item)}
              color={p.colorOf(item)}
              done={!!item.done_at}
              clippedStart={span.clippedStart}
              clippedEnd={span.clippedEnd}
              style={barStyle}
              tooltip={p.tooltipFor(item)}
              draggable={mayEdit}
              dimmed={dragId === item.id}
              onClick={() => p.onBarClick(item)}
              onPointerDown={(ev) => p.onBarPointerDown(ev, item, def.empId)}
              onToggleDone={mayEdit ? () => p.onToggleDone(item) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
});
