// ============================================================
// B4Y SuperAPP – Planungsmodul (Datenlayer)
// Termine, Ressourcen, Abwesenheiten, Konfiguration + Konfliktprüfung.
// Mandantenfähig über die RLS der Tabellen (organization_id/current_org_id()).
// Mitarbeiter kommen aus den bestehenden Stammdaten (employees) – nicht doppelt.
// ============================================================
import { supabase } from "./supabase";

// ── Typen ──────────────────────────────────────────────────
export type ResourceType = { id: string; name: string; slug: string | null; icon: string | null; sort_order: number; is_active: boolean };
export type Category = { id: string; name: string; slug: string | null; color: string; sort_order: number; is_active: boolean };
export type EventType = { id: string; name: string; slug: string | null; color: string; default_duration_min: number; is_absence: boolean; sort_order: number; is_active: boolean };

export type Resource = {
  id: string; name: string; resource_type_id: string | null; category_id: string | null;
  employee_id: string | null; color: string; description: string | null;
  availability: any | null; is_active: boolean; sort_order: number;
};

export type PlanningEvent = {
  id: string;
  title: string;
  event_type_id: string | null;
  category_id: string | null;
  status: string;
  priority: string;
  color: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  project_id: string | null;
  contact_id: string | null;
  location: string | null;
  description: string | null;
  visibility: string;
  recurrence: any | null;
  reminder: any | null;
  done_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};
export type EventWithLinks = PlanningEvent & { employee_ids: string[]; resource_ids: string[] };

export type Absence = {
  id: string; employee_id: string | null; kind: string;
  start_date: string; end_date: string; all_day: boolean;
  status: string; color: string; note: string | null; created_by: string | null;
};

export type EmployeeLite = { id: string; first_name: string; last_name: string; active: boolean };

// ── Status / Prioritäten / Abwesenheitsarten ───────────────
export const EVENT_STATUSES = ["geplant", "bestaetigt", "in_arbeit", "erledigt", "abgesagt", "verschoben", "offen", "intern"] as const;
export const STATUS_LABEL: Record<string, string> = {
  geplant: "Geplant", bestaetigt: "Bestätigt", in_arbeit: "In Arbeit", erledigt: "Erledigt",
  abgesagt: "Abgesagt", verschoben: "Verschoben", offen: "Offen", intern: "Intern",
};
export const STATUS_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  geplant: "blue", bestaetigt: "blue", in_arbeit: "amber", erledigt: "green",
  abgesagt: "red", verschoben: "amber", offen: "slate", intern: "slate",
};
export const PRIORITIES = ["niedrig", "normal", "hoch", "dringend"] as const;
export const ABSENCE_KINDS: { key: string; label: string; color: string }[] = [
  { key: "urlaub", label: "Urlaub", color: "#ef4444" },
  { key: "krankenstand", label: "Krankenstand", color: "#dc2626" },
  { key: "pflegeurlaub", label: "Pflegeurlaub", color: "#f97316" },
  { key: "zeitausgleich", label: "Zeitausgleich", color: "#f59e0b" },
  { key: "schulung", label: "Schulung", color: "#0d9488" },
  { key: "frei", label: "Frei / nicht verfügbar", color: "#94a3b8" },
];
export const absenceLabel = (k: string) => ABSENCE_KINDS.find((a) => a.key === k)?.label ?? k;
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
export const statusTone = (s: string) => STATUS_TONE[s] ?? "slate";

export const empName = (e: { first_name?: string | null; last_name?: string | null } | null | undefined) =>
  e ? [e.first_name, e.last_name].filter(Boolean).join(" ") : "–";

/** Farbe eines Termins: eigene > Terminart > Kategorie > Default. */
export function eventColor(ev: { color?: string | null; event_type_id?: string | null; category_id?: string | null },
  types: EventType[], cats: Category[]): string {
  if (ev.color) return ev.color;
  const t = types.find((x) => x.id === ev.event_type_id);
  if (t?.color) return t.color;
  const c = cats.find((x) => x.id === ev.category_id);
  if (c?.color) return c.color;
  return "#0ea5e9";
}

// ── Konfiguration laden ────────────────────────────────────
export type PlanningConfig = {
  resourceTypes: ResourceType[]; categories: Category[]; eventTypes: EventType[];
  resources: Resource[]; employees: EmployeeLite[];
};
export async function loadConfig(activeOnly = true): Promise<PlanningConfig> {
  const [rt, cat, et, res, emp] = await Promise.all([
    supabase.from("planning_resource_types").select("*").order("sort_order").order("name"),
    supabase.from("planning_categories").select("*").order("sort_order").order("name"),
    supabase.from("planning_event_types").select("*").order("sort_order").order("name"),
    supabase.from("planning_resources").select("*").order("sort_order").order("name"),
    supabase.from("employees").select("id,first_name,last_name,active").order("last_name").order("first_name"),
  ]);
  const filt = <T extends { is_active?: boolean }>(d: any): T[] => ((d.data as T[]) ?? []).filter((x) => !activeOnly || x.is_active !== false);
  return {
    resourceTypes: filt<ResourceType>(rt),
    categories: filt<Category>(cat),
    eventTypes: filt<EventType>(et),
    resources: ((res.data as Resource[]) ?? []).filter((r) => !activeOnly || r.is_active !== false),
    employees: ((emp.data as EmployeeLite[]) ?? []).filter((e) => !activeOnly || e.active !== false),
  };
}

