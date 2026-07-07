// ============================================================
// B4Y SuperAPP – Schnell-Anlage von Stammdaten aus dem Editor
// Artikel / Leistung / Textbaustein / Titel direkt anlegen und
// als Position ins Dokument übernehmen.
//
// WICHTIG: Es entstehen KEINE isolierten Editor-Daten. Jeder Eintrag wird
// dauerhaft im passenden ZENTRALEN Stamm gespeichert (articles / services /
// text_blocks) – mandantenfähig (organization_id DEFAULT current_org_id()),
// mit Ersteller (created_by). Gewerk & Einheit kommen aus den echten
// Stammdaten (trades / units), damit die Einordnung/Filterung sofort stimmt.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui";
import { ErrorBanner } from "../calc-ui";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { DocPosition, emptyPosition } from "../../lib/document-types";
import { UNITS } from "../../lib/calc-types";

export type QuickKind = "article" | "service" | "text" | "title";

const LABELS: Record<QuickKind, string> = {
  article: "Neuer Artikel",
  service: "Neue Leistung",
  text: "Neuer Textbaustein",
  title: "Neuer Titel",
};

const STAMM_HINT: Record<QuickKind, string> = {
  article: "Dieser Artikel wird dauerhaft im Artikelstamm gespeichert und kann später wiederverwendet werden.",
  service: "Diese Leistung wird dauerhaft im Leistungsstamm gespeichert und kann später wiederverwendet werden.",
  text: "Dieser Textbaustein wird dauerhaft im Textbausteinstamm gespeichert und kann später wiederverwendet werden.",
  title: "Dieser Titel wird dauerhaft im Titel-/Gewerkestamm gespeichert und kann später wiederverwendet werden.",
};

type TradeOpt = { id: string; name: string };

