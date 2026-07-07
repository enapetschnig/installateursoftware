// ============================================================
// B4Y SuperAPP – Arbeitszeitkalender (mandantenfähig, modellbasiert)
// Nicht BUAK-fix: BUAK ist nur EINES von mehreren Arbeitszeitmodellen.
// Einstellungen + Tagesregeln je Firma (organization_id) + Jahr.
// ============================================================
import { supabase } from "./supabase";
import { BuakWeekType, BuakWeek, isoWeekYear } from "./buak";
import { WeekHours, WEEKDAYS } from "./employee-types";

export type WorkTimeModel =
  | "buak_auto"
  | "short_long_manual"
  | "only_short"
  | "only_long"
  | "fixed_weekly"
  | "individual_week"
  | "manual_year";

export const WORK_TIME_MODELS: { key: WorkTimeModel; label: string; desc: string }[] = [
  { key: "buak_auto", label: "Automatisch aus BUAK-Kalender", desc: "Kurze/lange Wochen automatisch aus dem BUAK-Kalender laden." },
  { key: "short_long_manual", label: "Kurze / lange Woche manuell", desc: "Kurze und lange Wochen selbst je Kalenderwoche festlegen." },
  { key: "only_short", label: "Nur kurze Woche", desc: "Alle Wochen als kurze Woche – Sollstunden nach kurzer Woche." },
  { key: "only_long", label: "Nur lange Woche", desc: "Alle Wochen als lange Woche – Sollstunden nach langer Woche." },
  { key: "fixed_weekly", label: "Fixe Wochenarbeitszeit", desc: "Gleichbleibende Wochenstunden (z. B. 38,5 h)." },
  { key: "individual_week", label: "Individuelles Wochenmodell", desc: "Sollstunden je Wochentag (Mo–So) frei definieren." },
  { key: "manual_year", label: "Manuelle Jahresplanung", desc: "Jede Kalenderwoche einzeln: Art, Sollstunden, Notiz." },
];

export const workModelLabel = (k: string): string =>
  WORK_TIME_MODELS.find((m) => m.key === k)?.label ?? "Arbeitszeitmodell";

export const WEEKDAY_LABELS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export type WorkCalendarSettings = {
  id?: string;
  year: number;
  work_time_model: WorkTimeModel;
  short_week_hours: number | null;
  long_week_hours: number | null;
  fixed_weekly_hours: number | null;
  default_daily_hours: number | null;
  is_active: boolean;
};

export type WorkDayRule = {
  id?: string;
  year: number;
  weekday: number;        // 1=Mo … 7=So
  is_working_day: boolean;
  target_hours: number | null;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number | null;
  sort_order: number;
};

// Realistische österr. Baubetriebs-Standardwerte (greifen NUR, wenn für ein Jahr
// noch keine Firmeneinstellung gespeichert ist – bestehende Werte bleiben unberührt).
//   kurze Woche: Mo–Do ≈ 9 h → 36 h · lange Woche: Mo–Fr 8 h → 40 h
//   fixe Woche: 38,5 h (Kollektivvertrag) · Tag: 8 h
export const defaultSettings = (year: number): WorkCalendarSettings => ({
  year, work_time_model: "buak_auto",
  short_week_hours: 36, long_week_hours: 40, fixed_weekly_hours: 38.5, default_daily_hours: 8,
  is_active: true,
});

export const defaultDayRules = (year: number): WorkDayRule[] =>
  WEEKDAY_LABELS.map((_, i) => ({
    year, weekday: i + 1,
    is_working_day: i < 5,                 // Mo–Fr aktiv
    target_hours: i < 5 ? 8 : 0,
    start_time: null, end_time: null, break_minutes: null,
    sort_order: i,
  }));

const SETTINGS_COLS =
  "id,year,work_time_model,short_week_hours,long_week_hours,fixed_weekly_hours,default_daily_hours,is_active";
const DAY_COLS =
  "id,year,weekday,is_working_day,target_hours,start_time,end_time,break_minutes,sort_order";

export async function loadWorkSettings(year: number): Promise<WorkCalendarSettings | null> {
  const { data } = await supabase.from("company_work_calendar_settings").select(SETTINGS_COLS).eq("year", year).maybeSingle();
  return (data as WorkCalendarSettings) ?? null;
}

