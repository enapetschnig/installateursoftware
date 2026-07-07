// ============================================================
// B4Y SuperAPP – In-App-Kamera (Fotos & Videos)
// getUserMedia-Live-Vorschau, Zoom (0,5/1/2/3x – Hardware wo
// möglich, sonst digital), Objektiv-/Kamerawahl, Aufnahme,
// Vorschau, Kategorie, Speichern. Mit iOS/iPad-Fallbacks.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera, Video as VideoIcon, RefreshCw, Check, X, RotateCcw, SwitchCamera, Circle, Square,
} from "lucide-react";
import { Modal } from "../ui";
import { ErrorBanner } from "../calc-ui";
import { MediaCategory, MediaType, MediaSource } from "../../lib/types";
import { uploadProjectMedia } from "../../lib/media";
import MediaCategorySelector, { defaultCategoryId } from "./MediaCategorySelector";

const ZOOM_STEPS = [0.5, 1, 2, 3];

// Ein physisches Objektiv der Rückkamera, abgeleitet aus den vom Browser
// gemeldeten Video-Eingabegeräten. factor = Lupen-Faktor (0,5x / 1x / 2x).
type Lens = { factor: number; deviceId: string; label: string };

// Ordnet erkannte Kameras (Rückseite) anhand der Geräte-Labels einem
// Objektiv-Faktor zu. Labels sind nur nach erteilter Kamera-Freigabe
// gefüllt – als Fallback dient der Listenindex.
// Heuristik: ultra/weit/Index 0 → 0,5x · tele/Index 2+ → 2x · back/Index 1 → 1x
function detectLenses(cams: MediaDeviceInfo[]): Lens[] {
  const byFactor = new Map<number, Lens>();
  cams.forEach((cam, i) => {
    const label = cam.label || "";
    const l = label.toLowerCase();
    let factor: number;
    if (/ultra/.test(l) || (/\bwide\b|weit/.test(l) && !/dual|triple/.test(l))) factor = 0.5;
    else if (/tele/.test(l)) factor = 2;
    else if (/back|rück|rear|environment/.test(l)) factor = 1;
    else if (i === 0) factor = 0.5;
    else if (i === 1) factor = 1;
    else factor = 2;
    // pro Faktor nur das erste passende Objektiv behalten
    if (!byFactor.has(factor)) byFactor.set(factor, { factor, deviceId: cam.deviceId, label: label || `Kamera ${i + 1}` });
  });
  return [...byFactor.values()].sort((a, b) => a.factor - b.factor);
}

function detectSource(): MediaSource {
  const ua = navigator.userAgent || "";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document)) return "ipad_camera";
  if (/iPhone|Android|Mobile/i.test(ua)) return "mobile_camera";
  return "camera";
}

