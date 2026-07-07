// ============================================================
// B4Y SuperAPP – Cockpit (Leitstand) Datenlayer
// Firmenweite Kennzahlen für das Admin-Cockpit (/cockpit). Liest ausschließlich
// aus der eigenen Supabase-DB (RLS scoped automatisch auf die Organisation –
// current_org_id()). Keine externen Systeme. Aggregation client-seitig, ein
// gebündeltes Promise.all (Muster wie src/pages/Dashboard.tsx).
// ============================================================
import { supabase } from "./supabase";
import { stageTone } from "./types";
import { loadEvents, loadAbsences, empName, absenceLabel } from "./planning";

// ── Stammdaten-/Hilfstypen für die UI ──────────────────────
export type CockpitEmployee = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  active: boolean;
  auth_user_id: string | null;
  employment_type: string | null;
};
export type CockpitProject = { id: string; title: string; stage: string };
export type CockpitTask = {
  id: string;
  title: string;
  due_date: string | null;
  priority: string | null;
  project_id: string | null;
  assignee_id: string | null;
};
export type AutomationRunRow = {
  automation_name: string | null;
  status: string;
  created_at: string;
  dry_run: boolean | null;
};
// Anfragen-Posteingang (Cockpit-Panel "Anfragen", siehe AnfrageDetail.tsx
// und Migrationen 0117/0118). Bewusst minimal – die Detail-Sicht laedt das
// volle Schema. Wir bilden hier nur, was die Liste der letzten 5 anzeigt.
export type RecentAnfrage = {
  id: string;
  source: string;
  status: string;
  caller_name: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  subject: string | null;
  created_at: string;
};
export type AssignmentEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  status: string;
};
export type EmployeeAssignment = { employeeId: string; name: string; events: AssignmentEvent[] };
export type AbsenceToday = { employeeId: string | null; name: string; kind: string; label: string };

export type CockpitData = {
  // Umsatz / Finanzen
  revenue: number[]; // 12 Monatsbuckets (Netto, älteste → aktuelle)
  monthRevenue: number;
  prevRevenue: number;
  revTrend: number | null;
  invoicesOpenSum: number;
  invoicesOpenCount: number;
  invoicesOverdueSum: number;
  invoicesOverdueCount: number;
  // Angebote-Pipeline
  offersLive: number;
  offerDraftN: number;
  offerDraftSum: number;
  offerDoneN: number;
  offerDoneSum: number;
  offerSentN: number;
  offerSentSum: number;
  offerAcceptedN: number;
  offerAcceptedSum: number;
  // Projekte
  projectsActive: number;
  projectsRunning: number;
  projectsThisWeek: number;
  projectsOverdue: number;
  // Mitarbeiter-Einteilung
  employeesActive: number;
  onSiteToday: number;
  assignmentsToday: EmployeeAssignment[];
  unassignedToday: AssignmentEvent[];
  absencesToday: AbsenceToday[];
  // Kommunikation / Delegation
  voiceWeek: number;
  voiceProducedRate: number | null;
  voiceErrors: number;
  draftsOpen: number;
  // Aufgaben
  tasksOpen: number;
  tasksOverdue: number;
  taskList: CockpitTask[];
  // Automationen
  automationsActive: number;
  automationsTotal: number;
  automationRuns: AutomationRunRow[];
  // Anfragen-Posteingang
  requestsNewToday: number;
  requestsOpen: number;
  recentRequests: RecentAnfrage[];
  // Stammdaten für Formulare / Namensauflösung
  employees: CockpitEmployee[];
  projects: CockpitProject[];
  // Diagnose: Bereiche, deren Daten nicht geladen werden konnten
  errors: string[];
};

// ── Hilfen ─────────────────────────────────────────────────
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Montag = 0
  x.setDate(x.getDate() - day);
  return x;
}
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type InvRow = {
  net: number | null;
  gross: number | null;
  invoice_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  locked: boolean | null;
  payment_status: string | null;
  doc_status: string | null;
};
type OfferRow = {
  status: string | null;
  net: number | null;
  gross: number | null;
  created_at: string | null;
  sent_at: string | null;
  deleted_at: string | null;
};
type ProjRow = {
  id: string;
  title: string;
  stage: string;
  archived: boolean;
  created_at: string | null;
  end_date: string | null;
};
type VoiceRow = { produced_offer: boolean | null; error_message: string | null; created_at: string | null };

