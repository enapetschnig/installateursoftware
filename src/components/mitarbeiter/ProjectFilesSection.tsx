// ============================================================
// Installateursoftware – Mitarbeiter-App: Projekt-Dateien (Pläne etc.)
//
// Mobil-optimierter Upload + Liste von Projekt-Dateien direkt auf einem
// Storage-Bucket (z. B. project-plans für „Pläne"). Vorbild: Tischlerei
// Birgmann (Kategorie-Ordner je Bucket). Pfad: <projectId>/<timestamp>_<name>.
// Anzeigen über signierte URL (private Buckets). Mitarbeiter dürfen laut
// Storage-RLS hochladen + ansehen; Löschen ist Admin-only (hier nicht angeboten).
// Große Touch-Ziele, Kamera-/Datei-Auswahl über das System (accept steuerbar).
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Upload, Eye, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner } from "../ui";
import { ErrorBanner } from "../calc-ui";
import { toast, toastError } from "../../lib/toast";

type FileRow = { name: string; path: string; created_at?: string; size?: number };

const IMG_EXT = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"];
const isImage = (name: string) => IMG_EXT.includes((name.split(".").pop() || "").toLowerCase());
const cleanName = (stored: string) => stored.replace(/^\d+_/, ""); // führenden Zeitstempel entfernen

export default function ProjectFilesSection({
  projectId, bucket, title, accept = "*", hint,
}: {
  projectId: string;
  bucket: string;
  title: string;
  accept?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.storage.from(bucket).list(projectId, {
      limit: 200, sortBy: { column: "created_at", order: "desc" },
    });
    if (error) setErr(error.message);
    setFiles(((data ?? []) as { name: string; created_at?: string; metadata?: { size?: number } }[])
      .filter((f) => f.name && f.name !== ".emptyFolderPlaceholder")
      .map((f) => ({ name: f.name, path: `${projectId}/${f.name}`, created_at: f.created_at, size: f.metadata?.size })));
    setLoading(false);
  }, [bucket, projectId]);

  useEffect(() => { void reload(); }, [reload]);

  async function upload(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploading(true); setErr(null);
    let ok = 0;
    for (const file of Array.from(fileList)) {
      if (file.size > 50 * 1024 * 1024) { setErr(`„${file.name}" ist größer als 50 MB.`); continue; }
      const safe = file.name.replace(/[^\w.-]+/g, "_");
      const path = `${projectId}/${Date.now()}_${safe}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (error) { toastError(`Upload fehlgeschlagen: ${error.message}`); } else { ok++; }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (ok) { toast(ok === 1 ? "Datei hochgeladen." : `${ok} Dateien hochgeladen.`); void reload(); }
  }

  async function open(path: string) {
    setOpening(path);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    setOpening(null);
    if (error || !data?.signedUrl) { toastError("Datei konnte nicht geöffnet werden."); return; }
    window.open(data.signedUrl, "_blank");
  }

  return (
    <div className="glass p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <FileText size={15} /> {title} {files.length > 0 && <span className="text-slate-400">({files.length})</span>}
        </h2>
        <button
          className="btn-primary min-h-[40px] px-3 text-sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Hochladen
        </button>
        <input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      </div>

      {hint && <p className="mb-2 text-xs text-slate-400">{hint}</p>}
      <ErrorBanner message={err} />

      {loading ? (
        <div className="py-3"><Spinner /></div>
      ) : files.length === 0 ? (
        <p className="py-3 text-center text-sm text-slate-400">Noch keine {title.toLowerCase()}.</p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <button
              key={f.path}
              onClick={() => open(f.path)}
              className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:brightness-95"
              style={{ background: "var(--hover)" }}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--accent)]" style={{ background: "var(--accent-soft)" }}>
                {isImage(f.name) ? <ImageIcon size={18} /> : <FileText size={18} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{cleanName(f.name)}</span>
              {opening === f.path ? <Loader2 size={16} className="shrink-0 animate-spin text-slate-400" /> : <Eye size={16} className="shrink-0 text-slate-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
