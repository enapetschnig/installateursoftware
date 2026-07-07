// ============================================================
// Installateursoftware – Zeiterfassung (Datenlayer + Auswertung)
//
// Ist-Zeiterfassung je Mitarbeiter/Projekt auf Basis von time_entries
// (Migration 0133). Von–Bis + Pause → Stunden; Eintragsarten
// (Arbeit/Urlaub/Krankenstand/ZA/Feiertag/…); Zeitkonto (ZA) über die
// RPC za_book; Urlaub über leave_requests/leave_balances.
//
// Soll-Stunden kommen aus der zentralen, modellbewussten Engine
// (src/lib/work-calendar.ts → resolveDaySoll) je Mitarbeiter-
// Arbeitszeitmodell. Der Tagessaldo wird PRO TAG gerechnet (mehrere
// Einträge summiert, dann gegen Soll), Sonderarten sind neutral (Soll=0).
// ============================================================
import { supabase } from "./supabase";
import {
  loadSollContextForEmployee, resolveDaySoll, SollContext,
} from "./work-calendar";

export type EntryKind =
  | "arbeit" | "urlaub" | "krankenstand" | "feiertag"
  | "zeitausgleich" | "weiterbildung" | "betriebsurlaub" | "sonstig";

export type LocationType = "baustelle" | "werkstatt" | "buero" | "sonstig";

export type TimeEntry = {
  id: string;
  employee_id: string | null;
  project_id: string | null;
  work_date: string;          // YYYY-MM-DD
  start_time: string | null;  // HH:MM(:SS)
  end_time: string | null;
  pause_minutes: number;
  hours: number;
  hourly_rate: number | null;
  description: string | null;
  location_type: LocationType;
  entry_kind: EntryKind;
  approved: boolean;
  approved_at: string | null;
  nachgetragen_von: string | null;
  nachgetragen_am: string | null;
  source_regie_report_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export const ENTRY_KINDS: { value: EntryKind; label: string; special: boolean }[] = [
  { value: "arbeit", label: "Arbeit", special: false },
  { value: "urlaub", label: "Urlaub", special: true },
  { value: "krankenstand", label: "Krankenstand", special: true },
  { value: "feiertag", label: "Feiertag", special: true },
  { value: "zeitausgleich", label: "Zeitausgleich", special: true },
  { value: "weiterbildung", label: "Weiterbildung", special: true },
  { value: "betriebsurlaub", label: "Betriebsurlaub", special: true },
  { value: "sonstig", label: "Sonstiges", special: false },
];

export const LOCATION_TYPES: { value: LocationType; label: string; icon: string }[] = [
  { value: "baustelle", label: "Baustelle", icon: "🏗️" },
  { value: "werkstatt", label: "Werkstatt", icon: "🔧" },
  { value: "buero", label: "Büro", icon: "🏢" },
  { value: "sonstig", label: "Sonstiges", icon: "📍" },
];

export const entryKindLabel = (k: string): string =>
  ENTRY_KINDS.find((e) => e.value === k)?.label ?? k;

export const isSpecialKind = (k: string): boolean =>
  ENTRY_KINDS.find((e) => e.value === k)?.special ?? false;

const COLS =
  "id,employee_id,project_id,work_date,start_time,end_time,pause_minutes,hours,hourly_rate,description,location_type,entry_kind,approved,approved_at,nachgetragen_von,nachgetragen_am,source_regie_report_id,created_at,updated_at";

// ------------------------------------------------------------
// Zeit-Rechnen
// ------------------------------------------------------------
/** Stunden aus Von–Bis (HH:MM) minus Pause (Minuten); Übernacht unterstützt. */
export function hoursFromRange(start: string | null, end: string | null, pauseMin: number): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // Schicht über Mitternacht
  mins -= Math.max(0, pauseMin || 0);
  return Math.max(0, Math.round((mins / 60) * 100) / 100);
}

export const fmtHours = (h: number): string =>
  new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(h || 0));

