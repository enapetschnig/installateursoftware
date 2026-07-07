// ============================================================
// B4Y SuperAPP – Auswahl der Dokument-Signaturquelle (zentral, wiederverwendbar)
// ------------------------------------------------------------
// EIN UI-Baustein für Angebot/Auftrag/Rechnung (und ggf. SUB): wählt PRO DOKUMENT
// die Signaturquelle (Firmensignatur / Ersteller-Signatur / keine) und zeigt einen
// schlichten Hinweis, welche Signatur effektiv ins PDF kommt. Die eigentliche
// Auflösung passiert zentral in lib/document-signature.ts + der PDF-Engine –
// hier wird NUR die Quelle gesetzt (keine Doppellogik).
// ============================================================
import { useEffect, useState } from "react";
import { SignatureSource, loadCreatorName } from "../../lib/document-signature";

export default function SignatureSourcePicker({
  value, onChange, createdBy, disabled,
}: {
  value: SignatureSource;
  onChange: (v: SignatureSource) => void;
  createdBy?: string | null;
  disabled?: boolean;
}) {
  const [creatorName, setCreatorName] = useState("");
  useEffect(() => {
    let alive = true;
    if (value === "creator" && createdBy) {
      loadCreatorName(createdBy).then((n) => { if (alive) setCreatorName(n); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [value, createdBy]);

  const hint = value === "company"
    ? "Firmensignatur"
    : value === "creator"
      ? `Ersteller-Signatur${creatorName ? ": " + creatorName : ""}`
      : "Keine";

  return (
    <div className="sm:col-span-2">
      <label className="label">Signatur (im PDF)</label>
      <select className="input" value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value as SignatureSource)}>
        <option value="company">Firmensignatur</option>
        <option value="creator">Ersteller-Signatur</option>
        <option value="none">Keine</option>
      </select>
      <p className="mt-1 text-xs text-slate-400">Effektiv im PDF: {hint}</p>
    </div>
  );
}
