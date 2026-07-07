// ============================================================
// B4Y SuperAPP – Upload-Button für Fotos & Videos
// Mehrfach-Upload, Typprüfung, gemeinsame oder einzelne Kategorie,
// Fortschrittsanzeige, Thumbnails (über media-Lib).
// ============================================================
import { useRef, useState } from "react";
import { Upload, AlertTriangle, Image as ImageIcon, Video as VideoIcon, X } from "lucide-react";
import { Modal } from "../ui";
import { ErrorBanner } from "../calc-ui";
import { MediaCategory, MediaType } from "../../lib/types";
import { detectMediaType, isAccepted, uploadProjectMedia, MEDIA_ACCEPT } from "../../lib/media";
import MediaCategorySelector, { defaultCategoryId } from "./MediaCategorySelector";

type Staged = { file: File; mediaType: MediaType; categoryId: string | null };

export default function ProjectMediaUploadButton({
  projectId, categories, uploadedBy, onDone, label = "Hochladen",
}: {
  projectId: string;
  categories: MediaCategory[];
  uploadedBy: string | null;
  onDone: () => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [perFile, setPerFile] = useState(false);
  const [sharedCat, setSharedCat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function pick(files: FileList | null) {
    if (!files?.length) return;
    const ok: Staged[] = [];
    const bad: string[] = [];
    for (const f of Array.from(files)) {
      const mt = detectMediaType(f);
      if (!mt || !isAccepted(f)) { bad.push(f.name); continue; }
      ok.push({ file: f, mediaType: mt, categoryId: defaultCategoryId(categories, mt) });
    }
    setRejected(bad);
    setStaged(ok);
    setSharedCat(defaultCategoryId(categories, "both"));
    setErr(ok.length === 0 && bad.length > 0 ? "Keine unterstützten Dateien ausgewählt." : null);
  }

  function reset() {
    setStaged([]); setRejected([]); setBusy(false); setProgress(null); setErr(null); setPerFile(false);
  }

  async function doUpload() {
    if (staged.length === 0) return;
    setBusy(true); setErr(null);
    const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null;
    let done = 0;
    setProgress({ done: 0, total: staged.length });
    try {
      for (const s of staged) {
        const catId = perFile ? s.categoryId : sharedCat;
        await uploadProjectMedia({
          projectId, file: s.file, fileName: s.file.name,
          categoryId: catId, categoryLabel: catName(catId),
          mediaType: s.mediaType, source: "upload", uploadedBy,
        });
        done += 1; setProgress({ done, total: staged.length });
      }
      reset();
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? "Upload fehlgeschlagen.");
      setBusy(false);
    }
  }

  const open = staged.length > 0 || rejected.length > 0;

  return (
    <>
      <button className="btn-primary" onClick={() => inputRef.current?.click()}>
        <Upload size={16} /> {label}
      </button>
      <input
        ref={inputRef} type="file" accept={MEDIA_ACCEPT} multiple className="hidden"
        onChange={(e) => { pick(e.target.files); e.currentTarget.value = ""; }}
      />

      {open && (
        <Modal open onClose={() => { if (!busy) reset(); }} title={`Hochladen (${staged.length})`} size="xl">
          <ErrorBanner message={err} />

          {rejected.length > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>Nicht unterstützt und übersprungen: {rejected.join(", ")}</span>
            </div>
          )}

          {staged.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={perFile} onChange={(e) => setPerFile(e.target.checked)} disabled={busy} />
                  Kategorie je Datei einzeln festlegen
                </label>
                {!perFile && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500">Kategorie für alle:</span>
                    <MediaCategorySelector categories={categories} value={sharedCat} onChange={setSharedCat} className="w-auto py-1 text-sm" />
                  </div>
                )}
              </div>

              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {staged.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border p-2 text-sm" style={{ borderColor: "var(--border)" }}>
                    {s.mediaType === "video" ? <VideoIcon size={15} className="text-blue-500" /> : <ImageIcon size={15} className="text-amber-500" />}
                    <span className="min-w-0 flex-1 truncate">{s.file.name}</span>
                    <span className="text-xs text-slate-400">{(s.file.size / 1024 / 1024).toFixed(1)} MB</span>
                    {perFile && (
                      <MediaCategorySelector
                        categories={categories} mediaType={s.mediaType} value={s.categoryId}
                        onChange={(id) => setStaged((arr) => arr.map((x, j) => j === i ? { ...x, categoryId: id } : x))}
                        className="w-40 py-1 text-xs"
                      />
                    )}
                    {!busy && (
                      <button className="btn-ghost px-1 text-rose-500" title="Entfernen"
                        onClick={() => setStaged((arr) => arr.filter((_, j) => j !== i))}><X size={14} /></button>
                    )}
                  </div>
                ))}
              </div>

              {progress && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>Lädt hoch …</span><span>{progress.done} / {progress.total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--hover)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%`, background: "var(--accent)" }} />
                  </div>
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button className="btn-outline" onClick={reset} disabled={busy}>Abbrechen</button>
                <button className="btn-primary" onClick={doUpload} disabled={busy || staged.length === 0}>
                  <Upload size={16} /> {busy ? "Lädt …" : `${staged.length} hochladen`}
                </button>
              </div>
            </>
          )}

          {staged.length === 0 && rejected.length > 0 && (
            <div className="mt-4 flex justify-end"><button className="btn-outline" onClick={reset}>Schließen</button></div>
          )}
        </Modal>
      )}
    </>
  );
}
