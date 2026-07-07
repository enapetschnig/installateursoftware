// ============================================================
// B4Y SuperAPP – Kompakte Termin-Karte
// Titel · Zeit · Ort · Serien-Badge. Wiederverwendbar in Liste & Widget.
// ============================================================
import { Clock, MapPin, Repeat, Users, Pencil, Trash2 } from "lucide-react";
import { Appointment } from "../../lib/appointments";
import { humanReadableRRule } from "../../lib/rruleUtils";

const fmtTime = (iso: string): string =>
  new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

function timeLabel(a: Appointment): string {
  if (a.all_day) return "Ganztägig";
  const s = fmtTime(a.start_datetime);
  const e = fmtTime(a.end_datetime);
  return s === e ? s : `${s} – ${e}`;
}

export default function AppointmentCard({ appt, onClick, onEdit, onDelete }: {
  appt: Appointment;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const recurring = appt.is_recurring || !!appt.recurrence_parent_id;
  return (
    <div
      onClick={onClick}
      className={`glass flex items-start gap-3 rounded-xl p-3 ${onClick ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" : ""}`}
    >
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{appt.title || "(ohne Titel)"}</span>
          {recurring && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <Repeat size={11} /> Serie
            </span>
          )}
          {appt.cancelled && (
            <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              Abgesagt
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1"><Clock size={12} /> {timeLabel(appt)}</span>
          {appt.location && <span className="inline-flex items-center gap-1 truncate"><MapPin size={12} /> {appt.location}</span>}
          {appt.attendees && appt.attendees.length > 0 && (
            <span className="inline-flex items-center gap-1"><Users size={12} /> {appt.attendees.length}</span>
          )}
        </div>
        {recurring && appt.rrule && (
          <div className="mt-1 text-[11px] text-slate-400">{humanReadableRRule(appt.rrule)}</div>
        )}
      </div>
      {(onEdit || onDelete) && (
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {onEdit && <button className="btn-ghost px-2" onClick={onEdit} title="Bearbeiten"><Pencil size={15} /></button>}
          {onDelete && <button className="btn-ghost px-2 text-rose-500" onClick={onDelete} title="Löschen"><Trash2 size={15} /></button>}
        </div>
      )}
    </div>
  );
}
