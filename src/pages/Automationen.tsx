// ============================================================
// B4Y SuperAPP – Automationen-Modul
// Tab-Struktur (erweiterbar): Projektstatus (Phase 1, funktional), weitere Trigger-Arten
// als vorbereitete Platzhalter, Protokoll (Ausführungsverlauf aus automation_runs).
// Regeln: Tabelle public.automations (RLS Modul 'automations', mandantengetrennt).
// Engine: src/lib/automations.ts. Keine BAU4YOU-Hardcodierung.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Power, Zap, X, ArrowUp, ArrowDown, FlaskConical } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "../components/ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "../components/calc-ui";
import { useCan } from "../lib/permissions";
import { useProjectConfig, FALLBACK_STATUSES } from "../lib/project-config";
import { toast, toastError } from "../lib/toast";
import { simulateAutomations } from "../lib/automations";
import type { AutoAction, ActionType, Automation, Condition, TriggerType } from "../lib/automations";

// ---------- Konstanten ----------
const TABS: { key: string; label: string; ready: boolean }[] = [
  { key: "projektstatus", label: "Projektstatus", ready: true },
  { key: "dokumente", label: "Dokumente", ready: false },
  { key: "aufgaben", label: "Aufgaben", ready: false },
  { key: "termine", label: "Termine", ready: false },
  { key: "email", label: "E-Mail", ready: false },
  { key: "rechnungen", label: "Rechnungen & Mahnungen", ready: false },
  { key: "subunternehmer", label: "Subunternehmer", ready: false },
  { key: "protokoll", label: "Protokoll", ready: true },
];

const TRIGGER_TYPES: { v: TriggerType; l: string }[] = [
  { v: "project.status_changed", l: "Projektstatus wird geändert" },
  { v: "project.created", l: "Projekt wird neu angelegt" },
];

const ACTION_LABEL: Record<ActionType, string> = {
  create_task: "Aufgabe erstellen",
  create_email_draft: "E-Mail-Entwurf vorbereiten",
  create_notification: "Interne Benachrichtigung",
  create_checklist: "Checkliste erstellen",
  create_appointment: "Termin erstellen",
  log: "Logbuch-Eintrag",
};
const PRIORITIES = ["Niedrig", "Normal", "Hoch", "Kritisch"];
const ASSIGNEE_KINDS = [
  { v: "none", l: "– niemand –" },
  { v: "employee", l: "Konkreter Mitarbeiter" },
  { v: "role", l: "Rolle / Team" },
  { v: "project_responsible", l: "Zuständiger im Projekt" },
];
const DUE_KINDS = [
  { v: "", l: "ohne Frist" },
  { v: "immediate", l: "sofort / heute" },
  { v: "tomorrow", l: "morgen" },
  { v: "in_days", l: "in X Tagen" },
  { v: "in_workdays", l: "in X Werktagen" },
  { v: "after_change_days", l: "X Tage nach Auslöser" },
];
const DEDUPE = [
  { v: "every", l: "bei jedem Auslöser neu" },
  { v: "once_project", l: "nur einmal pro Projekt" },
  { v: "once_status", l: "nur einmal pro Status" },
  { v: "skip_if_open", l: "nicht doppelt, wenn offen vorhanden" },
];
const EMAIL_RECIPIENTS = [
  { v: "customer", l: "Kunde" },
  { v: "contact", l: "Ansprechpartner" },
  { v: "employee", l: "interner Mitarbeiter" },
  { v: "role", l: "Rolle" },
  { v: "custom", l: "freie E-Mail-Adresse" },
];

export default function Automationen() {
  const [tab, setTab] = useState("projektstatus");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Zap size={20} /> Automationen</h1>
        <p className="text-sm text-slate-500">Wiederkehrende Abläufe automatisch auslösen – konfigurierbar, protokolliert, deaktivierbar.</p>
      </div>

      {/* Tab-Navigation */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-white/10">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative -mb-px rounded-t-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}>
            {t.label}{!t.ready && <span className="ml-1 text-[10px] text-slate-400">•</span>}
          </button>
        ))}
      </div>

      {tab === "projektstatus" && <ProjectStatusTab />}
      {tab === "protokoll" && <ProtocolTab />}
      {!["projektstatus", "protokoll"].includes(tab) && (
        <PlaceholderTab label={TABS.find((t) => t.key === tab)?.label ?? ""} />
      )}
    </div>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="glass p-8 text-center">
      <Zap size={32} className="mx-auto mb-3 text-slate-300" />
      <h2 className="text-lg font-semibold">{label}-Automationen</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        Dieser Bereich ist strukturell vorbereitet und wird als nächste Ausbaustufe aktiviert.
        Die zentrale Engine unterstützt weitere Auslöser und Aktionen bereits.
      </p>
    </div>
  );
}

