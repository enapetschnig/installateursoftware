// ============================================================
// B4Y SuperAPP – E-Mail: Ordnerliste (links)
// Später aus Outlook gespiegelt (mailFolder). Heute aus dem Mock-Adapter.
// ============================================================
import { Inbox, Send, FileEdit, Archive, Trash2, Folder as FolderIcon } from "lucide-react";
import { Folder, WellKnownFolder } from "../../lib/email-types";

const ICON: Record<NonNullable<WellKnownFolder> | "default", any> = {
  inbox: Inbox, sentitems: Send, drafts: FileEdit, archive: Archive, deleteditems: Trash2, junkemail: Trash2, default: FolderIcon,
};

export default function FolderTree({
  folders, selectedId, onSelect,
}: {
  folders: Folder[];
  selectedId: string | null;
  onSelect: (f: Folder) => void;
}) {
  return (
    <nav className="space-y-0.5">
      {folders.map((f) => {
        const I = ICON[f.wellKnownName || "default"] || FolderIcon;
        const sel = f.id === selectedId;
        return (
          <button key={f.id} onClick={() => onSelect(f)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${sel ? "font-semibold text-[var(--accent)]" : "text-slate-600 hover:bg-[var(--hover)] dark:text-slate-300"}`}
            style={sel ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)" } : undefined}>
            <I size={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left" title={f.displayName}>{f.displayName}</span>
            {f.unreadCount > 0 && (
              <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>{f.unreadCount}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