export default function ProjectMediaCameraCapture({
  projectId, categories, uploadedBy, initialMode = "photo", onClose, onDone,
}: {
  projectId: string;
  categories: MediaCategory[];
  uploadedBy: string | null;
  initialMode?: MediaType;
  onClose: () => void;
  onDone: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const [mode, setMode] = useState<MediaType>(initialMode);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [recording, setRecording] = useState(false);
  const [backCams, setBackCams] = useState<MediaDeviceInfo[]>([]);
  const [deviceIdx, setDeviceIdx] = useState(0);
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [activeLens, setActiveLens] = useState<number | null>(null);
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [digitalZoom, setDigitalZoom] = useState(1);

  const [captured, setCaptured] = useState<{ blob: Blob; url: string; type: MediaType; name: string } | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const videoRecSupported = typeof MediaRecorder !== "undefined";

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const applyHwZoom = useCallback(async (z: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !hwZoom) return false;
    const target = Math.min(hwZoom.max, Math.max(hwZoom.min, z));
    try { await (track as any).applyConstraints({ advanced: [{ zoom: target }] }); return true; }
    catch { return false; }
  }, [hwZoom]);

  const start = useCallback(async (deviceId?: string) => {
    setStarting(true); setErr(null);
    stopStream();
    try {
      const constraints: MediaStreamConstraints = {
        audio: mode === "video",
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: "environment" } },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }

      const track = stream.getVideoTracks()[0];
      const caps: any = track?.getCapabilities ? track.getCapabilities() : {};
      if (caps && typeof caps.zoom === "object" && caps.zoom) {
        setHwZoom({ min: caps.zoom.min ?? 1, max: caps.zoom.max ?? 1, step: caps.zoom.step ?? 0.1 });
      } else { setHwZoom(null); }

      // verfügbare Rückkameras / Objektive ermitteln
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      const back = cams.filter((d) => /back|rück|environment|rear/i.test(d.label));
      const relevant = back.length > 0 ? back : cams;
      setBackCams(relevant);

      // Physische Objektive (0,5x / 1x / 2x) für die Objektivwahl ableiten
      const detected = detectLenses(relevant);
      setLenses(detected);

      // aktives Objektiv anhand des laufenden Streams bestimmen
      const settings: MediaTrackSettings = track?.getSettings ? track.getSettings() : {};
      const activeId = settings.deviceId;
      const current = detected.find((ln) => ln.deviceId && ln.deviceId === activeId)
        ?? detected.find((ln) => ln.factor === 1) ?? detected[0] ?? null;
      setActiveLens(current?.factor ?? null);
      const idx = relevant.findIndex((d) => d.deviceId === (current?.deviceId ?? activeId));
      if (idx >= 0) setDeviceIdx(idx);

      // Standard: 0,5x falls Hardware-Zoom < 1 erlaubt (selten) oder Ultraweit-Objektiv da; sonst 1x
      setDigitalZoom(1);
      setZoom(1);
    } catch (e: any) {
      setErr(e?.name === "NotAllowedError"
        ? "Kamerazugriff verweigert. Bitte im Browser die Kamera erlauben."
        : (e?.message ?? "Kamera konnte nicht gestartet werden."));
    } finally { setStarting(false); }
  }, [mode, stopStream]);

  // Start / Neustart bewusst nur bei Moduswechsel (start/stopStream sind useCallbacks).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { start(); return () => { stopStream(); }; }, [mode]);
  useEffect(() => () => { if (captured) URL.revokeObjectURL(captured.url); }, [captured]);

  async function setZoomLevel(z: number) {
    setZoom(z);
    if (z >= 1) {
      const ok = await applyHwZoom(z);
      setDigitalZoom(ok ? 1 : z); // ohne HW-Zoom: digital (CSS + Crop)
    } else {
      // 0,5x: Ultraweit nur per Objektivwechsel möglich; sonst auf 1x klemmen
      const ultra = backCams.findIndex((d) => /ultra|weit|0\.5|wide/i.test(d.label));
      if (ultra >= 0 && ultra !== deviceIdx) { setDeviceIdx(ultra); start(backCams[ultra].deviceId); }
      else { setDigitalZoom(1); }
    }
  }

  function switchCam() {
    if (backCams.length < 2) return;
    const next = (deviceIdx + 1) % backCams.length;
    setDeviceIdx(next); start(backCams[next].deviceId);
  }

  // Objektivwechsel über echtes physisches Gerät (deviceId-Stream-Wechsel)
  function selectLens(lens: Lens) {
    if (lens.factor === activeLens) return;
    setActiveLens(lens.factor);
    const idx = backCams.findIndex((d) => d.deviceId === lens.deviceId);
    if (idx >= 0) setDeviceIdx(idx);
    setZoom(1); setDigitalZoom(1);
    start(lens.deviceId);
  }

  function capturePhoto() {
    const v = videoRef.current; if (!v) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return;
    const z = Math.max(1, digitalZoom);
    const sw = vw / z, sh = vh / z, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, vw, vh);
    canvas.toBlob((b) => {
      if (!b) { setErr("Foto konnte nicht erstellt werden."); return; }
      stopStream();
      setCaptured({ blob: b, url: URL.createObjectURL(b), type: "photo", name: `foto_${Date.now()}.jpg` });
      setCategoryId(defaultCategoryId(categories, "photo"));
    }, "image/jpeg", 0.9);
  }

  function startRec() {
    const stream = streamRef.current; if (!stream || !videoRecSupported) return;
    const types = ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
    try {
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || "video/mp4";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        stopStream();
        setCaptured({ blob, url: URL.createObjectURL(blob), type: "video", name: `video_${Date.now()}.${ext}` });
        setCategoryId(defaultCategoryId(categories, "video"));
      };
      rec.start(); recorderRef.current = rec; setRecording(true);
    } catch (e: any) { setErr(e?.message ?? "Videoaufnahme nicht möglich."); }
  }
  function stopRec() {
    try { recorderRef.current?.stop(); } catch { /* */ }
    setRecording(false);
  }

  function retake() {
    if (captured) URL.revokeObjectURL(captured.url);
    setCaptured(null); setTitle("");
    start(backCams[deviceIdx]?.deviceId);
  }

  async function save() {
    if (!captured) return;
    setSaving(true); setErr(null);
    try {
      const catName = categories.find((c) => c.id === categoryId)?.name ?? null;
      await uploadProjectMedia({
        projectId, file: captured.blob, fileName: captured.name,
        categoryId, categoryLabel: catName, mediaType: captured.type,
        source: detectSource(), uploadedBy, title: title.trim() || null,
      });
      onDone(); onClose();
    } catch (e: any) { setErr(e?.message ?? "Speichern fehlgeschlagen."); setSaving(false); }
  }

  function close() { stopStream(); onClose(); }

  return (
    <Modal open onClose={close} title={mode === "video" ? "Video aufnehmen" : "Foto aufnehmen"} size="xl">
      <ErrorBanner message={err} />

      {/* Moduswahl (nur vor Aufnahme) */}
      {!captured && (
        <div className="mb-3 flex gap-1 rounded-xl bg-[var(--hover)] p-1">
          <button className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold ${mode === "photo" ? "bg-[var(--card)] shadow-sm" : "text-slate-400"}`}
            onClick={() => !recording && setMode("photo")}><Camera size={15} className="mr-1 inline" /> Foto</button>
          <button className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold ${mode === "video" ? "bg-[var(--card)] shadow-sm" : "text-slate-400"}`}
            onClick={() => !recording && videoRecSupported && setMode("video")} disabled={!videoRecSupported}
            title={videoRecSupported ? "" : "Videoaufnahme von diesem Browser nicht unterstützt"}>
            <VideoIcon size={15} className="mr-1 inline" /> Video</button>
        </div>
      )}

      {/* Live-Vorschau oder aufgenommene Vorschau */}
      <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: "3 / 4", maxHeight: "60vh" }}>
        {!captured ? (
          <>
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover"
              style={{ transform: `scale(${digitalZoom})` }} />
            {starting && <div className="absolute inset-0 grid place-items-center text-sm text-white/80">Kamera startet …</div>}
            {recording && (
              <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-1 text-xs font-semibold text-white">
                <Circle size={10} className="animate-pulse fill-white" /> REC
              </div>
            )}
            {backCams.length > 1 && !recording && (
              <button className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white" title="Kamera/Objektiv wechseln" onClick={switchCam}>
                <SwitchCamera size={18} />
              </button>
            )}
            {/* Objektivwahl (Mehrkamera-Geräte: echtes Objektiv per deviceId) */}
            {!recording && lenses.length > 1 && (
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-black/50 p-1">
                {lenses.map((lens) => (
                  <button key={lens.deviceId || lens.factor} onClick={() => selectLens(lens)}
                    title={lens.label}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activeLens === lens.factor ? "bg-white text-black" : "text-white"}`}>
                    {lens.factor}x
                  </button>
                ))}
              </div>
            )}
            {/* Zoomstufen (Einzelkamera/Desktop: digitaler Zoom) */}
            {!recording && lenses.length <= 1 && (
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-black/50 p-1">
                {ZOOM_STEPS.map((z) => (
                  <button key={z} onClick={() => setZoomLevel(z)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${zoom === z ? "bg-white text-black" : "text-white"}`}>
                    {z}x
                  </button>
                ))}
              </div>
            )}
          </>
        ) : captured.type === "photo" ? (
          <img src={captured.url} alt="Aufnahme" className="h-full w-full object-contain" />
        ) : (
          <video src={captured.url} controls playsInline className="h-full w-full object-contain" />
        )}
      </div>

      {/* Steuerleiste */}
      {!captured ? (
        <div className="mt-4 flex items-center justify-center gap-4">
          {mode === "photo" ? (
            <button className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-white/20 text-white disabled:opacity-40"
              onClick={capturePhoto} disabled={starting} title="Foto aufnehmen">
              <Camera size={26} />
            </button>
          ) : !recording ? (
            <button className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-red-600 text-white disabled:opacity-40"
              onClick={startRec} disabled={starting || !videoRecSupported} title="Aufnahme starten">
              <Circle size={26} className="fill-white" />
            </button>
          ) : (
            <button className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-white text-red-600"
              onClick={stopRec} title="Aufnahme stoppen">
              <Square size={24} className="fill-red-600" />
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Kategorie</span>
              <MediaCategorySelector categories={categories} mediaType={captured.type} value={categoryId} onChange={setCategoryId} />
            </label>
            <label className="block">
              <span className="label">Titel (optional)</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Schaden Bad" />
            </label>
          </div>
          <div className="flex justify-between gap-2">
            <button className="btn-outline" onClick={retake} disabled={saving}><RotateCcw size={15} /> Neu aufnehmen</button>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={close} disabled={saving}><X size={15} /> Abbrechen</button>
              <button className="btn-primary" onClick={save} disabled={saving}><Check size={16} /> {saving ? "Speichert …" : "Speichern"}</button>
            </div>
          </div>
        </div>
      )}

      {!captured && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>{hwZoom ? "Hardware-Zoom verfügbar" : "Digitaler Zoom (Gerät erlaubt keinen Hardware-Zoom)"}</span>
          <button className="btn-ghost px-2 py-1" onClick={() => start(backCams[deviceIdx]?.deviceId)} title="Kamera neu starten"><RefreshCw size={13} /></button>
        </div>
      )}
    </Modal>
  );
}
