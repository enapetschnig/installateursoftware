// ============================================================
// B4Y SuperAPP – Zentrale Artikel-Anlegemaske (wiederverwendbar)
// EINZIGE Maske für „Neuer Artikel" – genutzt vom Artikelstamm
// (Kalkulation) UND vom Dokumenteditor. Keine Parallelmaske.
// Validierung, Nummernkreis (Gewerk+Pos), Bild-Upload, Preislogik,
// Speicherung in articles (mandantenfähig via RLS/Trigger), Audit.
// ============================================================
import { useRef, useState } from "react";
import { Upload, ImagePlus, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Modal } from "../ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "../calc-ui";
import { Article, Trade, articleSchema, VAT_RATES, gewerkNo, isValidPosition, suggestPosition } from "../../lib/calc-types";
import { round2 } from "../../lib/calc";
import SignedImage from "../SignedImage";
import PositionNumberPicker, { OccupiedPosition } from "./PositionNumberPicker";

const IMG_BUCKET = "article-images";

export default function ArticleForm({ article, trades, articles, unitOpts, initialTradeId, onClose, onSaved }:
  { article: Article | null; trades: Trade[]; articles: Article[]; unitOpts: string[];
    /** Vorausgewähltes Gewerk bei Neuanlage (z.B. aus dem aktuellen Dokument-Filter). */
    initialTradeId?: string | null;
    onClose: () => void;
    /** Wird nach erfolgreichem Speichern aufgerufen; liefert den gespeicherten Datensatz (für „direkt einfügen"). */
    onSaved: (saved?: Article) => void }) {

  // Positionsnummer-Vorschlag (Zehnerschritte) für die Artikel eines Gewerks
  const posFor = (tradeId: string) => suggestPosition(
    articles.filter((a) => a.trade_id === tradeId && a.id !== article?.id)
      .map((a) => a.positions_nummer || (a.article_number && a.article_number.includes("-") ? a.article_number.split("-")[1] : ""))
      .filter(Boolean) as string[]
  );
  const posOf = (a: Article) =>
    a.positions_nummer || (a.article_number && a.article_number.includes("-") ? a.article_number.split("-")[1] : "");

  const initTrade = article?.trade_id
    ?? (initialTradeId && trades.some((t) => t.id === initialTradeId) ? initialTradeId : trades[0]?.id)
    ?? "";
  const initPos = article
    ? (posOf(article) || "010")
    : (initTrade ? posFor(initTrade) : "010");
  const initAuf = article && article.purchase_price > 0 && article.sale_price > 0
    ? Math.round(((article.sale_price / article.purchase_price) - 1) * 100) : 30;
  const [f, setF] = useState({
    image_url: article?.image_url ?? "",
    pos: initPos,
    trade_id: initTrade,
    name: article?.name ?? "",
    description: article?.description ?? "",
    category: article?.category ?? "",
    unit: article?.unit ?? "Stk",
    supplier: article?.supplier ?? "",
    supplier_email: article?.supplier_email ?? "",
    purchase_price: article?.purchase_price ?? 0,
    aufschlag: initAuf as number | "",
    sale_price: article?.sale_price ?? 0,
    list_price: article?.list_price ?? 0,
    calculation_text: article?.calculation_text ?? "",
    vat_rate: article?.vat_rate ?? 20,
    is_stock: article?.is_stock ?? false,
    active: article?.active ?? true,
  });
  const [confirmTrade, setConfirmTrade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  const gNo = gewerkNo(trades.find((t) => t.id === f.trade_id)?.sort_order);

  // Belegte Positionsnummern des aktuell gewählten Gewerks (für den PositionNumberPicker).
  // Quelle = bereits geladene, mandantengefilterte Artikelliste (RLS); keine eigene Query.
  const occupied: OccupiedPosition[] = f.trade_id
    ? articles
        .filter((a) => a.trade_id === f.trade_id && a.id !== article?.id)
        .map((a) => ({ pos: posOf(a), label: a.name }))
        .filter((o) => !!o.pos) as OccupiedPosition[]
    : [];

  function applyTrade(tradeId: string) {
    const g = gewerkNo(trades.find((t) => t.id === tradeId)?.sort_order);
    setF((p) => ({ ...p, trade_id: tradeId, pos: g ? posFor(tradeId) : p.pos }));
  }
  function changeTrade(tradeId: string) {
    // Bestehender Artikel mit Nummer → vor Anpassung der Artikelnummer nachfragen
    if (article?.article_number && tradeId !== f.trade_id) setConfirmTrade(tradeId);
    else applyTrade(tradeId);
  }
  // VK netto wird IMMER automatisch berechnet: EK × (1 + Aufschlag/100)
  const aufNum = (a: number | "") => (a === "" || Number.isNaN(Number(a)) ? null : Number(a));
  function setPurchase(v: number) {
    setF((p) => { const a = aufNum(p.aufschlag); return { ...p, purchase_price: v, sale_price: a === null ? 0 : round2(v * (1 + a / 100)) }; });
  }
  function setAuf(raw: string) {
    setF((p) => {
      const aufschlag: number | "" = raw === "" ? "" : Number(raw);
      const a = aufNum(aufschlag);
      return { ...p, aufschlag, sale_price: a === null ? 0 : round2(p.purchase_price * (1 + a / 100)) };
    });
  }

  async function uploadImage(file: File) {
    setUploading(true); setErr(null);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from(IMG_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
      if (up.error) { setErr(`Bild-Upload fehlgeschlagen: ${up.error.message}`); return; }
      const { data } = supabase.storage.from(IMG_BUCKET).getPublicUrl(path);
      set("image_url", data.publicUrl);
    } catch (e: any) { setErr(e?.message ?? "Bild-Upload fehlgeschlagen."); }
    finally { setUploading(false); }
  }

  async function save() {
    setErr(null);
    if (!f.trade_id) { setErr("Bitte Gewerk auswählen."); return; }
    if (!gNo) { setErr("Dieses Gewerk hat keine Gewerknummer. Bitte zuerst beim Gewerk eine Nummer hinterlegen."); return; }
    if (!isValidPosition(f.pos)) { setErr("Die Positionsnummer muss dreistellig sein (001–999)."); return; }
    if (!f.name.trim()) { setErr("Bitte Artikelname eingeben."); return; }
    if (!f.description.trim()) { setErr("Bitte Beschreibung eingeben."); return; }
    if (!f.unit) { setErr("Bitte Einheit auswählen."); return; }
    if (f.vat_rate === null || f.vat_rate === undefined || Number.isNaN(Number(f.vat_rate))) { setErr("Bitte Mehrwertsteuer auswählen."); return; }
    if (!(f.purchase_price > 0)) { setErr("Bitte Einkaufspreis netto eingeben."); return; }
    if (f.aufschlag === "" || Number.isNaN(Number(f.aufschlag)) || Number(f.aufschlag) < 0) { setErr("Bitte Aufschlag eingeben."); return; }
    if (!(f.sale_price > 0)) { setErr("Bitte Einkaufspreis netto und Aufschlag eingeben."); return; }
    const articleNr = `${gNo}-${f.pos}`;
    if (articles.some((a) => a.article_number === articleNr && a.id !== article?.id)) {
      setErr(`Die Artikelnummer ${articleNr} ist bereits vergeben.`); return;
    }
    const parsed = articleSchema.safeParse({ ...f, article_number: articleNr, positions_nummer: f.pos, trade_id: f.trade_id || null });
    if (!parsed.success) { setErr(parsed.error.issues[0].message); return; }
    setBusy(true);
    const d = parsed.data;
    const payload = {
      ...d,
      article_number: articleNr,
      positions_nummer: f.pos,
      description: d.description || null,
      category: d.category || null,
      supplier: d.supplier || null,
      supplier_email: d.supplier_email || null,
      image_url: d.image_url || null,
      calculation_text: d.calculation_text || null,
    };
    const res = article
      ? await supabase.from("articles").update(payload).eq("id", article.id).select("*").single()
      : await supabase.from("articles").insert(payload).select("*").single();
    setBusy(false);
    if (res.error) setErr(/duplicate|unique/i.test(res.error.message) ? `Die Artikelnummer ${articleNr} ist bereits vergeben.` : res.error.message);
    else onSaved((res.data as Article) ?? undefined);
  }

  return (
    <Modal open onClose={onClose} title={article ? "Artikel bearbeiten" : "Neuer Artikel"} size="xl">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {/* Bild */}
        <div className="sm:col-span-2">
          <label className="label">Bild</label>
          <div className="flex items-center gap-3">
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--hover)" }}>
              {f.image_url ? <SignedImage bucket="article-images" value={f.image_url} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={22} className="text-slate-400" />}
            </div>
            <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadImage(file); e.target.value = ""; }} />
            <div className="flex flex-col gap-2">
              <button type="button" className="btn-outline" onClick={() => imgRef.current?.click()} disabled={uploading}>
                <Upload size={16} /> {uploading ? "Lädt …" : f.image_url ? "Bild ändern" : "Bild hochladen"}
              </button>
              {f.image_url && <button type="button" className="btn-ghost text-rose-500" onClick={() => set("image_url", "")}><X size={15} /> Entfernen</button>}
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="label label-req">Gewerk</label>
          <select className="input" value={f.trade_id} onChange={(e) => changeTrade(e.target.value)}>
            <option value="">– kein Gewerk –</option>
            {trades.map((t) => <option key={t.id} value={t.id}>{gewerkNo(t.sort_order) ?? "--"} · {t.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label label-req">Artikelnummer</label>
          <PositionNumberPicker
            gewerkNo={gNo}
            value={f.pos}
            onChange={(p) => set("pos", p)}
            occupied={occupied}
            kind="article"
          />
        </div>

        <div className="sm:col-span-2"><label className="label label-req">Artikelname</label>
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label label-req">Beschreibung</label>
          <textarea className="input min-h-[80px]" value={f.description} onChange={(e) => set("description", e.target.value)} /></div>

        <div>
          <label className="label label-req">Einheit</label>
          <select className="input" value={f.unit} onChange={(e) => set("unit", e.target.value)}>
            {unitOpts.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="label label-req">Mehrwertsteuer</label>
          <select className="input" value={f.vat_rate} onChange={(e) => set("vat_rate", Number(e.target.value))}>
            {VAT_RATES.map((v) => <option key={v} value={v}>{v} %</option>)}
          </select>
        </div>

        <div><label className="label">Lieferant</label>
          <input className="input" value={f.supplier} onChange={(e) => set("supplier", e.target.value)} /></div>
        <div><label className="label">Artikel-Mail</label>
          <input type="email" className="input" value={f.supplier_email} onChange={(e) => set("supplier_email", e.target.value)} placeholder="z.B. bestellung@lieferant.at" /></div>

        <div><label className="label label-req">Einkaufspreis netto €</label>
          <input type="number" step="0.01" min="0" className="input" value={f.purchase_price || ""} onChange={(e) => setPurchase(Number(e.target.value))} /></div>
        <div><label className="label label-req">Aufschlag %</label>
          <input type="number" step="1" min="0" className="input" value={f.aufschlag} onChange={(e) => setAuf(e.target.value)} placeholder="30" /></div>

        <div><label className="label label-req">Verkaufspreis netto €</label>
          <input type="number" step="0.01" className="input" value={f.sale_price || ""} readOnly tabIndex={-1}
            style={{ background: "var(--hover)", cursor: "not-allowed" }} />
          <p className="mt-1 text-[11px] text-slate-400">Wird automatisch aus Einkaufspreis und Aufschlag berechnet.</p></div>
        <div><label className="label">Listenpreis netto €</label>
          <input type="number" step="0.01" className="input" value={f.list_price || ""} onChange={(e) => set("list_price", Number(e.target.value))} /></div>

        {/* Berechnung analog zu Leistungen (services.calculation_text) – bewusst bei den Preisfeldern. */}
        <div className="sm:col-span-2"><label className="label">Berechnung (optional)</label>
          <textarea className="input min-h-[90px] font-mono text-sm" value={f.calculation_text} onChange={(e) => set("calculation_text", e.target.value)} placeholder="Berechnungs-/Staffelpreis-Hinweise, z. B. von 1.000 € bis 9.999 € = 1,2 % (mind. 285)" /></div>

        <div className="sm:col-span-2"><label className="label">Interne Notiz</label>
          <input className="input" value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="z.B. Nur für Innenbereich; Preis vor Bestellung prüfen" /></div>

        <div className="flex items-end pb-1"><Toggle checked={f.is_stock} onChange={(v) => set("is_stock", v)} label="Lagerartikel" /></div>
        <div className="flex items-end pb-1"><Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || uploading || !f.name.trim() || !f.trade_id || !gNo} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
      <ConfirmDialog open={!!confirmTrade} title="Gewerk ändern?" confirmLabel="Nummer anpassen"
        message={<>Soll die Artikelnummer an das neue Gewerk angepasst werden? Gewerknummer und ein neuer Positionsvorschlag werden übernommen.</>}
        onConfirm={() => { if (confirmTrade) applyTrade(confirmTrade); setConfirmTrade(null); }}
        onClose={() => setConfirmTrade(null)} />
    </Modal>
  );
}
