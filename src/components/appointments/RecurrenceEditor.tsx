// ============================================================
// B4Y SuperAPP – Wiederholungs-Editor für Terminserien
// Frequenz (täglich/wöchentlich/monatlich/quartalsweise/jährlich) ·
// Intervall · Wochentage · Monats-/Jahresregeln (am X. / n-ter Wochentag /
// letzter Werktag) · Ende (nie / nach N mal / bis Datum) · Live-Vorschau.
// Erzeugt/liest RRULE-Strings über src/lib/rruleUtils.
// ============================================================
import type { ReactNode } from "react";
import { Repeat } from "lucide-react";
import {
  Weekday, RRuleOptions,
  buildRRule, parseRRule, humanReadableRRule, getOccurrences,
  isWorkdaySet, WD_ORDER, WD_FULL_DE, MONTHS_DE,
} from "../../lib/rruleUtils";

/** UI-Frequenz: Quartalsweise = monatlich mit Intervall 3 (RRULE-seitig MONTHLY). */
export type UiFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
/** Monats-/Jahresmodus: am Tag X · am n-ten Wochentag · am letzten Werktag. */
export type MonthMode = "day" | "weekday" | "lastworkday";

export interface RecurrenceValue {
  enabled: boolean;
  freq: UiFreq;
  interval: number;
  byDay: Weekday[];          // wöchentlich
  monthMode: MonthMode;      // monatlich / quartalsweise / jährlich
  monthDay: number;          // 1..31 oder -1 (letzter Tag)
  setPos: number;            // 1..4 oder -1 (letzter)
  weekday: Weekday;          // für n-ten Wochentag
  yearMonth: number;         // 1..12 (jährlich)
  endMode: "never" | "count" | "until";
  count: number;
  until: string;             // yyyy-mm-dd
}

const WD_LABELS: Record<Weekday, string> = { MO: "Mo", TU: "Di", WE: "Mi", TH: "Do", FR: "Fr", SA: "Sa", SU: "So" };
const FREQS: { key: UiFreq; label: string }[] = [
  { key: "DAILY", label: "Täglich" },
  { key: "WEEKLY", label: "Wöchentlich" },
  { key: "MONTHLY", label: "Monatlich" },
  { key: "QUARTERLY", label: "Quartalsweise" },
  { key: "YEARLY", label: "Jährlich" },
];
const SETPOS: { v: number; label: string }[] = [
  { v: 1, label: "Ersten" }, { v: 2, label: "Zweiten" }, { v: 3, label: "Dritten" },
  { v: 4, label: "Vierten" }, { v: -1, label: "Letzten" },
];

/** Wievieltes Vorkommen seines Wochentags der Tag im Monat ist (1..5). */
function weekOfMonthPos(d: Date): number { return Math.min(4, Math.ceil(d.getDate() / 7)); }

export function defaultRecurrence(start?: Date): RecurrenceValue {
  const d = start ?? new Date();
  const wd = WD_ORDER[(d.getDay() + 6) % 7];
  return {
    enabled: false, freq: "WEEKLY", interval: 1, byDay: [wd],
    monthMode: "day", monthDay: d.getDate(), setPos: weekOfMonthPos(d), weekday: wd,
    yearMonth: d.getMonth() + 1,
    endMode: "count", count: 10, until: "",
  };
}

/** Monats-/Jahres-Teile der RRULE aus dem Editorwert. */
function monthlyParts(v: RecurrenceValue): Partial<RRuleOptions> {
  if (v.monthMode === "weekday") return { byDay: [v.weekday], bySetPos: v.setPos };
  if (v.monthMode === "lastworkday") return { byDay: ["MO", "TU", "WE", "TH", "FR"], bySetPos: -1 };
  return { byMonthDay: [v.monthDay] }; // "day"
}

