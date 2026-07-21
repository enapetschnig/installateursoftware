// ============================================================
// Installateur SuperAPP – CRM-Board (Vorgänge über alle Quellen)
// ------------------------------------------------------------
// Das Board zeigt ALLES, was gerade offen ist: neue Anfragen, laufende
// Projekte in den Stufen ihrer Projektart und offene Angebote ohne Projekt.
// Quelle ist die View `crm_vorgaenge` (Migration 0164).
//
// Zwei Ansichten:
//   * "Alle Projektarten" → Spalten sind die übergeordneten PHASEN
//     (neu → qualifizierung → angebot → auftrag → umsetzung → abschluss),
//     weil jede Projektart eigene Stufen hat.
//   * Eine Projektart gewählt → Spalten sind deren ECHTE Stufen
//     (z. B. Badsanierung: Anfrage → Besichtigung → … → Übergabe).
// ============================================================
import { supabase } from "./supabase";

/** Feste Achse – ohne sie gäbe es keine gemeinsame Reihenfolge über Projektarten hinweg. */
export const PHASEN = [
  { key: "neu", label: "Neu", color: "blue" },
  { key: "qualifizierung", label: "In Klärung", color: "amber" },
  { key: "angebot", label: "Angebot", color: "violet" },
  { key: "auftrag", label: "Auftrag", color: "green" },
  { key: "umsetzung", label: "In Umsetzung", color: "green" },
  { key: "abschluss", label: "Abschluss", color: "slate" },
  { key: "verloren", label: "Verloren", color: "red" },
] as const;

export interface Vorgang {
  vorgang_id: string;
  quelle: "anfrage" | "projekt" | "angebot";
  titel: string;
  contact_id: string | null;
  kunde: string | null;
  project_id: string | null;
  projektart: string | null;
  stufe: string;
  phase: string;
  stufe_sort: number;
  wert_netto: number | null;
  termin: string | null;
  datum: string;
  route: string;
  unzugeordnet: boolean;
}

export interface Projektart {
  id: string;
  label: string;
  /** Stufen dieser Art in Reihenfolge (Label + Phase). */
  stufen: Array<{ label: string; phase: string; sort_order: number }>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

/** Alle offenen Vorgänge (Anfragen + Projekte + projektlose Angebote). */
export async function loadVorgaenge(): Promise<Vorgang[]> {
  const { data, error } = await supabase
    .from("crm_vorgaenge")
    .select("*")
    .order("datum", { ascending: false })
    .limit(500);
  if (error) {
    console.error("CRM: Vorgänge konnten nicht geladen werden:", error);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    vorgang_id: r.vorgang_id as string,
    quelle: r.quelle as Vorgang["quelle"],
    titel: (r.titel as string) ?? "",
    contact_id: (r.contact_id as string) ?? null,
    kunde: (r.kunde as string) ?? null,
    project_id: (r.project_id as string) ?? null,
    projektart: (r.projektart as string) ?? null,
    stufe: (r.stufe as string) ?? "",
    phase: (r.phase as string) ?? "neu",
    stufe_sort: Number(r.stufe_sort) || 0,
    wert_netto: num(r.wert_netto),
    termin: (r.termin as string) ?? null,
    datum: r.datum as string,
    route: (r.route as string) ?? "",
    unzugeordnet: !!r.unzugeordnet,
  }));
}

/** Projektarten samt ihrer Stufen (für den Filter und die Spalten). */
export async function loadProjektarten(): Promise<Projektart[]> {
  const [{ data: arten, error: e1 }, { data: zuord, error: e2 }] = await Promise.all([
    supabase.from("project_types").select("id,label,sort_order").eq("active", true).order("sort_order"),
    supabase
      .from("project_type_statuses")
      .select("project_type_id,sort_order,project_statuses_global(label,crm_phase)")
      .eq("active", true)
      .order("sort_order"),
  ]);
  if (e1 || e2) {
    console.error("CRM: Projektarten konnten nicht geladen werden:", e1 ?? e2);
    return [];
  }
  const stufenJeArt = new Map<string, Projektart["stufen"]>();
  for (const z of (zuord as Record<string, unknown>[]) ?? []) {
    const g = z.project_statuses_global as { label?: string; crm_phase?: string } | null;
    if (!g?.label) continue;
    const key = z.project_type_id as string;
    const list = stufenJeArt.get(key) ?? [];
    list.push({ label: g.label, phase: g.crm_phase ?? "umsetzung", sort_order: Number(z.sort_order) || 0 });
    stufenJeArt.set(key, list);
  }
  return ((arten as Record<string, unknown>[]) ?? []).map((a) => ({
    id: a.id as string,
    label: a.label as string,
    stufen: (stufenJeArt.get(a.id as string) ?? []).sort((x, y) => x.sort_order - y.sort_order),
  }));
}

/**
 * Vorgang auf eine andere Spalte ziehen.
 * - Projekt   → `projects.stage` (echte Stufe der Projektart)
 * - Anfrage   → passende `crm_pipeline_stages`-Stufe der Ziel-Phase
 * - Angebot   → nicht verschiebbar (die Spalte ergibt sich aus dem Beleg-Status)
 */
