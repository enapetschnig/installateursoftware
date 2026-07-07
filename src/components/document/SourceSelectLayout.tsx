// ============================================================
// B4Y SuperAPP – Zentrale Layout-Hülle für Dokument-Auswahl-/Vorschau-Modale
// ------------------------------------------------------------
// EIN gemeinsames Bedienmuster für alle Modale, die Quelldokumente/Positionen
// auswählen, eine Vorschau zeigen und eine Hauptaktion auslösen
// (Auftrag aus Angeboten, Rechnung aus Aufträgen, Auftrag-SUB, Positions-Picker,
//  „Mehrere einfügen").
//
// Grundprinzip (überall gleich):
//  • Kopf (Modusumschaltung/Zielvariante) bleibt fix sichtbar.
//  • NUR die Auswahlliste links scrollt (eigener Scrollbereich).
//  • Vorschau + Validierung rechts bleiben dauerhaft sichtbar.
//  • Aktionsleiste unten bleibt sichtbar – kein Scrollen des ganzen Modals.
//  • iPad/schmal: Spalten stapeln, die Liste bleibt der einzige große Scrollbereich.
//
// Reine Layout-/Darstellungskomponente: KEINE Fachlogik (Dokumentkette,
// Berechnung, Status, Rechte) – diese bleibt in den jeweiligen Modalen.
// ============================================================
import { ReactNode } from "react";
import { Modal } from "../ui";

export interface SourceSelectLayoutProps {
  title: string;
  onClose: () => void;
  /** Modal-Breite (Standard xl ≈ 900px – passend für zwei Spalten). */
  size?: "xl" | "2xl";
  /** Fixer Kopf über den Spalten (Modus „gemeinsam/je Quelle", Zielvariante). Scrollt nicht. */
  header?: ReactNode;
  /** Optionale kleine Überschrift über der Auswahlliste. */
  listLabel?: ReactNode;
  /** Linke Spalte – der EINZIGE große Scrollbereich (Quell-/Positionsliste). */
  list: ReactNode;
  /** Rechte Spalte – dauerhaft sichtbare Vorschau, Zusammenfassung, Warnungen, Validierung. */
  preview: ReactNode;
  /** Sticky Aktionsleiste unten (Zurück + Hauptaktion). */
  footer: ReactNode;
}

export default function SourceSelectLayout({
  title, onClose, size = "xl", header, listLabel, list, preview, footer,
}: SourceSelectLayoutProps) {
  return (
    <Modal open onClose={onClose} title={title} size={size}>
      {/* Gesamthöhe gedeckelt → das Modal selbst scrollt nicht; nur die Liste (und bei
          Überlänge die Vorschau) bekommen eigene Scrollbereiche. */}
      <div className="flex flex-col" style={{ maxHeight: "calc(100dvh - 11rem)" }}>
        {header && <div className="mb-3 shrink-0">{header}</div>}

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Linke Spalte: Auswahlliste – einziger großer Scrollbereich */}
          <div className="flex min-h-0 flex-col">
            {listLabel && (
              <div className="mb-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">{listLabel}</div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border max-h-[48vh] lg:max-h-none"
              style={{ borderColor: "var(--border)" }}>
              {list}
            </div>
          </div>

          {/* Rechte Spalte: Vorschau/Validierung – bleibt sichtbar (eigener Scroll nur bei Überlänge) */}
          <div className="min-h-0 overflow-y-auto">
            <div className="space-y-3">{preview}</div>
          </div>
        </div>

        {/* Aktionsleiste – immer sichtbar */}
        <div className="mt-3 shrink-0 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          {footer}
        </div>
      </div>
    </Modal>
  );
}

/** Vorschau-Karte (einheitliche Optik der rechten Spalte). */
export function PreviewCard({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
      {title && <div className="mb-2 font-semibold">{title}</div>}
      <div className="space-y-1 text-slate-500 dark:text-slate-400">{children}</div>
    </div>
  );
}

/** Kompakter Warnhinweis für die Vorschau-Spalte (rot = blockierend, amber = Hinweis). */
export function PreviewNote({ tone = "amber", children }: { tone?: "amber" | "red"; children: ReactNode }) {
  const cls = tone === "red"
    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
    : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
  return <div className={`rounded-xl border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

/** Nummern kompakt darstellen: „A-1, A-2, A-3 +4 weitere" (vermeidet zu hohe Vorschau). */
export function summarizeNumbers(numbers: (string | null | undefined)[], max = 6): string {
  const list = numbers.map((n) => (n && String(n).trim()) || "—");
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max} weitere`;
}
