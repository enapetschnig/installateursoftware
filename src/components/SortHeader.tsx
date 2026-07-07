// ============================================================
// B4Y SuperAPP – Sortierbarer Tabellen-Spaltenkopf
// ------------------------------------------------------------
// Wird zusammen mit useTableSort verwendet. Klick sortiert die Spalte;
// die aktive Spalte + Richtung werden mit Pfeil-Indikator angezeigt.
// Ersetzt ein <th> 1:1 (gleiche Klassen/Abstände wie bestehende Köpfe).
// ============================================================
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { SortState } from "../lib/useTableSort";

export function SortHeader({
  label, sortKey, sort, onSort, align = "left", className = "", padClass = "px-4 py-3", title,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: "left" | "right" | "center";
  className?: string;
  /** Zellen-Innenabstand – nur überschreiben, wenn die Tabelle dichtere Köpfe (z. B. px-3) nutzt */
  padClass?: string;
  /** Erklärender Tooltip auf dem Spaltenkopf */
  title?: string;
}) {
  const active = sort.key === sortKey;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th className={`${padClass} ${className}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`inline-flex w-full items-center gap-1 ${justify} text-xs font-semibold uppercase tracking-wide transition-colors hover:text-slate-700 dark:hover:text-slate-200 ${active ? "text-slate-700 dark:text-slate-200" : "text-slate-500"}`}
      >
        <span>{label}</span>
        {active
          ? (sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)
          : <ChevronsUpDown size={13} className="opacity-30" />}
      </button>
    </th>
  );
}
