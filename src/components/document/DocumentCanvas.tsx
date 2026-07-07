// ============================================================
// B4Y SuperAPP – Dokument-Canvas
// Stellt die Positionen als Dokument dar. Sortieren per Drag&Drop,
// Drop-Zonen-Indikator, Inline-Bearbeitung, Titel/Text/Artikel/Leistung.
// ============================================================
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, Trash2, Wrench, FileText, Heading, ChevronUp, ChevronDown, BookmarkPlus,
  Plus, RotateCcw,
} from "lucide-react";
import { eur } from "../../lib/format";
import { sortAlphaStrings } from "../../lib/sortOptions";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NumCell } from "../calc-ui";
import PositionEditModal from "./PositionEditModal";
import { DocPosition, lineNet, lineCost, isCommercial } from "../../lib/document-types";

const UNITS = ["Stk", "h", "m", "m²", "m³", "lfm", "kg", "t", "l", "pauschal", "Satz", "Tag", "Psch"];
const VAT_RATES = [0, 10, 13, 20];

// Gemeinsames Spaltenraster für Tabellenkopf + kaufmännische Zeilen (ab sm = iPad/Desktop).
// Handle | Pos | Bezeichnung | Menge | Einheit | Einzelpreis | Gesamt | MwSt | Aktionen
const GRID_COLS =
  "sm:grid sm:gap-2 sm:grid-cols-[1.4rem_2.6rem_minmax(0,1fr)_4.6rem_5rem_6.6rem_6.6rem_3.8rem_2rem]";
const mLabel = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden";

type RowApi = {
  patch: (id: string, p: Partial<DocPosition>) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
};

/** Auswahloption für die Regiematerial-Verknüpfung (vorhandene Regiestunden). */
export type RegieHourOpt = { id: string; number: string | null; name: string };

/**
 * Mehrzeiliges Textfeld, das automatisch mit dem Inhalt mitwächst – kein interner Scrollbalken.
 * Die Höhe wird auf scrollHeight gesetzt (vorher auf "auto" zurück, damit auch Schrumpfen klappt),
 * sowohl beim Mounten/Laden als auch bei jeder Wert-Änderung – auch im readOnly/disabled-Zustand.
 * Zentrale, wiederverwendbare Hilfe für alle mehrzeiligen Felder im Canvas (Langtext, Textinhalt).
 */
function AutoGrowTextarea({
  className,
  value,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`resize-none overflow-hidden ${className ?? ""}`}
      value={value}
      {...rest}
    />
  );
}

