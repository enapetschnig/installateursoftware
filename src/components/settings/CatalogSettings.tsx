// ============================================================
// B4Y SuperAPP – Einstellungen: Großhandel & Kataloge
// ------------------------------------------------------------
// Verwaltung der Datanorm-Großhändler-Kataloge (Migr. 0144/0149/0151):
//   * Übersicht aller importierten Kataloge (Artikel, Preisstand, Import)
//   * Absender-Domains je Katalog – ordnet eingehende Datanorm-Preismails
//     dem richtigen Katalog zu, sobald MEHRERE Kataloge existieren
//     (api/_lib/datanorm.js → applyDatanormUpdates)
//   * Anleitung, wie ein weiterer Großhändler hinzukommt (Vollimport
//     per scripts/datanorm-import.mjs; Import-UI ist Ausbaustufe)
//
// Die Suche (Editor-Picker + Sprach-Angebot) läuft immer über ALLE
// Kataloge der Organisation – der Lieferantenname steht am Treffer.
// ============================================================

import { useEffect, useState } from "react";
import { Truck, Save, Info } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { toast, toastError } from "../../lib/toast";

interface CatalogRow {
  id: string;
  name: string;
  item_count: number | null;
  valid_from: string | null;
  imported_at: string | null;
  source_info: string | null;
  sender_domains: string[] | null;
}

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–";

export default function CatalogSettings({ canManage }: { canManage: boolean }) {
  const [catalogs, setCatalogs] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainDrafts, setDomainDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("supplier_catalogs")
        .select("id, name, item_count, valid_from, imported_at, source_info, sender_domains")
        .order("created_at");
      if (!alive) return;
      if (error) toastError(`Kataloge konnten nicht geladen werden: ${error.message}`);
      const rows = (data as CatalogRow[]) ?? [];
      setCatalogs(rows);
      setDomainDrafts(Object.fromEntries(rows.map((c) => [c.id, (c.sender_domains ?? []).join(", ")])));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  async function saveDomains(cat: CatalogRow) {
    const domains = (domainDrafts[cat.id] ?? "")
      .split(/[,;\s]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    setSavingId(cat.id);
    const { error } = await supabase
      .from("supplier_catalogs")
      .update({ sender_domains: domains.length > 0 ? domains : null })
      .eq("id", cat.id);
    setSavingId(null);
    if (error) { toastError(`Speichern fehlgeschlagen: ${error.message}`); return; }
    setCatalogs((prev) => prev.map((c) => (c.id === cat.id ? { ...c, sender_domains: domains } : c)));
    toast("Absender-Zuordnung gespeichert.");
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Truck size={16} style={{ color: "var(--accent)" }} /> Großhändler-Kataloge
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Die Katalog-Artikel stehen mit echten Einkaufspreisen in der Angebots-/Dokumenterstellung
          („Positionen einfügen" → Großhandel, Seitenleisten-Suche) und im Sprach-Angebot zur Verfügung.
          Preis-Mails des Händlers (Datanorm) werden automatisch eingespielt.
        </p>

        {loading ? (
          <div className="py-6 text-center text-sm text-slate-400">Lädt …</div>
        ) : catalogs.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed p-4 text-sm text-slate-400" style={{ borderColor: "var(--border)" }}>
            Noch kein Katalog importiert. Siehe Anleitung unten.
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {catalogs.map((c) => (
              <div key={c.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{c.name}</span>
                  <span className="rounded bg-[var(--hover)] px-1.5 py-0.5 text-[11px] text-slate-500">
                    {Number(c.item_count ?? 0).toLocaleString("de-AT")} Artikel
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Preisstand: {fmtDate(c.valid_from)} · Letzter Import/Update: {fmtDate(c.imported_at)}
                  {c.source_info ? ` · ${c.source_info}` : ""}
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="min-w-[240px] flex-1 text-xs text-slate-500">
                    Absender-Domains für Preis-Mails (z. B. „sonepar.at, sonepar.com")
                    <input
                      className="input mt-1 text-sm"
                      value={domainDrafts[c.id] ?? ""}
                      disabled={!canManage}
                      onChange={(e) => setDomainDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      placeholder="haendler.at"
                    />
                  </label>
                  {canManage && (
                    <button className="btn-primary px-3 py-2 text-sm" disabled={savingId === c.id} onClick={() => void saveDomains(c)}>
                      <Save size={14} /> Speichern
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Info size={16} style={{ color: "var(--accent)" }} /> Weiteren Großhändler hinzufügen
        </div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-400">
          <li>Datanorm-Dateien beim Händler anfordern (Vollversion inkl. Rabattdatei).</li>
          <li>
            Vollimport ausführen:{" "}
            <code className="rounded bg-[var(--hover)] px-1 py-0.5">
              node scripts/datanorm-import.mjs --dir &lt;Ordner&gt; --name "&lt;Händlername&gt;"
            </code>
          </li>
          <li>Hier die Absender-Domain des Händlers hinterlegen, damit Preis-Mails automatisch dem richtigen Katalog zugeordnet werden.</li>
        </ol>
        <p className="mt-2 text-[11px] text-slate-400">
          Die Suche läuft danach automatisch über alle Kataloge; bei Treffern mehrerer Händler steht der
          Lieferantenname an der Position. Existiert nur ein Katalog, ist keine Absender-Zuordnung nötig.
        </p>
      </div>
    </div>
  );
}
