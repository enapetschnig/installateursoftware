// ============================================================
// B4Y SuperAPP – Screenshot-Button in der Topbar (immer sichtbar)
// ------------------------------------------------------------
// Ein Klick → Bildschirmfreigabe bestätigen → der aktuelle Frame wird
// sofort als PNG heruntergeladen (kein Countdown, kein Upload – alles
// lokal; die Aufnahme wird direkt danach wieder beendet).
//
// Dropdowns im Bild:
//  - App-eigene Menüs/Comboboxen (z. B. ArticleSearchSelect) bleiben offen,
//    weil dieser Button per data-screenshot-trigger von deren
//    „Klick-außerhalb-schließt"-Logik ausgenommen ist.
//  - Native <select>-Menüs zeichnet das Betriebssystem und schließt sie
//    beim Klick/bei der Freigabe – sie sind technisch nur mit geteiltem
//    GESAMTEN Bildschirm und offenem Menü im Aufnahmemoment erfassbar.
//  - iPad/iOS-Safari unterstützt getDisplayMedia nicht → Button erscheint
//    dort nicht (Feature-Detection).
// ============================================================
import { useState } from "react";
import { Camera } from "lucide-react";
import { toast, toastError } from "../lib/toast";

const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

function downloadBlob(blob: Blob) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `b4y-screenshot-${stamp}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ScreenshotButton() {
  const [busy, setBusy] = useState(false);

  if (!supported) return null;

  async function capture() {
    if (busy) return;
    setBusy(true);
    let stream: MediaStream | null = null;
    try {
      // Freigabe wählen (am besten „Gesamter Bildschirm") → Frame sofort einfrieren.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width) throw new Error("Aufnahme lieferte kein Bild.");
      ctx.drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) { downloadBlob(blob); toast("Screenshot gespeichert (Download)."); }
        else toastError("Screenshot konnte nicht erstellt werden.");
      }, "image/png");
    } catch (e: unknown) {
      // Abbruch der Freigabe ist kein Fehler – nur echte Fehler melden.
      const err = e as { name?: string; message?: string };
      if (err?.name !== "NotAllowedError") toastError(err?.message ?? "Screenshot fehlgeschlagen.");
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setBusy(false);
    }
  }

  return (
    <button
      className="btn-ghost px-2.5"
      title="Screenshot aufnehmen (Bildschirm wählen → PNG-Download)"
      aria-label="Screenshot aufnehmen"
      data-screenshot-trigger
      disabled={busy}
      onClick={capture}
    >
      <Camera size={18} />
    </button>
  );
}
