// ============================================================
// B4Y SuperAPP – BUAK-Kalender (Bauarbeiter-Urlaubs- und Abfertigungskasse)
// Wochenart (kurz/lang/neutral/frei) pro Kalenderwoche. Quelle für die
// Soll-Stunden-Berechnung – NIE fix "kurz/lang im Wechsel" raten.
// ============================================================
import { supabase } from "./supabase";
import { Employee, WeekHours, WEEKDAYS } from "./employee-types";

export type BuakWeekType = "kurz" | "lang" | "neutral" | "frei";

export type BuakWeek = {
  id: string;
  year: number;
  week: number;
  date_from: string | null;
  date_to: string | null;
  week_type: BuakWeekType;
  soll_bau: number | null;
  soll_maler: number | null;
  note: string | null;
  source: string | null;
  target_hours?: number | null;
  updated_at: string | null;
};

export const BUAK_COLUMNS = "id,year,week,date_from,date_to,week_type,soll_bau,soll_maler,note,source,target_hours,updated_at";

export const WEEK_TYPES: { value: BuakWeekType; label: string; tone: "amber" | "blue" | "slate" | "green" }[] = [
  { value: "kurz", label: "Kurze Woche", tone: "amber" },
  { value: "lang", label: "Lange Woche", tone: "blue" },
  { value: "neutral", label: "Neutral", tone: "slate" },
  { value: "frei", label: "Frei", tone: "green" },
];

export const weekTypeLabel = (v: string): string => WEEK_TYPES.find((w) => w.value === v)?.label ?? v;

// ---------- ISO-Kalenderwoche ----------
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** ISO-8601 Jahr + KW für ein Datum. */
export function isoWeekYear(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Donnerstag dieser Woche
  const year = date.getUTCFullYear();
  const firstThu = new Date(Date.UTC(year, 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThu.getTime()) / (7 * 24 * 3600 * 1000));
  return { year, week };
}

/** Montag (UTC) der angegebenen ISO-Woche. */
export function mondayOfISOWeek(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dow);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

/** Anzahl ISO-Wochen im Jahr (52 oder 53). */
export function weeksInYear(year: number): number {
  return isoWeekYear(new Date(year, 11, 28)).week;
}

/** Gerüst aller KWs eines Jahres (für „Jahr generieren"). */
export function generateYearWeeks(year: number): { week: number; date_from: string; date_to: string }[] {
  const out: { week: number; date_from: string; date_to: string }[] = [];
  for (let w = 1; w <= weeksInYear(year); w++) {
    const mon = mondayOfISOWeek(year, w);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    out.push({ week: w, date_from: fmt(mon), date_to: fmt(sun) });
  }
  return out;
}

// ---------- Laden ----------
export async function loadBuakYear(year: number): Promise<BuakWeek[]> {
  const { data, error } = await supabase
    .from("buak_calendar").select(BUAK_COLUMNS).eq("year", year).order("week");
  if (error) throw error;
  return (data as BuakWeek[]) ?? [];
}

export async function loadBuakYears(): Promise<number[]> {
  const { data } = await supabase.from("buak_calendar").select("year");
  const set = new Set<number>((data ?? []).map((r: any) => r.year));
  return Array.from(set).sort((a, b) => b - a);
}

// ---------- Vorbereitung: Soll-Stunden je Tag ----------
// Diese Helfer sind die Basis für Zeiterfassung, Urlaub und Stundenausgleich.

/** Wochenart aus dem BUAK-Kalender für ein Datum (nie geraten!). */
export function weekTypeForDate(date: Date, calendar: BuakWeek[]): BuakWeekType | null {
  const { year, week } = isoWeekYear(date);
  return calendar.find((c) => c.year === year && c.week === week)?.week_type ?? null;
}

/**
 * Tages-Sollstunden eines Mitarbeiters an einem Datum.
 * - Modell "buak": Wochenart aus Kalender → kurze/lange-Woche-Modell des Mitarbeiters.
 *   neutral → langes Modell (Normalwoche), frei → 0.
 * - sonst (buero/individuell): das gepflegte Modell (lange Woche, ersatzweise kurze).
 */
export function daySollHours(emp: Pick<Employee, "worktime_model" | "week_short" | "week_long">, date: Date, calendar: BuakWeek[]): number {
  const dayKey = WEEKDAYS[(date.getDay() + 6) % 7].key; // Mo=0
  const pick = (w: WeekHours) => Number((w || {})[dayKey]) || 0;

  if (emp.worktime_model === "buak") {
    const wt = weekTypeForDate(date, calendar);
    if (wt === "kurz") return pick(emp.week_short);
    if (wt === "lang") return pick(emp.week_long);
    if (wt === "frei") return 0;
    return pick(emp.week_long); // neutral / nicht hinterlegt → Normalwoche
  }
  const long = pick(emp.week_long);
  return long || pick(emp.week_short);
}
