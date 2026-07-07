// ============================================================
// Installateursoftware – Mitarbeiter-App: Regieberichte (/m/regie)
//
// Zwei Ansichten in einer Route-Familie:
//  • /m/regie       → Liste der EIGENEN Regieberichte (createdBy = Login)
//  • /m/regie/neu   → schlankes, mobil-optimiertes Erfassungsformular
//    (optional vorbelegtes Projekt über ?projekt=<id>).
//
// Das Formular baut BEWUSST NICHT auf einer (parallel entstehenden)
// RegieForm-Komponente auf, sondern nutzt direkt den zentralen Datenlayer
// saveRegieReport (Nummernkreis + RLS + Zeit-Sync laufen dort zentral). Der
// eingeloggte Mitarbeiter wird als Haupt-Beteiligter gespeichert, damit die
// erfassten Stunden über die zentrale RPC in die Zeiterfassung synchronisiert
// werden. Mandantenfähig, keine Hardcodierung.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, ClipboardList } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Badge, Empty, Spinner } from "../../components/ui";
import { ErrorBanner } from "../../components/calc-ui";
import { useAuth } from "../../lib/auth";
import { useMyEmployee, MyEmployee } from "../../lib/my-employee";
import { dateAt } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import {
  loadRegieReports, saveRegieReport, RegieReport, regieStatusMeta,
} from "../../lib/regie";
import { hoursFromRange, fmtHours } from "../../lib/time-entries";
import type { Tone } from "../../components/ui";

type ProjectOpt = { id: string; title: string | null; project_number: string | null };

const isoToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function MRegie() {
  const location = useLocation();
  const isNew = location.pathname.endsWith("/neu");
  const { employee, loading } = useMyEmployee();

  if (loading) return <Spinner />;
  if (!employee) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Regieberichte</h1>
        <Empty
          title="Kein Mitarbeiterprofil verknüpft"
          hint="Dein Login ist noch keinem Mitarbeiter zugeordnet. Bitte wende dich an die Verwaltung."
        />
      </div>
    );
  }

  return isNew ? <RegieForm employee={employee} /> : <RegieList />;
}

// ------------------------------------------------------------
// Liste der eigenen Berichte
// ------------------------------------------------------------
function RegieList() {
  const { session } = useAuth();
  const [reports, setReports] = useState<RegieReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const uid = session?.user.id ?? null;
    if (!uid) return;
    let cancelled = false;
    setLoading(true);
    loadRegieReports({ createdBy: uid })
      .then((r) => { if (!cancelled) setReports(r); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Regieberichte</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Deine erfassten Berichte.</p>
        </div>
        <Link to="/m/regie/neu" className="btn-primary min-h-[44px] shrink-0">
          <Plus size={18} /> Neu
        </Link>
      </div>

      <ErrorBanner message={err} />

      {loading ? (
        <Spinner />
      ) : reports.length === 0 ? (
        <Empty title="Noch keine Regieberichte" hint="Erstelle deinen ersten Regiebericht über die Schaltfläche Neu." />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const meta = regieStatusMeta(r.status);
            return (
              <div key={r.id} className="glass flex items-center gap-3 p-4">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}
                >
                  <ClipboardList size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-bold">{r.kunde_name || "Ohne Kunde"}</span>
                    <Badge tone={meta.tone as Tone}>{meta.label}</Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-slate-500 dark:text-slate-400">
                    {r.report_number && <span className="tabular-nums">{r.report_number}</span>}
                    <span>{dateAt(r.datum)}</span>
                    <span className="tabular-nums">{fmtHours(r.stunden)} h</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Neues Regiebericht-Formular (schlank, mobil)
// ------------------------------------------------------------
function RegieForm({ employee }: { employee: MyEmployee }) {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const projektParam = sp.get("projekt");

  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [projectId, setProjectId] = useState<string>(projektParam ?? "");
  const [datum, setDatum] = useState<string>(isoToday());
  const [kundeName, setKundeName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [pause, setPause] = useState<number>(0);
  const [beschreibung, setBeschreibung] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id,title,project_number")
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .then(({ data }) => setProjects((data as ProjectOpt[]) ?? []));
  }, []);

  const stunden = useMemo(() => hoursFromRange(start || null, end || null, pause), [start, end, pause]);

  async function save() {
    if (!kundeName.trim()) { setErr("Bitte einen Kundennamen angeben."); return; }
    if (!beschreibung.trim()) { setErr("Bitte die geleistete Arbeit beschreiben."); return; }
    setBusy(true); setErr(null);
    const { error } = await saveRegieReport({
      project_id: projectId || null,
      datum,
      kunde_name: kundeName.trim(),
      start_time: start || null,
      end_time: end || null,
      pause_minutes: pause || 0,
      stunden,
      beschreibung: beschreibung.trim(),
      status: "offen",
      // Eigene Stunden als Haupt-Beteiligter → zentrale Zeit-Sync-RPC.
      workers: [{ employee_id: employee.id, is_main: true, hours: stunden }],
    });
    setBusy(false);
    if (error) { setErr(error); toastError(error); return; }
    toast("Regiebericht gespeichert.");
    navigate("/m/regie");
  }

  return (
    <div className="space-y-4">
      <button className="btn-ghost min-h-[44px] px-2" onClick={() => navigate("/m/regie")}>
        <ArrowLeft size={18} /> Zurück
      </button>

      <h1 className="text-2xl font-extrabold tracking-tight">Neuer Regiebericht</h1>

      <ErrorBanner message={err} />

      <div className="glass space-y-4 p-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Projekt (optional)</span>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Ohne Projekt</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {[p.project_number, p.title].filter(Boolean).join(" · ") || "(ohne Titel)"}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Datum</span>
          <input type="date" className="input" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Kunde</span>
          <input
            className="input"
            placeholder="Name des Kunden"
            value={kundeName}
            onChange={(e) => setKundeName(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Von</span>
            <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Bis</span>
            <input type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-2 items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Pause (Min.)</span>
            <input
              type="number"
              min={0}
              className="input"
              value={pause === 0 ? "" : pause}
              placeholder="0"
              onChange={(e) => setPause(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
            />
          </label>
          <div className="rounded-xl p-3 text-center" style={{ background: "var(--hover)" }}>
            <div className="text-2xl font-extrabold tabular-nums">{fmtHours(stunden)}</div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Stunden</div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Arbeit / Beschreibung</span>
          <textarea
            className="input min-h-[120px]"
            placeholder="Was wurde gemacht?"
            value={beschreibung}
            onChange={(e) => setBeschreibung(e.target.value)}
          />
        </label>
      </div>

      <div className="flex gap-3">
        <button className="btn-outline min-h-[52px] flex-1 justify-center" onClick={() => navigate("/m/regie")} disabled={busy}>
          Abbrechen
        </button>
        <button className="btn-primary min-h-[52px] flex-1 justify-center text-base" onClick={save} disabled={busy}>
          {busy ? "Speichert …" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
