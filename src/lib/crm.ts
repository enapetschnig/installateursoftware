// ============================================================
// Installateur SuperAPP – CRM-Datenschicht (Kundenakte)
// ------------------------------------------------------------
// Bündelt alle Lese-/Schreibzugriffe der Kundenakte an EINER Stelle, damit
// keine Komponente die Tabellen direkt kennt (Muster wie src/lib/cockpit.ts).
//
// Kernidee: Die Historie wird NICHT dupliziert. `contact_timeline` (View,
// Migration 0159) führt Belege, Projekte, Anfragen, Termine, Regieberichte,
// Mails und Aufgaben mit den erfassten Kontaktereignissen zusammen – die
// Akte ist dadurch ab dem ersten Tag rückwirkend gefüllt.
// ============================================================
import { supabase } from "./supabase";

/** Ein Eintrag im Kunden-Zeitstrahl (View public.contact_timeline). */
export interface TimelineEntry {
  contact_id: string;
  occurred_at: string;
  /** ereignis | dokument | anfrage | termin | regie | mail | projekt | aufgabe */
  kind: string;
  title: string;
  subtitle: string | null;
  note: string | null;
  amount_gross: number | null;
  status: string | null;
  /** Ziel für den Klick (z. B. /angebote/<id>) – null = nicht verlinkt. */
  route: string | null;
  ref_id: string;
  type_slug: string | null;
  color: string | null;
  icon: string | null;
  duration_minutes: number | null;
  created_by: string | null;
}

/** Konfigurierbare Aktivitätsart (crm_activity_types). */
export interface ActivityType {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  color: string | null;
  direction_default: "in" | "out" | "intern" | null;
  counts_as_contact: boolean;
  active: boolean;
  sort_order: number;
}

/** Kennzahlen je Kunde (View public.contact_crm_stats). */
export interface CrmStats {
  offers_count: number;
  offers_open_count: number;
  offers_open_net: number;
  orders_count: number;
  invoices_count: number;
  revenue_net_total: number;
  revenue_net_12m: number;
  open_receivables_gross: number;
  first_document_at: string | null;
  last_document_at: string | null;
}

/** Offene Wiedervorlage/Aufgabe mit Kundenbezug. */
export interface FollowUp {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  done: boolean;
  priority: string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** Filter-Gruppen des Zeitstrahls (UI-Chips). */
export const TIMELINE_FILTER: Record<string, string[]> = {
  alles: [],
  kommunikation: ["ereignis", "mail", "anfrage"],
  dokumente: ["dokument"],
  termine: ["termin", "aufgabe"],
  projekte: ["projekt", "regie"],
};

/**
 * Lädt den Zeitstrahl eines Kontakts (neueste zuerst, paginiert).
 * Fehler werden NICHT geworfen – eine kaputte Teilabfrage darf die Akte
 * nicht unbenutzbar machen.
 */
export async function loadTimeline(
  contactId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<TimelineEntry[]> {
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;
  const { data, error } = await supabase
    .from("contact_timeline")
    .select("*")
    .eq("contact_id", contactId)
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error("CRM: Zeitstrahl konnte nicht geladen werden:", error);
    return [];
  }
  return ((data as TimelineEntry[]) ?? []).map((e) => ({
    ...e,
    amount_gross: e.amount_gross === null ? null : num(e.amount_gross),
  }));
}

/** Aktive Aktivitätsarten (für die Erfassung + Icons/Farben im Zeitstrahl). */
export async function loadActivityTypes(): Promise<ActivityType[]> {
  const { data, error } = await supabase
    .from("crm_activity_types")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) {
    console.error("CRM: Aktivitätsarten konnten nicht geladen werden:", error);
    return [];
  }
  return (data as ActivityType[]) ?? [];
}

/** Kennzahlen eines Kunden (Umsatz, offene Angebote, offene Forderungen). */
export async function loadCrmStats(contactId: string): Promise<CrmStats | null> {
  const { data, error } = await supabase
    .from("contact_crm_stats")
    .select("*")
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("CRM: Kennzahlen konnten nicht geladen werden:", error);
    return null;
  }
  const d = data as Record<string, unknown>;
  return {
    offers_count: num(d.offers_count),
    offers_open_count: num(d.offers_open_count),
    offers_open_net: num(d.offers_open_net),
    orders_count: num(d.orders_count),
    invoices_count: num(d.invoices_count),
    revenue_net_total: num(d.revenue_net_total),
    revenue_net_12m: num(d.revenue_net_12m),
    open_receivables_gross: num(d.open_receivables_gross),
    first_document_at: (d.first_document_at as string) ?? null,
    last_document_at: (d.last_document_at as string) ?? null,
  };
}

/** Offene Wiedervorlagen eines Kunden (= Aufgaben mit contact_id). */
export async function loadFollowUps(contactId: string): Promise<FollowUp[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id,title,description,due_date,done,priority")
    .eq("contact_id", contactId)
    .order("done")
    .order("due_date", { nullsFirst: false })
    .limit(50);
  if (error) {
    console.error("CRM: Wiedervorlagen konnten nicht geladen werden:", error);
    return [];
  }
  return (data as FollowUp[]) ?? [];
}

