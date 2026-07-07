// ============================================================
// B4Y SuperAPP – Plantafel: Einsatz anlegen/bearbeiten
// ------------------------------------------------------------
// Modal zum Anlegen/Bearbeiten eines Einsatzes (planning_events):
// Projekt, Mitarbeiter-Mehrfachauswahl, Titel/Beschreibung, Start-/
// Ende-Datum, Ganztägig-Switch (sonst Zeitfelder, Default 07:00–16:00),
// Status, optionale Farbe, Erledigt. Speichern via saveEvent; vor dem
// Speichern Konfliktprüfung (checkConflicts) – Doppelbelegungen werden
// angezeigt, blockieren aber nicht hart („Trotzdem speichern").
//
// Baut bewusst auf dem bestehenden Datenlayer (src/lib/planning.ts) auf,
// statt Termin-Logik zu duplizieren. Mandantenfähig: organization_id/RLS
// setzt Supabase serverseitig, keine Firmen-Hardcodierung hier.
// ============================================================
import { useMemo, useState } from "react";
import { Trash2, Palette, Users } from "lucide-react";
import { Modal, Badge } from "../ui";
import { Toggle, ErrorBanner } from "../calc-ui";
import { toast } from "../../lib/toast";
import {
  saveEvent, deleteEvent, checkConflicts,
  empName, statusLabel, EVENT_STATUSES,
  type Conflict, type EventWithLinks, type EmployeeLite,
} from "../../lib/planning";
import { isoDate } from "./plantafelUtils";

export type PlantafelProjectOption = { id: string; label: string };
export type PlantafelEmployee = { id: string; first_name?: string | null; last_name?: string | null };

