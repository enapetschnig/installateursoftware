// ============================================================
// B4Y SuperAPP – Zentrale Leistungs-Anlegemaske (wiederverwendbar)
// EINZIGE „Neue Leistung"-Maske – genutzt von Kalkulation → Leistungen
// UND vom Dokumenteditor. Keine Parallelmaske. Legt die Leistung im
// services-Stamm an (mandantenfähig via RLS/Trigger). Danach kann der
// Aufrufer zur Kalkulation („Anlegen & kalkulieren") navigieren oder die
// Leistung direkt ins Dokument übernehmen.
// ============================================================
import { useRef, useState } from "react";
import { Upload, ImagePlus, X } from "lucide-react";
import { Modal } from "../ui";
import { ErrorBanner } from "../calc-ui";
import { supabase } from "../../lib/supabase";
import SignedImage from "../SignedImage";
import { Service, Trade, VAT_RATES, gewerkNo, isValidPosition, suggestPosition } from "../../lib/calc-types";
import PositionNumberPicker, { OccupiedPosition } from "./PositionNumberPicker";

export default function NewServiceForm({ trades, services, unitOpts, initialTradeId, submitLabel, onClose, onCreated }:
  { trades: Trade[]; services: Service[]; unitOpts: string[];
    /** Vorausgewähltes Gewerk (z.B. aus dem aktuellen Dokument-Filter). */
    initialTradeId?: string | null;
    /** Beschriftung des Bestätigungsbuttons (Default: „Anlegen & kalkulieren"). */
    submitLabel?: string;
    onClose: () => void;
    /** Liefert die neu angelegte Leistung. */
    onCreated: (service: Service) => void }) {
  const posFor = (tradeId: string) => suggestPosition(
    services.filter((s) => s.trade_id === tradeId)
      .map((s) => s.positions_nummer || (s.service_number && s.service_number.includes("-") ? s.service_number.split("-")[1] : ""))
      .filter(Boolean) as string[]
  );
  const firstTrade = (initialTradeId && trades.some((t) => t.id === initialTradeId) ? initialTradeId : trades[0]?.id) ?? "";
  const [f, setF] = useState({ name: "", long_text: "", note: "", calculation_text: "", image_url: "", trade_id: firstTrade, pos: firstTrade ? posFor(firstTrade) : "010", unit: "Stk", vat_rate: 20 });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function uploadServiceImage(file: File) {
    setUploading(true); setErr(null);
    try {
      // Mandantentrennung: Upload in den Org-Ordner (<organization_id>/<datei>) – Policies (Migr. 0099).
      const { data: orgId, error: orgErr } = await supabase.rpc("current_org_id");
      if (orgErr || !orgId) { setErr("Organisation konnte nicht ermittelt werden – Bild-Upload abgebrochen."); return; }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${orgId}/${crypto.randomUUID()}.${ext}`;
      const upRes = await supabase.storage.from("service-images").upload(path, file, { cacheControl: "3600", upsert: false });
      if (upRes.error) { setErr(`Bild-Upload fehlgeschlagen: ${upRes.error.message}`); return; }
      const { data } = supabase.storage.from("service-images").getPublicUrl(path);
      set("image_url", data.publicUrl);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Bild-Upload fehlgeschlagen."); }
    finally { setUploading(false); }
  }
  const trade = trades.find((t) => t.id === f.trade_id);
  const gNo = gewerkNo(trade?.sort_order);

  // Positionsnummer einer Leistung (positions_nummer bevorzugt, sonst aus der vollen Nummer).
  const posOf = (s: Service) =>
    s.positions_nummer || (s.service_number && s.service_number.includes("-") ? s.service_number.split("-")[1] : "");

  // Belegte Positionsnummern des gewählten Gewerks (bereits geladene, RLS-gefilterte Liste).
  const occupied: OccupiedPosition[] = f.trade_id
    ? services
        .filter((s) => s.trade_id === f.trade_id)
        .map((s) => ({ pos: posOf(s), label: s.short_text || s.name }))
        .filter((o) => !!o.pos) as OccupiedPosition[]
    : [];

  function changeTrade(tradeId: string) {
    setF((p) => ({ ...p, trade_id: tradeId, pos: tradeId ? posFor(tradeId) : p.pos }));
  }

  async function save() {
    setErr(null);
    if (!f.trade_id) { setErr("Bitte Gewerk auswählen."); return; }
    if (!gNo) { setErr("Dieses Gewerk hat keine Gewerknummer. Bitte zuerst beim Gewerk eine Nummer hinterlegen."); return; }
    if (!isValidPosition(f.pos)) { setErr("Die Positionsnummer muss dreistellig sein (001–999)."); return; }
    if (!f.name.trim()) { setErr("Bitte Kurztext eingeben."); return; }
    if (!f.long_text.trim()) { setErr("Bitte Langtext eingeben."); return; }
    const full = `${gNo}-${f.pos}`;
    if (services.some((s) => s.service_number === full)) { setErr(`Die Leistungsnummer ${full} ist bereits vergeben.`); return; }
    setBusy(true);
    const { data, error } = await supabase.from("services").insert({
      service_number: full, positions_nummer: f.pos, name: f.name.trim(), long_text: f.long_text.trim(),
      calculation_text: f.calculation_text.trim() || null, image_url: f.image_url || null,
      internal_note: f.note || null, trade_id: f.trade_id, unit: f.unit, vat_rate: f.vat_rate, material_mode: "artikel",
    }).select("*").single();
    setBusy(false);
    if (error || !data) setErr(/duplicate|unique/i.test(error?.message || "") ? `Die Leistungsnummer ${full} ist bereits vergeben.` : (error?.message ?? "Fehler"));
    else onCreated(data as Service);
  }

  return (
    <Modal open onClose={onClose} title="Neue Leistung" size="xl">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {/* Leistungsfoto ganz oben (Upload/Ändern/Entfernen, Bucket service-images, signierte Anzeige). */}
        <div className="sm:col-span-2"><label className="label">Leistungsfoto (optional)</label>
          <div className="flex items-center gap-3">
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--hover)" }}>
              {f.image_url ? <SignedImage bucket="service-images" value={f.image_url} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={22} className="text-slate-400" />}
            </div>
            <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadServiceImage(file); e.target.value = ""; }} />
            <div className="flex flex-col gap-2">
              <button type="button" className="btn-outline" onClick={() => imgRef.current?.click()} disabled={uploading}>
                <Upload size={16} /> {uploading ? "Lädt …" : f.image_url ? "Bild ändern" : "Bild hochladen"}
              </button>
              {f.image_url && <button type="button" className="btn-ghost text-rose-500" onClick={() => set("image_url", "")}><X size={15} /> Entfernen</button>}
            </div>
          </div></div>
        <div className="sm:col-span-2"><label className="label label-req">Gewerk</label>
          <select className="input" value={f.trade_id} onChange={(e) => changeTrade(e.target.value)}>
            <option value="">– kein Gewerk –</option>{trades.map((t) => <option key={t.id} value={t.id}>{gewerkNo(t.sort_order) ?? "--"} · {t.name}</option>)}
          </select></div>
        <div className="sm:col-span-2"><label className="label label-req">Leistungsnummer</label>
          <PositionNumberPicker
            gewerkNo={gNo}
            value={f.pos}
            onChange={(p) => set("pos", p)}
            occupied={occupied}
            kind="service"
          />
        </div>
        <div className="sm:col-span-2"><label className="label label-req">Kurztext</label>
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="z.B. Wand spachteln und streichen" /></div>
        <div className="sm:col-span-2"><label className="label label-req">Langtext</label>
          <textarea className="input min-h-[140px]" value={f.long_text} onChange={(e) => set("long_text", e.target.value)} placeholder="Ausführliche Leistungsbeschreibung …" /></div>
        <div className="sm:col-span-2"><label className="label">Berechnung (optional)</label>
          <textarea className="input min-h-[90px] font-mono text-sm" value={f.calculation_text} onChange={(e) => set("calculation_text", e.target.value)} placeholder="Berechnungs-/Staffelpreis-Hinweise, z. B. von 1.000 € bis 9.999 € = 1,2 % (mind. 285)" /></div>
        <div><label className="label label-req">Einheit</label>
          <select className="input" value={f.unit} onChange={(e) => set("unit", e.target.value)}>{unitOpts.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
        <div><label className="label label-req">MwSt. %</label>
          <select className="input" value={f.vat_rate} onChange={(e) => set("vat_rate", Number(e.target.value))}>{VAT_RATES.map((v) => <option key={v} value={v}>{v} %</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label">Interne Notiz (optional)</label>
          <input className="input" value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !f.name.trim() || !f.long_text.trim() || !f.trade_id} onClick={save}>{busy ? "Anlegen …" : (submitLabel ?? "Anlegen & kalkulieren")}</button>
      </div>
    </Modal>
  );
}
