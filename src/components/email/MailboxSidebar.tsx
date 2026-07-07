// ============================================================
// B4Y SuperAPP – E-Mail: Postfach-Auswahl + Ordner (linke Spalte)
// Postfächer (primär/geteilt) oben, darunter die Ordner des gewählten Postfachs.
// ============================================================
import { Mailbox as MailIcon, Pencil } from "lucide-react";
import { Mailbox, Folder } from "../../lib/email-types";
import FolderTree from "./FolderTree";

export default function MailboxSidebar({
  mailboxes, selectedMailboxId, onSelectMailbox,
  folders, selectedFolderId, onSelectFolder, onCompose,
}: {
  mailboxes: Mailbox[];
  selectedMailboxId: string | null;
  onSelectMailbox: (id: string) => void;
  folders: Folder[];
  selectedFolderId: string | null;
  onSelectFolder: (f: Folder) => void;
  onCompose: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <button className="btn-primary w-full justify-center" onClick={onCompose}><Pencil size={15} /> Neue Nachricht</button>

      <div>
        <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Postfächer</div>
        <div className="space-y-0.5">
          {mailboxes.map((mb) => {
            const sel = mb.id === selectedMailboxId;
            return (
              <button key={mb.id} onClick={() => onSelectMailbox(mb.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${sel ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"}`}>
                <MailIcon size={16} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium" title={mb.displayName}>{mb.displayName}</span>
                  <span className="block truncate text-[11px] text-slate-400" title={mb.emailAddress}>{mb.emailAddress}{mb.type === "shared" ? " · geteilt" : ""}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ordner</div>
        <FolderTree folders={folders} selectedId={selectedFolderId} onSelect={onSelectFolder} />
      </div>
    </div>
  );
}
