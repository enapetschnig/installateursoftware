// ============================================================
// B4Y SuperAPP – Projektbereich „Organisation": Baubesprechungen
// Liste + Editor (Stammdaten, Teilnehmer, Tagesordnung/Notizen/offene
// Punkte/Beschlüsse), Aufgaben aus Punkten (normale tasks-Logik),
// Unterschriften, Protokoll-PDF, Abschluss + Snapshot/Versionierung.
// ============================================================
import { useEffect, useState } from "react";
import {
  Plus, Trash2, ArrowLeft, FileDown, Lock, PenLine, Save, Users, ListChecks, X,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Badge, Spinner, Modal } from "../ui";
import { ConfirmDialog } from "../calc-ui";
import { useAuth } from "../../lib/auth";
import { useCan } from "../../lib/permissions";
import { loadCompanySettings, CompanySettings } from "../../lib/company";
import { openSnapshotPdf, openPdfWindow, buildDocumentPdfFileName } from "../../lib/pdf";
import { loadDocumentVersions } from "../../lib/document-versions";
import {
  ProjectMeeting, MeetingParticipant, MeetingItem, MeetingItemKind, ParticipantRole,
  PARTICIPANT_ROLE_LABEL, ITEM_KIND_LABEL,
  listMeetings, loadMeeting, createMeeting, updateMeeting, saveParticipants, saveItems,
  createTaskFromMeeting, softDeleteMeeting, finalizeMeeting,
} from "../../lib/project-meetings";
import { buildMeetingHtml, MeetingTaskLine } from "../document/printMeeting";
import { listSignatures, ProjectSignature } from "../../lib/project-signatures";
import { SignatureCaptureModal } from "./ProjectSignatures";

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const deDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

type EditRow<T> = T & { _id: string };

