// ============================================================
// B4Y SuperAPP – Einstellungen: Fotos- & Video-Kategorien verwalten
// Anlegen, bearbeiten, aktiv/inaktiv, Standard, Sortierung, löschen.
// ============================================================
import { useEffect, useState } from "react";
import { Plus, Trash2, Star, Image as ImageIcon, Video as VideoIcon, Images } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { ErrorBanner, ConfirmDialog, Toggle } from "../calc-ui";
import { Spinner } from "../ui";
import { MediaCategory } from "../../lib/types";
import { SortHeader } from "../SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";

export default function MediaCategoryManager({ canManage = true }: { canManage?: boolean }) {
  const [cats, setCats] = useState<MediaCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhotos, setNewPhotos] = useState(true);
  const [newVideos, setNewVideos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<MediaCategory | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("media_categories").select("*").order("sort_order");
    if (error) setErr(error.message);
    setCats((data as MediaCategory[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!newName.trim()) return;
    setBusy(true); setErr(null);
    const maxSort = cats.reduce((m, c) => Math.max(m, c.sort_order), 0);
    const { error } = await supabase.from("media_categories").insert({
      name: newName.trim(), applies_to_photos: newPhotos, applies_to_videos: newVideos, sort_order: maxSort + 10,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setNewName(""); setNewPhotos(true); setNewVideos(true); load();
  }

  async function patch(c: MediaCategory, p: Partial<MediaCategory>) {
    setCats((arr) => arr.map((x) => x.id === c.id ? { ...x, ...p } : x));
    const { error } = await supabase.from("media_categories").update(p).eq("id", c.id);
    if (error) { setErr(error.message); load(); }
  }

  async function makeDefault(c: MediaCategory) {
    setCats((arr) => arr.map((x) => ({ ...x, is_default: x.id === c.id })));
    await supabase.from("media_categories").update({ is_default: false }).neq("id", c.id);
    await supabase.from("media_categories").update({ is_default: true }).eq("id", c.id);
  }

  async function remove(c: MediaCategory) {
    setDel(null);
    const { error } = await supabase.from("media_categories").delete().eq("id", c.id);
    if (error) { setErr(error.message); return; }
    load();
  }

  const { session } = useAuth();
  const catSort = useTableSort<MediaCategory>(
    "media_categories",
    {
      name: { get: (c) => c.name, type: "text" },
      photos: { get: (c) => (c.applies_to_photos ? 0 : 1), type: "number" },
      videos: { get: (c) => (c.applies_to_videos ? 0 : 1), type: "number" },
      def: { get: (c) => (c.is_default ? 0 : 1), type: "number" },
      active: { get: (c) => (c.is_active ? 0 : 1), type: "number" },
      sort: { get: (c) => c.sort_order, type: "number" },
    },
    { userId: session?.user?.id ?? null, default: { key: "sort", dir: "asc" } }
  );

  return (
    <div className="glass p-4">
      <div className="mb-1 flex items-center gap-2">
        <Images size={18} />
        <h2 className="text-lg font-bold">Fotos &amp; Videos</h2>
      </div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Kategorien für Projektfotos und -videos. Inaktive Kategorien sind beim Hochladen nicht mehr wählbar;
        bereits zugeordnete Medien bleiben erhalten.
      </p>

      <ErrorBanner message={err} />

      {/* Neue Kategorie */}
      {canManage && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
          <label className="min-w-[180px] flex-1">
            <span className="label">Neue Kategorie</span>
            <input className="input" value={newName} placeholder="z.B. Erstbesichtigung"
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newPhotos} onChange={(e) => setNewPhotos(e.target.checked)} /> Fotos</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newVideos} onChange={(e) => setNewVideos(e.target.checked)} /> Videos</label>
          <button className="btn-primary" onClick={add} disabled={busy || !newName.trim()}><Plus size={16} /> Anlegen</button>
        </div>
      )}

      {loading ? <Spinner /> : cats.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Noch keine Kategorien.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <SortHeader label="Name" sortKey="name" sort={catSort.sort} onSort={catSort.onSort} padClass="px-2 py-2" />
                <SortHeader label="Fotos" sortKey="photos" sort={catSort.sort} onSort={catSort.onSort} align="center" padClass="px-2 py-2" />
                <SortHeader label="Videos" sortKey="videos" sort={catSort.sort} onSort={catSort.onSort} align="center" padClass="px-2 py-2" />
                <SortHeader label="Standard" sortKey="def" sort={catSort.sort} onSort={catSort.onSort} align="center" padClass="px-2 py-2" />
                <SortHeader label="Aktiv" sortKey="active" sort={catSort.sort} onSort={catSort.onSort} align="center" padClass="px-2 py-2" />
                <SortHeader label="Sortierung" sortKey="sort" sort={catSort.sort} onSort={catSort.onSort} align="center" padClass="px-2 py-2" className="min-w-[96px]" />
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {catSort.sortRows(cats).map((c) => (
                <tr key={c.id} className={c.is_active ? "" : "opacity-50"}>
                  <td className="px-2 py-1.5">
                    <input className="input py-1 text-sm" value={c.name} disabled={!canManage}
                      onChange={(e) => setCats((arr) => arr.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x))}
                      onBlur={(e) => patch(c, { name: e.target.value.trim() || c.name })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={c.applies_to_photos} disabled={!canManage}
                      onChange={(e) => patch(c, { applies_to_photos: e.target.checked })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={c.applies_to_videos} disabled={!canManage}
                      onChange={(e) => patch(c, { applies_to_videos: e.target.checked })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button title="Als Standard setzen" disabled={!canManage} onClick={() => makeDefault(c)}
                      className={c.is_default ? "text-amber-500" : "text-slate-300 hover:text-slate-500"}>
                      <Star size={16} className={c.is_default ? "fill-amber-500" : ""} />
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <div className="flex justify-center">
                      <Toggle checked={c.is_active} onChange={(v) => canManage && patch(c, { is_active: v })} />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="number" className="input py-1 px-2 text-center text-sm" style={{ width: 80, minWidth: 72 }} value={c.sort_order} disabled={!canManage}
                      onChange={(e) => setCats((arr) => arr.map((x) => x.id === c.id ? { ...x, sort_order: Number(e.target.value) } : x))}
                      onBlur={(e) => patch(c, { sort_order: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {canManage && (
                      <button className="btn-ghost px-1.5 text-rose-500" title="Löschen" onClick={() => setDel(c)}><Trash2 size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex items-center gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1"><ImageIcon size={12} /> = Fotos</span>
        <span className="flex items-center gap-1"><VideoIcon size={12} /> = Videos</span>
        <span className="flex items-center gap-1"><Star size={12} className="fill-amber-500 text-amber-500" /> = Standardkategorie</span>
      </p>

      <ConfirmDialog
        open={!!del}
        title="Kategorie löschen?"
        confirmLabel="Löschen"
        message={<>Kategorie <b>{del?.name}</b> wirklich löschen? Bereits zugeordnete Medien behalten ihre Bezeichnung, verlieren aber die Verknüpfung. Alternativ kannst du sie auch nur deaktivieren.</>}
        onConfirm={() => del && remove(del)}
        onClose={() => setDel(null)}
      />
    </div>
  );
}
