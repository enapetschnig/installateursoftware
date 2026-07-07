// ============================================================
// B4Y SuperAPP – Planung (/planung)
// Zentrale Arbeits-, Termin-, Ressourcen- & Mitarbeiterplanung.
// Ansichten: Übersicht · Kalender (Monat + Wochen-Plantafel) · Termine ·
// Ressourcen · Abwesenheiten · Einstellungen. Mandantenfähig + RBAC.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { APP_NAME } from "../lib/branding";
import {
  CalendarRange, Plus, ChevronLeft, ChevronRight, Search, Trash2, Pencil,
  Truck, CalendarDays, ListChecks, Settings as SettingsIcon, LayoutGrid, Palmtree,
  Sparkles, Download, Repeat,
} from "lucide-react";
import { aiJson, aiAsk, loadAiSettings, aiModuleEnabled } from "../lib/ai";
import { Badge, Empty, Spinner, Modal } from "../components/ui";
import { ConfirmDialog, ErrorBanner } from "../components/calc-ui";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";
import { useAuth } from "../lib/auth";
import { usePermissions } from "../lib/permissions";
import {
  PlanningConfig, EventWithLinks, Absence, Resource,
  EventFilters, Conflict,
  loadConfig, loadEvents, loadAbsences, saveEvent, deleteEvent, saveAbsence, deleteAbsence,
  saveResource, deleteResource, saveConfigRow, deleteConfigRow, checkConflicts,
  eventColor, empName, statusLabel, statusTone, absenceLabel,
  EVENT_STATUSES, PRIORITIES, ABSENCE_KINDS,
  startOfWeek, addDays, startOfMonth, isoLocal, fmtTime, fmtDate, isoWeek, pad,
} from "../lib/planning";
import { loadProjectOptions, loadCustomerOptions, ProjectOption, CustomerOption } from "../lib/documents-overview";
import AppointmentsView from "../components/appointments/AppointmentsView";

