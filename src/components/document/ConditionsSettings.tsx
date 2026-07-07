// ============================================================
// B4Y SuperAPP – Dokument-Konditionen (Einstellungen)
// Wiederverwendbarer Block für Angebot/Auftrag/Rechnung:
// Zahlungsziel, Skonto %, Skontoziel, Standardnachlass, Standardaufschlag.
// Werte werden initial vom Kunden übernommen (conditions_snapshot) und sind hier
// manuell überschreibbar. Der Standardaufschlag ist intern – er erscheint NICHT
// im PDF, sondern wird in die Einzelpreise eingerechnet.
// ============================================================
import { DocumentConditions } from "../../lib/payment-conditions";

export default function ConditionsSettings({
  conditions, onChange, readOnly,
}: {
  conditions: DocumentConditions;
  onChange: (next: DocumentConditions) => void;
  readOnly?: boolean;
}) {
  const set = (k: keyof DocumentConditions, raw: string) => {
    const v = raw === "" ? null : Number(raw);
    onChange({ ...conditions, [k]: v });
  };
  const numVal = (v: number | null) => (v == null ? "" : String(v));

  return (
    <div>
      <div className="mb-1 text-sm font-bold">Zahlung &amp; Konditionen</div>
      <p className="mb-2 text-xs text-slate-400">
        Werden beim Anlegen vom Kunden übernommen und können hier für dieses Dokument geändert werden.
        Folgedokumente übernehmen die hier gesetzten Werte. Der Standardaufschlag ist intern und erscheint
        nicht im PDF.
      </p>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <div><label className="label">Zahlungsziel (Tage)</label>
          <input type="number" min="0" className="input" disabled={readOnly}
            value={numVal(conditions.termDays)} onChange={(e) => set("termDays", e.target.value)} placeholder="14" /></div>
        <div><label className="label">Standardnachlass %</label>
          <input type="number" min="0" step="0.1" className="input" disabled={readOnly}
            value={numVal(conditions.discountPercent)} onChange={(e) => set("discountPercent", e.target.value)} placeholder="0" /></div>
        <div><label className="label">Skonto %</label>
          <input type="number" min="0" step="0.1" className="input" disabled={readOnly}
            value={numVal(conditions.skontoPercent)} onChange={(e) => set("skontoPercent", e.target.value)} placeholder="z.B. 2" /></div>
        <div><label className="label">Skontoziel (Tage)</label>
          <input type="number" min="0" className="input" disabled={readOnly}
            value={numVal(conditions.skontoDays)} onChange={(e) => set("skontoDays", e.target.value)} placeholder="z.B. 7" /></div>
        <div><label className="label">Standardaufschlag % <span className="font-normal text-slate-400">(intern, unsichtbar)</span></label>
          <input type="number" min="0" step="0.1" className="input" disabled={readOnly}
            value={numVal(conditions.surchargePercent)} onChange={(e) => set("surchargePercent", e.target.value)} placeholder="0" />
          {conditions.surchargeApplied && (Number(conditions.surchargePercent) || 0) > 0 && (
            <p className="mt-1 text-[11px] text-slate-400">Bereits in die Einzelpreise eingerechnet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
