// ============================================================
// B4Y SuperAPP – E-Mail: Aktionsleiste über dem Lesebereich
// Antworten / Allen antworten / Weiterleiten (öffnen Composer-Entwurf),
// Archivieren / Kategorie / Pin / Flag / Gelesen (lokale Mock-Aktionen).
// ============================================================
import { useState, ReactNode } from "react";
import { Reply, ReplyAll, Forward, Archive, Tag, Pin, Flag, MailOpen, Mail } from "lucide-react";
import { Message } from "../../lib/email-types";
import CategoryPicker from "./CategoryPicker";

const Btn = ({ onClick, title, active, children, disabled }: { onClick?: () => void; title: string; active?: boolean; children: ReactNode; disabled?: boolean }) => (
  <button onClick={onClick} title={title} disabled={disabled}
    className={`grid h-9 min-w-9 place-items-center gap-1 rounded-lg px-2 text-xs font-medium transition disabled:opacity-40 ${active ? "text-[var(--accent)]" : "text-slate-500 hover:bg-[var(--hover)] hover:text-slate-700 dark:text-slate-300"}`}>
    {children}
  </button>
);

export default function MessageToolbar({
  message, onReply, onReplyAll, onForward, onArchive, onTogglePin, onToggleFlag, onToggleRead, onToggleCategory,
}: {
  message: Message;
  onReply: () => void; onReplyAll: () => void; onForward: () => void;
  onArchive: () => void; onTogglePin: () => void; onToggleFlag: () => void; onToggleRead: () => void;
  onToggleCategory: (name: string) => void;
}) {
  const [catOpen, setCatOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
      <Btn onClick={onReply} title="Antworten"><Reply size={16} /></Btn>
      <Btn onClick={onReplyAll} title="Allen antworten"><ReplyAll size={16} /></Btn>
      <Btn onClick={onForward} title="Weiterleiten"><Forward size={16} /></Btn>
      <span className="mx-1 h-5 w-px bg-[var(--border)]" />
      <Btn onClick={onArchive} title="Archivieren (Demo)" active={message.archived}><Archive size={16} /></Btn>
      <div className="relative">
        <Btn onClick={() => setCatOpen((o) => !o)} title="Kategorisieren" active={message.categories.length > 0}><Tag size={16} /></Btn>
        {catOpen && <CategoryPicker selected={message.categories} onToggle={onToggleCategory} onClose={() => setCatOpen(false)} />}
      </div>
      <Btn onClick={onTogglePin} title={message.pinned ? "Pin entfernen" : "Anpinnen"} active={message.pinned}><Pin size={16} /></Btn>
      <Btn onClick={onToggleFlag} title="Flaggen" active={message.flag === "flagged"}><Flag size={16} /></Btn>
      <Btn onClick={onToggleRead} title={message.isRead ? "Als ungelesen markieren" : "Als gelesen markieren"}>
        {message.isRead ? <Mail size={16} /> : <MailOpen size={16} />}
      </Btn>
    </div>
  );
}
