// ============================================================
// B4Y SuperAPP – Wiederverwendbare, persistente Tabellensortierung
// ------------------------------------------------------------
// Ein Hook für ALLE Listen-Tabellen: Klick auf Spaltenkopf sortiert
// (1. Klick aufsteigend, 2. Klick absteigend). Die aktive Spalte +
// Richtung werden pro BENUTZER und pro TABELLE im localStorage
// gespeichert (es gibt keine user_preferences-Tabelle) und nach
// Refresh/erneutem Öffnen wiederhergestellt.
//
// Typgerecht: "text" (de-AT-Collator aus sortOptions), "number"
// (auch Geldbeträge), "date" (zeitlich). Leere Werte landen IMMER
// am Ende, unabhängig von der Richtung.
//
// Wirkt NUR auf die bereits gefilterte/gesuchte Liste – Suche,
// Filter und Pagination bleiben unberührt.
// ============================================================
import { useCallback, useState } from "react";
import { compareAlpha } from "./sortOptions";

export type SortDir = "asc" | "desc";
export type SortType = "text" | "number" | "date";
export type SortState = { key: string | null; dir: SortDir };

export type SortAccessors<T> = Record<string, { get: (row: T) => unknown; type?: SortType }>;

const PREFIX = "b4y-sort";
const storageKey = (tableKey: string, userId?: string | null) => `${PREFIX}:${userId ?? "anon"}:${tableKey}`;

function loadStored(tableKey: string, userId?: string | null): SortState | null {
  try {
    const raw = localStorage.getItem(storageKey(tableKey, userId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && (p.key === null || typeof p.key === "string") && (p.dir === "asc" || p.dir === "desc")) {
      return { key: p.key, dir: p.dir };
    }
  } catch { /* defektes/blockiertes localStorage ignorieren */ }
  return null;
}

/**
 * @param tableKey  eindeutiger Schlüssel je Tabelle, z. B. "contacts", "projects"
 * @param accessors Spaltenschlüssel → Wertzugriff + Datentyp
 * @param opts.userId  aktueller Benutzer (für getrennte Speicherung); opts.default Startsortierung
 */
export function useTableSort<T>(
  tableKey: string,
  accessors: SortAccessors<T>,
  opts: { userId?: string | null; default?: SortState } = {},
) {
  const userId = opts.userId ?? null;
  const [sort, setSort] = useState<SortState>(() => loadStored(tableKey, userId) ?? opts.default ?? { key: null, dir: "asc" });

  const onSort = useCallback((key: string) => {
    setSort((prev) => {
      const next: SortState = prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" };
      try { localStorage.setItem(storageKey(tableKey, userId), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [tableKey, userId]);

  const sortRows = useCallback((rows: T[]): T[] => {
    const acc = sort.key ? accessors[sort.key] : undefined;
    if (!sort.key || !acc) return rows;
    const type = acc.type ?? "text";
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc.get(a);
      const vb = acc.get(b);
      const na = va === null || va === undefined || va === "";
      const nb = vb === null || vb === undefined || vb === "";
      if (na && nb) return 0;
      if (na) return 1;   // leere Werte immer ans Ende …
      if (nb) return -1;  // … unabhängig von der Richtung
      let r: number;
      if (type === "number") r = Number(va) - Number(vb);
      else if (type === "date") r = new Date(va as string | number | Date).getTime() - new Date(vb as string | number | Date).getTime();
      else r = compareAlpha(String(va), String(vb));
      return r * factor;
    });
  }, [sort, accessors]);

  return { sort, onSort, sortRows };
}
