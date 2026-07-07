// ============================================================
// B4Y SuperAPP – Gruppierung der Nummernkreise (reine Logik, testbar)
// ------------------------------------------------------------
// Trennt Stammdaten/Kontakt-Kreise von Dokument-Kreisen und gruppiert die
// Dokument-Kreise nach der Kategorie ihrer Dokumentart (document_types.category),
// sortiert nach document_types.sort_order. Anzeige-Label für Dokument-Kreise
// kommt aus document_types.name (nicht aus veralteten number_ranges.label).
// Kreise ohne zugehörige Dokumentart landen in einer eigenen „prüfen"-Gruppe,
// damit nichts still verschwindet.
// ============================================================

/** Kontakt-/Stammdaten-Nummernkreise (keine Dokumentarten). */
export const STAMMDATEN_NUMBER_RANGE_TYPES = [
  "kunde",
  "lieferant",
  "subunternehmer",
  "ansprechpartner",
  "sonstige",
  "projekt",
];
export const STAMMDATEN_GROUP_TITLE = "Stammdaten / Kontakte";
export const ORPHAN_GROUP_TITLE = "Ohne Dokumentart (prüfen)";

type RangeLike = {
  id: string;
  doc_type: string | null;
  label: string | null;
  document_type_id?: string | null;
};
type DocTypeLike = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  sort_order: number | null;
};

export type NumberRangeGroup<R> = { title: string; rows: { range: R; label: string }[] };

/** Findet die Dokumentart eines Nummernkreises (per ID, sonst per Slug==doc_type). */
function docTypeForRange<R extends RangeLike>(
  range: R,
  byId: Map<string, DocTypeLike>,
  bySlug: Map<string, DocTypeLike>,
): DocTypeLike | null {
  if (range.document_type_id && byId.has(range.document_type_id)) return byId.get(range.document_type_id)!;
  const slug = (range.doc_type || "").toLowerCase();
  return bySlug.get(slug) ?? null;
}

export function groupNumberRanges<R extends RangeLike>(
  ranges: R[],
  docTypes: DocTypeLike[],
): NumberRangeGroup<R>[] {
  const byId = new Map(docTypes.map((d) => [d.id, d]));
  const bySlug = new Map(docTypes.map((d) => [d.slug.toLowerCase(), d]));

  const stamm: { range: R; label: string }[] = [];
  const orphans: { range: R; label: string }[] = [];
  const byCategory = new Map<string, { rows: { range: R; label: string; sort: number }[]; minSort: number }>();

  for (const r of ranges) {
    const key = (r.doc_type || "").toLowerCase();
    if (STAMMDATEN_NUMBER_RANGE_TYPES.includes(key)) {
      stamm.push({ range: r, label: r.label || key });
      continue;
    }
    const dt = docTypeForRange(r, byId, bySlug);
    if (!dt) {
      orphans.push({ range: r, label: r.label || key });
      continue;
    }
    const cat = dt.category || "Dokumente";
    const sort = dt.sort_order ?? 999;
    if (!byCategory.has(cat)) byCategory.set(cat, { rows: [], minSort: Infinity });
    const g = byCategory.get(cat)!;
    g.rows.push({ range: r, label: dt.name, sort });
    g.minSort = Math.min(g.minSort, sort);
  }

  // Stammdaten in fester, fachlicher Reihenfolge sortieren.
  stamm.sort(
    (a, b) =>
      STAMMDATEN_NUMBER_RANGE_TYPES.indexOf((a.range.doc_type || "").toLowerCase()) -
      STAMMDATEN_NUMBER_RANGE_TYPES.indexOf((b.range.doc_type || "").toLowerCase()),
  );

  const out: NumberRangeGroup<R>[] = [];
  if (stamm.length) out.push({ title: STAMMDATEN_GROUP_TITLE, rows: stamm });

  // Dokument-Kategorien nach kleinstem sort_order, innerhalb nach sort_order.
  const cats = Array.from(byCategory.entries()).sort((a, b) => a[1].minSort - b[1].minSort);
  for (const [cat, g] of cats) {
    g.rows.sort((a, b) => a.sort - b.sort);
    out.push({ title: cat, rows: g.rows.map(({ range, label }) => ({ range, label })) });
  }

  if (orphans.length) out.push({ title: ORPHAN_GROUP_TITLE, rows: orphans });
  return out;
}
