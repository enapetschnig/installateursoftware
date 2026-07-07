// ============================================================
// B4Y SuperAPP – Wiederverwendbare UI-Bausteine fürs Kalkulationsmodul
// (fügt sich ins bestehende Glas-/Theme-Design ein)
// ============================================================
import { ReactNode } from "react";
import { AlertTriangle, Search, Info } from "lucide-react";
import { Modal } from "./ui";

/**
 * Einheitliches Suchfeld für das Kalkulationsmodul (Artikelstamm, Leistungen, …).
 * Breit genug für vollständige Placeholder, responsiv: volle Breite auf kleinen
 * Bildschirmen, ~440 px ab sm, ~520 px ab lg.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-[440px] lg:w-[520px]">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className="input pl-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={`inline-flex items-center gap-2 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      aria-pressed={checked}
    >
      <span
        className="relative h-6 w-11 rounded-full transition-colors"
        style={{ background: checked ? "var(--accent)" : "var(--border)" }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{ left: 2, transform: checked ? "translateX(20px)" : "translateX(0)" }}
        />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </button>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Löschen",
  busy,
  tone = "danger",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  /** "danger" = rot (Löschen/irreversibel, Default) · "info" = neutral (z. B. Wiederherstellen). */
  tone?: "danger" | "info";
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isInfo = tone === "info";
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${isInfo ? "bg-sky-100 text-sky-600 dark:bg-sky-500/15" : "bg-rose-100 text-rose-600 dark:bg-rose-500/15"}`}>
          {isInfo ? <Info size={20} /> : <AlertTriangle size={20} />}
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-300">{message}</div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>
          Abbrechen
        </button>
        <button
          className="btn-primary"
          onClick={onConfirm}
          disabled={busy}
          style={isInfo ? undefined : { background: "linear-gradient(135deg,#ef4444,#dc2626)" }}
        >
          {busy ? "…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
      <AlertTriangle size={16} /> {message}
    </div>
  );
}

/** Inline-Zahlenfeld für Tabellen (kompakt). */
export function NumCell({
  value,
  onChange,
  step = "any",
  suffix,
  className = "",
}: {
  value: number | string;
  onChange: (v: number) => void;
  step?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        type="number"
        step={step}
        value={value === 0 ? "" : value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="w-full rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums outline-none transition focus:border-brand-400"
        style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
          {suffix}
        </span>
      )}
    </div>
  );
}
