// ============================================================
// Installateursoftware – Mitarbeiter-App: Regieberichte (/m/regie)
//
// Zwei Ansichten in einer Route-Familie:
//  • /m/regie       → Liste der EIGENEN Regieberichte (createdBy = Login)
//  • /m/regie/neu   → mobil-optimiertes Erfassungsformular, u. a. PER SPRACHE:
//    Einsatz diktieren → Transkription (/api/ai/transcribe) → KI-Parse
//    (runVoiceRegie → /api/ai/chat) füllt Kunde, Arbeit und Material aus.
//
// Speichern läuft zentral über saveRegieReport (Nummernkreis + RLS +
// Zeit-Sync). Der eingeloggte Mitarbeiter ist Haupt-Beteiligter, damit die
// Stunden in die Zeiterfassung synchronisiert werden. Mandantenfähig.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, ClipboardList, Trash2, Package, Mic } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Badge, Empty, Spinner } from "../../components/ui";
import { ErrorBanner } from "../../components/calc-ui";
import InlineMicButton from "../../components/voice/InlineMicButton";
import { useAuth } from "../../lib/auth";
import { useMyEmployee, MyEmployee } from "../../lib/my-employee";
import { dateAt } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import { loadCompanySettings } from "../../lib/company";
import {
  loadRegieReports, saveRegieReport, RegieReport, RegieMaterial, regieStatusMeta, materialSum,
} from "../../lib/regie";
import { hoursFromRange, fmtHours } from "../../lib/time-entries";
import { runVoiceRegie, regieMaterialsFromParse } from "../../lib/voice/runVoiceRegie";
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
        <Empty title="Noch keine Regieberichte" hint="Erstelle deinen ersten Regiebericht über die Schaltfläche Neu – auch per Sprache." />
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
// Neues Regiebericht-Formular (schlank, mobil, mit Sprach-Erfassung)
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
  const [materials, setMaterials] = useState<RegieMaterial[]>([]);
  const [firmaName, setFirmaName] = useState<string>("");
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id,title,project_number")
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .then(({ data }) => setProjects((data as ProjectOpt[]) ?? []));
    loadCompanySettings().then((c) => setFirmaName(c?.name ?? "")).catch(() => { /* Fallback im Prompt */ });
  }, []);

  const stunden = useMemo(() => hoursFromRange(start || null, end || null, pause), [start, end, pause]);

  // ── Sprach-Erfassung: Diktat → Transkript → KI-Parse → Felder füllen ──────
  async function onVoiceTranscript(text: string) {
    setParsing(true); setErr(null);
    try {
      const r = await runVoiceRegie({ text, firmaName });
      if (r.beschreibung) setBeschreibung((p) => (p.trim() ? `${p.trim()}\n${r.beschreibung}` : r.beschreibung));
      if (r.kunde_name) setKundeName((p) => p || (r.kunde_name as string));
      if (r.start_time) setStart(r.start_time);
      if (r.end_time) setEnd(r.end_time);
      if (r.pause_minutes != null) setPause(r.pause_minutes);
      if (r.materials.length) setMaterials((prev) => [...prev, ...regieMaterialsFromParse(r)]);
      toast("Diktat übernommen.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sprach-Auswertung fehlgeschlagen.";
      setErr(msg); toastError(msg);
    } finally {
      setParsing(false);
    }
  }

  // ── Material-Zeilen ───────────────────────────────────────────────────────
  const setMat = (i: number, patch: Partial<RegieMaterial>) =>
    setMaterials((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addMat = () =>
    setMaterials((rows) => [...rows, { article_id: null, material: "", menge: 1, einheit: "Stk", einzelpreis: 0, notizen: null, sort_order: rows.length }]);
  const removeMat = (i: number) => setMaterials((rows) => rows.filter((_, idx) => idx !== i));

  async function save() {
    if (!kundeName.trim()) { setErr("Bitte einen Kundennamen angeben."); return; }
    if (!beschreibung.trim()) { setErr("Bitte die geleistete Arbeit beschreiben."); return; }
    setBusy(true); setErr(null);
    const cleanMaterials = materials
      .filter((m) => m.material.trim())
      .map((m, i) => ({ ...m, sort_order: i }));
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
      materials: cleanMaterials,
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

      {/* Sprach-Erfassung (prominent oben) */}
      <div
        className="glass flex items-center gap-4 p-4"
        style={{ border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))" }}
      >
        <InlineMicButton
          size="lg"
          onResult={onVoiceTranscript}
          onError={setErr}
          disabled={parsing || busy}
          placeholder="Regiebericht diktieren"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-bold">
            <Mic size={16} className="text-[var(--accent)]" /> Per Sprache erfassen
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {parsing ? "Diktat wird ausgewertet …" : "Einsatz diktieren – Kunde, Arbeit und Material werden ausgefüllt."}
          </div>
        </div>
      </div>

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

        <div className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold">Arbeit / Beschreibung</span>
            <InlineMicButton
              size="sm"
              onResult={(t) => setBeschreibung((p) => (p.trim() ? `${p.trim()} ${t}` : t))}
              onError={setErr}
              disabled={parsing || busy}
              placeholder="Beschreibung diktieren"
            />
          </div>
          <textarea
            className="input min-h-[120px]"
            placeholder="Was wurde gemacht? (oder oben diktieren)"
            value={beschreibung}
            onChange={(e) => setBeschreibung(e.target.value)}
          />
        </div>
      </div>

      {/* Material */}
      <div className="glass space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Package size={16} /> Material {materials.length > 0 && `(${materials.length})`}
          </span>
          <button className="btn-outline min-h-[40px] px-3 text-sm" onClick={addMat}>
            <Plus size={16} /> Position
          </button>
        </div>
        {materials.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Kein Material – per Sprache diktieren oder Position hinzufügen.</p>
        ) : (
          <div className="space-y-2">
            {materials.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder="Material"
                  value={m.material}
                  onChange={(e) => setMat(i, { material: e.target.value })}
                />
                <input
                  type="number"
                  className="input w-16 text-center"
                  value={m.menge}
                  min={0}
                  onChange={(e) => setMat(i, { menge: Math.max(0, Number(e.target.value)) })}
                />
                <input
                  className="input w-20"
                  placeholder="Einh."
                  value={m.einheit}
                  onChange={(e) => setMat(i, { einheit: e.target.value })}
                />
                <button className="btn-ghost min-h-[40px] px-2 text-[var(--c-red)]" onClick={() => removeMat(i)} aria-label="Position entfernen">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {materialSum(materials) > 0 && (
              <div className="pt-1 text-right text-sm text-slate-500 dark:text-slate-400">
                Materialsumme netto: <span className="font-semibold tabular-nums">{materialSum(materials).toFixed(2)} €</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button className="btn-outline min-h-[52px] flex-1 justify-center" onClick={() => navigate("/m/regie")} disabled={busy}>
          Abbrechen
        </button>
        <button className="btn-primary min-h-[52px] flex-1 justify-center text-base" onClick={save} disabled={busy || parsing}>
          {busy ? "Speichert …" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
