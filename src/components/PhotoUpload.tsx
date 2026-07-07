import { useEffect, useRef, useState } from "react";
import { Camera, Trash2, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { initials } from "../lib/format";
import { useSignedUrl } from "../lib/storage";
import { Modal } from "./ui";

const BUCKET = "project-files";
const MAX_MB = 5;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const VIEW = 256; // Vorschau-Quadrat (px)
const OUT = 512;  // Ausgabegröße (px), quadratisch → rund dargestellt

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Profilfoto mit Upload (Klick + Drag&Drop), Zuschneiden/Zoomen/Positionieren,
 * runder Vorschau, Tauschen, Löschen und Initialen-Fallback.
 * Speichert ein zentriertes 512×512-JPEG in employees.photo_url.
 */
export default function PhotoUpload({ employeeId, url, name, canEdit, onChange }: {
  employeeId: string; url: string | null; name: string; canEdit: boolean;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayUrl = useSignedUrl("project-files", url); // privat → signierte URL
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null); // ObjectURL der gewählten Datei

  function pickFile(file: File) {
    setErr(null);
    if (!ALLOWED.includes(file.type)) { setErr("Nur JPG, PNG oder WebP erlaubt."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`Datei zu groß (max. ${MAX_MB} MB).`); return; }
    setCropSrc(URL.createObjectURL(file)); // → Zuschneide-Dialog
  }

  async function uploadBlob(blob: Blob) {
    setBusy(true); setErr(null);
    try {
      const path = `employees/${employeeId}/${uid()}.jpg`;
      const up = await supabase.storage.from(BUCKET).upload(path, blob, {
        cacheControl: "3600", upsert: false, contentType: "image/jpeg",
      });
      if (up.error) throw up.error;
      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from("employees").update({ photo_url: publicUrl }).eq("id", employeeId);
      if (error) throw error;
      onChange(publicUrl);
    } catch (e: any) {
      setErr(e?.message ?? "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from("employees").update({ photo_url: null }).eq("id", employeeId);
      if (error) throw error;
      onChange(null);
    } catch (e: any) {
      setErr(e?.message ?? "Konnte Foto nicht entfernen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        onClick={() => canEdit && !busy && inputRef.current?.click()}
        onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (canEdit && e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]); }}
        className={`group relative grid h-32 w-32 place-items-center overflow-hidden rounded-2xl ${canEdit ? "cursor-pointer" : ""} ${drag ? "ring-2 ring-brand-400" : ""}`}
        style={{ background: url ? "transparent" : "linear-gradient(135deg,var(--accent),var(--accent2))" }}
        title={canEdit ? "Foto hochladen oder hierher ziehen" : undefined}
      >
        {url ? (
          <img src={displayUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-3xl font-bold text-white">{initials(name)}</span>
        )}
        {canEdit && (
          <div className="absolute inset-0 hidden items-center justify-center bg-black/40 text-white group-hover:flex">
            <Camera size={22} />
          </div>
        )}
        {busy && <div className="absolute inset-0 grid place-items-center bg-black/40 text-xs text-white">…</div>}
      </div>

      {canEdit && (
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2 text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload size={14} /> {url ? "Tauschen" : "Hochladen"}
          </button>
          {url && (
            <button className="btn-ghost px-2 text-xs text-rose-500" disabled={busy} onClick={removePhoto}>
              <Trash2 size={14} /> Entfernen
            </button>
          )}
        </div>
      )}
      {err && <p className="max-w-[12rem] text-center text-xs text-rose-500">{err}</p>}

      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />

      {cropSrc && (
        <CropModal src={cropSrc} busy={busy}
          onCancel={() => { URL.revokeObjectURL(cropSrc); setCropSrc(null); }}
          onConfirm={async (blob) => { const s = cropSrc; setCropSrc(null); if (s) URL.revokeObjectURL(s); await uploadBlob(blob); }} />
      )}
    </div>
  );
}

// ── Zuschneide-Dialog: Zoom + Verschieben, runde Vorschau, Export als 512×512-JPEG ──
function CropModal({ src, busy, onCancel, onConfirm }: {
  src: string; busy: boolean; onCancel: () => void; onConfirm: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 }); // linke/obere Ecke des Bildes im VIEW-Quadrat (px)
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    const im = new Image();
    im.onload = () => { setImg(im); };
    im.src = src;
  }, [src]);

  // Cover-Grundskalierung, sodass das Bild das Quadrat füllt.
  const s0 = img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1;
  const drawnW = img ? img.naturalWidth * s0 * zoom : VIEW;
  const drawnH = img ? img.naturalHeight * s0 * zoom : VIEW;

  function clamp(x: number, y: number) {
    return { x: Math.min(0, Math.max(VIEW - drawnW, x)), y: Math.min(0, Math.max(VIEW - drawnH, y)) };
  }
  // Bei Bild-/Zoom-Änderung Position neu zentrieren/clampen.
  useEffect(() => {
    if (!img) return;
    setOff(() => clamp((VIEW - drawnW) / 2, (VIEW - drawnH) / 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, zoom]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX - off.x, y: e.clientY - off.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setOff(clamp(e.clientX - drag.current.x, e.clientY - drag.current.y));
  }
  function onPointerUp() { drag.current = null; }

  async function confirm() {
    if (!img) return;
    setRendering(true);
    const ratio = OUT / VIEW;
    const canvas = document.createElement("canvas");
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setRendering(false); return; }
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, off.x * ratio, off.y * ratio, drawnW * ratio, drawnH * ratio);
    canvas.toBlob((b) => { setRendering(false); if (b) onConfirm(b); }, "image/jpeg", 0.9);
  }

  // Über die zentrale Modal-Komponente rendern: sie portalt an <body> und löst den
  // Dialog damit aus transformierten/backdrop-filter-Containern (z. B. der linken
  // .glass-Spalte) → echtes app-weites Overlay, korrekt zentriert, Hintergrund gedimmt
  // und Scroll gesperrt. Backdrop-Klick schließt nur, wenn gerade nicht gespeichert wird.
  return (
    <Modal open onClose={() => { if (!busy && !rendering) onCancel(); }} title="Foto zuschneiden" size="md">
      <div className="flex flex-col items-center gap-3">
        <div className="relative overflow-hidden rounded-full ring-2 ring-white/20"
          style={{ width: VIEW, height: VIEW, touchAction: "none", background: "#222" }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          {img && (
            <img src={src} alt="" draggable={false}
              style={{ position: "absolute", left: off.x, top: off.y, width: drawnW, height: drawnH, maxWidth: "none", cursor: "move" }} />
          )}
        </div>
        <input type="range" min={1} max={3} step={0.01} value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))} className="w-full" aria-label="Zoom" />
        <p className="text-center text-xs text-slate-400">Ziehen zum Positionieren · Regler zum Zoomen</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel} disabled={busy || rendering}>Abbrechen</button>
        <button className="btn-primary" onClick={confirm} disabled={!img || busy || rendering}>
          {busy || rendering ? "Speichern …" : "Übernehmen"}
        </button>
      </div>
    </Modal>
  );
}
