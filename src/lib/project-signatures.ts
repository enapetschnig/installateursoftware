// ============================================================
// B4Y SuperAPP – Digitale Unterschriften (Projektbereich „Organisation")
// Projektbezogen, optional verknüpft mit Baubesprechung/Termin/Dokument/
// Auftrag-SUB/Kontakt/Beteiligtem. Unterschrift als PNG-DataURL.
// Mandantenfähig: organization_id wird DB-seitig per Default gesetzt.
// ============================================================
import { supabase } from "./supabase";
import { logProject } from "./projectlog";

export type SignaturePurpose = "protokoll" | "anwesenheit" | "auftrag_sub" | "regie" | "abnahme";
export const SIGNATURE_PURPOSE_LABEL: Record<SignaturePurpose, string> = {
  protokoll: "Baubesprechungsprotokoll",
  anwesenheit: "Anwesenheit Subunternehmer",
  auftrag_sub: "Auftrag-SUB bestätigt",
  regie: "Regie-/Leistungsbestätigung",
  abnahme: "Übergabe / Abnahme",
};

export type ProjectSignature = {
  id: string;
  organization_id: string | null;
  project_id: string;
  meeting_id: string | null;
  planning_event_id: string | null;
  document_ref: string | null;
  order_sub_ref: string | null;
  contact_id: string | null;
  person_id: string | null;
  participant_id: string | null;
  purpose: SignaturePurpose | string;
  signer_name: string;
  signer_company: string | null;
  signer_role: string | null;
  signed_at: string;
  location: string | null;
  signature_data: string | null;   // PNG-DataURL
  note: string | null;
  captured_by: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type SignatureInput = {
  project_id: string;
  meeting_id?: string | null;
  planning_event_id?: string | null;
  document_ref?: string | null;
  order_sub_ref?: string | null;
  contact_id?: string | null;
  person_id?: string | null;
  participant_id?: string | null;
  purpose?: SignaturePurpose | string;
  signer_name: string;
  signer_company?: string | null;
  signer_role?: string | null;
  location?: string | null;
  signature_data: string;
  note?: string | null;
};

export async function listSignatures(projectId: string, opts: { meetingId?: string } = {}): Promise<ProjectSignature[]> {
  let q = supabase.from("project_signatures").select("*")
    .eq("project_id", projectId).is("deleted_at", null)
    .order("signed_at", { ascending: false });
  if (opts.meetingId) q = q.eq("meeting_id", opts.meetingId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as ProjectSignature[]) ?? [];
}

export async function createSignature(input: SignatureInput): Promise<ProjectSignature | null> {
  const { data, error } = await supabase.from("project_signatures").insert({
    project_id: input.project_id,
    meeting_id: input.meeting_id ?? null,
    planning_event_id: input.planning_event_id ?? null,
    document_ref: input.document_ref ?? null,
    order_sub_ref: input.order_sub_ref ?? null,
    contact_id: input.contact_id ?? null,
    person_id: input.person_id ?? null,
    participant_id: input.participant_id ?? null,
    purpose: input.purpose ?? "protokoll",
    signer_name: input.signer_name,
    signer_company: input.signer_company ?? null,
    signer_role: input.signer_role ?? null,
    location: input.location ?? null,
    signature_data: input.signature_data,
    note: input.note ?? null,
  }).select("*").single();
  if (error) throw new Error(error.message);
  const sig = data as ProjectSignature;
  await logProject(
    input.project_id, "unterschrift",
    `${input.signer_company || input.signer_name} hat unterschrieben${input.meeting_id ? " (Baubesprechung)" : ""}: ${SIGNATURE_PURPOSE_LABEL[(input.purpose as SignaturePurpose)] || input.purpose || "Unterschrift"}.`,
  );
  return sig;
}

export async function softDeleteSignature(sig: ProjectSignature, userId: string | null): Promise<void> {
  const { error } = await supabase.from("project_signatures")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq("id", sig.id);
  if (error) throw new Error(error.message);
  await logProject(sig.project_id, "unterschrift", `Unterschrift entfernt: ${sig.signer_company || sig.signer_name}.`);
}
