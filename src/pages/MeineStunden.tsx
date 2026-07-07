// ============================================================
// Installateursoftware – "Meine Stunden" (/meine-stunden)
// Mitarbeiter-Eigensicht der Zeiterfassung: Monatsnavigation, Ist/Soll/
// Saldo + Zeitkonto, Monatstabelle je Tag, eigenes Erfassen/Bearbeiten
// (nur nicht freigegebene Einträge) und Urlaubsantrag.
//
// Sämtliche Berechnung kommt aus dem zentralen Datenlayer
// (src/lib/time-entries.ts → summarize/loadEmployeeSollContext); hier wird
// NICHT selbst nachgerechnet. Die exportierten Bausteine (TimeStatCards,
// MonthEntriesTable, monthRange …) werden auch von der Admin-Auswertung
// (Stundenauswertung.tsx) wiederverwendet – eine zentrale Darstellung.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Palmtree, Lock } from "lucide-react";
import { PageHeader, Stat, Badge, Empty, Spinner, Modal } from "../components/ui";
import { ErrorBanner } from "../components/calc-ui";
import { dateAt } from "../lib/format";
import { toast } from "../lib/toast";
import { useMyEmployee } from "../lib/my-employee";
import { loadProjectOptions, ProjectOption } from "../lib/documents-overview";
import {
  TimeEntry, DaySummary, MonthSummary, LOCATION_TYPES,
  loadTimeEntries, summarize, loadEmployeeSollContext, loadCompanyHolidays,
  loadTimeAccount, saveLeaveRequest,
  fmtHours, fmtSaldo, entryKindLabel, isSpecialKind,
} from "../lib/time-entries";
import TimeEntryDialog from "../components/time/TimeEntryDialog";

// ── kleine, lokal-zeitzonensichere Datums-Helfer ──
const pad2 = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthLabel = (d: Date) => d.toLocaleDateString("de-AT", { month: "long", year: "numeric" });
const weekdayShort = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("de-AT", { weekday: "short" });
export const locationLabel = (v: string) => LOCATION_TYPES.find((l) => l.value === v)?.label ?? v;

/**
 * Auswertungszeitraum eines Monats. Der laufende (und ein zukünftiger) Monat
 * werden auf HEUTE begrenzt, damit noch nicht gearbeitete Tage das Monatssaldo
 * nicht künstlich negativ machen; abgeschlossene Monate werden voll gerechnet.
 */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = last < today ? last : today;
  return { from: isoDate(first), to: isoDate(end) };
}

const saldoClass = (v: number) =>
  v > 0 ? "text-emerald-600 dark:text-emerald-400" : v < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400";

// ============================================================
// Wiederverwendbare Kopf-Kacheln (Ist / Soll / Saldo / Zeitkonto)
// ============================================================
export function TimeStatCards({ summary, accountBalance }: { summary: MonthSummary; accountBalance: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Ist-Stunden" value={`${fmtHours(summary.istTotal)} h`} hint="im Zeitraum erfasst" />
      <Stat label="Soll-Stunden" value={`${fmtHours(summary.sollTotal)} h`} hint="laut Arbeitszeitmodell" />
      <Stat
        label="Saldo"
        value={<span className={saldoClass(summary.autoSaldo)}>{fmtSaldo(summary.autoSaldo)} h</span>}
        hint="Ist − Soll"
      />
      <Stat
        label="Zeitkonto (ZA)"
        value={<span className={saldoClass(accountBalance)}>{fmtSaldo(accountBalance)} h</span>}
        hint="Gesamtstand"
      />
    </div>
  );
}

const TH = "px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

