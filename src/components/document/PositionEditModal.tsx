// ============================================================
// B4Y SuperAPP – Positions-Vollmaske (Werkzeug-Symbol im Dokumenteditor)
// Bearbeitet EINE Dokumentposition vollständig – dokumentlokal. Aufbau an den
// zentralen ServiceEditor angelehnt: zwei Reiter „Informationen" (Texte, Menge,
// Preise, MwSt, Foto) und „Kalkulation" (Selbstkosten/Material/Arbeitszeit +
// Live-Summen/Marge).
// WICHTIG: Änderungen wirken NUR auf diese Position in DIESEM Dokument.
// Leistungs-/Artikelstamm, Textbausteine und Kalkulation bleiben unverändert
// (die Position trägt ihre Werte als eigenständigen Snapshot). Foto ebenfalls
// dokumentlokal: Anzeige aus dem jeweiligen Bucket; Upload/Ersatz landet im
// mandantengetrennten Bucket document-images (ändert NIE den Stamm). Nutzt die
// zentrale Summen-/Margenlogik (lineNet/lineCost, vatTotals, marginTone) –
// KEINE zweite Kalkulationsengine. Gilt für alle Dokumente mit DocumentCanvas.
// ============================================================
import { useRef, useState } from "react";
import { Info, Calculator, Upload, ImagePlus, X } from "lucide-react";
import { Modal } from "../ui";
import { NumCell } from "../calc-ui";
import { eur } from "../../lib/format";
import { DocPosition, lineNet, lineCost } from "../../lib/document-types";
import { vatTotals, marginTone } from "../../lib/calc";
import { supabase } from "../../lib/supabase";
import { detectBucket, StorageBucket } from "../../lib/storage";
import SignedImage from "../SignedImage";

const UNITS = ["Stk", "h", "m", "m²", "m³", "lfm", "kg", "t", "l", "pauschal", "Satz", "Tag", "Psch"];
const VAT_RATES = [0, 10, 13, 20];
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Bucket eines Positions-Fotos: aus dem Wert erkennen, sonst nach Positionstyp. */
function imageBucketFor(position: DocPosition, value: string | null | undefined): StorageBucket {
  return detectBucket(value) ?? (position.type === "article" ? "article-images" : "service-images");
}

