// ============================================================
// B4Y SuperAPP – Einstellungen: Arbeitszeitmodell-Vorlagen verwalten
// Frei anlegbare Modelle (Tabelle work_time_models). Mitarbeiter bekommen
// im Reiter „Anstellung" eine dieser Vorlagen zugewiesen. Getrennt vom
// Firmen-Jahreskalender (WorkCalendar = Wochenarten/Standard).
// ============================================================
import { useEffect, useState } from "react";
import { ListChecks, Plus, Pencil, Copy, Power, Info } from "lucide-react";
import { Spinner, Modal, Badge } from "./ui";
import { Toggle, ErrorBanner } from "./calc-ui";
import { WEEKDAYS, WeekHours, sumWeek } from "../lib/employee-types";
import {
  WorkTimeTemplate, WORK_TIME_LOGIC_OPTIONS, workTimeLogicLabel,
  loadWorkTimeModels, saveWorkTimeModel, duplicateWorkTimeModel, emptyWorkTimeModel,
} from "../lib/work-time-models";

// Bei diesen Logiken werden Tagesstunden (kurze/lange Woche) gepflegt.
const SHOWS_WEEKS = (l: string) => l !== "fixed_weekly";
const SHOWS_LONG = (l: string) => l === "buak_auto" || l === "short_long_manual";

export default function WorkTimeModelsManager({ canManage = true }: { canManage?: boolean }) {
  const [list, setList] = useState<WorkTimeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<WorkTimeTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try { setList(await loadWorkTimeModels(false)); }
    catch (e: any) { setErr(e?.message ?? "Fehler"); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!edit) return;
    if (!edit.name.trim()) { setErr("Bitte einen Namen angeben."); return; }
    setBusy(true); setErr(null);
    const { error } = await saveWorkTimeModel(edit);
    setBusy(false);
    if (error) { setErr(error); return; }
    setEdit(null); load();
  }
  async function toggleActive(t: WorkTimeTemplate) {
    setBusy(true);
    await saveWorkTimeModel({ ...t, is_active: !t.is_active });
    setBusy(false); load();
  }
  async function duplicate(t: WorkTimeTemplate) {
    setBusy(true);
    await duplicateWorkTimeModel(t);
    setBusy(false); load();
  }

  if (loading) return <div className="glass p-4"><Spinner /></div>;

  return (
    <div className="glass p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><ListChecks size={18} /> Arbeitszeitmodelle (Vorlagen)</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Frei anlegbare Modelle – werden Mitarbeitern im Reiter „Anstellung" zugewiesen. Der Jahreskalender (oben) liefert die Wochenarten (kurz/lang).
          </p>
        </div>
        {canManage && <button className="btn-primary" onClick={() => setEdit(emptyWorkTimeModel(list.length * 10 + 10))}><Plus size={16} /> Neues Modell</button>}
      </div>

      <ErrorBanner message={err} />

      {list.length === 0 ? (
        <p className="text-sm text-slate-400">Noch keine Arbeitszeitmodelle.</p>
      ) : (
        <div className="space-y-2">
          {list.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t.name}</span>
                  <Badge tone="slate">{workTimeLogicLabel(t.logic)}</Badge>
                  {!t.is_active && <Badge tone="amber">inaktiv</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {modelSummary(t)}{t.description ? ` · ${t.description}` : ""}
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => setEdit({ ...t })}><Pencil size={16} /></button>
                  <button className="btn-ghost px-2" title="Duplizieren" disabled={busy} onClick={() => duplicate(t)}><Copy size={16} /></button>
                  <button className={`btn-ghost px-2 ${t.is_active ? "text-rose-500" : "text-emerald-500"}`} title={t.is_active ? "Deaktivieren" : "Aktivieren"} disabled={busy} onClick={() => toggleActive(t)}><Power size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Arbeitszeitmodell bearbeiten" : "Neues Arbeitszeitmodell"} size="xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">Name</label>
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="z.B. Bau BUAK 36/42" /></div>
            <div><label className="label">Art / Logik</label>
              <select className="input" value={edit.logic} onChange={(e) => setEdit({ ...edit, logic: e.target.value as any })}>
                {WORK_TIME_LOGIC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></div>
            <div className="sm:col-span-2"><label className="label">Beschreibung (optional)</label>
              <input className="input" value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            {edit.logic === "fixed_weekly" && (
              <>
                <div><label className="label">Wochenstunden</label>
                  <input className="input" type="number" step="0.25" value={edit.weekly_hours ?? ""} onChange={(e) => setEdit({ ...edit, weekly_hours: numOrNull(e.target.value) })} placeholder="z.B. 38,5" /></div>
                <div><label className="label">Tagesstunden (optional)</label>
                  <input className="input" type="number" step="0.25" value={edit.daily_hours ?? ""} onChange={(e) => setEdit({ ...edit, daily_hours: numOrNull(e.target.value) })} /></div>
              </>
            )}
          </div>

          {SHOWS_WEEKS(edit.logic) && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <WeekEditor title={SHOWS_LONG(edit.logic) ? "Tagesstunden kurze Woche" : "Tagesstunden je Wochentag"} tone="var(--c-amber)"
                value={edit.week_short} onChange={(v) => setEdit({ ...edit, week_short: v })} />
              {SHOWS_LONG(edit.logic) && (
                <WeekEditor title="Tagesstunden lange Woche" tone="var(--c-blue)"
                  value={edit.week_long} onChange={(v) => setEdit({ ...edit, week_long: v })} />
              )}
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">Sortierreihenfolge</label>
              <input className="input" type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) || 0 })} /></div>
            <div className="flex items-end"><Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Aktiv (auswählbar)" /></div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEdit(null)}>Abbrechen</button>
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
          </div>
        </Modal>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        Diese Vorlagen sind firmenweite Stammdaten. Welches Modell ein einzelner Mitarbeiter nutzt, wird beim Mitarbeiter (Anstellung) zugewiesen.
      </p>
    </div>
  );
}

const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function modelSummary(t: WorkTimeTemplate): string {
  const nf = (n: number) => Number(n).toLocaleString("de-AT");
  if (t.logic === "fixed_weekly") return `${nf(Number(t.weekly_hours) || sumWeek(t.week_short))} h/Woche`;
  const s = sumWeek(t.week_short), l = sumWeek(t.week_long);
  if (SHOWS_LONG(t.logic)) return `kurz ${nf(s)} h · lang ${nf(l)} h`;
  return `${nf(s || l)} h/Woche`;
}

function WeekEditor({ title, tone, value, onChange }: {
  title: string; tone: string; value: WeekHours; onChange: (v: WeekHours) => void;
}) {
  const set = (k: string, raw: string) => {
    const next: WeekHours = { ...value };
    if (raw.trim() === "") delete (next as any)[k];
    else (next as any)[k] = Number(raw.replace(",", "."));
    onChange(next);
  };
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: tone }}>{title}</span>
        <span className="text-xs text-slate-400">Σ {sumWeek(value).toLocaleString("de-AT")} h</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div key={d.key} className="text-center">
            <div className={`mb-0.5 text-[11px] ${d.weekend ? "text-slate-400" : "text-slate-500"}`}>{d.short}</div>
            <input className="input px-1 py-1 text-center text-xs" type="number" step="0.25" min="0"
              value={(value as any)[d.key] ?? ""} onChange={(e) => set(d.key, e.target.value)} />
          </div>
        ))}
      </div>
    </div>
  );
}
