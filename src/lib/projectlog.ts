import { supabase } from "./supabase";

/**
 * Schreibt einen Eintrag ins Projekt-Logbuch (project_log).
 * created_by wird per DB-Default aus auth.uid() gesetzt.
 * Fehler werden bewusst geschluckt – das Logbuch darf den Hauptvorgang nie blockieren.
 */
export async function logProject(project_id: string, kind: string, entry: string, offerId?: string | null): Promise<void> {
  try {
    await supabase.from("project_log").insert({ project_id, kind, entry, offer_id: offerId ?? null });
  } catch {
    /* ignore */
  }
}
