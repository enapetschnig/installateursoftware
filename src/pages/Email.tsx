// ============================================================
// B4Y SuperAPP – E-Mail-Modul (Seite / Orchestrator)
// ------------------------------------------------------------
// Volle Microsoft-Graph-Integration:
//   - Verbindungsstatus ueber useMicrosoftConnection().
//   - Ordner-/Filter-Auswahl links (MailFolders).
//   - Liste in der Mitte (MailList, Datenquelle useMailList).
//   - Preview rechts mit Sandbox-Iframe (MailPreview, Datenquelle
//     useMailDetail).
//   - Compose/Reply/Forward via ComposeDialog + sendMail().
//
// Nicht verbundene User bekommen den ConnectEmptyState statt der
// 3-Spalten-Ansicht; der CTA verweist auf die Einstellungen, wo
// der eigentliche OAuth-Flow angestossen wird.
//
// Guard: /email ist in App.tsx bereits hinter <Guard module="email">.
// ============================================================
import { useState } from "react";
import { PageHeader, Spinner } from "../components/ui";
import MailFolders, {
  type MailListFilter,
} from "../components/email/MailFolders";
import MailList from "../components/email/MailList";
import MailPreview from "../components/email/MailPreview";
import ComposeDialog, {
  type ComposeInitial,
} from "../components/email/ComposeDialog";
import ConnectEmptyState from "../components/email/ConnectEmptyState";
import { useMicrosoftConnection } from "../hooks/useMicrosoftConnection";
import type { MailFolder, MailDetail } from "../lib/microsoft/mailClient";

// Betreff-Prefix "AW:"/"WG:" idempotent – doppeltes Prefix wird
// stripped, egal ob AW/RE/WG/FWD (Outlook-kompatibel).
const stripPrefix = (s: string): string =>
  (s || "").replace(/^\s*(AW|WG|RE|FWD?)\s*:\s*/i, "").trim();

/**
 * Recipient-List als "Name <addr>, ..."-String – so kann der
 * Composer direkt die parseEmailList()-Regel wiederverwenden.
 */
function formatRecipients(list: MailDetail["toRecipients"]): string {
  return list
    .map((r) => {
      const ea = r.emailAddress || {};
      const name = (ea.name || "").trim();
      const addr = (ea.address || "").trim();
      if (!addr) return "";
      return name ? `${name} <${addr}>` : addr;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Baut das Zitat fuer Weiterleiten/Antworten. HTML, damit der
 * Composer im Preview-Modus direkt korrekt gerendert wird und der
 * Server-Roundtrip nichts umformatiert.
 */
function buildQuote(mail: MailDetail): string {
  const from = mail.from?.emailAddress;
  const fromLabel = from
    ? `${from.name || ""} &lt;${from.address || ""}&gt;`.trim()
    : "";
  const date = mail.sentDateTime || mail.receivedDateTime || "";
  const body =
    mail.body.contentType === "html"
      ? mail.body.content || ""
      : `<pre>${(mail.body.content || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>`;
  return `
<p>&nbsp;</p>
<blockquote>
  <p><b>Von:</b> ${fromLabel}<br/>
     <b>Gesendet:</b> ${date}<br/>
     <b>Betreff:</b> ${mail.subject || ""}</p>
  ${body}
</blockquote>`;
}

export default function Email() {
  const { connected, loading: connLoading } = useMicrosoftConnection();

  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [filter, setFilter] = useState<MailListFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeInitial | null>(null);
  // "Nonce", der MailList zum Refresh zwingt, ohne den Hook selbst
  // ansprechen zu muessen – key-remount ist die einfachste Loesung.
  const [listNonce, setListNonce] = useState(0);

  // ── Loading- und Empty-States (Connect) ─────────────────────
  if (connLoading) {
    return (
      <div className="anim-in">
        <PageHeader title="E-Mail" />
        <Spinner />
      </div>
    );
  }
  if (!connected) {
    return (
      <div className="anim-in">
        <PageHeader
          title="E-Mail"
          subtitle="Verbinde dein Microsoft-Konto, um Mails zu senden und zu lesen."
        />
        <ConnectEmptyState />
      </div>
    );
  }

  // ── Reply/Forward-Handler bauen den Compose-Draft aus der Mail
  function handleReply(mail: MailDetail) {
    setCompose({
      mode: "reply",
      to: formatRecipients(mail.from ? [mail.from] : []),
      subject: `AW: ${stripPrefix(mail.subject)}`,
      html: buildQuote(mail),
      inReplyTo: mail.id,
    });
  }
  function handleForward(mail: MailDetail) {
    setCompose({
      mode: "forward",
      subject: `WG: ${stripPrefix(mail.subject)}`,
      html: buildQuote(mail),
    });
  }

  return (
    <div className="anim-in">
      <PageHeader title="E-Mail" />

      <div className="grid h-[calc(100dvh-11rem)] grid-cols-1 gap-3 lg:grid-cols-[240px_360px_1fr]">
        {/* LEFT: Ordner + Filter + Neue Mail */}
        <div
          className="glass overflow-hidden lg:h-full"
          style={{ borderColor: "var(--border)" }}
        >
          <MailFolders
            folder={folder}
            onFolderChange={(f) => {
              setFolder(f);
              setSelectedId(null);
            }}
            filter={filter}
            onFilterChange={setFilter}
            onCompose={() => setCompose({ mode: "new" })}
          />
        </div>

        {/* MIDDLE: Nachrichten-Liste */}
        <div className="glass min-h-0 overflow-hidden lg:h-full">
          <MailList
            key={`${folder}-${listNonce}`}
            folder={folder}
            filter={filter}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* RIGHT: Vorschau */}
        <div className="glass min-h-0 overflow-hidden lg:h-full">
          <MailPreview
            selectedId={selectedId}
            onReply={handleReply}
            onForward={handleForward}
          />
        </div>
      </div>

      {compose && (
        <ComposeDialog
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={() => setListNonce((n) => n + 1)}
        />
      )}
    </div>
  );
}
