// ============================================================
// B4Y SuperAPP – Automationen-Engine (generisch, mandantenfähig, erweiterbar)
// Regeln (Tabelle public.automations) reagieren auf Ereignisse (Trigger), prüfen
// Bedingungen und führen eine Liste von Aktionen aus. Mandantentrennung über RLS
// (organization_id). Keine BAU4YOU-Hardcodierung – Status/Texte/Empfänger konfigurierbar.
//
// Grundsätze:
//  - best-effort: eine fehlschlagende Aktion blockiert weder die anderen noch den
//    auslösenden Vorgang (Statuswechsel / Projektanlage).
//  - nachvollziehbar: jeder Lauf wird in automation_runs protokolliert + Projekt-Logbuch.
//  - kein Endlos-Loop: die Engine ändert NIE den Projektstatus -> keine Re-Trigger-Kette.
//  - Testmodus (dryRun): zeigt nur, was passieren WÜRDE, ohne etwas zu schreiben.
//  - E-Mail-VERSAND ist bewusst nicht aktiv (kein Mailgateway) -> nur Entwurf/Vermerk.
// ============================================================
import { supabase } from "./supabase";
import { logProject } from "./projectlog";
import { applyTemplate, type MailContextData } from "./mail-templates";
import { contactDisplayName } from "./contact-name";

// ---------- Typen ----------
export type TriggerType =
  | "project.created"
  | "project.status_changed";
// erweiterbar: "document.created" | "document.finalized" | "invoice.overdue" | "task.overdue" | "appointment.created"

export type TriggerConfig = {
  fromStage?: string | null; // nur bei status_changed: alter Status (optional)
  toStage?: string | null; // Ziel-/Auslöse-Status (optional = jeder Status)
  category?: string | null; // optional: nur diese Projektart
};

export type ConditionType = "project_active" | "not_archived" | "category_in" | "responsible_is";
export type Condition =
  | { type: "project_active" }
  | { type: "not_archived" }
  | { type: "category_in"; values: string[] }
  | { type: "responsible_is"; value: string };

export type AssigneeKind = "none" | "employee" | "role" | "project_responsible";
export type DueKind =
  | "immediate"
  | "today"
  | "tomorrow"
  | "in_days"
  | "in_workdays"
  | "after_change_days";
export type TaskPriority = "Niedrig" | "Normal" | "Hoch" | "Kritisch";
export type TaskDedupe = "every" | "once_project" | "once_status" | "skip_if_open";
export type EmailRecipientKind = "customer" | "contact" | "employee" | "role" | "custom";

export type ActionType =
  | "create_task"
  | "create_email_draft"
  | "create_notification"
  | "create_checklist"
  | "create_appointment"
  | "log";

export type AutoAction =
  | {
      type: "create_task";
      enabled?: boolean;
      title: string;
      description?: string | null;
      assigneeKind?: AssigneeKind;
      assigneeId?: string | null; // employees.id (bei assigneeKind=employee)
      role?: string | null; // Rollen-/Team-Bezeichnung (bei assigneeKind=role)
      board?: string | null;
      bucket?: string | null;
      priority?: TaskPriority;
      category?: string | null;
      dueKind?: DueKind;
      dueValue?: number | null;
      dedupe?: TaskDedupe;
    }
  | {
      type: "create_email_draft";
      enabled?: boolean;
      recipientKind?: EmailRecipientKind;
      recipientCustom?: string | null;
      templateId?: string | null;
      note?: string | null;
    }
  | { type: "create_notification"; enabled?: boolean; text: string; role?: string | null }
  | { type: "create_checklist"; enabled?: boolean; name: string; items?: string[] }
  | {
      type: "create_appointment";
      enabled?: boolean;
      title: string;
      kind?: string | null;
      dateKind?: "today" | "tomorrow" | "in_days";
      dateValue?: number | null;
      time?: string | null;
      location?: string | null;
    }
  | { type: "log"; enabled?: boolean; text: string };

