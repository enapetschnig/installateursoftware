// ============================================================
// B4Y SuperAPP – Plantafel: farbiger Einsatz-Balken
// ------------------------------------------------------------
// Absolut positionierter Balken (Position/Größe kommen vom Board),
// klickbar (onClick = bearbeiten) und via Pointer-Events verschiebbar
// (onPointerDown; iPad-/Touch-tauglich durch touch-action:none). Zeigt
// Titel, Zeit/Untertitel und ein Erledigt-Häkchen. Kontrast-Textfarbe
// wird automatisch aus der Balkenfarbe abgeleitet.
// ============================================================
import { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { Check, CheckCircle2 } from "lucide-react";
import { autoContrastText } from "./plantafelUtils";

export type EinsatzBarProps = {
  /** Titel des Einsatzes. */
  title: string;
  /** Zeit-Label (z. B. „07:00–16:00"); leer/undefined bei ganztägig. */
  timeLabel?: string | null;
  /** Optionaler Untertitel (z. B. Projektname / Einsatzort). */
  subtitle?: string | null;
  /** Balkenfarbe (Hex). Textfarbe wird automatisch daraus bestimmt. */
  color: string;
  /** Erledigt? -> Häkchen + durchgestrichener, gedimmter Titel. */
  done?: boolean;
  /** Balken beginnt/endet außerhalb des sichtbaren Rasters (Kante abflachen). */
  clippedStart?: boolean;
  clippedEnd?: boolean;
  /** Absolute Positionierung (left/width/top/height) vom Board berechnet. */
  style: CSSProperties;
  /** Nativer Hover-Tooltip. */
  tooltip?: string;
  /** Verschiebbar? -> Grab-Cursor + touch-action:none + Pointer-Drag aktiv. */
  draggable?: boolean;
  /** Optisch gedimmt (z. B. während Drag oder optimistischem Speichern). */
  dimmed?: boolean;
  /** pointer-events aussetzen (z. B. während ein anderer Balken gezogen wird). */
  disablePointer?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  /** Erledigt umschalten (Quick-Action; startet keinen Drag). */
  onToggleDone?: () => void;
};

export default function EinsatzBar(props: EinsatzBarProps) {
  const {
    title, timeLabel, subtitle, color, done, clippedStart, clippedEnd,
    style, tooltip, draggable, dimmed, disablePointer, onClick, onPointerDown, onToggleDone,
  } = props;

  const textColor = autoContrastText(color);

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title={tooltip}
      onClick={onClick}
      onKeyDown={handleKey}
      onPointerDown={draggable ? onPointerDown : undefined}
      className={[
        "group absolute flex flex-col justify-center overflow-hidden rounded-xl px-2 py-1 text-left",
        "shadow-sm ring-1 ring-black/10 transition-[opacity,box-shadow] hover:shadow-md hover:ring-black/20",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dimmed ? "opacity-50" : "",
      ].join(" ")}
      style={{
        ...style,
        background: color,
        color: textColor,
        touchAction: draggable ? "none" : undefined,
        pointerEvents: disablePointer ? "none" : undefined,
        borderTopLeftRadius: clippedStart ? 3 : undefined,
        borderBottomLeftRadius: clippedStart ? 3 : undefined,
        borderTopRightRadius: clippedEnd ? 3 : undefined,
        borderBottomRightRadius: clippedEnd ? 3 : undefined,
      }}
    >
      <div className="flex items-center gap-1">
        {done && <CheckCircle2 size={13} className="shrink-0" />}
        <span className={`truncate text-[12px] font-semibold leading-tight ${done ? "line-through opacity-80" : ""}`}>
          {title || "(ohne Titel)"}
        </span>
      </div>
      {(timeLabel || subtitle) && (
        <div className="mt-0.5 flex items-center gap-1 overflow-hidden text-[10.5px] font-medium leading-tight opacity-90">
          {timeLabel && <span className="shrink-0 tabular-nums">{timeLabel}</span>}
          {timeLabel && subtitle && <span className="shrink-0 opacity-60">·</span>}
          {subtitle && <span className="truncate">{subtitle}</span>}
        </div>
      )}

      {onToggleDone && (
        <button
          type="button"
          // Klick/Drag am Häkchen NICHT an den Balken weiterreichen
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleDone(); }}
          title={done ? "Als offen markieren" : "Als erledigt markieren"}
          aria-label={done ? "Als offen markieren" : "Als erledigt markieren"}
          className={`absolute right-1 top-1 rounded-md p-0.5 ring-1 ring-black/10 backdrop-blur-sm transition ${
            done ? "flex" : "hidden group-hover:flex group-focus-within:flex"
          }`}
          style={{ background: "rgba(255,255,255,0.28)", color: textColor }}
        >
          <Check size={12} strokeWidth={done ? 3 : 2.5} />
        </button>
      )}
    </div>
  );
}
