// ============================================================
// Installateursoftware – Regieberichte (Datenlayer)
//
// Arbeitsbericht mit Einsatzzeiten, Kundendaten, Material-Positionen,
// beteiligten Mitarbeitern, Fotos und Kundenunterschrift
// (Tabellen aus Migration 0134). Nummernkreis 'regiebericht' über die
// zentrale RPC next_document_number; Zeiteinträge der Beteiligten über
// die RPC regie_sync_time_entries. Fotos liegen im Bucket project-files
// unter regie/<report_id>/… (signierte URLs, src/lib/storage.ts).
// ============================================================
import { supabase } from "./supabase";

export type RegieStatus = "offen" | "unterschrieben" | "gesendet";

export type RegieReport = {
  id: string;
  report_number: string | null;
  project_id: string | null;
  contact_id: string | null;
  kunde_name: string;
  kunde_strasse: string | null;
  kunde_plz: string | null;
  kunde_ort: string | null;
  kunde_email: string | null;
  kunde_telefon: string | null;
  datum: string;
  start_time: string | null;
  end_time: string | null;
  pause_minutes: number;
  stunden: number;
  beschreibung: string;
  notizen: string | null;
  status: RegieStatus;
  is_verrechnet: boolean;
  unterschrift_kunde: string | null;
  unterschrift_name: string | null;
  unterschrift_am: string | null;
  pdf_path: string | null;
  pdf_gesendet_am: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type RegieMaterial = {
  id?: string;
  report_id?: string;
  article_id: string | null;
  material: string;
  menge: number;
  einheit: string;
  einzelpreis: number;
  notizen: string | null;
  sort_order: number;
};

export type RegieWorker = {
  id?: string;
  report_id?: string;
  employee_id: string;
  is_main: boolean;
  hours: number | null;
};

export type RegiePhoto = {
  id: string;
  report_id: string;
  file_path: string;
  file_name: string | null;
  created_at: string;
};

export const REGIE_STATUS: { value: RegieStatus; label: string; tone: string }[] = [
  { value: "offen", label: "Offen", tone: "amber" },
  { value: "unterschrieben", label: "Unterschrieben", tone: "blue" },
  { value: "gesendet", label: "Gesendet", tone: "green" },
];

export const regieStatusMeta = (s: string) =>
  REGIE_STATUS.find((r) => r.value === s) ?? { value: s, label: s, tone: "slate" };

const REPORT_COLS = "*";

// ------------------------------------------------------------
// Laden
// ------------------------------------------------------------
export type RegieFilter = {
  projectId?: string | null;
  status?: RegieStatus | "alle";
  verrechnet?: boolean | null;
  createdBy?: string | null;
};

export async function loadRegieReports(f: RegieFilter = {}): Promise<RegieReport[]> {
  let q = supabase.from("regie_reports").select(REPORT_COLS).is("deleted_at", null).order("datum", { ascending: false });
  if (f.projectId) q = q.eq("project_id", f.projectId);
  if (f.status && f.status !== "alle") q = q.eq("status", f.status);
  if (f.verrechnet != null) q = q.eq("is_verrechnet", f.verrechnet);
  if (f.createdBy) q = q.eq("created_by", f.createdBy);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map(normalizeReport);
}

export async function loadRegieReport(id: string): Promise<{
  report: RegieReport | null; materials: RegieMaterial[]; workers: RegieWorker[]; photos: RegiePhoto[];
}> {
  const [rep, mat, wrk, pho] = await Promise.all([
    supabase.from("regie_reports").select(REPORT_COLS).eq("id", id).maybeSingle(),
    supabase.from("regie_report_materials").select("*").eq("report_id", id).order("sort_order"),
    supabase.from("regie_report_workers").select("*").eq("report_id", id),
    supabase.from("regie_report_photos").select("*").eq("report_id", id).order("created_at"),
  ]);
  // Bei einem transienten Fehler laut scheitern statt leere Listen zurückzugeben:
  // sonst würde ein anschließendes Speichern Material/Beteiligte fälschlich löschen.
  const subErr = rep.error || mat.error || wrk.error || pho.error;
  if (subErr) throw new Error(subErr.message);
  return {
    report: rep.data ? normalizeReport(rep.data) : null,
    materials: ((mat.data as any[]) ?? []).map((m) => ({ ...m, menge: Number(m.menge), einzelpreis: Number(m.einzelpreis) })),
    workers: ((wrk.data as any[]) ?? []).map((w) => ({ ...w, hours: w.hours != null ? Number(w.hours) : null })),
    photos: (pho.data as RegiePhoto[]) ?? [],
  };
}

function normalizeReport(r: any): RegieReport {
  return {
    ...r,
    pause_minutes: Number(r.pause_minutes) || 0,
    stunden: Number(r.stunden) || 0,
  };
}

// ------------------------------------------------------------
// Speichern
// ------------------------------------------------------------
export type RegieInput = Partial<RegieReport> & {
  materials?: RegieMaterial[];
  workers?: RegieWorker[];
};

/** Neuen Bericht anlegen bzw. bestehenden aktualisieren (inkl. Material + Beteiligte). */
export async function saveRegieReport(input: RegieInput): Promise<{ error?: string; id?: string }> {
  const isNew = !input.id;
  let reportNumber = input.report_number ?? null;

  // Nummernkreis nur bei Neuanlage ziehen (zentrale RPC).
  if (isNew && !reportNumber) {
    const { data, error } = await supabase.rpc("next_document_number", { p_doc_type: "regiebericht" });
    if (error) return { error: error.message };
    reportNumber = (data as string) ?? null;
  }

  const payload: any = {
    id: input.id || undefined,
    report_number: reportNumber,
    project_id: input.project_id ?? null,
    contact_id: input.contact_id ?? null,
    kunde_name: input.kunde_name ?? "",
    kunde_strasse: input.kunde_strasse ?? null,
    kunde_plz: input.kunde_plz ?? null,
    kunde_ort: input.kunde_ort ?? null,
    kunde_email: input.kunde_email ?? null,
    kunde_telefon: input.kunde_telefon ?? null,
    datum: input.datum ?? new Date().toISOString().slice(0, 10),
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    pause_minutes: input.pause_minutes ?? 0,
    stunden: input.stunden ?? 0,
    beschreibung: input.beschreibung ?? "",
    notizen: input.notizen ?? null,
    status: input.status ?? "offen",
  };

  const { data, error } = await supabase.from("regie_reports").upsert(payload).select("id").maybeSingle();
  if (error) return { error: error.message };
  const reportId = (data as any)?.id as string;

  // Material + Beteiligte: einfach ersetzen (Delete + Insert).
  if (input.materials) {
    await supabase.from("regie_report_materials").delete().eq("report_id", reportId);
    if (input.materials.length) {
      await supabase.from("regie_report_materials").insert(
        input.materials.map((m, i) => ({
          report_id: reportId, article_id: m.article_id ?? null, material: m.material,
          menge: m.menge, einheit: m.einheit, einzelpreis: m.einzelpreis, notizen: m.notizen ?? null, sort_order: i,
        })),
      );
    }
  }
  if (input.workers) {
    await supabase.from("regie_report_workers").delete().eq("report_id", reportId);
    if (input.workers.length) {
      await supabase.from("regie_report_workers").insert(
        input.workers.map((w) => ({
          report_id: reportId, employee_id: w.employee_id, is_main: w.is_main, hours: w.hours ?? null,
        })),
      );
    }
    // Zeiteinträge der Beteiligten neu synchronisieren (RPC prüft Rechte).
    await supabase.rpc("regie_sync_time_entries", { p_report_id: reportId });
  }

  return { id: reportId };
}

/** Unterschrift speichern + Status setzen. */
export async function signRegieReport(id: string, dataUrl: string, name: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("regie_reports").update({
    unterschrift_kunde: dataUrl, unterschrift_name: name || null,
    unterschrift_am: new Date().toISOString(), status: "unterschrieben",
  }).eq("id", id);
  return { error: error?.message };
}

export async function setRegieVerrechnet(id: string, verrechnet: boolean): Promise<{ error?: string }> {
  const { error } = await supabase.from("regie_reports").update({ is_verrechnet: verrechnet }).eq("id", id);
  return { error: error?.message };
}

/**
 * Soft-Delete (deleted_at), analog zur Dokumentlogik. Da es ein UPDATE ist,
 * feuert die ON-DELETE-CASCADE der Untertabellen NICHT – die automatisch
 * erzeugten Zeiteinträge der Beteiligten (source_regie_report_id) müssen
 * daher explizit entfernt werden, sonst bleiben verwaiste Stunden in der
 * Auswertung stehen (Material/Beteiligte/Fotos bleiben am soft-gelöschten
 * Bericht hängen und sind über deleted_at gefiltert unsichtbar).
 */
export async function deleteRegieReport(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("regie_reports").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  // Verknüpfte, automatisch erzeugte Zeiteinträge löschen (RLS: eigene/Modulrechte).
  await supabase.from("time_entries").delete().eq("source_regie_report_id", id);
  return {};
}

export async function addRegiePhoto(reportId: string, filePath: string, fileName: string): Promise<void> {
  await supabase.from("regie_report_photos").insert({ report_id: reportId, file_path: filePath, file_name: fileName });
}

export async function deleteRegiePhoto(id: string): Promise<void> {
  await supabase.from("regie_report_photos").delete().eq("id", id);
}

/** Summe Material (netto) eines Berichts. */
export const materialSum = (materials: RegieMaterial[]): number =>
  materials.reduce((a, m) => a + (Number(m.menge) || 0) * (Number(m.einzelpreis) || 0), 0);