export default function DocumentCanvas({
  positions, dropIndex, activeId, api, readOnly, correctable, canSaveMaster, onSaveMaster, onAddRegieMaterial, lastInserted,
}: {
  positions: DocPosition[];
  dropIndex: number | null;
  activeId: string | null;
  api: RowApi;
  readOnly?: boolean;
  // Abgeschlossenes, aber korrigierbares Dokument (Angebot/Auftrag): Griffe + Pfeile bleiben
  // nutzbar; die erste Umreihung löst (nach Hinweis) einen Korrekturstand aus. Inline-Felder
  // bleiben gesperrt, bis die Korrektur tatsächlich begonnen hat (dann readOnly=false).
  correctable?: boolean;
  // Variable Position als echte Stammleistung speichern (nur mit Recht).
  canSaveMaster?: boolean;
  onSaveMaster?: (p: DocPosition) => void;
  // Regiematerial (prozentual) direkt zu einer Regiestunde ergänzen.
  onAddRegieMaterial?: (regieId: string) => void;
  // Zuletzt neu eingefügte Position → Auto-Scroll + kurzes Aufleuchten (zentral aus useDocumentBuilder).
  lastInserted?: { id: string; n: number; mode?: "append" | "insert" } | null;
}) {
  const { setNodeRef: endRef, isOver: endOver } = useDroppable({ id: "doc-end" });

  // Nach jedem Einfügen zur neuen Position scrollen und kurz hervorheben.
  //  - "append" (Plus/ans Ende): Position erscheint UNTEN im Sichtbereich (block:"end"),
  //    damit klar ist, dass sie am Dokumentende hängt.
  //  - "insert" (Drag&Drop/gezielte Stelle): mittig (block:"center").
  // Greift für alle Einfüge-Pfade (Titel/Artikel/Leistung/Textbaustein/variable/Regie/Regiematerial),
  // ohne Drag&Drop-Sortierung, Undo/Redo oder Autosave zu beeinflussen.
  useEffect(() => {
    if (!lastInserted) return;
    const el = document.getElementById(`pos-${lastInserted.id}`);
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: lastInserted.mode === "insert" ? "center" : "end" });
      // Kurzes Aufleuchten (CSS-Animation .pos-flash in index.css)
      el.classList.remove("pos-flash");
      // Reflow erzwingen, damit die Animation auch bei schnellem Mehrfach-Einfügen neu startet.
      void el.offsetWidth;
      el.classList.add("pos-flash");
      window.setTimeout(() => el.classList.remove("pos-flash"), 1600);
    });
    // Bewusst nur id/n als Trigger – das lastInserted-Objekt ist je Render ein neues Literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastInserted?.id, lastInserted?.n]);

  // Vorhandene Regiestunden – als Bezugsquelle für Regiematerial-Zeilen.
  const regieHourOpts: RegieHourOpt[] = positions
    .filter((p) => p.is_regie_hour)
    .map((p) => ({ id: p.id, number: p.number, name: p.name }));

  if (positions.length === 0) {
    return (
      <div
        ref={endRef}
        className={`grid min-h-[280px] place-items-center rounded-2xl border-2 border-dashed p-8 text-center transition ${
          endOver ? "border-[var(--accent)] bg-[var(--accent)]/5" : ""
        }`}
        style={{ borderColor: endOver ? undefined : "var(--border)" }}
      >
        <div className="text-sm text-slate-400">
          Ziehe Artikel, Leistungen, Texte oder Titel aus der rechten Seitenleiste hierher –
          <br />oder klicke auf das Plus eines Eintrags.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Sticky Tabellenkopf (nur iPad/Desktop) – Kartenansicht am Handy braucht ihn nicht */}
      <div className={`sticky top-0 z-10 hidden items-center rounded-lg bg-[var(--hover)] px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 ${GRID_COLS}`}>
        <span></span>
        <span>Pos</span>
        <span>Bezeichnung</span>
        <span className="text-right">Menge</span>
        <span>Einheit</span>
        <span className="text-right">Einzelpreis</span>
        <span className="text-right">Gesamt</span>
        <span className="text-right">MwSt</span>
        <span></span>
      </div>
      {positions.map((p, i) => (
        <div key={p.id} id={`pos-${p.id}`} style={{ scrollMarginTop: 96 }}>
          <DropLine show={dropIndex === i} />
          <SortableRow p={p} index={i} count={positions.length} activeId={activeId} api={api} readOnly={readOnly} correctable={correctable} canSaveMaster={canSaveMaster} onSaveMaster={onSaveMaster} regieHourOpts={regieHourOpts} onAddRegieMaterial={onAddRegieMaterial} />
        </div>
      ))}
      <DropLine show={dropIndex === positions.length} />
      <div ref={endRef} className={`h-6 rounded-lg transition ${endOver ? "bg-[var(--accent)]/10" : ""}`} />
    </div>
  );
}

function DropLine({ show }: { show: boolean }) {
  if (!show) return null;
  return <div className="my-1 h-0.5 rounded-full bg-[var(--accent)]" />;
}

