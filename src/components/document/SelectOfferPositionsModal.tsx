// ============================================================
// B4Y SuperAPP – Positionsauswahl beim Zusammenführen von Angeboten
// Zeigt die Positionen mehrerer (oder eines) Angebote(s) gruppiert nach
// Gewerk/Titel mit Häkchen. Liefert einen ItemFilter (Map<angebotId, posIds[]>)
// an die zentrale Dokumentketten-Engine (createOrderFromOffers).
// Bereits in aktiven Aufträgen enthaltene Positionen werden gesperrt
// (Schutz gegen Doppelbeauftragung) – über dieselbe zentrale Prüfung
// (orderedOfferItemIds) wie die Engine, daher konsistent.
// Mandantenneutral: keine firmenspezifische Logik.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { FileText, CheckSquare, Square, AlertTriangle } from "lucide-react";
import SourceSelectLayout, { PreviewCard, PreviewNote } from "./SourceSelectLayout";
import { DocPosition, normalizePositions, isCommercial, lineNet } from "../../lib/document-types";
import { ItemFilter, orderedOfferItemIds } from "../../lib/document-chain";
import { eur } from "../../lib/format";

/** Minimaler Angebots-Datentyp (strukturell – Offer ist kompatibel). */
export interface OfferLite {
  id: string;
  number?: string | null;
  title?: string | null;
  items?: unknown;
}

interface Row { id: string; name: string; qty: number; unit: string; net: number }
interface Group { title: string; rows: Row[] }
interface OfferData { id: string; number: string | null; title: string | null; groups: Group[] }

/** Positionen eines Angebots in Titel-Gruppen mit nur kaufmännischen Zeilen. */
function groupOffer(raw: unknown): Group[] {
  const positions: DocPosition[] = normalizePositions(raw);
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const p of positions) {
    if (p.type === "title") { cur = { title: p.name || "", rows: [] }; groups.push(cur); continue; }
    if (isCommercial(p.type)) {
      if (!cur) { cur = { title: "", rows: [] }; groups.push(cur); }
      cur.rows.push({ id: p.id, name: p.name || "(ohne Bezeichnung)", qty: p.qty, unit: p.unit, net: lineNet(p) });
    }
  }
  return groups.filter((g) => g.rows.length > 0);
}

