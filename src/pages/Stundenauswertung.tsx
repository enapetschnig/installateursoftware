// ============================================================
// Installateursoftware – Stundenauswertung (/stundenauswertung)
// Admin-/Büro-Auswertung des Moduls `time_tracking`.
//   • Tab "Mitarbeiter": Monatstabelle je Mitarbeiter (Ist/Soll/Saldo +
//     Zeitkonto), Freigabe je Tag (setApproved) und Admin-Nachtrag
//     (markBackdated).
//   • Tab "Projekte": alle Einträge aller Mitarbeiter zu einem Projekt +
//     Zeitraum mit Summen je Mitarbeiter.
// CSV-Export ohne neue Abhängigkeit (Blob-Download).
//
// Rechte: Nicht-Admin ohne time_tracking-view sieht ausschließlich die
// eigenen Stunden. Freigabe/Nachtrag erfordern time_tracking-edit.
// Berechnung kommt vollständig aus dem zentralen Datenlayer (summarize).
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, FolderKanban, Download, Plus } from "lucide-react";
import { PageHeader, Stat, Empty, Spinner } from "../components/ui";
import { ErrorBanner } from "../components/calc-ui";
import { dateAt } from "../lib/format";
import { toast, toastError } from "../lib/toast";
import { usePermissions } from "../lib/permissions";
import { useEmployees, employeeDisplayName } from "../lib/project-config";
import { useMyEmployee } from "../lib/my-employee";
import { loadProjectOptions, ProjectOption } from "../lib/documents-overview";
import {
  TimeEntry, DaySummary, MonthSummary,
  loadTimeEntries, summarize, loadEmployeeSollContext, loadCompanyHolidays,
  loadTimeAccount, setApproved, markBackdated,
  fmtHours, entryKindLabel, isSpecialKind,
} from "../lib/time-entries";
import TimeEntryDialog from "../components/time/TimeEntryDialog";
import { TimeStatCards, MonthEntriesTable, locationLabel, isoDate, monthRange } from "./MeineStunden";

const pad2 = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - 4 + i);

// Einfacher, abhängigkeitsfreier CSV-Download (de-AT: ";"-getrennt, BOM für Excel).
function downloadCsv(head: string[], rows: string[][], filename: string) {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const timeRange = (e: TimeEntry) => `${(e.start_time ?? "").slice(0, 5)}–${(e.end_time ?? "").slice(0, 5)}`;
const cleanText = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

type Tab = "mitarbeiter" | "projekte";

export default function Stundenauswertung() {
  const { isAdmin, can, loading: permLoading } = usePermissions();
  const mayViewOthers = isAdmin || can("time_tracking", "view");
  const mayEdit = isAdmin || can("time_tracking", "edit");
  const mayExport = isAdmin || can("time_tracking", "export");

  const { employees } = useEmployees();
  const { employee: me } = useMyEmployee();

  const [tab, setTab] = useState<Tab>("mitarbeiter");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [empId, setEmpId] = useState("");

  useEffect(() => { loadProjectOptions().then(setProjects).catch(() => { /* optional */ }); }, []);

  // Standard-Mitarbeiter setzen; ohne "view"-Recht ist man auf sich selbst beschränkt.
  useEffect(() => {
    if (!mayViewOthers) { if (me) setEmpId(me.id); return; }
    if (!empId) {
      if (me) setEmpId(me.id);
      else if (employees.length) setEmpId(employees[0].id);
    }
  }, [mayViewOthers, me, employees, empId]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, employeeDisplayName(e));
    return m;
  }, [employees]);

  const projectLabel = useCallback(
    (id: string | null) => projects.find((p) => p.id === id)?.label ?? "Projekt",
    [projects],
  );

  if (permLoading) return <Spinner />;

  return (
    <>
      <PageHeader title="Stundenauswertung" subtitle="Auswertung & Freigabe der erfassten Arbeitszeiten" />

      <div className="seg mb-4 w-fit">
        <button className="seg-btn" data-active={tab === "mitarbeiter"} onClick={() => setTab("mitarbeiter")}>
          <Clock size={15} /> Mitarbeiter
        </button>
        <button className="seg-btn" data-active={tab === "projekte"} onClick={() => setTab("projekte")}>
          <FolderKanban size={15} /> Projekte
        </button>
      </div>

      {tab === "mitarbeiter" ? (
        <EmployeeTab
          month={month} year={year} setMonth={setMonth} setYear={setYear}
          empId={empId} setEmpId={setEmpId}
          employees={employees} nameById={nameById}
          mayViewOthers={mayViewOthers} mayEdit={mayEdit} mayExport={mayExport}
          projects={projects} projectLabel={projectLabel}
        />
      ) : (
        <ProjectTab projects={projects} nameById={nameById} projectLabel={projectLabel} mayExport={mayExport} />
      )}
    </>
  );
}