/** Editor-Wert → RRULE-String (oder null, wenn keine Serie). */
export function recurrenceToRRule(v: RecurrenceValue): string | null {
  if (!v.enabled) return null;
  const count = v.endMode === "count" ? Math.max(1, v.count) : null;
  const until = v.endMode === "until" && v.until ? new Date(`${v.until}T23:59:59`) : null;
  const interval = Math.max(1, v.interval);

  let opt: RRuleOptions;
  switch (v.freq) {
    case "DAILY": opt = { freq: "DAILY", interval }; break;
    case "WEEKLY": opt = { freq: "WEEKLY", interval, byDay: v.byDay.length ? v.byDay : undefined }; break;
    case "MONTHLY": opt = { freq: "MONTHLY", interval, ...monthlyParts(v) }; break;
    case "QUARTERLY": opt = { freq: "MONTHLY", interval: 3, ...monthlyParts(v) }; break;
    case "YEARLY": opt = { freq: "YEARLY", interval, byMonth: [v.yearMonth], ...monthlyParts(v) }; break;
  }
  return buildRRule({ ...opt, count, until });
}

/** RRULE-String (+ is_recurring) → Editor-Wert. */
export function rruleToRecurrence(rrule: string | null, isRecurring: boolean, start?: Date): RecurrenceValue {
  const base = defaultRecurrence(start);
  if (!isRecurring || !rrule) return base;
  const o = parseRRule(rrule);

  let freq: UiFreq = o.freq;
  if (o.freq === "MONTHLY" && o.interval === 3) freq = "QUARTERLY";

  // Monatsmodus rekonstruieren
  let monthMode: MonthMode = base.monthMode;
  let monthDay = base.monthDay, setPos = base.setPos, weekday = base.weekday;
  if (o.byMonthDay && o.byMonthDay.length) { monthMode = "day"; monthDay = o.byMonthDay[0]; }
  else if (o.bySetPos != null && o.byDay && o.byDay.length) {
    if (o.bySetPos === -1 && isWorkdaySet(o.byDay)) monthMode = "lastworkday";
    else { monthMode = "weekday"; setPos = o.bySetPos; weekday = o.byDay[0]; }
  }

  return {
    enabled: true,
    freq,
    interval: freq === "QUARTERLY" ? 1 : (o.interval ?? 1),
    byDay: o.freq === "WEEKLY" && o.byDay && o.byDay.length ? o.byDay : base.byDay,
    monthMode, monthDay, setPos, weekday,
    yearMonth: o.byMonth && o.byMonth.length ? o.byMonth[0] : base.yearMonth,
    endMode: o.count != null ? "count" : o.until ? "until" : "never",
    count: o.count ?? 10,
    until: o.until ? o.until.toISOString().slice(0, 10) : "",
  };
}

