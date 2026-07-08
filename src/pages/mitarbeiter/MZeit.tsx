// ============================================================
// Installateursoftware – Mitarbeiter-App: Zeiterfassung (/m/zeit)
//
// Mobil-optimierte Ist-Zeiterfassung: heutige Einträge, großer „Zeit erfassen"-
// Button (öffnet ein schlankes Formular als Vollbild-Sheet), Wochensumme unten.
// Nutzt den zentralen Datenlayer (saveTimeEntry, loadTimeEntries, summarize,
// loadEmployeeSollContext) – Stunden aus Von/Bis−Pause via hoursFromRange.
// Optionales Vorbelegen des Projekts über ?projekt=<id>. Bewusst OHNE
// TimeEntryDialog (paralleler Build) – eigenes, leichtes Formular. RLS greift
// serverseitig; Einträge sind immer die des eingeloggten Mitarbeiters.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Clock, MapPin, CalendarCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Empty, Spinner, Modal } from "../../components/ui";
import { ErrorBanner } from "../../components/calc-ui";
import { useMyEmployee } from "../../lib/my-employee";
import { toast, toastError } from "../../lib/toast";
import { resolveDaySoll, type SollContext } from "../../lib/work-calendar";
import {
  loadTimeEntries, saveTimeEntry, summarize, loadEmployeeSollContext, loadCompanyHolidays,
  hoursFromRange, fmtHours, fmtSaldo, LOCATION_TYPES, TimeEntry, LocationType,
} from "../../lib/time-entries";

const pad2 = (n: number) => String(n).padStart(2, "0");
// Endzeit aus Start + Dauer(h) + Pause(min).
function addToTime(start: string, hours: number, pauseMin: number): string {
  const [sh, sm] = start.split(":").map(Number);
  const total = sh * 60 + sm + Math.round(hours * 60) + pauseMin;
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

type FormPreset = { start?: string; end?: string; pause?: number } | null;

type ProjectOpt = { id: string; title: string | null; project_number: string | null };

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Mo=0 … So=6
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}
const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const locationLabel = (v: string): string => LOCATION_TYPES.find((l) => l.value === v)?.label ?? v;
const locationIcon = (v: string): string => LOCATION_TYPES.find((l) => l.value === v)?.icon ?? "📍";

