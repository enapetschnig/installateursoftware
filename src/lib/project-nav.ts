// ============================================================
// B4Y SuperAPP – Projekt-Navigation: Sidebar-Bereich vormerken
// Eine Quelle der Wahrheit für den „zuletzt aktiven Bereich" je Projekt.
// ProjectDetail liest diesen Wert beim Mount (readStoredSection) und aktiviert
// den passenden Reiter. Editoren nutzen rememberProjectSection(...) bevor sie
// nach /projekte/:id zurücknavigieren (z.B. nach dem Abschließen), damit der
// fachlich richtige Bereich (Angebote/Aufträge/Rechnungen) offen ist.
// Mandantenneutral: nur UI-Navigation, keine Firmenlogik.
// ============================================================

export const projectSectionStorageKey = (projectId?: string | null) =>
  `b4y:lastProjectSection:${projectId ?? ""}`;

/** Merkt den gewünschten Projekt-Sidebar-Bereich (sessionStorage, je Projekt). */
export function rememberProjectSection(projectId: string | null | undefined, section: string): void {
  try {
    if (projectId) sessionStorage.setItem(projectSectionStorageKey(projectId), section);
  } catch {
    /* sessionStorage evtl. nicht verfügbar – unkritisch */
  }
}