export default function RecurrenceEditor(
  { value, onChange, start }: { value: RecurrenceValue; onChange: (v: RecurrenceValue) => void; start?: Date | null },
) {
  const set = (patch: Partial<RecurrenceValue>) => onChange({ ...value, ...patch });
  const toggleDay = (d: Weekday) =>
    set({ byDay: value.byDay.includes(d) ? value.byDay.filter((x) => x !== d) : [...value.byDay, d] });

  const unit = value.freq === "DAILY" ? "Tag(e)" : value.freq === "WEEKLY" ? "Woche(n)" : value.freq === "YEARLY" ? "Jahr(e)" : "Monat(e)";
  const showInterval = value.freq !== "QUARTERLY";
  const showWeekdays = value.freq === "WEEKLY";
  const showMonthRules = value.freq === "MONTHLY" || value.freq === "QUARTERLY";
  const showYearRules = value.freq === "YEARLY";

  const rrule = value.enabled ? recurrenceToRRule(value) : null;
  const preview = rrule ? humanReadableRRule(rrule) : "";
  // Live-Vorschau der nächsten konkreten Termine
  const nextDates = (rrule && start)
    ? getOccurrences(rrule, start, 4).slice(0, 4).map((d) =>
        new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d))
    : [];

  const monthDaySelect = (
    <select className="input w-auto" value={value.monthDay} onChange={(e) => set({ monthDay: parseInt(e.target.value, 10) })}>
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}.</option>)}
      <option value={-1}>Letzter Tag</option>
    </select>
  );
  const setPosSelect = (
    <select className="input w-auto" value={value.setPos} onChange={(e) => set({ setPos: parseInt(e.target.value, 10) })}>
      {SETPOS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
    </select>
  );
  const weekdaySelect = (
    <select className="input w-auto" value={value.weekday} onChange={(e) => set({ weekday: e.target.value as Weekday })}>
      {WD_ORDER.map((d) => <option key={d} value={d}>{WD_FULL_DE[d]}</option>)}
    </select>
  );
  const monthSelect = (
    <select className="input w-auto" value={value.yearMonth} onChange={(e) => set({ yearMonth: parseInt(e.target.value, 10) })}>
      {MONTHS_DE.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
    </select>
  );

  const modeRadio = (mode: MonthMode, label: ReactNode) => (
    <label className="flex flex-wrap items-center gap-2">
      <input type="radio" name="rec-mmode" checked={value.monthMode === mode} onChange={() => set({ monthMode: mode })} />
      {label}
    </label>
  );

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <Repeat size={15} /> Termin wiederholen (Serie)
      </label>

      {value.enabled && (
        <div className="mt-3 space-y-3">
          {/* Frequenz + Intervall */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select className="input w-auto min-w-[150px]" value={value.freq} onChange={(e) => set({ freq: e.target.value as UiFreq })}>
              {FREQS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {showInterval && (
              <>
                <span className="text-slate-500">– alle</span>
                <input type="number" min={1} className="input w-20" value={value.interval}
                  onChange={(e) => set({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                <span className="text-slate-500">{unit}</span>
              </>
            )}
          </div>

          {/* Wochentage (nur wöchentlich) */}
          {showWeekdays && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Wochentage</div>
              <div className="flex flex-wrap gap-1.5">
                {WD_ORDER.map((d) => (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`h-9 w-10 rounded-lg text-xs font-semibold transition ${
                      value.byDay.includes(d) ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
                    style={value.byDay.includes(d) ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : { border: "1px solid var(--border)" }}>
                    {WD_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Monats-/Quartalsregeln */}
          {showMonthRules && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Wiederholt sich</div>
              <div className="space-y-2 text-sm">
                {modeRadio("day", <><span className="text-slate-500">am</span> {monthDaySelect} <span className="text-slate-500">des Monats</span></>)}
                {modeRadio("weekday", <><span className="text-slate-500">am</span> {setPosSelect} {weekdaySelect}</>)}
                {modeRadio("lastworkday", <span>am letzten Werktag</span>)}
              </div>
            </div>
          )}

          {/* Jahresregeln */}
          {showYearRules && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Wiederholt sich</div>
              <div className="space-y-2 text-sm">
                {modeRadio("day", <><span className="text-slate-500">am</span> {monthDaySelect} <span className="text-slate-500">im</span> {monthSelect}</>)}
                {modeRadio("weekday", <><span className="text-slate-500">am</span> {setPosSelect} {weekdaySelect} <span className="text-slate-500">im</span> {monthSelect}</>)}
              </div>
            </div>
          )}

          {/* Ende-Bedingung */}
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500">Endet</div>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="rec-end" checked={value.endMode === "never"} onChange={() => set({ endMode: "never" })} />
                Nie
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="rec-end" checked={value.endMode === "count"} onChange={() => set({ endMode: "count" })} />
                Nach
                <input type="number" min={1} className="input w-20" disabled={value.endMode !== "count"} value={value.count}
                  onChange={(e) => set({ count: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                Terminen
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="rec-end" checked={value.endMode === "until"} onChange={() => set({ endMode: "until" })} />
                Bis
                <input type="date" className="input w-auto" disabled={value.endMode !== "until"} value={value.until}
                  onChange={(e) => set({ until: e.target.value })} />
              </label>
            </div>
          </div>

          {preview && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <div className="font-semibold">{preview}</div>
              {nextDates.length > 0 && (
                <div className="mt-1 opacity-90">Nächste Termine: {nextDates.join(", ")}{nextDates.length >= 4 ? " …" : ""}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
