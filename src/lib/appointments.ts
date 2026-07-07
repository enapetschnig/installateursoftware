// ============================================================
// B4Y SuperAPP – Termine/Terminserien (Datenlayer)
// CRUD für die Tabelle `appointments` inkl. Serien-Logik (RRULE),
// Ausnahmen (is_exception) und Bearbeiten/Löschen-Modi.
// Mandantenfähig: org_id wird DB-seitig per Default gesetzt – NIE im Insert.
// ============================================================
import { supabase } from "./supabase";
import { buildRRule, parseRRule, getOccurrences } from "./rruleUtils";

export interface Appointment {
  id: string;
  org_id: string | null;
  hero_projektnummer: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_datetime: string;          // ISO
  end_datetime: string;            // ISO
  all_day: boolean;
  timezone: string;
  is_recurring: boolean;
  rrule: string | null;
  recurrence_end_date: string | null;
  recurrence_count: number | null;
  recurrence_parent_id: string | null;
  is_exception: boolean;
  exception_original_date: string | null;
  cancelled: boolean;
  attendees: string[] | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Felder, die beim Anlegen/Aktualisieren gesetzt werden dürfen (org_id bewusst NICHT). */
export interface AppointmentInsert {
  hero_projektnummer?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  start_datetime: string;
  end_datetime: string;
  all_day?: boolean;
  timezone?: string;
  is_recurring?: boolean;
  rrule?: string | null;
  recurrence_end_date?: string | null;
  recurrence_count?: number | null;
  recurrence_parent_id?: string | null;
  is_exception?: boolean;
  exception_original_date?: string | null;
  cancelled?: boolean;
  attendees?: string[] | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface AppointmentFilters {
  from?: Date | null;
  to?: Date | null;
  heroProjektnummer?: string | null;
  search?: string | null;
  includeCancelled?: boolean;
}

export type SeriesEditMode = "this" | "this_and_future" | "all";

// ── interne Helfer ─────────────────────────────────────────
/** Virtuelle Vorkommen tragen die ID "<parentId>::<occISO>". */
function parseInstanceId(id: string): { parentId: string; occ: string | null } {
  const idx = id.indexOf("::");
  if (idx === -1) return { parentId: id, occ: null };
  return { parentId: id.slice(0, idx), occ: id.slice(idx + 2) };
}
function dayKey(d: Date): string { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function overlaps(a: { start_datetime: string; end_datetime: string }, from: Date, to: Date): boolean {
  const s = new Date(a.start_datetime).getTime();
  const e = new Date(a.end_datetime).getTime();
  return s < to.getTime() && e > from.getTime();
}
const nowISO = (): string => new Date().toISOString();

// ── Laden ──────────────────────────────────────────────────
/**
 * Lädt die gespeicherten Termin-Datensätze (Serien-Eltern, Einzeltermine,
 * Ausnahmen). Die Auflösung von Serien in konkrete Vorkommen erfolgt über
 * `expandRecurringSeries` / `materializeOccurrences`.
 */
export async function fetchAppointments(filters: AppointmentFilters = {}): Promise<Appointment[]> {
  let q = supabase.from("appointments").select("*").order("start_datetime", { ascending: true });

  // Abgesagte ausblenden – Ausnahme-Datensätze aber IMMER mitladen,
  // da sie zum Überspringen einzelner Serientermine gebraucht werden.
  if (!filters.includeCancelled) q = q.or("cancelled.eq.false,is_exception.eq.true");
  if (filters.heroProjektnummer) q = q.eq("hero_projektnummer", filters.heroProjektnummer);
  // Nur obere Grenze auf den Start anwenden: Serien-Eltern können vor `from`
  // beginnen und trotzdem Vorkommen im Zeitfenster haben.
  if (filters.to) q = q.lte("start_datetime", filters.to.toISOString());
  if (filters.search) {
    const s = filters.search.replace(/[%_]/g, (m) => "\\" + m);
    q = q.or(`title.ilike.%${s}%,location.ilike.%${s}%,description.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Appointment[];
}

/**
 * Expandiert eine Serie in konkrete (virtuelle) Termine im Bereich [from, to].
 * Einzeltermine werden – falls im Bereich – unverändert zurückgegeben.
 * `exceptions` (is_exception-Datensätze derselben Serie) blenden einzelne
 * Vorkommen aus (verschoben oder abgesagt).
 */
export function expandRecurringSeries(parent: Appointment, from: Date, to: Date, exceptions: Appointment[] = []): Appointment[] {
  if (!parent.is_recurring || !parent.rrule) {
    return overlaps(parent, from, to) && !parent.cancelled ? [parent] : [];
  }
  const start = new Date(parent.start_datetime);
  const dur = new Date(parent.end_datetime).getTime() - start.getTime();

  const opt = parseRRule(parent.rrule);
  let until = opt.until ?? null;
  if (parent.recurrence_end_date) {
    const red = new Date(parent.recurrence_end_date);
    until = until ? new Date(Math.min(until.getTime(), red.getTime())) : red;
  }
  const count = opt.count ?? parent.recurrence_count ?? null;

  // Generierung begrenzen: per COUNT (falls vorhanden), sonst per UNTIL bzw. `to`.
  // Wichtig: ALLE Regel-Teile (byMonthDay/bySetPos/byMonth) übernehmen, nur die Grenzen ersetzen.
  const boundedRule = count != null
    ? buildRRule({ ...opt, count, until: null })
    : buildRRule({ ...opt, count: null, until: until ? new Date(Math.min(until.getTime(), to.getTime())) : new Date(to.getTime()) });

  const occ = getOccurrences(boundedRule, start, 5000);
  const skip = new Set(
    exceptions
      .map((e) => (e.exception_original_date ? dayKey(new Date(e.exception_original_date)) : ""))
      .filter(Boolean),
  );

  const out: Appointment[] = [];
  for (const d of occ) {
    if (d.getTime() < from.getTime() || d.getTime() > to.getTime()) continue;
    if (skip.has(dayKey(d))) continue;
    const s = new Date(d);
    const e = new Date(d.getTime() + dur);
    out.push({
      ...parent,
      id: `${parent.id}::${s.toISOString()}`,
      start_datetime: s.toISOString(),
      end_datetime: e.toISOString(),
      recurrence_parent_id: parent.id,
      is_recurring: true,
    });
  }
  return out;
}

/**
 * Wandelt rohe Datensätze in konkrete, sortierte Termine im Bereich [from, to] um:
 * Serien werden expandiert, Ausnahmen eingeblendet bzw. ausgeblendet.
 */
export function materializeOccurrences(rows: Appointment[], from: Date, to: Date): Appointment[] {
  const exceptions = rows.filter((r) => r.is_exception && r.recurrence_parent_id);
  const out: Appointment[] = [];
  for (const r of rows) {
    if (r.is_exception) {
      // Verschobene Ausnahmen werden als eigene Termine angezeigt; abgesagte nicht.
      if (!r.cancelled && overlaps(r, from, to)) out.push(r);
      continue;
    }
    if (r.is_recurring && r.rrule) {
      const ex = exceptions.filter((e) => e.recurrence_parent_id === r.id);
      out.push(...expandRecurringSeries(r, from, to, ex));
    } else if (overlaps(r, from, to) && !r.cancelled) {
      out.push(r);
    }
  }
  return out.sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
}

// ── Anlegen ────────────────────────────────────────────────
export async function createAppointment(data: AppointmentInsert): Promise<Appointment> {
  const payload = { ...data, updated_at: nowISO() };
  const { data: row, error } = await supabase.from("appointments").insert(payload).select("*").single();
  if (error || !row) throw new Error(error?.message ?? "Termin konnte nicht angelegt werden.");
  return row as Appointment;
}

// ── Aktualisieren (mit Serien-Modus) ───────────────────────
export async function updateAppointment(id: string, data: Partial<AppointmentInsert>, editMode: SeriesEditMode): Promise<void> {
  const { parentId, occ } = parseInstanceId(id);
  const stamp = { updated_at: nowISO() };

  if (editMode === "all") {
    const { error } = await supabase.from("appointments").update({ ...data, ...stamp }).eq("id", parentId);
    if (error) throw new Error(error.message);
    return;
  }

  if (editMode === "this") {
    if (occ) {
      // Einzelnes Vorkommen abweichend → Ausnahme-Datensatz anlegen.
      const { error } = await supabase.from("appointments").insert({
        ...data,
        is_recurring: false,
        rrule: null,
        is_exception: true,
        recurrence_parent_id: parentId,
        exception_original_date: occ,
        updated_at: nowISO(),
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("appointments").update({ ...data, ...stamp }).eq("id", parentId);
      if (error) throw new Error(error.message);
    }
    return;
  }

  // this_and_future: alte Serie vor diesem Vorkommen beenden, neue Serie ab hier anlegen.
  const { data: parent, error: pe } = await supabase.from("appointments").select("*").eq("id", parentId).single();
  if (pe || !parent) throw new Error(pe?.message ?? "Serie nicht gefunden.");
  const p = parent as Appointment;
  const splitDate = occ ? new Date(occ) : new Date(p.start_datetime);
  const until = new Date(splitDate.getTime() - 1000);

  if (p.rrule) {
    const oldOpt = parseRRule(p.rrule);
    const truncated = buildRRule({ ...oldOpt, count: null, until });
    const { error } = await supabase.from("appointments")
      .update({ rrule: truncated, recurrence_count: null, recurrence_end_date: until.toISOString(), ...stamp })
      .eq("id", parentId);
    if (error) throw new Error(error.message);
  }

  const { error: ce } = await supabase.from("appointments").insert({
    hero_projektnummer: data.hero_projektnummer ?? p.hero_projektnummer,
    title: data.title ?? p.title,
    description: data.description ?? p.description,
    location: data.location ?? p.location,
    start_datetime: data.start_datetime ?? splitDate.toISOString(),
    end_datetime: data.end_datetime ?? new Date(splitDate.getTime() + (new Date(p.end_datetime).getTime() - new Date(p.start_datetime).getTime())).toISOString(),
    all_day: data.all_day ?? p.all_day,
    timezone: data.timezone ?? p.timezone,
    is_recurring: true,
    rrule: data.rrule ?? p.rrule,
    recurrence_end_date: data.recurrence_end_date ?? null,
    recurrence_count: data.recurrence_count ?? null,
    attendees: data.attendees ?? p.attendees,
    updated_at: nowISO(),
  });
  if (ce) throw new Error(ce.message);
}

// ── Löschen (mit Serien-Modus) ─────────────────────────────
export async function deleteAppointment(id: string, deleteMode: SeriesEditMode): Promise<void> {
  const { parentId, occ } = parseInstanceId(id);

  if (deleteMode === "all") {
    // Ausnahmen zuerst entfernen, dann die Serie/den Termin selbst.
    await supabase.from("appointments").delete().eq("recurrence_parent_id", parentId);
    const { error } = await supabase.from("appointments").delete().eq("id", parentId);
    if (error) throw new Error(error.message);
    return;
  }

  if (deleteMode === "this") {
    if (occ) {
      // Einzelnes Serien-Vorkommen absagen → Ausnahme mit cancelled=true.
      const { data: parent } = await supabase.from("appointments").select("*").eq("id", parentId).single();
      const p = parent as Appointment | null;
      const dur = p ? new Date(p.end_datetime).getTime() - new Date(p.start_datetime).getTime() : 0;
      const occDate = new Date(occ);
      const { error } = await supabase.from("appointments").insert({
        hero_projektnummer: p?.hero_projektnummer ?? null,
        title: p?.title ?? "Termin",
        start_datetime: occDate.toISOString(),
        end_datetime: new Date(occDate.getTime() + dur).toISOString(),
        is_exception: true,
        cancelled: true,
        recurrence_parent_id: parentId,
        exception_original_date: occ,
        updated_at: nowISO(),
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("appointments").delete().eq("id", parentId);
      if (error) throw new Error(error.message);
    }
    return;
  }

  // this_and_future: Serie vor diesem Vorkommen beenden.
  const { data: parent, error: pe } = await supabase.from("appointments").select("*").eq("id", parentId).single();
  if (pe || !parent) throw new Error(pe?.message ?? "Serie nicht gefunden.");
  const p = parent as Appointment;
  const splitDate = occ ? new Date(occ) : new Date(p.start_datetime);
  if (splitDate.getTime() <= new Date(p.start_datetime).getTime()) {
    // Ab dem Serienstart → komplette Serie löschen.
    await supabase.from("appointments").delete().eq("recurrence_parent_id", parentId);
    const { error } = await supabase.from("appointments").delete().eq("id", parentId);
    if (error) throw new Error(error.message);
    return;
  }
  const until = new Date(splitDate.getTime() - 1000);
  const oldOpt = p.rrule ? parseRRule(p.rrule) : null;
  const truncated = oldOpt ? buildRRule({ ...oldOpt, count: null, until }) : null;
  const { error } = await supabase.from("appointments")
    .update({ rrule: truncated, recurrence_count: null, recurrence_end_date: until.toISOString(), updated_at: nowISO() })
    .eq("id", parentId);
  if (error) throw new Error(error.message);
}