export default function PositionEditModal({
  position, readOnly, onClose, onSave,
}: {
  position: DocPosition;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (patch: Partial<DocPosition>) => void;
}) {
  const [tab, setTab] = useState<"info" | "calc">("info");
  const [f, setF] = useState({
    name: position.name ?? "",
    long_text: position.long_text ?? "",
    description: position.description ?? "",
    qty: Number(position.qty) || 0,
    unit: position.unit || "Stk",
    unit_price: Number(position.unit_price) || 0,
    discount_percent: Number(position.discount_percent) || 0,
    vat_rate: Number.isFinite(Number(position.vat_rate)) ? Number(position.vat_rate) : 20,
    unit_cost: Number(position.unit_cost) || 0,
    material_cost: Number(position.material_cost) || 0,
    labor_minutes: Number(position.labor_minutes) || 0,
    image_url: position.image_url ?? "",
  });
  const [uploading, setUploading] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  // Live-Summen/Marge über die zentrale Logik (temporäre Position aus aktuellen Feldern).
  const temp = { ...position, ...f } as DocPosition;
  const net = lineNet(temp);
  const cost = lineCost(temp);
  const marginEur = round2(net - cost);
  const marginPct = net > 0 ? Math.round((marginEur / net) * 100) : 0;
  const vt = vatTotals(net, f.vat_rate);
  const tone = marginTone(marginPct);
  const toneCls = tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-rose-500";

  // Dokumentlokaler Foto-Upload → mandantengetrennter Bucket document-images (Org-Ordner).
  async function uploadImage(file: File) {
    setUploading(true); setImgErr(null);
    try {
      const { data: orgId, error: orgErr } = await supabase.rpc("current_org_id");
      if (orgErr || !orgId) { setImgErr("Organisation konnte nicht ermittelt werden – Upload abgebrochen."); return; }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${orgId}/${crypto.randomUUID()}.${ext}`;
      const upRes = await supabase.storage.from("document-images").upload(path, file, { cacheControl: "3600", upsert: false });
      if (upRes.error) { setImgErr(`Bild-Upload fehlgeschlagen: ${upRes.error.message}`); return; }
      const { data } = supabase.storage.from("document-images").getPublicUrl(path);
      set("image_url", data.publicUrl);
    } catch (e: unknown) { setImgErr(e instanceof Error ? e.message : "Bild-Upload fehlgeschlagen."); }
    finally { setUploading(false); }
  }

  function save() {
    onSave({
      name: f.name,
      long_text: f.long_text || null,
      description: f.description || null,
      qty: Number(f.qty) || 0,
      unit: f.unit,
      unit_price: Number(f.unit_price) || 0,
      discount_percent: Number(f.discount_percent) || 0,
      vat_rate: Number(f.vat_rate) || 0,
      unit_cost: Number(f.unit_cost) || 0,
      material_cost: Number(f.material_cost) || 0,
      labor_minutes: Number(f.labor_minutes) || 0,
      image_url: f.image_url || null,
    });
  }

  const TabBtn = ({ id, icon: Icon, label }: { id: "info" | "calc"; icon: typeof Info; label: string }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === id ? "text-white" : "text-slate-500 hover:bg-[var(--hover)]"}`}
      style={tab === id ? { background: "var(--accent)" } : undefined}
    >
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} title="Position bearbeiten" size="xl">
      <p className="mb-3 rounded-lg bg-[var(--hover)] px-3 py-2 text-xs text-slate-500">
        Änderungen gelten nur für diese Position in diesem Dokument – Leistungs-/Artikelstamm und Kalkulation bleiben unverändert.
      </p>

      <div className="mb-4 flex gap-2 border-b pb-2" style={{ borderColor: "var(--border)" }}>
        <TabBtn id="info" icon={Info} label="Informationen" />
        <TabBtn id="calc" icon={Calculator} label="Kalkulation" />
      </div>

      {tab === "info" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label">Kurztext</label>
            <input className="input" value={f.name} disabled={readOnly} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Langtext</label>
            <textarea className="input min-h-[90px]" value={f.long_text} disabled={readOnly} onChange={(e) => set("long_text", e.target.value)} /></div>
          <div><label className="label">Menge</label>
            <NumCell value={f.qty} suffix={f.unit} onChange={(v) => set("qty", v)} /></div>
          <div><label className="label">Einheit</label>
            <select className="input" value={f.unit} disabled={readOnly} onChange={(e) => set("unit", e.target.value)}>
              {[f.unit, ...UNITS.filter((u) => u !== f.unit)].map((u) => <option key={u} value={u}>{u}</option>)}
            </select></div>
          <div><label className="label">Einzelpreis VK netto</label>
            <NumCell value={f.unit_price} onChange={(v) => set("unit_price", v)} /></div>
          <div><label className="label">Rabatt %</label>
            <NumCell value={f.discount_percent} suffix="%" onChange={(v) => set("discount_percent", v)} /></div>
          <div><label className="label">MwSt %</label>
            <select className="input" value={f.vat_rate} disabled={readOnly} onChange={(e) => set("vat_rate", Number(e.target.value))}>
              {[f.vat_rate, ...VAT_RATES.filter((r) => r !== f.vat_rate)].map((r) => <option key={r} value={r}>{r} %</option>)}
            </select></div>

          <div className="sm:col-span-2"><label className="label">Foto (nur dieses Dokument)</label>
            {imgErr && <div className="mb-1 text-xs text-rose-500">{imgErr}</div>}
            <div className="flex items-center gap-3">
              <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--hover)" }}>
                {f.image_url
                  ? <SignedImage bucket={imageBucketFor(position, f.image_url)} value={f.image_url} alt="" className="h-full w-full object-cover" />
                  : <ImagePlus size={24} className="text-slate-400" />}
              </div>
              {!readOnly && (
                <>
                  <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadImage(file); e.target.value = ""; }} />
                  <div className="flex flex-col gap-2">
                    <button type="button" className="btn-outline" onClick={() => imgRef.current?.click()} disabled={uploading}>
                      <Upload size={16} /> {uploading ? "Lädt …" : f.image_url ? "Foto ändern" : "Foto hochladen"}
                    </button>
                    {f.image_url && <button type="button" className="btn-ghost text-rose-500" onClick={() => set("image_url", "")}><X size={15} /> Entfernen</button>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "calc" && (
        <div className="space-y-4">
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-sm font-bold">Kalkulationsdaten (nur dieses Dokument)</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><label className="label">Selbstkosten/EK netto je Einheit</label>
                <NumCell value={f.unit_cost} onChange={(v) => set("unit_cost", v)} /></div>
              <div><label className="label">davon Materialkosten je Einheit</label>
                <NumCell value={f.material_cost} onChange={(v) => set("material_cost", v)} /></div>
              <div><label className="label">Arbeitszeit je Einheit</label>
                <NumCell value={f.labor_minutes} suffix="min" onChange={(v) => set("labor_minutes", v)} /></div>
            </div>
          </div>

          <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <Row label="Positionssumme netto" value={eur(net)} strong />
            <Row label="EK gesamt" value={eur(cost)} />
            <Row label={`MwSt (${f.vat_rate}%)`} value={eur(vt.vat)} />
            <Row label="Positionssumme brutto" value={eur(vt.gross)} />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-sm text-slate-500">Marge / DB</span>
              <span className={`tabular-nums text-sm font-semibold ${toneCls}`}>{marginPct}% · {eur(marginEur)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
        {!readOnly && <button className="btn-primary" onClick={save}>Übernehmen</button>}
      </div>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-sm ${strong ? "font-semibold" : "text-slate-500"}`}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-bold" : "text-sm"}`} style={strong ? { color: "var(--accent)" } : undefined}>{value}</span>
    </div>
  );
}
