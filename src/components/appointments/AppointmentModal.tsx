// ============================================================
// B4Y SuperAPP – Termin anlegen/bearbeiten (mit Serien-Editor)
// Nutzt das zentrale Modal (src/components/ui) und den RecurrenceEditor.
// ============================================================
import { useState } from "react";
import { Modal } from "../ui";
import { ErrorBanner } from "../calc-ui";
import { useAuth } from "../../lib/auth";
import {
  Appointment, AppointmentInsert, SeriesEditMode,
  createAppointment, updateAppointment,
} from "../../lib/appointments";
import RecurrenceEditor, {
  RecurrenceValue, defaultRecurrence, recurrenceToRRule, rruleToRecurrence,
} from "./RecurrenceEditor";

const pad = (n: number): string => String(n).padStart(2, "0");
/** ISO-String → Wert für <input type="datetime-local"> (Lokalzeit). */
function toLocalInput(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string { return new Date(v).toISOString(); }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  appointment?: Appointment | null;     // gesetzt = bearbeiten
  defaultHeroProjektnummer?: string | null;
  defaultStart?: Date | null;
}

export default function AppointmentModal({ open, onClose, onSaved, appointment, defaultHeroProjektnummer, defaultStart }: Props) {
  const { session } = useAuth();
  const uid = session?.user.id ?? null;
  const isEdit = !!appointment;
  const isSeries = !!appointment && (appointment.is_recurring || !!appointment.recurrence_parent_id);

  const initStart = appointment?.start_datetime ?? (defaultStart ? defaultStart.toISOString() : undefined);
  const initEnd = appointment?.end_datetime ??
    (defaultStart ? new Date(defaultStart.getTime() + 60 * 60000).toISOString() : undefined);

  const [title, setTitle] = useState(appointment?.title ?? "");
  const [description, setDescription] = useState(appointment?.description ?? "");
  const [location, setLocation] = useState(appointment?.location ?? "");
  const [hero, setHero] = useState(appointment?.hero_projektnummer ?? defaultHeroProjektnummer ?? "");
  const [startLocal, setStartLocal] = useState(toLocalInput(initStart));
  const [endLocal, setEndLocal] = useState(toLocalInput(initEnd));
  const [allDay, setAllDay] = useState(appointment?.all_day ?? false);
  const [attendees, setAttendees] = useState((appointment?.attendees ?? []).join(", "));
  const [rec, setRec] = useState<RecurrenceValue>(
    appointment
      ? rruleToRecurrence(appointment.rrule, appointment.is_recurring, new Date(appointment.start_datetime))
      : defaultRecurrence(defaultStart ?? new Date()),
  );
  // Bei bestehenden Serien standardmäßig "ganze Serie" bearbeiten.
  const [editMode, setEditMode] = useState<SeriesEditMode>("all");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) { setErr("Bitte einen Titel angeben."); return; }
    const startISO = fromLocalInput(startLocal);
    const endISO = fromLocalInput(endLocal || startLocal);
    if (new Date(endISO) < new Date(startISO)) { setErr("Ende darf nicht vor dem Start liegen."); return; }

    const rrule = recurrenceToRRule(rec);
    const attArr = attendees.split(",").map((s) => s.trim()).filter(Boolean);
    const payload: AppointmentInsert = {
      hero_projektnummer: hero.trim() || null,
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      start_datetime: startISO,
      end_datetime: endISO,
      all_day: allDay,
      is_recurring: !!rrule,
      rrule,
      recurrence_count: rec.enabled && rec.endMode === "count" ? rec.count : null,
      recurrence_end_date: rec.enabled && rec.endMode === "until" && rec.until ? new Date(`${rec.until}T23:59:59`).toISOString() : null,
      attendees: attArr.length ? attArr : null,
      updated_by: uid,
    };

    setBusy(true); setErr(null);
    try {
      if (isEdit && appointment) {
        await updateAppointment(appointment.id, payload, isSeries ? editMode : "all");
      } else {
        await createAppointment({ ...payload, created_by: uid });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Termin bearbeiten" : "Termin erstellen"} size="xl">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-500 sm:col-span-2">Titel
          <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="z. B. Baubesprechung" />
        </label>

        <label className="text-xs font-medium text-slate-500">Start
          <input type="datetime-local" className="input mt-1" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-500">Ende
          <input type="datetime-local" className="input mt-1" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
        </label>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          Ganztägig
        </label>

        <label className="text-xs font-medium text-slate-500">Ort
          <input className="input mt-1" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Adresse / Raum" />
        </label>
        <label className="text-xs font-medium text-slate-500">Projektnummer
          <input className="input mt-1 font-mono" value={hero} onChange={(e) => setHero(e.target.value)} placeholder="z. B. PROJEKT-0001-2026" />
        </label>

        <label className="text-xs font-medium text-slate-500 sm:col-span-2">Teilnehmer (durch Komma getrennt)
          <input className="input mt-1" value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="Max Muster, info@kunde.at" />
        </label>

        <label className="text-xs font-medium text-slate-500 sm:col-span-2">Beschreibung
          <textarea className="input mt-1 min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="sm:col-span-2">
          <RecurrenceEditor value={rec} onChange={setRec} start={startLocal ? new Date(startLocal) : null} />
        </div>

        {isSeries && (
          <label className="text-xs font-medium text-slate-500 sm:col-span-2">Änderung anwenden auf
            <select className="input mt-1 w-auto min-w-[220px]" value={editMode} onChange={(e) => setEditMode(e.target.value as SeriesEditMode)}>
              <option value="this">Nur diesen Termin</option>
              <option value="this_and_future">Diesen und alle folgenden</option>
              <option value="all">Alle Termine der Serie</option>
            </select>
          </label>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}
