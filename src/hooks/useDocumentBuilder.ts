// ============================================================
// B4Y SuperAPP – useDocumentBuilder
// Zentrale, dokumenttyp-agnostische Positionsverwaltung:
// State, Auto-Nummerierung, Undo/Redo, Drag&Drop-Sortierung,
// Einfügen an exakter Stelle, Übersicht & dirty-Flag.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DocPosition, renumber, buildOutline, computeSummary, isCommercial, recalcRegieMaterial,
} from "../lib/document-types";

const MAX_HISTORY = 50;

// Jede Positionsänderung: neu nummerieren + prozentuelles Regiematerial nachrechnen.
const prep = (arr: DocPosition[]) => recalcRegieMaterial(renumber(arr));

export type DocumentBuilder = ReturnType<typeof useDocumentBuilder>;

export function useDocumentBuilder(initial: DocPosition[] = [], vatOverride?: number | null, documentDiscountPercent?: number | null) {
  const [positions, setPositionsRaw] = useState<DocPosition[]>(() => prep(initial));
  const [dirty, setDirty] = useState(false);
  // Zuletzt NEU eingefügte Position (Titel/Artikel/Leistung/Textbaustein/variable/Regie).
  // Zentrale Quelle für Auto-Scroll + kurzes Aufleuchten im Canvas – egal über welchen Einfüge-Pfad.
  // mode: "append" = ans Ende (Plus) → Position erscheint unten im Sichtbereich;
  //       "insert" = gezielte Stelle (Drag&Drop/Zwischen-Einfügen) → mittig.
  // Counter erzwingt ein Event auch bei (theoretisch) gleicher ID; Sortieren/Undo setzen ihn NICHT.
  const [lastInserted, setLastInserted] = useState<{ id: string; n: number; mode: "append" | "insert" } | null>(null);
  const insertSeq = useRef(0);
  const markInserted = useCallback((id: string, mode: "append" | "insert" = "append") => {
    insertSeq.current += 1;
    setLastInserted({ id, n: insertSeq.current, mode });
  }, []);

  // Ungespeicherte Änderungen global signalisieren, damit der Auto-Update-Watcher
  // (version-watcher) den automatischen Reload aufschiebt, bis gespeichert wurde.
  // Zähler statt Boolean: mehrere Editor-Instanzen / Mount-Unmount-Races überschreiben
  // sich sonst gegenseitig und der Watcher hielte ein dirty-Dokument fälschlich für sauber.
  useEffect(() => {
    if (!dirty) return;
    const w = window as unknown as { __b4yDirtyCount?: number };
    w.__b4yDirtyCount = (w.__b4yDirtyCount ?? 0) + 1;
    return () => { w.__b4yDirtyCount = Math.max(0, (w.__b4yDirtyCount ?? 1) - 1); };
  }, [dirty]);

  // Undo/Redo-Verlauf
  const past = useRef<DocPosition[][]>([]);
  const future = useRef<DocPosition[][]>([]);
  const [, force] = useState(0);

  /** Snapshot in den Verlauf legen und State setzen (jede mutierende Aktion). */
  const commit = useCallback((next: DocPosition[], markDirty = true) => {
    setPositionsRaw((prev) => {
      past.current = [...past.current.slice(-MAX_HISTORY + 1), prev];
      future.current = [];
      return prep(next);
    });
    if (markDirty) setDirty(true);
    force((x) => x + 1);
  }, []);

  /** Komplettes Ersetzen ohne Verlaufseintrag (z.B. beim Laden). */
  const reset = useCallback((next: DocPosition[]) => {
    past.current = [];
    future.current = [];
    setPositionsRaw(prep(next));
    setDirty(false);
    force((x) => x + 1);
  }, []);

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    setPositionsRaw((prev) => {
      const previous = past.current[past.current.length - 1];
      past.current = past.current.slice(0, -1);
      future.current = [prev, ...future.current];
      return previous;
    });
    setDirty(true);
    force((x) => x + 1);
  }, []);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    setPositionsRaw((prev) => {
      const next = future.current[0];
      future.current = future.current.slice(1);
      past.current = [...past.current, prev];
      return next;
    });
    setDirty(true);
    force((x) => x + 1);
  }, []);

  // ---- Mutationen ----
  const patch = useCallback((id: string, p: Partial<DocPosition>) => {
    setPositionsRaw((prev) => {
      past.current = [...past.current.slice(-MAX_HISTORY + 1), prev];
      future.current = [];
      return prep(prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
    });
    setDirty(true);
    force((x) => x + 1);
  }, []);

  const remove = useCallback((id: string) => {
    commit(positionsLatest().filter((x) => x.id !== id));
  }, [commit]);

  /** An Index einfügen (Drop an exakter Stelle). index = Anzahl davor. */
  const insertAt = useCallback((index: number, item: DocPosition) => {
    const cur = positionsLatest();
    const i = Math.max(0, Math.min(index, cur.length));
    commit([...cur.slice(0, i), item, ...cur.slice(i)]);
    // Ans Ende eingefügt (i === Länge) zählt als "append" → Scroll-Ziel unten.
    markInserted(item.id, i >= cur.length ? "append" : "insert");
  }, [commit, markInserted]);

  const append = useCallback((item: DocPosition) => {
    commit([...positionsLatest(), item]);
    markInserted(item.id, "append");
  }, [commit, markInserted]);

  /** Sortier-Verschiebung per Drag&Drop (activeId vor/auf overId). */
  const moveOver = useCallback((activeId: string, overId: string) => {
    const cur = positionsLatest();
    const from = cur.findIndex((x) => x.id === activeId);
    const to = cur.findIndex((x) => x.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  }, [commit]);

  /** Verschieben an Zielindex (für Drop in Lücke). */
  const moveToIndex = useCallback((activeId: string, index: number) => {
    const cur = positionsLatest();
    const from = cur.findIndex((x) => x.id === activeId);
    if (from < 0) return;
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    const to = Math.max(0, Math.min(index > from ? index - 1 : index, next.length));
    next.splice(to, 0, moved);
    commit(next);
  }, [commit]);

  // Hilfsfunktion: immer den aktuellsten State lesen (vermeidet stale closures)
  const latestRef = useRef<DocPosition[]>(positions);
  latestRef.current = positions;
  function positionsLatest() { return latestRef.current; }

  const outline = useMemo(() => buildOutline(positions), [positions]);
  const summary = useMemo(() => computeSummary(positions, vatOverride, documentDiscountPercent), [positions, vatOverride, documentDiscountPercent]);

  const sourceIds = useMemo(() => {
    const articles: string[] = [], services: string[] = [], texts: string[] = [];
    for (const p of positions) {
      if (p.type === "article" && p.article_id) articles.push(p.article_id);
      if (p.type === "service" && p.service_id) services.push(p.service_id);
      if ((p.type === "text" || p.type === "title") && p.text_block_id) texts.push(p.text_block_id);
    }
    return { articles, services, texts };
  }, [positions]);

  return {
    positions,
    setPositions: commit,
    reset,
    dirty,
    setDirty,
    markSaved: () => setDirty(false),
    patch,
    remove,
    insertAt,
    append,
    moveOver,
    moveToIndex,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    lastInserted,
    // Für Mehrfach-Einfügen über setPositions (Modals): letzte neue Position manuell markieren.
    markInserted,
    outline,
    summary,
    sourceIds,
    isCommercial,
  };
}