// ============================================================
// Tab: Mitarbeiter (Monatstabelle + Freigabe + Nachtrag)
// ============================================================
function EmployeeTab({
  month, year, setMonth, setYear, empId, setEmpId, employees, nameById,
  mayViewOthers, mayEdit, mayExport, projects, projectLabel,
}: {
  month: number; year: number;
  setMonth: (m: number) => void; setYear: (y: number) => void;
  empId: string; setEmpId: (id: string) => void;
  employees: { id: string; first_name: string | null; last_name: string | null; email: string | null }[];
  nameById: Map<string, string>;
  mayViewOthers: boolean; mayEdit: boolean; mayExport: boolean;
  projects: ProjectOption[];
  projectLabel: (id: string | null) => string;
}) {
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [account, setAccount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ entry: TimeEntry | null; backdate: boolean } | null>(null);
  const [savingApprove, setSavingApprove] = useState(false);

  const { from, to } = monthRange(year, month);

  const reload = useCallback(async () => {
    if (!empId) { setSummary(null); return; }
    setLoading(true); setErr(null);
    try {
      const [entries, ctx, holidays, bal] = await Promise.all([
        loadTimeEntries({ employeeId: empId, from, to }),
        loadEmployeeSollContext(year, empId),
        loadCompanyHolidays(year, year),
        loadTimeAccount(empId),
      ]);
      const holidaySet = new Set(holidays.map((h) => h.datum));
      setSummary(summarize(entries, from, to, ctx, holidaySet));
      setAccount(bal);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Daten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [empId, from, to, year]);

  useEffect(() => { reload(); }, [reload]);

  async function toggleApprove(day: DaySummary, next: boolean) {
    if (!mayEdit || day.entries.length === 0) return;
    setSavingApprove(true);
    const res = await setApproved(day.entries.map((e) => e.id), next);
    setSavingApprove(false);
    if (res.error) { toastError(res.error); return; }
    toast(next ? "Tag freigegeben." : "Freigabe zurückgenommen.");
    reload();
  }

  async function approveMonth() {
    if (!summary) return;
    const ids = summary.days.flatMap((d) => d.entries.filter((e) => !e.approved).map((e) => e.id));
    if (!ids.length) { toast("Alle Einträge sind bereits freigegeben."); return; }
    setSavingApprove(true);
    const res = await setApproved(ids, true);
    setSavingApprove(false);
    if (res.error) { toastError(res.error); return; }
    toast(`${ids.length} Einträge freigegeben.`);
    reload();
  }

  function exportCsv() {
    if (!summary) return;
    const rows: string[][] = [];
    for (const d of summary.days) {
      if (d.entries.length === 0) {
        rows.push([dateAt(d.date), "", d.specialKind ? entryKindLabel(d.specialKind) : d.neutral ? "Feiertag" : "Nicht erfasst", "", "", ""]);
        continue;
      }
      for (const e of d.entries) {
        const special = isSpecialKind(e.entry_kind);
        rows.push([
          dateAt(e.work_date),
          special ? "ganztägig" : timeRange(e),
          special ? entryKindLabel(e.entry_kind) : (e.project_id ? projectLabel(e.project_id) : locationLabel(e.location_type)),
          cleanText(e.description),
          special ? "" : fmtHours(e.hours),
          e.approved ? "ja" : "nein",
        ]);
      }
    }
    const who = (nameById.get(empId) ?? "mitarbeiter").replace(/\s+/g, "_");
    downloadCsv(["Datum", "Von-Bis", "Ort/Projekt/Art", "Tätigkeit", "Stunden", "Freigegeben"], rows, `stunden_${who}_${year}-${pad2(month + 1)}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="label">Mitarbeiter</label>
          <select
            className="input w-auto min-w-[200px]"
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            disabled={!mayViewOthers}
          >
            {!mayViewOthers && <option value={empId}>{nameById.get(empId) ?? "Ich"}</option>}
            {mayViewOthers && employees.map((e) => <option key={e.id} value={e.id}>{employeeDisplayName(e)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Monat</label>
          <select className="input w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Jahr</label>
          <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {mayEdit && (
            <button className="btn-outline" onClick={() => setDialog({ entry: null, backdate: true })} disabled={!empId}>
              <Plus size={16} /> Nachtrag
            </button>
          )}
          {mayEdit && (
            <button className="btn-outline" onClick={approveMonth} disabled={savingApprove || !summary}>
              Monat freigeben
            </button>
          )}
          {mayExport && (
            <button className="btn-outline" onClick={exportCsv} disabled={!summary}>
              <Download size={16} /> CSV
            </button>
          )}
        </div>
      </div>

      <ErrorBanner message={err} />

      {loading || (!summary && empId) ? (
        <Spinner />
      ) : !empId ? (
        <Empty title="Kein Mitarbeiter gewählt" hint="Bitte oben einen Mitarbeiter auswählen." />
      ) : !summary || summary.days.length === 0 ? (
        <Empty title="Keine Einträge" hint="Für diesen Zeitraum wurden keine Zeiten erfasst." />
      ) : (
        <>
          <TimeStatCards summary={summary} accountBalance={account} />
          <MonthEntriesTable
            summary={summary}
            projectLabel={projectLabel}
            onEdit={mayEdit ? (e) => setDialog({ entry: e, backdate: false }) : undefined}
            isEditable={mayEdit ? () => true : undefined}
            approvable={mayEdit}
            onToggleApprove={toggleApprove}
          />
        </>
      )}

      {empId && (
        <TimeEntryDialog
          open={!!dialog}
          onClose={() => setDialog(null)}
          employeeId={empId}
          entry={dialog?.entry ?? null}
          defaultDate={to}
          projects={projects}
          onSaved={async (id) => {
            const backdate = dialog?.backdate;
            setDialog(null);
            if (backdate && id) await markBackdated(id).catch(() => { /* Markierung best effort */ });
            reload();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Tab: Projekte (alle Mitarbeiter, ein Projekt + Zeitraum)
// ============================================================
function ProjectTab({
  projects, nameById, projectLabel, mayExport,
}: {
  projects: ProjectOption[];
  nameById: Map<string, string>;
  projectLabel: (id: string | null) => string;
  mayExport: boolean;
}) {
  const now = new Date();
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState(() => isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(() => isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const rows = await loadTimeEntries({ projectId: projectId || null, from, to });
      // Projektauswertung = geleistete Arbeit; Abwesenheiten (Sonderarten) ausblenden.
      setEntries(rows.filter((e) => !isSpecialKind(e.entry_kind)));
      setLoaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Daten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to]);

  const total = useMemo(() => entries.reduce((a, e) => a + (e.hours || 0), 0), [entries]);
  const byEmp = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      const k = e.employee_id ?? "?";
      m.set(k, (m.get(k) ?? 0) + (e.hours || 0));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.start_time ?? "").localeCompare(b.start_time ?? "")),
    [entries],
  );

  function exportCsv() {
    downloadCsv(
      ["Datum", "Mitarbeiter", "Von-Bis", "Projekt", "Tätigkeit", "Stunden"],
      sortedEntries.map((e) => [
        dateAt(e.work_date),
        e.employee_id ? (nameById.get(e.employee_id) ?? "–") : "–",
        timeRange(e),
        e.project_id ? projectLabel(e.project_id) : locationLabel(e.location_type),
        cleanText(e.description),
        fmtHours(e.hours),
      ]),
      `projektstunden_${from}_${to}.csv`,
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-[220px] flex-1">
          <label className="label">Projekt</label>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Alle Projekte</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Von</label>
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={reload} disabled={loading}>Auswerten</button>
        {mayExport && (
          <button className="btn-outline" onClick={exportCsv} disabled={!entries.length}>
            <Download size={16} /> CSV
          </button>
        )}
      </div>

      <ErrorBanner message={err} />

      {loading ? (
        <Spinner />
      ) : !loaded ? (
        <Empty title="Projektauswertung" hint="Projekt und Zeitraum wählen, dann „Auswerten“." />
      ) : entries.length === 0 ? (
        <Empty title="Keine Arbeitszeiten" hint="Für diese Auswahl wurden keine Einträge gefunden." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Einträge" value={entries.length} />
            <Stat label="Summe Stunden" value={`${fmtHours(total)} h`} />
            <Stat label="Mitarbeiter" value={byEmp.length} />
          </div>

          <div className="glass p-4">
            <h3 className="mb-2 font-bold">Stunden je Mitarbeiter</h3>
            <div className="space-y-1.5">
              {byEmp.map(([id, h]) => (
                <div key={id} className="flex items-center justify-between text-sm">
                  <span>{nameById.get(id) ?? "Unbekannt"}</span>
                  <span className="font-semibold tabular-nums">{fmtHours(h)} h</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Datum", "Mitarbeiter", "Von–Bis", "Projekt", "Tätigkeit", "Stunden"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${i === 5 ? "text-right" : "text-left"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {sortedEntries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-3 py-2">{dateAt(e.work_date)}</td>
                    <td className="px-3 py-2">{e.employee_id ? (nameById.get(e.employee_id) ?? "–") : "–"}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{timeRange(e)}</td>
                    <td className="px-3 py-2"><div className="max-w-[220px] truncate">{e.project_id ? projectLabel(e.project_id) : locationLabel(e.location_type)}</div></td>
                    <td className="px-3 py-2"><div className="max-w-[260px] truncate">{e.description || "–"}</div></td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtHours(e.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
