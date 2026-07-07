import { useEffect, useRef, useState } from "react";
import { Braces } from "lucide-react";
import type { PlaceholderGroup } from "../lib/document-placeholders";

/**
 * Wiederverwendbares Platzhalter-Menü (Popover) für Rich-Text-Editoren.
 * EINE UI für alle Domänen – der konkrete Katalog (Dokument- ODER Mail-Tokens)
 * wird über `groups` übergeben (kein Vermischen). Klick auf einen Eintrag ruft
 * `onInsert(token)` (z. B. document.execCommand("insertText", …)) und schließt das Popover.
 *
 * Bedienung: Button (Icon, neben Link) öffnet das Panel; Kategorien → Items mit
 * Token (mono), Erklärung und Beispiel. Klick außerhalb oder Escape schließt.
 * Dark/Light über zentrale CSS-Variablen (--card/--border/--hover).
 */
export default function PlaceholderMenu({
  groups,
  onInsert,
  disabled,
  label = "Platzhalter",
}: {
  groups: PlaceholderGroup[];
  onInsert: (token: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Klick außerhalb + Escape schließen das Popover.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!groups || groups.length === 0) return null;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        title="Platzhalter einfügen"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--hover)] disabled:opacity-40"
      >
        <Braces size={14} /> {label}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 max-h-80 w-80 overflow-auto rounded-xl border bg-[var(--card)] p-2 shadow-lg"
          style={{ borderColor: "var(--border)" }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {groups.map((g) => (
            <div key={g.category} className="mb-2 last:mb-0">
              <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {g.category}
              </div>
              {g.items.map((it) => (
                <button
                  key={it.token}
                  type="button"
                  onClick={() => { onInsert(it.token); setOpen(false); }}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--hover)]"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <code className="text-xs text-[var(--accent)]">{it.token}</code>
                    <span className="truncate text-[11px] text-slate-400">{it.label}</span>
                  </div>
                  {it.example && (
                    <div className="text-[11px] text-slate-400">
                      Beispiel: <span className="text-slate-500 dark:text-slate-300">{it.example}</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