// Letzte 12 Monatsbuckets, summiert Rechnungs-Netto pro Monat (Storno ausgenommen).
function buildRevenue(rows: InvRow[]): number[] {
  const now = new Date();
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { y: d.getFullYear(), m: d.getMonth(), sum: 0 };
  });
  for (const r of rows) {
    // Nur tatsächlich verrechnete Rechnungen: Entwürfe und nicht finalisierte (locked=false) ausschließen.
    if (!r.invoice_date || r.doc_status === "storniert" || r.doc_status === "entwurf" || r.locked === false) continue;
    const d = new Date(r.invoice_date);
    const b = buckets.find((x) => x.y === d.getFullYear() && x.m === d.getMonth());
    if (b) b.sum += Number(r.net || 0);
  }
  return buckets.map((b) => b.sum);
}

export const EMPTY_COCKPIT: CockpitData = {
  revenue: [], monthRevenue: 0, prevRevenue: 0, revTrend: null,
  invoicesOpenSum: 0, invoicesOpenCount: 0, invoicesOverdueSum: 0, invoicesOverdueCount: 0,
  offersLive: 0, offerDraftN: 0, offerDraftSum: 0, offerDoneN: 0, offerDoneSum: 0, offerSentN: 0, offerSentSum: 0, offerAcceptedN: 0, offerAcceptedSum: 0,
  projectsActive: 0, projectsRunning: 0, projectsThisWeek: 0, projectsOverdue: 0,
  employeesActive: 0, onSiteToday: 0, assignmentsToday: [], unassignedToday: [], absencesToday: [],
  voiceWeek: 0, voiceProducedRate: null, voiceErrors: 0, draftsOpen: 0,
  tasksOpen: 0, tasksOverdue: 0, taskList: [],
  automationsActive: 0, automationsTotal: 0, automationRuns: [],
  requestsNewToday: 0, requestsOpen: 0, recentRequests: [],
  employees: [], projects: [], errors: [],
};

