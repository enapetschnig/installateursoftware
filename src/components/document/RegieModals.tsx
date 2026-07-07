// ============================================================
// B4Y SuperAPP – Regie-Einfügedialoge (direkt im Dokumenteditor)
// Regiestunde (aus Stundensatz) + Regiematerial (manuell / % / fix).
// Erzeugen reine DocPosition-Objekte – KEINE Stammdaten. Mandantenneutral:
// Stundensätze & Standardwerte kommen aus der DB (hourly_rates / company_settings).
// ============================================================
import { useMemo, useState } from "react";
import { Clock, Coins } from "lucide-react";
import { Modal } from "../ui";
import { eur } from "../../lib/format";
import { DocPosition } from "../../lib/document-types";
import {
  SidebarHourlyRate, makeRegieHourPosition, makeRegieMaterialPosition,
} from "../../lib/document-sources";

// ---- Regiestunde wählen --------------------------------------------------
export function RegieHourModal({
  rates, vatDefault, onInsert, onClose,
}: {
  rates: SidebarHourlyRate[];
  vatDefault: number;
  onInsert: (pos: DocPosition) => void;
  onClose: () => void;
}) {
  const [rateId, setRateId] = useState<string>(rates[0]?.id ?? "");
  const [hours, setHours] = useState<string>("1");
  const rate = useMemo(() => rates.find((r) => r.id === rateId) ?? null, [rates, rateId]);

  // Stundensätze nach Gewerk gruppieren (übersichtliche Auswahl).
  const groups = useMemo(() => {
    const m = new Map<string, SidebarHourlyRate[]>();
    for (const r of rates) {
      const k = r._tradeName || "Allgemein";
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return Array.from(m.entries());
  }, [rates]);

  function insert() {
    if (!rate) return;
    const pos = makeRegieHourPosition(rate, vatDefault);
    onInsert({ ...pos, qty: Math.max(0, Number(hours) || 0) });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Regiestunde einfügen">
      {rates.length === 0 ? (
        <p className="text-sm text-slate-500">
          Es sind keine aktiven Stundensätze hinterlegt. Bitte zuerst unter
          <span className="font-medium"> Kalkulation → Stundensätze</span> einen Satz anlegen.
        </p>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Stundensatz</span>
            <select className="input" value={rateId} onChange={(e) => setRateId(e.target.value)}>
              {groups.map(([trade, rs]) => (
                <optgroup key={trade} label={trade}>
                  {rs.map((r) => (
                    <option key={r.id} value={r.id}>{r.label} — {eur(r.sale_rate)}/Std</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Stunden</span>
            <input className="input" type="number" min={0} step="0.25" value={hours}
              onChange={(e) => setHours(e.target.value)} />
          </label>

          {rate && (
            <div className="rounded-xl bg-[var(--hover)] p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Netto-Summe</span>
                <span className="font-semibold">{eur((Number(hours) || 0) * (Number(rate.sale_rate) || 0))}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {eur(rate.sale_rate)}/Std · Selbstkosten {eur(rate.internal_rate)}/Std · MwSt {vatDefault}%
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
            <button className="btn-primary" onClick={insert} disabled={!rate}>
              <Clock size={15} /> Einfügen
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- Regiematerial wählen ------------------------------------------------
type MatMode = "manual" | "percent" | "fixed";

export function RegieMaterialModal({
  regieHours, defaultMode, defaultPercent, vatDefault, onInsert, onClose,
}: {
  regieHours: DocPosition[];      // vorhandene Regiestunden-Positionen im Dokument
  defaultMode: MatMode;
  defaultPercent: number;
  vatDefault: number;
  onInsert: (pos: DocPosition) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<MatMode>(defaultMode);
  const [percent, setPercent] = useState<string>(String(defaultPercent || 20));
  const [linkedId, setLinkedId] = useState<string>(regieHours[0]?.id ?? "");

  function insert() {
    const pos = makeRegieMaterialPosition({
      mode,
      percent: Number(percent) || 0,
      linkedRegieId: linkedId || null,
      vatRate: vatDefault,
    });
    onInsert(pos);
    onClose();
  }

  const ModeBtn = ({ m, label, hint }: { m: MatMode; label: string; hint: string }) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`flex-1 rounded-xl border p-3 text-left transition ${
        mode === m ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "hover:border-slate-300"
      }`}
      style={{ borderColor: mode === m ? "var(--accent)" : "var(--border)" }}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>
    </button>
  );

  return (
    <Modal open onClose={onClose} title="Regiematerial einfügen">
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <ModeBtn m="manual" label="Manuell" hint="Menge & Preis frei eingeben" />
          <ModeBtn m="percent" label="Prozentual" hint="% der Regiestunden (auto)" />
          <ModeBtn m="fixed" label="Pauschal" hint="Fixer Betrag" />
        </div>

        {mode === "percent" && (
          <div className="space-y-3 rounded-xl bg-[var(--hover)] p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">Prozentsatz</span>
              <div className="flex items-center gap-2">
                <input className="input w-28" type="number" min={0} step="1" value={percent}
                  onChange={(e) => setPercent(e.target.value)} />
                <span className="text-sm text-slate-500">% der verknüpften Regiestunde</span>
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">Bezug (Regiestunde)</span>
              {regieHours.length === 0 ? (
                <p className="text-[11px] text-amber-600">
                  Noch keine Regiestunde im Dokument. Bitte zuerst eine Regiestunde einfügen –
                  oder das Material später verknüpfen.
                </p>
              ) : (
                <select className="input" value={linkedId} onChange={(e) => setLinkedId(e.target.value)}>
                  {regieHours.map((r) => (
                    <option key={r.id} value={r.id}>{r.number ? `${r.number} · ` : ""}{r.name}</option>
                  ))}
                </select>
              )}
            </label>
            <p className="text-[11px] text-slate-400">
              Der Preis wird automatisch aus der Regiestunde berechnet und bei Änderungen
              aktualisiert. Eine manuelle Preisänderung in der Zeile hebt die Automatik auf.
            </p>
          </div>
        )}

        {mode === "fixed" && (
          <p className="rounded-xl bg-[var(--hover)] p-3 text-[11px] text-slate-400">
            Es wird eine Pauschalzeile (Menge 1) eingefügt. Den Betrag tragen Sie
            anschließend direkt in der Position ein.
          </p>
        )}

        {mode === "manual" && (
          <p className="rounded-xl bg-[var(--hover)] p-3 text-[11px] text-slate-400">
            Es wird eine leere Materialzeile eingefügt. Bezeichnung, Menge, Einheit und
            Preis tragen Sie direkt in der Position ein.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={insert}><Coins size={15} /> Einfügen</button>
        </div>
      </div>
    </Modal>
  );
}