export default function QuickCreate({
  kind, onClose, onCreated,
}: {
  kind: QuickKind;
  onClose: () => void;
  onCreated: (pos: DocPosition, reload: boolean) => void;
}) {
  const { session } = useAuth();
  const [f, setF] = useState<Record<string, string>>({
    name: "", unit: "Stk", sale_price: "", purchase_price: "", supplier: "",
    trade_id: "", short_text: "", content: "", level: "1", vat_rate: "20",
  });
  const [trades, setTrades] = useState<TradeOpt[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Gewerke + Einheiten aus den ZENTRALEN Stammdaten laden (mandantenfähig via RLS).
  useEffect(() => {
    (async () => {
      const [t, u] = await Promise.all([
        supabase.from("trades").select("id,name").eq("active", true).order("sort_order").order("name"),
        supabase.from("units").select("name").eq("active", true).order("sort_order").order("name"),
      ]);
      setTrades((t.data as TradeOpt[]) ?? []);
      const dbUnits = ((u.data as { name: string }[]) ?? []).map((x) => x.name).filter(Boolean);
      setUnits(dbUnits.length ? dbUnits : [...UNITS]);
    })();
  }, []);

  // Anzeigename des gewählten Gewerks (wird als category-Text mitgespeichert → konsistente Gruppierung).
  const tradeName = useMemo(() => trades.find((t) => t.id === f.trade_id)?.name ?? null, [trades, f.trade_id]);

  async function submit() {
    if (!f.name.trim()) { setErr("Bezeichnung erforderlich."); return; }
    setBusy(true); setErr(null);
    const uid = session?.user.id ?? null;
    try {
      if (kind === "article") {
        const { data, error } = await supabase.from("articles").insert({
          name: f.name.trim(), unit: f.unit || "Stk",
          sale_price: Number(f.sale_price) || 0, purchase_price: Number(f.purchase_price) || 0,
          list_price: Number(f.sale_price) || 0, vat_rate: Number(f.vat_rate) || 20,
          supplier: f.supplier || null, trade_id: f.trade_id || null, category: tradeName,
          active: true, created_by: uid,
        }).select("*").single();
        if (error) throw error;
        onCreated(emptyPosition("article", {
          article_id: data.id, name: data.name, description: data.category ?? null,
          unit: data.unit ?? "Stk", unit_price: Number(data.sale_price) || 0,
          unit_cost: Number(data.purchase_price) || 0, material_cost: Number(data.purchase_price) || 0,
          vat_rate: Number(data.vat_rate) || 20,
        }), true);
      } else if (kind === "service") {
        const sale = Number(f.sale_price) || 0;
        const { data, error } = await supabase.from("services").insert({
          name: f.name.trim(), unit: f.unit || "Stk", short_text: f.short_text || null,
          vat_rate: Number(f.vat_rate) || 20, vk_net_manual: sale, material_mode: "kein",
          aufschlag_percent: 0, trade_id: f.trade_id || null, category: tradeName,
          active: true, created_by: uid,
        }).select("*").single();
        if (error) throw error;
        onCreated(emptyPosition("service", {
          service_id: data.id, name: data.name, description: data.short_text ?? null,
          unit: data.unit ?? "Stk", unit_price: sale, unit_cost: 0,
          vat_rate: Number(data.vat_rate) || 20,
        }), true);
      } else if (kind === "text") {
        const { data, error } = await supabase.from("text_blocks").insert({
          title: f.name.trim(), content: f.content || "", type: "text",
          category: "standard", active: true, created_by: uid,
        }).select("*").single();
        if (error) throw error;
        onCreated(emptyPosition("text", { text_block_id: data.id, name: data.title, content: data.content }), true);
      } else {
        const { data, error } = await supabase.from("text_blocks").insert({
          title: f.name.trim(), content: "", type: "titel", category: "titel",
          level: Number(f.level) || 1, active: true, created_by: uid,
        }).select("*").single();
        if (error) throw error;
        onCreated(emptyPosition("title", {
          title_id: data.id, text_block_id: data.id, name: data.title, level: Number(data.level) || 1,
        }), true);
      }
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Fehler beim Anlegen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={LABELS[kind]}>
      <ErrorBanner message={err} />
      {/* Klarer Hinweis: Eintrag landet dauerhaft im Stamm (kein isolierter Editor-Eintrag). */}
      <div className="mb-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--text)]">
        {STAMM_HINT[kind]}
      </div>
      <div className="space-y-3">
        <Field label={kind === "title" ? "Titeltext" : "Bezeichnung"}>
          <input className="input" value={f.name} autoFocus onChange={(e) => set("name", e.target.value)} />
        </Field>

        {(kind === "article" || kind === "service") && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Einheit">
              <select className="input" value={f.unit} onChange={(e) => set("unit", e.target.value)}>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="VK netto / Einheit"><input type="number" className="input" value={f.sale_price} onChange={(e) => set("sale_price", e.target.value)} /></Field>
          </div>
        )}
        {kind === "article" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="EK netto / Einheit"><input type="number" className="input" value={f.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} /></Field>
            <Field label="Lieferant"><input className="input" value={f.supplier} onChange={(e) => set("supplier", e.target.value)} /></Field>
          </div>
        )}
        {(kind === "article" || kind === "service") && (
          <Field label="Gewerk / Kategorie">
            <select className="input" value={f.trade_id} onChange={(e) => set("trade_id", e.target.value)}>
              <option value="">– kein Gewerk –</option>
              {trades.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        {kind === "service" && (
          <Field label="Kurztext"><input className="input" value={f.short_text} onChange={(e) => set("short_text", e.target.value)} /></Field>
        )}
        {kind === "text" && (
          <Field label="Inhalt"><textarea className="input min-h-[100px]" value={f.content} onChange={(e) => set("content", e.target.value)} /></Field>
        )}
        {kind === "title" && (
          <Field label="Ebene">
            <select className="input" value={f.level} onChange={(e) => set("level", e.target.value)}>
              <option value="1">Ebene 1</option><option value="2">Ebene 2</option><option value="3">Ebene 3</option>
            </select>
          </Field>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? "Anlegen …" : "Anlegen & einfügen"}</button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