export default function MZeit() {
  const { employee, loading } = useMyEmployee();
  const [sp] = useSearchParams();
  const projektParam = sp.get("projekt");

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [ctx, setCtx] = useState<SollContext | null>(null);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [dataLoading, setDataLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [preset, setPreset] = useState<FormPreset>(null);

  const todayIso = isoDate(new Date());
  const weekFrom = isoDate(startOfWeek(new Date()));
  const year = new Date().getFullYear();

  // Stammdaten (Soll-Kontext, Feiertage, Projekte) einmalig laden.
  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    Promise.all([
      loadEmployeeSollContext(year, employee.id),
      loadCompanyHolidays(year, year),
      supabase.from("projects").select("id,title,project_number").eq("archived", false).order("created_at", { ascending: false }),
    ]).then(([c, h, p]) => {
      if (cancelled) return;
      setCtx(c);
      setHolidays(new Set(h.map((x) => x.datum)));
      setProjects((p.data as ProjectOpt[]) ?? []);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee]);

  async function reloadEntries() {
    if (!employee) return;
    setDataLoading(true);
    try {
      const list = await loadTimeEntries({ employeeId: employee.id, from: weekFrom, to: todayIso });
      setEntries(list);
    } catch (e: any) {
      setErr(e?.message ?? "Laden fehlgeschlagen.");
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => {
    if (employee) void reloadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee]);

  const projLabel = (id: string | null): string => {
    if (!id) return "";
    const p = projects.find((x) => x.id === id);
    return p ? [p.project_number, p.title].filter(Boolean).join(" · ") : "";
  };

  const todayEntries = useMemo(
    () => entries.filter((e) => e.work_date === todayIso),
    [entries, todayIso],
  );

  const week = useMemo(() => {
    if (!ctx) return null;
    return summarize(entries, weekFrom, todayIso, ctx, holidays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, ctx, holidays, weekFrom, todayIso]);

  // Regelarbeitszeit heute (Soll) und noch fehlende Stunden (Soll − bereits gebucht).
  const todaySoll = useMemo(
    () => (ctx ? Math.round(resolveDaySoll(new Date(`${todayIso}T00:00:00`), ctx) * 100) / 100 : 0),
    [ctx, todayIso],
  );
  const todayIst = useMemo(
    () => todayEntries.filter((e) => e.entry_kind === "arbeit").reduce((a, e) => a + (Number(e.hours) || 0), 0),
    [todayEntries],
  );
  const remaining = Math.max(0, Math.round((todaySoll - todayIst) * 100) / 100);

  // „Regelarbeitszeit einfüllen": öffnet das Formular mit einem Block, der den Tag
  // auf die Regelarbeitszeit auffüllt – beginnend nach dem letzten Eintrag (sonst 07:00).
  function fillRegularHours() {
    if (todaySoll <= 0) { toast("Heute ist kein Regelarbeitstag."); return; }
    if (remaining <= 0) { toast("Regelarbeitszeit für heute ist bereits erreicht."); return; }
    const lastEnd = todayEntries.map((e) => e.end_time).filter(Boolean).map((t) => (t as string).slice(0, 5)).sort().pop();
    const start = lastEnd || "07:00";
    const pause = remaining >= 6 ? 30 : 0; // grobe Standardpause bei längeren Tagen
    setPreset({ start, end: addToTime(start, remaining, pause), pause });
    setFormOpen(true);
  }

  // Standard-Regelarbeitstag als Vorbelegung für „Zeit erfassen" (1-Tap-Standardtag,
  // Vorbild Birgmann): 07:00 + Regelarbeitszeit, Pause bei längeren Tagen.
  function regularDayPreset(): FormPreset {
    if (todaySoll <= 0) return null;
    const pause = todaySoll >= 6 ? 30 : 0;
    return { start: "07:00", end: addToTime("07:00", todaySoll, pause), pause };
  }

  if (loading) return <Spinner />;
  if (!employee) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Zeiterfassung</h1>
        <Empty
          title="Kein Mitarbeiterprofil verknüpft"
          hint="Dein Login ist noch keinem Mitarbeiter zugeordnet. Bitte wende dich an die Verwaltung."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Zeiterfassung</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Heutige Einträge & Wochensumme.</p>
      </div>

      <ErrorBanner message={err} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button className="btn-primary min-h-[52px] w-full justify-center text-base" onClick={() => { setPreset(regularDayPreset()); setFormOpen(true); }}>
          <Plus size={18} /> Zeit erfassen
        </button>
        <button className="btn-outline min-h-[52px] w-full justify-center text-base" onClick={fillRegularHours} disabled={!ctx}>
          <CalendarCheck size={18} /> Regelarbeitszeit
          {todaySoll > 0 && <span className="ml-1 tabular-nums opacity-70">{remaining > 0 ? `(+${fmtHours(remaining)} h)` : "✓"}</span>}
        </button>
      </div>

      {/* Heutige Einträge */}
      <div className="glass p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Heute</h2>
        {dataLoading ? (
          <div className="py-4"><Spinner /></div>
        ) : todayEntries.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">Noch keine Zeit für heute erfasst.</p>
        ) : (
          <div className="space-y-2">
            {todayEntries.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-xl p-3"
                style={{ background: "var(--hover)" }}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg" title={locationLabel(e.location_type)}>
                  {locationIcon(e.location_type)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {e.start_time && e.end_time ? (
                      <span className="tabular-nums">{e.start_time.slice(0, 5)}–{e.end_time.slice(0, 5)}</span>
                    ) : (
                      <span>{locationLabel(e.location_type)}</span>
                    )}
                    <span className="text-slate-400">·</span>
                    <span className="tabular-nums">{fmtHours(e.hours)} h</span>
                  </div>
                  {(projLabel(e.project_id) || e.description) && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {projLabel(e.project_id) && (
                        <>
                          <MapPin size={12} className="shrink-0" />
                          <span className="truncate">{projLabel(e.project_id)}</span>
                        </>
                      )}
                      {projLabel(e.project_id) && e.description && <span>·</span>}
                      {e.description && <span className="truncate">{e.description}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wochensumme */}
      <div className="glass p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Diese Woche</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl p-3 text-center" style={{ background: "var(--hover)" }}>
            <div className="text-2xl font-extrabold tabular-nums">{fmtHours(week?.istTotal ?? 0)}</div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Ist-Std.</div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: "var(--hover)" }}>
            <div className="text-2xl font-extrabold tabular-nums">{fmtHours(week?.sollTotal ?? 0)}</div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Soll-Std.</div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: "var(--hover)" }}>
            <div
              className="text-2xl font-extrabold tabular-nums"
              style={{ color: (week?.autoSaldo ?? 0) < 0 ? "var(--c-red)" : "var(--c-green)" }}
            >
              {fmtSaldo(week?.autoSaldo ?? 0)}
            </div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Saldo</div>
          </div>
        </div>
      </div>

      {formOpen && (
        <ZeitForm
          employeeId={employee.id}
          projects={projects}
          defaultProjectId={projektParam ?? ""}
          preset={preset}
          onClose={() => { setFormOpen(false); setPreset(null); }}
          onSaved={() => { setFormOpen(false); setPreset(null); void reloadEntries(); }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Erfassungs-Formular (Vollbild-Sheet auf Mobil via Modal)
// ------------------------------------------------------------
function ZeitForm({
  employeeId, projects, defaultProjectId, preset, onClose, onSaved,
}: {
  employeeId: string;
  projects: ProjectOpt[];
  defaultProjectId: string;
  preset: FormPreset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [datum, setDatum] = useState<string>(isoDate(new Date()));
  const [locationType, setLocationType] = useState<LocationType>("baustelle");
  const [projectId, setProjectId] = useState<string>(defaultProjectId);
  const [start, setStart] = useState(preset?.start ?? "");
  const [end, setEnd] = useState(preset?.end ?? "");
  const [pause, setPause] = useState<number>(preset?.pause ?? 0);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hours = useMemo(() => hoursFromRange(start || null, end || null, pause), [start, end, pause]);

  async function save() {
    if (!start || !end) { setErr("Bitte Von- und Bis-Uhrzeit angeben."); return; }
    if (hours <= 0) { setErr("Die Dauer muss größer als 0 sein."); return; }
    setBusy(true); setErr(null);
    const { error } = await saveTimeEntry({
      employee_id: employeeId,
      project_id: projectId || null,
      work_date: datum,
      start_time: start,
      end_time: end,
      pause_minutes: pause || 0,
      description: description.trim() || null,
      location_type: locationType,
      entry_kind: "arbeit",
    });
    setBusy(false);
    if (error) { setErr(error); toastError(error); return; }
    toast("Zeit erfasst.");
    onSaved();
  }

  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title="Zeit erfassen">
      <ErrorBanner message={err} />
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Datum</span>
          <input type="date" className="input" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </label>

        <div className="block">
          <span className="mb-1 block text-sm font-semibold">Arbeitsort</span>
          <div className="grid grid-cols-2 gap-2">
            {LOCATION_TYPES.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLocationType(l.value)}
                className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${
                  locationType === l.value ? "text-white" : "text-slate-600 dark:text-slate-300"
                }`}
                style={locationType === l.value ? { background: "var(--accent)" } : { background: "var(--hover)" }}
              >
                <span className="text-base">{l.icon}</span> {l.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Projekt (optional)</span>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Ohne Projekt</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {[p.project_number, p.title].filter(Boolean).join(" · ") || "(ohne Titel)"}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Von</span>
            <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Bis</span>
            <input type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-2 items-end gap-3">
          <div className="block">
            <span className="mb-1 block text-sm font-semibold">Pause</span>
            <div className="flex gap-1.5">
              {[0, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPause(m)}
                  className={`min-h-[44px] flex-1 rounded-xl text-sm font-semibold tabular-nums transition ${
                    pause === m ? "text-white" : "text-slate-600 dark:text-slate-300"
                  }`}
                  style={pause === m ? { background: "var(--accent)" } : { background: "var(--hover)" }}
                >
                  {m === 0 ? "–" : m}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: "var(--hover)" }}>
            <div className="flex items-center justify-center gap-1 text-2xl font-extrabold tabular-nums">
              <Clock size={18} className="text-slate-400" /> {fmtHours(hours)}
            </div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Stunden</div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Beschreibung (optional)</span>
          <textarea
            className="input min-h-[90px]"
            placeholder="Was wurde gemacht?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-5 flex gap-3">
        <button className="btn-outline min-h-[48px] flex-1 justify-center" onClick={onClose} disabled={busy}>
          Abbrechen
        </button>
        <button className="btn-primary min-h-[48px] flex-1 justify-center" onClick={save} disabled={busy}>
          {busy ? "Speichert …" : "Speichern"}
        </button>
      </div>
    </Modal>
  );
}
