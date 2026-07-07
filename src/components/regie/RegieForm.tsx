// ============================================================
// Installateursoftware – RegieForm
// Modal zum Anlegen und Bearbeiten eines Regieberichts (Arbeitsbericht).
// Bündelt Projekt-/Kundenauswahl (mit Autofill aus dem Projektkontakt),
// Einsatzzeiten (Von/Bis/Pause → Stunden), Beschreibung/Notizen,
// Material-Positionen (mit Artikel-Vorschlag, Einheit, Einzelpreis) und
// die beteiligten Mitarbeiter (einer als Hauptmonteur). Speichern läuft
// zentral über saveRegieReport() – Nummernkreis + Zeiteinträge werden dort
// automatisch gezogen bzw. synchronisiert.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Star, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Modal, Spinner } from "../ui";
import { ErrorBanner } from "../calc-ui";
import { eur } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import { Contact } from "../../lib/types";
import CustomerSelect from "../CustomerSelect";
import {
  loadProjectOptions, ProjectOption,
} from "../../lib/documents-overview";
import { useEmployees, employeeDisplayName } from "../../lib/project-config";
import { useMyEmployee } from "../../lib/my-employee";
import {
  RegieMaterial, RegieWorker, RegieStatus,
  loadRegieReport, saveRegieReport, materialSum,
} from "../../lib/regie";

type ArticleLite = { id: string; name: string; unit: string | null; sale_price: number };

const today = () => new Date().toISOString().slice(0, 10);
const timeVal = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : "");

/** Stunden aus Von/Bis/Pause – nie negativ, auf 2 Nachkommastellen gerundet. */
function computeHours(start: string, end: string, pauseMin: number): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  const mins = eh * 60 + em - (sh * 60 + sm) - (pauseMin || 0);
  return mins > 0 ? Math.round((mins / 60) * 100) / 100 : 0;
}

