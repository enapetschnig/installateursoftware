// ============================================================================
// B4Y SuperAPP – Modulmap / Systemkarte (Einstellungen → Reiter „Modulmap")
// ----------------------------------------------------------------------------
// READ-ONLY, interaktive Systemkarte als logischer WORKFLOW-BAUM (Swimlanes):
// Prozess-Spalten links → rechts (Stammdaten → Projekt/Dokumente → Finanzen →
// Betrieb → KI → Rechte → Einstellungen); je Hauptmodul ein eingerückter Baum der
// Unter-/Unter-Untermodule; fachliche Fluss-/Rechte-/KI-Kanten als Konnektoren.
// Bewusst dependency-frei: Canvas-2D (Retina-scharf), Pan/Zoom – KEIN Three.js
// (vite-plugin-singlefile-Build bleibt schlank). Keine DB, keine produktiven Daten.
//
// Bedienung: ziehen (verschieben), Mausrad/Buttons (zoom), Hover, Klick → Detailpanel.
// Ohne Maus voll bedienbar über die durchsuchbare Knotenliste + Pfeiltasten/±/0.
// Kein Canvas/2D-Kontext → strukturierte Listenansicht (Fallback).
//
// Inhalts-/Datenpflege ausschließlich in `module-map-data.ts`.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Orbit, Search, RotateCcw, ZoomIn, ZoomOut, X, ExternalLink, ChevronRight } from "lucide-react";
import {
  MODULE_MAP_NODES,
  MODULE_MAP_EDGES,
  MODULE_GROUPS,
  MODULE_MAP_LANES,
  GROUP_BY_KEY,
  STATUS_META,
  MODULE_MAP_FOCUS,
  type ModuleNode,
  type EdgeKind,
  type FocusKey,
} from "./module-map-data";

type Edge = { from: string; to: string; kind: EdgeKind | "child" };
type Rect = { x: number; y: number; w: number; h: number; level: 1 | 2 | 3 };

const NODE_BY_ID: Record<string, ModuleNode> = MODULE_MAP_NODES.reduce(
  (a, n) => {
    a[n.id] = n;
    return a;
  },
  {} as Record<string, ModuleNode>
);

const EDGE_COLOR: Record<Edge["kind"], string> = {
  flow: "#ff8a5e",
  rechte: "#c084fc",
  ki: "#22d3ee",
  link: "#7f93b8",
  child: "#5b6b8f",
};

// Layout-Maße (Weltkoordinaten, vor Zoom).
const X0 = 24,
  Y0 = 46,
  COL_W = 224,
  STRIDE = 252;
const H1 = 34,
  H2 = 27,
  H3 = 24,
  GAP = 9,
  SUBGAP = 6,
  GROUPGAP = 18,
  INDENT = 15;

/** Deterministisches 2D-Swimlane-Layout: je Gruppe eine Spalte, darin Bäume der Module. */
function computeLayout(nodes: ModuleNode[]): { rects: Record<string, Rect>; worldW: number; worldH: number } {
  const rects: Record<string, Rect> = {};
  let worldH = Y0;
  MODULE_MAP_LANES.forEach((lane, li) => {
    const xBase = X0 + li * STRIDE;
    let y = Y0;
    const walk = (n: ModuleNode) => {
      const indent = (n.level - 1) * INDENT;
      const h = n.level === 1 ? H1 : n.level === 2 ? H2 : H3;
      rects[n.id] = { x: xBase + indent, y, w: COL_W - indent, h, level: n.level };
      y += h + (n.level === 1 ? GAP : SUBGAP);
      nodes.filter((c) => c.parent === n.id).forEach(walk);
    };
    nodes
      .filter((n) => n.level === 1 && n.group === lane.key)
      .forEach((m) => {
        walk(m);
        y += GROUPGAP;
      });
    worldH = Math.max(worldH, y);
  });
  const worldW = X0 + MODULE_MAP_LANES.length * STRIDE;
  return { rects, worldW, worldH: worldH + 16 };
}

