// ============================================================
// Installateur SuperAPP – Verkaufschancen-Board (CRM-Pipeline)
// ------------------------------------------------------------
// Kanban über die BESTEHENDEN Anfragen (keine zweite Lead-Tabelle): eine
// Verkaufschance ist eine Anfrage, die sich über Stufen bewegt.
// Stufen kommen aus `crm_pipeline_stages` (je Firma konfigurierbar).
//
// Drag&Drop mit dnd-kit wie im Rest der App. Stufenwechsel werden per
// Trigger im Kundenverlauf protokolliert (Migration 0163).
// ============================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical, User, CalendarDays, Percent } from "lucide-react";
import { eur } from "../../lib/format";
import { Badge } from "../ui";
import type { PipelineStage, Chance } from "../../lib/crm-pipeline";

const TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  slate: "slate", blue: "blue", green: "green", amber: "amber", red: "red", violet: "blue",
};

function ChanceKarte({ c, canEdit }: { c: Chance; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: c.id,
    disabled: !canEdit,
    data: { stageId: c.pipeline_stage_id },
  });
  const gewichtet = (c.expected_value_net ?? 0) * ((c.probability ?? 0) / 100);
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border bg-[var(--card)] p-2.5 transition ${isDragging ? "opacity-40" : "hover:border-brand-300"} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ borderColor: "var(--border)" }}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-1.5">
        {canEdit && <GripVertical size={14} className="mt-0.5 shrink-0 text-slate-300" />}
        <div className="min-w-0 flex-1">
          <Link
            to={`/anfragen/${c.id}`}
            className="block truncate text-sm font-semibold hover:text-brand-600"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {c.subject || "Anfrage"}
          </Link>
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
            <User size={11} /> {c.contact_name || c.caller_name || "—"}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {c.expected_value_net ? (
              <span className="font-semibold text-[var(--accent)]">{eur(c.expected_value_net)}</span>
            ) : (
              <span className="text-slate-300">kein Wert</span>
            )}
            {c.probability !== null && (
              <span className="flex items-center gap-0.5 text-slate-400"><Percent size={10} />{c.probability}</span>
            )}
            {gewichtet > 0 && <span className="text-slate-400">≈ {eur(gewichtet)}</span>}
          </div>
          {c.expected_close_date && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
              <CalendarDays size={11} />
              {new Intl.DateTimeFormat("de-AT").format(new Date(c.expected_close_date))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Spalte({
  stage, chancen, canEdit,
}: { stage: PipelineStage; chancen: Chance[]; canEdit: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const summe = chancen.reduce((s, c) => s + (c.expected_value_net ?? 0), 0);
  const gewichtet = chancen.reduce((s, c) => s + (c.expected_value_net ?? 0) * ((c.probability ?? 0) / 100), 0);
  return (
    <div
      ref={setNodeRef}
      className={`flex w-[260px] shrink-0 flex-col rounded-2xl border p-2 transition ${isOver ? "border-brand-400 bg-brand-50/40 dark:bg-brand-500/10" : ""}`}
      style={{ borderColor: isOver ? undefined : "var(--border)", background: isOver ? undefined : "var(--hover)" }}
    >
      <div className="mb-2 px-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-bold">
            <Badge tone={TONE[stage.color ?? "slate"] ?? "slate"}>{stage.label}</Badge>
          </span>
          <span className="text-xs text-slate-400">{chancen.length}</span>
        </div>
        {summe > 0 && (
          <div className="mt-1 text-[11px] text-slate-400">
            {eur(summe)}
            {gewichtet > 0 && !stage.is_won && !stage.is_lost && <> · gewichtet {eur(gewichtet)}</>}
          </div>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto pr-0.5" style={{ maxHeight: "62vh" }}>
        {chancen.length === 0 ? (
          <div className="px-1 py-6 text-center text-xs text-slate-300">leer</div>
        ) : (
          chancen.map((c) => <ChanceKarte key={c.id} c={c} canEdit={canEdit} />)
        )}
      </div>
    </div>
  );
}

export default function PipelineBoard({
  stages, chancen, canEdit, onMove,
}: {
  stages: PipelineStage[];
  chancen: Chance[];
  canEdit: boolean;
  onMove: (chanceId: string, stageId: string) => Promise<void>;
}) {
  const [lokal, setLokal] = useState<Chance[] | null>(null);
  const liste = lokal ?? chancen;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const proStufe = useMemo(() => {
    const map = new Map<string, Chance[]>();
    for (const s of stages) map.set(s.id, []);
    for (const c of liste) {
      if (!c.pipeline_stage_id) continue;
      map.get(c.pipeline_stage_id)?.push(c);
    }
    return map;
  }, [stages, liste]);

  async function onDragEnd(e: DragEndEvent) {
    const chanceId = String(e.active.id);
    const zielStufe = e.over ? String(e.over.id) : null;
    if (!zielStufe) return;
    const aktuell = liste.find((c) => c.id === chanceId);
    if (!aktuell || aktuell.pipeline_stage_id === zielStufe) return;
    // Optimistisch verschieben – bei Fehler stellt der Aufrufer neu her.
    setLokal(liste.map((c) => (c.id === chanceId ? { ...c, pipeline_stage_id: zielStufe } : c)));
    await onMove(chanceId, zielStufe);
    setLokal(null);
  }

  const gesamtOffen = liste
    .filter((c) => {
      const s = stages.find((x) => x.id === c.pipeline_stage_id);
      return s && !s.is_won && !s.is_lost;
    })
    .reduce((s, c) => s + (c.expected_value_net ?? 0), 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Offenes Volumen:</span>
        <span className="font-bold text-[var(--accent)]">{eur(gesamtOffen)}</span>
        <span className="text-xs text-slate-400">
          ({liste.length} Chance{liste.length === 1 ? "" : "n"})
        </span>
      </div>
      <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((s) => (
            <Spalte key={s.id} stage={s} chancen={proStufe.get(s.id) ?? []} canEdit={canEdit} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
