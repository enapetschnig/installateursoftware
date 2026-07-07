// ============================================================
// B4Y SuperAPP – Baubesprechungen (Projektbereich „Organisation")
// CRUD für Besprechungen, Teilnehmer, TOPs/Beschlüsse/offene Punkte.
// Aufgaben aus offenen Punkten landen in der NORMALEN tasks-Logik
// (source_type='meeting'), keine Doppellogik.
// Mandantenfähig: organization_id wird DB-seitig per Default gesetzt.
// ============================================================
import { supabase } from "./supabase";
import { logProject } from "./projectlog";
import { finalizeDocumentVersion, logDocumentAudit } from "./document-versions";

export type MeetingStatus = "entwurf" | "abgeschlossen";

export type ProjectMeeting = {
  id: string;
  organization_id: string | null;
  project_id: string;
  meeting_number: string | null;
  title: string;
  meeting_date: string;            // YYYY-MM-DD
  time_from: string | null;
  time_to: string | null;
  location: string | null;
  status: MeetingStatus;
  notes: string | null;
  next_meeting_date: string | null;
  planning_event_id: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
};

export type ParticipantRole = "intern" | "kunde" | "planer" | "sub" | "sonstige";
export const PARTICIPANT_ROLE_LABEL: Record<ParticipantRole, string> = {
  intern: "Interner Mitarbeiter",
  kunde: "Kunde / Bauherr",
  planer: "Planer / Architekt",
  sub: "Subunternehmer",
  sonstige: "Sonstige",
};

export type MeetingParticipant = {
  id: string;
  meeting_id: string;
  participant_id: string | null;
  contact_id: string | null;
  person_id: string | null;
  role: ParticipantRole | string;
  name: string;
  company: string | null;
  email: string | null;
  present: boolean;
  sort_order: number;
};

export type MeetingItemKind = "agenda" | "note" | "open" | "decision";
export const ITEM_KIND_LABEL: Record<MeetingItemKind, string> = {
  agenda: "Tagesordnung",
  note: "Besprechungsnotiz",
  open: "Offener Punkt",
  decision: "Beschluss",
};

export type MeetingItem = {
  id: string;
  meeting_id: string;
  kind: MeetingItemKind | string;
  text: string;
  status: string | null;
  sort_order: number;
};

export type MeetingFull = {
  meeting: ProjectMeeting;
  participants: MeetingParticipant[];
  items: MeetingItem[];
};