function SortableRow({
  p, index, count, activeId, api, readOnly, correctable, canSaveMaster, onSaveMaster, regieHourOpts, onAddRegieMaterial,
}: {
  p: DocPosition; index: number; count: number; activeId: string | null; api: RowApi; readOnly?: boolean; correctable?: boolean;
  canSaveMaster?: boolean; onSaveMaster?: (p: DocPosition) => void;
  regieHourOpts?: RegieHourOpt[]; onAddRegieMaterial?: (regieId: string) => void;
}) {
  // Griffe/Pfeile sind nutzbar, wenn das Dokument bearbeitbar (!readOnly) ODER abgeschlossen
  // aber korrigierbar ist. Die eigentliche Mutation wird im Workspace ggf. über die
  // Korrektur-Rückfrage abgesichert (api.move). Inline-Felder bleiben an readOnly gebunden.
  const dragEnabled = !readOnly || !!correctable;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
    data: { from: "canvas" },
    disabled: !dragEnabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging || activeId === p.id ? 0.4 : 1 };
  const [editOpen, setEditOpen] = useState(false);

  const handle = dragEnabled && (
    <button
      className="flex cursor-grab touch-none items-start pt-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
      title="Ziehen zum Verschieben" {...attributes} {...listeners}
    >
      <GripVertical size={16} />
    </button>
  );

  if (p.type === "title") {
    return (
      <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-xl bg-[var(--hover)] px-2.5 py-1.5">
        {handle}
        <Heading size={15} className="text-violet-500" />
        <span className="font-mono text-xs text-slate-400">{p.number}</span>
        <input
          className="flex-1 bg-transparent text-sm font-bold outline-none"
          value={p.name} placeholder="Titel / Überschrift" disabled={readOnly}
          onChange={(e) => api.patch(p.id, { name: e.target.value })}
        />
        <RowButtons p={p} index={index} count={count} api={api} readOnly={readOnly} correctable={correctable} />
      </div>
    );
  }

  if (p.type === "text") {
    return (
      <div ref={setNodeRef} style={{ ...style, borderColor: "var(--border)" }} className="flex gap-2 rounded-xl border border-dashed p-2">
        {handle}
        <FileText size={15} className="mt-1 shrink-0 text-slate-400" />
        <div className="flex-1">
          <input
            className="mb-1 w-full bg-transparent text-xs font-semibold text-slate-500 outline-none"
            value={p.name} placeholder="Texttitel (intern)" disabled={readOnly}
            onChange={(e) => api.patch(p.id, { name: e.target.value })}
          />
          <AutoGrowTextarea
            className="input min-h-[44px] py-1.5 text-sm" value={p.content ?? ""} placeholder="Textinhalt …" disabled={readOnly}
            onChange={(e) => api.patch(p.id, { content: e.target.value })}
          />
        </div>
        <RowButtons p={p} index={index} count={count} api={api} readOnly={readOnly} correctable={correctable} />
      </div>
    );
  }

  // Artikel / Leistung / frei
  const net = lineNet(p);
  const cost = lineCost(p);
  // Regie-Sonderfälle
  const isRegieMat = !!p.is_regie_material;
  const isPercentAuto = isRegieMat && p.regie_material_mode === "percent" && !p.manually_overridden;
  // Mit Stamm verknüpft? Dann zählt eine manuelle EP-Änderung als „price_overridden"
  // (schützt vor stiller Überschreibung durch „Stammpreise").
  const isLinked = !!(p.article_id || p.service_id);

  return (
    <div ref={setNodeRef} style={{ ...style, borderColor: "var(--border)" }}
      className="rounded-xl border bg-[var(--card)]">
      <div className={`p-1.5 sm:items-start ${GRID_COLS}`}>
      {/* Handle (Desktop/iPad) */}
      <div className="hidden sm:flex sm:pt-2">{handle}</div>

      {/* Pos + Typ – am Handy die Kopfzeile inkl. Handle */}
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs sm:mb-0 sm:flex-col sm:items-start sm:gap-0.5 sm:pt-2">
        <span className="sm:hidden">{handle}</span>
        <span className="font-mono text-slate-400">{p.number}</span>
        <span className="rounded bg-[var(--hover)] px-1 text-[10px] uppercase text-slate-400 sm:hidden">
          {p.type === "article" ? "Artikel" : p.type === "service" ? "Leistung" : "Frei"}
        </span>
        {p.is_variable && <span className="rounded bg-emerald-500/15 px-1 text-[10px] font-medium text-emerald-600">variabel</span>}
        {p.is_regie_hour && <span className="rounded bg-blue-500/15 px-1 text-[10px] font-medium text-blue-600">Regie</span>}
        {isRegieMat && <span className="rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-600">Material</span>}
      </div>

      {/* Bezeichnung + Langtext */}
      <div className="min-w-0">
        <input className="input py-1.5 text-sm" value={p.name} placeholder="Bezeichnung" disabled={readOnly}
          onChange={(e) => api.patch(p.id, { name: e.target.value })} />
        {(p.type === "service" || p.long_text !== null) && (
          <AutoGrowTextarea className="input mt-1 py-1.5 text-xs text-slate-500"
            value={p.long_text ?? ""} placeholder="Langtext (optional)" disabled={readOnly}
            onChange={(e) => api.patch(p.id, { long_text: e.target.value })} />
        )}
      </div>

      {/* Menge – nur die Zahl (Einheit steht in der eigenen Spalte „Einheit", kein doppeltes Suffix) */}
      <div className="sm:pt-0.5"><span className={mLabel}>Menge</span>
        <NumCell value={p.qty} onChange={(v) => api.patch(p.id, isPercentAuto ? { qty: v, manually_overridden: true } : { qty: v })} /></div>

      {/* Einheit */}
      <div className="sm:pt-0.5"><span className={mLabel}>Einheit</span>
        <select className="input px-2 py-1.5 text-sm" value={p.unit} disabled={readOnly}
          onChange={(e) => api.patch(p.id, { unit: e.target.value })}>
          {[p.unit, ...sortAlphaStrings(UNITS.filter((u) => u !== p.unit))].map((u) => <option key={u} value={u}>{u}</option>)}
        </select></div>

      {/* Einzelpreis */}
      <div className="sm:pt-0.5"><span className={mLabel}>Einzelpreis</span>
        <NumCell value={p.unit_price} onChange={(v) => api.patch(p.id, isPercentAuto ? { unit_price: v, manually_overridden: true } : (isLinked ? { unit_price: v, price_overridden: true } : { unit_price: v }))} /></div>

      {/* Gesamt (errechnet, schreibgeschützt) */}
      <div className="mt-1 sm:mt-0 sm:pt-2 sm:text-right">
        <span className={mLabel}>Gesamt</span>
        <b className="tabular-nums text-sm" style={{ color: "var(--accent)" }}>{eur(net)}</b>
        {cost > 0 && <div className="text-[10px] text-slate-400">Kosten {eur(cost)}</div>}
      </div>

      {/* MwSt */}
      <div className="mt-1 sm:mt-0 sm:pt-2 sm:text-right"><span className={mLabel}>MwSt</span>
        <select className="rounded bg-transparent text-xs outline-none" value={p.vat_rate} disabled={readOnly}
          onChange={(e) => api.patch(p.id, { vat_rate: Number(e.target.value) })}>
          {[p.vat_rate, ...VAT_RATES.filter((r) => r !== p.vat_rate)].map((r) => <option key={r} value={r}>{r}%</option>)}
        </select></div>

      {/* Aktionen */}
      <div className="mt-1 flex justify-end sm:mt-0 sm:block sm:pt-1">
        <RowButtons p={p} index={index} count={count} api={api} readOnly={readOnly} correctable={correctable} canSaveMaster={canSaveMaster} onSaveMaster={onSaveMaster} onEdit={() => setEditOpen(true)} />
      </div>
      </div>

      {/* Regie: Steuer-/Hinweisstreifen unter der Zeile */}
      {p.is_regie_hour && !readOnly && onAddRegieMaterial && (
        <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
          <button className="btn-ghost px-2 py-0.5 text-xs text-amber-600" title="Regiematerial (prozentual) zu dieser Regiestunde ergänzen"
            onClick={() => onAddRegieMaterial(p.id)}>
            <Plus size={13} /> Material hinzufügen
          </button>
        </div>
      )}
      {isRegieMat && (
        <RegieMaterialStrip p={p} api={api} regieHourOpts={regieHourOpts ?? []} readOnly={readOnly} />
      )}
      {editOpen && (
        <PositionEditModal position={p} readOnly={readOnly}
          onClose={() => setEditOpen(false)}
          onSave={(patch) => { api.patch(p.id, patch); setEditOpen(false); }} />
      )}
    </div>
  );
}

