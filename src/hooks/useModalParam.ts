// ============================================================
// B4Y SuperAPP – URL-gekoppelter Modal-Zustand
// Bindet das Offen/Zu eines Modals an einen Query-Parameter (z.B. ?versions=1).
// Damit ist die geöffnete Ansicht Teil der URL und überlebt einen Rücksprung
// von außen (z.B. Escape aus dem PDF-Viewer → zurück zur exakten Ansicht inkl.
// wieder geöffneter Versionshistorie).
//
// Verwendung (drop-in für useState<boolean>):
//   const [open, setOpen] = useModalParam("versions");
// setOpen(true/false) oder Updater-Funktion; Schließen entfernt den Parameter
// (replace, damit kein zusätzlicher History-Eintrag entsteht).
// ============================================================
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export function useModalParam(key: string, value = "1"): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [params, setParams] = useSearchParams();
  const open = params.get(key) === value;

  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          const want = typeof next === "function" ? next(sp.get(key) === value) : next;
          if (want) sp.set(key, value);
          else sp.delete(key);
          return sp;
        },
        { replace: true },
      );
    },
    [key, value, setParams],
  );

  return [open, setOpen];
}
