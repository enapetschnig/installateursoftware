// ============================================================
// B4Y SuperAPP – Arbeitszeitmodell-Vorlagen (Stammdaten)
// Frei anlegbare Modelle (Tabelle work_time_models, Migr. 0092). Mitarbeiter
// bekommen über employees.work_time_model_id eine Vorlage zugewiesen. Die
// Logik-Keys sind identisch zu den Firmen-Jahresmodellen (work-calendar.ts),
// damit die zentrale Soll-Berechnung dieselbe Logik nutzen kann.
// ============================================================
import { supabase } from "./supabase";
import { WeekHours, sumWeek } from "./employee-types";
import { WorkTimeModel } from "./work-calendar";

export type WorkTimeTemplate = {
  id: string;
  name: string;
  description: string | null;
  logic: WorkTimeModel;
  week_short: WeekHours;
  week_long: WeekHours;
  weekly_hours: number | null;
  daily_hours: number | null;
  is_active: boolean;
  sort_order: number;
};

// Für Vorlagen sinnvolle Logik-Optionen (Untermenge der work-calendar-Modelle).
export const WORK_TIME_LOGIC_OPTIONS: { value: WorkTimeModel; label: string }[] = [
  { value: "buak_auto", label: "BUAK kurz/lang (aus Jahreskalender)" },
  { value: "only_short", label: "Nur kurze Woche" },
  { value: "only_long", label: "Nur lange Woche" },
  { value: "fixed_weekly", label: "Fixe Wochenarbeitszeit" },
  { value: "individual_week", label: "Individuelles Wochenmodell" },
];

export const workTimeLogicLabel = (k: string): string =>
  WORK_TIME_LOGIC_OPTIONS.find((o) => o.value === k)?.label ?? (k || "–");

const COLS =
  "id,name,description,logic,week_short,week_long,weekly_hours,daily_hours,is_active,sort_order";

function fromRow(r: any): WorkTimeTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    logic: (r.logic ?? "buak_auto") as WorkTimeModel,
    week_short: (r.week_short ?? {}) as WeekHours,
    week_long: (r.week_long ?? {}) as WeekHours,
    weekly_hours: r.weekly_hours != null ? Number(r.weekly_hours) : null,
    daily_hours: r.daily_hours != null ? Number(r.daily_hours) : null,
    is_active: r.is_active !== false,
    sort_order: Number(r.sort_order) || 0,
  };
}

/** Alle Vorlagen (für Verwaltung inkl. inaktive) bzw. nur aktive (für Auswahl). */
export async function loadWorkTimeModels(activeOnly = false): Promise<WorkTimeTemplate[]> {
  let q = supabase.from("work_time_models").select(COLS).order("sort_order", { ascending: true }).order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map(fromRow);
}

/** Anlegen/Aktualisieren. organization_id wird per DB-Default (current_org_id) gesetzt. */
export async function saveWorkTimeModel(t: WorkTimeTemplate): Promise<{ error?: string; id?: string }> {
  const payload: any = {
    id: t.id || undefined,
    name: t.name.trim(),
    description: t.description,
    logic: t.logic,
    week_short: t.week_short ?? {},
    week_long: t.week_long ?? {},
    // Wochenstunden: bei fixen Modellen vom Eingabewert, sonst aus Tagesstunden ableiten.
    weekly_hours: t.weekly_hours != null ? t.weekly_hours : (sumWeek(t.week_long) || sumWeek(t.week_short) || null),
    daily_hours: t.daily_hours,
    is_active: t.is_active,
    sort_order: t.sort_order,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("work_time_models").upsert(payload).select("id").maybeSingle();
  return { error: error?.message, id: (data as any)?.id };
}

/** Vorlage duplizieren (Name + „(Kopie)", ans Ende sortiert). */
export async function duplicateWorkTimeModel(t: WorkTimeTemplate): Promise<{ error?: string; id?: string }> {
  return saveWorkTimeModel({
    ...t,
    id: "",
    name: `${t.name} (Kopie)`,
    sort_order: (t.sort_order || 0) + 1,
    is_active: true,
  });
}

export function emptyWorkTimeModel(sortOrder = 0): WorkTimeTemplate {
  return {
    id: "", name: "", description: "", logic: "buak_auto",
    week_short: {}, week_long: {}, weekly_hours: null, daily_hours: null,
    is_active: true, sort_order: sortOrder,
  };
}
