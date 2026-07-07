// ============================================================
// Installateursoftware – Zeiterfassung: Dialog zum Anlegen/Bearbeiten
// eines Zeiteintrags (Arbeit ODER ganztägige Abwesenheit).
//
// Nutzt ausschließlich den zentralen Datenlayer (src/lib/time-entries.ts):
//   • Von–Bis + Pause → hoursFromRange (Live-Stunden, keine eigene Rechnung)
//   • Speichern über saveTimeEntry (RLS/organization_id serverseitig)
// Mandantenneutral: Arbeitsorte/Eintragsarten kommen aus LOCATION_TYPES /
// ENTRY_KINDS, nichts ist auf eine bestimmte Firma hartcodiert.
// ============================================================
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Modal } from "../ui";
import { Toggle, ErrorBanner } from "../calc-ui";
import {
  TimeEntry, LocationType, EntryKind,
  LOCATION_TYPES, ENTRY_KINDS, isSpecialKind,
  hoursFromRange, fmtHours, saveTimeEntry,
} from "../../lib/time-entries";
import { toast, toastError } from "../../lib/toast";

type ProjectOpt = { id: string; label: string };

const PAUSE_PRESETS = [0, 30, 45, 60];
// Abwesenheiten = alle Sonder-Eintragsarten (Urlaub/Krankenstand/ZA/…)
const SPECIAL_KINDS = ENTRY_KINDS.filter((k) => k.special);

const todayISO = () => new Date().toISOString().slice(0, 10);

// Auswahl-Kachel (Arbeitsort / Abwesenheitsart / Pause) – akzentfarbig aktiv.
function tileStyle(active: boolean): CSSProperties {
  return active
    ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }
    : { borderColor: "var(--border)" };
}

