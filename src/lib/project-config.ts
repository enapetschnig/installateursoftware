// ============================================================
// B4Y SuperAPP – Projekttypen & Status (DB-gestützt, in Einstellungen editierbar)
// Ersetzt die früheren Code-Konstanten PROJECT_TYPES / STAGES.
// Bestehende Projekte speichern Typ (category) und Status (stage) weiterhin als Text.
//
// Status sind seit Migration 0077 ZENTRAL/global (project_statuses_global) und werden
// je Projekttyp nur noch aktiviert/deaktiviert (project_type_statuses). Die alte
// per-Typ-Tabelle project_statuses bleibt als Fallback (z. B. bevor die Migration
// angewendet wurde) – Dual-Read sorgt für nahtlosen Übergang.
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { PROJECT_TYPES, STAGES } from "./types";

export type ProjectTypeRow = {
  id: string;
  label: string;
  slug: string;
  category: string;
  sort_order: number;
  active: boolean;
};

// Globale Status-Zeile (project_statuses_global).
export type GlobalStatusRow = {
  id: string;
  label: string;
  color: string | null;
  sort_order: number;
  active: boolean;
};

// Zuordnung Status <-> Projekttyp (project_type_statuses).
export type TypeStatusRow = {
  id: string;
  project_type_id: string;
  status_id: string;
  sort_order: number;
  active: boolean;
};

// Alte per-Typ-Status-Zeile (Fallback/Legacy, project_statuses).
export type ProjectStatusRow = {
  id: string;
  project_type_id: string;
  label: string;
  sort_order: number;
  active: boolean;
};

// Fallback, falls die DB (noch) leer ist – die Navigation darf nie leer sein.
export const FALLBACK_TYPES: ProjectTypeRow[] = PROJECT_TYPES.map((t, i) => ({
  id: t.slug, label: t.label, slug: t.slug, category: t.category, sort_order: i + 1, active: true,
}));
export const FALLBACK_STATUSES: string[] = [...STAGES];

export type ProjectConfig = {
  types: ProjectTypeRow[];                       // aktive Typen (mit Fallback)
  statusesByCategory: Record<string, string[]>;  // category → aktive Status-Labels (geordnet)
  statusLabelsFor: (category: string | null | undefined) => string[];
  allStatusLabels: string[];                     // alle global aktiven Status (für "Alle Status")
  loading: boolean;
  reload: () => void;
};

// Live-Aktualisierung: Konsumenten (Sidebar, Formular, Filter) abonnieren Änderungen.
// Wird nach jeder Änderung in den Einstellungen aufgerufen, damit alles sofort frisch ist.
const configListeners = new Set<() => void>();
export function emitProjectConfigChange() {
  configListeners.forEach((l) => l());
}

/** Lädt Projekttypen + Status für Konsumenten (Sidebar, Formular, Filter). Nur aktive. */
export function useProjectConfig(): ProjectConfig {
  const [types, setTypes] = useState<ProjectTypeRow[]>([]);
  const [globalStatuses, setGlobalStatuses] = useState<GlobalStatusRow[]>([]);
  const [typeStatuses, setTypeStatuses] = useState<TypeStatusRow[]>([]);
  const [legacy, setLegacy] = useState<ProjectStatusRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([
      supabase.from("project_types").select("*").eq("active", true).order("sort_order").order("label"),
      supabase.from("project_statuses_global").select("*").eq("active", true).order("sort_order").order("label"),
      supabase.from("project_type_statuses").select("*").eq("active", true).order("sort_order"),
      supabase.from("project_statuses").select("*").eq("active", true).order("sort_order").order("label"),
    ]).then(([t, g, ts, leg]) => {
      setTypes((t.data as ProjectTypeRow[]) ?? []);
      setGlobalStatuses((g.data as GlobalStatusRow[]) ?? []);
      setTypeStatuses((ts.data as TypeStatusRow[]) ?? []);
      setLegacy((leg.data as ProjectStatusRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Auf Änderungen aus den Einstellungen reagieren (sofort neu laden)
  useEffect(() => {
    const fn = () => reload();
    configListeners.add(fn);
    return () => { configListeners.delete(fn); };
  }, [reload]);

  const effectiveTypes = types.length ? types : FALLBACK_TYPES;
  const useGlobal = globalStatuses.length > 0;

  // Globale Status nach id auflösbar machen (für Zuordnung → Label).
  const globalById: Record<string, GlobalStatusRow> = {};
  for (const g of globalStatuses) globalById[g.id] = g;

  // Status-Labels je Projekttyp-ID aufbauen.
  const byTypeId: Record<string, string[]> = {};
  if (useGlobal) {
    // Aktive Zuordnungen → aktive globale Labels (Reihenfolge = Zuordnungs-sort_order).
    for (const m of typeStatuses) {
      const g = globalById[m.status_id];
      if (!g) continue; // global inaktiv/gelöscht
      (byTypeId[m.project_type_id] ??= []).push(g.label);
    }
  } else {
    // Fallback: alte per-Typ-Tabelle.
    for (const st of legacy) (byTypeId[st.project_type_id] ??= []).push(st.label);
  }

  const statusesByCategory: Record<string, string[]> = {};
  for (const ty of effectiveTypes) {
    const labels = byTypeId[ty.id] ?? [];
    statusesByCategory[ty.category] = labels.length ? labels : FALLBACK_STATUSES;
  }

  const statusLabelsFor = (category: string | null | undefined) => {
    if (category && statusesByCategory[category]?.length) return statusesByCategory[category];
    return FALLBACK_STATUSES;
  };

  // Alle global aktiven Status (für den "Alle Status"-Filter ohne Typbezug).
  const allStatusLabels = useGlobal
    ? globalStatuses.map((g) => g.label)
    : (legacy.length
        ? Array.from(new Set(legacy.map((s) => s.label).filter(Boolean)))
        : FALLBACK_STATUSES);

  return { types: effectiveTypes, statusesByCategory, statusLabelsFor, allStatusLabels, loading, reload };
}

// ============================================================
// Mitarbeiter (echte employees-Tabelle) – zentral für Auswahlfelder/Filter.
// Ersetzt die alte Hardcode-Konstante EMPLOYEES. Nur aktive Mitarbeiter.
// ============================================================
export type EmployeeLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  position: string | null;
  active: boolean;
  auth_user_id: string | null;
};

/** Anzeigename eines Mitarbeiters (Vor- + Nachname, Fallback E-Mail). */
export function employeeDisplayName(e: Pick<EmployeeLite, "first_name" | "last_name" | "email">): string {
  const n = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
  return n || (e.email ?? "");
}

const employeeListeners = new Set<() => void>();
export function emitEmployeesChange() {
  employeeListeners.forEach((l) => l());
}

/** Lädt aktive Mitarbeiter für Auswahlfelder/Filter (Name alphabetisch). */
export function useEmployees(): { employees: EmployeeLite[]; names: string[]; loading: boolean; reload: () => void } {
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    supabase
      .from("employees")
      .select("id,first_name,last_name,email,position,active,auth_user_id")
      .eq("active", true)
      .order("last_name")
      .order("first_name")
      .then(({ data }) => {
        setEmployees((data as EmployeeLite[]) ?? []);
        setLoading(false);
      });
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const fn = () => reload();
    employeeListeners.add(fn);
    return () => { employeeListeners.delete(fn); };
  }, [reload]);

  const names = employees.map((e) => employeeDisplayName(e)).filter(Boolean);
  return { employees, names, loading, reload };
}
