// ============================================================
// Installateur SuperAPP – CRM-Board (alle offenen Vorgänge)
// ------------------------------------------------------------
// Zeigt Anfragen, Projekte und projektlose Angebote in EINEM Board.
//
// Spaltenlogik (Kern der Sache): Jede Projektart hat eigene Stufen. Deshalb
//   * ohne Projektart-Filter → Spalten sind die übergeordneten PHASEN
//   * mit Projektart-Filter  → Spalten sind die ECHTEN Stufen dieser Art
// Verschieben ändert bei Projekten die Projektstufe, bei Anfragen die
// Pipeline-Stufe; Angebote sind nicht ziehbar (ihre Spalte ergibt sich aus
// dem Beleg-Status) und werden deshalb ohne Griff dargestellt.
// ============================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical, Inbox, FolderKanban, FileText, User, CalendarDays, AlertCircle } from "lucide-react";
import { eur } from "../../lib/format";
import { Badge } from "../ui";
import { PHASEN, type Vorgang, type Projektart } from "../../lib/crm-board";

const QUELLE_ICON = { anfrage: Inbox, projekt: FolderKanban, angebot: FileText } as const;
const QUELLE_LABEL = { anfrage: "Anfrage", projekt: "Projekt", angebot: "Angebot" } as const;
const TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  slate: "slate", blue: "blue", green: "green", amber: "amber", red: "red", violet: "blue",
};

interface Spalte { key: string; label: string; color: string; phase: string; stufe?: string }