export default function TimeEntryDialog({
  open, onClose, employeeId, entry, defaultDate, projects, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  entry?: TimeEntry | null;
  defaultDate?: string;
  projects: ProjectOpt[];
  /** Erhält die id des gespeicherten Eintrags (z. B. für Admin-Nachtrag/markBackdated). */
  onSaved: (id?: string) => void;
}) {
  const [workDate, setWorkDate] = useState("");
  const [isAbsence, setIsAbsence] = useState(false);
  const [absenceKind, setAbsenceKind] = useState<EntryKind>("urlaub");
  const [location, setLocation] = useState<LocationType>("baustelle");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("16:00");
  const [pause, setPause] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Formular beim Öffnen (bzw. Wechsel des Eintrags) initialisieren.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (entry) {
      const special = isSpecialKind(entry.entry_kind);
      setWorkDate(entry.work_date);
      setIsAbsence(special);
      setAbsenceKind(special ? entry.entry_kind : "urlaub");
      setLocation(entry.location_type ?? "baustelle");
      setProjectId(entry.project_id ?? "");
      setDescription(entry.description ?? "");
      setStart(entry.start_time?.slice(0, 5) ?? "07:00");
      setEnd(entry.end_time?.slice(0, 5) ?? "16:00");
      setPause(entry.pause_minutes ?? 0);
    } else {
      setWorkDate(defaultDate || todayISO());
      setIsAbsence(false);
      setAbsenceKind("urlaub");
      setLocation("baustelle");
      setProjectId("");
      setDescription("");
      setStart("07:00");
      setEnd("16:00");
      setPause(30);
    }
  }, [open, entry, defaultDate]);

  // Live-Stunden (netto) – zentrale Rechnung aus dem Datenlayer.
  const grossHours = useMemo(() => hoursFromRange(start, end, 0), [start, end]);
  const netHours = useMemo(() => hoursFromRange(start, end, pause), [start, end, pause]);

  const needsProject = !isAbsence && location === "baustelle";

  function validate(): string | null {
    if (!workDate) return "Bitte ein Datum wählen.";
    if (isAbsence) {
      if (!absenceKind) return "Bitte eine Abwesenheitsart wählen.";
      return null;
    }
    if (!start || !end) return "Bitte Beginn und Ende angeben.";
    if (end <= start) return "Das Ende muss nach dem Beginn liegen.";
    if (pause >= grossHours * 60) return "Die Pause darf nicht länger als die Arbeitszeit sein.";
    if (needsProject && !projectId) return "Bitte ein Projekt für die Baustelle wählen.";
    return null;
  }

  async function save() {
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);

    const res = isAbsence
      ? await saveTimeEntry({
          id: entry?.id,
          employee_id: employeeId,
          work_date: workDate,
          start_time: null, end_time: null, pause_minutes: 0, hours: 0,
          description: description.trim() || null,
          location_type: "sonstig",
          entry_kind: absenceKind,
          project_id: null,
        })
      : await saveTimeEntry({
          id: entry?.id,
          employee_id: employeeId,
          work_date: workDate,
          start_time: start, end_time: end, pause_minutes: pause,
          description: description.trim() || null,
          location_type: location,
          entry_kind: "arbeit",
          project_id: location === "baustelle" ? projectId : (projectId || null),
        });

    setBusy(false);
    if (res.error) { setErr(res.error); toastError("Speichern fehlgeschlagen."); return; }
    toast(entry ? "Zeiteintrag aktualisiert." : "Zeiteintrag gespeichert.");
    onSaved(res.id);
  }

  return (
    <Modal open={open} onClose={onClose} title={entry ? "Zeiteintrag bearbeiten" : "Zeit erfassen"} size="xl">
      <ErrorBanner message={err} />

      <div className="space-y-4">
        {/* Datum + Umschalter Abwesenheit */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full sm:w-auto">
            <label className="label label-req">Datum</label>
            <input type="date" className="input sm:w-52" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>
          <div className="flex items-center rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
            <Toggle checked={isAbsence} onChange={setIsAbsence} label="Abwesenheit (ganztägig)" />
          </div>
        </div>

        {isAbsence ? (
          /* ── Abwesenheit: ganztägig, keine Zeitfelder ── */
          <div>
            <label className="label">Art der Abwesenheit</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SPECIAL_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setAbsenceKind(k.value)}
                  className="min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition"
                  style={tileStyle(absenceKind === k.value)}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <label className="label">Notiz (optional)</label>
              <textarea
                className="input min-h-[64px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optionaler Hinweis"
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Ganztägig ohne Zeitangabe – die Sollstunden dieses Tages werden neutralisiert (saldo-neutral).
            </p>
          </div>
        ) : (
          /* ── Arbeit ── */
          <>
            <div>
              <label className="label">Arbeitsort</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {LOCATION_TYPES.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLocation(l.value)}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition"
                    style={tileStyle(location === l.value)}
                  >
                    <span aria-hidden>{l.icon}</span> {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={`label ${needsProject ? "label-req" : ""}`}>
                Projekt{needsProject ? "" : " (optional)"}
              </label>
              <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">– kein Projekt –</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Tätigkeit / Beschreibung</label>
              <textarea
                className="input min-h-[72px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Was wurde gemacht? (z. B. Heizung montiert, Rohre verlegt)"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="label label-req">Beginn</label>
                <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <label className="label label-req">Ende</label>
                <input type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="label">Pause</label>
                <div className="flex flex-wrap gap-1.5">
                  {PAUSE_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPause(p)}
                      className="min-h-[44px] flex-1 rounded-lg border px-3 py-2 text-sm font-medium tabular-nums transition"
                      style={tileStyle(pause === p)}
                    >
                      {p} min
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              className="flex items-center justify-between rounded-xl border px-4 py-3"
              style={{ borderColor: "var(--border)", background: "var(--hover)" }}
            >
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Arbeitszeit (netto)</span>
              <span className="text-xl font-extrabold tabular-nums">{fmtHours(netHours)} h</span>
            </div>
          </>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}