// ── Termine laden (Zeitraum, überlappend) ──────────────────
export type EventFilters = {
  employeeId?: string | null; resourceId?: string | null; categoryId?: string | null;
  eventTypeId?: string | null; projectId?: string | null; status?: string | null; search?: string | null;
};

export async function loadEvents(startISO: string, endISO: string, f: EventFilters = {}): Promise<EventWithLinks[]> {
  let q = supabase.from("planning_events").select("*")
    .lt("start_at", endISO).gt("end_at", startISO)
    .order("start_at", { ascending: true });
  if (f.categoryId) q = q.eq("category_id", f.categoryId);
  if (f.eventTypeId) q = q.eq("event_type_id", f.eventTypeId);
  if (f.projectId) q = q.eq("project_id", f.projectId);
  if (f.status) q = q.eq("status", f.status);
  if (f.search) {
    const s = f.search.replace(/[%_]/g, (m) => "\\" + m);
    q = q.or(`title.ilike.%${s}%,location.ilike.%${s}%,description.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const evs = (data as PlanningEvent[]) ?? [];
  const ids = evs.map((e) => e.id);
  let eeRows: any[] = [], erRows: any[] = [];
  if (ids.length) {
    const [ee, er] = await Promise.all([
      supabase.from("planning_event_employees").select("event_id,employee_id").in("event_id", ids),
      supabase.from("planning_event_resources").select("event_id,resource_id").in("event_id", ids),
    ]);
    eeRows = (ee.data as any[]) ?? []; erRows = (er.data as any[]) ?? [];
  }
  let result: EventWithLinks[] = evs.map((e) => ({
    ...e,
    employee_ids: eeRows.filter((r) => r.event_id === e.id).map((r) => r.employee_id),
    resource_ids: erRows.filter((r) => r.event_id === e.id).map((r) => r.resource_id),
  }));
  // Mitarbeiter-/Ressourcenfilter clientseitig (Join über Linktabellen)
  if (f.employeeId) result = result.filter((e) => e.employee_ids.includes(f.employeeId!));
  if (f.resourceId) result = result.filter((e) => e.resource_ids.includes(f.resourceId!));
  return result;
}

// ── Termin speichern (mit Mitarbeiter-/Ressourcen-Sync) ────
export type SaveEventInput = Partial<PlanningEvent> & {
  title: string; start_at: string; end_at: string;
  employee_ids?: string[]; resource_ids?: string[];
};
export async function saveEvent(input: SaveEventInput): Promise<{ id?: string; error?: string }> {
  const { employee_ids, resource_ids, ...ev } = input;
  const payload: any = { ...ev, updated_at: new Date().toISOString() };
  let id = ev.id;
  if (id) {
    const { error } = await supabase.from("planning_events").update(payload).eq("id", id);
    if (error) return { error: error.message };
  } else {
    delete payload.id;
    const { data, error } = await supabase.from("planning_events").insert(payload).select("id").single();
    if (error || !data) return { error: error?.message ?? "Termin konnte nicht angelegt werden." };
    id = (data as any).id;
  }
  // Verknüpfungen neu setzen
  await supabase.from("planning_event_employees").delete().eq("event_id", id);
  await supabase.from("planning_event_resources").delete().eq("event_id", id);
  if (employee_ids?.length)
    await supabase.from("planning_event_employees").insert(employee_ids.map((e) => ({ event_id: id, employee_id: e })));
  if (resource_ids?.length)
    await supabase.from("planning_event_resources").insert(resource_ids.map((r) => ({ event_id: id, resource_id: r })));
  return { id };
}

export async function deleteEvent(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("planning_events").delete().eq("id", id);
  return { error: error?.message };
}

// ── Abwesenheiten ──────────────────────────────────────────
export async function loadAbsences(startDate: string, endDate: string, employeeId?: string | null): Promise<Absence[]> {
  let q = supabase.from("planning_absences").select("*")
    .lte("start_date", endDate).gte("end_date", startDate)
    .order("start_date", { ascending: true });
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Absence[]) ?? [];
}
export async function saveAbsence(a: Partial<Absence> & { employee_id: string; kind: string; start_date: string; end_date: string }): Promise<{ error?: string }> {
  const payload: any = { ...a };
  if (a.id) { const { error } = await supabase.from("planning_absences").update(payload).eq("id", a.id); return { error: error?.message }; }
  delete payload.id;
  const { error } = await supabase.from("planning_absences").insert(payload);
  return { error: error?.message };
}
export async function deleteAbsence(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("planning_absences").delete().eq("id", id);
  return { error: error?.message };
}

// ── Ressourcen-CRUD ────────────────────────────────────────
export async function saveResource(r: Partial<Resource> & { name: string }): Promise<{ error?: string }> {
  const payload: any = { ...r };
  if (r.id) { const { error } = await supabase.from("planning_resources").update(payload).eq("id", r.id); return { error: error?.message }; }
  delete payload.id;
  const { error } = await supabase.from("planning_resources").insert(payload);
  return { error: error?.message };
}
export async function deleteResource(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("planning_resources").delete().eq("id", id);
  return { error: error?.message };
}

// ── Konfigurations-CRUD (Einstellungen) ────────────────────
type ConfigTable = "planning_resource_types" | "planning_categories" | "planning_event_types";
export async function saveConfigRow(table: ConfigTable, row: any): Promise<{ error?: string }> {
  const payload = { ...row };
  if (row.id) { const { error } = await supabase.from(table).update(payload).eq("id", row.id); return { error: error?.message }; }
  delete payload.id;
  const { error } = await supabase.from(table).insert(payload);
  return { error: error?.message };
}
export async function deleteConfigRow(table: ConfigTable, id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from(table).delete().eq("id", id);
  return { error: error?.message };
}

// ── Konfliktprüfung ────────────────────────────────────────
export type Conflict = { type: "mitarbeiter" | "ressource" | "abwesenheit"; message: string };

/**
 * Prüft Überschneidungen: Mitarbeiter/Ressource bereits verplant,
 * Mitarbeiter abwesend (Urlaub/Krank). Liefert eine Liste klarer Warnungen.
 */
export async function checkConflicts(opts: {
  startISO: string; endISO: string; employeeIds: string[]; resourceIds: string[];
  excludeEventId?: string | null; employees: EmployeeLite[]; resources: Resource[];
}): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  const { startISO, endISO, employeeIds, resourceIds, excludeEventId } = opts;

  // Überlappende Termine
  let q = supabase.from("planning_events").select("id,title,start_at,end_at")
    .lt("start_at", endISO).gt("end_at", startISO).neq("status", "abgesagt");
  if (excludeEventId) q = q.neq("id", excludeEventId);
  const { data: evs } = await q;
  const overlapIds = ((evs as any[]) ?? []).map((e) => e.id);
  const titleById = new Map(((evs as any[]) ?? []).map((e) => [e.id, e.title]));

  if (overlapIds.length && (employeeIds.length || resourceIds.length)) {
    if (employeeIds.length) {
      const { data: ee } = await supabase.from("planning_event_employees")
        .select("event_id,employee_id").in("event_id", overlapIds).in("employee_id", employeeIds);
      for (const row of ((ee as any[]) ?? [])) {
        const nm = empName(opts.employees.find((x) => x.id === row.employee_id));
        conflicts.push({ type: "mitarbeiter", message: `${nm} ist bereits verplant (${titleById.get(row.event_id) || "Termin"}).` });
      }
    }
    if (resourceIds.length) {
      const { data: er } = await supabase.from("planning_event_resources")
        .select("event_id,resource_id").in("event_id", overlapIds).in("resource_id", resourceIds);
      for (const row of ((er as any[]) ?? [])) {
        const nm = opts.resources.find((x) => x.id === row.resource_id)?.name ?? "Ressource";
        conflicts.push({ type: "ressource", message: `${nm} ist bereits belegt (${titleById.get(row.event_id) || "Termin"}).` });
      }
    }
  }

  // Abwesenheiten der Mitarbeiter im Zeitraum
  if (employeeIds.length) {
    const startD = startISO.slice(0, 10); const endD = endISO.slice(0, 10);
    const { data: abs } = await supabase.from("planning_absences").select("employee_id,kind,start_date,end_date")
      .in("employee_id", employeeIds).lte("start_date", endD).gte("end_date", startD);
    for (const a of ((abs as any[]) ?? [])) {
      const nm = empName(opts.employees.find((x) => x.id === a.employee_id));
      conflicts.push({ type: "abwesenheit", message: `${nm} ist abwesend (${absenceLabel(a.kind)}).` });
    }
  }
  return conflicts;
}

// ── Zeit-/Datums-Helfer ────────────────────────────────────
export const pad = (n: number) => String(n).padStart(2, "0");
export function startOfWeek(d: Date): Date { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
export function isoLocal(d: Date): string {
  // 'YYYY-MM-DDTHH:mm' in Lokalzeit (für datetime-local-Inputs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtTime(iso: string): string { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function fmtDate(iso: string): string { const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; }
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