export async function moveVorgang(
  v: Vorgang,
  ziel: { stufe?: string; phase: string },
): Promise<{ ok: boolean; grund?: string }> {
  if (v.quelle === "angebot") {
    return { ok: false, grund: "Angebote wandern über ihren Beleg-Status – bitte im Angebot ändern." };
  }
  if (v.quelle === "projekt") {
    if (!ziel.stufe) return { ok: false, grund: "In der Gesamtansicht bitte die Projektart wählen, um Projektstufen zu ändern." };
    const { error } = await supabase.from("projects").update({ stage: ziel.stufe }).eq("id", v.vorgang_id);
    if (error) {
      console.error("CRM: Projektstufe konnte nicht geändert werden:", error);
      return { ok: false, grund: error.message };
    }
    return { ok: true };
  }
  // Anfrage: die Stufe der Ziel-Phase suchen (Pipeline-Stufen aus Migr. 0163).
  const { data } = await supabase
    .from("crm_pipeline_stages")
    .select("id,crm_phase,sort_order")
    .eq("active", true)
    .order("sort_order");
  const treffer = ((data as Array<{ id: string; crm_phase: string }>) ?? []).find((s) => s.crm_phase === ziel.phase);
  if (!treffer) return { ok: false, grund: "Für diese Spalte ist keine Anfragen-Stufe hinterlegt." };
  const { error } = await supabase
    .from("anfragen")
    .update({ pipeline_stage_id: treffer.id })
    .eq("id", v.vorgang_id);
  if (error) {
    console.error("CRM: Anfrage konnte nicht verschoben werden:", error);
    return { ok: false, grund: error.message };
  }
  return { ok: true };
}

// ── Nachfass-Erinnerungen (Angebot versendet → nach X Tagen nachfassen) ──

export interface Nachfass {
  id: string;
  offer_id: string;
  contact_id: string | null;
  faellig_am: string;
  status: string;
  mail_betreff: string | null;
  mail_text: string | null;
  kunde: string | null;
  angebot_nummer: string | null;
  angebot_titel: string | null;
  angebot_netto: number | null;
}

/** Offene Nachfass-Vorgänge (geplant/bereit), fällig zuerst. */
export async function loadNachfass(): Promise<Nachfass[]> {
  const { data, error } = await supabase
    .from("crm_nachfass")
    .select("id,offer_id,contact_id,faellig_am,status,mail_betreff,mail_text,contacts:contact_id(company,first_name,last_name),offers:offer_id(number,title,net)")
    .in("status", ["geplant", "bereit"])
    .order("faellig_am")
    .limit(100);
  if (error) {
    console.error("CRM: Nachfass-Liste konnte nicht geladen werden:", error);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map((r) => {
    const k = r.contacts as { company?: string; first_name?: string; last_name?: string } | null;
    const o = r.offers as { number?: string; title?: string; net?: number } | null;
    return {
      id: r.id as string,
      offer_id: r.offer_id as string,
      contact_id: (r.contact_id as string) ?? null,
      faellig_am: r.faellig_am as string,
      status: r.status as string,
      mail_betreff: (r.mail_betreff as string) ?? null,
      mail_text: (r.mail_text as string) ?? null,
      kunde: k ? k.company || [k.first_name, k.last_name].filter(Boolean).join(" ") || null : null,
      angebot_nummer: o?.number ?? null,
      angebot_titel: o?.title ?? null,
      angebot_netto: num(o?.net),
    };
  });
}

/** Nachfassen abbrechen (Kunde hat sich gemeldet, Angebot hinfällig …). */
export async function stoppeNachfass(id: string, notiz?: string): Promise<boolean> {
  const { error } = await supabase
    .from("crm_nachfass")
    .update({ status: "abgebrochen", notiz: notiz ?? null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("CRM: Nachfassen konnte nicht gestoppt werden:", error);
    return false;
  }
  return true;
}

/** Nach dem Versand: als gesendet markieren (Versand selbst läuft über den Mail-Client). */
export async function markiereNachfassGesendet(id: string): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const { error } = await supabase
    .from("crm_nachfass")
    .update({
      status: "gesendet",
      gesendet_am: new Date().toISOString(),
      gesendet_von: session.session?.user?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("CRM: Nachfassen konnte nicht abgeschlossen werden:", error);
    return false;
  }
  return true;
}

// ── Aufgaben direkt aus dem Board verteilen ──────────────────────────────

export interface Mitarbeiter { id: string; name: string; auth_user_id: string | null }

/** Aktive Mitarbeiter für die Zuweisung (Name aufbereitet). */
export async function loadMitarbeiter(): Promise<Mitarbeiter[]> {
  const { data, error } = await supabase
    .from("employees")
    .select("id,first_name,last_name,auth_user_id,active")
    .eq("active", true)
    .order("last_name");
  if (error) {
    console.error("CRM: Mitarbeiter konnten nicht geladen werden:", error);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map((e) => ({
    id: e.id as string,
    name: [e.first_name, e.last_name].filter(Boolean).join(" ") || "Mitarbeiter",
    auth_user_id: (e.auth_user_id as string) ?? null,
  }));
}

/**
 * Aufgabe aus einem Vorgang heraus anlegen. Landet im normalen Aufgaben-Board
 * (board="crm") und – bei Kundenbezug – zusätzlich im Kundenverlauf.
 */
export async function aufgabeAusVorgang(input: {
  vorgang: Vorgang;
  titel: string;
  faellig: string | null;
  assigneeAuthId: string | null;
  beschreibung?: string | null;
}): Promise<boolean> {
  const { error } = await supabase.from("tasks").insert({
    title: input.titel,
    description: input.beschreibung ?? null,
    due_date: input.faellig,
    assignee_id: input.assigneeAuthId,
    project_id: input.vorgang.project_id,
    contact_id: input.vorgang.contact_id,
    done: false,
    board: "crm",
    bucket: "vorgang",
  });
  if (error) {
    console.error("CRM: Aufgabe konnte nicht angelegt werden:", error);
    return false;
  }
  return true;
}
