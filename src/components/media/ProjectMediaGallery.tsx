// ============================================================
// B4Y SuperAPP – Projekt-Galerie „Bilder & Videos"
// Karten/Galerie, Filter (Alle/Fotos/Videos/Kategorie/Datum/
// Hochgeladen von/Favoriten), Sortierung, Upload + Kamera, Lightbox.
// Wiederverwendbar für andere Bereiche (projektbezogen).
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  Camera, Video as VideoIcon, Image as ImageIcon, Star, Archive, ExternalLink, Play, X,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { ErrorBanner } from "../calc-ui";
import { Spinner } from "../ui";
import { dateAt } from "../../lib/format";
import { toastError } from "../../lib/toast";
import { ProjectMedia, MediaCategory } from "../../lib/types";
import { sortAlpha } from "../../lib/sortOptions";
import { useSignedUrl } from "../../lib/storage";
import SignedImage from "../SignedImage";
import ProjectMediaUploadButton from "./ProjectMediaUploadButton";
import ProjectMediaCameraCapture from "./ProjectMediaCameraCapture";

type Perms = { canUpload?: boolean; canCapture?: boolean; canDelete?: boolean };

export default function ProjectMediaGallery({
  projectId, uploadedBy, perms = { canUpload: true, canCapture: true, canDelete: true },
}: {
  projectId: string;
  uploadedBy: string | null;
  perms?: Perms;
}) {
  const [items, setItems] = useState<ProjectMedia[]>([]);
  const [categories, setCategories] = useState<MediaCategory[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [fType, setFType] = useState<"all" | "photo" | "video">("all");
  const [fCat, setFCat] = useState<string>("");
  const [fUser, setFUser] = useState<string>("");
  const [fFav, setFFav] = useState(false);
  const [sort, setSort] = useState<"date_desc" | "date_asc" | "category" | "order">("date_desc");

  const [camera, setCamera] = useState<null | "photo" | "video">(null);
  const [lightbox, setLightbox] = useState<ProjectMedia | null>(null);
  // project-files ist privat (F-02) → signierte URL für die Lightbox-Datei.
  const lightboxUrl = useSignedUrl("project-files", lightbox?.file_url);

  async function load() {
    setLoading(true); setErr(null);
    const [m, c, p] = await Promise.all([
      supabase.from("project_media").select("*").eq("project_id", projectId).eq("archived", false),
      supabase.from("media_categories").select("*").order("sort_order"),
      supabase.from("profiles").select("id,name"),
    ]);
    if (m.error) setErr(m.error.message);
    // Nur Medien (Fotos/Videos) – Dokumente bleiben im Dokumente-Reiter
    const media = ((m.data as ProjectMedia[]) ?? []).filter(
      (x) => x.media_type === "photo" || x.media_type === "video"
        || (x.file_type ?? "").startsWith("image") || (x.file_type ?? "").startsWith("video")
    );
    setItems(media);
    setCategories((c.data as MediaCategory[]) ?? []);
    const map: Record<string, string> = {};
    for (const row of (p.data as { id: string; name: string | null }[]) ?? []) if (row.name) map[row.id] = row.name;
    setPeople(map);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);

  const catName = (id: string | null, fallback: string | null) =>
    categories.find((c) => c.id === id)?.name ?? fallback ?? "Ohne Kategorie";

  async function toggleFav(m: ProjectMedia) {
    setItems((arr) => arr.map((x) => x.id === m.id ? { ...x, is_favorite: !x.is_favorite } : x));
    const { error } = await supabase.from("project_media").update({ is_favorite: !m.is_favorite }).eq("id", m.id);
    if (error) { toastError(error.message); load(); } // bei Fehler aus der DB neu laden (Rollback)
  }
  async function archive(m: ProjectMedia) {
    setItems((arr) => arr.filter((x) => x.id !== m.id));
    const { error } = await supabase.from("project_media").update({ archived: true }).eq("id", m.id);
    if (error) { toastError(error.message); load(); } // bei Fehler aus der DB neu laden (Rollback)
  }

  const shown = useMemo(() => {
    let list = items.slice();
    if (fType !== "all") list = list.filter((m) => (m.media_type ?? "photo") === fType);
    if (fCat) list = list.filter((m) => m.category_id === fCat);
    if (fUser) list = list.filter((m) => m.created_by === fUser);
    if (fFav) list = list.filter((m) => m.is_favorite);
    list.sort((a, b) => {
      if (sort === "date_asc") return (a.taken_at ?? a.created_at).localeCompare(b.taken_at ?? b.created_at);
      if (sort === "category") return catName(a.category_id, a.category).localeCompare(catName(b.category_id, b.category));
      if (sort === "order") return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return (b.taken_at ?? b.created_at).localeCompare(a.taken_at ?? a.created_at); // date_desc
    });
    return list;
    // catName hängt nur von categories ab – die sind bereits in den Deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, fType, fCat, fUser, fFav, sort, categories]);

  const uploaders = useMemo(() => {
    const ids = Array.from(new Set(items.map((m) => m.created_by).filter(Boolean) as string[]));
    return sortAlpha(ids.map((id) => ({ id, name: people[id] ?? "Unbekannt" })), "name");
  }, [items, people]);

  return (
    <div className="glass p-4 sm:p-5">
      {/* Kopf: Titel + Aktionen */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">Bilder &amp; Videos</h3>
        <div className="flex flex-wrap gap-2">
          {perms.canCapture && (
            <>
              <button className="btn-outline" onClick={() => setCamera("photo")}><Camera size={16} /> Foto aufnehmen</button>
              <button className="btn-outline" onClick={() => setCamera("video")}><VideoIcon size={16} /> Video aufnehmen</button>
            </>
          )}
          {perms.canUpload && (
            <ProjectMediaUploadButton projectId={projectId} categories={categories} uploadedBy={uploadedBy} onDone={load} />
          )}
        </div>
      </div>

      <ErrorBanner message={err} />

      {/* Filterleiste */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-[var(--hover)] p-0.5">
          {([["all", "Alle"], ["photo", "Fotos"], ["video", "Videos"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFType(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${fType === k ? "bg-[var(--card)] shadow-sm" : "text-slate-400"}`}>{l}</button>
          ))}
        </div>
        <select className="input w-auto py-1 text-xs" value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="">Alle Kategorien</option>
          {categories.filter((c) => c.is_active || items.some((m) => m.category_id === c.id)).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {uploaders.length > 0 && (
          <select className="input w-auto py-1 text-xs" value={fUser} onChange={(e) => setFUser(e.target.value)}>
            <option value="">Alle Personen</option>
            {uploaders.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <button onClick={() => setFFav((v) => !v)}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${fFav ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-[var(--hover)] text-slate-400"}`}>
          <Star size={13} className={fFav ? "fill-amber-500 text-amber-500" : ""} /> Favoriten
        </button>
        <select className="input ml-auto w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="date_desc">Neueste zuerst</option>
          <option value="date_asc">Älteste zuerst</option>
          <option value="category">Nach Kategorie</option>
          <option value="order">Upload-Reihenfolge</option>
        </select>
      </div>

      {/* Galerie */}
      {loading ? <Spinner /> : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          {items.length === 0 ? "Noch keine Fotos oder Videos. Lade welche hoch oder nimm direkt auf." : "Keine Treffer für die aktuellen Filter."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((m) => {
            const isVideo = (m.media_type ?? "photo") === "video";
            const thumb = m.thumbnail_url || (!isVideo ? m.file_url : null);
            return (
              <div key={m.id} className="group relative overflow-hidden rounded-xl border bg-[var(--card)]" style={{ borderColor: "var(--border)" }}>
                <button className="relative block h-32 w-full" onClick={() => setLightbox(m)} title={m.title || m.file_name}>
                  {thumb ? (
                    <SignedImage bucket="project-files" value={thumb} alt={m.title || m.file_name} className="h-32 w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid h-32 w-full place-items-center bg-black/80 text-white">
                      {isVideo ? <VideoIcon size={28} /> : <ImageIcon size={28} />}
                    </div>
                  )}
                  {isVideo && (
                    <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white">
                      <Play size={14} className="fill-white" />
                    </span>
                  )}
                </button>
                <div className="p-1.5 text-[11px] text-slate-500">
                  <div className="truncate font-medium text-[var(--text)]">{m.title || m.file_name}</div>
                  <div className="flex items-center justify-between">
                    <span className="truncate">{catName(m.category_id, m.category)}</span>
                    <span>{dateAt(m.taken_at ?? m.created_at)}</span>
                  </div>
                  {m.created_by && people[m.created_by] && (
                    <div className="truncate text-slate-400">{people[m.created_by]}</div>
                  )}
                </div>
                <button className={`absolute right-1 top-1 rounded-lg p-1 ${m.is_favorite ? "bg-amber-500 text-white" : "bg-black/50 text-white opacity-0 group-hover:opacity-100"} transition`}
                  title="Favorit" onClick={() => toggleFav(m)}>
                  <Star size={13} className={m.is_favorite ? "fill-white" : ""} />
                </button>
                {perms.canDelete && (
                  <button className="absolute right-1 top-8 rounded-lg bg-black/50 p-1 text-white opacity-0 transition group-hover:opacity-100"
                    title="Archivieren" onClick={() => archive(m)}>
                    <Archive size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Kamera */}
      {camera && (
        <ProjectMediaCameraCapture
          projectId={projectId} categories={categories} uploadedBy={uploadedBy}
          initialMode={camera} onClose={() => setCamera(null)} onDone={load}
        />
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <button className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white" onClick={() => setLightbox(null)}><X size={20} /></button>
          <div className="max-h-[85vh] max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {(lightbox.media_type ?? "photo") === "video" ? (
              <video src={lightboxUrl} controls autoPlay playsInline className="max-h-[80vh] rounded-xl" />
            ) : (
              <img src={lightboxUrl} alt={lightbox.title || lightbox.file_name} className="max-h-[80vh] rounded-xl" />
            )}
            <div className="mt-2 flex items-center justify-between text-sm text-white/80">
              <span>{lightbox.title || lightbox.file_name} · {catName(lightbox.category_id, lightbox.category)}</span>
              <a className="flex items-center gap-1 underline" href={lightboxUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Original
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