/** Saldo mit Vorzeichen (+2,50 / −1,25). */
export const fmtSaldo = (h: number): string => {
  const v = Number(h || 0);
  const s = fmtHours(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
};

// ------------------------------------------------------------
// CRUD
// ------------------------------------------------------------
export type TimeEntryFilter = {
  employeeId?: string | null;
  projectId?: string | null;
  from?: string;   // YYYY-MM-DD
  to?: string;     // YYYY-MM-DD
};

export async function loadTimeEntries(f: TimeEntryFilter): Promise<TimeEntry[]> {
  let q = supabase.from("time_entries").select(COLS).order("work_date", { ascending: false }).order("start_time", { ascending: true });
  if (f.employeeId) q = q.eq("employee_id", f.employeeId);
  if (f.projectId) q = q.eq("project_id", f.projectId);
  if (f.from) q = q.gte("work_date", f.from);
  if (f.to) q = q.lte("work_date", f.to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map((r) => ({ ...r, hours: Number(r.hours) || 0, pause_minutes: Number(r.pause_minutes) || 0 }));
}

export type TimeEntryInput = {
  id?: string;
  employee_id: string;
  project_id?: string | null;
  work_date: string;
  start_time?: string | null;
  end_time?: string | null;
  pause_minutes?: number;
  hours?: number;              // wenn nicht gesetzt: aus Von–Bis berechnet
  description?: string | null;
  location_type?: LocationType;
  entry_kind?: EntryKind;
};

export async function saveTimeEntry(input: TimeEntryInput): Promise<{ error?: string; id?: string }> {
  const hours = input.hours != null
    ? input.hours
    : hoursFromRange(input.start_time ?? null, input.end_time ?? null, input.pause_minutes ?? 0);
  const payload: any = {
    id: input.id || undefined,
    employee_id: input.employee_id,
    project_id: input.project_id ?? null,
    work_date: input.work_date,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    pause_minutes: input.pause_minutes ?? 0,
    hours,
    description: input.description ?? null,
    location_type: input.location_type ?? "baustelle",
    entry_kind: input.entry_kind ?? "arbeit",
  };
  const { data, error } = await supabase.from("time_entries").upsert(payload).select("id").maybeSingle();
  return { error: error?.message, id: (data as any)?.id };
}

/** Admin-Nachtrag markieren (setzt nachgetragen_von/_am). */
export async function markBackdated(id: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  await supabase.from("time_entries").update({
    nachgetragen_von: u.user?.id ?? null,
    nachgetragen_am: new Date().toISOString(),
  }).eq("id", id);
}

export async function deleteTimeEntry(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  return { error: error?.message };
}

export async function setApproved(ids: string[], approved: boolean): Promise<{ error?: string }> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("time_entries").update({
    approved,
    approved_at: approved ? new Date().toISOString() : null,
    approved_by: approved ? (u.user?.id ?? null) : null,
  }).in("id", ids);
  return { error: error?.message };
}

// ------------------------------------------------------------
// Zeitkonto (ZA)
// ------------------------------------------------------------
export type TimeAccountTx = {
  id: string;
  employee_id: string;
  change_type: string;
  hours: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  reference_id: string | null;
  created_at: string;
};

export async function loadTimeAccount(employeeId: string): Promise<number> {
  const { data } = await supabase.from("time_accounts").select("balance_hours").eq("employee_id", employeeId).maybeSingle();
  return Number((data as any)?.balance_hours ?? 0);
}

export async function loadTimeAccountTx(employeeId: string): Promise<TimeAccountTx[]> {
  const { data } = await supabase
    .from("time_account_transactions").select("*").eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  return ((data as any[]) ?? []).map((r) => ({ ...r, hours: Number(r.hours), balance_before: Number(r.balance_before), balance_after: Number(r.balance_after) }));
}

/** Transaktionale Zeitkonto-Buchung (RPC za_book). hours: +Gutschrift / −Abzug. */
export async function bookTimeAccount(
  employeeId: string, hours: number, changeType: string, reason?: string, referenceId?: string,
): Promise<{ error?: string; balance?: number }> {
  const { data, error } = await supabase.rpc("za_book", {
    p_employee_id: employeeId, p_hours: hours, p_change_type: changeType,
    p_reason: reason ?? null, p_reference_id: referenceId ?? null,
  });
  return { error: error?.message, balance: data != null ? Number(data) : undefined };
}

// ------------------------------------------------------------
// Urlaub
// ------------------------------------------------------------
export type LeaveRequest = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  days: number;
  type: string;
  status: "beantragt" | "genehmigt" | "abgelehnt" | "storniert";
  notizen: string | null;
  created_at: string;
};

export async function loadLeaveRequests(employeeId?: string): Promise<LeaveRequest[]> {
  let q = supabase.from("leave_requests").select("*").order("start_date", { ascending: false });
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data } = await q;
  return ((data as any[]) ?? []).map((r) => ({ ...r, days: Number(r.days) }));
}

export async function loadLeaveBalance(employeeId: string, year: number): Promise<{ total: number; used: number }> {
  const { data } = await supabase.from("leave_balances").select("total_days,used_days")
    .eq("employee_id", employeeId).eq("year", year).maybeSingle();
  return { total: Number((data as any)?.total_days ?? 25), used: Number((data as any)?.used_days ?? 0) };
}

export async function saveLeaveRequest(r: Partial<LeaveRequest> & { employee_id: string; start_date: string; end_date: string; days: number }): Promise<{ error?: string }> {
  const { error } = await supabase.from("leave_requests").upsert({
    id: r.id || undefined,
    employee_id: r.employee_id, start_date: r.start_date, end_date: r.end_date,
    days: r.days, type: r.type ?? "urlaub", status: r.status ?? "beantragt", notizen: r.notizen ?? null,
  });
  return { error: error?.message };
}

