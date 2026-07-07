import { ReactNode } from "react";
import { Badge } from "./ui";

export type HeaderChipTone = "slate" | "blue" | "green" | "amber" | "red";
export type HeaderChip = {
  label?: string;            // kleiner, gedämpfter Vorsatz (z.B. "Nr.")
  value: string;             // Wert (Pflicht)
  mono?: boolean;            // Monospace (z.B. Nummern)
  tone?: HeaderChipTone;     // wenn gesetzt → als Badge dargestellt (z.B. Status)
  title?: string;            // Tooltip; sonst value
};

/**
 * Einzelner Meta-Chip im EntityHeader-Look – auch außerhalb des EntityHeader
 * wiederverwendbar (z.B. Projektkontext in den Dokumenteditoren). Leere
 * Werte ("–") werden nicht gerendert.
 */
export function HeaderChipView({ chip }: { chip: HeaderChip }) {
  if (!chip.value || chip.value === "–") return null;
  return chip.tone ? (
    <span className="inline-flex items-center gap-1.5">
      {chip.label && <span className="text-[11px] text-slate-400">{chip.label}</span>}
      <Badge tone={chip.tone}>{chip.value}</Badge>
    </span>
  ) : (
    <span
      title={chip.title ?? chip.value}
      className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-lg px-2 py-1 text-xs"
      style={{ background: "var(--hover)" }}
    >
      {chip.label && <span className="shrink-0 text-slate-400">{chip.label}</span>}
      <span className={`truncate font-medium ${chip.mono ? "font-mono" : ""}`}>{chip.value}</span>
    </span>
  );
}

/**
 * Kompakte, wiederverwendbare Meta-/Kopfzeile im Stil des Angebotseditors.
 * Erste Chip = Entitätstyp (Akzent). Lange Werte werden mit Ellipsis + Tooltip
 * gekürzt. Funktioniert in allen Themes (CSS-Variablen) und responsive.
 */
export default function EntityHeader({ kind, chips, actions }: {
  kind: string;
  chips: HeaderChip[];
  actions?: ReactNode;
}) {
  return (
    <div className="glass mb-4 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span
          className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white"
          style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}
        >
          {kind}
        </span>

        {chips.map((c, i) => (
          <HeaderChipView key={i} chip={c} />
        ))}

        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