type Tab = "overview" | "calendar" | "events" | "series" | "resources" | "absences" | "settings";
const TABS: { key: Tab; label: string; icon: typeof CalendarRange }[] = [
  { key: "overview", label: "Übersicht", icon: LayoutGrid },
  { key: "calendar", label: "Kalender", icon: CalendarDays },
  { key: "events", label: "Termine", icon: ListChecks },
  { key: "series", label: "Terminserien", icon: Repeat },
  { key: "resources", label: "Ressourcen", icon: Truck },
  { key: "absences", label: "Abwesenheiten", icon: Palmtree },
  { key: "settings", label: "Einstellungen", icon: SettingsIcon },
];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export default function Planung() {
  const { session } = useAuth();
  const { can, isAdmin } = usePermissions();
  const uid = session?.user.id ?? null;
  const mayEdit = isAdmin || can("plantafel", "edit") || can("plantafel", "create");
  const mayDelete = isAdmin || can("plantafel", "delete");

  const [tab, setTab] = useState<Tab>("calendar");
  const [cfg, setCfg] = useState<PlanningConfig | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Kalender-Status
  const [calMode, setCalMode] = useState<"month" | "week">("week");
  const [anchor, setAnchor] = useState<Date>(new Date());

  // Daten
  const [events, setEvents] = useState<EventWithLinks[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Filter
  const [filters, setFilters] = useState<EventFilters>({});
  const [searchInput, setSearchInput] = useState("");

  // Dialoge
  const [editEvent, setEditEvent] = useState<Partial<EventWithLinks> | null>(null);
  const [editResource, setEditResource] = useState<Partial<Resource> | null>(null);
  const [editAbsence, setEditAbsence] = useState<Partial<Absence> | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ kind: "event" | "resource" | "absence"; id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [sp] = useSearchParams();
  const autoNewDone = useRef(false);

  // ── Stammdaten laden ──
  useEffect(() => {
    setLoading(true);
    Promise.all([loadConfig(true), loadProjectOptions(), loadCustomerOptions()])
      .then(([c, p, cu]) => { setCfg(c); setProjects(p); setCustomers(cu); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Deep-Link: /planung?project=<id>&new=1 öffnet direkt den Termin-Dialog (z. B. aus dem Projekt)
  useEffect(() => {
    if (loading || autoNewDone.current) return;
    if (sp.get("new") === "1") {
      autoNewDone.current = true;
      const s = new Date(); const e = new Date(s.getTime() + 60 * 60000);
      setEditEvent({ title: "", start_at: isoLocal(s) as any, end_at: isoLocal(e) as any, status: "geplant", priority: "normal", all_day: false, visibility: "intern", employee_ids: [], resource_ids: [], project_id: sp.get("project") || null });
      setTab("calendar");
    }
  }, [loading, sp]);

  // ── Suche debouncen → in Filter übernehmen ──
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchInput.trim() || null })), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Sichtbarer Zeitraum je Ansicht ──
  const range = useMemo(() => {
    if (tab === "events") {
      const from = addDays(new Date(), -90); const to = addDays(new Date(), 365);
      return { start: new Date(from.getFullYear(), from.getMonth(), from.getDate()), end: to };
    }
    if (calMode === "week") { const s = startOfWeek(anchor); return { start: s, end: addDays(s, 7) }; }
    const s = startOfWeek(startOfMonth(anchor)); return { start: s, end: addDays(s, 42) };
  }, [tab, calMode, anchor]);

  // ── Termine + Abwesenheiten laden ──
  function reload() {
    setDataLoading(true);
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();
    Promise.all([
      loadEvents(startISO, endISO, filters),
      loadAbsences(range.start.toISOString().slice(0, 10), range.end.toISOString().slice(0, 10), filters.employeeId || null),
    ])
      .then(([ev, ab]) => { setEvents(ev); setAbsences(ab); })
      .catch((e) => setErr(e.message))
      .finally(() => setDataLoading(false));
  }

  // Drag&Drop: Termin auf anderen Tag/Mitarbeiter ziehen (Uhrzeit bleibt, Dauer bleibt)
  async function moveEvent(ev: EventWithLinks, day: Date, empId: string | null) {
    if (!mayEdit) return;
    const start = new Date(ev.start_at); const end = new Date(ev.end_at);
    const dur = Math.max(0, end.getTime() - start.getTime());
    const ns = new Date(day); ns.setHours(start.getHours(), start.getMinutes(), 0, 0);
    const ne = new Date(ns.getTime() + dur);
    const { error } = await saveEvent({
      id: ev.id, title: ev.title, start_at: ns.toISOString(), end_at: ne.toISOString(),
      all_day: ev.all_day, status: ev.status, priority: ev.priority, color: ev.color,
      event_type_id: ev.event_type_id, category_id: ev.category_id, project_id: ev.project_id,
      contact_id: ev.contact_id, location: ev.location, description: ev.description, visibility: ev.visibility,
      employee_ids: empId ? [empId] : [], resource_ids: ev.resource_ids,
    });
    if (error) setErr(error); else reload();
  }
  function exportICS() { downloadICS(events); }
  useEffect(() => {
    if (loading) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tab, calMode, anchor, JSON.stringify(filters)]);

  if (loading || !cfg) return <div className="pt-4"><Spinner /></div>;

  const newEventAt = (start?: Date) => {
    const s = start ?? new Date();
    const t = cfg.eventTypes[0];
    const end = new Date(s.getTime() + (t?.default_duration_min ?? 60) * 60000);
    setEditEvent({ title: "", start_at: isoLocal(s) as any, end_at: isoLocal(end) as any, status: "geplant", priority: "normal", all_day: false, visibility: "intern", employee_ids: [], resource_ids: [] });
  };

  return (
    <div className="pt-2">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight"><CalendarRange size={24} /> Planung</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Termine, Ressourcen & Mitarbeiter zentral planen</p>
        </div>
        {mayEdit && <button className="btn-primary" onClick={() => newEventAt()}><Plus size={16} /> Termin erstellen</button>}
      </div>

      <ErrorBanner message={err} />

      {/* Tabs */}
      <div className="glass mb-4 flex gap-1 overflow-x-auto p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
            style={tab === t.key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview cfg={cfg} events={events} absences={absences} onNew={() => newEventAt()} goCal={() => setTab("calendar")} />}

      {(tab === "calendar" || tab === "events") && (
        <FilterBar cfg={cfg} projects={projects} filters={filters} setFilters={setFilters}
          searchInput={searchInput} setSearchInput={setSearchInput} />
      )}

      {tab === "calendar" && (
        <Calendar mode={calMode} setMode={setCalMode} anchor={anchor} setAnchor={setAnchor}
          range={range} cfg={cfg} events={events} absences={absences} loading={dataLoading}
          onEvent={(e) => setEditEvent(e)} onNewAt={newEventAt} mayEdit={mayEdit}
          onMove={moveEvent} onExport={exportICS} />
      )}

      {tab === "events" && (
        <EventsTable events={events} cfg={cfg} projects={projects} customers={customers} loading={dataLoading}
          onEdit={(e) => setEditEvent(e)} onDelete={(e) => setConfirmDel({ kind: "event", id: e.id, label: e.title || "Termin" })}
          mayDelete={mayDelete} />
      )}

      {tab === "series" && <AppointmentsView />}

      {tab === "resources" && (
        <ResourcesView cfg={cfg} mayEdit={mayEdit} mayDelete={mayDelete}
          onNew={() => setEditResource({ name: "", color: "#64748b", is_active: true })}
          onEdit={(r) => setEditResource(r)} onDelete={(r) => setConfirmDel({ kind: "resource", id: r.id, label: r.name })} />
      )}

      {tab === "absences" && (
        <AbsencesView absences={absences} cfg={cfg} loading={dataLoading} mayEdit={mayEdit} mayDelete={mayDelete}
          onNew={() => setEditAbsence({ kind: "urlaub", start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), all_day: true, status: "bestaetigt", color: "#ef4444" })}
          onEdit={(a) => setEditAbsence(a)} onDelete={(a) => setConfirmDel({ kind: "absence", id: a.id, label: absenceLabel(a.kind) })} />
      )}

      {tab === "settings" && <SettingsView cfg={cfg} reloadCfg={() => loadConfig(false).then(setCfg)} mayEdit={mayEdit} setErr={setErr} />}

      {/* ── Dialoge ── */}
      {editEvent && (
        <EventDialog draft={editEvent} cfg={cfg} projects={projects} customers={customers} uid={uid}
          onClose={() => setEditEvent(null)}
          onSaved={() => { setEditEvent(null); reload(); }} setErr={setErr} />
      )}
      {editResource && (
        <ResourceDialog draft={editResource} cfg={cfg}
          onClose={() => setEditResource(null)}
          onSaved={() => { setEditResource(null); loadConfig(true).then(setCfg); }} setErr={setErr} />
      )}
      {editAbsence && (
        <AbsenceDialog draft={editAbsence} cfg={cfg}
          onClose={() => setEditAbsence(null)}
          onSaved={() => { setEditAbsence(null); reload(); }} setErr={setErr} />
      )}

      <ConfirmDialog open={!!confirmDel} title="Löschen?" confirmLabel="Löschen" busy={busy}
        message={<><b>{confirmDel?.label}</b> wird gelöscht. Fortfahren?</>}
        onClose={() => setConfirmDel(null)}
        onConfirm={async () => {
          if (!confirmDel) return;
          setBusy(true);
          const fn = confirmDel.kind === "event" ? deleteEvent : confirmDel.kind === "resource" ? deleteResource : deleteAbsence;
          const { error } = await fn(confirmDel.id);
          setBusy(false);
          if (error) setErr(error);
          else { setConfirmDel(null); confirmDel.kind === "resource" ? loadConfig(true).then(setCfg) : reload(); }
        }} />
    </div>
  );
}

// ============================================================
// Übersicht
// ============================================================
function Overview({ cfg, events, absences, onNew, goCal }: {
  cfg: PlanningConfig; events: EventWithLinks[]; absences: Absence[]; onNew: () => void; goCal: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const open = events.filter((e) => !["erledigt", "abgesagt"].includes(e.status)).length;
  const absToday = absences.filter((a) => a.start_date <= today && a.end_date >= today).length;
  const upcoming = [...events].sort((a, b) => a.start_at.localeCompare(b.start_at)).slice(0, 6);

  // Auslastung je Mitarbeiter (geplante Stunden im sichtbaren Zeitraum)
  const hoursByEmp = new Map<string, number>();
  for (const e of events) {
    const h = e.all_day ? 8 : Math.max(0, (new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 3600000);
    for (const id of e.employee_ids) hoursByEmp.set(id, (hoursByEmp.get(id) ?? 0) + h);
  }
  const utilization = cfg.employees
    .map((u) => ({ name: empName(u), hours: Math.round((hoursByEmp.get(u.id) ?? 0) * 10) / 10 }))
    .filter((x) => x.hours > 0)
    .sort((a, b) => b.hours - a.hours);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  async function aiAnalyse() {
    setAiBusy(true); setAiText(null);
    const lines = events.slice(0, 60).map((e) =>
      `- ${fmtDate(e.start_at)} ${e.all_day ? "(ganztägig)" : fmtTime(e.start_at)}: ${e.title} [${statusLabel(e.status)}]`).join("\n");
    const absLines = absences.map((a) => `- ${empName(cfg.employees.find((x) => x.id === a.employee_id))}: ${absenceLabel(a.kind)} ${fmtDate(a.start_date)}–${fmtDate(a.end_date)}`).join("\n");
    const prompt = `Hier ist meine Planung im aktuellen Zeitraum:\nTERMINE:\n${lines || "(keine)"}\n\nABWESENHEITEN:\n${absLines || "(keine)"}\n\n` +
      `Gib mir eine kurze, praxisnahe Einschätzung auf Deutsch: Worauf sollte ich achten? Gibt es Engpässe, Lücken oder Konflikte? Maximal 6 Stichpunkte.`;
    const r = await aiAsk(prompt, { module: "planung", action: "wochenanalyse" });
    setAiBusy(false);
    setAiText(r.error ? r.error : (r.text || "Keine Antwort."));
  }
  const cards = [
    { label: "Termine im Zeitraum", value: events.length },
    { label: "Offene Termine", value: open },
    { label: "Abwesend heute", value: absToday },
    { label: "Ressourcen", value: cfg.resources.length },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="glass rounded-xl p-4 text-center">
            <div className="text-2xl font-extrabold tabular-nums">{c.value}</div>
            <div className="text-xs font-medium text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="glass p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-bold">Nächste Termine</h3>
          <button className="btn-ghost text-sm text-[var(--accent)]" onClick={goCal}>Zum Kalender</button>
        </div>
        {upcoming.length === 0 ? (
          <Empty title="Noch keine Termine geplant." hint="Erstelle deinen ersten Termin." />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {upcoming.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: eventColor(e, cfg.eventTypes, cfg.categories) }} />
                <span className="font-medium">{e.title || "(ohne Titel)"}</span>
                <span className="text-slate-400">{fmtDate(e.start_at)} {!e.all_day && fmtTime(e.start_at)}</span>
                <Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="glass p-4">
          <h3 className="mb-2 font-bold">Auslastung (Zeitraum)</h3>
          {utilization.length === 0 ? <p className="text-sm text-slate-400">Keine geplanten Stunden.</p> : (
            <div className="space-y-2">
              {utilization.map((u) => (
                <div key={u.name} className="text-sm">
                  <div className="flex justify-between"><span>{u.name}</span><span className="tabular-nums text-slate-500">{u.hours} h</span></div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-white/10">
                    <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (u.hours / 40) * 100)}%`, background: u.hours > 40 ? "var(--c-red)" : "linear-gradient(90deg,var(--accent),var(--accent-h))" }} />
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-slate-400">Referenz 40 h/Woche · rot = überbucht.</p>
            </div>
          )}
        </div>
        <div className="glass p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-bold"><Sparkles size={18} /> KI-Wochenanalyse</h3>
            <button className="btn-outline py-1 text-sm" disabled={aiBusy} onClick={aiAnalyse}>{aiBusy ? "Analysiere …" : "Analysieren"}</button>
          </div>
          {aiText ? <div className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{aiText}</div>
            : <p className="text-sm text-slate-400">Lass die KI deine Termine & Abwesenheiten auf Engpässe und Lücken prüfen.</p>}
        </div>
      </div>

      <button className="btn-primary" onClick={onNew}><Plus size={16} /> Termin erstellen</button>
    </div>
  );
}

// ============================================================
// Filterleiste
// ============================================================
function FilterBar({ cfg, projects, filters, setFilters, searchInput, setSearchInput }: {
  cfg: PlanningConfig; projects: ProjectOption[]; filters: EventFilters;
  setFilters: (f: EventFilters) => void; searchInput: string; setSearchInput: (s: string) => void;
}) {
  const set = (patch: Partial<EventFilters>) => setFilters({ ...filters, ...patch });
  return (
    <div className="glass mb-3 flex flex-wrap items-center gap-2 p-3">
      <div className="relative min-w-[200px] flex-1">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Suchen: Titel, Adresse, Beschreibung …" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
      </div>
      <select className="input w-auto min-w-[140px]" value={filters.employeeId ?? ""} onChange={(e) => set({ employeeId: e.target.value || null })}>
        <option value="">Alle Mitarbeiter</option>
        {cfg.employees.map((u) => <option key={u.id} value={u.id}>{empName(u)}</option>)}
      </select>
      <select className="input w-auto min-w-[140px]" value={filters.resourceId ?? ""} onChange={(e) => set({ resourceId: e.target.value || null })}>
        <option value="">Alle Ressourcen</option>
        {cfg.resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <select className="input w-auto min-w-[130px]" value={filters.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || null })}>
        <option value="">Alle Kategorien</option>
        {cfg.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className="input w-auto min-w-[130px]" value={filters.eventTypeId ?? ""} onChange={(e) => set({ eventTypeId: e.target.value || null })}>
        <option value="">Alle Terminarten</option>
        {cfg.eventTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <select className="input w-auto min-w-[130px]" value={filters.projectId ?? ""} onChange={(e) => set({ projectId: e.target.value || null })}>
        <option value="">Alle Projekte</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <select className="input w-auto min-w-[120px]" value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value || null })}>
        <option value="">Alle Status</option>
        {EVENT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
      </select>
      {(filters.employeeId || filters.resourceId || filters.categoryId || filters.eventTypeId || filters.projectId || filters.status || filters.search) && (
        <button className="btn-ghost text-sm text-slate-500" onClick={() => { setFilters({}); setSearchInput(""); }}>Zurücksetzen</button>
      )}
    </div>
  );
}

// ============================================================
// Kalender (Monat + Wochen-Plantafel)
// ============================================================
function Calendar({ mode, setMode, anchor, setAnchor, range, cfg, events, absences, loading, onEvent, onNewAt, mayEdit, onMove, onExport }: {
  mode: "month" | "week"; setMode: (m: "month" | "week") => void;
  anchor: Date; setAnchor: (d: Date) => void; range: { start: Date; end: Date };
  cfg: PlanningConfig; events: EventWithLinks[]; absences: Absence[]; loading: boolean;
  onEvent: (e: EventWithLinks) => void; onNewAt: (d: Date) => void; mayEdit: boolean;
  onMove: (e: EventWithLinks, day: Date, empId: string | null) => void; onExport: () => void;
}) {
  const step = (dir: number) => setAnchor(addDays(anchor, dir * (mode === "week" ? 7 : 30)));
  const title = mode === "week"
    ? `KW ${isoWeek(range.start)} · ${fmtDate(range.start.toISOString())} – ${fmtDate(addDays(range.start, 6).toISOString())}`
    : anchor.toLocaleDateString("de-AT", { month: "long", year: "numeric" });

  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
          <button className="btn-outline px-3 py-1 text-sm" onClick={() => setAnchor(new Date())}>Heute</button>
          <button className="btn-ghost px-2" onClick={() => step(1)}><ChevronRight size={18} /></button>
          <span className="ml-2 font-semibold">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-outline px-2 py-1 text-sm" onClick={onExport} title="Sichtbare Termine als iCal/ICS exportieren"><Download size={15} /> iCal</button>
          <div className="seg">
            <button className="seg-btn" data-active={mode === "week"} onClick={() => setMode("week")}>Woche</button>
            <button className="seg-btn" data-active={mode === "month"} onClick={() => setMode("month")}>Monat</button>
          </div>
        </div>
      </div>
      {loading ? <Spinner /> : mode === "week"
        ? <WeekBoard range={range} cfg={cfg} events={events} absences={absences} onEvent={onEvent} onNewAt={onNewAt} mayEdit={mayEdit} onMove={onMove} />
        : <MonthGrid range={range} anchor={anchor} cfg={cfg} events={events} onEvent={onEvent} onNewAt={onNewAt} mayEdit={mayEdit} />}
    </div>
  );
}

function EventBar({ e, cfg, onClick, draggable, onDragStart }: {
  e: EventWithLinks; cfg: PlanningConfig; onClick: () => void; draggable?: boolean; onDragStart?: () => void;
}) {
  const color = eventColor(e, cfg.eventTypes, cfg.categories);
  return (
    <button onClick={onClick} draggable={draggable} onDragStart={onDragStart}
      className="block w-full cursor-pointer truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
      style={{ background: color }} title={`${e.title} · ${fmtTime(e.start_at)}`}>
      {!e.all_day && <span className="opacity-80">{fmtTime(e.start_at)} </span>}{e.title || "(ohne Titel)"}
    </button>
  );
}

// Wochen-Plantafel: links Mitarbeiter/Ressourcen, oben Tage, Termine als Balken
function WeekBoard({ range, cfg, events, absences, onEvent, onNewAt, mayEdit, onMove }: {
  range: { start: Date; end: Date }; cfg: PlanningConfig; events: EventWithLinks[]; absences: Absence[];
  onEvent: (e: EventWithLinks) => void; onNewAt: (d: Date) => void; mayEdit: boolean;
  onMove: (e: EventWithLinks, day: Date, empId: string | null) => void;
}) {
  const [drag, setDrag] = useState<EventWithLinks | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(range.start, i));
  // Zeilen: Allgemein (ohne MA) + aktive Mitarbeiter
  const rows: { id: string | null; label: string }[] = [
    { id: null, label: "Allgemein" },
    ...cfg.employees.map((e) => ({ id: e.id, label: empName(e) })),
  ];
  const sameDay = (iso: string, d: Date) => { const x = new Date(iso); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate(); };
  const dateInAbsence = (a: Absence, d: Date) => { const ds = d.toISOString().slice(0, 10); return a.start_date <= ds && a.end_date >= ds; };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: 820 }}>
        <thead className="bg-slate-50 dark:bg-white/5">
          <tr>
            <th className="sticky left-0 z-10 w-40 bg-slate-50 px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-[#0f172a]">Ressource</th>
            {days.map((d, i) => (
              <th key={i} className="px-2 py-2 text-center text-xs font-semibold">
                <div>{WEEKDAYS[i]}</div>
                <div className="text-slate-400">{pad(d.getDate())}.{pad(d.getMonth() + 1)}.</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id ?? "all"} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="sticky left-0 z-10 w-40 bg-[var(--card)] px-3 py-2 align-top text-xs font-semibold">{row.label}</td>
              {days.map((d, i) => {
                const dayEvents = events.filter((e) =>
                  sameDay(e.start_at, d) && (row.id === null ? e.employee_ids.length === 0 : e.employee_ids.includes(row.id!)));
                const dayAbs = row.id ? absences.filter((a) => a.employee_id === row.id && dateInAbsence(a, d)) : [];
                return (
                  <td key={i} className="group min-w-[90px] cursor-pointer p-1 align-top hover:bg-slate-50 dark:hover:bg-white/5"
                    onClick={() => mayEdit && dayEvents.length === 0 && dayAbs.length === 0 ? onNewAt(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8)) : undefined}
                    onDragOver={(ev) => { if (drag) ev.preventDefault(); }}
                    onDrop={() => { if (drag) { onMove(drag, d, row.id); setDrag(null); } }}>
                    <div className="space-y-1">
                      {dayAbs.map((a) => (
                        <div key={a.id} className="truncate rounded px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: a.color || "#ef4444" }}>{absenceLabel(a.kind)}</div>
                      ))}
                      {dayEvents.map((e) => <EventBar key={e.id} e={e} cfg={cfg} onClick={() => onEvent(e)} draggable={mayEdit} onDragStart={() => setDrag(e)} />)}
                      {mayEdit && dayEvents.length === 0 && dayAbs.length === 0 && (
                        <div className="hidden text-center text-[11px] text-slate-400 group-hover:block">+ Termin ziehen/erstellen</div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Monatsansicht
function MonthGrid({ range, anchor, cfg, events, onEvent, onNewAt, mayEdit }: {
  range: { start: Date; end: Date }; anchor: Date; cfg: PlanningConfig; events: EventWithLinks[];
  onEvent: (e: EventWithLinks) => void; onNewAt: (d: Date) => void; mayEdit: boolean;
}) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(range.start, i));
  const sameDay = (iso: string, d: Date) => { const x = new Date(iso); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate(); };
  const todayStr = new Date().toDateString();
  return (
    <div>
      <div className="grid grid-cols-7 border-b text-center text-xs font-semibold text-slate-500" style={{ borderColor: "var(--border)" }}>
        {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const dayEvents = events.filter((e) => sameDay(e.start_at, d));
          const isToday = d.toDateString() === todayStr;
          return (
            <div key={i} className={`min-h-[96px] border-b border-r p-1 ${inMonth ? "" : "opacity-40"}`} style={{ borderColor: "var(--border)" }}
              onClick={() => mayEdit ? onNewAt(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8)) : undefined}>
              <div className={`mb-1 text-right text-xs ${isToday ? "font-bold text-[var(--accent)]" : "text-slate-400"}`}>{d.getDate()}</div>
              <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                {dayEvents.slice(0, 3).map((e) => <EventBar key={e.id} e={e} cfg={cfg} onClick={() => onEvent(e)} />)}
                {dayEvents.length > 3 && <div className="px-1 text-[11px] text-slate-400">+{dayEvents.length - 3} mehr</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Termine – Liste
// ============================================================
function EventsTable({ events, cfg, projects, customers, loading, onEdit, onDelete, mayDelete }: {
  events: EventWithLinks[]; cfg: PlanningConfig; projects: ProjectOption[]; customers: CustomerOption[];
  loading: boolean; onEdit: (e: EventWithLinks) => void; onDelete: (e: EventWithLinks) => void; mayDelete: boolean;
}) {
  const projLabel = (id: string | null) => projects.find((p) => p.id === id)?.label ?? "–";
  const custLabel = (id: string | null) => customers.find((c) => c.id === id)?.label ?? "–";
  const empNames = (ids: string[]) => ids.map((id) => empName(cfg.employees.find((e) => e.id === id))).filter((x) => x !== "–").join(", ") || "–";
  const resNames = (ids: string[]) => ids.map((id) => cfg.resources.find((r) => r.id === id)?.name).filter(Boolean).join(", ") || "–";
  const { session } = useAuth();
  const evSort = useTableSort<EventWithLinks>(
    "planning_events",
    {
      start: { get: (e) => e.start_at, type: "date" },
      end: { get: (e) => e.end_at, type: "date" },
      title: { get: (e) => e.title, type: "text" },
      category: { get: (e) => cfg.categories.find((c) => c.id === e.category_id)?.name ?? null, type: "text" },
      project: { get: (e) => { const l = projLabel(e.project_id); return l === "–" ? null : l; }, type: "text" },
      customer: { get: (e) => { const l = custLabel(e.contact_id); return l === "–" ? null : l; }, type: "text" },
      employees: { get: (e) => { const l = empNames(e.employee_ids); return l === "–" ? null : l; }, type: "text" },
      resources: { get: (e) => { const l = resNames(e.resource_ids); return l === "–" ? null : l; }, type: "text" },
      status: { get: (e) => statusLabel(e.status), type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "start", dir: "asc" } }
  );
  if (loading) return <Spinner />;
  if (events.length === 0) return <Empty title="Noch keine Termine geplant." hint="Erstelle einen Termin oder passe die Filter an." />;
  const EV_COLS: { key: string; label: string }[] = [
    { key: "start", label: "Start" }, { key: "end", label: "Ende" }, { key: "title", label: "Titel" },
    { key: "category", label: "Kategorie" }, { key: "project", label: "Projekt" }, { key: "customer", label: "Kunde" },
    { key: "employees", label: "Mitarbeiter" }, { key: "resources", label: "Ressourcen" }, { key: "status", label: "Status" },
  ];
  return (
    <div className="glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
            <tr>
              {EV_COLS.map((c) => (
                <SortHeader key={c.key} label={c.label} sortKey={c.key} sort={evSort.sort} onSort={evSort.onSort}
                  padClass="px-3 py-2.5" className="whitespace-nowrap" />
              ))}
              <th className="whitespace-nowrap px-3 py-2.5 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {evSort.sortRows(events).map((e) => {
              const cat = cfg.categories.find((c) => c.id === e.category_id);
              return (
                <tr key={e.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => onEdit(e)}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">{fmtDate(e.start_at)}{!e.all_day && ` ${fmtTime(e.start_at)}`}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{fmtDate(e.end_at)}{!e.all_day && ` ${fmtTime(e.end_at)}`}</td>
                  <td className="px-3 py-2.5"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: eventColor(e, cfg.eventTypes, cfg.categories) }} /><span className="max-w-[180px] truncate font-medium">{e.title || "(ohne Titel)"}</span></div></td>
                  <td className="px-3 py-2.5">{cat ? <Badge tone="slate">{cat.name}</Badge> : "–"}</td>
                  <td className="px-3 py-2.5"><div className="max-w-[150px] truncate text-xs">{projLabel(e.project_id)}</div></td>
                  <td className="px-3 py-2.5"><div className="max-w-[130px] truncate text-xs">{custLabel(e.contact_id)}</div></td>
                  <td className="px-3 py-2.5"><div className="max-w-[150px] truncate text-xs">{empNames(e.employee_ids)}</div></td>
                  <td className="px-3 py-2.5"><div className="max-w-[140px] truncate text-xs">{resNames(e.resource_ids)}</div></td>
                  <td className="px-3 py-2.5"><Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge></td>
                  <td className="px-3 py-2.5 text-right" onClick={(ev) => ev.stopPropagation()}>
                    <button className="btn-ghost px-2" onClick={() => onEdit(e)} title="Bearbeiten"><Pencil size={15} /></button>
                    {mayDelete && <button className="btn-ghost px-2 text-rose-500" onClick={() => onDelete(e)} title="Löschen"><Trash2 size={15} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Ressourcen
// ============================================================
function ResourcesView({ cfg, mayEdit, mayDelete, onNew, onEdit, onDelete }: {
  cfg: PlanningConfig; mayEdit: boolean; mayDelete: boolean;
  onNew: () => void; onEdit: (r: Resource) => void; onDelete: (r: Resource) => void;
}) {
  const typeName = (id: string | null) => cfg.resourceTypes.find((t) => t.id === id)?.name ?? "–";
  const { session } = useAuth();
  const resSort = useTableSort<Resource>(
    "planning_resources",
    {
      name: { get: (r) => r.name, type: "text" },
      type: { get: (r) => { const n = typeName(r.resource_type_id); return n === "–" ? null : n; }, type: "text" },
      status: { get: (r) => (r.is_active ? 0 : 1), type: "number" },
    },
    { userId: session?.user?.id ?? null, default: { key: "name", dir: "asc" } }
  );
  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
        <h3 className="font-bold">Ressourcen</h3>
        {mayEdit && <button className="btn-primary py-1.5 text-sm" onClick={onNew}><Plus size={15} /> Ressource</button>}
      </div>
      {cfg.resources.length === 0 ? (
        <Empty title="Noch keine Ressourcen." hint="Lege Fahrzeuge, Geräte, Teams oder weitere Ressourcen an." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <th className="px-3 py-2.5"></th>
                <SortHeader label="Name" sortKey="name" sort={resSort.sort} onSort={resSort.onSort} padClass="px-3 py-2.5" />
                <SortHeader label="Typ" sortKey="type" sort={resSort.sort} onSort={resSort.onSort} padClass="px-3 py-2.5" />
                <SortHeader label="Status" sortKey="status" sort={resSort.sort} onSort={resSort.onSort} padClass="px-3 py-2.5" />
                <th className="px-3 py-2.5 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {resSort.sortRows(cfg.resources).map((r) => (
                <tr key={r.id}
                  className={`hover:bg-slate-50 dark:hover:bg-white/5 ${mayEdit ? "cursor-pointer" : ""}`}
                  onClick={mayEdit ? () => onEdit(r) : undefined}>
                  <td className="px-3 py-2.5"><span className="inline-block h-3 w-3 rounded-full" style={{ background: r.color }} /></td>
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{typeName(r.resource_type_id)}</td>
                  <td className="px-3 py-2.5">{r.is_active ? <Badge tone="green">Aktiv</Badge> : <Badge tone="slate">Inaktiv</Badge>}</td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    {mayEdit && <button className="btn-ghost px-2" onClick={() => onEdit(r)}><Pencil size={15} /></button>}
                    {mayDelete && <button className="btn-ghost px-2 text-rose-500" onClick={() => onDelete(r)}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Abwesenheiten
// ============================================================
function AbsencesView({ absences, cfg, loading, mayEdit, mayDelete, onNew, onEdit, onDelete }: {
  absences: Absence[]; cfg: PlanningConfig; loading: boolean; mayEdit: boolean; mayDelete: boolean;
  onNew: () => void; onEdit: (a: Absence) => void; onDelete: (a: Absence) => void;
}) {
  const { session } = useAuth();
  const absSort = useTableSort<Absence>(
    "planning_absences",
    {
      employee: { get: (a) => { const n = empName(cfg.employees.find((e) => e.id === a.employee_id)); return n === "–" ? null : n; }, type: "text" },
      kind: { get: (a) => absenceLabel(a.kind), type: "text" },
      from: { get: (a) => a.start_date, type: "date" },
      to: { get: (a) => a.end_date, type: "date" },
      status: { get: (a) => a.status, type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "from", dir: "desc" } }
  );
  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
        <h3 className="font-bold">Abwesenheiten</h3>
        {mayEdit && <button className="btn-primary py-1.5 text-sm" onClick={onNew}><Plus size={15} /> Abwesenheit</button>}
      </div>
      {loading ? <Spinner /> : absences.length === 0 ? (
        <Empty title="Keine Abwesenheiten im Zeitraum." hint="Trage Urlaub, Krankenstand o. Ä. ein." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <th className="px-3 py-2.5"></th>
                <SortHeader label="Mitarbeiter" sortKey="employee" sort={absSort.sort} onSort={absSort.onSort} padClass="px-3 py-2.5" />
                <SortHeader label="Art" sortKey="kind" sort={absSort.sort} onSort={absSort.onSort} padClass="px-3 py-2.5" />
                <SortHeader label="Von" sortKey="from" sort={absSort.sort} onSort={absSort.onSort} padClass="px-3 py-2.5" />
                <SortHeader label="Bis" sortKey="to" sort={absSort.sort} onSort={absSort.onSort} padClass="px-3 py-2.5" />
                <SortHeader label="Status" sortKey="status" sort={absSort.sort} onSort={absSort.onSort} padClass="px-3 py-2.5" />
                <th className="px-3 py-2.5 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {absSort.sortRows(absences).map((a) => (
                <tr key={a.id}
                  className={`hover:bg-slate-50 dark:hover:bg-white/5 ${mayEdit ? "cursor-pointer" : ""}`}
                  onClick={mayEdit ? () => onEdit(a) : undefined}>
                  <td className="px-3 py-2.5"><span className="inline-block h-3 w-3 rounded-full" style={{ background: a.color }} /></td>
                  <td className="px-3 py-2.5 font-medium">{empName(cfg.employees.find((e) => e.id === a.employee_id))}</td>
                  <td className="px-3 py-2.5"><Badge tone="red">{absenceLabel(a.kind)}</Badge></td>
                  <td className="px-3 py-2.5 text-xs">{fmtDate(a.start_date)}</td>
                  <td className="px-3 py-2.5 text-xs">{fmtDate(a.end_date)}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{a.status}</td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    {mayEdit && <button className="btn-ghost px-2" onClick={() => onEdit(a)}><Pencil size={15} /></button>}
                    {mayDelete && <button className="btn-ghost px-2 text-rose-500" onClick={() => onDelete(a)}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Einstellungen – Ressourcentypen / Kategorien / Terminarten
// ============================================================
function SettingsView({ cfg, reloadCfg, mayEdit, setErr }: {
  cfg: PlanningConfig; reloadCfg: () => void; mayEdit: boolean; setErr: (s: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <ConfigManager title="Ressourcentypen" table="planning_resource_types" rows={cfg.resourceTypes} withColor={false} reloadCfg={reloadCfg} mayEdit={mayEdit} setErr={setErr} />
      <ConfigManager title="Kategorien" table="planning_categories" rows={cfg.categories} withColor reloadCfg={reloadCfg} mayEdit={mayEdit} setErr={setErr} />
      <ConfigManager title="Terminarten" table="planning_event_types" rows={cfg.eventTypes} withColor reloadCfg={reloadCfg} mayEdit={mayEdit} setErr={setErr} />
    </div>
  );
}

function ConfigManager({ title, table, rows, withColor, reloadCfg, mayEdit, setErr }: {
  title: string; table: "planning_resource_types" | "planning_categories" | "planning_event_types";
  rows: any[]; withColor: boolean; reloadCfg: () => void; mayEdit: boolean; setErr: (s: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0ea5e9");
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    const row: any = { name: name.trim(), sort_order: (rows.length + 1) * 10 };
    if (withColor) row.color = color;
    const { error } = await saveConfigRow(table, row);
    setBusy(false);
    if (error) setErr(error); else { setName(""); reloadCfg(); }
  }
  async function toggle(r: any) { const { error } = await saveConfigRow(table, { id: r.id, is_active: !r.is_active }); if (error) setErr(error); else reloadCfg(); }
  async function del(r: any) { const { error } = await deleteConfigRow(table, r.id); if (error) setErr(error); else reloadCfg(); }
  return (
    <div className="glass p-4">
      <h3 className="mb-3 font-bold">{title}</h3>
      <div className="mb-3 space-y-1">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-white/5">
            {withColor && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />}
            <span className={`flex-1 ${r.is_active ? "" : "text-slate-400 line-through"}`}>{r.name}</span>
            {mayEdit && <>
              <button className="text-xs text-slate-400 hover:text-[var(--accent)]" onClick={() => toggle(r)}>{r.is_active ? "Deaktivieren" : "Aktivieren"}</button>
              <button className="text-rose-400 hover:text-rose-600" onClick={() => del(r)}><Trash2 size={14} /></button>
            </>}
          </div>
        ))}
      </div>
      {mayEdit && (
        <div className="flex items-center gap-2">
          {withColor && <input type="color" className="h-8 w-8 rounded border-0 bg-transparent p-0" value={color} onChange={(e) => setColor(e.target.value)} />}
          <input className="input flex-1" placeholder="Neu …" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn-outline px-2" disabled={busy} onClick={add}><Plus size={16} /></button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Termin-Dialog (mit Konfliktprüfung)
// ============================================================
function EventDialog({ draft, cfg, projects, customers, uid, onClose, onSaved, setErr }: {
  draft: Partial<EventWithLinks>; cfg: PlanningConfig; projects: ProjectOption[]; customers: CustomerOption[];
  uid: string | null; onClose: () => void; onSaved: () => void; setErr: (s: string | null) => void;
}) {
  const [f, setF] = useState<Partial<EventWithLinks>>({ ...draft });
  const [empIds, setEmpIds] = useState<string[]>(draft.employee_ids ?? []);
  const [resIds, setResIds] = useState<string[]>(draft.resource_ids ?? []);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOn, setAiOn] = useState(true);
  const [rec, setRec] = useState<{ freq: string; interval: number; endMode: "count" | "until"; count: number; until: string }>(
    { freq: "none", interval: 1, endMode: "count", count: 5, until: "" });
  const isNew = !draft.id;
  useEffect(() => { loadAiSettings().then((su) => setAiOn(aiModuleEnabled(su, "planung"))); }, []);

  async function aiSuggest() {
    if (!f.title?.trim()) { setErr("Bitte zuerst einen Titel eingeben."); return; }
    setAiBusy(true); setErr(null);
    const typeNames = cfg.eventTypes.map((t) => t.name).join(", ");
    const catNames = cfg.categories.map((c) => c.name).join(", ");
    const ctx = [f.location ? `Ort: ${f.location}` : "", f.project_id ? "mit Projektbezug" : ""].filter(Boolean).join(", ");
    const prompt = `Termin-Titel: "${f.title}". ${ctx}\n` +
      `Verfügbare Terminarten: ${typeNames}.\nVerfügbare Kategorien: ${catNames}.\n` +
      `Gib NUR JSON zurück: {"terminart": <exakter Name oder "">, "kategorie": <exakter Name oder "">, "dauer_minuten": <Zahl>, "beschreibung": <kurzer, hilfreicher Text auf Deutsch>}.`;
    const { data, error } = await aiJson<{ terminart?: string; kategorie?: string; dauer_minuten?: number; beschreibung?: string }>(
      prompt, "Du bist ein Planungs-Assistent für eine Bau-/Handwerksfirma. Antworte ausschließlich mit gültigem JSON.",
      { module: "planung", action: "termin_vorschlag" });
    setAiBusy(false);
    if (error) { setErr(error); return; }
    if (!data) return;
    const t = cfg.eventTypes.find((x) => x.name.toLowerCase() === (data.terminart || "").toLowerCase());
    const c = cfg.categories.find((x) => x.name.toLowerCase() === (data.kategorie || "").toLowerCase());
    if (t) set("event_type_id", t.id as any);
    if (c) set("category_id", c.id as any);
    if (data.beschreibung && !f.description) set("description", data.beschreibung as any);
    if (data.dauer_minuten && Number(data.dauer_minuten) > 0) {
      const s = new Date(startLocal); const e = new Date(s.getTime() + Number(data.dauer_minuten) * 60000);
      setEndLocal(isoLocal(e));
    }
  }
  // datetime-local-Werte (Start/Ende)
  const [startLocal, setStartLocal] = useState<string>(() => normLocal(draft.start_at));
  const [endLocal, setEndLocal] = useState<string>(() => normLocal(draft.end_at));

  function set<K extends keyof EventWithLinks>(k: K, v: EventWithLinks[K]) { setF((p) => ({ ...p, [k]: v })); }
  function onType(id: string) {
    set("event_type_id", id as any);
    const t = cfg.eventTypes.find((x) => x.id === id);
    if (t && isNew) {
      // Standarddauer & Farbe vorschlagen
      const s = new Date(startLocal); const e = new Date(s.getTime() + (t.default_duration_min || 60) * 60000);
      setEndLocal(isoLocal(e)); if (t.is_absence) set("all_day", true as any);
    }
  }

  const toggle = (arr: string[], id: string, setArr: (a: string[]) => void) =>
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  async function save(force = false) {
    if (!f.title?.trim()) { setErr("Bitte einen Titel angeben."); return; }
    const startISO = new Date(startLocal).toISOString();
    const endISO = new Date(endLocal || startLocal).toISOString();
    if (new Date(endISO) < new Date(startISO)) { setErr("Ende darf nicht vor dem Start liegen."); return; }
    setBusy(true); setErr(null);
    // Konfliktprüfung (nur beim ersten Versuch)
    if (!force) {
      const c = await checkConflicts({ startISO, endISO, employeeIds: empIds, resourceIds: resIds, excludeEventId: f.id ?? null, employees: cfg.employees, resources: cfg.resources });
      if (c.length) { setConflicts(c); setBusy(false); return; }
    }
    const nn = (v: any) => (v ? v : null); // "" → null (für UUID-Spalten)
    const base = {
      title: f.title!.trim(), event_type_id: nn(f.event_type_id), category_id: nn(f.category_id),
      status: f.status ?? "geplant", priority: f.priority ?? "normal", color: nn(f.color),
      all_day: !!f.all_day, project_id: nn(f.project_id), contact_id: nn(f.contact_id),
      location: f.location ?? null, description: f.description ?? null, visibility: f.visibility ?? "intern",
      created_by: f.created_by ?? uid, employee_ids: empIds, resource_ids: resIds,
    };
    const recMeta = isNew && rec.freq !== "none"
      ? { freq: rec.freq, interval: rec.interval, endMode: rec.endMode, count: rec.count, until: rec.until } : null;
    const occ = recMeta ? buildOccurrences(new Date(startISO), new Date(endISO), rec) : [{ s: new Date(startISO), e: new Date(endISO) }];
    let firstErr: string | undefined;
    for (const o of occ) {
      const { error } = await saveEvent({
        ...base, id: occ.length === 1 ? f.id : undefined,
        start_at: o.s.toISOString(), end_at: o.e.toISOString(), recurrence: recMeta as any,
      });
      if (error) { firstErr = error; break; }
    }
    setBusy(false);
    if (firstErr) setErr(firstErr); else onSaved();
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Termin erstellen" : "Termin bearbeiten"} size="xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2 text-xs font-medium text-slate-500">Titel
          <div className="mt-1 flex gap-2">
            <input className="input flex-1" value={f.title ?? ""} onChange={(e) => set("title", e.target.value as any)} autoFocus />
            {aiOn && (
              <button type="button" className="btn-outline shrink-0" disabled={aiBusy} onClick={aiSuggest} title="KI schlägt Terminart, Kategorie, Dauer & Beschreibung vor">
                <Sparkles size={15} /> {aiBusy ? "…" : "KI-Vorschlag"}
              </button>
            )}
          </div>
        </label>
        <label className="text-xs font-medium text-slate-500">Terminart
          <select className="input mt-1" value={f.event_type_id ?? ""} onChange={(e) => onType(e.target.value)}>
            <option value="">– wählen –</option>
            {cfg.eventTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500">Kategorie
          <select className="input mt-1" value={f.category_id ?? ""} onChange={(e) => set("category_id", e.target.value as any)}>
            <option value="">– wählen –</option>
            {cfg.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={!!f.all_day} onChange={(e) => set("all_day", e.target.checked as any)} /> Ganztägig
        </label>
        <label className="text-xs font-medium text-slate-500">Start
          <input className="input mt-1" type={f.all_day ? "date" : "datetime-local"} value={f.all_day ? startLocal.slice(0, 10) : startLocal} onChange={(e) => setStartLocal(f.all_day ? e.target.value + "T00:00" : e.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-500">Ende
          <input className="input mt-1" type={f.all_day ? "date" : "datetime-local"} value={f.all_day ? endLocal.slice(0, 10) : endLocal} onChange={(e) => setEndLocal(f.all_day ? e.target.value + "T23:59" : e.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-500">Projekt
          <select className="input mt-1" value={f.project_id ?? ""} onChange={(e) => set("project_id", e.target.value as any)}>
            <option value="">– kein Projekt –</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500">Kunde
          <select className="input mt-1" value={f.contact_id ?? ""} onChange={(e) => set("contact_id", e.target.value as any)}>
            <option value="">– kein Kunde –</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="sm:col-span-2 text-xs font-medium text-slate-500">Adresse / Einsatzort
          <input className="input mt-1" value={f.location ?? ""} onChange={(e) => set("location", e.target.value as any)} />
        </label>
        <label className="text-xs font-medium text-slate-500">Status
          <select className="input mt-1" value={f.status ?? "geplant"} onChange={(e) => set("status", e.target.value as any)}>
            {EVENT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500">Priorität
          <select className="input mt-1" value={f.priority ?? "normal"} onChange={(e) => set("priority", e.target.value as any)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        {isNew && (
          <div className="sm:col-span-2 rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500"><Repeat size={14} /> Wiederholung</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select className="input w-auto" value={rec.freq} onChange={(e) => setRec({ ...rec, freq: e.target.value })}>
                <option value="none">Keine</option>
                <option value="daily">Täglich</option>
                <option value="weekly">Wöchentlich</option>
                <option value="monthly">Monatlich</option>
                <option value="yearly">Jährlich</option>
              </select>
              {rec.freq !== "none" && <>
                <span className="text-slate-400">alle</span>
                <input className="input w-16" type="number" min={1} value={rec.interval} onChange={(e) => setRec({ ...rec, interval: Number(e.target.value) || 1 })} />
                <select className="input w-auto" value={rec.endMode} onChange={(e) => setRec({ ...rec, endMode: e.target.value as any })}>
                  <option value="count">endet nach Anzahl</option>
                  <option value="until">endet am Datum</option>
                </select>
                {rec.endMode === "count"
                  ? <input className="input w-20" type="number" min={1} value={rec.count} onChange={(e) => setRec({ ...rec, count: Number(e.target.value) || 1 })} />
                  : <input className="input w-auto" type="date" value={rec.until} onChange={(e) => setRec({ ...rec, until: e.target.value })} />}
              </>}
            </div>
          </div>
        )}

        {/* Mitarbeiter */}
        <div className="text-xs font-medium text-slate-500">Mitarbeiter
          <div className="mt-1 max-h-28 overflow-y-auto rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
            {cfg.employees.length === 0 ? <span className="text-slate-400">Keine Mitarbeiter</span> : cfg.employees.map((u) => (
              <label key={u.id} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" checked={empIds.includes(u.id)} onChange={() => toggle(empIds, u.id, setEmpIds)} /> {empName(u)}
              </label>
            ))}
          </div>
        </div>
        {/* Ressourcen */}
        <div className="text-xs font-medium text-slate-500">Ressourcen
          <div className="mt-1 max-h-28 overflow-y-auto rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
            {cfg.resources.length === 0 ? <span className="text-slate-400">Keine Ressourcen</span> : cfg.resources.map((r) => (
              <label key={r.id} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" checked={resIds.includes(r.id)} onChange={() => toggle(resIds, r.id, setResIds)} /> {r.name}
              </label>
            ))}
          </div>
        </div>

        <label className="sm:col-span-2 text-xs font-medium text-slate-500">Beschreibung / Notiz
          <textarea className="input mt-1" rows={2} value={f.description ?? ""} onChange={(e) => set("description", e.target.value as any)} />
        </label>
      </div>

      {conflicts.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="mb-1 font-semibold text-amber-700 dark:text-amber-300">Konflikte erkannt:</div>
          <ul className="list-disc pl-5 text-amber-700 dark:text-amber-200">
            {conflicts.map((c, i) => <li key={i}>{c.message}</li>)}
          </ul>
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-300/80">Du kannst trotzdem speichern.</div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
        {conflicts.length > 0
          ? <button className="btn-primary" disabled={busy} onClick={() => save(true)}>Trotzdem speichern</button>
          : <button className="btn-primary" disabled={busy} onClick={() => save(false)}>Speichern</button>}
      </div>
    </Modal>
  );
}
function normLocal(v: any): string {
  if (!v) return isoLocal(new Date());
  if (typeof v === "string" && v.length === 16 && v.includes("T")) return v; // bereits local
  try { return isoLocal(new Date(v)); } catch { return isoLocal(new Date()); }
}
function shiftDate(d: Date, freq: string, n: number): Date {
  const x = new Date(d);
  if (freq === "daily") x.setDate(x.getDate() + n);
  else if (freq === "weekly") x.setDate(x.getDate() + 7 * n);
  else if (freq === "monthly") x.setMonth(x.getMonth() + n);
  else if (freq === "yearly") x.setFullYear(x.getFullYear() + n);
  return x;
}
function buildOccurrences(start: Date, end: Date, rec: { freq: string; interval: number; endMode: string; count: number; until: string }): { s: Date; e: Date }[] {
  const dur = end.getTime() - start.getTime();
  const out: { s: Date; e: Date }[] = [];
  const untilDate = rec.until ? new Date(rec.until + "T23:59") : null;
  const MAX = 200;
  for (let i = 0; i < MAX; i++) {
    const s = shiftDate(start, rec.freq, Math.max(1, rec.interval) * i);
    if (rec.endMode === "count" && i >= Math.max(1, rec.count)) break;
    if (rec.endMode === "until" && untilDate && s > untilDate) break;
    out.push({ s, e: new Date(s.getTime() + dur) });
  }
  return out.length ? out : [{ s: start, e: end }];
}

// ── iCal/ICS-Export (Outlook/Apple/Google importierbar) ──
function icsDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function icsEsc(s: string): string { return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
function downloadICS(events: EventWithLinks[], _cfg?: PlanningConfig) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${APP_NAME}//Planung//DE`, "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@b4y-superapp`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
      `DTSTART:${icsDate(e.start_at)}`, `DTEND:${icsDate(e.end_at)}`, `SUMMARY:${icsEsc(e.title || "Termin")}`);
    if (e.location) lines.push(`LOCATION:${icsEsc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEsc(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `planung_${new Date().toISOString().slice(0, 10)}.ics`; a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Ressourcen-Dialog
// ============================================================
function ResourceDialog({ draft, cfg, onClose, onSaved, setErr }: {
  draft: Partial<Resource>; cfg: PlanningConfig; onClose: () => void; onSaved: () => void; setErr: (s: string | null) => void;
}) {
  const [f, setF] = useState<Partial<Resource>>({ ...draft });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Resource>) => setF((p) => ({ ...p, ...patch }));
  async function save() {
    if (!f.name?.trim()) { setErr("Bitte einen Namen angeben."); return; }
    setBusy(true);
    const { error } = await saveResource({
      id: f.id, name: f.name.trim(), resource_type_id: f.resource_type_id ?? null, category_id: f.category_id ?? null,
      employee_id: f.employee_id ?? null, color: f.color ?? "#64748b", description: f.description ?? null,
      is_active: f.is_active !== false, sort_order: f.sort_order ?? 0,
    });
    setBusy(false);
    if (error) setErr(error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={draft.id ? "Ressource bearbeiten" : "Ressource anlegen"}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-500">Name
          <input className="input mt-1" value={f.name ?? ""} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </label>
        <label className="block text-xs font-medium text-slate-500">Typ
          <select className="input mt-1" value={f.resource_type_id ?? ""} onChange={(e) => set({ resource_type_id: e.target.value || null })}>
            <option value="">– wählen –</option>
            {cfg.resourceTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-500">Verknüpfter Mitarbeiter (optional)
          <select className="input mt-1" value={f.employee_id ?? ""} onChange={(e) => set({ employee_id: e.target.value || null })}>
            <option value="">–</option>
            {cfg.employees.map((u) => <option key={u.id} value={u.id}>{empName(u)}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">Farbe <input type="color" className="h-8 w-10 rounded border-0 bg-transparent p-0" value={f.color ?? "#64748b"} onChange={(e) => set({ color: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active !== false} onChange={(e) => set({ is_active: e.target.checked })} /> Aktiv</label>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={busy} onClick={save}>Speichern</button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// Abwesenheits-Dialog
// ============================================================
function AbsenceDialog({ draft, cfg, onClose, onSaved, setErr }: {
  draft: Partial<Absence>; cfg: PlanningConfig; onClose: () => void; onSaved: () => void; setErr: (s: string | null) => void;
}) {
  const [f, setF] = useState<Partial<Absence>>({ ...draft });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Absence>) => setF((p) => ({ ...p, ...patch }));
  async function save() {
    if (!f.employee_id) { setErr("Bitte einen Mitarbeiter wählen."); return; }
    if (!f.start_date || !f.end_date) { setErr("Bitte Zeitraum angeben."); return; }
    setBusy(true);
    const { error } = await saveAbsence({
      id: f.id, employee_id: f.employee_id, kind: f.kind ?? "urlaub",
      start_date: f.start_date!, end_date: f.end_date!, all_day: f.all_day !== false,
      status: f.status ?? "bestaetigt", color: f.color ?? "#ef4444", note: f.note ?? null,
    });
    setBusy(false);
    if (error) setErr(error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={draft.id ? "Abwesenheit bearbeiten" : "Abwesenheit eintragen"}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-500">Mitarbeiter
          <select className="input mt-1" value={f.employee_id ?? ""} onChange={(e) => set({ employee_id: e.target.value || null })} autoFocus>
            <option value="">– wählen –</option>
            {cfg.employees.map((u) => <option key={u.id} value={u.id}>{empName(u)}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-500">Art
          <select className="input mt-1" value={f.kind ?? "urlaub"} onChange={(e) => { const k = e.target.value; set({ kind: k, color: ABSENCE_KINDS.find((a) => a.key === k)?.color ?? "#ef4444" }); }}>
            {ABSENCE_KINDS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <label className="flex-1 text-xs font-medium text-slate-500">Von
            <input className="input mt-1" type="date" value={f.start_date ?? ""} onChange={(e) => set({ start_date: e.target.value })} />
          </label>
          <label className="flex-1 text-xs font-medium text-slate-500">Bis
            <input className="input mt-1" type="date" value={f.end_date ?? ""} onChange={(e) => set({ end_date: e.target.value })} />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-500">Notiz
          <input className="input mt-1" value={f.note ?? ""} onChange={(e) => set({ note: e.target.value })} />
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={busy} onClick={save}>Speichern</button>
        </div>
      </div>
    </Modal>
  );
}
