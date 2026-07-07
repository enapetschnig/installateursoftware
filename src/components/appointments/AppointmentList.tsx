// ============================================================
// B4Y SuperAPP – Terminliste mit Datums-Gruppierung
// Erwartet bereits aufgelöste (materialisierte) Termine.
// ============================================================
import { Spinner, Empty } from "../ui";
import { Appointment } from "../../lib/appointments";
import AppointmentCard from "./AppointmentCard";

const dayKey = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

function groupHeader(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that.getTime() - today.getTime()) / 86400000);
  const label = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(d);
  if (diff === 0) return `Heute · ${label}`;
  if (diff === 1) return `Morgen · ${label}`;
  return label;
}

export default function AppointmentList({ appointments, loading, onSelect, onEdit, onDelete }: {
  appointments: Appointment[];
  loading?: boolean;
  onSelect?: (a: Appointment) => void;
  onEdit?: (a: Appointment) => void;
  onDelete?: (a: Appointment) => void;
}) {
  if (loading) return <Spinner />;
  if (appointments.length === 0) return <Empty title="Keine Termine im Zeitraum." hint="Lege einen Termin oder eine Terminserie an." />;

  // nach Tag gruppieren (Eingabe ist bereits chronologisch sortiert)
  const groups: { key: string; items: Appointment[] }[] = [];
  for (const a of appointments) {
    const k = dayKey(a.start_datetime);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(a);
    else groups.push({ key: k, items: [a] });
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="mb-2 text-sm font-bold capitalize text-slate-600 dark:text-slate-300">{groupHeader(g.items[0].start_datetime)}</h3>
          <div className="space-y-2">
            {g.items.map((a) => (
              <AppointmentCard key={a.id} appt={a}
                onClick={onSelect ? () => onSelect(a) : undefined}
                onEdit={onEdit ? () => onEdit(a) : undefined}
                onDelete={onDelete ? () => onDelete(a) : undefined} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