/* ── Liste ── */
export async function listMeetings(projectId: string): Promise<ProjectMeeting[]> {
  const { data, error } = await supabase
    .from("project_meetings")
    .select("*")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("meeting_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ProjectMeeting[]) ?? [];
}

/* ── Einzelne Besprechung mit Teilnehmern + Punkten ── */
export async function loadMeeting(id: string): Promise<MeetingFull | null> {
  const { data: m } = await supabase.from("project_meetings").select("*").eq("id", id).maybeSingle();
  if (!m) return null;
  const [{ data: parts }, { data: items }] = await Promise.all([
    supabase.from("project_meeting_participants").select("*").eq("meeting_id", id).order("sort_order"),
    supabase.from("project_meeting_items").select("*").eq("meeting_id", id).order("sort_order"),
  ]);
  return {
    meeting: m as ProjectMeeting,
    participants: (parts as MeetingParticipant[]) ?? [],
    items: (items as MeetingItem[]) ?? [],
  };
}

/* ── Anlegen ── */
export async function createMeeting(projectId: string, patch: Partial<ProjectMeeting>): Promise<ProjectMeeting | null> {
  const { data, error } = await supabase.from("project_meetings").insert({
    project_id: projectId,
    title: patch.title ?? "",
    meeting_date: patch.meeting_date ?? new Date().toISOString().slice(0, 10),
    time_from: patch.time_from ?? null,
    time_to: patch.time_to ?? null,
    location: patch.location ?? null,
    notes: patch.notes ?? null,
    next_meeting_date: patch.next_meeting_date ?? null,
    status: "entwurf",
  }).select("*").single();
  if (error) throw new Error(error.message);
  const m = data as ProjectMeeting;
  await logProject(projectId, "besprechung", `Baubesprechung erstellt: ${m.title || "(ohne Titel)"} (${m.meeting_date})`);
  return m;
}

/* ── Kopf-/Stammdaten speichern (nur Entwurf) ── */
export async function updateMeeting(id: string, patch: Partial<ProjectMeeting>): Promise<void> {
  const { error } = await supabase.from("project_meetings").update({
    title: patch.title,
    meeting_date: patch.meeting_date,
    time_from: patch.time_from ?? null,
    time_to: patch.time_to ?? null,
    location: patch.location ?? null,
    notes: patch.notes ?? null,
    next_meeting_date: patch.next_meeting_date ?? null,
    updated_at: new Date().toISOString(),
    updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── Teilnehmer komplett speichern (ersetzen) ── */
export async function saveParticipants(meetingId: string, list: Partial<MeetingParticipant>[]): Promise<void> {
  await supabase.from("project_meeting_participants").delete().eq("meeting_id", meetingId);
  if (!list.length) return;
  const rows = list.map((p, i) => ({
    meeting_id: meetingId,
    participant_id: p.participant_id ?? null,
    contact_id: p.contact_id ?? null,
    person_id: p.person_id ?? null,
    role: p.role ?? "sonstige",
    name: p.name ?? "",
    company: p.company ?? null,
    email: p.email ?? null,
    present: p.present ?? true,
    sort_order: i,
  }));
  const { error } = await supabase.from("project_meeting_participants").insert(rows);
  if (error) throw new Error(error.message);
}

/* ── Punkte (Tagesordnung/Notizen/offene Punkte/Beschlüsse) komplett speichern ── */
export async function saveItems(meetingId: string, list: Partial<MeetingItem>[]): Promise<void> {
  await supabase.from("project_meeting_items").delete().eq("meeting_id", meetingId);
  const clean = list.filter((it) => (it.text ?? "").trim().length > 0);
  if (!clean.length) return;
  const rows = clean.map((it, i) => ({
    meeting_id: meetingId,
    kind: it.kind ?? "agenda",
    text: it.text ?? "",
    status: it.status ?? null,
    sort_order: i,
  }));
  const { error } = await supabase.from("project_meeting_items").insert(rows);
  if (error) throw new Error(error.message);
}

/* ── Aufgabe aus Besprechungspunkt erzeugen (normale tasks-Logik) ── */
export async function createTaskFromMeeting(
  projectId: string, meetingId: string, title: string,
  opts: { description?: string | null; due_date?: string | null; priority?: string } = {},
): Promise<void> {
  const { error } = await supabase.from("tasks").insert({
    project_id: projectId,
    title: title.trim(),
    description: opts.description ?? null,
    due_date: opts.due_date || null,
    priority: opts.priority ?? "Normal",
    done: false,
    source_type: "meeting",
    source_meeting_id: meetingId,
  });
  if (error) throw new Error(error.message);
  await logProject(projectId, "aufgabe", `Aufgabe aus Baubesprechung erstellt: ${title.trim()}`);
}

/* ── Soft-Delete (nur Entwurf) ── */
export async function softDeleteMeeting(meeting: ProjectMeeting, userId: string | null): Promise<void> {
  const { error } = await supabase.from("project_meetings")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq("id", meeting.id);
  if (error) throw new Error(error.message);
  await logProject(meeting.project_id, "besprechung", `Baubesprechung gelöscht: ${meeting.title || meeting.meeting_date}`);
}

/* ── Finalisieren: Nummer vergeben, sperren, Snapshot + Audit + Logbuch ── */
export async function finalizeMeeting(meeting: ProjectMeeting, printHtml: string): Promise<{ number: string } | { error: string }> {
  // Protokoll-Nummer atomar über den (mandantenfähigen) Nummernkreis
  let number = meeting.meeting_number;
  if (!number) {
    const { data: num, error: rpcErr } = await supabase.rpc("next_document_number", { p_doc_type: "protokoll" });
    if (rpcErr) return { error: rpcErr.message };
    number = (num as string) || null;
  }
  const { error } = await supabase.from("project_meetings").update({
    meeting_number: number,
    status: "abgeschlossen",
    finalized_at: new Date().toISOString(),
    finalized_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", meeting.id);
  if (error) return { error: error.message };

  // Unveränderlicher Druckstand (Snapshot) + Audit
  await finalizeDocumentVersion({
    sourceTable: "meeting",
    sourceId: meeting.id,
    status: "abgeschlossen",
    title: meeting.title,
    docNumber: number,
    data: { head: meeting },
    summary: null,
    printHtml,
    withAudit: true,
    auditDetail: `Protokoll ${number ?? ""} abgeschlossen`.trim(),
  });
  await logProject(meeting.project_id, "besprechung", `Protokoll zur Baubesprechung abgeschlossen${number ? ` (${number})` : ""}.`);
  return { number: number ?? "" };
}

/** Erneutes Bearbeiten nach Abschluss → Audit-Vermerk (Inhalt/Unterschriften nachvollziehbar). */
export async function logMeetingChangeAfterFinalize(meeting: ProjectMeeting, detail: string): Promise<void> {
  await logDocumentAudit("meeting", meeting.id, "edit_after_finalize", detail);
  await logProject(meeting.project_id, "besprechung", `Änderung nach Abschluss: ${detail}`);
}
