// ============================================================
// B4Y SuperAPP – SignaturePad
// Wiederverwendbares Signaturfeld: Finger / Stift / Maus (Pointer Events).
// Weißer Hintergrund + dunkle Linie → PDF-tauglich (PNG-DataURL).
// HiDPI-scharf, große Touch-Flächen, Dark-/Light-tauglich (Feld bleibt weiß).
// ============================================================
import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

export default function SignaturePad({
  value,
  onChange,
  height = 200,
  disabled = false,
}: {
  value?: string | null;
  onChange: (dataUrl: string | null) => void;
  height?: number;
  disabled?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const hasInk = useRef(!!value);
  const [inked, setInked] = useState(!!value);

  // Canvas (neu) einrichten: HiDPI-Skalierung + weißer Hintergrund + ggf. Bestand zeichnen.
  function setupCanvas(preserveValue: string | null) {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth || 320;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, height);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    if (preserveValue) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, w, height);
      img.src = preserveValue;
      hasInk.current = true;
    }
  }

  useEffect(() => {
    setupCanvas(value ?? null);
    const onResize = () => setupCanvas(canvasRef.current?.toDataURL("image/png") ?? null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    try { canvasRef.current!.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk.current) { hasInk.current = true; setInked(true); }
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (hasInk.current) onChange(canvasRef.current!.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, height);
    hasInk.current = false;
    setInked(false);
    onChange(null);
  }

  return (
    <div ref={wrapRef} className="w-full">
      <div className="relative overflow-hidden rounded-xl border-2 border-dashed"
        style={{ borderColor: "var(--border)", background: "#fff" }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          style={{ touchAction: "none", display: "block", cursor: disabled ? "not-allowed" : "crosshair" }}
        />
        {!inked && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">
            Hier unterschreiben (Finger, Stift oder Maus)
          </span>
        )}
      </div>
      {!disabled && (
        <div className="mt-2 flex justify-end">
          <button type="button" className="btn-outline" onClick={clear}>
            <Eraser size={15} /> Löschen
          </button>
        </div>
      )}
    </div>
  );
}
