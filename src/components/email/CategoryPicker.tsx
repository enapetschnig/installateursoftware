// ============================================================
// B4Y SuperAPP – E-Mail: Kategorie-Auswahl (Outlook-Categories-ähnlich)
// Farblabels zum Zuordnen. Reines UI (Demo): toggelt lokale Kategorien.
// ============================================================
import { Check } from "lucide-react";
import { DEMO_CATEGORIES } from "../../lib/email";

export default function CategoryPicker({
  selected, onToggle, onClose,
}: {
  selected: string[];
  onToggle: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Klick außerhalb schließt */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 z-50 mt-1 w-52 rounded-xl border p-1.5 shadow-lift glass" style={{ borderColor: "var(--border)" }}>
        <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">Kategorie zuordnen</div>
        {DEMO_CATEGORIES.map((c) => {
          const on = selected.includes(c.displayName);
          return (
            <button key={c.id} onClick={() => onToggle(c.displayName)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-[var(--hover)]">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="min-w-0 flex-1 truncate">{c.displayName}</span>
              {on && <Check size={14} className="shrink-0 text-[var(--accent)]" />}
            </button>
          );
        })}
      </div>
    </>
  );
}
