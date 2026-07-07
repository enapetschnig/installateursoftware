// ============================================================
// B4Y SuperAPP – Leichte, app-weite Toast-Benachrichtigungen
// Ersatz für native window.alert() bei Erfolgs-/Fehlermeldungen.
// Modullevel-Store (ohne Context) → `toast(msg)` / `toastError(msg)` von
// überall aufrufbar; <Toaster/> einmal im App-Root rendern.
// Dark-/Light-Mode über App-Tokens (glass + var(--*)); mobil unten zentriert.
// ============================================================
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; msg: string; type: ToastType };

let items: ToastItem[] = [];
let listeners: Array<() => void> = [];
let seq = 1;
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Toast anzeigen (Standard: Erfolg). Auto-Ausblendung nach ~4,5 s. */
export function toast(msg: string, type: ToastType = "success"): void {
  const id = seq++;
  items = [...items, { id, msg, type }];
  emit();
  setTimeout(() => dismiss(id), 4500);
}
export const toastError = (msg: string) => toast(msg, "error");
export const toastInfo = (msg: string) => toast(msg, "info");

const TONE: Record<ToastType, { color: string; Icon: typeof CheckCircle2 }> = {
  success: { color: "var(--c-green, #16a34a)", Icon: CheckCircle2 },
  error: { color: "var(--c-red, #e11d48)", Icon: AlertTriangle },
  info: { color: "var(--accent)", Icon: Info },
};

/** Einmal im App-Root rendern. */
export function Toaster() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.push(l);
    return () => { listeners = listeners.filter((x) => x !== l); };
  }, []);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[9999] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:items-end">
      {items.map((t) => {
        const { color, Icon } = TONE[t.type];
        return (
          <div key={t.id} role="status"
            className="glass pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-sm shadow-lg"
            style={{ borderLeft: `3px solid ${color}` }}>
            <Icon size={17} className="mt-0.5 shrink-0" style={{ color }} />
            <span className="flex-1">{t.msg}</span>
            <button className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              onClick={() => dismiss(t.id)} title="Schließen"><X size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}