function Karte({ v, ziehbar }: { v: Vorgang; ziehbar: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${v.quelle}:${v.vorgang_id}`,
    disabled: !ziehbar,
  });
  const Icon = QUELLE_ICON[v.quelle];
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border bg-[var(--card)] p-2.5 transition ${isDragging ? "opacity-40" : "hover:border-brand-300"} ${ziehbar ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ borderColor: "var(--border)" }}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-1.5">
        {ziehbar && <GripVertical size={14} className="mt-0.5 shrink-0 text-slate-300" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon size={12} className="shrink-0 text-slate-400" />
            <span className="text-[10px] uppercase tracking-wide text-slate-400">{QUELLE_LABEL[v.quelle]}</span>
            {v.unzugeordnet && <Badge tone="amber">nicht zugeordnet</Badge>}
          </div>
          <Link
            to={v.route}
            className="mt-0.5 block truncate text-sm font-semibold hover:text-brand-600"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {v.titel}
          </Link>
          {v.kunde && (
            <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
              <User size={11} /> {v.kunde}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {v.wert_netto ? <span className="font-semibold text-[var(--accent)]">{eur(v.wert_netto)}</span> : null}
            {v.projektart && <span className="rounded bg-[var(--hover)] px-1.5 text-slate-500">{v.projektart}</span>}
            {v.termin && (
              <span className="flex items-center gap-0.5 text-slate-400">
                <CalendarDays size={10} />{new Intl.DateTimeFormat("de-AT").format(new Date(v.termin))}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SpalteView({ spalte, vorgaenge, ziehbar }: { spalte: Spalte; vorgaenge: Vorgang[]; ziehbar: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: spalte.key });
  const summe = vorgaenge.reduce((s, v) => s + (v.wert_netto ?? 0), 0);
  return (
    <div
      ref={setNodeRef}
      className={`flex w-[270px] shrink-0 flex-col rounded-2xl border p-2 transition ${isOver ? "border-brand-400 bg-brand-50/40 dark:bg-brand-500/10" : ""}`}
      style={{ borderColor: isOver ? undefined : "var(--border)", background: isOver ? undefined : "var(--hover)" }}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <Badge tone={TONE[spalte.color] ?? "slate"}>{spalte.label}</Badge>
        <span className="text-xs text-slate-400">{vorgaenge.length}</span>
      </div>
      {summe > 0 && <div className="mb-2 px-1 text-[11px] text-slate-400">{eur(summe)}</div>}
      <div className="flex-1 space-y-2 overflow-y-auto pr-0.5" style={{ maxHeight: "60vh" }}>
        {vorgaenge.length === 0 ? (
          <div className="px-1 py-6 text-center text-xs text-slate-300">leer</div>
        ) : (
          vorgaenge.map((v) => (
            <Karte key={`${v.quelle}-${v.vorgang_id}`} v={v} ziehbar={ziehbar && v.quelle !== "angebot"} />
          ))
        )}
      </div>
    </div>
  );
}

export default function VorgangsBoard({
  vorgaenge, projektarten, artFilter, canEdit, onArtFilter, onMove,
}: {
  vorgaenge: Vorgang[];
  projektarten: Projektart[];
  artFilter: string;
  canEdit: boolean;
  onArtFilter: (label: string) => void;
  onMove: (v: Vorgang, ziel: { stufe?: string; phase: string }) => Promise<void>;
}) {
  const [lokal, setLokal] = useState<Vorgang[] | null>(null);
  const liste = lokal ?? vorgaenge;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const art = projektarten.find((a) => a.label === artFilter);

  // Spalten: echte Stufen der gewählten Art, sonst die gemeinsamen Phasen.
  const spalten: Spalte[] = useMemo(() => {
    if (art && art.stufen.length > 0) {
      return art.stufen.map((s) => ({ key: `stufe:${s.label}`, label: s.label, color: farbeFuerPhase(s.phase), phase: s.phase, stufe: s.label }));
    }
    return PHASEN.map((p) => ({ key: `phase:${p.key}`, label: p.label, color: p.color, phase: p.key }));
  }, [art]);

  const gefiltert = useMemo(
    () => (art ? liste.filter((v) => v.projektart === art.label || (!v.projektart && v.phase !== "umsetzung")) : liste),
    [liste, art],
  );

  const jeSpalte = useMemo(() => {
    const map = new Map<string, Vorgang[]>();
    for (const s of spalten) map.set(s.key, []);
    for (const v of gefiltert) {
      // Mit Projektart-Filter: nach echter Stufe einsortieren, sonst nach Phase.
      const key = art ? `stufe:${v.stufe}` : `phase:${v.phase}`;
      const ziel = map.has(key) ? key : art ? spalten.find((s) => s.phase === v.phase)?.key : undefined;
      if (ziel) map.get(ziel)!.push(v);
    }
    for (const list of map.values()) list.sort((a, b) => (b.wert_netto ?? 0) - (a.wert_netto ?? 0));
    return map;
  }, [gefiltert, spalten, art]);

  async function onDragEnd(e: DragEndEvent) {
    const zielKey = e.over ? String(e.over.id) : null;
    if (!zielKey) return;
    const [quelle, id] = String(e.active.id).split(":");
    const v = liste.find((x) => x.quelle === quelle && x.vorgang_id === id);
    const spalte = spalten.find((s) => s.key === zielKey);
    if (!v || !spalte) return;
    if (art ? v.stufe === spalte.stufe : v.phase === spalte.phase) return;
    setLokal(liste.map((x) => (x === v ? { ...x, phase: spalte.phase, stufe: spalte.stufe ?? x.stufe } : x)));
    await onMove(v, { stufe: spalte.stufe, phase: spalte.phase });
    setLokal(null);
  }

  const offenesVolumen = gefiltert
    .filter((v) => !["abschluss", "verloren"].includes(v.phase))
    .reduce((s, v) => s + (v.wert_netto ?? 0), 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto py-1.5 text-sm"
          value={artFilter}
          onChange={(e) => onArtFilter(e.target.value)}
        >
          <option value="">Alle Projektarten (Phasen-Ansicht)</option>
          {projektarten.map((a) => (
            <option key={a.id} value={a.label}>{a.label}</option>
          ))}
        </select>
        <span className="text-sm text-slate-400">Offenes Volumen:</span>
        <span className="text-sm font-bold text-[var(--accent)]">{eur(offenesVolumen)}</span>
        <span className="text-xs text-slate-400">({gefiltert.length} Vorgänge)</span>
        {!art && (
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <AlertCircle size={12} /> Projektstufen ändern: bitte Projektart wählen
          </span>
        )}
      </div>
      <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {spalten.map((s) => (
            <SpalteView key={s.key} spalte={s} vorgaenge={jeSpalte.get(s.key) ?? []} ziehbar={canEdit} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function farbeFuerPhase(phase: string): string {
  return PHASEN.find((p) => p.key === phase)?.color ?? "slate";
}