/** Steuerleiste für Regiematerial-Zeilen (Modus / Prozent / Bezug / Override). */
function RegieMaterialStrip({
  p, api, regieHourOpts, readOnly,
}: {
  p: DocPosition; api: RowApi; regieHourOpts: RegieHourOpt[]; readOnly?: boolean;
}) {
  const mode = p.regie_material_mode ?? "manual";
  const label = mode === "percent" ? "Prozentual" : mode === "fixed" ? "Pauschal" : "Manuell";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-2 py-1.5 text-xs" style={{ borderColor: "var(--border)" }}>
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-600">Regiematerial · {label}</span>

      {mode === "percent" && (
        <>
          <label className="flex items-center gap-1 text-slate-500">
            <input
              type="number" min={0} step="1" disabled={readOnly}
              className="input w-16 px-1.5 py-0.5 text-xs"
              value={p.regie_material_percent ?? 0}
              onChange={(e) => api.patch(p.id, { regie_material_percent: Number(e.target.value) || 0 })}
            />
            <span>% von</span>
          </label>
          <select
            className="input max-w-[14rem] px-1.5 py-0.5 text-xs" disabled={readOnly}
            value={p.linked_regie_id ?? ""}
            onChange={(e) => api.patch(p.id, { linked_regie_id: e.target.value || null })}
          >
            <option value="">— Regiestunde wählen —</option>
            {regieHourOpts.map((r) => (
              <option key={r.id} value={r.id}>{r.number ? `${r.number} · ` : ""}{r.name}</option>
            ))}
          </select>
          {p.manually_overridden ? (
            <button className="btn-ghost px-1.5 py-0.5 text-xs text-emerald-600" disabled={readOnly}
              title="Automatische Berechnung wieder aktivieren"
              onClick={() => api.patch(p.id, { manually_overridden: false })}>
              <RotateCcw size={12} /> Automatik aktivieren
            </button>
          ) : (
            <span className="text-[11px] text-slate-400">automatisch berechnet</span>
          )}
        </>
      )}
    </div>
  );
}

