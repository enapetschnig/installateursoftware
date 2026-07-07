// ============================================================
// B4Y SuperAPP – Angebots-/Dokumentübersicht (kompakt)
// Kennzahlen: Positionen, Artikel, Leistungen, EK Material,
// Arbeitszeit, Netto, Ertrag, Stundensatz, Brutto, PDF erstellt am.
// ============================================================
import { Badge } from "../ui";
import { eur, dateAt } from "../../lib/format";
import { marginTone } from "../../lib/calc";
import { DocSummary } from "../../lib/document-types";

export default function DocumentSummary({
  summary, vatLabel, pdfCreatedAt,
}: {
  summary: DocSummary;
  vatLabel: string;
  pdfCreatedAt?: string | null;
}) {
  return (
    <div className="glass p-4">
      <div className="mb-2 text-sm font-bold">Übersicht</div>

      <div className="mb-2 grid grid-cols-3 gap-1.5 text-center">
        <Mini label="Positionen" value={summary.countPositions} />
        <Mini label="Artikel" value={summary.countArticles} />
        <Mini label="Leistungen" value={summary.countServices} />
      </div>

      <Row label="EK Material" value={eur(summary.materialCost)} />
      <Row label="Arbeitszeit" value={`${summary.laborHours.toLocaleString("de-AT")} h`} />
      <div className="my-1.5 h-px" style={{ background: "var(--border)" }} />
      {summary.discountPercent > 0 && (
        <>
          <Row label="Zwischensumme netto" value={eur(summary.subtotalNet)} />
          <Row label={`Nachlass ${summary.discountPercent.toLocaleString("de-AT")} %`} value={`− ${eur(summary.discountAmount)}`} />
        </>
      )}
      <Row label="Gesamt netto" value={eur(summary.net)} strong />
      <Row label={vatLabel} value={eur(summary.vat)} />
      <Row label="Gesamt brutto" value={eur(summary.gross)} strong accent />

      <div className="my-2 h-px border-t border-dashed" style={{ borderColor: "var(--border)" }} />
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Intern</div>
      <Row label="Selbstkosten" value={eur(summary.cost)} />
      <div className="flex items-center justify-between py-0.5">
        <span className="text-sm text-slate-500">Ertrag</span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums text-sm">{eur(summary.profit)}</span>
          <Badge tone={marginTone(summary.marginPct)}>{summary.marginPct}%</Badge>
        </span>
      </div>
      <Row label="Stundensatz (Ertrag/h)" value={summary.laborHours > 0 ? eur(summary.hourlyYield) : "–"} />
      <Row label="PDF erstellt am" value={pdfCreatedAt ? dateAt(pdfCreatedAt) : "–"} />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[var(--hover)] py-1.5">
      <div className="text-base font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-sm ${strong ? "font-semibold" : "text-slate-500"}`}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-bold" : "text-sm"}`} style={accent ? { color: "var(--accent)" } : undefined}>{value}</span>
    </div>
  );
}
