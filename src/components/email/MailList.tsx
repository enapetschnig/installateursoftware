// ============================================================
// B4Y SuperAPP – E-Mail: Nachrichtenliste (MIDDLE)
// ------------------------------------------------------------
// Rendert die aktuelle Nachrichten-Liste eines Ordners. Die
// Datenquelle ist useMailList({folder}) – dieser View ist reine
// UI + Client-seitige Filter (Alle / Ungelesen / Mit Anhang).
// Auswahl-State wird nach oben propagiert (setSelectedId).
// "Mehr laden" wird nur gezeigt, wenn hasMore=true.
// ============================================================
import { Paperclip, RefreshCw, AlertTriangle } from "lucide-react";
import { Empty, Spinner } from "../ui";
import { dateAt } from "../../lib/format";
import { useMailList } from "../../hooks/useMicrosoftMail";
import type { MailFolder, MailListItem } from "../../lib/microsoft/mailClient";
import type { MailListFilter } from "./MailFolders";

function displayName(item: MailListItem): string {
  const from = item.from?.emailAddress;
  if (!from) return "(Unbekannt)";
  const n = (from.name || "").trim();
  return n || from.address || "(Unbekannt)";
}

/**
 * Wendet den Client-Filter auf die Rohliste an.
 * "unread" und "hasAttachment" arbeiten rein auf den geladenen
 * Elementen; das Backend liefert die volle Ordnerseite.
 */
function applyFilter(
  messages: MailListItem[],
  filter: MailListFilter,
): MailListItem[] {
  if (filter === "unread") return messages.filter((m) => !m.isRead);
  if (filter === "hasAttachment") return messages.filter((m) => m.hasAttachments);
  return messages;
}

export default function MailList({
  folder,
  filter,
  selectedId,
  onSelect,
}: {
  folder: MailFolder;
  filter: MailListFilter;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { messages, loading, error, refresh, loadMore, hasMore } = useMailList({ folder });

  const filtered = applyFilter(messages, filter);

  return (
    <div className="flex h-full flex-col">
      {/* Header: Ordner-Titel + Refresh */}
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="text-sm font-semibold">
          {folder === "inbox" ? "Posteingang" : folder === "sent" ? "Gesendet" : "Entwuerfe"}
          <span className="ml-2 text-xs font-normal text-slate-400">
            {filtered.length}
            {filter !== "all" ? ` / ${messages.length}` : ""}
          </span>
        </div>
        <button
          type="button"
          className="btn-ghost px-2 py-1"
          onClick={refresh}
          title="Aktualisieren"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
        </button>
      </div>

      {/* Fehler-Zustand: Backend meldet Graph-Problem */}
      {error && (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Inhalt */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && messages.length === 0 ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <div className="grid h-full place-items-center px-4">
            <Empty
              title="Keine Nachrichten"
              hint={
                filter === "all"
                  ? "Dieser Ordner ist leer."
                  : "Kein Treffer fuer den aktuellen Filter."
              }
            />
          </div>
        ) : (
          <ul
            className="divide-y"
            style={{ borderColor: "var(--border)" }}
          >
            {filtered.map((m) => {
              const sel = m.id === selectedId;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(m.id)}
                    className={`block w-full px-3 py-2.5 text-left transition hover:bg-[var(--hover)] ${
                      sel ? "bg-[var(--hover)]" : ""
                    }`}
                    style={
                      sel ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined
                    }
                  >
                    <div className="flex items-center gap-2">
                      {!m.isRead && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: "var(--accent)" }}
                        />
                      )}
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${
                          m.isRead
                            ? "text-slate-600 dark:text-slate-300"
                            : "font-bold"
                        }`}
                        title={displayName(m)}
                      >
                        {displayName(m)}
                      </span>
                      {m.hasAttachments && (
                        <Paperclip size={12} className="shrink-0 text-slate-400" />
                      )}
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {dateAt(m.receivedDateTime)}
                      </span>
                    </div>
                    <div
                      className={`mt-0.5 truncate text-sm ${
                        m.isRead ? "" : "font-semibold"
                      }`}
                      title={m.subject || "(Kein Betreff)"}
                    >
                      {m.subject || "(Kein Betreff)"}
                    </div>
                    <div
                      className="mt-0.5 truncate text-xs text-slate-400"
                      title={m.bodyPreview}
                    >
                      {m.bodyPreview}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* "Mehr laden" – nur, wenn Server weitere Seiten hat */}
        {hasMore && filtered.length > 0 && (
          <div className="flex justify-center px-3 py-3">
            <button
              type="button"
              className="btn-outline"
              onClick={loadMore}
              disabled={loading}
            >
              {loading ? "Laden ..." : "Mehr laden"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
