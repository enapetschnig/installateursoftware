// ============================================================
// B4Y SuperAPP – Widget „Kommende Terminserien" (Projektdetail)
// Zeigt die nächsten Termine (inkl. Serien) zur Projektnummer
// (appointments.hero_projektnummer = projects.project_number).
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import { Appointment, fetchAppointments, materializeOccurrences } from "../../lib/appointments";
import AppointmentModal from "./AppointmentModal";

const dateAt = (iso: string): string =>
  new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit" }).format(new Date(iso));
const timeAt = (iso: string): string =>
  new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default function ProjectUpcomingAppointments({ heroProjektnummer }: { heroProjektnummer: string | null }) {
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const range = useMemo(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(); to.setMonth(to.getMonth() + 12);
    return { from, to };
  }, []);

  const reload = useCallback(() => {
    if (!heroProjektnummer) { setRows([]); setLoading(false); return; }
    setLoading(true);
    fetchAppointments({ from: range.from, to: range.to, heroProjektnummer })
      .then(setRows).catch(() => { }).finally(() => setLoading(false));
  }, [heroProjektnummer, range]);

  useEffect(() => { reload(); }, [reload]);

  const upcoming = useMemo(
    () => materializeOccurrences(rows, range.from, range.to)
      .filter((a) => new Date(a.end_datetime).getTime() >= range.from.getTime())
      .slice(0, 3),
    [rows, range],
  );

  return (
    <div className="glass p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-bold"><Repeat size={14} /> Kommende Terminserien</h3>
        <button className="text-xs font-medium text-[var(--accent)] hover:underline" onClick={() => setOpen(true)}>+ Termin</button>
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : !heroProjektnummer ? (
        <p className="text-sm text-slate-400">Keine Projektnummer – keine Zuordnung möglich.</p>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-slate-400">Keine geplanten Termine.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {upcoming.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
              <span className="flex-1 truncate">{a.title || "Termin"}</span>
              {(a.is_recurring || a.recurrence_parent_id) && <Repeat size={11} className="shrink-0 text-slate-400" />}
              <span className="shrink-0 text-xs text-slate-400">{dateAt(a.start_datetime)}{!a.all_day && ` · ${timeAt(a.start_datetime)}`}</span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <AppointmentModal open onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }}
          defaultHeroProjektnummer={heroProjektnummer} />
      )}
    </div>
  );
}