// ============================================================
// TAB: Projektstatus
// ============================================================
function ProjectStatusTab() {
  const can = useCan();
  const cfg = useProjectConfig();
  const [list, setList] = useState<Automation[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [mailTpls, setMailTpls] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Automation | "new" | null>(null);
  const [del, setDel] = useState<Automation | null>(null);
  const [test, setTest] = useState<Automation | null>(null);
  const [busy, setBusy] = useState(false);

  // Einheitliche, geordnete, deduplizierte Statusliste – EXAKT aus der zentralen
  // Projektstatus-Konfiguration (wie Projektkopf/ProjectForm), inkl. Fallback. Mandantengetrennt
  // über RLS auf project_statuses. Keine hartcodierte Statusliste.
  const stages = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const ty of cfg.types)
      for (const lbl of (cfg.statusesByCategory[ty.category] ?? []))
        if (lbl && !seen.has(lbl)) { seen.add(lbl); out.push(lbl); }
    for (const lbl of FALLBACK_STATUSES) if (lbl && !seen.has(lbl)) { seen.add(lbl); out.push(lbl); }
    return out;
  }, [cfg.types, cfg.statusesByCategory]);
  const cats = useMemo(
    () => cfg.types.map((t) => t.category).filter((c, i, arr) => c && arr.indexOf(c) === i),
    [cfg.types],
  );

  async function load() {
    setLoading(true);
    const [a, e, m] = await Promise.all([
      supabase.from("automations")
        .select("id, name, description, trigger_type, trigger_stage, trigger_config, conditions, category, actions, active, sort_order, created_at, updated_at")
        .in("trigger_type", ["project.status_changed", "project.created"])
        .order("sort_order").order("name"),
      supabase.from("employees").select("id, first_name, last_name").eq("active", true),
      supabase.from("mail_templates").select("id, name").eq("active", true).order("name"),
    ]);
    if (a.error) setErr(a.error.message);
    setList((a.data as unknown as Automation[]) ?? []);
    setEmployees(((e.data as any[]) ?? []).map((r) => ({ id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Mitarbeiter" })));
    setMailTpls(((m.data as any[]) ?? []).map((r) => ({ id: r.id, name: r.name })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  const nextSort = list.length ? Math.max(...list.map((t) => t.sort_order ?? 0)) + 1 : 1;

  async function toggleActive(a: Automation) {
    const { error } = await supabase.from("automations")
      .update({ active: !a.active, updated_at: new Date().toISOString() }).eq("id", a.id);
    if (error) toastError(error.message); else { toast(a.active ? "Deaktiviert" : "Aktiviert"); load(); }
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    const { error } = await supabase.from("automations").delete().eq("id", del.id);
    setBusy(false);
    if (error) toastError(error.message); else { toast("Automation gelöscht"); setDel(null); load(); }
  }

  const canCreate = can("automations", "create");
  const canEdit = can("automations", "edit");
  const canDelete = can("automations", "delete");

  const triggerLabel = (a: Automation) => {
    if (a.trigger_type === "project.created") return "Projekt angelegt";
    const to = a.trigger_config?.toStage ?? a.trigger_stage;
    return to ? `Status → ${to}` : "jeder Statuswechsel";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Regeln für Projektanlage und Statuswechsel.</p>
        {canCreate && <button className="btn-primary shrink-0" onClick={() => setEdit("new")}><Plus size={18} /> Neue Regel</button>}
      </div>
      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Regeln" hint="Beispiel: Erreicht ein Projekt den Status Angebotserstellung, automatisch Aufgaben an Kalkulation und Projektleiter erzeugen." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Auslöser</th>
                <th className="px-4 py-3">Aktionen</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {list.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.name}</div>
                    {a.description && <div className="text-xs text-slate-400">{a.description}</div>}
                  </td>
                  <td className="px-4 py-3"><Badge tone="blue">{triggerLabel(a)}</Badge></td>
                  <td className="px-4 py-3 text-slate-500">
                    {(Array.isArray(a.actions) ? a.actions : []).map((x) => ACTION_LABEL[x.type] ?? x.type).join(", ") || "–"}
                  </td>
                  <td className="px-4 py-3">{a.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title="Testen (Simulation)" onClick={() => setTest(a)}><FlaskConical size={16} /></button>
                      {canEdit && <button className="btn-ghost px-2" title={a.active ? "Deaktivieren" : "Aktivieren"} onClick={() => toggleActive(a)}><Power size={16} /></button>}
                      {canEdit && <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit(a)}><Pencil size={16} /></button>}
                      {canDelete && <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => setDel(a)}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <RuleEditor
          item={edit === "new" ? null : edit}
          nextSort={nextSort} stages={stages} cats={cats} employees={employees} mailTpls={mailTpls}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }}
        />
      )}
      {test && <TestDialog rule={test} stages={stages} onClose={() => setTest(null)} />}
      <ConfirmDialog
        open={!!del} title="Regel löschen?"
        message={<>Soll die Automation <b>{del?.name}</b> dauerhaft gelöscht werden? Bereits erzeugte Aufgaben/Einträge bleiben erhalten.</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)}
      />
    </div>
  );
}

// ---------- Regel-Editor ----------
function RuleEditor({
  item, nextSort, stages, cats, employees, mailTpls, onClose, onSaved,
}: {
  item: Automation | null;
  nextSort: number; stages: string[]; cats: string[];
  employees: { id: string; name: string }[]; mailTpls: { id: string; name: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(item?.trigger_type ?? "project.status_changed");
  const [toStage, setToStage] = useState(item?.trigger_config?.toStage ?? item?.trigger_stage ?? (stages[0] ?? ""));
  const [fromStage, setFromStage] = useState(item?.trigger_config?.fromStage ?? "");
  const [category, setCategory] = useState(item?.trigger_config?.category ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const initConds = Array.isArray(item?.conditions) ? item!.conditions : [];
  const [notArchived, setNotArchived] = useState(initConds.some((c) => c.type === "not_archived" || c.type === "project_active"));
  const [responsibleIs, setResponsibleIs] = useState(
    (initConds.find((c) => c.type === "responsible_is") as any)?.value ?? "",
  );
  const [actions, setActions] = useState<AutoAction[]>(Array.isArray(item?.actions) ? (item!.actions as AutoAction[]) : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addAction(type: ActionType) {
    const base: Record<ActionType, AutoAction> = {
      create_task: { type: "create_task", enabled: true, title: "", priority: "Normal", assigneeKind: "none", dedupe: "skip_if_open" },
      create_email_draft: { type: "create_email_draft", enabled: true, recipientKind: "customer", templateId: null },
      create_notification: { type: "create_notification", enabled: true, text: "" },
      create_checklist: { type: "create_checklist", enabled: true, name: "", items: [] },
      create_appointment: { type: "create_appointment", enabled: true, title: "", dateKind: "today" },
      log: { type: "log", enabled: true, text: "" },
    };
    setActions((p) => [...p, base[type]]);
  }
  const upd = (i: number, patch: Record<string, any>) =>
    setActions((p) => p.map((a, idx) => (idx === i ? ({ ...a, ...patch } as AutoAction) : a)));
  const removeAction = (i: number) => setActions((p) => p.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => setActions((p) => {
    const j = i + dir; if (j < 0 || j >= p.length) return p;
    const c = [...p]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  async function save() {
    setErr(null);
    if (!name.trim()) { setErr("Bitte einen Namen vergeben."); return; }
    if (triggerType === "project.status_changed" && !toStage.trim()) { setErr("Bitte einen Auslöse-Status wählen."); return; }
    if (!actions.length) { setErr("Bitte mindestens eine Aktion hinzufügen."); return; }
    for (const a of actions) {
      if (a.type === "create_task" && !a.title?.trim()) { setErr("Jede Aufgaben-Aktion braucht einen Titel."); return; }
      if (a.type === "create_notification" && !a.text?.trim()) { setErr("Jede Benachrichtigung braucht einen Text."); return; }
      if (a.type === "create_checklist" && !a.name?.trim()) { setErr("Jede Checkliste braucht einen Namen."); return; }
      if (a.type === "create_appointment" && !a.title?.trim()) { setErr("Jeder Termin braucht einen Titel."); return; }
      if (a.type === "log" && !a.text?.trim()) { setErr("Jeder Logbuch-Eintrag braucht einen Text."); return; }
    }
    const conditions: Condition[] = [];
    if (notArchived) conditions.push({ type: "not_archived" });
    if (responsibleIs.trim()) conditions.push({ type: "responsible_is", value: responsibleIs.trim() });

    setBusy(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      trigger_type: triggerType,
      trigger_stage: triggerType === "project.status_changed" ? (toStage.trim() || null) : null,
      trigger_config: {
        toStage: triggerType === "project.status_changed" ? (toStage.trim() || null) : null,
        fromStage: triggerType === "project.status_changed" ? (fromStage.trim() || null) : null,
        category: category.trim() || null,
      },
      conditions,
      actions,
      active,
      sort_order: item?.sort_order ?? nextSort,
      updated_at: new Date().toISOString(),
      updated_by: undefined as any,
    };
    delete (payload as any).updated_by;
    const res = item
      ? await supabase.from("automations").update(payload).eq("id", item.id)
      : await supabase.from("automations").insert(payload);
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    toast(item ? "Regel gespeichert" : "Regel angelegt");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={item ? "Regel bearbeiten" : "Neue Regel"} size="xl">
      <ErrorBanner message={err} />
      <div className="space-y-5">
        {/* 1) Allgemein */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">1 · Allgemein</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label label-req">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Bei Angebotserstellung Aufgaben erzeugen" /></div>
            <div className="sm:col-span-2"><label className="label">Beschreibung</label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optionaler Hinweis" /></div>
            <div className="flex items-end pb-1"><Toggle checked={active} onChange={setActive} label="Aktiv" /></div>
          </div>
        </section>

        {/* 2) Auslöser */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">2 · Auslöser</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">Ereignis</label>
              <select className="input" value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}>
                {TRIGGER_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select></div>
            {triggerType === "project.status_changed" ? (
              <>
                <div><label className="label label-req">Auf Status (Ziel)</label>
                  <input className="input" list="auto-stages" value={toStage} onChange={(e) => setToStage(e.target.value)} placeholder="Status wählen" />
                  {toStage && !stages.includes(toStage) && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">Dieser Status ist aktuell nicht in den Stammdaten – Regel greift nur, wenn er exakt existiert.</p>}
                </div>
                <div><label className="label">Von Status (optional)</label>
                  <input className="input" list="auto-stages" value={fromStage} onChange={(e) => setFromStage(e.target.value)} placeholder="beliebiger Ausgangsstatus" />
                  {fromStage && !stages.includes(fromStage) && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">Dieser Status ist aktuell nicht in den Stammdaten.</p>}
                </div>
              </>
            ) : (
              <div><label className="label">Startstatus (optional)</label>
                <input className="input" list="auto-stages" value={toStage} onChange={(e) => setToStage(e.target.value)} placeholder="beliebiger Startstatus" />
                <p className="mt-1 text-[11px] text-slate-400">Leer = bei jedem Startstatus. Sonst greift die Regel nur, wenn das neue Projekt mit diesem Status angelegt wird.</p>
                {toStage && !stages.includes(toStage) && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">Dieser Status ist aktuell nicht in den Stammdaten.</p>}
              </div>
            )}
            <div><label className="label">Nur Projektart (optional)</label>
              <input className="input" list="auto-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="alle Projektarten" />
            </div>
            <datalist id="auto-stages">{stages.map((s) => <option key={s} value={s} />)}</datalist>
            <datalist id="auto-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        </section>

        {/* 3) Bedingungen */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">3 · Bedingungen</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-end pb-1"><Toggle checked={notArchived} onChange={setNotArchived} label="Nur wenn Projekt nicht archiviert" /></div>
            <div><label className="label">Nur wenn zuständig ist (optional)</label>
              <input className="input" value={responsibleIs} onChange={(e) => setResponsibleIs(e.target.value)} placeholder="Mitarbeitername wie im Projekt" /></div>
          </div>
        </section>

        {/* 4) Aktionen */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">4 · Aktionen</h3>
            <div className="flex flex-wrap gap-1">
              <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={() => addAction("create_task")}><Plus size={14} /> Aufgabe</button>
              <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={() => addAction("create_email_draft")}><Plus size={14} /> Mail-Entwurf</button>
              <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={() => addAction("create_notification")}><Plus size={14} /> Benachrichtigung</button>
              <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={() => addAction("create_checklist")}><Plus size={14} /> Checkliste</button>
              <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={() => addAction("create_appointment")}><Plus size={14} /> Termin</button>
              <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={() => addAction("log")}><Plus size={14} /> Logbuch</button>
            </div>
          </div>

          {actions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-400 dark:border-white/10">Noch keine Aktionen.</p>
          ) : (
            <div className="space-y-2">
              {actions.map((a, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="slate">{ACTION_LABEL[a.type]}</Badge>
                      <Toggle checked={a.enabled !== false} onChange={(v) => upd(i, { enabled: v })} label="aktiv" />
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" className="btn-ghost px-2" title="nach oben" onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                      <button type="button" className="btn-ghost px-2" title="nach unten" onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                      <button type="button" className="btn-ghost px-2 text-rose-500" title="Entfernen" onClick={() => removeAction(i)}><X size={16} /></button>
                    </div>
                  </div>
                  <ActionFields a={a} i={i} upd={upd} employees={employees} mailTpls={mailTpls} />
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Platzhalter: {"{{Project.title}}"}, {"{{Project.number}}"}, {"{{Customer.name}}"}, {"{{Status.new}}"}, {"{{Status.old}}"}, {"{{Date.today}}"}.</p>
        </section>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}

// ---------- Aktions-spezifische Felder ----------
function ActionFields({ a, i, upd, employees, mailTpls }: {
  a: AutoAction; i: number; upd: (i: number, patch: Record<string, any>) => void;
  employees: { id: string; name: string }[]; mailTpls: { id: string; name: string }[];
}) {
  if (a.type === "create_task") {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label label-req">Titel</label>
          <input className="input" value={a.title ?? ""} onChange={(e) => upd(i, { title: e.target.value })} placeholder="z.B. Angebot kalkulieren" /></div>
        <div className="sm:col-span-2"><label className="label">Beschreibung</label>
          <input className="input" value={a.description ?? ""} onChange={(e) => upd(i, { description: e.target.value })} placeholder="optional" /></div>
        <div><label className="label">Zuständig</label>
          <select className="input" value={a.assigneeKind ?? "none"} onChange={(e) => upd(i, { assigneeKind: e.target.value })}>
            {ASSIGNEE_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select></div>
        {a.assigneeKind === "employee" && (
          <div><label className="label">Mitarbeiter</label>
            <select className="input" value={a.assigneeId ?? ""} onChange={(e) => upd(i, { assigneeId: e.target.value || null })}>
              <option value="">– wählen –</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></div>
        )}
        {a.assigneeKind === "role" && (
          <div><label className="label">Rolle / Team</label>
            <input className="input" value={a.role ?? ""} onChange={(e) => upd(i, { role: e.target.value })} placeholder="z.B. Büro, Kalkulation, Bauleiter" /></div>
        )}
        <div><label className="label">Priorität</label>
          <select className="input" value={a.priority ?? "Normal"} onChange={(e) => upd(i, { priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></div>
        <div><label className="label">Board / Bucket</label>
          <div className="flex gap-2">
            <input className="input" value={a.board ?? ""} onChange={(e) => upd(i, { board: e.target.value || null })} placeholder="Büro" />
            <input className="input" value={a.bucket ?? ""} onChange={(e) => upd(i, { bucket: e.target.value || null })} placeholder="Allgemein" />
          </div></div>
        <div><label className="label">Fälligkeit</label>
          <select className="input" value={a.dueKind ?? ""} onChange={(e) => upd(i, { dueKind: e.target.value || undefined })}>
            {DUE_KINDS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select></div>
        {(a.dueKind === "in_days" || a.dueKind === "in_workdays" || a.dueKind === "after_change_days") && (
          <div><label className="label">Anzahl Tage</label>
            <input type="number" className="input" value={a.dueValue ?? ""} onChange={(e) => upd(i, { dueValue: e.target.value === "" ? null : Number(e.target.value) })} placeholder="z.B. 3" /></div>
        )}
        <div className="sm:col-span-2"><label className="label">Doppelte vermeiden</label>
          <select className="input" value={a.dedupe ?? "every"} onChange={(e) => upd(i, { dedupe: e.target.value })}>
            {DEDUPE.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select></div>
      </div>
    );
  }
  if (a.type === "create_email_draft") {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div><label className="label">Empfänger</label>
          <select className="input" value={a.recipientKind ?? "customer"} onChange={(e) => upd(i, { recipientKind: e.target.value })}>
            {EMAIL_RECIPIENTS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select></div>
        {a.recipientKind === "custom" && (
          <div><label className="label">E-Mail-Adresse</label>
            <input className="input" value={a.recipientCustom ?? ""} onChange={(e) => upd(i, { recipientCustom: e.target.value })} placeholder="name@firma.at" /></div>
        )}
        <div className="sm:col-span-2"><label className="label">Mailvorlage</label>
          <select className="input" value={a.templateId ?? ""} onChange={(e) => upd(i, { templateId: e.target.value || null })}>
            <option value="">(ohne Vorlage)</option>
            {mailTpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <p className="sm:col-span-2 text-[11px] text-amber-600 dark:text-amber-400">
          Sicherheit: Es wird nur ein E-Mail-Entwurf vermerkt. Automatischer Versand ist nicht aktiv (kein Mailgateway) – es wird nichts ohne Freigabe versendet.
        </p>
      </div>
    );
  }
  if (a.type === "create_notification") {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label label-req">Text</label>
          <input className="input" value={a.text ?? ""} onChange={(e) => upd(i, { text: e.target.value })} placeholder="z.B. Neues Projekt zur Prüfung" /></div>
        <div><label className="label">Rolle / Empfänger (optional)</label>
          <input className="input" value={a.role ?? ""} onChange={(e) => upd(i, { role: e.target.value })} placeholder="z.B. Büro" /></div>
      </div>
    );
  }
  if (a.type === "create_checklist") {
    return (
      <div className="grid grid-cols-1 gap-2">
        <div><label className="label label-req">Name der Checkliste</label>
          <input className="input" value={a.name ?? ""} onChange={(e) => upd(i, { name: e.target.value })} placeholder="z.B. Baustart" /></div>
        <div><label className="label">Punkte (eine Zeile = ein Punkt)</label>
          <textarea className="input min-h-[80px]" value={(a.items ?? []).join("\n")} onChange={(e) => upd(i, { items: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} placeholder={"Material prüfen\nGerüst bestellen\nBaustelleneinrichtung"} /></div>
      </div>
    );
  }
  if (a.type === "create_appointment") {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label label-req">Titel</label>
          <input className="input" value={a.title ?? ""} onChange={(e) => upd(i, { title: e.target.value })} placeholder="z.B. Baubesprechung" /></div>
        <div><label className="label">Art</label>
          <input className="input" value={a.kind ?? ""} onChange={(e) => upd(i, { kind: e.target.value })} placeholder="Termin" /></div>
        <div><label className="label">Datum</label>
          <select className="input" value={a.dateKind ?? "today"} onChange={(e) => upd(i, { dateKind: e.target.value })}>
            <option value="today">heute</option><option value="tomorrow">morgen</option><option value="in_days">in X Tagen</option>
          </select></div>
        {a.dateKind === "in_days" && (
          <div><label className="label">Tage</label>
            <input type="number" className="input" value={a.dateValue ?? ""} onChange={(e) => upd(i, { dateValue: e.target.value === "" ? null : Number(e.target.value) })} /></div>
        )}
        <div><label className="label">Uhrzeit</label>
          <input className="input" value={a.time ?? ""} onChange={(e) => upd(i, { time: e.target.value })} placeholder="z.B. 09:00" /></div>
        <div><label className="label">Ort</label>
          <input className="input" value={a.location ?? ""} onChange={(e) => upd(i, { location: e.target.value })} placeholder="Baustelle" /></div>
      </div>
    );
  }
  // log
  return (
    <div><label className="label label-req">Logbuch-Text</label>
      <input className="input" value={(a as any).text ?? ""} onChange={(e) => upd(i, { text: e.target.value })} placeholder="z.B. Projekt in Umsetzung" /></div>
  );
}

// ---------- Testmodus ----------
function TestDialog({ rule, stages, onClose }: { rule: Automation; stages: string[]; onClose: () => void }) {
  const [projects, setProjects] = useState<{ id: string; title: string; stage: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [stage, setStage] = useState(rule.trigger_config?.toStage ?? rule.trigger_stage ?? (stages[0] ?? ""));
  const [results, setResults] = useState<{ ok: boolean; info?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [matched, setMatched] = useState(true);

  useEffect(() => {
    supabase.from("projects").select("id, title, stage").eq("archived", false).order("title").then(({ data }) => {
      const list = ((data as any[]) ?? []).map((p) => ({ id: p.id, title: p.title, stage: p.stage }));
      setProjects(list);
      if (list.length) setProjectId(list[0].id);
    });
  }, []);

  async function run() {
    if (!projectId) return;
    setBusy(true); setResults(null);
    const ev = rule.trigger_type === "project.created"
      ? { type: "project.created" as const, projectId, newStage: stage || null }
      : { type: "project.status_changed" as const, projectId, newStage: stage || null, oldStage: null };
    const sims = await simulateAutomations(ev);
    const mine = sims.find((s) => s.automationId === rule.id);
    setMatched(!!mine);
    setResults(mine ? mine.results.map((r) => ({ ok: r.ok, info: r.info })) : []);
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title={`Test: ${rule.name}`}>
      <p className="mb-3 text-sm text-slate-500">Simulation – es werden keine echten Aufgaben, Termine oder E-Mails erzeugt.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className="label">Projekt</label>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select></div>
        {rule.trigger_type === "project.status_changed" && (
          <div><label className="label">Statuswechsel auf</label>
            <input className="input" list="test-stages" value={stage} onChange={(e) => setStage(e.target.value)} />
            <datalist id="test-stages">{stages.map((s) => <option key={s} value={s} />)}</datalist></div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" disabled={busy || !projectId} onClick={run}>{busy ? "Simuliere …" : "Simulation starten"}</button>
      </div>

      {results !== null && (
        <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-white/10">
          {!matched ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">Diese Regel würde bei dieser Auswahl <b>nicht</b> auslösen (Auslöser/Bedingungen passen nicht).</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-slate-500">Keine Aktionen.</p>
          ) : (
            <>
              <p className="mb-2 text-sm font-medium">Es würden folgende Aktionen ausgeführt:</p>
              <ul className="space-y-1 text-sm">
                {results.map((r, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Badge tone={r.ok ? "green" : "red"}>{r.ok ? "ok" : "Fehler"}</Badge>
                    <span className="text-slate-600 dark:text-slate-300">{r.info}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================
// TAB: Protokoll
// ============================================================
function ProtocolTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("automation_runs")
      .select("id, automation_name, trigger_type, project_id, old_stage, new_stage, status, result, created_at")
      .order("created_at", { ascending: false }).limit(200);
    const list = (data as any[]) ?? [];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.project_id).filter(Boolean)));
    if (ids.length) {
      const { data: ps } = await supabase.from("projects").select("id, title").in("id", ids);
      const map: Record<string, string> = {};
      ((ps as any[]) ?? []).forEach((p) => { map[p.id] = p.title; });
      setTitles(map);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const tone = (s: string) => (s === "ok" ? "green" : s === "partial" ? "amber" : "red");
  const statusLabel = (s: string) => (s === "ok" ? "erfolgreich" : s === "partial" ? "teilweise" : "fehlgeschlagen");

  if (loading) return <Spinner />;
  if (!rows.length) return <Empty title="Noch keine Ausführungen" hint="Sobald eine Automation läuft, erscheint hier der nachvollziehbare Verlauf." />;

  return (
    <div className="glass overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
          <tr>
            <th className="px-4 py-3">Zeitpunkt</th>
            <th className="px-4 py-3">Automation</th>
            <th className="px-4 py-3">Projekt</th>
            <th className="px-4 py-3">Auslöser</th>
            <th className="px-4 py-3">Aktionen</th>
            <th className="px-4 py-3">Ergebnis</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {rows.map((r) => (
            <tr key={r.id} className="align-top hover:bg-slate-50 dark:hover:bg-white/5">
              <td className="px-4 py-3 whitespace-nowrap text-slate-500">{new Date(r.created_at).toLocaleString("de-AT")}</td>
              <td className="px-4 py-3 font-medium">{r.automation_name ?? "–"}</td>
              <td className="px-4 py-3">{titles[r.project_id] ?? "–"}</td>
              <td className="px-4 py-3 text-slate-500">
                {r.trigger_type === "project.created" ? "Projekt angelegt" : (r.new_stage ? `Status → ${r.new_stage}` : "Statuswechsel")}
              </td>
              <td className="px-4 py-3 text-slate-500">
                {(Array.isArray(r.result) ? r.result : []).map((x: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-1">
                    <span className={x.ok ? "text-emerald-600" : "text-rose-500"}>{x.ok ? "✓" : "✗"}</span>
                    <span>{x.info}</span>
                  </div>
                ))}
              </td>
              <td className="px-4 py-3"><Badge tone={tone(r.status)}>{statusLabel(r.status)}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
