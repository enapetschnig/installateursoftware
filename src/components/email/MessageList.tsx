// ============================================================
// B4Y SuperAPP – E-Mail: Nachrichtenliste (Mitte)
// Ungelesen fett, angepinnte oben (Trenner), Flag/Kategorie sichtbar.
// Abgeschnittene Texte zeigen via title den Volltext beim Hover.
// ============================================================
import { Paperclip, Flag, Pin, Star } from "lucide-react";
import { Empty, Spinner } from "../ui";
import { Message } from "../../lib/email-types";
import { addressLabel, categoryColor } from "../../lib/email";
import { dateAt } from "../../lib/format";

export default function MessageList({
  messages, selectedId, loading, onSelect,
}: {
  messages: Message[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (m: Message) => void;
}) {
  if (loading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (!messages.length) return <div className="grid h-full place-items-center"><Empty title="Keine Nachrichten" hint="Dieser Ordner ist leer." /></div>;

  let pinnedBreak = false;
  return (
    <div className="h-full overflow-y-auto">
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {messages.map((m, i) => {
          const showPinHeader = m.pinned && i === 0;
          const showRest = !m.pinned && !pinnedBreak && messages[0]?.pinned;
          if (!m.pinned) pinnedBreak = true;
          const sel = m.id === selectedId;
          return (
            <li key={m.id}>
              {showPinHeader && <div className="bg-[var(--hover)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Angepinnt</div>}
              {showRest && <div className="bg-[var(--hover)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Weitere</div>}
              <button onClick={() => onSelect(m)}
                className={`block w-full px-3 py-2.5 text-left transition hover:bg-[var(--hover)] ${sel ? "bg-[var(--hover)]" : ""}`}
                style={sel ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}>
                <div className="flex items-center gap-2">
                  {!m.isRead && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />}
                  <span className={`min-w-0 flex-1 truncate text-sm ${m.isRead ? "text-slate-600 dark:text-slate-300" : "font-bold"}`} title={addressLabel(m.from)}>
                    {addressLabel(m.from)}
                  </span>
                  {m.pinned && <Pin size={12} className="shrink-0 text-[var(--accent)]" />}
                  {m.hasAttachments && <Paperclip size={12} className="shrink-0 text-slate-400" />}
                  {m.flag === "flagged" && <Flag size={12} className="shrink-0 text-rose-500" />}
                  {m.flag === "complete" && <Star size={12} className="shrink-0 text-emerald-500" />}
                  <span className="shrink-0 text-[11px] text-slate-400">{dateAt(m.sentDateTime || m.receivedDateTime)}</span>
                </div>
                <div className={`mt-0.5 truncate text-sm ${m.isRead ? "" : "font-semibold"}`} title={m.subject}>{m.subject || "(Kein Betreff)"}</div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-400" title={m.bodyPreview}>{m.bodyPreview}</span>
                  {m.categories.slice(0, 3).map((c) => (
                    <span key={c} className="h-2.5 w-2.5 shrink-0 rounded-full" title={c} style={{ background: categoryColor(c) }} />
                  ))}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
