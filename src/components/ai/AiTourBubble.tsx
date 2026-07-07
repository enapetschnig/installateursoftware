// ============================================================
// B4Y SuperAPP – Tour-Sprechblase (KI-Schulungsmodus)
// Kleines Panel pro Schritt: Isabella-Text, Fortschritt, Steuer-Buttons.
// Theme-konform (Glas + Tokens), dezent. Selbst klickbar (pointer-events:auto),
// während das restliche Overlay die App nicht blockiert.
// ============================================================
import { Sparkles, X } from "lucide-react";
import { TourMode } from "../../lib/ai-tour";

type Pos = { left: number; top: number; placement: "top" | "bottom" };

export default function AiTourBubble({
  title, text, stepIndex, stepCount, mode, pos,
  canConfirm, confirmText, waiting, onPrev, onNext, onConfirm, onEnd,
}: {
  title: string;
  text: string;
  stepIndex: number;
  stepCount: number;
  mode: TourMode;
  pos: Pos;
  canConfirm?: boolean;
  confirmText?: string;
  waiting?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onConfirm: () => void;
  onEnd: () => void;
}) {
  const modeLabel: Record<TourMode, string> = {
    explain: "Erklär-Modus", coach: "Mitklick-Modus", demo: "Demo-Modus", live: "Live-Modus",
  };
  const last = stepIndex >= stepCount - 1;
  return (
    <div
      role="dialog"
      aria-label={`Schulung: ${title}`}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: 300,
        maxWidth: "calc(100vw - 24px)",
        zIndex: 2147483001,
        pointerEvents: "auto",
      }}
      className="glass p-3 shadow-lift"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="grid h-6 w-6 place-items-center rounded-lg text-white" style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}>
            <Sparkles size={13} />
          </span>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">{title}</span>
        </div>
        <button onClick={onEnd} title="Schulung beenden" className="btn-ghost px-1"><X size={14} /></button>
      </div>

      <p className="text-sm leading-snug text-slate-700 dark:text-slate-100">{text}</p>

      {mode === "demo" && (
        <div className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          Demo-Modus – es werden nur klar markierte DEMO-Daten gezeigt, nichts wird gespeichert.
        </div>
      )}
      {mode === "coach" && waiting && (
        <div className="mt-1.5 text-[11px] text-[var(--accent)]">Mach den Schritt selbst – ich warte und erkenne, wenn es geklappt hat …</div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-slate-400">{modeLabel[mode]} · Schritt {stepIndex + 1}/{stepCount}</span>
        <div className="flex items-center gap-1.5">
          {stepIndex > 0 && (
            <button onClick={onPrev} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/5">Zurück</button>
          )}
          {canConfirm ? (
            <button onClick={onConfirm} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-500">
              {confirmText || "Bestätigen"}
            </button>
          ) : (
            <button onClick={onNext} disabled={waiting}
              className="rounded-lg px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}>
              {last ? "Fertig" : "Weiter"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
