// ============================================================
// B4Y SuperAPP – Microsoft-Konto Verbindungskarte
// ------------------------------------------------------------
// Zeigt Status via useMicrosoftConnection() und bietet je nach
// Zustand "Verbinden" oder "Trennen" an.
//
// States:
//   loading     -> Spinner-Ersatz + Text
//   connected   -> Mail-Adresse (falls bekannt) + expires_at + Trennen
//   disconnected-> Outlook-Icon + "Verbinden"-Button
//   degraded    -> "Konfiguration unklar"-Hinweis
//   error       -> Fehlermeldung + "Erneut versuchen"
// ============================================================

import { useState } from "react";
import { AlertTriangle, Info, Link2, Unplug, Loader2 } from "lucide-react";
import { Badge } from "../ui";
import { useMicrosoftConnection } from "../../hooks/useMicrosoftConnection";
import MicrosoftConfirmModal from "./MicrosoftConfirmModal";
import MicrosoftDisconnectConfirm from "./MicrosoftDisconnectConfirm";
import { dateAt, timeAt } from "../../lib/format";

// Einfaches Outlook-Icon (Unicode-Fallback: der Buchstabe "O" in Blau).
// Reduziert Design-Systeme, die kein Herstellerlogo einbetten wollen.
function OutlookMark({ size = 44 }: { size?: number }) {
  const s = size;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl"
      style={{
        width: s,
        height: s,
        background:
          "linear-gradient(135deg, #0072C6 0%, #0F4C81 100%)",
        color: "#fff",
        boxShadow: "0 4px 14px -6px rgba(0,80,150,.5)",
      }}
      aria-hidden
    >
      <svg
        width={s * 0.6}
        height={s * 0.6}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Vereinfachte Outlook-Form: abgerundetes O + Umschlag-Andeutung */}
        <rect x="2" y="6" width="18" height="20" rx="3" fill="#ffffff" opacity="0.12" />
        <text
          x="11"
          y="22"
          textAnchor="middle"
          fontFamily="Segoe UI, Arial, sans-serif"
          fontWeight="700"
          fontSize="16"
          fill="#ffffff"
        >
          O
        </text>
        <path
          d="M22 12l6 4v10a2 2 0 0 1-2 2h-4V12z"
          fill="#ffffff"
          opacity="0.9"
        />
        <path d="M22 12l6 4-6 4V12z" fill="#ffffff" opacity="0.55" />
      </svg>
    </span>
  );
}

/** Formatiert einen ISO-Zeitstempel als "01.07.2026 um 12:34". */
function formatExpires(iso: string): string {
  try {
    const d = dateAt(iso);
    const t = timeAt(iso);
    return `${d} um ${t}`;
  } catch {
    return iso;
  }
}

export default function MicrosoftConnectCard() {
  const conn = useMicrosoftConnection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Derived states aus dem flachen Hook-Interface:
  //  - loading:  Status wird gerade nachgeladen
  //  - errored:  echter Fetch-Fehler (nicht "just disconnected")
  //  - degraded: Backend liefert connected=false, ist sich aber unsicher
  //  - connected/disconnected: hart definiert
  const loading = conn.loading;
  const errored = !loading && !!conn.error;
  const degraded = !loading && !errored && !!conn.degraded;
  const connected = !loading && !errored && !degraded && conn.connected;
  const disconnected = !loading && !errored && !degraded && !connected;

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await conn.disconnect();
    } finally {
      setDisconnecting(false);
      setDisconnectOpen(false);
    }
  }

  return (
    <div className="glass p-4">
      <div className="flex items-start gap-4">
        <OutlookMark />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold" style={{ color: "var(--text)" }}>
              Microsoft (Outlook)
            </h3>
            {connected && <Badge tone="green">Verbunden</Badge>}
            {disconnected && <Badge tone="slate">Nicht verbunden</Badge>}
            {degraded && <Badge tone="amber">Konfiguration unklar</Badge>}
            {errored && <Badge tone="red">Fehler</Badge>}
          </div>

          <p className="mt-1 text-sm" style={{ color: "var(--text2)" }}>
            Verbindet dein Microsoft-Konto, damit du im Posteingang deine
            Outlook-Mails siehst und aus b4y heraus E-Mails (z. B. Angebote)
            in deinem Namen senden kannst.
          </p>

          {/* Detail-Bereich je nach State */}
          {loading && (
            <div
              className="mt-3 inline-flex items-center gap-2 text-sm"
              style={{ color: "var(--text2)" }}
            >
              <Loader2 size={14} className="animate-spin" />
              Status wird geladen ...
            </div>
          )}

          {connected && (
            <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[140px_1fr]">
              {conn.microsoft_user_id && (
                <>
                  <dt style={{ color: "var(--text2)" }}>Microsoft-Nutzer-ID</dt>
                  <dd
                    className="truncate font-medium"
                    title={conn.microsoft_user_id}
                    style={{ color: "var(--text)" }}
                  >
                    {conn.microsoft_user_id}
                  </dd>
                </>
              )}
              {conn.expires_at && (
                <>
                  <dt style={{ color: "var(--text2)" }}>Zugriff gueltig bis</dt>
                  <dd className="font-medium" style={{ color: "var(--text)" }}>
                    {formatExpires(conn.expires_at)}
                  </dd>
                </>
              )}
              {conn.scopes && conn.scopes.length > 0 && (
                <>
                  <dt style={{ color: "var(--text2)" }}>Berechtigungen</dt>
                  <dd
                    className="truncate text-xs"
                    style={{ color: "var(--text2)" }}
                    title={conn.scopes.join(" ")}
                  >
                    {conn.scopes.join(", ")}
                  </dd>
                </>
              )}
            </dl>
          )}

          {degraded && (
            <div
              className="mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--hover)",
                color: "var(--text2)",
              }}
            >
              <Info size={16} className="mt-0.5 shrink-0" />
              <div>
                Der Verbindungsstatus konnte gerade nicht sicher ermittelt werden.
                Bitte lade die Seite in Kuerze neu, oder wende dich an den
                Administrator, wenn das Problem bleibt.
              </div>
            </div>
          )}

          {errored && (
            <div
              className="mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm"
              style={{
                borderColor: "var(--border)",
                background: "color-mix(in srgb, var(--c-red, #e11d48) 10%, transparent)",
                color: "var(--text)",
              }}
            >
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0"
                style={{ color: "var(--c-red, #e11d48)" }}
              />
              <div>{conn.error ?? "Verbindung konnte nicht geladen werden."}</div>
            </div>
          )}

          {/* Aktionen */}
          <div className="mt-4 flex flex-wrap gap-2">
            {(disconnected || degraded || errored) && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-1.5"
                onClick={() => setConfirmOpen(true)}
                disabled={loading}
              >
                <Link2 size={15} />
                Verbinden
              </button>
            )}
            {connected && (
              <button
                type="button"
                className="btn-outline inline-flex items-center gap-1.5"
                onClick={() => setDisconnectOpen(true)}
                disabled={disconnecting}
              >
                <Unplug size={15} />
                {disconnecting ? "Wird getrennt ..." : "Trennen"}
              </button>
            )}
            {errored && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => conn.refresh()}
              >
                Erneut versuchen
              </button>
            )}
          </div>
        </div>
      </div>

      <MicrosoftConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => { conn.startConnect(); }}
      />
      <MicrosoftDisconnectConfirm
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={handleDisconnect}
      />
    </div>
  );
}
