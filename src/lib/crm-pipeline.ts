// ============================================================
// Installateur SuperAPP – CRM-Pipeline (Verkaufschancen)
// ------------------------------------------------------------
// Datenschicht für das Kanban-Board. Eine Verkaufschance IST eine Anfrage
// (keine zweite Lead-Tabelle) – sie bewegt sich über konfigurierbare Stufen
// aus `crm_pipeline_stages` (Migration 0163).
// ============================================================
import { supabase } from "./supabase";

export interface PipelineStage {
  id: string;
  slug: string;
  label: string;
  color: string | null;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
  default_probability: number | null;
  active: boolean;
}

export interface Chance {
  id: string;
  subject: string | null;
  caller_name: string | null;
  contact_name: string | null;
  related_contact_id: string | null;
  pipeline_stage_id: string | null;
  expected_value_net: number | null;
  probability: number | null;
  expected_close_date: string | null;
  status: string | null;
  created_at: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

/** Aktive Pipeline-Stufen in Anzeigereihenfolge. */
export async function loadStages(): Promise<PipelineStage[]> {
  const { data, error } = await supabase
    .from("crm_pipeline_stages")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) {
    console.error("CRM: Pipeline-Stufen konnten nicht geladen werden:", error);
    return [];
  }
  return (data as PipelineStage[]) ?? [];
}

/**
 * Verkaufschancen laden. Archivierte Anfragen bleiben draußen – das Board
 * soll zeigen, was WIRKLICH in der Schwebe ist.
 */
export async function loadChancen(): Promise<Chance[]> {
  const { data, error } = await supabase
    .from("anfragen")
    .select("id,subject,caller_name,related_contact_id,pipeline_stage_id,expected_value_net,probability,expected_close_date,status,created_at,contacts:related_contact_id(company,first_name,last_name)")
    .neq("status", "archiviert")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    console.error("CRM: Verkaufschancen konnten nicht geladen werden:", error);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map((r) => {
    const k = r.contacts as { company?: string; first_name?: string; last_name?: string } | null;
    const kontaktName = k
      ? k.company || [k.first_name, k.last_name].filter(Boolean).join(" ") || null
      : null;
    return {
      id: r.id as string,
      subject: (r.subject as string) ?? null,
      caller_name: (r.caller_name as string) ?? null,
      contact_name: kontaktName,
      related_contact_id: (r.related_contact_id as string) ?? null,
      pipeline_stage_id: (r.pipeline_stage_id as string) ?? null,
      expected_value_net: num(r.expected_value_net),
      probability: num(r.probability),
      expected_close_date: (r.expected_close_date as string) ?? null,
      status: (r.status as string) ?? null,
      created_at: r.created_at as string,
    };
  });
}

/**
 * Chance auf eine andere Stufe schieben. Die Wahrscheinlichkeit wird aus der
 * Zielstufe vorbelegt, solange sie nicht manuell abweicht – der Trigger
 * schreibt den Wechsel zusätzlich in den Kundenverlauf.
 */
export async function moveChance(
  chanceId: string,
  stageId: string,
  stages: PipelineStage[],
): Promise<boolean> {
  const ziel = stages.find((s) => s.id === stageId);
  const patch: Record<string, unknown> = { pipeline_stage_id: stageId };
  if (ziel?.default_probability !== null && ziel?.default_probability !== undefined) {
    patch.probability = ziel.default_probability;
  }
  const { error } = await supabase.from("anfragen").update(patch).eq("id", chanceId);
  if (error) {
    console.error("CRM: Chance konnte nicht verschoben werden:", error);
    return false;
  }
  return true;
}

/** Erwarteten Wert / Termin einer Chance pflegen. */
export async function updateChance(
  chanceId: string,
  patch: { expected_value_net?: number | null; probability?: number | null; expected_close_date?: string | null; lost_reason?: string | null },
): Promise<boolean> {
  const { error } = await supabase.from("anfragen").update(patch).eq("id", chanceId);
  if (error) {
    console.error("CRM: Chance konnte nicht aktualisiert werden:", error);
    return false;
  }
  return true;
}
