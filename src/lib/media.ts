// ============================================================
// B4Y SuperAPP – Medien-Helfer (Fotos & Videos)
// Erlaubte Typen, Erkennung, Thumbnails, Upload nach Supabase.
// ============================================================
import { supabase } from "./supabase";
import { logProject } from "./projectlog";
import { MediaType, MediaSource } from "./types";

const BUCKET = "project-files";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "heic", "heif", "webp"];
export const VIDEO_EXT = ["mp4", "mov", "m4v"];
// Für <input accept="…">: erlaubt Mediathek-Auswahl + native Kamera
export const MEDIA_ACCEPT = ".jpg,.jpeg,.png,.heic,.heif,.webp,.mp4,.mov,.m4v,image/*,video/*";

const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase();

/** photo | video | null (null = nicht unterstützt) */
export function detectMediaType(file: File): MediaType | null {
  const ext = extOf(file.name);
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.includes(ext)) return "photo";
  if (mime.startsWith("video/") || VIDEO_EXT.includes(ext)) return "video";
  return null;
}

export const isAccepted = (file: File): boolean => detectMediaType(file) !== null;

// ------------------------------------------------------------
// Thumbnail-Erzeugung (clientseitig, JPEG). Fehler blockieren den
// Upload NICHT – dann wird ohne Thumbnail gespeichert.
// ------------------------------------------------------------
const THUMB_MAX = 480;

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72); }
    catch { resolve(null); }
  });
}

function drawScaled(source: CanvasImageSource, w: number, h: number): Blob | Promise<Blob | null> {
  const scale = Math.min(1, THUMB_MAX / Math.max(w, h || 1));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round((h || w) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source, 0, 0, cw, ch);
  return canvasToBlob(canvas);
}

async function imageThumbnail(file: File): Promise<Blob | null> {
  // HEIC kann im Browser meist nicht dekodiert werden → kein Thumbnail
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = url;
    });
    if (!img) return null;
    return await drawScaled(img, img.naturalWidth, img.naturalHeight);
  } catch { return null; }
  finally { URL.revokeObjectURL(url); }
}

async function videoThumbnail(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.preload = "metadata"; video.src = url;
    const frame = await new Promise<Blob | null>((resolve) => {
      let done = false;
      const finish = (b: Blob | null) => { if (!done) { done = true; resolve(b); } };
      const t = setTimeout(() => finish(null), 6000);
      video.onloadeddata = () => {
        try { video.currentTime = Math.min(0.1, (video.duration || 1) / 2); } catch { /* */ }
      };
      video.onseeked = async () => {
        clearTimeout(t);
        const b = await drawScaled(video, video.videoWidth || THUMB_MAX, video.videoHeight || THUMB_MAX);
        finish(b instanceof Blob ? b : (await b) ?? null);
      };
      video.onerror = () => { clearTimeout(t); finish(null); };
    });
    return frame;
  } catch { return null; }
  finally { URL.revokeObjectURL(url); }
}

export async function makeThumbnail(file: File, mediaType: MediaType): Promise<Blob | null> {
  try { return mediaType === "video" ? await videoThumbnail(file) : await imageThumbnail(file); }
  catch { return null; }
}

// ------------------------------------------------------------
// Upload: Datei + optionales Thumbnail → Storage, dann DB-Zeile.
// ------------------------------------------------------------
export type UploadOpts = {
  projectId: string;
  file: File | Blob;
  fileName: string;
  categoryId: string | null;
  categoryLabel: string | null;
  mediaType: MediaType;
  source: MediaSource;
  uploadedBy: string | null;
  title?: string | null;
  description?: string | null;
};

export async function uploadProjectMedia(opts: UploadOpts): Promise<void> {
  const ext = extOf(opts.fileName) || (opts.mediaType === "video" ? "mp4" : "jpg");
  const mime = (opts.file as File).type || (opts.mediaType === "video" ? "video/mp4" : "image/jpeg");
  const path = `${opts.projectId}/${uid()}.${ext}`;

  const up = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    cacheControl: "3600", upsert: false, contentType: mime,
  });
  if (up.error) throw up.error;
  const fileUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // Thumbnail (best effort)
  let thumbUrl: string | null = null;
  try {
    const realFile = opts.file instanceof File ? opts.file : new File([opts.file], opts.fileName, { type: mime });
    const thumb = await makeThumbnail(realFile, opts.mediaType);
    if (thumb) {
      const tpath = `${opts.projectId}/thumb_${uid()}.jpg`;
      const tu = await supabase.storage.from(BUCKET).upload(tpath, thumb, {
        cacheControl: "3600", upsert: false, contentType: "image/jpeg",
      });
      if (!tu.error) thumbUrl = supabase.storage.from(BUCKET).getPublicUrl(tpath).data.publicUrl;
    }
  } catch { /* Thumbnail optional */ }

  const size = (opts.file as File).size ?? null;
  const { error } = await supabase.from("project_media").insert({
    project_id: opts.projectId,
    file_name: opts.fileName,
    file_type: mime,
    mime_type: mime,
    file_size: size,
    file_url: fileUrl,
    thumbnail_url: thumbUrl ?? (opts.mediaType === "photo" ? fileUrl : null),
    media_type: opts.mediaType,
    category_id: opts.categoryId,
    category: opts.categoryLabel,
    title: opts.title ?? null,
    description: opts.description ?? null,
    source: opts.source,
    is_favorite: false,
    sort_order: 0,
    archived: false,
    created_by: opts.uploadedBy,
  });
  if (error) throw error;

  await logProject(opts.projectId, opts.mediaType === "video" ? "video" : "bild",
    `${opts.mediaType === "video" ? "Video" : "Foto"} hinzugefügt: ${opts.fileName}${opts.categoryLabel ? ` (${opts.categoryLabel})` : ""}`);
}
