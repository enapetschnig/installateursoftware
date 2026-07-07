import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Project, Contact, NumberRange, numberPreview, PROJECT_PRIORITIES } from "../lib/types";
import { Modal } from "./ui";
import { ErrorBanner } from "./calc-ui";
import { logProject } from "../lib/projectlog";
import { runProjectCreatedAutomations } from "../lib/automations";
import CustomerSelect from "./CustomerSelect";
import AddressAutocomplete from "./AddressAutocomplete";
import { useProjectConfig, useEmployees } from "../lib/project-config";
import { sortAlphaStrings } from "../lib/sortOptions";

// Uhrzeit-Auswahl: Stunde 00–23, Minuten in 5-Minuten-Schritten.
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
const pad2 = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toTimeStr = (d: Date) => `${pad2(d.getHours())}:${pad2(Math.floor(d.getMinutes() / 5) * 5)}`;

export default function ProjectForm({ project, onClose, onSaved }:
  { project: Project | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [autoNum, setAutoNum] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cfg = useProjectConfig();
  const { names: employeeNames } = useEmployees();

  // Baubeginn aus start_at (mit Uhrzeit) ableiten, sonst aus dem alten start_date (nur Datum).
  const _startAt = project?.start_at ? new Date(project.start_at) : null;
  const [f, setF] = useState({
    title: project?.title ?? "",
    project_number: project?.project_number ?? "",
    category: project?.category ?? "",
    stage: project?.stage ?? "",
    contact_id: project?.contact_id ?? "",
    responsible: project?.responsible ?? "",
    street: project?.street ?? "",
    address_extra: project?.address_extra ?? "",
    zip: project?.zip ?? "",
    city: project?.city ?? "",
    country: project?.country ?? "Österreich",
    budget: (project?.budget ?? "") as number | "",
    start_date: _startAt ? toDateStr(_startAt) : (project?.start_date ?? ""),
    start_time: _startAt ? toTimeStr(_startAt) : "",
    end_date: project?.end_date ?? "",
    priority: project?.priority ?? "Normal",
    internal_note: project?.internal_note ?? "",
  });
  // Mitarbeiter-Optionen: echte aktive Mitarbeiter + ggf. bestehender Wert (Bestandsdaten).
  const responsibleOptions = (() => {
    const opts = [...employeeNames];
    if (f.responsible && !opts.includes(f.responsible)) opts.unshift(f.responsible);
    return sortAlphaStrings(opts);
  })();
  // Stunde/Minute aus start_time zusammensetzen (für die beiden Auswahlfelder).
  const [startHour, startMin] = (f.start_time || "").split(":");
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  // Beim Neuanlegen Standard-Typ + ersten Status setzen, sobald die Konfiguration geladen ist
  useEffect(() => {
    if (project) return;
    if (!f.category && cfg.types.length) {
      const firstCat = cfg.types[0].category;
      setF((p) => ({ ...p, category: firstCat, stage: cfg.statusLabelsFor(firstCat)[0] ?? "" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.types, project]);

  // Status-Optionen für den aktuell gewählten Typ; bestehender Wert bleibt sichtbar
  const stageOptions = (() => {
    const opts = cfg.statusLabelsFor(f.category);
    return f.stage && !opts.includes(f.stage) ? [f.stage, ...opts] : opts;
  })();
  const categoryOptions = (() => {
    const opts = cfg.types.map((t) => t.category);
    return sortAlphaStrings(f.category && !opts.includes(f.category) ? [f.category, ...opts] : opts);
  })();

  useEffect(() => {
    Promise.all([
      supabase.from("contacts").select("*").order("contact_number"),
      supabase.from("projects").select("project_number"),
      supabase.from("number_ranges").select("*").eq("doc_type", "projekt").maybeSingle(),
    ]).then(([c, p, nr]) => {
      setContacts((c.data as Contact[]) ?? []);
      const nums = ((p.data as { project_number: string | null }[]) ?? []).map((x) => x.project_number);
      setNumbers(nums.filter(Boolean) as string[]);
      // Vorschlag aus dem Nummernkreis „Projekte" – die echte Nummer wird beim Speichern atomar vergeben.
      const range = nr.data as NumberRange | null;
      const preview = range ? numberPreview(range) : "";
      if (!project) { setAutoNum(preview); setF((prev) => ({ ...prev, project_number: preview })); }
      setLoaded(true);
    });
  }, [project]);

  async function save() {
    setErr(null);
    if (!f.title.trim()) { setErr("Bitte Betreff eingeben."); return; }
    if (!f.contact_id) { setErr("Bitte Kunde auswählen."); return; }
    if (!f.category) { setErr("Bitte Projekttyp auswählen."); return; }
    if (!f.stage) { setErr("Bitte Status auswählen."); return; }
    if (!f.responsible) { setErr("Bitte zuständigen Mitarbeiter auswählen."); return; }
    if (!f.street.trim()) { setErr("Bitte Straße und Hausnummer eingeben."); return; }
    if (!f.zip.trim()) { setErr("Bitte PLZ eingeben."); return; }
    if (!f.city.trim()) { setErr("Bitte Ort eingeben."); return; }
    if (!f.country.trim()) { setErr("Bitte Land eingeben."); return; }
    const num = f.project_number.trim();
    // Bearbeiten: manuelle Nummer auf Duplikat prüfen
    if (project && num && numbers.some((n) => n === num && n !== project.project_number)) {
      setErr(`Die Projektnummer ${num} ist bereits vergeben.`); return;
    }
    setBusy(true);
    let finalNum: string | null = num || null;
    if (!project) {
      if (!num || num === autoNum) {
        // Unverändert/leer → echte Nummer atomar aus dem Nummernkreis „projekt" ziehen
        const { data: rpcNum, error: rpcErr } = await supabase.rpc("next_document_number", { p_doc_type: "projekt" });
        if (rpcErr || !rpcNum) { setBusy(false); setErr(rpcErr?.message ?? "Nummernkreis Projekte nicht gefunden."); return; }
        finalNum = rpcNum as string;
      } else if (numbers.some((n) => n === num)) {
        setBusy(false); setErr(`Die Projektnummer ${num} ist bereits vergeben.`); return;
      }
    }
    const payload = {
      title: f.title.trim(), project_number: finalNum, category: f.category, stage: f.stage,
      contact_id: f.contact_id || null, responsible: f.responsible || null,
      street: f.street || null, address_extra: f.address_extra || null, zip: f.zip || null,
      city: f.city || null, country: f.country || null,
      budget: f.budget === "" ? null : Number(f.budget),
      // Baubeginn als timestamptz (Datum + Uhrzeit); start_date bleibt zusätzlich als reines Datum.
      start_date: f.start_date || null,
      start_at: f.start_date ? new Date(`${f.start_date}T${f.start_time || "00:00"}:00`).toISOString() : null,
      end_date: f.end_date || null, priority: f.priority || null,
      internal_note: f.internal_note || null,
      updated_at: new Date().toISOString(),
    };
    let id = project?.id;
    if (project) {
      const res = await supabase.from("projects").update(payload).eq("id", project.id);
      if (res.error) { setBusy(false); setErr(res.error.message); return; }
      await logProject(project.id, "projekt", "Projekt geändert");
    } else {
      const res = await supabase.from("projects").insert(payload).select("id").single();
      if (res.error || !res.data) { setBusy(false); setErr(res.error?.message ?? "Fehler"); return; }
      id = res.data.id;
      await logProject(res.data.id, "projekt", `Projekt angelegt: ${f.title.trim()}`);
      // Automationen bei Projektanlage (best-effort, blockiert das Anlegen nie).
      await runProjectCreatedAutomations({ projectId: res.data.id, stage: f.stage });
    }
    setBusy(false);
    onSaved(id!);
  }

  return (
    <Modal open onClose={onClose} title={project ? "Projekt bearbeiten" : "Neues Projekt"} size="xl">
      <ErrorBanner message={err} />
      {!loaded ? <div className="py-6 text-center text-sm text-slate-400">Lädt …</div> : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2" data-tour-id="project-form-modal">
          <div className="sm:col-span-2"><label className="label label-req">Betreff</label>
            <input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="z.B. Altbausanierung Beheimgasse" /></div>
          <div><label className="label">Projektnummer</label>
            <input className="input font-mono" value={f.project_number} onChange={(e) => set("project_number", e.target.value)} placeholder="PROJEKT-0001-2026" />
            {!project && <p className="mt-0.5 text-[10px] text-slate-400">Vorschlag aus dem Nummernkreis – wird beim Speichern automatisch vergeben.</p>}</div>
          <div data-tour-id="project-form-type"><label className="label label-req">Projekttyp</label>
            <select className="input" value={f.category}
              onChange={(e) => { const cat = e.target.value; setF((p) => ({ ...p, category: cat, stage: cfg.statusLabelsFor(cat)[0] ?? "" })); }}>
              {f.category === "" && <option value="">– bitte wählen –</option>}
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div data-tour-id="project-form-customer"><label className="label label-req">Kunde</label>
            <CustomerSelect contacts={contacts} value={f.contact_id} onChange={(id) => set("contact_id", id)} /></div>
          <div data-tour-id="project-form-responsible"><label className="label label-req">Zuständiger Mitarbeiter</label>
            <select className="input" value={f.responsible} onChange={(e) => set("responsible", e.target.value)}>
              <option value="">– bitte wählen –</option>
              {responsibleOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></div>
          <div data-tour-id="project-form-status"><label className="label label-req">Status</label>
            <select className="input" value={f.stage} onChange={(e) => set("stage", e.target.value)}>
              {f.stage === "" && <option value="">– bitte wählen –</option>}
              {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>

          <div className="sm:col-span-2" data-tour-id="project-form-address"><label className="label label-req">Straße und Hausnummer</label>
            <AddressAutocomplete value={f.street} zip={f.zip} city={f.city} placeholder="z. B. Schrottgasse 7 – Vorschläge ab 3 Zeichen"
              onChange={(v) => set("street", v)}
              onSelect={(s) => { set("street", s.street); if (s.zip) set("zip", s.zip); if (s.city) set("city", s.city); if (s.country) set("country", s.country); }} /></div>
          <div className="sm:col-span-2"><label className="label">Adresszusatz</label>
            <input className="input" value={f.address_extra} onChange={(e) => set("address_extra", e.target.value)} placeholder="z. B. / Stiege 1 / Top 14 oder / Hof" /></div>
          <div><label className="label label-req">PLZ</label>
            <input className="input" value={f.zip} onChange={(e) => set("zip", e.target.value)} /></div>
          <div><label className="label label-req">Ort</label>
            <input className="input" value={f.city} onChange={(e) => set("city", e.target.value)} /></div>
          <div><label className="label label-req">Land</label>
            <input className="input" value={f.country} onChange={(e) => set("country", e.target.value)} /></div>
          <div><label className="label">Projektvolumen €</label>
            <input type="number" step="0.01" min="0" className="input" value={f.budget} onChange={(e) => set("budget", e.target.value === "" ? "" : Number(e.target.value))} /></div>

          <div><label className="label">Baubeginn</label>
            <div className="flex gap-2">
              <input type="date" className="input flex-1" value={f.start_date}
                onChange={(e) => { const d = e.target.value; setF((p) => ({ ...p, start_date: d, start_time: d ? (p.start_time || "00:00") : "" })); }} />
              <select className="input max-w-[4.5rem]" value={startHour ?? ""} disabled={!f.start_date}
                title="Stunde"
                onChange={(e) => set("start_time", `${e.target.value || "00"}:${startMin ?? "00"}`)}>
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <select className="input max-w-[4.5rem]" value={startMin ?? ""} disabled={!f.start_date}
                title="Minute (5-Minuten-Schritte)"
                onChange={(e) => set("start_time", `${startHour ?? "00"}:${e.target.value || "00"}`)}>
                {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div></div>
          <div><label className="label">Geplante Fertigstellung</label>
            <input type="date" className="input" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
          <div><label className="label">Priorität</label>
            <select className="input" value={f.priority} onChange={(e) => set("priority", e.target.value)}>
              {PROJECT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select></div>
          <div />

          <div className="sm:col-span-2" data-tour-id="project-form-internal-note"><label className="label">Interne Notiz</label>
            <textarea className="input min-h-[70px]" value={f.internal_note} onChange={(e) => set("internal_note", e.target.value)} /></div>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" data-tour-id="project-form-save" disabled={busy || !loaded} onClick={save}>{busy ? "Speichern …" : project ? "Speichern" : "Projekt anlegen"}</button>
      </div>
    </Modal>
  );
}