/** Anzeigename eines Kontakts (Firma bzw. Person). */
function contactName(c: Contact): string {
  if (c.customer_type === "firma") return c.company || "Firma";
  return [c.salutation, c.title, c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "Kontakt";
}

type FormState = {
  project_id: string;
  contact_id: string;
  kunde_name: string;
  kunde_strasse: string;
  kunde_plz: string;
  kunde_ort: string;
  kunde_email: string;
  kunde_telefon: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  beschreibung: string;
  notizen: string;
};

const emptyForm = (defaultProjectId?: string): FormState => ({
  project_id: defaultProjectId ?? "",
  contact_id: "",
  kunde_name: "",
  kunde_strasse: "",
  kunde_plz: "",
  kunde_ort: "",
  kunde_email: "",
  kunde_telefon: "",
  datum: today(),
  start_time: "",
  end_time: "",
  pause_minutes: 0,
  beschreibung: "",
  notizen: "",
});

const emptyMaterial = (): RegieMaterial => ({
  article_id: null, material: "", menge: 1, einheit: "Stk", einzelpreis: 0, notizen: null, sort_order: 0,
});

export default function RegieForm({
  open, onClose, reportId, defaultProjectId, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  reportId?: string | null;
  defaultProjectId?: string;
  onSaved: (id: string) => void;
}) {
  const { employees } = useEmployees();
  const { employee: me } = useMyEmployee();

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [articles, setArticles] = useState<ArticleLite[]>([]);

  const [f, setF] = useState<FormState>(emptyForm(defaultProjectId));
  const [materials, setMaterials] = useState<RegieMaterial[]>([]);
  const [workers, setWorkers] = useState<RegieWorker[]>([]);
  // Bestand für Update erhalten (sonst würde saveRegieReport diese Felder zurücksetzen).
  const [reportNumber, setReportNumber] = useState<string | null>(null);
  const [status, setStatus] = useState<RegieStatus>("offen");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  // Stammdaten (Kontakte, Projekte, Artikel) laden – solange das Modal offen ist.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const [c, p, a] = await Promise.all([
        supabase.from("contacts").select("*").order("last_name").order("company"),
        loadProjectOptions().catch(() => [] as ProjectOption[]),
        supabase.from("articles").select("id,name,unit,sale_price").order("name"),
      ]);
      if (!alive) return;
      setContacts((c.data as Contact[]) ?? []);
      setProjects(p);
      setArticles((a.data as ArticleLite[]) ?? []);
    })();
    return () => { alive = false; };
  }, [open]);

  // Formular initialisieren: Bestand laden (Bearbeiten) bzw. leeres Formular (Neu).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setErr(null);
    if (reportId) {
      setLoading(true);
      (async () => {
        try {
          const { report, materials: mats, workers: wrk } = await loadRegieReport(reportId);
          if (!alive) return;
          if (report) {
            setF({
              project_id: report.project_id ?? "",
              contact_id: report.contact_id ?? "",
              kunde_name: report.kunde_name ?? "",
              kunde_strasse: report.kunde_strasse ?? "",
              kunde_plz: report.kunde_plz ?? "",
              kunde_ort: report.kunde_ort ?? "",
              kunde_email: report.kunde_email ?? "",
              kunde_telefon: report.kunde_telefon ?? "",
              datum: report.datum ?? today(),
              start_time: timeVal(report.start_time),
              end_time: timeVal(report.end_time),
              pause_minutes: report.pause_minutes ?? 0,
              beschreibung: report.beschreibung ?? "",
              notizen: report.notizen ?? "",
            });
            setReportNumber(report.report_number);
            setStatus(report.status);
          }
          setMaterials(mats);
          setWorkers(wrk);
        } catch (e) {
          if (alive) setErr(e instanceof Error ? e.message : "Regiebericht konnte nicht geladen werden.");
        } finally {
          if (alive) setLoading(false);
        }
      })();
    } else {
      setF(emptyForm(defaultProjectId));
      setMaterials([]);
      setWorkers([]);
      setReportNumber(null);
      setStatus("offen");
    }
    return () => { alive = false; };
  }, [open, reportId, defaultProjectId]);

  // Bei Neuanlage: aktuellen Mitarbeiter als Hauptmonteur vorbelegen.
  useEffect(() => {
    if (!open || reportId) return;
    if (me?.id && workers.length === 0) {
      setWorkers([{ employee_id: me.id, is_main: true, hours: null }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId, me?.id]);

  const stunden = computeHours(f.start_time, f.end_time, f.pause_minutes);

  // ---------- Autofill: Kunde aus Kontakt ----------
  function fillFromContact(id: string) {
    const c = contacts.find((x) => x.id === id);
    if (!c) return;
    setF((p) => ({
      ...p,
      contact_id: id,
      kunde_name: contactName(c),
      kunde_strasse: [c.street, c.address_extra].filter(Boolean).join(", "),
      kunde_plz: c.zip ?? "",
      kunde_ort: c.city ?? "",
      kunde_email: c.email ?? "",
      kunde_telefon: c.phone || c.mobile || "",
    }));
  }

  // ---------- Autofill: Kunde/Adresse aus Projekt ----------
  async function pickProject(pid: string) {
    set("project_id", pid);
    if (!pid) return;
    const { data } = await supabase
      .from("projects").select("contact_id, street, zip, city").eq("id", pid).maybeSingle();
    const proj = data as { contact_id: string | null; street: string | null; zip: string | null; city: string | null } | null;
    if (!proj) return;
    if (proj.contact_id && contacts.some((c) => c.id === proj.contact_id)) {
      fillFromContact(proj.contact_id);
    } else {
      // Kein verknüpfter Kontakt → nur leere Adressfelder aus dem Projekt vorschlagen.
      setF((p) => ({
        ...p,
        kunde_strasse: p.kunde_strasse || (proj.street ?? ""),
        kunde_plz: p.kunde_plz || (proj.zip ?? ""),
        kunde_ort: p.kunde_ort || (proj.city ?? ""),
      }));
    }
  }

  // Neuanlage mit vorgegebenem Projekt: Kunde/Adresse einmalig automatisch übernehmen,
  // sobald die Kontakte geladen sind (nur solange der Kundenname noch leer ist).
  const [prefilledProject, setPrefilledProject] = useState(false);
  useEffect(() => {
    if (!open || reportId || !defaultProjectId || prefilledProject) return;
    if (contacts.length === 0) return;
    setPrefilledProject(true);
    pickProject(defaultProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId, defaultProjectId, contacts, prefilledProject]);
  useEffect(() => { if (!open) setPrefilledProject(false); }, [open]);

  // ---------- Material ----------
  const setMat = (i: number, patch: Partial<RegieMaterial>) =>
    setMaterials((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  function onMaterialName(i: number, name: string) {
    const hit = articles.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
    if (hit) {
      setMat(i, {
        material: name, article_id: hit.id,
        einheit: hit.unit || "Stk", einzelpreis: Number(hit.sale_price) || 0,
      });
    } else {
      setMat(i, { material: name, article_id: null });
    }
  }

  const total = useMemo(() => materialSum(materials), [materials]);

  // ---------- Beteiligte ----------
  const availableEmployees = useMemo(
    () => employees.filter((e) => !workers.some((w) => w.employee_id === e.id)),
    [employees, workers],
  );
  function addWorker(employeeId: string) {
    if (!employeeId) return;
    setWorkers((rows) => [...rows, { employee_id: employeeId, is_main: rows.length === 0, hours: null }]);
  }
  function removeWorker(employeeId: string) {
    setWorkers((rows) => {
      const next = rows.filter((w) => w.employee_id !== employeeId);
      // Hauptmonteur nachbesetzen, falls entfernt.
      if (next.length && !next.some((w) => w.is_main)) next[0] = { ...next[0], is_main: true };
      return next;
    });
  }
  const setMain = (employeeId: string) =>
    setWorkers((rows) => rows.map((w) => ({ ...w, is_main: w.employee_id === employeeId })));

  const empName = (id: string) => {
    const e = employees.find((x) => x.id === id);
    return e ? employeeDisplayName(e) : "Mitarbeiter";
  };

  // ---------- Speichern ----------
  async function save() {
    setErr(null);
    if (!f.kunde_name.trim()) { setErr("Bitte einen Kundennamen angeben."); return; }
    if (!f.datum) { setErr("Bitte ein Datum angeben."); return; }
    setBusy(true);
    const res = await saveRegieReport({
      id: reportId ?? undefined,
      report_number: reportNumber,
      status,
      project_id: f.project_id || null,
      contact_id: f.contact_id || null,
      kunde_name: f.kunde_name.trim(),
      kunde_strasse: f.kunde_strasse.trim() || null,
      kunde_plz: f.kunde_plz.trim() || null,
      kunde_ort: f.kunde_ort.trim() || null,
      kunde_email: f.kunde_email.trim() || null,
      kunde_telefon: f.kunde_telefon.trim() || null,
      datum: f.datum,
      start_time: f.start_time || null,
      end_time: f.end_time || null,
      pause_minutes: f.pause_minutes || 0,
      stunden,
      beschreibung: f.beschreibung.trim(),
      notizen: f.notizen.trim() || null,
      materials: materials
        .filter((m) => m.material.trim())
        .map((m, i) => ({ ...m, material: m.material.trim(), sort_order: i })),
      workers,
    });
    setBusy(false);
    if (res.error || !res.id) { setErr(res.error ?? "Speichern fehlgeschlagen."); toastError(res.error ?? "Speichern fehlgeschlagen."); return; }
    toast(reportId ? "Regiebericht gespeichert." : "Regiebericht angelegt.");
    onSaved(res.id);
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={reportId ? "Regiebericht bearbeiten" : "Neuer Regiebericht"} size="2xl">
      {loading ? <Spinner /> : (
        <>
          <ErrorBanner message={err} />

          {/* Projekt + Kunde */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Projekt</label>
              <select className="input" value={f.project_id} onChange={(e) => pickProject(e.target.value)}>
                <option value="">– kein Projekt –</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Kunde (Kontakt)</label>
              <CustomerSelect
                contacts={contacts}
                value={f.contact_id}
                onChange={(id) => (id ? fillFromContact(id) : set("contact_id", ""))}
              />
            </div>
          </div>

          {/* Kundenfelder (Snapshot, frei editierbar) */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label label-req">Kundenname</label>
              <input className="input" value={f.kunde_name} onChange={(e) => set("kunde_name", e.target.value)} placeholder="Name / Firma" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Straße</label>
              <input className="input" value={f.kunde_strasse} onChange={(e) => set("kunde_strasse", e.target.value)} />
            </div>
            <div>
              <label className="label">PLZ</label>
              <input className="input" value={f.kunde_plz} onChange={(e) => set("kunde_plz", e.target.value)} />
            </div>
            <div>
              <label className="label">Ort</label>
              <input className="input" value={f.kunde_ort} onChange={(e) => set("kunde_ort", e.target.value)} />
            </div>
            <div>
              <label className="label">E-Mail</label>
              <input type="email" className="input" value={f.kunde_email} onChange={(e) => set("kunde_email", e.target.value)} />
            </div>
            <div>
              <label className="label">Telefon</label>
              <input type="tel" className="input" value={f.kunde_telefon} onChange={(e) => set("kunde_telefon", e.target.value)} />
            </div>
          </div>

          {/* Einsatzdaten */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="label label-req">Datum</label>
              <input type="date" className="input" value={f.datum} onChange={(e) => set("datum", e.target.value)} />
            </div>
            <div>
              <label className="label">Von</label>
              <input type="time" className="input" value={f.start_time} onChange={(e) => set("start_time", e.target.value)} />
            </div>
            <div>
              <label className="label">Bis</label>
              <input type="time" className="input" value={f.end_time} onChange={(e) => set("end_time", e.target.value)} />
            </div>
            <div>
              <label className="label">Pause (Min.)</label>
              <input type="number" min={0} step={5} className="input" value={f.pause_minutes || ""} onChange={(e) => set("pause_minutes", Number(e.target.value) || 0)} />
            </div>
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Arbeitszeit: <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{stunden.toLocaleString("de-AT")} h</span>
            {" "}· wird an die beteiligten Mitarbeiter als Zeiteintrag übernommen.
          </div>

          {/* Beschreibung / Notizen */}
          <div className="mt-4 grid grid-cols-1 gap-3">
            <div>
              <label className="label">Beschreibung / durchgeführte Arbeiten</label>
              <textarea className="input min-h-[90px]" value={f.beschreibung} onChange={(e) => set("beschreibung", e.target.value)} />
            </div>
            <div>
              <label className="label">Interne Notizen</label>
              <textarea className="input min-h-[60px]" value={f.notizen} onChange={(e) => set("notizen", e.target.value)} />
            </div>
          </div>

          {/* Material */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Material</h4>
              <button type="button" className="btn-outline" onClick={() => setMaterials((r) => [...r, emptyMaterial()])}>
                <Plus size={16} /> Position
              </button>
            </div>
            {materials.length === 0 ? (
              <p className="text-sm text-slate-400">Noch kein Material erfasst.</p>
            ) : (
              <div className="overflow-x-auto">
                <datalist id="regie-article-suggest">
                  {articles.map((a) => <option key={a.id} value={a.name} />)}
                </datalist>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Bezeichnung</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 w-24">Menge</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-24">Einheit</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 w-32">Einzelpreis</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 w-32">Summe</th>
                      <th className="px-2 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m, i) => (
                      <tr key={i} className="align-top">
                        <td className="px-2 py-1">
                          <input
                            className="input" list="regie-article-suggest" value={m.material}
                            placeholder="Material / Artikel"
                            onChange={(e) => onMaterialName(i, e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" step="any" className="input text-right" value={m.menge || ""} onChange={(e) => setMat(i, { menge: Number(e.target.value) || 0 })} />
                        </td>
                        <td className="px-2 py-1">
                          <input className="input" value={m.einheit} onChange={(e) => setMat(i, { einheit: e.target.value })} />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" step="0.01" className="input text-right" value={m.einzelpreis || ""} onChange={(e) => setMat(i, { einzelpreis: Number(e.target.value) || 0 })} />
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{eur((Number(m.menge) || 0) * (Number(m.einzelpreis) || 0))}</td>
                        <td className="px-2 py-1 text-right">
                          <button type="button" className="btn-ghost px-2 text-rose-500" title="Position entfernen" onClick={() => setMaterials((r) => r.filter((_, idx) => idx !== i))}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right font-semibold">Materialsumme (netto)</td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">{eur(total)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Beteiligte */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Beteiligte Mitarbeiter</h4>
              <select
                className="input max-w-[16rem]" value=""
                onChange={(e) => { addWorker(e.target.value); e.currentTarget.value = ""; }}
                disabled={availableEmployees.length === 0}
              >
                <option value="">+ Mitarbeiter hinzufügen …</option>
                {availableEmployees.map((e) => <option key={e.id} value={e.id}>{employeeDisplayName(e)}</option>)}
              </select>
            </div>
            {workers.length === 0 ? (
              <p className="text-sm text-slate-400">Noch keine Mitarbeiter zugeordnet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {workers.map((w) => (
                  <li key={w.employee_id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                    <span className="flex items-center gap-2 truncate">
                      <button
                        type="button"
                        title={w.is_main ? "Hauptmonteur" : "Als Hauptmonteur festlegen"}
                        onClick={() => setMain(w.employee_id)}
                        className={w.is_main ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}
                      >
                        <Star size={18} fill={w.is_main ? "currentColor" : "none"} />
                      </button>
                      <span className="truncate font-medium">{empName(w.employee_id)}</span>
                      {w.is_main && <span className="text-xs text-amber-600 dark:text-amber-400">Hauptmonteur</span>}
                    </span>
                    <button type="button" className="btn-ghost px-2 text-rose-500 min-h-[44px]" title="Entfernen" onClick={() => removeWorker(w.employee_id)}>
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button className="btn-outline" onClick={onClose} disabled={busy}>Abbrechen</button>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Speichern …" : "Speichern"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
