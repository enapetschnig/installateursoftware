import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { dateAt, timeAt } from "../lib/format";

/**
 * Datum + Uhrzeit gestapelt: Datum oben, Uhrzeit klein/dezent darunter.
 * Zentrale Darstellung für Tabellenspalten (Projektübersicht, Versionshistorie …),
 * damit die Uhrzeit überall einheitlich unter dem Datum steht, wo Platz ist.
 */
export function DateStack({ d }: { d: string | null | undefined }) {
  if (!d) return <span className="text-slate-400">–</span>;
  return (
    <>
      <div className="whitespace-nowrap">{dateAt(d)}</div>
      <div className="text-[11px] text-slate-400">{timeAt(d)}</div>
    </>
  );
}

/**
 * Tabellen-Zelle mit abgeschnittenem Text, die den vollständigen Inhalt beim Hover (title)
 * zeigt – zentral & wiederverwendbar (app-weite UI-Regel). Kein Layout-Sprung: der Text wird
 * per `truncate` gekürzt, der volle Text steht im nativen Tooltip. Kompatibel mit sticky
 * Headern und allen Themes (nutzt nur Standard-Utilities). Bei String-Inhalt wird der Titel
 * automatisch gesetzt; sonst kann `title` explizit übergeben werden.
 * `maxW` begrenzt die Spaltenbreite (Default 200px), `as="div"` rendert ohne <td> (z. B. in Karten).
 */
export function TableCell({
  children, title, className = "", tdClassName = "", maxW = "200px", as = "td",
}: {
  children: ReactNode; title?: string; className?: string; tdClassName?: string; maxW?: string; as?: "td" | "div";
}) {
  const auto = typeof children === "string" ? children : (typeof children === "number" ? String(children) : undefined);
  const inner = (
    <div className={`truncate ${className}`} style={{ maxWidth: maxW }} title={title ?? auto}>{children}</div>
  );
  if (as === "div") return inner;
  return <td className={`px-3 py-2 ${tdClassName}`}>{inner}</td>;
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="glass p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-3xl font-extrabold">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

// Zentrale Ton-Palette (Badges, Status-Felder etc.) – Light + Dark.
export const TONES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200",
  blue: "bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300",
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};
export type Tone = keyof typeof TONES;
export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="glass flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="text-base font-semibold">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-sm text-muted">{hint}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="flex justify-center py-16"><div className="h-7 w-7 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
}

// Eingabetypen, bei denen Enter die primäre Modal-Aktion auslösen darf
// (einzeilige Felder; textarea/contenteditable/select sind bewusst ausgenommen).
const ENTER_SUBMIT_INPUT_TYPES = new Set(["text", "number", "email", "tel", "url", "password", "date", "time", "search"]);

/**
 * Zentrales Bedienmuster: Enter in einem einzeiligen Eingabefeld löst die
 * primäre (blaue) Aktion des Modals aus – wie ein Klick auf den Button.
 * Ausnahmen (Enter behält lokale Bedeutung):
 *  – textarea / contenteditable / native <select>
 *  – Comboboxen/Autocompletes, die Enter selbst verarbeiten (preventDefault)
 *    oder als geöffnet markiert sind (aria-expanded="true")
 *  – Felder mit datalist (list-Attribut) und Bereiche mit data-no-enter-submit
 *  – Eingaben innerhalb echter <form>-Elemente (dort submittet Enter nativ)
 * ConfirmDialoge (destruktive Bestätigungen) haben keine Eingabefelder →
 * Enter löst dort nichts aus. Busy/disabled greift über :disabled am Button.
 */
function handleModalEnter(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.defaultPrevented) return; // Combobox/Autocomplete hat Enter bereits verarbeitet
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLInputElement)) return;
  if (!ENTER_SUBMIT_INPUT_TYPES.has((t.type || "text").toLowerCase())) return;
  if (t.getAttribute("list")) return;
  if (t.closest("form")) return;
  if (t.closest('[data-no-enter-submit], [aria-expanded="true"]')) return;
  // Primäraktion = letzter aktiver btn-primary im Modal (Fußzeilen-Button)
  const btns = e.currentTarget.querySelectorAll<HTMLButtonElement>("button.btn-primary:not(:disabled)");
  const primary = btns.length ? btns[btns.length - 1] : null;
  if (!primary) return;
  e.preventDefault();
  primary.click();
}

export function Modal({ open, onClose, title, children, size = "md" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; size?: "md" | "xl" | "2xl" }) {
  // Hintergrund-Scroll sperren, solange das Modal offen ist (nach Schließen wieder freigeben)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;
  // 2xl: breite Tabellen-/Listen-Modals (z.B. Versionshistorie) – nutzt fast die volle
  // Viewport-Breite, gedeckelt auf 1200px, damit auf Desktop nichts abgeschnitten wird.
  const maxW = size === "2xl" ? "max-w-[1200px]" : size === "xl" ? "max-w-[900px]" : "max-w-lg";
  // Per Portal an <body> rendern: löst das Modal aus Containern mit backdrop-filter/
  // transform (z.B. .glass), damit die fixed-Positionierung sich am Viewport orientiert
  // und das Fenster immer sauber zentriert und vollständig sichtbar erscheint.
  return createPortal(
    <div className="modal-shell fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`modal-sheet glass relative z-10 max-h-[90vh] w-full overflow-y-auto p-6 ${maxW}`} onKeyDown={handleModalEnter}>
        <h3 className="mb-4 text-lg font-bold">{title}</h3>
        {children}
      </div>
    </div>,
    document.body
  );
}
