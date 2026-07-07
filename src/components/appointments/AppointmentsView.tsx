// ============================================================
// B4Y SuperAPP – Terminserien-Ansicht (Liste + Kalender)
// Container für den Planungs-Reiter „Terminserien": lädt Datensätze,
// löst Serien in konkrete Termine auf und steuert Anlegen/Bearbeiten/Löschen.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, List as ListIcon, CalendarDays } from "lucide-react";
import { Modal } from "../ui";
import { ErrorBanner } from "../calc-ui";
import {
  Appointment, SeriesEditMode,
  fetchAppointments, materializeOccurrences, deleteAppointment,
} from "../../lib/appointments";
import AppointmentList from "./AppointmentList";
import AppointmentCalendar from "./AppointmentCalendar";
import AppointmentModal from "./AppointmentModal";

export default function AppointmentsView({ heroProjektnummer }: { heroProjektnummer?: string | null }) {
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [modal, setModal] = useState<{ appt: Appointment | null; start?: Date | null } | null>(null);
  const [del, setDel] = useState<Appointment | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  // breites Fenster vorladen → Kalender/Liste navigieren clientseitig
  const range = useMemo(() => {
    const from = new Date(); from.setFullYear(from.getFullYear() - 1); from.setHours(0, 0, 0, 0);
    const to = new Date(); to.setFullYear(to.getFullYear() + 2);
    return { from, to };
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    fetchAppointments({ from: range.from, to: range.to, heroProjektnummer: heroProjektnummer ?? null, search: search || null })
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : "Laden fehlgeschlagen."))
      .finally(() => setLoading(false));
  }, [range, heroProjektnummer, search]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 350); return () => clearTimeout(t); }, [searchInput]);

  // Liste zeigt nur kommende + jüngste Termine; Kalender den vollen Bereich.
  const occurrences = useMemo(() => materializeOccurrences(rows, range.from, range.to), [rows, range]);
  const listFrom = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const listItems = useMemo(() => occurrences.filter((a) => new Date(a.end_datetime).getTime() >= listFrom.getTime()), [occurrences, listFrom]);

  async function confirmDelete(mode: SeriesEditMode) {
    if (!del) return;
    setDelBusy(true); setErr(null);
    try { await deleteAppointment(del.id, mode); setDel(null); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Löschen fehlgeschlagen."); }
    finally { setDelBusy(false); }
  }
  const delIsSeries = !!del && (del.is_recurring || !!del.recurrence_parent_id);

  return (
    <div>
      <ErrorBanner message={err} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Suchen: Titel, Ort, Beschreibung …" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <div className="seg">
          <button className="seg-btn" data-active={view === "list"} onClick={() => setView("list")}><ListIcon size={15} /> Liste</button>
          <button className="seg-btn" data-active={view === "calendar"} onClick={() => setView("calendar")}><CalendarDays size={15} /> Kalender</button>
        </div>
        <button className="btn-primary" onClick={() => setModal({ appt: null })}><Plus size={16} /> Termin</button>
      </div>

      {view === "list" ? (
        <AppointmentList appointments={listItems} loading={loading}
          onSelect={(a) => setModal({ appt: a })}
          onEdit={(a) => setModal({ appt: a })}
          onDelete={(a) => setDel(a)} />
      ) : (
        <AppointmentCalendar appointments={occurrences}
          onSelect={(a) => setModal({ appt: a })}
          onNewAt={(d) => setModal({ appt: null, start: d })} />
      )}

      {modal && (
        <AppointmentModal open onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }}
          appointment={modal.appt} defaultStart={modal.start ?? null} defaultHeroProjektnummer={heroProjektnummer ?? null} />
      )}

      {del && (
        <Modal open onClose={() => setDel(null)} title="Termin löschen">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <b>{del.title || "Termin"}</b> wird gelöscht. {delIsSeries ? "Diese Aktion gehört zu einer Terminserie." : "Fortfahren?"}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" onClick={() => setDel(null)} disabled={delBusy}>Abbrechen</button>
            {delIsSeries ? (
              <>
                <button className="btn-outline" onClick={() => confirmDelete("this")} disabled={delBusy}>Nur diesen</button>
                <button className="btn-outline" onClick={() => confirmDelete("this_and_future")} disabled={delBusy}>Diesen & folgende</button>
                <button className="btn-primary" onClick={() => confirmDelete("all")} disabled={delBusy}>Ganze Serie</button>
              </>
            ) : (
              <button className="btn-primary" onClick={() => confirmDelete("all")} disabled={delBusy}>{delBusy ? "Löschen …" : "Löschen"}</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