function RowButtons({
  p, index, count, api, readOnly, correctable, canSaveMaster, onSaveMaster, onEdit,
}: {
  p: DocPosition; index: number; count: number; api: RowApi; readOnly?: boolean; correctable?: boolean;
  canSaveMaster?: boolean; onSaveMaster?: (p: DocPosition) => void; onEdit?: () => void;
}) {
  if (readOnly && !correctable) return null;
  // Finalisiert aber korrigierbar: nur die Hoch/Runter-Pfeile zeigen (lösen die Korrektur-
  // Rückfrage aus). Bearbeiten/Stamm/Löschen erst, wenn die Korrektur begonnen hat (!readOnly).
  const locked = !!readOnly;
  const showSaveMaster = !locked && !!(p.is_variable && p.type === "service" && canSaveMaster && onSaveMaster);
  return (
    <div className="flex flex-col items-center gap-0.5">
      {!locked && onEdit && (<button className="btn-ghost px-1 py-0.5 text-[var(--accent)]" title="Position bearbeiten (Kalkulation)" onClick={onEdit}><Wrench size={14} /></button>)}
      <button className="btn-ghost px-1 py-0.5" disabled={index === 0} title="Nach oben"
        onClick={() => api.move(p.id, -1)}><ChevronUp size={14} /></button>
      <button className="btn-ghost px-1 py-0.5" disabled={index === count - 1} title="Nach unten"
        onClick={() => api.move(p.id, 1)}><ChevronDown size={14} /></button>
      {showSaveMaster && (
        <button className="btn-ghost px-1 py-0.5 text-emerald-600" title="Als Stammleistung speichern"
          onClick={() => onSaveMaster!(p)}><BookmarkPlus size={14} /></button>
      )}
      {!locked && (
        <button className="btn-ghost px-1 py-0.5 text-rose-500" title="Löschen"
          onClick={() => api.remove(p.id)}><Trash2 size={14} /></button>
      )}
    </div>
  );
}

export { isCommercial };