export default function ModuleMap() {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [focusKey, setFocusKey] = useState<FocusKey | null>(null);
  const [fallback, setFallback] = useState(false);

  const { rects, worldW, worldH } = useMemo(() => computeLayout(MODULE_MAP_NODES), []);
  const edges = useMemo<Edge[]>(() => {
    const childEdges: Edge[] = MODULE_MAP_NODES.filter((n) => n.parent).map((n) => ({
      from: n.parent as string,
      to: n.id,
      kind: "child",
    }));
    return [...childEdges, ...MODULE_MAP_EDGES.map((e) => ({ ...e }))];
  }, []);

  // Hervorhebung (Suche hat Vorrang vor Fokus)
  const highlight = useMemo<Set<string> | null>(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      const ids = MODULE_MAP_NODES.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.purpose.toLowerCase().includes(q) ||
          (n.subfunctions ?? []).some((s) => s.toLowerCase().includes(q))
      ).map((n) => n.id);
      return new Set(ids);
    }
    if (focusKey) {
      const f = MODULE_MAP_FOCUS.find((x) => x.key === focusKey);
      if (f) return new Set(f.nodeIds);
    }
    return null;
  }, [search, focusKey]);

  // veränderliche Render-Zustände in Refs (kein React-Rerender pro Frame)
  const pan = useRef({ x: 0, y: 0 });
  const zoom = useRef(1);
  const hovered = useRef<string | null>(null);
  const drag = useRef<{ active: boolean; lx: number; ly: number; moved: number }>({
    active: false,
    lx: 0,
    ly: 0,
    moved: 0,
  });
  const size = useRef({ w: 800, h: 560, dpr: 1 });
  const highlightRef = useRef<Set<string> | null>(null);
  const selectedRef = useRef<string | null>(null);
  const hoveredRef = hovered;
  const dirty = useRef(true);
  const didFit = useRef(false);

  useEffect(() => {
    highlightRef.current = highlight;
    dirty.current = true;
  }, [highlight]);
  useEffect(() => {
    selectedRef.current = selectedId;
    dirty.current = true;
  }, [selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) {
      setFallback(true);
      return;
    }
    const g = ctx;

    const clampPan = () => {
      const { w, h } = size.current;
      const z = zoom.current;
      const contentW = worldW * z,
        contentH = worldH * z;
      // horizontal: falls Inhalt breiter → begrenzt scrollen; sonst zentrieren.
      if (contentW <= w) pan.current.x = (w - contentW) / 2;
      else pan.current.x = Math.min(24, Math.max(w - contentW - 24, pan.current.x));
      if (contentH <= h) pan.current.y = Math.max(8, (h - contentH) / 2);
      else pan.current.y = Math.min(24, Math.max(h - contentH - 24, pan.current.y));
    };

    const applySize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1); // Retina-scharf
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(320, Math.floor(rect.height));
      size.current = { w, h, dpr };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!didFit.current) {
        // Anfangs an die Breite einpassen (oben ausgerichtet), damit der ganze Fluss sichtbar ist.
        zoom.current = Math.max(0.4, Math.min(1, (w - 40) / worldW));
        didFit.current = true;
      }
      clampPan();
      dirty.current = true;
    };
    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(wrap);

    const toScreen = (wx: number, wy: number) => ({
      sx: wx * zoom.current + pan.current.x,
      sy: wy * zoom.current + pan.current.y,
    });

    const draw = () => {
      const { w, h } = size.current;
      const z = zoom.current;
      g.clearRect(0, 0, w, h);

      const hl = highlightRef.current;
      const sel = selectedRef.current;
      const hov = hoveredRef.current;
      const isActive = (id: string) => !hl || hl.has(id) || id === sel;

      // Lane-Überschriften (Spaltentitel) – nur wenn nicht zu klein.
      if (z > 0.55) {
        g.textBaseline = "alphabetic";
        g.textAlign = "left";
        MODULE_MAP_LANES.forEach((lane, li) => {
          const { sx, sy } = toScreen(X0 + li * STRIDE, 22);
          g.font = "700 12px Inter, system-ui, sans-serif";
          g.fillStyle = GROUP_BY_KEY[lane.key].color;
          g.globalAlpha = 0.95;
          g.fillText(lane.title.toUpperCase(), sx, sy);
        });
        g.globalAlpha = 1;
      }

      // Kanten hinter den Knoten (Fluss/Rechte/KI/Link + Eltern-Kind).
      for (const e of edges) {
        const a = rects[e.from],
          b = rects[e.to];
        if (!a || !b) continue;
        const active = isActive(e.from) && isActive(e.to);
        const p1 = toScreen(a.x + a.w, a.y + a.h / 2);
        const p2 = toScreen(b.x, b.y + b.h / 2);
        // Support-/Rechte-Kanten dezent halten, sofern nicht hervorgehoben/selektiert.
        const emphasized = hl ? active : e.from === sel || e.to === sel || e.from === hov || e.to === hov;
        let alpha = e.kind === "child" ? 0.22 : e.kind === "rechte" ? 0.1 : 0.28;
        let width = e.kind === "child" ? 1 : 1.4;
        if (hl && !active) alpha *= 0.1;
        if (emphasized) {
          alpha = 0.9;
          width = e.kind === "child" ? 1.6 : 2.4;
        }
        g.globalAlpha = Math.max(0, Math.min(1, alpha));
        g.strokeStyle = EDGE_COLOR[e.kind];
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(p1.sx, p1.sy);
        const midx = (p1.sx + p2.sx) / 2;
        g.bezierCurveTo(midx, p1.sy, midx, p2.sy, p2.sx, p2.sy);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Knoten als Karten mit horizontalem Label.
      for (const n of MODULE_MAP_NODES) {
        const r = rects[n.id];
        if (!r) continue;
        const { sx, sy } = toScreen(r.x, r.y);
        const w2 = r.w * z,
          h2 = r.h * z;
        if (sx > w + 8 || sy > h + 8 || sx + w2 < -8 || sy + h2 < -8) continue; // Culling
        const col = GROUP_BY_KEY[n.group].color;
        const active = isActive(n.id);
        const isSel = n.id === sel;
        const isHov = n.id === hov;
        const a = active ? 1 : 0.22;

        g.globalAlpha = a;
        // Karte
        g.fillStyle = "rgba(12,18,38,0.92)";
        roundRect(g, sx, sy, w2, h2, 8 * z);
        g.fill();
        // linker Farbbalken (Gruppe)
        g.fillStyle = col;
        roundRect(g, sx, sy, Math.max(3, 4 * z), h2, 3 * z);
        g.fill();
        // Rahmen (Auswahl/Hover betont)
        g.strokeStyle = isSel ? accentColor() : isHov ? "rgba(255,255,255,0.85)" : col + "66";
        g.lineWidth = isSel || isHov ? 2 : 1;
        roundRect(g, sx, sy, w2, h2, 8 * z);
        g.stroke();
        // Status-Punkt
        const dotR = Math.max(2.2, 3 * z);
        g.fillStyle = STATUS_META[n.status].color;
        g.beginPath();
        g.arc(sx + w2 - 10 * z, sy + h2 / 2, dotR, 0, Math.PI * 2);
        g.fill();

        // Label (horizontal, gekürzt)
        const fs = (n.level === 1 ? 12.5 : n.level === 2 ? 11.5 : 11) * Math.min(1.15, Math.max(0.85, z));
        g.font = `${n.level === 1 ? 700 : 500} ${fs}px Inter, system-ui, sans-serif`;
        g.fillStyle = n.level === 1 ? "#f2f6ff" : "#cdd8ef";
        g.textBaseline = "middle";
        g.textAlign = "left";
        const padL = 12 * z,
          padR = 18 * z;
        g.fillText(fitText(g, n.label, w2 - padL - padR), sx + padL, sy + h2 / 2 + 0.5);
      }
      g.globalAlpha = 1;
    };

    let raf = 0,
      stop = false;
    const tick = () => {
      if (stop) return;
      if (dirty.current) {
        draw();
        dirty.current = false;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    const relPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const pickAt = (cx: number, cy: number): string | null => {
      const z = zoom.current;
      for (const n of MODULE_MAP_NODES) {
        const r = rects[n.id];
        if (!r) continue;
        const { sx, sy } = toScreen(r.x, r.y);
        if (cx >= sx && cx <= sx + r.w * z && cy >= sy && cy <= sy + r.h * z) return n.id;
      }
      return null;
    };
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      drag.current = { active: true, lx: e.clientX, ly: e.clientY, moved: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (drag.current.active) {
        const dx = e.clientX - drag.current.lx,
          dy = e.clientY - drag.current.ly;
        drag.current.lx = e.clientX;
        drag.current.ly = e.clientY;
        drag.current.moved += Math.abs(dx) + Math.abs(dy);
        pan.current.x += dx;
        pan.current.y += dy;
        clampPan();
        dirty.current = true;
      } else {
        const { x, y } = relPos(e);
        const id = pickAt(x, y);
        if (id !== hovered.current) {
          hovered.current = id;
          canvas.style.cursor = id ? "pointer" : "grab";
          dirty.current = true;
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasClick = drag.current.active && drag.current.moved < 6;
      drag.current.active = false;
      canvas.releasePointerCapture?.(e.pointerId);
      if (wasClick) {
        const { x, y } = relPos(e);
        selectNode(pickAt(x, y));
      }
    };
    const zoomAt = (factor: number, cx: number, cy: number) => {
      const z0 = zoom.current;
      const z1 = Math.max(0.35, Math.min(2.4, z0 * factor));
      // um den Cursor zoomen: Weltpunkt unter Cursor bleibt fix.
      pan.current.x = cx - (cx - pan.current.x) * (z1 / z0);
      pan.current.y = cy - (cy - pan.current.y) * (z1 / z0);
      zoom.current = z1;
      clampPan();
      dirty.current = true;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = relPos(e as unknown as PointerEvent);
      zoomAt(Math.exp(-e.deltaY * 0.0012), x, y);
    };
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", () => {
      if (hovered.current) {
        hovered.current = null;
        dirty.current = true;
      }
    });
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      let handled = true;
      const step = 40;
      const { w, h } = size.current;
      if (e.key === "ArrowLeft") pan.current.x += step;
      else if (e.key === "ArrowRight") pan.current.x -= step;
      else if (e.key === "ArrowUp") pan.current.y += step;
      else if (e.key === "ArrowDown") pan.current.y -= step;
      else if (e.key === "+" || e.key === "=") zoomAt(1.15, w / 2, h / 2);
      else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.15, w / 2, h / 2);
      else if (e.key === "0") {
        didFit.current = false;
        applySize();
      } else handled = false;
      if (handled) {
        clampPan();
        dirty.current = true;
        e.preventDefault();
      }
    };
    canvas.addEventListener("keydown", onKey);

    const onZoomIn = () => zoomAt(1.2, size.current.w / 2, size.current.h / 2);
    const onZoomOut = () => zoomAt(1 / 1.2, size.current.w / 2, size.current.h / 2);
    const onFocusNode = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      const r = rects[id];
      if (!r) return;
      const { w, h } = size.current;
      const z = Math.max(zoom.current, 0.85);
      zoom.current = z;
      // Knoten in die Mitte holen.
      pan.current.x = w / 2 - (r.x + r.w / 2) * z;
      pan.current.y = h / 2 - (r.y + r.h / 2) * z;
      clampPan();
      dirty.current = true;
    };
    wrap.addEventListener("mm-zoom-in", onZoomIn);
    wrap.addEventListener("mm-zoom-out", onZoomOut);
    wrap.addEventListener("mm-focus-node", onFocusNode as EventListener);

    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      wrap.removeEventListener("mm-zoom-in", onZoomIn);
      wrap.removeEventListener("mm-zoom-out", onZoomOut);
      wrap.removeEventListener("mm-focus-node", onFocusNode as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rects, edges, worldW, worldH]);

  const selectNode = (id: string | null) => {
    setSelectedId(id);
    if (id) wrapRef.current?.dispatchEvent(new CustomEvent("mm-focus-node", { detail: id }));
  };
  const zoomIn = () => wrapRef.current?.dispatchEvent(new Event("mm-zoom-in"));
  const zoomOut = () => wrapRef.current?.dispatchEvent(new Event("mm-zoom-out"));
  const reset = () => {
    setSelectedId(null);
    setSearch("");
    setFocusKey(null);
    didFit.current = false;
    // erneutes Einpassen über ein Resize-Event erzwingen
    wrapRef.current?.dispatchEvent(new Event("mm-zoom-in"));
    wrapRef.current?.dispatchEvent(new Event("mm-zoom-out"));
  };

  const selected = selectedId ? NODE_BY_ID[selectedId] : null;
  const connections = useMemo(() => {
    if (!selectedId) return [];
    const ids = new Set<string>();
    for (const e of edges) {
      if (e.from === selectedId) ids.add(e.to);
      else if (e.to === selectedId) ids.add(e.from);
    }
    return [...ids].map((id) => NODE_BY_ID[id]).filter(Boolean);
  }, [selectedId, edges]);

  const listMatch = (n: ModuleNode) => !highlight || highlight.has(n.id);

  return (
    <div
      className="mm-root rounded-2xl border p-3 sm:p-4"
      style={{
        borderColor: "rgba(120,140,180,0.22)",
        background: "radial-gradient(130% 100% at 18% -10%, #161d3d 0%, #0a0f24 48%, #05060e 100%)",
        color: "#dbe3f6",
      }}
    >
      <style>{`.mm-root :is(button,input,a,canvas,[tabindex]):focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px;}`}</style>
      {/* Kopfzeile: Titel + Suche + Fokus + Reset */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2">
          <span
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: "rgba(125,145,200,0.15)", color: "#9fc4ff" }}
          >
            <Orbit size={18} />
          </span>
          <div>
            <div className="text-sm font-bold text-white">Systemkarte</div>
            <div className="text-[11px]" style={{ color: "#8fa1c4" }}>
              Module &amp; Workflow der B4Y SuperAPP
            </div>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: "#7e90b6" }}
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Modul suchen…"
            aria-label="Modul suchen"
            className="w-full rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-2 sm:w-[180px]"
            style={{
              background: "rgba(10,15,30,0.7)",
              border: "1px solid rgba(120,140,180,0.25)",
              color: "#e8eefc",
            }}
          />
        </div>
        {MODULE_MAP_FOCUS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setFocusKey(focusKey === f.key ? null : f.key);
              setSearch("");
            }}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
            style={
              focusKey === f.key
                ? {
                    background: "linear-gradient(135deg,var(--accent),var(--accent-h))",
                    color: "var(--color-button-primary-text,#fff)",
                  }
                : {
                    background: "rgba(125,145,200,0.12)",
                    border: "1px solid rgba(120,140,180,0.22)",
                    color: "#cfd9ef",
                  }
            }
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
          style={{
            background: "rgba(125,145,200,0.12)",
            border: "1px solid rgba(120,140,180,0.22)",
            color: "#cfd9ef",
          }}
        >
          <RotateCcw size={14} /> Zurücksetzen
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_330px]">
        {/* Canvas / Visualisierung */}
        {!fallback && (
          <div
            ref={wrapRef}
            className="relative h-[360px] overflow-hidden rounded-xl sm:h-[460px] lg:h-[560px]"
            style={{ border: "1px solid rgba(120,140,180,0.18)", touchAction: "none" }}
          >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              role="img"
              aria-label="Workflow-Modulmap der B4Y SuperAPP. Mit Pfeiltasten verschieben, Plus/Minus zoomen – oder die Modul-Liste nutzen."
              className="block h-full w-full"
            />
            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={zoomIn}
                aria-label="Vergrößern"
                className="grid h-8 w-8 place-items-center rounded-lg"
                style={{
                  background: "rgba(10,15,30,0.75)",
                  border: "1px solid rgba(120,140,180,0.25)",
                  color: "#dbe3f6",
                }}
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                onClick={zoomOut}
                aria-label="Verkleinern"
                className="grid h-8 w-8 place-items-center rounded-lg"
                style={{
                  background: "rgba(10,15,30,0.75)",
                  border: "1px solid rgba(120,140,180,0.25)",
                  color: "#dbe3f6",
                }}
              >
                <ZoomOut size={16} />
              </button>
            </div>
            <div
              className="pointer-events-none absolute bottom-3 left-3 text-[11px]"
              style={{ color: "#7e90b6" }}
            >
              Ziehen zum Verschieben · Mausrad/Buttons zum Zoomen · Modul anklicken
            </div>
          </div>
        )}
        {fallback && (
          <div
            className="rounded-xl p-4 text-sm"
            style={{ border: "1px solid rgba(120,140,180,0.18)", color: "#cfd9ef" }}
          >
            <p className="mb-3 font-semibold text-white">
              Grafische Ansicht nicht verfügbar – strukturierte Übersicht:
            </p>
            <NodeList
              nodes={MODULE_MAP_NODES}
              match={listMatch}
              selectedId={selectedId}
              onSelect={selectNode}
            />
          </div>
        )}

        {/* Seitenpanel: Legende + Detail + Liste */}
        <aside className="flex min-w-0 flex-col gap-3">
          <div
            className="rounded-xl p-3"
            style={{ background: "rgba(10,15,30,0.45)", border: "1px solid rgba(120,140,180,0.18)" }}
          >
            <div
              className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "#8fa1c4" }}
            >
              Gruppen
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {MODULE_GROUPS.map((grp) => (
                <span
                  key={grp.key}
                  className="inline-flex items-center gap-1.5 text-xs"
                  style={{ color: "#cfd9ef" }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: grp.color }} /> {grp.label}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
              {Object.values(STATUS_META).map((s) => (
                <span
                  key={s.label}
                  className="inline-flex items-center gap-1.5 text-xs"
                  style={{ color: "#cfd9ef" }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} /> {s.label}
                </span>
              ))}
            </div>
          </div>

          {selected ? (
            <div
              className="rounded-xl p-3"
              style={{ background: "rgba(10,15,30,0.5)", border: "1px solid rgba(120,140,180,0.25)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: GROUP_BY_KEY[selected.group].color }}
                    />
                    <h3 className="truncate text-sm font-bold text-white">{selected.label}</h3>
                  </div>
                  <div className="mt-0.5 text-[11px]" style={{ color: "#8fa1c4" }}>
                    {GROUP_BY_KEY[selected.group].label}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Auswahl schließen"
                  className="shrink-0 rounded-md p-1"
                  style={{ color: "#9fb0c9" }}
                >
                  <X size={15} />
                </button>
              </div>
              <span
                className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: STATUS_META[selected.status].color + "22",
                  color: STATUS_META[selected.status].color,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: STATUS_META[selected.status].color }}
                />{" "}
                {STATUS_META[selected.status].label}
              </span>
              <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "#d3ddf2" }}>
                {selected.purpose}
              </p>

              {selected.subfunctions?.length ? (
                <div className="mt-2.5">
                  <div
                    className="text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "#8fa1c4" }}
                  >
                    Unterfunktionen
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selected.subfunctions.map((s) => (
                      <span
                        key={s}
                        className="rounded-md px-1.5 py-0.5 text-[11px]"
                        style={{ background: "rgba(125,145,200,0.14)", color: "#cfd9ef" }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {connections.length ? (
                <div className="mt-2.5">
                  <div
                    className="text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "#8fa1c4" }}
                  >
                    Verbindungen
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {connections.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectNode(c.id)}
                        className="rounded-md px-1.5 py-0.5 text-[11px] transition hover:brightness-125"
                        style={{
                          background: GROUP_BY_KEY[c.group].color + "22",
                          color: "#e3eaf8",
                          border: `1px solid ${GROUP_BY_KEY[c.group].color}55`,
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {selected.rights ? (
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[11px]"
                    style={{ background: "rgba(192,132,252,0.16)", color: "#d8b4fe" }}
                  >
                    Recht: {selected.rights}
                  </span>
                ) : (
                  <span className="text-[11px]" style={{ color: "#7e90b6" }}>
                    Kein eigenes Rechte-Modul
                  </span>
                )}
                {selected.route ? (
                  <button
                    type="button"
                    onClick={() => navigate(selected.route as string)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                    style={{
                      background: "linear-gradient(135deg,var(--accent),var(--accent-h))",
                      color: "var(--color-button-primary-text,#fff)",
                    }}
                  >
                    Modul öffnen <ExternalLink size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              className="rounded-xl p-3 text-[13px]"
              style={{
                background: "rgba(10,15,30,0.4)",
                border: "1px solid rgba(120,140,180,0.18)",
                color: "#9fb0c9",
              }}
            >
              Ein Modul anklicken oder unten aus der Liste wählen, um Zweck, Unterfunktionen und Verbindungen
              zu sehen.
            </div>
          )}

          {!fallback && (
            <div
              className="rounded-xl p-2"
              style={{ background: "rgba(10,15,30,0.4)", border: "1px solid rgba(120,140,180,0.18)" }}
            >
              <div
                className="px-1 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "#8fa1c4" }}
              >
                Module ({MODULE_MAP_NODES.length})
              </div>
              <div className="max-h-[260px] overflow-y-auto pr-1 lg:max-h-[300px]">
                <NodeList
                  nodes={MODULE_MAP_NODES}
                  match={listMatch}
                  selectedId={selectedId}
                  onSelect={selectNode}
                />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ----- Liste (auch Fallback) ----- */
function NodeList({
  nodes,
  match,
  selectedId,
  onSelect,
}: {
  nodes: ModuleNode[];
  match: (n: ModuleNode) => boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.filter(match).map((n) => {
        const active = n.id === selectedId;
        const indent = (n.level - 1) * 12;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect(n.id)}
            aria-current={active ? "true" : undefined}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition"
            style={{
              paddingLeft: 8 + indent,
              background: active ? "rgba(125,145,200,0.2)" : "transparent",
              color: n.level === 1 ? "#e8eefc" : "#c2cee4",
              fontWeight: n.level === 1 ? 600 : 400,
            }}
          >
            <span
              className="shrink-0 rounded-full"
              style={{
                width: n.level === 1 ? 9 : 6,
                height: n.level === 1 ? 9 : 6,
                background: GROUP_BY_KEY[n.group].color,
              }}
            />
            <span className="min-w-0 flex-1 truncate">{n.label}</span>
            <span
              className="shrink-0 rounded px-1 text-[10px]"
              style={{ color: STATUS_META[n.status].color }}
            >
              {n.status === "produktiv" ? "" : n.status}
            </span>
            {active && <ChevronRight size={14} className="shrink-0" style={{ color: "#9fb0c9" }} />}
          </button>
        );
      })}
    </div>
  );
}

/* ----- Helfer ----- */
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
/** Kürzt Text mit „…", damit er in die Kartenbreite passt. */
function fitText(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 8) return "";
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}
let _accent = "";
function accentColor() {
  if (_accent) return _accent;
  try {
    _accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e11d2a";
  } catch {
    _accent = "#e11d2a";
  }
  return _accent;
}