// ============================================================
// Wiederverwendbare Monatstabelle (je Tag gruppiert)
// Optional: Freigabe-Checkbox je Tag (Admin/Büro) und Bearbeiten je Eintrag.
// ============================================================
export function MonthEntriesTable({
  summary, projectLabel, onEdit, isEditable, approvable, onToggleApprove,
}: {
  summary: MonthSummary;
  projectLabel: (id: string | null) => string;
  onEdit?: (e: TimeEntry) => void;
  isEditable?: (e: TimeEntry) => boolean;
  approvable?: boolean;
  onToggleApprove?: (day: DaySummary, next: boolean) => void;
}) {
  return (
    <div className="glass overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {approvable && <th className={`${TH} text-center`}>Frei</th>}
            <th className={`${TH} text-left`}>Datum</th>
            <th className={`${TH} text-left`}>Von–Bis</th>
            <th className={`${TH} text-left`}>Ort / Projekt</th>
            <th className={`${TH} text-left`}>Tätigkeit</th>
            <th className={`${TH} text-right`}>Stunden</th>
            <th className={`${TH} text-right`}>Tagessaldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {summary.days.map((day) => {
            const rowCount = Math.max(1, day.entries.length);
            const allApproved = day.entries.length > 0 && day.entries.every((e) => e.approved);

            const approveCell = approvable ? (
              <td className="px-3 py-2 text-center align-top" rowSpan={rowCount}>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--accent)]"
                  disabled={day.entries.length === 0}
                  checked={allApproved}
                  onChange={(e) => onToggleApprove?.(day, e.target.checked)}
                  title="Tag freigeben / Freigabe zurücknehmen"
                />
              </td>
            ) : null;

            const dateCell = (
              <td className="px-3 py-2 align-top" rowSpan={rowCount}>
                <div className="whitespace-nowrap font-semibold">{dateAt(day.date)}</div>
                <div className="text-[11px] capitalize text-slate-400">{weekdayShort(day.date)}</div>
              </td>
            );

            const saldoCell = (
              <td className="px-3 py-2 text-right align-top tabular-nums" rowSpan={rowCount}>
                {day.neutral
                  ? <span className="text-slate-400">–</span>
                  : <span className={`font-semibold ${saldoClass(day.saldo)}`}>{fmtSaldo(day.saldo)}</span>}
              </td>
            );

            // Leerer Tag: Feiertag/Sonderart ODER offener Arbeitstag (Soll ohne Ist).
            if (day.entries.length === 0) {
              const label = day.specialKind ? entryKindLabel(day.specialKind) : day.neutral ? "Feiertag" : "Nicht erfasst";
              return (
                <tr key={day.date}>
                  {approveCell}
                  {dateCell}
                  <td className="px-3 py-2" colSpan={3}>
                    <Badge tone={day.neutral ? "slate" : "amber"}>{label}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">–</td>
                  {saldoCell}
                </tr>
              );
            }

            return day.entries.map((e, i) => {
              const special = isSpecialKind(e.entry_kind);
              const editable = onEdit && (isEditable ? isEditable(e) : false);
              return (
                <tr
                  key={e.id}
                  className={editable ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" : ""}
                  onClick={editable ? () => onEdit!(e) : undefined}
                >
                  {i === 0 && approveCell}
                  {i === 0 && dateCell}
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {special
                      ? <span className="text-slate-400">ganztägig</span>
                      : `${(e.start_time ?? "").slice(0, 5)}–${(e.end_time ?? "").slice(0, 5)}`}
                    {!special && e.pause_minutes > 0 && (
                      <span className="ml-1 text-[11px] text-slate-400">(−{e.pause_minutes} min)</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {special
                      ? <Badge tone="amber">{entryKindLabel(e.entry_kind)}</Badge>
                      : <div className="max-w-[200px] truncate">{e.project_id ? projectLabel(e.project_id) : locationLabel(e.location_type)}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="max-w-[240px] truncate">{e.description || <span className="text-slate-400">–</span>}</span>
                      {e.approved && <Lock size={12} className="shrink-0 text-slate-400" aria-label="freigegeben" />}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{special ? "–" : fmtHours(e.hours)}</td>
                  {i === 0 && saldoCell}
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Route: Meine Stunden
// ============================================================
export default function MeineStunden() {
  const { employee, loading: empLoading } = useMyEmployee();

  const [anchor, setAnchor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [account, setAccount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ entry: TimeEntry | null } | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => { loadProjectOptions().then(setProjects).catch(() => { /* Projektliste optional */ }); }, []);

  const projectLabel = useCallback(
    (id: string | null) => projects.find((p) => p.id === id)?.label ?? "Projekt",
    [projects],
  );

  const reload = useCallback(async () => {
    if (!employee) return;
    setLoading(true); setErr(null);
    try {
      const year = anchor.getFullYear();
      const { from, to } = monthRange(year, anchor.getMonth());
      const [entries, ctx, holidays, bal] = await Promise.all([
        loadTimeEntries({ employeeId: employee.id, from, to }),
        loadEmployeeSollContext(year, employee.id),
        loadCompanyHolidays(year, year),
        loadTimeAccount(employee.id),
      ]);
      const holidaySet = new Set(holidays.map((h) => h.datum));
      setSummary(summarize(entries, from, to, ctx, holidaySet));
      setAccount(bal);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Daten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [employee, anchor]);

  useEffect(() => { reload(); }, [reload]);

  const isEditable = useCallback((e: TimeEntry) => !e.approved, []);
  const stepMonth = (dir: number) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));

  // Standard-Datum für neue Einträge: heute (im aktuellen Monat) bzw. Monatserster.
  const defaultNewDate = useMemo(() => {
    const now = new Date();
    return now.getFullYear() === anchor.getFullYear() && now.getMonth() === anchor.getMonth()
      ? isoDate(now)
      : isoDate(anchor);
  }, [anchor]);

  if (empLoading) return <Spinner />;
  if (!employee) {
    return (
      <>
        <PageHeader title="Meine Stunden" subtitle="Eigene Zeiterfassung" />
        <Empty
          title="Kein Mitarbeiterprofil"
          hint="Dein Login ist noch keinem Mitarbeiter zugeordnet. Bitte an die Administration wenden."
        />
      </>
    );
  }

  const fullName = `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim();

  return (
    <>
      <PageHeader
        title="Meine Stunden"
        subtitle={fullName || "Eigene Zeiterfassung"}
        action={<button className="btn-primary" onClick={() => setDialog({ entry: null })}><Plus size={18} /> Zeit erfassen</button>}
      />

      <ErrorBanner message={err} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2" onClick={() => stepMonth(-1)} title="Vorheriger Monat"><ChevronLeft size={18} /></button>
          <span className="min-w-[150px] text-center font-semibold capitalize">{monthLabel(anchor)}</span>
          <button className="btn-ghost px-2" onClick={() => stepMonth(1)} title="Nächster Monat"><ChevronRight size={18} /></button>
          <button
            className="btn-outline ml-2 px-3 py-1.5 text-sm"
            onClick={() => { const d = new Date(); setAnchor(new Date(d.getFullYear(), d.getMonth(), 1)); }}
          >
            Heute
          </button>
        </div>
        <button className="btn-outline" onClick={() => setLeaveOpen(true)}><Palmtree size={16} /> Urlaub beantragen</button>
      </div>

      {loading || !summary ? (
        <Spinner />
      ) : summary.days.length === 0 ? (
        <Empty title="Keine Einträge in diesem Monat" hint="Erfasse deine erste Arbeitszeit über „Zeit erfassen“." />
      ) : (
        <div className="space-y-4">
          <TimeStatCards summary={summary} accountBalance={account} />
          <MonthEntriesTable
            summary={summary}
            projectLabel={projectLabel}
            onEdit={(e) => setDialog({ entry: e })}
            isEditable={isEditable}
          />
          <p className="text-xs text-slate-400">
            Freigegebene Einträge (<Lock size={11} className="inline" />) sind gesperrt und können nicht mehr bearbeitet werden.
          </p>
        </div>
      )}

      <TimeEntryDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        employeeId={employee.id}
        entry={dialog?.entry ?? null}
        defaultDate={defaultNewDate}
        projects={projects}
        onSaved={() => { setDialog(null); reload(); }}
      />

      <LeaveRequestDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        employeeId={employee.id}
        onSaved={() => { setLeaveOpen(false); toast("Urlaubsantrag eingereicht."); }}
      />
    </>
  );
}

// ============================================================
// Urlaubsantrag (leichtgewichtig; Werktage Mo–Fr als Tagesanzahl)
// ============================================================
function LeaveRequestDialog({
  open, onClose, employeeId, onSaved,
}: {
  open: boolean; onClose: () => void; employeeId: string; onSaved: () => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [type, setType] = useState("urlaub");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = new Date().toISOString().slice(0, 10);
    setStart(t); setEnd(t); setType("urlaub"); setNote(""); setErr(null);
  }, [open]);

  const days = useMemo(() => {
    if (!start || !end) return 0;
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    if (e < s) return 0;
    let n = 0;
    for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) n++; // nur Werktage Mo–Fr
    }
    return n;
  }, [start, end]);

  async function submit() {
    if (!start || !end) { setErr("Bitte den Zeitraum wählen."); return; }
    if (new Date(end) < new Date(start)) { setErr("Das Enddatum darf nicht vor dem Startdatum liegen."); return; }
    setBusy(true); setErr(null);
    const res = await saveLeaveRequest({
      employee_id: employeeId,
      start_date: start,
      end_date: end,
      days,
      type,
      status: "beantragt",
      notizen: note.trim() || null,
    });
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Urlaub beantragen">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label label-req">Von</label>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label label-req">Bis</label>
          <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div>
          <label className="label">Art</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="urlaub">Urlaub</option>
            <option value="zeitausgleich">Zeitausgleich</option>
            <option value="sonderurlaub">Sonderurlaub</option>
            <option value="unbezahlt">Unbezahlt</option>
          </select>
        </div>
        <div className="flex items-end pb-2 text-sm text-slate-500 dark:text-slate-400">
          Werktage: <b className="ml-1 tabular-nums text-[var(--text)]">{days}</b>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Notiz</label>
          <textarea className="input min-h-[64px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optionaler Hinweis" />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !start || !end}>{busy ? "Senden …" : "Antrag senden"}</button>
      </div>
    </Modal>
  );
}
