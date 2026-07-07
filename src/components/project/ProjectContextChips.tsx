// ============================================================
// B4Y SuperAPP – Zentraler Projektkontext (Kopf-Chips)
// ------------------------------------------------------------
// EINE Quelle für die ausführliche Projekt-Kopfzeile: die Projektakte
// (EntityHeader in ProjectDetail) und alle Dokumenteditoren (Angebot/
// Auftrag/Auftrag-SUB/Rechnung/Dokument) zeigen dieselben Felder:
// Nr., Betreff, Adresse, Kunde, Mitarbeiter, Baubeginn, geplante
// Fertigstellung. Keine Fetches – Aufrufer übergeben bereits geladene
// Daten. Mandantenneutral (nur projects-Spalten, keine Firmenlogik).
// ============================================================
import { HeaderChip, HeaderChipView } from "../EntityHeader";
import { Project } from "../../lib/types";
import { formatAddressInline } from "../../lib/contact-name";
import { dateAt, dateTimeAt } from "../../lib/format";

/** Chips mit dem ausführlichen Projektkontext (identisch zur Projektakte). */
export function projectContextChips(p: Project, customerName?: string | null): HeaderChip[] {
  const addr = formatAddressInline(p);
  return [
    { label: "Nr.", value: p.project_number ?? "–", mono: true },
    { label: "Betreff", value: p.title },
    { label: "Adresse", value: addr, title: addr },
    { label: "Kunde", value: customerName || "–" },
    { label: "Mitarbeiter", value: p.responsible ?? "–" },
    ...(p.start_at || p.start_date
      ? [{ label: "Baubeginn", value: p.start_at ? dateTimeAt(p.start_at) : dateAt(p.start_date) }]
      : []),
    ...(p.end_date ? [{ label: "Geplante Fertigstellung", value: dateAt(p.end_date) }] : []),
  ];
}

/**
 * Inline-Chipgruppe für die Kopfzeilen der Dokumenteditoren:
 * dezenter „Projekt"-Marker + dieselben Chips wie die Projektakte.
 * Rendert nichts, wenn kein Projekt zugeordnet ist.
 */
export default function ProjectContextChips({ project, customerName }: {
  project: Project | null | undefined;
  customerName?: string | null;
}) {
  if (!project) return null;
  return (
    <>
      <span
        className="inline-flex items-center rounded-lg border px-2 py-1 text-xs font-semibold text-slate-500 dark:text-slate-300"
        style={{ borderColor: "var(--border)" }}
      >
        Projekt
      </span>
      {projectContextChips(project, customerName).map((c, i) => (
        <HeaderChipView key={i} chip={c} />
      ))}
    </>
  );
}