/* ============================================================
   Bereich
============================================================ */
export default function ProjectMeetings({ projectId }: { projectId: string }) {
  const can = useCan();
  const [list, setList] = useState<ProjectMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setList(await listMeetings(projectId)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);

  async function addNew() {
    const m = await createMeeting(projectId, { title: "", meeting_date: new Date().toISOString().slice(0, 10) });
    if (m) { await load(); setOpenId(m.id); }
  }

  if (!can("meetings", "view")) {
    return <div className="glass p-4 text-sm text-slate-400">Keine Berechtigung für Baubesprechungen.</div>;
  }

  if (openId) {
    return <MeetingEditor projectId={projectId} meetingId={openId} onBack={() => { setOpenId(null); load(); }} />;
  }

  return (
    <div className="glass p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold">Baubesprechungen</h3>
        {can("meetings", "create") && (
          <button className="btn-primary" onClick={addNew}><Plus size={16} /> Baubesprechung</button>
        )}
      </div>
      {loading ? <Spinner /> : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Noch keine Baubesprechungen.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {list.map((m) => (
            <li key={m.id} className="flex cursor-pointer items-center gap-3 py-3 hover:bg-slate-50 dark:hover:bg-white/5"
              onClick={() => setOpenId(m.id)}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {m.meeting_number && <span className="rounded-lg px-2 py-0.5 font-mono text-xs" style={{ background: "var(--hover)" }}>{m.meeting_number}</span>}
                  <span className="font-medium">{m.title || "Baubesprechung"}</span>
                  <Badge tone={m.status === "abgeschlossen" ? "green" : "slate"}>{m.status === "abgeschlossen" ? "Abgeschlossen" : "Entwurf"}</Badge>
                  {m.status === "abgeschlossen" && <Lock size={13} className="text-slate-400" />}
                </div>
                <div className="text-xs text-slate-400">{deDate(m.meeting_date)}{m.location ? ` · ${m.location}` : ""}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   Editor
============================================================ */
function MeetingEditor({ projectId, meetingId, onBack }: { projectId: string; meetingId: string; onBack: () => void }) {
  const { session } = useAuth();
  const can = useCan();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<ProjectMeeting | null>(null);
  const [head, setHead] = useState({ title: "", meeting_date: "", time_from: "", time_to: "", location: "", next_meeting_date: "", notes: "" });
  const [participants, setParticipants] = useState<EditRow<Partial<MeetingParticipant>>[]>([]);
  const [items, setItems] = useState<EditRow<Partial<MeetingItem>>[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [signatures, setSignatures] = useState<ProjectSignature[]>([]);
  const [project, setProject] = useState<any>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);

  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [capture, setCapture] = useState(false);
  const [taskFrom, setTaskFrom] = useState<{ text: string } | null>(null);

  const isLocked = meeting?.status === "abgeschlossen";

  async function loadAll() {
    setLoading(true);
    const [full, prj, comp] = await Promise.all([
      loadMeeting(meetingId),
      supabase.from("projects").select("project_number,title,street,zip,city").eq("id", projectId).maybeSingle(),
      loadCompanySettings(),
    ]);
    if (full) {
      setMeeting(full.meeting);
      setHead({
        title: full.meeting.title || "", meeting_date: full.meeting.meeting_date || "",
        time_from: full.meeting.time_from || "", time_to: full.meeting.time_to || "",
        location: full.meeting.location || "", next_meeting_date: full.meeting.next_meeting_date || "",
        notes: full.meeting.notes || "",
      });
      setParticipants(full.participants.map((p) => ({ ...p, _id: uid() })));
      setItems(full.items.map((i) => ({ ...i, _id: uid() })));
    }
    setProject(prj.data);
    setCompany(comp);
    await refreshTasksAndSignatures();
    setLoading(false);
  }
  async function refreshTasksAndSignatures() {
    const [{ data: t }, sigs] = await Promise.all([
      supabase.from("tasks").select("*").eq("source_meeting_id", meetingId).order("created_at"),
      listSignatures(projectId, { meetingId }),
    ]);
    setTasks(t ?? []);
    setSignatures(sigs);
  }
  useEffect(() => { loadAll(); /* eslint-disable-line */ }, [meetingId]);

  const setH = (k: keyof typeof head, v: string) => setHead((p) => ({ ...p, [k]: v }));

  function addParticipant() {
    setParticipants((l) => [...l, { _id: uid(), name: "", company: "", role: "sub", present: true }]);
  }
  async function importParticipants() {
    const { data } = await supabase.from("project_participants").select("*").eq("project_id", projectId).order("sort_order");
    const rows = (data ?? []).map((p: any) => ({
      _id: uid(), participant_id: p.id, contact_id: p.contact_id, person_id: p.person_id,
      name: p.name || "", company: "", email: p.email || "",
      role: (p.role || "").toLowerCase().includes("sub") ? "sub" : (p.role || "").toLowerCase().includes("kunde") || (p.role || "").toLowerCase().includes("bauherr") ? "kunde" : (p.role || "").toLowerCase().includes("planer") || (p.role || "").toLowerCase().includes("architekt") ? "planer" : "sonstige",
      present: true,
    }));
    setParticipants((l) => [...l, ...rows]);
  }
  const patchPart = (id: string, p: Partial<MeetingParticipant>) => setParticipants((l) => l.map((x) => x._id === id ? { ...x, ...p } : x));
  const delPart = (id: string) => setParticipants((l) => l.filter((x) => x._id !== id));

  function addItem(kind: MeetingItemKind) { setItems((l) => [...l, { _id: uid(), kind, text: "", status: kind === "open" ? "offen" : null }]); }
  const patchItem = (id: string, p: Partial<MeetingItem>) => setItems((l) => l.map((x) => x._id === id ? { ...x, ...p } : x));
  const delItem = (id: string) => setItems((l) => l.filter((x) => x._id !== id));

  async function doSave(): Promise<boolean> {
    if (!meeting || isLocked) return false;
    setSaving(true); setErr(null);
    try {
      await updateMeeting(meeting.id, {
        title: head.title, meeting_date: head.meeting_date || new Date().toISOString().slice(0, 10),
        time_from: head.time_from || null, time_to: head.time_to || null,
        location: head.location || null, next_meeting_date: head.next_meeting_date || null, notes: head.notes || null,
      });
      await saveParticipants(meeting.id, participants.map((p) => ({
        participant_id: p.participant_id ?? null, contact_id: p.contact_id ?? null, person_id: p.person_id ?? null,
        role: p.role ?? "sonstige", name: p.name ?? "", company: p.company ?? null, email: p.email ?? null, present: p.present ?? true,
      })));
      await saveItems(meeting.id, items.map((i) => ({ kind: i.kind ?? "agenda", text: i.text ?? "", status: i.status ?? null })));
      setSaving(false);
      return true;
    } catch (e: any) { setErr(e?.message || "Speichern fehlgeschlagen."); setSaving(false); return false; }
  }

  function currentTaskLines(): MeetingTaskLine[] {
    return tasks.map((t) => ({ title: t.title, responsible: t.assignee_id ? null : null, due_date: t.due_date, done: !!t.done }));
  }
  function buildHtml(): string {
    const merged: ProjectMeeting = { ...(meeting as ProjectMeeting), ...head } as ProjectMeeting;
    return buildMeetingHtml({
      company,
      project: project ? { project_number: project.project_number, title: project.title, address: [project.street, [project.zip, project.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") } : null,
      meeting: merged,
      participants: participants.map((p) => ({ ...(p as MeetingParticipant) })),
      items: items.map((i) => ({ ...(i as MeetingItem) })),
      tasks: currentTaskLines(),
      signatures,
    });
  }

  async function doPdf() {
    const win = openPdfWindow();
    const fileName = buildDocumentPdfFileName({ number: meeting?.meeting_number, baseLabel: "Protokoll" });
    // Abgeschlossen → eingefrorenen Snapshot drucken; sonst live.
    if (isLocked && meeting) {
      try {
        const versions = await loadDocumentVersions("meeting", meeting.id);
        const snap = versions.find((v) => v.print_html)?.print_html;
        if (snap) { await openSnapshotPdf(snap, win, fileName); return; }
      } catch { /* Fallback live */ }
    }
    await openSnapshotPdf(buildHtml(), win, fileName);
  }

  async function doFinalize() {
    if (!meeting) return;
    setConfirmFinalize(false);
    const ok = await doSave();
    if (!ok) return;
    setSaving(true);
    const res = await finalizeMeeting({ ...meeting, ...head } as ProjectMeeting, buildHtml());
    setSaving(false);
    if ("error" in res) { setErr(res.error); return; }
    await loadAll();
  }

  async function makeTask(text: string, responsible: string, due: string) {
    if (!meeting) return;
    await createTaskFromMeeting(projectId, meeting.id, text, { description: responsible ? `Verantwortlich: ${responsible}` : null, due_date: due || null });
    setTaskFrom(null);
    await refreshTasksAndSignatures();
  }

  if (loading) return <div className="glass p-4"><Spinner /></div>;
  if (!meeting) return <div className="glass p-4 text-sm text-slate-400">Baubesprechung nicht gefunden.</div>;

  return (
    <div className="space-y-3">
      {/* Kopfleiste */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="btn-ghost px-2" onClick={onBack}><ArrowLeft size={18} /> Zurück</button>
        <div className="flex flex-wrap items-center gap-2">
          {meeting.meeting_number && <span className="rounded-lg px-2 py-0.5 font-mono text-xs" style={{ background: "var(--hover)" }}>{meeting.meeting_number}</span>}
          <Badge tone={isLocked ? "green" : "slate"}>{isLocked ? "Abgeschlossen" : "Entwurf"}</Badge>
          {isLocked && <Lock size={14} className="text-slate-400" />}
        </div>
      </div>
      {err && <div className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">{err}</div>}
      {isLocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          Dieses Protokoll ist abgeschlossen. Inhalte sind gesperrt; Änderungen würden eine neue Version erfordern.
        </div>
      )}

      {/* Aktionen */}
      <div className="glass flex flex-wrap items-center gap-2 p-2">
        {!isLocked && can("meetings", "edit") && (
          <button className="btn-primary" disabled={saving} onClick={doSave}><Save size={15} /> {saving ? "Speichert …" : "Speichern"}</button>
        )}
        {(can("meetings", "export") || can("meetings", "print")) && (
          <button className="btn-outline" onClick={doPdf}><FileDown size={15} /> Protokoll-PDF</button>
        )}
        {!isLocked && can("meetings", "finalize") && (
          <button className="btn-outline" disabled={saving} onClick={() => setConfirmFinalize(true)}><Lock size={15} /> Abschließen</button>
        )}
        {!isLocked && can("meetings", "delete") && (
          <button className="btn-outline ml-auto text-rose-600 dark:text-rose-400" onClick={() => setDelOpen(true)}><Trash2 size={15} /> Löschen</button>
        )}
      </div>

      {/* Stammdaten */}
      <div className="glass p-4">
        <h3 className="mb-3 font-bold">Besprechung</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label">Besprechungstitel</label>
            <input className="input" value={head.title} disabled={isLocked} onChange={(e) => setH("title", e.target.value)} placeholder="z.B. Baubesprechung Nr. 3" /></div>
          <div><label className="label">Datum</label>
            <input type="date" className="input" value={head.meeting_date} disabled={isLocked} onChange={(e) => setH("meeting_date", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">von</label><input type="time" className="input" value={head.time_from} disabled={isLocked} onChange={(e) => setH("time_from", e.target.value)} /></div>
            <div><label className="label">bis</label><input type="time" className="input" value={head.time_to} disabled={isLocked} onChange={(e) => setH("time_to", e.target.value)} /></div>
          </div>
          <div><label className="label">Ort</label><input className="input" value={head.location} disabled={isLocked} onChange={(e) => setH("location", e.target.value)} placeholder="Baustelle / Adresse" /></div>
          <div><label className="label">Nächste Besprechung (optional)</label><input type="date" className="input" value={head.next_meeting_date} disabled={isLocked} onChange={(e) => setH("next_meeting_date", e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Protokoll / Besprechungsnotizen</label>
            <textarea className="input min-h-[90px]" value={head.notes} disabled={isLocked} onChange={(e) => setH("notes", e.target.value)} /></div>
        </div>
      </div>

      {/* Teilnehmer */}
      <div className="glass p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Teilnehmer</h3>
          {!isLocked && (
            <div className="flex gap-2">
              <button className="btn-outline" onClick={importParticipants}><Users size={15} /> Beteiligte übernehmen</button>
              <button className="btn-primary" onClick={addParticipant}><Plus size={15} /> Teilnehmer</button>
            </div>
          )}
        </div>
        {participants.length === 0 ? (
          <p className="py-3 text-center text-sm text-slate-400">Noch keine Teilnehmer.</p>
        ) : (
          <div className="space-y-2">
            {participants.map((p) => (
              <div key={p._id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_160px_auto_auto] sm:items-center">
                <input className="input" placeholder="Name" value={p.name ?? ""} disabled={isLocked} onChange={(e) => patchPart(p._id, { name: e.target.value })} />
                <input className="input" placeholder="Firma" value={p.company ?? ""} disabled={isLocked} onChange={(e) => patchPart(p._id, { company: e.target.value })} />
                <select className="input" value={p.role ?? "sonstige"} disabled={isLocked} onChange={(e) => patchPart(p._id, { role: e.target.value as ParticipantRole })}>
                  {Object.entries(PARTICIPANT_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label className="flex items-center gap-1 text-sm text-slate-500"><input type="checkbox" checked={p.present ?? true} disabled={isLocked} onChange={(e) => patchPart(p._id, { present: e.target.checked })} /> anwesend</label>
                {!isLocked && <button className="btn-ghost px-2 text-rose-500" onClick={() => delPart(p._id)}><Trash2 size={15} /></button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Punkte: Tagesordnung / Notizen / offene Punkte / Beschlüsse */}
      <div className="glass p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Tagesordnung, Beschlüsse & offene Punkte</h3>
          {!isLocked && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-outline" onClick={() => addItem("agenda")}><Plus size={14} /> Tagesordnung</button>
              <button className="btn-outline" onClick={() => addItem("decision")}><Plus size={14} /> Beschluss</button>
              <button className="btn-outline" onClick={() => addItem("open")}><Plus size={14} /> Offener Punkt</button>
            </div>
          )}
        </div>
        {items.length === 0 ? (
          <p className="py-3 text-center text-sm text-slate-400">Noch keine Punkte.</p>
        ) : (
          <div className="space-y-2">
            {items.map((i) => (
              <div key={i._id} className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_1fr_auto] sm:items-start">
                <select className="input" value={i.kind ?? "agenda"} disabled={isLocked} onChange={(e) => patchItem(i._id, { kind: e.target.value as MeetingItemKind })}>
                  {Object.entries(ITEM_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <textarea className="input min-h-[42px]" rows={1} placeholder="Text …" value={i.text ?? ""} disabled={isLocked} onChange={(e) => patchItem(i._id, { text: e.target.value })} />
                <div className="flex gap-1">
                  {!isLocked && (i.kind === "open" || i.kind === "decision") && can("meetings", "edit") && (i.text ?? "").trim() && (
                    <button className="btn-ghost px-2" title="Aufgabe erstellen" onClick={() => setTaskFrom({ text: i.text ?? "" })}><ListChecks size={15} /></button>
                  )}
                  {!isLocked && <button className="btn-ghost px-2 text-rose-500" onClick={() => delItem(i._id)}><Trash2 size={15} /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Aufgaben aus dieser Besprechung (normale tasks-Logik) */}
      <div className="glass p-4">
        <h3 className="mb-3 font-bold">Aufgaben aus dieser Besprechung</h3>
        {tasks.length === 0 ? (
          <p className="py-3 text-center text-sm text-slate-400">Noch keine Aufgaben. Über das Aufgaben-Symbol bei offenen Punkten/Beschlüssen erstellen.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-white/5">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className={`min-w-0 flex-1 ${t.done ? "text-slate-400 line-through" : ""}`}>{t.title}</span>
                {t.priority && <Badge tone={t.priority === "Dringend" || t.priority === "Hoch" ? "amber" : "slate"}>{t.priority}</Badge>}
                <span className="text-xs text-slate-400">{t.due_date ? deDate(t.due_date) : ""}</span>
                <Badge tone={t.done ? "green" : "slate"}>{t.done ? "erledigt" : "offen"}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-400">Diese Aufgaben erscheinen auch im normalen Aufgabenbereich des Projekts.</p>
      </div>

      {/* Unterschriften */}
      <div className="glass p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-bold">Unterschriften</h3>
          {can("signatures", "create") && (
            <button className="btn-primary" onClick={() => setCapture(true)}><PenLine size={16} /> Unterschrift erfassen</button>
          )}
        </div>
        {signatures.length === 0 ? (
          <p className="py-3 text-center text-sm text-slate-400">Noch keine Unterschriften.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {signatures.map((s) => (
              <li key={s.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="font-semibold">{s.signer_company || s.signer_name}</div>
                <div className="text-xs text-slate-400">{s.signer_company ? `${s.signer_name} · ` : ""}{s.signer_role || ""}</div>
                {s.signature_data && (
                  <div className="mt-2 rounded-lg border bg-white p-1" style={{ borderColor: "var(--border)" }}>
                    <img src={s.signature_data} alt="Unterschrift" style={{ maxHeight: 70, objectFit: "contain", width: "100%" }} />
                  </div>
                )}
                <div className="mt-1 text-xs text-slate-400">{deDate(s.signed_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmFinalize}
        title="Protokoll abschließen?"
        confirmLabel="Jetzt abschließen"
        message={<>Das Protokoll erhält eine fortlaufende Nummer und wird <b>gesperrt</b>. Ein unveränderlicher PDF-Snapshot wird gespeichert. Spätere Änderungen erfordern eine neue Version.</>}
        onConfirm={doFinalize}
        onClose={() => setConfirmFinalize(false)}
      />
      <ConfirmDialog
        open={delOpen}
        title="Baubesprechung löschen?"
        confirmLabel="Löschen"
        message="Die Baubesprechung wird gelöscht. Bereits erstellte Aufgaben bleiben erhalten."
        onConfirm={async () => { setDelOpen(false); await softDeleteMeeting(meeting, session?.user?.id ?? null); onBack(); }}
        onClose={() => setDelOpen(false)}
      />

      {taskFrom && (
        <TaskFromItemModal initialText={taskFrom.text} onClose={() => setTaskFrom(null)} onCreate={makeTask} />
      )}
      {capture && meeting && (
        <SignatureCaptureModal
          projectId={projectId}
          meetingId={meeting.id}
          defaultPurpose="protokoll"
          onClose={() => setCapture(false)}
          onSaved={() => refreshTasksAndSignatures()}
        />
      )}
    </div>
  );
}

/* ── Kleines Modal: Aufgabe aus Punkt ── */
function TaskFromItemModal({ initialText, onClose, onCreate }: {
  initialText: string; onClose: () => void; onCreate: (text: string, responsible: string, due: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const [responsible, setResponsible] = useState("");
  const [due, setDue] = useState("");
  return (
    <Modal open onClose={onClose} title="Aufgabe aus Besprechung" size="md">
      <div className="space-y-3">
        <div><label className="label">Titel *</label><textarea className="input min-h-[60px]" value={text} onChange={(e) => setText(e.target.value)} /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="label">Zuständig (Person/Firma)</label><input className="input" value={responsible} onChange={(e) => setResponsible(e.target.value)} /></div>
          <div><label className="label">Fällig bis</label><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}><X size={15} /> Abbrechen</button>
        <button className="btn-primary" disabled={!text.trim()} onClick={() => onCreate(text.trim(), responsible.trim(), due)}>Aufgabe erstellen</button>
      </div>
    </Modal>
  );
}