export default function SelectOfferPositionsModal({
  offers, busy = false, onConfirm, onClose,
}: {
  offers: OfferLite[];
  busy?: boolean;
  onConfirm: (itemFilter: ItemFilter) => void;
  onClose: () => void;
}) {
  const data = useMemo<OfferData[]>(
    () => offers.map((o) => ({ id: o.id, number: o.number ?? null, title: o.title ?? null, groups: groupOffer(o.items) })),
    [offers],
  );

  // Bereits in aktiven Aufträgen enthaltene Positionen (gesperrt).
  const [used, setUsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    orderedOfferItemIds(offers.map((o) => o.id))
      .then((s) => {
        if (!alive) return;
        setUsed(s);
        // Gesperrte Positionen aus der Vorauswahl entfernen.
        setSel((prev) => {
          const m = new Map(prev);
          for (const [k, v] of m) m.set(k, new Set([...v].filter((id) => !s.has(id))));
          return m;
        });
      })
      .catch(() => { /* ohne Sperrdaten: UI bleibt nutzbar, Engine sichert zusätzlich ab */ });
    return () => { alive = false; };
  }, [offers]);

  // Auswahl je Angebot – startet mit ALLEN Positionen angehakt (gesperrte werden nach Laden entfernt).
  const [sel, setSel] = useState<Map<string, Set<string>>>(() => {
    const m = new Map<string, Set<string>>();
    for (const d of data) m.set(d.id, new Set(d.groups.flatMap((g) => g.rows.map((r) => r.id))));
    return m;
  });

  const allRowIds = (d: OfferData) => d.groups.flatMap((g) => g.rows.map((r) => r.id));
  const selectableIds = (d: OfferData) => allRowIds(d).filter((id) => !used.has(id));
  const toggle = (oid: string, pid: string) => {
    if (used.has(pid)) return;   // bereits beauftragt → nicht auswählbar
    setSel((prev) => {
      const m = new Map(prev);
      const s = new Set(m.get(oid) ?? []);
      s.has(pid) ? s.delete(pid) : s.add(pid);
      m.set(oid, s);
      return m;
    });
  };
  const setOfferAll = (d: OfferData, on: boolean) => setSel((prev) => {
    const m = new Map(prev);
    m.set(d.id, on ? new Set(selectableIds(d)) : new Set());
    return m;
  });

  const selCount = (oid: string) => sel.get(oid)?.size ?? 0;
  const selNet = (d: OfferData) => d.groups.reduce((a, g) => a + g.rows.reduce((b, r) => b + (sel.get(d.id)?.has(r.id) ? r.net : 0), 0), 0);
  const totalCount = data.reduce((a, d) => a + selCount(d.id), 0);
  const totalNet = data.reduce((a, d) => a + selNet(d), 0);
  const noPositions = data.every((d) => d.groups.length === 0);

  function confirm() {
    if (totalCount === 0 || busy) return;
    const filter: ItemFilter = new Map();
    for (const d of data) filter.set(d.id, Array.from(sel.get(d.id) ?? []).filter((id) => !used.has(id)));
    onConfirm(filter);
  }

  const header = (
    <p className="text-sm text-slate-500">
      Wähle aus, welche Positionen aus {data.length === 1 ? "dem Angebot" : `den ${data.length} Angeboten`} in den
      gemeinsamen Auftrag übernommen werden. Bereits beauftragte Positionen sind gesperrt.
    </p>
  );
  const previewCol = (
    <>
      <PreviewCard title="Vorschau">
        <div>Übernommene Positionen: {totalCount}</div>
        <div className="mt-1 font-semibold tabular-nums">Netto {eur(totalNet)}</div>
      </PreviewCard>
      {totalCount === 0 && <PreviewNote>Bitte mindestens eine Position wählen.</PreviewNote>}
    </>
  );
  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button className="btn-ghost" onClick={onClose} disabled={busy}>Zurück</button>
      <button className="btn-primary" onClick={confirm} disabled={busy || totalCount === 0}>
        {busy ? "Erstelle …" : `Auftrag erstellen (${totalCount})`}
      </button>
    </div>
  );

  return (
    <SourceSelectLayout title="Positionen für den Auftrag auswählen" onClose={onClose}
      header={header} listLabel="Angebote & Positionen" preview={previewCol} footer={footer}
      list={
        noPositions ? (
          <div className="px-3 py-6 text-center text-sm text-slate-400">
            Die gewählten Angebote enthalten keine verrechenbaren Positionen.
          </div>
        ) : (
          <div className="space-y-4 p-2">
          {data.map((d) => {
            const selectable = selectableIds(d);
            const allRows = allRowIds(d);
            const allOn = selectable.length > 0 && selCount(d.id) === selectable.length;
            const allOrdered = allRows.length > 0 && selectable.length === 0;
            return (
              <div key={d.id} className="rounded-xl border" style={{ borderColor: "var(--border)" }}>
                {/* Angebots-Kopf */}
                <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-3 py-2 dark:bg-white/5" style={{ borderColor: "var(--border)" }}>
                  <FileText size={15} className="text-[var(--accent)]" />
                  <span className="font-semibold">{d.title || "Ohne Titel"}</span>
                  <span className="text-xs text-slate-400">{d.number ?? "–"}</span>
                  <span className="ml-auto text-xs text-slate-500">{selCount(d.id)} / {selectable.length} offen · netto {eur(selNet(d))}</span>
                  {selectable.length > 0 && (
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOfferAll(d, !allOn)}>
                      {allOn ? <><Square size={13} /> Keine</> : <><CheckSquare size={13} /> Alle</>}
                    </button>
                  )}
                </div>

                {allOrdered && (
                  <div className="flex items-start gap-2 border-b px-3 py-2 text-xs text-amber-700 dark:text-amber-300" style={{ borderColor: "var(--border)" }}>
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    Alle Positionen dieses Angebots wurden bereits beauftragt.
                  </div>
                )}

                {/* Gruppen + Positionen */}
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {d.groups.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-slate-400">Keine verrechenbaren Positionen.</div>
                  ) : d.groups.map((g, gi) => (
                    <div key={gi} className="px-3 py-2">
                      {g.title && <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.title}</div>}
                      <ul className="space-y-1">
                        {g.rows.map((r) => {
                          const isUsed = used.has(r.id);
                          const on = sel.get(d.id)?.has(r.id) ?? false;
                          return (
                            <li key={r.id}>
                              <label className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm ${isUsed ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                                <input type="checkbox" className="h-4 w-4 shrink-0" checked={on} disabled={isUsed} onChange={() => toggle(d.id, r.id)} />
                                <span className="flex-1 truncate">
                                  {r.name}
                                  {isUsed && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-amber-600 dark:text-amber-400"><AlertTriangle size={10} /> bereits beauftragt</span>}
                                </span>
                                <span className="shrink-0 text-xs text-slate-400">{r.qty} {r.unit}</span>
                                <span className="shrink-0 w-24 text-right tabular-nums text-slate-500">{eur(r.net)}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        )
      }
    />
  );
}
