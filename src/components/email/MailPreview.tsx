// ============================================================
// B4Y SuperAPP – E-Mail: Vorschau (RIGHT)
// ------------------------------------------------------------
// Zeigt die per useMailDetail(id) geladene Nachricht. Der Body
// wird in ein <iframe sandbox="allow-same-origin"> gerendert –
// KEIN allow-scripts, damit ein fremder Absender kein JS
// ausfuehren kann. srcdoc befuellt das Iframe ohne CSP-Kollision.
// Attachments werden per fetchAttachment(...) mit Bearer geladen
// und als Blob-URL (createObjectURL) als Datei angeboten.
// Actions [Antworten] / [Weiterleiten] delegieren an den Parent,
// der den ComposeDialog mit passendem Draft oeffnet.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  File,
  Forward,
  Paperclip,
  Reply,
  Loader2,
} from "lucide-react";
import { Badge, Empty, Spinner } from "../ui";
import { dateTimeAt } from "../../lib/format";
import { useMailDetail } from "../../hooks/useMicrosoftMail";
import {
  fetchAttachment,
  type MailAttachmentMeta,
  type MailDetail,
  type MailRecipient,
} from "../../lib/microsoft/mailClient";
import { toastError } from "../../lib/toast";

function recipientLabel(r: MailRecipient | null | undefined): string {
  if (!r) return "";
  const ea = r.emailAddress || {};
  const name = (ea.name || "").trim();
  return name || ea.address || "";
}

function recipientsLabel(list: MailRecipient[] | undefined): string {
  if (!list || !list.length) return "";
  return list.map(recipientLabel).filter(Boolean).join(", ");
}

/**
 * Minimales HTML-Doc fuer das Sandbox-Iframe:
 * - Body-Font matcht die App fuer optische Konsistenz.
 * - Bilder brechen nicht ueber den Rand.
 * - <base target="_blank"> zwingt Links in einen neuen Tab –
 *   ohne allow-top-navigation kann kein Redirect innerhalb der
 *   App erzwungen werden.
 */
