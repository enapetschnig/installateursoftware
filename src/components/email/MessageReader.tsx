// ============================================================
// B4Y SuperAPP – E-Mail: Lesebereich
// Zeigt Kopf (Absender/Empfänger/Datum/Kategorien/Flag/Pin) + sanitisierten
// HTML-Body. bodyHtml wird AUSSCHLIESSLICH über sanitizeHtml() gerendert.
// ============================================================
import { Paperclip, Flag, Pin, Star } from "lucide-react";
import { Empty, Badge } from "../ui";
import { Message } from "../../lib/email-types";
import { addressLabel, categoryColor } from "../../lib/email";
import { sanitizeHtml } from "../../lib/sanitize";
import { dateTimeAt } from "../../lib/format";

export default function MessageReader({ message }: { message: Message | null }) {
  if (!message) {
    return <div className="grid h-full place-items-center"><Empty title="Keine Nachricht ausgewählt" hint="Wähle links eine E-Mail, um sie hier zu lesen." /></div>;
  }
  const m = message;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-bold leading-snug">{m.subject || "(Kein Betreff)"}</h2>
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {m.pinned && <Pin size={15} className="text-[var(--accent)]" />}
            {m.flag === "flagged" && <Flag size={15} className="text-rose-500" />}
            {m.flag === "complete" && <Star size={15} className="text-emerald-500" />}
            {m.importance === "high" && <Badge tone="red">Wichtig</Badge>}
          </div>
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          <div><span className="text-slate-400">Von:</span> <span className="font-medium">{addressLabel(m.from)}</span> &lt;{m.from.address}&gt;</div>
          <div><span className="text-slate-400">An:</span> {m.to.map(addressLabel).join(", ") || "–"}{m.cc.length ? ` · Cc: ${m.cc.map(addressLabel).join(", ")}` : ""}</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span>{dateTimeAt(m.sentDateTime || m.receivedDateTime)}</span>
            {m.hasAttachments && <span className="inline-flex items-center gap-1 text-slate-400"><Paperclip size={12} /> Anhang</span>}
          </div>
        </div>
        {m.categories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.categories.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: "color-mix(in srgb, " + categoryColor(c) + " 16%, transparent)", color: categoryColor(c) }}>
                <span className="h-2 w-2 rounded-full" style={{ background: categoryColor(c) }} /> {c}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Sanitisierter HTML-Inhalt (DOMPurify) – nie unsanitisiert rendern */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="prose prose-sm max-w-none text-sm leading-relaxed dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.bodyHtml) }} />
      </div>
    </div>
  );
}
