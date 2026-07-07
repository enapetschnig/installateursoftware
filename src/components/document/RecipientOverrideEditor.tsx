// ============================================================
// B4Y SuperAPP – Dokumentbezogene Empfängeranschrift (Override)
// Wiederverwendbar in allen Dokument-Editoren (Angebot/Auftrag/Rechnung/SUB).
// Überschreibt die Empfängeranschrift NUR für dieses Dokument – der Kundenstamm
// bleibt unverändert (Migration 0102: <table>.recipient_override jsonb).
// ============================================================
import { RecipientOverride } from "../../lib/contact-name";
import { Toggle } from "../calc-ui";

export default function RecipientOverrideEditor({
  value, onChange, disabled,
}: {
  value: RecipientOverride | null | undefined;
  onChange: (next: RecipientOverride) => void;
  disabled?: boolean;
}) {
  const v: RecipientOverride = value ?? {};
  const set = (k: keyof RecipientOverride, val: string | boolean) =>
    onChange({ ...v, [k]: val });
  const enabled = v.enabled === true;

  const field = (label: string, k: keyof RecipientOverride, placeholder?: string, span?: boolean) => (
    <div className={span ? "sm:col-span-2" : ""}>
      <label className="label">{label}</label>
      <input
        className="input"
        value={(v[k] as string) ?? ""}
        placeholder={placeholder}
        disabled={disabled || !enabled}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );

  return (
    <div>
      <div className="mb-2">
        <Toggle
          checked={enabled}
          onChange={(on) => set("enabled", on)}
          label="Abweichende Empfängeranschrift verwenden"
          disabled={disabled}
        />
      </div>
      <p className="mb-3 text-[11px] text-slate-400">
        Gilt nur für dieses Dokument (PDF + Versionen). Der Kundenstamm wird nicht geändert.
        Ist der Schalter aus, gilt automatisch die Anschrift des Kunden.
      </p>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {field("Empfänger / Firma", "name", "z. B. Hausverwaltung Muster GmbH", true)}
        {field("Zusatzzeile 1", "line1", "z. B. z. Hd. Frau Muster")}
        {field("Zusatzzeile 2", "line2", "z. B. Abteilung / c/o")}
        {field("Straße / Hausnummer", "street", "z. B. Beispielgasse 5")}
        {field("Adresszusatz", "address_extra", "z. B. / Stiege 1 / Top 14 oder / Hof")}
        {field("PLZ", "zip", "z. B. 1030")}
        {field("Ort", "city", "z. B. Wien")}
        {field("Land", "country", "z. B. Österreich", true)}
      </div>
    </div>
  );
}