function buildSrcdoc(mail: MailDetail): string {
  const isHtml = mail.body.contentType === "html";
  const content = mail.body.content || "";
  const inner = isHtml
    ? content
    : `<pre style="white-space:pre-wrap; word-break:break-word; margin:0; font-family:inherit;">${content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</pre>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base target="_blank" />
    <style>
      html, body { margin: 0; padding: 12px 16px; }
      body {
        color: #0f172a;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.55;
        background: transparent;
      }
      img, table { max-width: 100%; height: auto; }
      a { color: #2563eb; }
      blockquote {
        margin: 8px 0;
        padding: 4px 12px;
        border-left: 3px solid #cbd5e1;
        color: #475569;
      }
      pre, code { background: #f1f5f9; border-radius: 4px; padding: 1px 4px; }
      @media (prefers-color-scheme: dark) {
        body { color: #e2e8f0; }
        blockquote { border-color: #334155; color: #94a3b8; }
        pre, code { background: #1e293b; }
      }
    </style>
  </head>
  <body>${inner}</body>
</html>`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Attachment-Row: laedt on-demand als Blob und triggert Download ─
function AttachmentRow({
  messageId,
  att,
}: {
  messageId: string;
  att: MailAttachmentMeta;
}) {
  const [busy, setBusy] = useState(false);

  async function handleDownload() {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await fetchAttachment(messageId, att.id, "download");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.name || "attachment";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Kurz warten, bevor wir die Object-URL freigeben, damit der
      // Browser den Download starten kann.
      setTimeout(() => URL.revokeObjectURL(url), 4_000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
      toastError(`Anhang konnte nicht geladen werden: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="glass flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[var(--hover)]"
      disabled={busy}
    >
      <File size={16} className="shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={att.name}>
          {att.name || "Anhang"}
        </div>
        <div className="truncate text-[11px] text-slate-400">
          {[att.contentType || "", formatSize(att.size)].filter(Boolean).join(" · ")}
        </div>
      </div>
      {busy ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-slate-400" />
      ) : (
        <Download size={14} className="shrink-0 text-slate-400" />
      )}
    </button>
  );
}

export default function MailPreview({
  selectedId,
  onReply,
  onForward,
}: {
  selectedId: string | null;
  onReply: (mail: MailDetail) => void;
  onForward: (mail: MailDetail) => void;
}) {
  const { mail, loading, error } = useMailDetail(selectedId);

  // srcdoc nur neu bauen, wenn sich die Nachricht wirklich aendert –
  // sonst zwingt jeder Render das Iframe zu einem Full-Reload.
  const srcdoc = useMemo(() => (mail ? buildSrcdoc(mail) : ""), [mail]);

  // Bei ID-Wechsel scrollen wir den Header-Bereich nach oben, damit
  // eine neue Mail nicht in der Mitte der vorigen aufschlaegt.
  useEffect(() => {
    if (typeof document !== "undefined") {
      const el = document.getElementById("mail-preview-scroll");
      if (el) el.scrollTop = 0;
    }
  }, [selectedId]);

  if (!selectedId) {
    return (
      <div className="grid h-full place-items-center px-4">
        <Empty
          title="Keine Nachricht ausgewaehlt"
          hint="Waehle links eine Mail, um sie hier zu lesen."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!mail) return null;

  return (
    <div id="mail-preview-scroll" className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div
        className="border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-outline" onClick={() => onReply(mail)}>
            <Reply size={15} /> Antworten
          </button>
          <button type="button" className="btn-outline" onClick={() => onForward(mail)}>
            <Forward size={15} /> Weiterleiten
          </button>
          {mail.importance === "high" && <Badge tone="red">Wichtig</Badge>}
          {mail.hasAttachments && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Paperclip size={12} /> {mail.attachments.length} Anhang
              {mail.attachments.length === 1 ? "" : "e"}
            </span>
          )}
        </div>
        <h2 className="text-lg font-bold">{mail.subject || "(Kein Betreff)"}</h2>
        <div className="mt-2 grid gap-1 text-xs text-slate-500 dark:text-slate-400">
          <div>
            <span className="text-slate-400">Von: </span>
            <span className="text-slate-700 dark:text-slate-200">
              {recipientLabel(mail.from)}
              {mail.from?.emailAddress?.address ? (
                <span className="ml-1 text-slate-400">
                  &lt;{mail.from.emailAddress.address}&gt;
                </span>
              ) : null}
            </span>
          </div>
          {recipientsLabel(mail.toRecipients) && (
            <div>
              <span className="text-slate-400">An: </span>
              <span>{recipientsLabel(mail.toRecipients)}</span>
            </div>
          )}
          {recipientsLabel(mail.ccRecipients) && (
            <div>
              <span className="text-slate-400">Cc: </span>
              <span>{recipientsLabel(mail.ccRecipients)}</span>
            </div>
          )}
          <div>
            <span className="text-slate-400">Datum: </span>
            <span>{dateTimeAt(mail.receivedDateTime || mail.sentDateTime)}</span>
          </div>
        </div>
      </div>

      {/* Body – sandboxed iframe. KEIN allow-scripts, KEIN allow-same-origin
          (letzteres wuerde die Parent-Origin exponieren: eine boesartige Mail
          koennte per XHR gegen /api/... die eigene Session missbrauchen).
          allow-popups ebenfalls entfernt — Links werden ohnehin ohne Interaktion
          nicht aktiv (kein allow-top-navigation), das Blocken haerteter aus. */}
      <div className="min-h-0 flex-1 px-2 pb-2 pt-2">
        <iframe
          title="Mail-Inhalt"
          sandbox=""
          srcDoc={srcdoc}
          className="w-full rounded-lg border"
          style={{
            minHeight: 360,
            height: "100%",
            borderColor: "var(--border)",
            background: "white",
          }}
        />
      </div>

      {/* Attachments */}
      {mail.attachments.length > 0 && (
        <div
          className="border-t px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Anhaenge
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {mail.attachments.map((att) => (
              <AttachmentRow key={att.id} messageId={mail.id} att={att} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