export async function saveWorkSettings(s: WorkCalendarSettings): Promise<{ error?: string }> {
  const { error } = await supabase.from("company_work_calendar_settings").upsert({
    year: s.year, work_time_model: s.work_time_model,
    short_week_hours: s.short_week_hours, long_week_hours: s.long_week_hours,
    fixed_weekly_hours: s.fixed_weekly_hours, default_daily_hours: s.default_daily_hours,
    is_active: s.is_active, updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,year" });
  return { error: error?.message };
}

export async function loadDayRules(year: number): Promise<WorkDayRule[]> {
  const { data } = await supabase.from("company_work_day_rules").select(DAY_COLS).eq("year", year).order("sort_order");
  return (data as WorkDayRule[]) ?? [];
}

export async function saveDayRules(year: number, rules: WorkDayRule[]): Promise<{ error?: string }> {
  const payload = rules.map((r) => ({
    year, weekday: r.weekday, is_working_day: r.is_working_day, target_hours: r.target_hours,
    start_time: r.start_time || null, end_time: r.end_time || null,
    break_minutes: r.break_minutes, sort_order: r.sort_order, updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("company_work_day_rules").upsert(payload, { onConflict: "organization_id,year,weekday" });
  return { error: error?.message };
}

/** Wochen-Sollstunden je Wochenart, abhängig vom Modell. */
export function targetForWeekType(s: WorkCalendarSettings, weekType: BuakWeekType): number {
  switch (weekType) {
    case "kurz": return Number(s.short_week_hours) || 0;
    case "lang": return Number(s.long_week_hours) || 0;
    case "frei": return 0;
    default: return Number(s.long_week_hours) || Number(s.fixed_weekly_hours) || 0; // neutral
  }
}

/** Summe der Wochenstunden aus den Tagesregeln (individuelles Modell). */
export function weeklyHoursFromDayRules(rules: WorkDayRule[]): number {
  return rules.reduce((sum, r) => sum + (r.is_working_day ? (Number(r.target_hours) || 0) : 0), 0);
}

// ============================================================
// Zentrale, modell-bewusste Soll-Stunden-Berechnung.
// Ersetzt die alte BUAK-fixe Logik (buak.ts → daySollHours) und ist die
// Quelle für künftige Zeiterfassung, Stundenausgleich & Auswertungen.
// ============================================================
export type EmployeeWeekModel = {
  worktime_model?: string | null;
  week_short?: WeekHours | null;
  week_long?: WeekHours | null;
};

export type SollContext = {
  settings: WorkCalendarSettings | null;  // Firmenmodell des Jahres
  weeks: BuakWeek[];                       // Kalenderwochen (mit week_type + target_hours)
  dayRules: WorkDayRule[];                 // Tagesregeln (individuelles Modell)
  employee?: EmployeeWeekModel | null;     // optionales Mitarbeiter-Tagesmodell
};

const activeWorkingDays = (rules: WorkDayRule[]): number => {
  const n = rules.filter((r) => r.is_working_day).length;
  return n || 5;
};

/** Wochen-Sollstunden für die ISO-Woche eines Datums (modellabhängig). */
export function resolveWeekTarget(date: Date, ctx: SollContext): number | null {
  const { year, week } = isoWeekYear(date);
  const wk = ctx.weeks.find((w) => w.year === year && w.week === week);
  if (wk && wk.target_hours != null) return Number(wk.target_hours);
  const model = ctx.settings?.work_time_model;
  if (model === "fixed_weekly") return Number(ctx.settings?.fixed_weekly_hours) || 0;
  if (model === "individual_week") return weeklyHoursFromDayRules(ctx.dayRules);
  if (wk && ctx.settings) return targetForWeekType(ctx.settings, wk.week_type);
  return null;
}

/**
 * Tages-Sollstunden für ein Datum – berücksichtigt das Firmen-Arbeitszeitmodell:
 *  • individual_week → feste Tagesregel
 *  • fixed_weekly   → Wochenstunden gleichmäßig auf Arbeitstage
 *  • wochenbasiert  → bevorzugt Mitarbeiter-Tagesmodell je Wochenart, sonst Wochen-Soll/Arbeitstage
 */
export function resolveDaySoll(date: Date, ctx: SollContext): number {
  const dayIdx = (date.getDay() + 6) % 7; // Mo=0
  const model = ctx.settings?.work_time_model
    ?? (ctx.employee?.worktime_model === "buak" ? "buak_auto" : null);

  if (model === "individual_week") {
    const r = ctx.dayRules.find((d) => d.weekday === dayIdx + 1);
    return r && r.is_working_day ? (Number(r.target_hours) || 0) : 0;
  }
  if (model === "fixed_weekly") {
    const rules = ctx.dayRules.length ? ctx.dayRules : defaultDayRules(date.getFullYear());
    const isWork = rules.find((d) => d.weekday === dayIdx + 1)?.is_working_day ?? dayIdx < 5;
    return isWork ? (Number(ctx.settings?.fixed_weekly_hours) || 0) / activeWorkingDays(rules) : 0;
  }

  // Wochenbasierte Modelle: Wochenart aus Kalender
  const { year, week } = isoWeekYear(date);
  const wk = ctx.weeks.find((w) => w.year === year && w.week === week);
  const wt: BuakWeekType = (wk?.week_type as BuakWeekType) ?? "neutral";
  const dayKey = WEEKDAYS[dayIdx].key;
  const pick = (w?: WeekHours | null) => Number((w || {})[dayKey]) || 0;

  // Mitarbeiter-Tagesmodell (präzise je Wochenart), falls vorhanden
  if (ctx.employee && (pick(ctx.employee.week_short) || pick(ctx.employee.week_long))) {
    if (wt === "frei") return 0;
    if (wt === "kurz") return pick(ctx.employee.week_short);
    return pick(ctx.employee.week_long) || pick(ctx.employee.week_short); // lang/neutral
  }

  // Sonst: Wochen-Soll gleichmäßig auf Arbeitstage verteilen
  if (wt === "frei") return 0;
  const weekTarget = wk?.target_hours != null
    ? Number(wk.target_hours)
    : (ctx.settings ? targetForWeekType(ctx.settings, wt) : 0);
  const rules = ctx.dayRules.length ? ctx.dayRules : defaultDayRules(date.getFullYear());
  const isWork = rules.find((d) => d.weekday === dayIdx + 1)?.is_working_day ?? dayIdx < 5;
  return isWork ? weekTarget / activeWorkingDays(rules) : 0;
}

/**
 * Effektives Tages-Wochenmodell eines Mitarbeiters: der individuelle Override
 * (employees.week_short/week_long) gewinnt; sonst kommen die Tagesstunden aus der
 * zugewiesenen Arbeitszeitmodell-Vorlage (work_time_models). So nutzt die zentrale
 * Soll-Berechnung (resolveDaySoll) je Mitarbeiter dessen eigenes Modell – für alle
 * Logiken (buak/fixe/individuelle Woche), da resolveDaySoll Tagesstunden je Wochenart
 * bevorzugt verwendet.
 */
export function effectiveEmployeeWeekModel(
  emp: { worktime_model?: string | null; week_short?: WeekHours | null; week_long?: WeekHours | null } | null,
  template: { logic?: string | null; week_short?: WeekHours | null; week_long?: WeekHours | null } | null,
): EmployeeWeekModel | null {
  if (!emp && !template) return null;
  const has = (w?: WeekHours | null) => !!w && Object.keys(w).length > 0;
  return {
    worktime_model: emp?.worktime_model ?? (template?.logic === "buak_auto" ? "buak" : null),
    week_short: has(emp?.week_short) ? (emp!.week_short as WeekHours) : (template?.week_short ?? null),
    week_long: has(emp?.week_long) ? (emp!.week_long as WeekHours) : (template?.week_long ?? null),
  };
}

/** Soll-Kontext für einen konkreten Mitarbeiter: löst dessen Arbeitszeitmodell-Vorlage auf. */
export async function loadSollContextForEmployee(
  year: number,
  emp: { work_time_model_id?: string | null; worktime_model?: string | null; week_short?: WeekHours | null; week_long?: WeekHours | null } | null,
): Promise<SollContext> {
  let template: { logic?: string | null; week_short?: WeekHours | null; week_long?: WeekHours | null } | null = null;
  if (emp?.work_time_model_id) {
    const { data } = await supabase
      .from("work_time_models").select("logic,week_short,week_long").eq("id", emp.work_time_model_id).maybeSingle();
    template = (data as any) ?? null;
  }
  return loadSollContext(year, effectiveEmployeeWeekModel(emp ?? null, template));
}

/** Lädt den vollständigen Soll-Kontext einer Firma für ein Jahr. */
export async function loadSollContext(year: number, employee?: EmployeeWeekModel | null): Promise<SollContext> {
  const [settings, weeksRes, dayRules] = await Promise.all([
    loadWorkSettings(year).catch(() => null),
    supabase.from("buak_calendar").select("id,year,week,date_from,date_to,week_type,soll_bau,soll_maler,note,source,target_hours,updated_at").eq("year", year).order("week"),
    loadDayRules(year).catch(() => [] as WorkDayRule[]),
  ]);
  return { settings, weeks: (weeksRes.data as BuakWeek[]) ?? [], dayRules, employee: employee ?? null };
}
