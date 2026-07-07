// ============================================================
// B4Y SuperAPP – Microsoft-Trennen-Bestaetigung
// ------------------------------------------------------------
// Kleines Confirm-Modal vor dem POST /api/auth/microsoft-unlink.
// Erklaert klar dass die Emails in Microsoft bleiben, aber in
// b4y nicht mehr sichtbar sind.
// ============================================================

import { useState } from "react";
import { Modal } from "../ui";
import { toastError } from "../../lib/toast";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export default function MicrosoftDisconnectConfirm({
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
      // Nach erfolgreichem Trennen schliesst der Parent das Modal
      // (Refresh loest UI-Rerender aus).
      onClose();
    } catch (e) {
      toastError(
        e instanceof Error ? e.message : "Trennen fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Microsoft-Konto trennen"
    >
      <p className="text-sm" style={{ color: "var(--text)" }}>
        Wirklich trennen? Deine Emails bleiben in deinem Microsoft-Konto,
        aber du kannst sie nicht mehr in b4y ansehen oder ueber b4y senden.
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
          style={{
            background:
              "linear-gradient(135deg, var(--c-red, #e11d48), color-mix(in srgb, var(--c-red, #e11d48) 70%, black))",
          }}
          onClick={handleConfirm}
          disabled={busy}
        >
          {busy ? "Wird getrennt ..." : "Trennen"}
        </button>
      </div>
    </Modal>
  );
}