export interface LogEventInput {
  contactId: string;
  /** slug einer Aktivitätsart, z. B. "telefon_aus" */
  typeSlug?: string | null;
  activityTypeId?: string | null;
  subject?: string | null;
  note?: string | null;
  occurredAt?: string | null;
  durationMinutes?: number | null;
  direction?: "in" | "out" | "intern" | null;
  contactPersonId?: string | null;
  projectId?: string | null;
  anfrageId?: string | null;
  /** Herkunft: manual (Default) | mail_out | call | document | ai … */
  source?: string;
  /** Idempotenz-Anker gegen Doppeleinträge (z. B. incoming_mails.id). */
  sourceRefId?: string | null;
  transcript?: string | null;
}

/**
 * Schreibt ein Kontaktereignis. EINZIGER Schreibweg in contact_events –
 * damit automatische Protokollierung (Mailversand, Anruf) und manuelle
 * Erfassung dieselbe Logik nutzen.
 * Gibt die neue ID zurück, oder null bei Fehler (Aufrufer darf nie crashen).
 */
export async function logContactEvent(input: LogEventInput): Promise<string | null> {
  let activityTypeId = input.activityTypeId ?? null;
  if (!activityTypeId && input.typeSlug) {
    const { data } = await supabase
      .from("crm_activity_types")
      .select("id")
      .eq("slug", input.typeSlug)
      .maybeSingle();
    activityTypeId = (data as { id: string } | null)?.id ?? null;
  }
  const row = {
    contact_id: input.contactId,
    activity_type_id: activityTypeId,
    contact_person_id: input.contactPersonId ?? null,
    project_id: input.projectId ?? null,
    anfrage_id: input.anfrageId ?? null,
    direction: input.direction ?? null,
    subject: input.subject?.trim() || null,
    note: input.note?.trim() || null,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    duration_minutes: input.durationMinutes ?? null,
    transcript: input.transcript ?? null,
    source: input.source ?? "manual",
    source_ref_id: input.sourceRefId ?? null,
  };
  const { data, error } = await supabase
    .from("contact_events")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    // 23505 = Unique-Verletzung auf (org, source, source_ref_id): das Ereignis
    // wurde bereits protokolliert (z. B. erneutes Mail-Polling) – kein Fehler.
    if (error.code !== "23505") console.error("CRM: Ereignis konnte nicht gespeichert werden:", error);
    return null;
  }
  return (data as { id: string }).id;
}

/** Kontaktereignis löschen (nur eigene Erfassungen sinnvoll). */
export async function deleteContactEvent(id: string): Promise<boolean> {
  const { error } = await supabase.from("contact_events").delete().eq("id", id);
  if (error) {
    console.error("CRM: Ereignis konnte nicht gelöscht werden:", error);
    return false;
  }
  return true;
}

/** Wiedervorlage anlegen = Aufgabe mit Kundenbezug (kein zweites Modul). */
export async function createFollowUp(input: {
  contactId: string;
  title: string;
  dueDate: string;
  description?: string | null;
  projectId?: string | null;
}): Promise<boolean> {
  const { error } = await supabase.from("tasks").insert({
    contact_id: input.contactId,
    project_id: input.projectId ?? null,
    title: input.title,
    description: input.description ?? null,
    due_date: input.dueDate,
    done: false,
    board: "crm",
    bucket: "wiedervorlage",
  });
  if (error) {
    console.error("CRM: Wiedervorlage konnte nicht angelegt werden:", error);
    return false;
  }
  return true;
}

/** Wiedervorlage abhaken. */
export async function completeFollowUp(id: string): Promise<boolean> {
  const { error } = await supabase.from("tasks").update({ done: true }).eq("id", id);
  if (error) {
    console.error("CRM: Wiedervorlage konnte nicht abgehakt werden:", error);
    return false;
  }
  return true;
}

/**
 * Ausgehende Mail im Kundenverlauf festhalten.
 *
 * Ausgehende Mails werden nirgends persistiert – ohne diesen Haken wäre die
 * halbe Kommunikation in der Akte unsichtbar. Der Kontakt wird über die
 * Empfängeradresse ermittelt (SQL-Funktion crm_match_contact_by_email; bei
 * Mehrdeutigkeit bewusst keine Zuordnung).
 *
 * Best effort: schlägt irgendetwas fehl, wird NICHT geworfen – ein
 * CRM-Protokollfehler darf den Mailversand nie beeinträchtigen.
 */
export async function logOutgoingMail(input: {
  toEmails: string[];
  subject: string;
  bodyText?: string | null;
  projectId?: string | null;
  contactId?: string | null;
}): Promise<void> {
  try {
    let contactId = input.contactId ?? null;
    for (const mail of input.toEmails) {
      if (contactId) break;
      const { data } = await supabase.rpc("crm_match_contact_by_email", { p_email: mail });
      if (typeof data === "string") contactId = data;
    }
    if (!contactId) return;
    await logContactEvent({
      contactId,
      typeSlug: "mail_aus",
      direction: "out",
      subject: input.subject,
      note: (input.bodyText ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null,
      projectId: input.projectId ?? null,
      source: "mail_out",
    });
  } catch {
    /* Protokollierung ist Zusatznutzen – niemals den Versand stören */
  }
}

/** "vor 34 Tagen" – kurze, menschliche Zeitangabe für die Akte. */
export function seitLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const tage = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(tage)) return null;
  if (tage <= 0) return "heute";
  if (tage === 1) return "gestern";
  if (tage < 31) return `vor ${tage} Tagen`;
  const monate = Math.floor(tage / 30);
  if (monate < 12) return `vor ${monate} Monat${monate === 1 ? "" : "en"}`;
  const jahre = Math.floor(tage / 365);
  return `vor ${jahre} Jahr${jahre === 1 ? "" : "en"}`;
}