export type Automation = {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: TriggerType;
  trigger_stage?: string | null; // Kompatibilität: Auslöse-Status (== trigger_config.toStage)
  trigger_config?: TriggerConfig | null;
  conditions?: Condition[] | null;
  category?: string | null;
  actions: AutoAction[];
  active: boolean;
  sort_order?: number | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ActionResult = { type: ActionType; ok: boolean; info?: string };

export type AutomationEvent = {
  type: TriggerType;
  projectId: string;
  oldStage?: string | null;
  newStage?: string | null;
  createdBy?: string | null;
  dryRun?: boolean;
};

export type RunSummary = {
  automationId: string;
  automationName: string;
  status: "ok" | "partial" | "error";
  results: ActionResult[];
};

// ---------- Helfer ----------
const round = (n: number) => Math.round(Number(n) || 0);
const todayIso = () => new Date().toISOString().slice(0, 10);

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}
function isoPlusWorkdays(days: number): string {
  const d = new Date();
  let added = 0;
  const target = round(days);
  while (added < target) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay(); // 0 So, 6 Sa
    if (wd !== 0 && wd !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

type Ctx = {
  project: any;
  contactName: string;
  contactEmail: string | null;
  responsible: string | null;
  employees: { id: string; auth_user_id: string | null; name: string; position: string | null }[];
  oldStage?: string | null;
  newStage?: string | null;
  placeholders: MailContextData;
};

async function buildContext(ev: AutomationEvent): Promise<Ctx | null> {
  const { data: p } = await supabase.from("projects").select("*").eq("id", ev.projectId).maybeSingle();
  if (!p) return null;
  const project = p as any;

  let contactName = "";
  let contactEmail: string | null = null;
  if (project.contact_id) {
    const { data: c } = await supabase
      .from("contacts").select("company, first_name, last_name, email, customer_type, salutation, title")
      .eq("id", project.contact_id).maybeSingle();
    if (c) {
      const cc = c as any;
      contactName = contactDisplayName(cc, { fallback: "" });
      contactEmail = cc.email ?? null;
    }
  }
  const { data: emps } = await supabase
    .from("employees").select("id, auth_user_id, first_name, last_name, position").eq("active", true);
  const employees = ((emps as any[]) ?? []).map((e) => ({
    id: e.id, auth_user_id: e.auth_user_id ?? null,
    name: [e.first_name, e.last_name].filter(Boolean).join(" ") || "Mitarbeiter",
    position: e.position ?? null,
  }));

  const placeholders: MailContextData = {
    "Project.title": project.title ?? "",
    "Project.number": project.project_number ?? "",
    "Project.stage": ev.newStage ?? project.stage ?? "",
    "Project.responsible": project.responsible ?? "",
    "Customer.name": contactName,
    "Status.old": ev.oldStage ?? "",
    "Status.new": ev.newStage ?? project.stage ?? "",
    "Date.today": todayIso(),
  };

  return {
    project, contactName, contactEmail, responsible: project.responsible ?? null,
    employees, oldStage: ev.oldStage, newStage: ev.newStage, placeholders,
  };
}

// ---------- Trigger-Matching ----------
function ruleMatches(a: Automation, ev: AutomationEvent): boolean {
  const tt = a.trigger_type || "project.status_changed";
  if (tt !== ev.type) return false;
  const cfg = a.trigger_config || {};
  const toStage = cfg.toStage ?? a.trigger_stage ?? null; // Kompatibilität zu Alt-Regeln
  if (ev.type === "project.created") {
    // optionaler Startstatus: leer = beliebiger Startstatus
    if (toStage && toStage !== ev.newStage) return false;
    return true;
  }
  // project.status_changed
  const fromStage = cfg.fromStage ?? null;
  if (toStage && toStage !== ev.newStage) return false;
  if (fromStage && fromStage !== ev.oldStage) return false;
  return true;
}

// ---------- Bedingungen ----------
function conditionsPass(a: Automation, ctx: Ctx): boolean {
  const conds = Array.isArray(a.conditions) ? a.conditions : [];
  // Auslöser-Projektart (trigger_config.category) zählt zusätzlich als Bedingung
  const cfgCat = a.trigger_config?.category;
  if (cfgCat && ctx.project.category !== cfgCat) return false;
  for (const c of conds) {
    if (c.type === "project_active" || c.type === "not_archived") {
      if (ctx.project.archived) return false;
    } else if (c.type === "category_in") {
      if (!Array.isArray(c.values) || !c.values.includes(ctx.project.category)) return false;
    } else if (c.type === "responsible_is") {
      if ((ctx.project.responsible ?? "") !== c.value) return false;
    }
  }
  return true;
}

// ---------- Fälligkeit / Zuständigkeit ----------
function resolveDue(a: Extract<AutoAction, { type: "create_task" }>): string | null {
  switch (a.dueKind) {
    case "today": return todayIso();
    case "tomorrow": return isoPlusDays(1);
    case "in_days": return isoPlusDays(a.dueValue ?? 0);
    case "in_workdays": return isoPlusWorkdays(a.dueValue ?? 0);
    case "after_change_days": return isoPlusDays(a.dueValue ?? 0);
    case "immediate": return todayIso();
    default: return null;
  }
}
function resolveAssignee(a: Extract<AutoAction, { type: "create_task" }>, ctx: Ctx): { assigneeId: string | null; label: string | null } {
  if (a.assigneeKind === "employee" && a.assigneeId) {
    const e = ctx.employees.find((x) => x.id === a.assigneeId);
    return { assigneeId: e?.auth_user_id ?? null, label: e?.name ?? null };
  }
  if (a.assigneeKind === "role" && a.role) return { assigneeId: null, label: `Rolle: ${a.role}` };
  if (a.assigneeKind === "project_responsible") return { assigneeId: null, label: ctx.responsible ? `Zuständig: ${ctx.responsible}` : null };
  return { assigneeId: null, label: null };
}

// ---------- Dedupe für Aufgaben ----------
async function taskDedupeAllows(
  a: Extract<AutoAction, { type: "create_task" }>,
  ctx: Ctx, automationId: string, title: string,
): Promise<boolean> {
  const mode = a.dedupe ?? "every";
  if (mode === "every") return true;
  if (mode === "skip_if_open") {
    const { data } = await supabase.from("tasks").select("id")
      .eq("project_id", ctx.project.id).eq("title", title).eq("done", false).limit(1);
    return !((data as any[])?.length);
  }
  if (mode === "once_project") {
    const { data } = await supabase.from("tasks").select("id")
      .eq("project_id", ctx.project.id).eq("title", title).eq("source_type", "automation").limit(1);
    return !((data as any[])?.length);
  }
  if (mode === "once_status") {
    // schon erfolgreich für dieses Projekt + diesen Status durch DIESE Automation gelaufen?
    const { data } = await supabase.from("automation_runs").select("id")
      .eq("automation_id", automationId).eq("project_id", ctx.project.id)
      .eq("new_stage", ctx.newStage ?? "").eq("dry_run", false).limit(1);
    return !((data as any[])?.length);
  }
  return true;
}

// ---------- Eine Aktion ausführen (oder simulieren) ----------
async function runAction(action: AutoAction, ctx: Ctx, automationId: string, dryRun: boolean): Promise<ActionResult> {
  if (action.enabled === false) return { type: action.type, ok: true, info: "deaktiviert – übersprungen" };
  try {
    switch (action.type) {
      case "create_task": {
        const title = applyTemplate(action.title || "", ctx.placeholders).trim();
        if (!title) return { type: "create_task", ok: false, info: "Kein Titel" };
        const allowed = await taskDedupeAllows(action, ctx, automationId, title);
        if (!allowed) return { type: "create_task", ok: true, info: `Übersprungen (Dedupe: ${action.dedupe})` };
        const { assigneeId, label } = resolveAssignee(action, ctx);
        const due = resolveDue(action);
        const descParts = [
          applyTemplate(action.description || "", ctx.placeholders).trim(),
          label ? `Zuständig: ${label.replace(/^Zuständig: |^Rolle: /, "")}` : "",
          "Automatisch erstellt durch Automation.",
        ].filter(Boolean);
        if (dryRun) return { type: "create_task", ok: true, info: `Aufgabe „${title}"${due ? ` (fällig ${due})` : ""}${label ? `, ${label}` : ""}` };
        const row: Record<string, any> = {
          project_id: ctx.project.id, title, description: descParts.join("\n"),
          done: false, source_type: "automation",
          priority: action.priority ?? "Normal",
        };
        if (action.board) row.board = action.board;
        if (action.bucket) row.bucket = action.bucket;
        if (assigneeId) row.assignee_id = assigneeId;
        if (due) row.due_date = due;
        const { error } = await supabase.from("tasks").insert(row);
        if (error) return { type: "create_task", ok: false, info: error.message };
        return { type: "create_task", ok: true, info: `Aufgabe „${title}"${label ? `, ${label}` : ""}` };
      }

      case "create_email_draft": {
        // VERSAND BEWUSST NICHT AKTIV (kein Mailgateway). Nur Entwurf-Vermerk.
        let subject = "";
        if (action.templateId) {
          const { data: t } = await supabase.from("mail_templates").select("subject").eq("id", action.templateId).maybeSingle();
          if (t) subject = applyTemplate((t as any).subject || "", ctx.placeholders);
        }
        const rcpt = action.recipientKind === "customer" ? (ctx.contactName || "Kunde")
          : action.recipientKind === "custom" ? (action.recipientCustom || "freie Adresse")
          : action.recipientKind ?? "Empfänger";
        const info = `Mail-Entwurf für ${rcpt}${subject ? `: „${subject}"` : ""} (Versand nicht aktiv)`;
        if (dryRun) return { type: "create_email_draft", ok: true, info };
        await logProject(ctx.project.id, "automation", info);
        return { type: "create_email_draft", ok: true, info };
      }

      case "create_notification": {
        const text = applyTemplate(action.text || "", ctx.placeholders).trim();
        if (!text) return { type: "create_notification", ok: false, info: "Kein Text" };
        const info = `Benachrichtigung${action.role ? ` an ${action.role}` : ""}: ${text}`;
        if (dryRun) return { type: "create_notification", ok: true, info };
        await logProject(ctx.project.id, "automation", info);
        return { type: "create_notification", ok: true, info };
      }

      case "create_checklist": {
        const name = applyTemplate(action.name || "", ctx.placeholders).trim();
        if (!name) return { type: "create_checklist", ok: false, info: "Kein Name" };
        const items = (action.items ?? []).map((x) => applyTemplate(x, ctx.placeholders).trim()).filter(Boolean);
        if (dryRun) return { type: "create_checklist", ok: true, info: `Checkliste „${name}" (${items.length} Punkte)` };
        const { data: cl, error } = await supabase.from("project_checklists")
          .insert({ project_id: ctx.project.id, name, sort_order: 0 }).select("id").single();
        if (error || !cl) return { type: "create_checklist", ok: false, info: error?.message || "Checkliste fehlgeschlagen" };
        if (items.length) {
          const rows = items.map((label, i) => ({ checklist_id: (cl as any).id, label, done: false, sort_order: i }));
          await supabase.from("project_checklist_items").insert(rows);
        }
        return { type: "create_checklist", ok: true, info: `Checkliste „${name}" (${items.length} Punkte)` };
      }

      case "create_appointment": {
        const title = applyTemplate(action.title || "", ctx.placeholders).trim();
        if (!title) return { type: "create_appointment", ok: false, info: "Kein Titel" };
        const date = action.dateKind === "tomorrow" ? isoPlusDays(1)
          : action.dateKind === "in_days" ? isoPlusDays(action.dateValue ?? 0)
          : todayIso();
        if (dryRun) return { type: "create_appointment", ok: true, info: `Termin „${title}" am ${date}` };
        const { error } = await supabase.from("project_appointments").insert({
          project_id: ctx.project.id, title, kind: action.kind || "Termin",
          date, time: action.time || null, location: action.location || null,
          status: "geplant", reminder: false,
        });
        if (error) return { type: "create_appointment", ok: false, info: error.message };
        return { type: "create_appointment", ok: true, info: `Termin „${title}" am ${date}` };
      }

      case "log": {
        const text = applyTemplate(action.text || "", ctx.placeholders).trim();
        if (!text) return { type: "log", ok: false, info: "Kein Text" };
        if (dryRun) return { type: "log", ok: true, info: text };
        await logProject(ctx.project.id, "automation", text);
        return { type: "log", ok: true, info: text };
      }

      default:
        return { type: (action as any).type, ok: false, info: "Unbekannter Aktionstyp" };
    }
  } catch (e: any) {
    return { type: (action as any).type, ok: false, info: e?.message || "Fehler" };
  }
}

// ---------- Hauptlauf ----------
async function loadMatchingRules(ev: AutomationEvent): Promise<Automation[]> {
  const { data, error } = await supabase
    .from("automations")
    .select("id, name, description, trigger_type, trigger_stage, trigger_config, conditions, category, actions, active, sort_order")
    .eq("active", true)
    .order("sort_order");
  if (error || !data) return [];
  return (data as unknown as Automation[]).filter((a) => ruleMatches(a, ev));
}

/**
 * Zentrale Ausführung für ein Ereignis. dryRun=true simuliert nur (kein Schreiben).
 * Liefert je Regel eine Zusammenfassung (für Testmodus-Anzeige).
 */
export async function runAutomations(ev: AutomationEvent): Promise<RunSummary[]> {
  const summaries: RunSummary[] = [];
  try {
    const rules = await loadMatchingRules(ev);
    if (!rules.length) return summaries;
    const ctx = await buildContext(ev);
    if (!ctx) return summaries;

    for (const a of rules) {
      if (!conditionsPass(a, ctx)) continue;
      const actions = Array.isArray(a.actions) ? a.actions : [];
      if (!actions.length) continue;

      const results: ActionResult[] = [];
      for (const act of actions) results.push(await runAction(act, ctx, a.id, !!ev.dryRun));

      const okCount = results.filter((r) => r.ok).length;
      const status: RunSummary["status"] =
        okCount === results.length ? "ok" : okCount === 0 ? "error" : "partial";
      summaries.push({ automationId: a.id, automationName: a.name, status, results });

      if (!ev.dryRun) {
        try {
          await supabase.from("automation_runs").insert({
            automation_id: a.id, automation_name: a.name, project_id: ctx.project.id,
            trigger_type: ev.type, trigger_stage: ev.newStage ?? null,
            old_stage: ev.oldStage ?? null, new_stage: ev.newStage ?? null,
            status, result: results, dry_run: false,
          });
        } catch { /* Protokoll darf nie blockieren */ }
        // Nachvollziehbare Zusammenfassung ins Projekt-Logbuch
        const created = results.filter((r) => r.ok && !String(r.info).startsWith("Übersprungen") && r.info !== "deaktiviert – übersprungen");
        if (created.length) {
          await logProject(ctx.project.id, "automation",
            `Automation „${a.name}" ausgeführt: ${created.map((r) => r.info).join("; ")}`);
        }
      }
    }
  } catch { /* Engine ist best-effort */ }
  return summaries;
}

// ---------- Öffentliche Komfort-Funktionen ----------
/** Statuswechsel eines Projekts. Aufruf in ProjectDetail.changeStage. */
export async function runStageAutomations(opts: {
  projectId: string; stage: string; oldStage?: string | null; createdBy?: string | null;
}): Promise<void> {
  await runAutomations({
    type: "project.status_changed",
    projectId: opts.projectId, newStage: opts.stage, oldStage: opts.oldStage ?? null,
    createdBy: opts.createdBy ?? null,
  });
}

/** Projektanlage. Aufruf in ProjectForm nach erfolgreichem Insert. */
export async function runProjectCreatedAutomations(opts: {
  projectId: string; stage?: string | null; createdBy?: string | null;
}): Promise<void> {
  await runAutomations({
    type: "project.created",
    projectId: opts.projectId, newStage: opts.stage ?? null, createdBy: opts.createdBy ?? null,
  });
}

/** Testmodus: simuliert ein Ereignis und liefert die geplanten Aktionen (kein Schreiben). */
export async function simulateAutomations(ev: Omit<AutomationEvent, "dryRun">): Promise<RunSummary[]> {
  return runAutomations({ ...ev, dryRun: true });
}
