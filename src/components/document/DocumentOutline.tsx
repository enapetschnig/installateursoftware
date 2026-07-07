// ============================================================
// B4Y SuperAPP – Gliederung (anklickbar)
// Springt im Dokument zum jeweiligen Titel-Abschnitt.
// ============================================================
import { ListTree } from "lucide-react";
import { OutlineEntry } from "../../lib/document-types";

export default function DocumentOutline({ entries }: { entries: OutlineEntry[] }) {
  if (entries.length === 0) return null;

  const jump = (id: string) => {
    const el = document.getElementById(`pos-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="glass p-4">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold">
        <ListTree size={15} /> Gliederung
      </div>
      <ul className="space-y-0.5">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              onClick={() => jump(e.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm transition hover:bg-[var(--hover)]"
              style={{ paddingLeft: `${(e.level - 1) * 12 + 8}px` }}
            >
              <span className="font-mono text-xs text-slate-400">{e.number}</span>
              <span className="truncate">{e.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