export async function reviewLeaveRequest(id: string, status: "genehmigt" | "abgelehnt"): Promise<{ error?: string }> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("leave_requests").update({
    status, reviewed_by: u.user?.id ?? null, reviewed_at: new Date().toISOString(),
  }).eq("id", id);
  return { error: error?.message };
}

// ------------------------------------------------------------
// Feiertage / Betriebsurlaub
// ------------------------------------------------------------
export type CompanyHoliday = { id: string; datum: string; bezeichnung: string; kind: "feiertag" | "betriebsurlaub" };

export async function loadCompanyHolidays(fromYear?: number, toYear?: number): Promise<CompanyHoliday[]> {
  let q = supabase.from("company_holidays").select("id,datum,bezeichnung,kind").order("datum");
  if (fromYear) q = q.gte("datum", `${fromYear}-01-01`);
  if (toYear) q = q.lte("datum", `${toYear}-12-31`);
  const { data } = await q;
  return (data as CompanyHoliday[]) ?? [];
}

// ------------------------------------------------------------
// Auswertung / Saldo
// ------------------------------------------------------------
export type DaySummary = {
  date: string;             // YYYY-MM-DD
  ist: number;              // Summe verbuchte Stunden (Arbeit)
  soll: number;             // Sollstunden (0 bei Sonderart/Feiertag)
  saldo: number;            // ist - soll (0 bei neutralen Tagen)
  neutral: boolean;         // Sonderart/Feiertag → Saldo-neutral
  entries: TimeEntry[];
  specialKind?: EntryKind;  // z. B. urlaub/krankenstand
};

export type MonthSummary = {
  days: DaySummary[];
  istTotal: number;
  sollTotal: number;
  autoSaldo: number;        // Summe der Tagessalden
};

/**
 * Rechnet den Tages-/Monatssaldo für einen Mitarbeiter.
 * Soll je Arbeitstag aus der zentralen Engine; Feiertage & Sonderarten neutral.
 */
export function summarize(
  entries: TimeEntry[],
  from: string,
  to: string,
  ctx: SollContext,
  holidays: Set<string>,
): MonthSummary {
  const byDate = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    if (!byDate.has(e.work_date)) byDate.set(e.work_date, []);
    byDate.get(e.work_date)!.push(e);
  }

  // Tages-Iterator rein über lokale Datumsteile (kein toISOString!): in einer
  // positiven Zeitzone (AT = UTC+1/+2) würde toISOString().slice(0,10) den
  // Schlüssel um einen Kalendertag zurückschieben und so Ist/Soll gegen den
  // falschen Tag matchen (letzter Tag fehlt). YYYY-MM-DD stets lokal bilden.
  const isoOf = (dd: Date): string => {
    const y = dd.getFullYear();
    const m = String(dd.getMonth() + 1).padStart(2, "0");
    const day = String(dd.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const days: DaySummary[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = isoOf(d);
    const dayEntries = byDate.get(iso) ?? [];
    const special = dayEntries.find((e) => isSpecialKind(e.entry_kind));
    const isHoliday = holidays.has(iso);

    const ist = dayEntries
      .filter((e) => !isSpecialKind(e.entry_kind))
      .reduce((a, e) => a + (Number(e.hours) || 0), 0);

    const neutral = !!special || isHoliday;
    const soll = neutral ? 0 : resolveDaySoll(new Date(iso + "T00:00:00"), ctx);
    const saldo = neutral ? 0 : ist - soll;

    // Leere reguläre Tage mit Soll=0 (Wochenende) überspringen wir in der Anzeige,
    // aber Tage mit Einträgen oder Soll>0 nehmen wir immer auf.
    if (dayEntries.length || soll > 0 || isHoliday) {
      days.push({ date: iso, ist, soll, saldo, neutral, entries: dayEntries, specialKind: special?.entry_kind });
    }
  }

  const istTotal = days.reduce((a, d) => a + d.ist, 0);
  const sollTotal = days.reduce((a, d) => a + d.soll, 0);
  const autoSaldo = days.reduce((a, d) => a + d.saldo, 0);
  return { days, istTotal, sollTotal, autoSaldo };
}

/** Convenience: Soll-Kontext für einen Mitarbeiter laden (delegiert an work-calendar). */
export async function loadEmployeeSollContext(year: number, employeeId: string): Promise<SollContext> {
  const { data } = await supabase.from("employees")
    .select("work_time_model_id,worktime_model,week_short,week_long").eq("id", employeeId).maybeSingle();
  return loadSollContextForEmployee(year, (data as any) ?? null);
}