export type EinsatzDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Bestehender Einsatz -> Bearbeiten; fehlt er -> Anlegen. */
  event?: EventWithLinks | null;
  /** Vorbelegtes Datum (Klick auf leere Zelle). */
  defaultDate?: Date | null;
  /** Vorbelegter Mitarbeiter (Zeile, in die geklickt wurde). */
  defaultEmployeeId?: string | null;
  projects: PlantafelProjectOption[];
  employees: PlantafelEmployee[];
  onSaved: () => void;
  /** RBAC (optional): Bearbeiten erlaubt (Default true). */
  mayEdit?: boolean;
  /** RBAC (optional): Löschen erlaubt (Default false). */
  mayDelete?: boolean;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const timeStr = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export default function EinsatzDialog({
  open, onClose, event, defaultDate, defaultEmployeeId,
  projects, employees, onSaved, mayEdit = true, mayDelete = false,
}: EinsatzDialogProps) {
  const isEdit = !!event?.id;
  const readOnly = !mayEdit;

  const baseStart = event?.start_at ? new Date(event.start_at) : (defaultDate ?? new Date());
  const baseEnd = event?.end_at ? new Date(event.end_at) : baseStart;

  const [projectId, setProjectId] = useState<string>(event?.project_id ?? "");
  const [empIds, setEmpIds] = useState<string[]>(
    event?.employee_ids ?? (defaultEmployeeId ? [defaultEmployeeId] : []),
  );
  const [title, setTitle] = useState<string>(event?.title ?? "");
  const [description, setDescription] = useState<string>(event?.description ?? "");
  const [allDay, setAllDay] = useState<boolean>(event?.all_day ?? false);
  const [startDate, setStartDate] = useState<string>(isoDate(baseStart));
  const [endDate, setEndDate] = useState<string>(isoDate(baseEnd));
  const [startTime, setStartTime] = useState<string>(event && !event.all_day ? timeStr(baseStart) : "07:00");
  const [endTime, setEndTime] = useState<string>(event && !event.all_day ? timeStr(baseEnd) : "16:00");
  const [status, setStatus] = useState<string>(event?.status ?? "geplant");
  const [color, setColor] = useState<string>(event?.color ?? "");
  const [done, setDone] = useState<boolean>(!!event?.done_at);

  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  // Für aussagekräftige Konflikt-Meldungen (Namen) benötigt checkConflicts EmployeeLite[].
  const employeesLite = useMemo<EmployeeLite[]>(
    () => employees.map((e) => ({ id: e.id, first_name: e.first_name ?? "", last_name: e.last_name ?? "", active: true })),
    [employees],
  );

  const toggleEmp = (id: string) =>
    setEmpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  function buildRange(): { startISO: string; endISO: string } | null {
    const s = allDay ? new Date(`${startDate}T00:00:00`) : new Date(`${startDate}T${startTime}:00`);
    const e = allDay ? new Date(`${endDate}T23:59:00`) : new Date(`${endDate}T${endTime}:00`);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) { setErr("Bitte gültiges Start-/Ende-Datum angeben."); return null; }
    if (e.getTime() < s.getTime()) { setErr("Ende darf nicht vor dem Start liegen."); return null; }
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  }

  async function save(force: boolean) {
    if (readOnly) return;
    if (!title.trim()) { setErr("Bitte einen Titel angeben."); return; }
    const range = buildRange();
    if (!range) return;
    setBusy(true); setErr(null);

    if (!force) {
      try {
        const c = await checkConflicts({
          startISO: range.startISO, endISO: range.endISO,
          employeeIds: empIds, resourceIds: [],
          excludeEventId: event?.id ?? null,
          employees: employeesLite, resources: [],
        });
        if (c.length) { setConflicts(c); setBusy(false); return; }
      } catch {
        /* Konfliktprüfung ist Best-Effort – Speichern nicht blockieren */
      }
    }

    const nn = (v: string) => (v.trim() ? v.trim() : null);
    const { error } = await saveEvent({
      id: event?.id,
      title: title.trim(),
      description: nn(description),
      start_at: range.startISO,
      end_at: range.endISO,
      all_day: allDay,
      project_id: projectId || null,
      status,
      color: color || null,
      done_at: done ? (event?.done_at ?? new Date().toISOString()) : null,
      // Verknüpfungen werden von saveEvent neu gesetzt -> Ressourcen erhalten:
      employee_ids: empIds,
      resource_ids: event?.resource_ids ?? [],
    });
    setBusy(false);
    if (error) { setErr(error); return; }
    toast(isEdit ? "Einsatz aktualisiert." : "Einsatz erstellt.");
    onSaved();
  }

  async function remove() {
    if (!event?.id || !mayDelete) return;
    setBusy(true); setErr(null);
    const { error } = await deleteEvent(event.id);
    setBusy(false);
    if (error) { setErr(error); return; }
    toast("Einsatz gelöscht.");
    onSaved();
  }

  const hasConflicts = conflicts.length > 0;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Einsatz bearbeiten" : "Einsatz erstellen"} size="xl">
      <ErrorBanner message={err} />

      <fieldset disabled={readOnly} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-500 sm:col-span-2">Titel
          <input className="input mt-1" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Badsanierung Montage" />
        </label>

        <label className="text-xs font-medium text-slate-500">Projekt
          <select className="input mt-1" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">– kein Projekt –</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500">Status
          <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
            {EVENT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <Toggle checked={allDay} onChange={setAllDay} label="Ganztägig" disabled={readOnly} />
          <Toggle checked={done} onChange={setDone} label="Erledigt" disabled={readOnly} />
        </div>

        <label className="text-xs font-medium text-slate-500">Start-Datum
          <input className="input mt-1" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-500">Ende-Datum
          <input className="input mt-1" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>

        {!allDay && (
          <>
            <label className="text-xs font-medium text-slate-500">Von (Uhrzeit)
              <input className="input mt-1" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-slate-500">Bis (Uhrzeit)
              <input className="input mt-1" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </>
        )}

        {/* Mitarbeiter-Mehrfachauswahl */}
        <div className="text-xs font-medium text-slate-500 sm:col-span-2">
          <span className="flex items-center gap-1.5"><Users size={13} /> Mitarbeiter</span>
          <div className="mt-1 max-h-36 overflow-y-auto rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
            {employees.length === 0 ? (
              <span className="text-slate-400">Keine aktiven Mitarbeiter</span>
            ) : (
              <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                {employees.map((u) => (
                  <label key={u.id} className="flex min-h-[32px] items-center gap-2 rounded-lg px-1 py-0.5 text-sm hover:bg-[var(--hover)]">
                    <input type="checkbox" checked={empIds.includes(u.id)} onChange={() => toggleEmp(u.id)} />
                    <span className="truncate">{empName(u)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {empIds.length === 0 && (
            <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">
              Ohne Mitarbeiter erscheint der Einsatz auf der Tafel unter „Ohne Zuordnung".
            </span>
          )}
        </div>

        {/* Farbe (optional) */}
        <div className="text-xs font-medium text-slate-500 sm:col-span-2">
          <span className="flex items-center gap-1.5"><Palette size={13} /> Balkenfarbe (optional)</span>
          <div className="mt-1 flex items-center gap-2">
            <input type="color" className="h-9 w-12 shrink-0 rounded-lg border-0 bg-transparent p-0"
              value={color || "#3b82f6"} onChange={(e) => setColor(e.target.value)} />
            {color
              ? <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setColor("")}>Farbe entfernen</button>
              : <span className="text-[11px] text-slate-400">Ohne = Farbe aus Projekt bzw. automatisch</span>}
          </div>
        </div>

        <label className="text-xs font-medium text-slate-500 sm:col-span-2">Beschreibung / Notiz
          <textarea className="input mt-1" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </fieldset>

      {hasConflicts && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="mb-1 flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
            Konflikte erkannt <Badge tone="amber">{conflicts.length}</Badge>
          </div>
          <ul className="list-disc pl-5 text-amber-700 dark:text-amber-200">
            {conflicts.map((c, i) => <li key={i}>{c.message}</li>)}
          </ul>
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-300/80">Du kannst trotzdem speichern.</div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-2">
        <div>
          {isEdit && mayDelete && !readOnly && (
            confirmDel ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Wirklich löschen?</span>
                <button className="btn-ghost px-2 py-1 text-sm" disabled={busy} onClick={() => setConfirmDel(false)}>Nein</button>
                <button className="btn-ghost px-2 py-1 text-sm text-rose-500" disabled={busy} onClick={remove}>Ja, löschen</button>
              </span>
            ) : (
              <button className="btn-ghost px-2 text-rose-500" disabled={busy} onClick={() => setConfirmDel(true)}>
                <Trash2 size={16} /> Löschen
              </button>
            )
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onClose}>{readOnly ? "Schließen" : "Abbrechen"}</button>
          {!readOnly && (
            hasConflicts
              ? <button className="btn-primary" disabled={busy} onClick={() => save(true)}>Trotzdem speichern</button>
              : <button className="btn-primary" disabled={busy} onClick={() => save(false)}>Speichern</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
