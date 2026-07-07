// ============================================================
// B4Y SuperAPP – Termin-Kalender (Monat/Woche)
// Reines CSS-Grid, keine externe Kalender-Bibliothek.
// Erwartet bereits materialisierte Termine; navigiert clientseitig.
// ============================================================
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { Appointment } from "../../lib/appointments";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const pad = (n: number): string => String(n).padStart(2, "0");
const fmtTime = (iso: string): string => `${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}`;
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { const x = new Date(d); const off = (x.getDay() + 6) % 7; x.setDate(x.getDate() - off); x.setHours(0, 0, 0, 0); return x; }
function sameDay(iso: string, d: Date): boolean {
  const x = new Date(iso);
  return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
}

export default function AppointmentCalendar({ appointments, onSelect, onNewAt }: {
  appointments: Appointment[];
  onSelect?: (a: Appointment) => void;
  onNewAt?: (d: Date) => void;
}) {
  const [mode, setMode] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState<Date>(new Date());

  const step = (dir: number) => setAnchor(addDays(anchor, dir * (mode === "week" ? 7 : 30)));
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = mode === "week" ? startOfWeek(anchor) : startOfWeek(monthStart);
  const dayCount = mode === "week" ? 7 : 42;
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(gridStart, i)), [gridStart, dayCount]);
  const todayStr = new Date().toDateString();

  const title = mode === "week"
    ? `${pad(gridStart.getDate())}.${pad(gridStart.getMonth() + 1)}. – ${pad(addDays(gridStart, 6).getDate())}.${pad(addDays(gridStart, 6).getMonth() + 1)}.`
    : anchor.toLocaleDateString("de-AT", { month: "long", year: "numeric" });

  const dayAppts = (d: Date): Appointment[] =>
    appointments.filter((a) => sameDay(a.start_datetime, d)).sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));

  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
          <button className="btn-outline px-3 py-1 text-sm" onClick={() => setAnchor(new Date())}>Heute</button>
          <button className="btn-ghost px-2" onClick={() => step(1)}><ChevronRight size={18} /></button>
          <span className="ml-2 font-semibold capitalize">{title}</span>
        </div>
        <div className="seg">
          <button className="seg-btn" data-active={mode === "week"} onClick={() => setMode("week")}>Woche</button>
          <button className="seg-btn" data-active={mode === "month"} onClick={() => setMode("month")}>Monat</button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b text-center text-xs font-semibold text-slate-500" style={{ borderColor: "var(--border)" }}>
        {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
      </div>

      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = mode === "week" || d.getMonth() === anchor.getMonth();
          const isToday = d.toDateString() === todayStr;
          const items = dayAppts(d);
          return (
            <div key={i} className={`border-b border-r p-1 ${mode === "week" ? "min-h-[160px]" : "min-h-[104px]"} ${inMonth ? "" : "opacity-40"}`}
              style={{ borderColor: "var(--border)" }}
              onClick={() => onNewAt?.(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9))}>
              <div className={`mb-1 text-right text-xs ${isToday ? "font-bold text-[var(--accent)]" : "text-slate-400"}`}>{d.getDate()}</div>
              <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                {items.slice(0, mode === "week" ? 8 : 3).map((a) => (
                  <button key={a.id} onClick={() => onSelect?.(a)}
                    className="flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
                    style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}
                    title={`${a.title} · ${fmtTime(a.start_datetime)}`}>
                    {(a.is_recurring || a.recurrence_parent_id) && <Repeat size={10} className="shrink-0 opacity-90" />}
                    {!a.all_day && <span className="opacity-80">{fmtTime(a.start_datetime)}</span>}
                    <span className="truncate">{a.title || "(ohne Titel)"}</span>
                  </button>
                ))}
                {items.length > (mode === "week" ? 8 : 3) && (
                  <div className="px-1 text-[11px] text-slate-400">+{items.length - (mode === "week" ? 8 : 3)} mehr</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
