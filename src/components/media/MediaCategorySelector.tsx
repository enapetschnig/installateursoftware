// ============================================================
// B4Y SuperAPP – Kategorie-Auswahl für Fotos/Videos
// Zeigt nur aktive, zum Medientyp passende Kategorien.
// ============================================================
import { MediaCategory, MediaType } from "../../lib/types";

export function categoriesFor(cats: MediaCategory[], mediaType: MediaType | "both"): MediaCategory[] {
  return cats
    .filter((c) => c.is_active)
    .filter((c) =>
      mediaType === "both" ? true :
      mediaType === "video" ? c.applies_to_videos : c.applies_to_photos)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export function defaultCategoryId(cats: MediaCategory[], mediaType: MediaType | "both" = "both"): string | null {
  const list = categoriesFor(cats, mediaType);
  return list.find((c) => c.is_default)?.id ?? list[0]?.id ?? null;
}

export default function MediaCategorySelector({
  categories, value, onChange, mediaType = "both", className = "",
}: {
  categories: MediaCategory[];
  value: string | null;
  onChange: (id: string | null) => void;
  mediaType?: MediaType | "both";
  className?: string;
}) {
  const list = categoriesFor(categories, mediaType);
  return (
    <select
      className={`input ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {list.length === 0 && <option value="">– keine Kategorie –</option>}
      {list.map((c) => (
        <option key={c.id} value={c.id}>{c.name}{c.is_default ? " (Standard)" : ""}</option>
      ))}
    </select>
  );
}