// ── Laden ──────────────────────────────────────────────────
export async function loadCockpit(): Promise<CockpitData> {
  const errors: string[] = [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const weekStart = startOfWeek(now);
  const todayStr = ymd(todayStart);

  const [
    invRes, offRes, projRes, empRes, voiceRes, autoRes, runRes,
    taskOpenRes, taskOverdueRes, taskListRes, invDraftRes,
    reqNewTodayRes, reqOpenRes, reqRecentRes,
  ] = await Promise.all([
    supabase.from("invoices").select("net,gross,invoice_date,due_date,paid_at,locked,payment_status,doc_status"),
    supabase.from("offers").select("status,net,gross,created_at,sent_at,deleted_at"),
    supabase.from("projects").select("id,title,stage,archived,created_at,end_date"),
    supabase.from("employees").select("id,first_name,last_name,active,auth_user_id,employment_type").order("last_name").order("first_name"),
    supabase.from("voice_transcripts").select("produced_offer,error_message,created_at").gte("created_at", weekStart.toISOString()),
    supabase.from("automations").select("id,active"),
    supabase.from("automation_runs").select("automation_name,status,created_at,dry_run").order("created_at", { ascending: false }).limit(8),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("done", false),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("done", false).lt("due_date", todayStr),
    supabase.from("tasks").select("id,title,due_date,priority,project_id,assignee_id").eq("done", false)
      .order("due_date", { ascending: true, nullsFirst: false }).limit(8),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("doc_status", "entwurf"),
    // ── Anfragen (Posteingang, siehe Migration 0117) ──
    // "Neu heute": ab Tagesbeginn eingegangen (alle Quellen + alle Status,
    // damit auch Spam/Fehlanruf in der Zahl mitwirkt – Filter erfolgt im Detail).
    supabase.from("anfragen").select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString()),
    // "Unbearbeitet": noch nicht in einem Endzustand.
    supabase.from("anfragen").select("id", { count: "exact", head: true })
      .in("status", ["neu", "in_arbeit", "qualifiziert"]),
    // Letzte 5 fuer die Cockpit-Liste.
    supabase.from("anfragen")
      .select("id,source,status,caller_name,caller_phone,caller_email,subject,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // ── Finanzen ──
  if (invRes.error) errors.push("Rechnungen");
  const inv = (invRes.data as InvRow[]) ?? [];
  const revenue = buildRevenue(inv);
  const monthRevenue = revenue.length ? revenue[revenue.length - 1] : 0;
  const prevRevenue = revenue.length > 1 ? revenue[revenue.length - 2] : 0;
  const revTrend = prevRevenue > 0 ? Math.round(((monthRevenue - prevRevenue) / prevRevenue) * 100) : null;
  // Offene Forderungen = finalisiert (locked), nicht storniert, nicht bezahlt.
  // locked entspricht der kanonischen App-Definition (vgl. Dashboard.tsx / Doku-View Migr. 0044).
  const openInv = inv.filter(
    (i) => !!i.locked && i.doc_status !== "storniert" && i.payment_status !== "bezahlt",
  );
  const invoicesOpenSum = openInv.reduce((s, i) => s + Number(i.gross || 0), 0);
  const overdueInv = openInv.filter((i) => i.due_date && new Date(i.due_date) < todayStart);
  const invoicesOverdueSum = overdueInv.reduce((s, i) => s + Number(i.gross || 0), 0);

  // ── Angebote-Pipeline ──
  if (offRes.error) errors.push("Angebote");
  const offersLiveRows = ((offRes.data as OfferRow[]) ?? []).filter((o) => !o.deleted_at);
  const sumGross = (rows: OfferRow[]) => rows.reduce((s, o) => s + Number(o.gross || 0), 0);
  const oDraft = offersLiveRows.filter((o) => o.status === "entwurf");
  const oDone = offersLiveRows.filter((o) => o.status === "abgeschlossen"); // fertig kalkuliert, Versand offen
  const oSent = offersLiveRows.filter((o) => o.status === "versendet");
  const oAcc = offersLiveRows.filter((o) => o.status === "angenommen");

  // ── Projekte ──
  if (projRes.error) errors.push("Projekte");
  const projects = (projRes.data as ProjRow[]) ?? [];
  const activeProjects = projects.filter((p) => !p.archived);
  const isRunning = (s: string) => {
    const t = stageTone(s);
    return t !== "green" && t !== "red";
  };

  // ── Mitarbeiter ──
  if (empRes.error) errors.push("Mitarbeiter");
  const employees = (empRes.data as CockpitEmployee[]) ?? [];
  const nameById = new Map(employees.map((e) => [e.id, empName(e)]));

  // ── Kommunikation / Delegation ──
  if (voiceRes.error) errors.push("Sprachaufnahmen");
  const voiceWeekRows = (voiceRes.data as VoiceRow[]) ?? []; // serverseitig bereits auf die Woche gefiltert
  const voiceProduced = voiceWeekRows.filter((v) => v.produced_offer).length;
  const draftsOpen = oDraft.length + (invDraftRes.count ?? 0);

  // ── Automationen ──
  const autos = (autoRes.data as { id: string; active: boolean }[]) ?? [];

  // ── Heutige Einsätze (Planung) – best-effort ──
  let assignmentsToday: EmployeeAssignment[] = [];
  const unassignedToday: AssignmentEvent[] = [];
  let onSiteToday = 0;
  try {
    const events = await loadEvents(todayStart.toISOString(), todayEnd.toISOString());
    const map = new Map<string, AssignmentEvent[]>();
    for (const ev of events) {
      const ae: AssignmentEvent = {
        id: ev.id, title: ev.title, start_at: ev.start_at, end_at: ev.end_at,
        all_day: ev.all_day, location: ev.location, status: ev.status,
      };
      if (!ev.employee_ids.length) { unassignedToday.push(ae); continue; }
      for (const eid of ev.employee_ids) {
        if (!map.has(eid)) map.set(eid, []);
        map.get(eid)!.push(ae);
      }
    }
    onSiteToday = map.size;
    assignmentsToday = Array.from(map.entries())
      .map(([employeeId, evs]) => ({
        employeeId,
        name: nameById.get(employeeId) ?? "—",
        events: evs.sort((a, b) => a.start_at.localeCompare(b.start_at)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    errors.push("Einteilung");
  }

  // ── Heutige Abwesenheiten – best-effort ──
  let absencesToday: AbsenceToday[] = [];
  try {
    const abs = await loadAbsences(todayStr, todayStr);
    absencesToday = abs.map((a) => ({
      employeeId: a.employee_id,
      name: a.employee_id ? (nameById.get(a.employee_id) ?? "—") : "—",
      kind: a.kind,
      label: absenceLabel(a.kind),
    }));
  } catch {
    errors.push("Abwesenheiten");
  }

  // ── Anfragen-Posteingang (Phase 1 – Live ab Migration 0117) ──
  if (reqNewTodayRes.error || reqOpenRes.error || reqRecentRes.error) errors.push("Anfragen");

  return {
    revenue, monthRevenue, prevRevenue, revTrend,
    invoicesOpenSum, invoicesOpenCount: openInv.length,
    invoicesOverdueSum, invoicesOverdueCount: overdueInv.length,
    // "in Pipeline" = Summe der dargestellten Stufen (terminale Status abgelehnt/storniert/in_auftrag_uebernommen zählen nicht mit).
    offersLive: oDraft.length + oDone.length + oSent.length + oAcc.length,
    offerDraftN: oDraft.length, offerDraftSum: sumGross(oDraft),
    offerDoneN: oDone.length, offerDoneSum: sumGross(oDone),
    offerSentN: oSent.length, offerSentSum: sumGross(oSent),
    offerAcceptedN: oAcc.length, offerAcceptedSum: sumGross(oAcc),
    projectsActive: activeProjects.length,
    projectsRunning: activeProjects.filter((p) => isRunning(p.stage)).length,
    projectsThisWeek: activeProjects.filter((p) => p.created_at && new Date(p.created_at) >= weekStart).length,
    projectsOverdue: activeProjects.filter((p) => p.end_date && new Date(p.end_date) < todayStart).length,
    employeesActive: employees.filter((e) => e.active).length,
    onSiteToday, assignmentsToday, unassignedToday, absencesToday,
    voiceWeek: voiceWeekRows.length,
    voiceProducedRate: voiceWeekRows.length ? Math.round((voiceProduced / voiceWeekRows.length) * 100) : null,
    voiceErrors: voiceWeekRows.filter((v) => v.error_message).length,
    draftsOpen,
    tasksOpen: taskOpenRes.count ?? 0,
    tasksOverdue: taskOverdueRes.count ?? 0,
    taskList: (taskListRes.data as CockpitTask[]) ?? [],
    automationsActive: autos.filter((a) => a.active).length,
    automationsTotal: autos.length,
    automationRuns: (runRes.data as AutomationRunRow[]) ?? [],
    requestsNewToday: reqNewTodayRes.count ?? 0,
    requestsOpen: reqOpenRes.count ?? 0,
    recentRequests: (reqRecentRes.data as RecentAnfrage[]) ?? [],
    employees,
    projects: activeProjects
      .map((p) => ({ id: p.id, title: p.title, stage: p.stage }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    errors,
  };
}

// ── Schnell-Aufgabe anlegen (projektbezogen, wie automations.ts/project-meetings.ts) ──
export async function createCockpitTask(input: {
  projectId: string;
  title: string;
  assigneeAuthId?: string | null; // employees.auth_user_id
  dueDate?: string | null;
  priority?: string;
}): Promise<{ error?: string }> {
  const row: Record<string, unknown> = {
    project_id: input.projectId,
    title: input.title.trim(),
    done: false,
    source_type: "cockpit",
    priority: input.priority || "Normal",
  };
  if (input.assigneeAuthId) row.assignee_id = input.assigneeAuthId;
  if (input.dueDate) row.due_date = input.dueDate;
  const { error } = await supabase.from("tasks").insert(row);
  return { error: error?.message };
}
