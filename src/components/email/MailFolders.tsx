// ============================================================
// B4Y SuperAPP – E-Mail: Ordner-Sidebar (LEFT)
// ------------------------------------------------------------
// Statische, gegen Graph-Wellknown-Namen gemappte Ordnerliste
// (Posteingang / Gesendet / Entwuerfe) plus lokal wirkende
// Filter-Chips (Alle / Ungelesen / Mit Anhang). Der prominente
// "Neue Mail"-Button oeffnet den ComposeDialog (kein Ordner-
// wechsel). Auswahl-Zustand kommt vom Parent – die Sidebar ist
// bewusst zustandslos, damit Email.tsx die einzige Wahrheit
// bleibt (Folder + Filter fuer useMailList).
// ============================================================
import { Inbox, Send, FileEdit, Pencil, Filter, Paperclip, Mail } from "lucide-react";
import { MailFolder } from "../../lib/microsoft/mailClient";

export type MailListFilter = "all" | "unread" | "hasAttachment";

const FOLDERS: Array<{ id: MailFolder; label: string; Icon: typeof Inbox }> = [
  { id: "inbox", label: "Posteingang", Icon: Inbox },
  { id: "sent", label: "Gesendet", Icon: Send },
  { id: "drafts", label: "Entwuerfe", Icon: FileEdit },
];

const FILTERS: Array<{ id: MailListFilter; label: string; Icon: typeof Mail }> = [
  { id: "all", label: "Alle", Icon: Mail },
  { id: "unread", label: "Ungelesen", Icon: Filter },
  { id: "hasAttachment", label: "Mit Anhang", Icon: Paperclip },
];

export default function MailFolders({
  folder,
  onFolderChange,
  filter,
  onFilterChange,
  onCompose,
}: {
  folder: MailFolder;
  onFolderChange: (f: MailFolder) => void;
  filter: MailListFilter;
  onFilterChange: (f: MailListFilter) => void;
  onCompose: () => void;
}) {
  return (
    <div className="flex h-full flex-col p-3">
      {/* Neue Mail: prominent oben, oeffnet nur den Composer */}
      <button
        type="button"
        className="btn-primary mb-4 w-full justify-center"
        onClick={onCompose}
      >
        <Pencil size={16} />
        Neue Mail
      </button>

      {/* Ordnerliste */}
      <nav className="mb-5">
        <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Ordner
        </div>
        <ul className="space-y-0.5">
          {FOLDERS.map(({ id, label, Icon }) => {
            const active = id === folder;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onFolderChange(id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
                    active
                      ? "font-semibold"
                      : "text-slate-600 hover:bg-[var(--hover)] dark:text-slate-300"
                  }`}
                  style={
                    active
                      ? {
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                        }
                      : undefined
                  }
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Filter-Chips: reine Client-Filter auf die geladene Liste */}
      <div>
        <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Filter
        </div>
        <div className="flex flex-wrap gap-1.5 px-1">
          {FILTERS.map(({ id, label, Icon }) => {
            const active = id === filter;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onFilterChange(id)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
                  active
                    ? "font-semibold"
                    : "text-slate-600 hover:bg-[var(--hover)] dark:text-slate-300"
                }`}
                style={
                  active
                    ? {
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                      }
                    : { border: "1px solid var(--border)" }
                }
              >
                <Icon size={12} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
