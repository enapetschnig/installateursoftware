// ============================================================
// B4Y SuperAPP – Microsoft-Verbinden-Bestaetigungsmodal
// ------------------------------------------------------------
// Zeigt VOR dem OAuth-Redirect klar auf, was die App tun wird
// (Mails lesen + im Namen des Users senden) und was nicht.
// Der "Weiter"-Button startet den OAuth-Flow (window.location).
// ============================================================

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Modal } from "../ui";
import { toastError } from "../../lib/toast";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

const PERMISSIONS: { icon: typeof Check; text: string; positive: boolean }[] = [
  {
    icon: Check,
    text: "Ihre Emails lesen koennen (Inbox-Ansicht in der App)",
    positive: true,
  },
  {
    icon: Check,
    text: "In Ihrem Namen Emails senden koennen (z. B. Angebote)",
    positive: true,
  },
  {
    icon: X,
    text: "KEINE Emails loeschen. KEIN Zugriff auf Kalender oder OneDrive.",
    positive: false,
  },
];

export default function MicrosoftConfirmModal({
  open,
  onClose,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      // onConfirm() macht i. d. R. einen window.location.assign() —
      // wir kommen nach dem Redirect nicht mehr hier durch.
    } catch (e) {
      setBusy(false);
      toastError(
        e instanceof Error ? e.message : "Verbinden fehlgeschlagen.",
      );
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Microsoft-Konto verbinden">
      <p className="text-sm" style={{ color: "var(--text)" }}>
        Diese App wird:
      </p>
      <ul className="mt-3 space-y-2">
        {PERMISSIONS.map((p) => {
          const color = p.positive ? "var(--accent)" : "var(--c-red, #e11d48)";
          return (
            <li key={p.text} className="flex items-start gap-2 text-sm">
              <span
                className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full"
                style={{
                  background: p.positive
                    ? "var(--accent-soft)"
                    : "color-mix(in srgb, var(--c-red, #e11d48) 15%, transparent)",
                  color,
                }}
              >
                <p.icon size={13} />
              </span>
              <span style={{ color: "var(--text)" }}>{p.text}</span>
            </li>
          );
        })}
      </ul>

      <p
        className="mt-4 rounded-xl border p-3 text-xs"
        style={{
          borderColor: "var(--border)",
          background: "var(--hover)",
          color: "var(--text2)",
        }}
      >
        Sie koennen die Verbindung jederzeit trennen unter
        <br />
        <strong>Einstellungen &rarr; Integrationen</strong>.
      </p>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={busy}
        >
          Abbrechen
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleConfirm}
          disabled={busy}
        >
          {busy ? "Wird weitergeleitet ..." : "Weiter zu Microsoft"}
        </button>
      </div>
    </Modal>
  );
}
