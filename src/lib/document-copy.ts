// ============================================================
// B4Y SuperAPP – Positionen aus bestehenden Dokumenten übernehmen (KOPIE)
// Reine Vorlagen-/Kopierfunktion für „Mehrere einfügen → Aus Dokument".
//
// WICHTIG: Das ist KEINE Dokumentkette. Es werden ausschließlich die JSONB-
// `items` des Quelldokuments gelesen und als NEUE, eigenständige Positionen
// ins Zieldokument kopiert. Es findet KEINE Konvertierung, Beauftragung,
// Verrechnung oder Statusänderung statt; das Quelldokument bleibt unverändert.
// Mandanten-/Rechte-/Projekttrennung wird durch die Supabase-RLS auf
// `documents_unified` und den Quelltabellen erzwungen (kein eigener Bypass).
// ============================================================
import { supabase } from "./supabase";
import { DocPosition, normalizePositions, emptyPosition, uid } from "./document-types";

export type CopyableDoc = {
  id: string;
  kind: string;            // offer | order | invoice | sub_order …
  doc_number: string | null;
  type_name: string | null;
  type_slug: string | null;
  status: string | null;
  status_norm: string | null;
  is_canceled: boolean | null;
  is_locked: boolean | null;
  project_id: string | null;
  project_number: string | null;
  project_title: string | null;
  customer_name: string | null;
  title: string | null;
  net: number | null;
  gross: number | null;
  last_change: string | null;
};

const COLS =
  "id,kind,doc_number,type_name,type_slug,status,status_norm,is_canceled,is_locked,project_id,project_number,project_title,customer_name,title,net,gross,last_change";

/** kind (documents_unified) → Quelltabelle mit JSONB-`items`. */
const KIND_TABLE: Record<string, string> = {
  offer: "offers",
  order: "orders",
  invoice: "invoices",
  sub_order: "sub_orders",
};

/**
 * Übernehmbare Dokumente laden. RLS liefert nur Dokumente des eigenen Mandanten
 * und auf die der Benutzer Zugriff hat. Optional auf ein Projekt eingeschränkt.
 */
export async function loadCopyableDocuments(opts: { projectId?: string | null; excludeId?: string | null } = {}): Promise<CopyableDoc[]> {
  let query = supabase.from("documents_unified").select(COLS).order("last_change", { ascending: false }).limit(300);
  if (opts.projectId) query = query.eq("project_id", opts.projectId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data as CopyableDoc[]) ?? [];
  if (opts.excludeId) rows = rows.filter((d) => d.id !== opts.excludeId);
  return rows;
}

/** Positionen eines Quelldokuments laden (JSONB items → normalisierte DocPositions). */
export async function loadDocumentPositions(kind: string, id: string): Promise<DocPosition[]> {
  const table = KIND_TABLE[kind];
  if (!table) return [];
  const { data, error } = await supabase.from(table).select("items").eq("id", id).maybeSingle();
  if (error) throw error;
  const items = (data as { items?: unknown } | null)?.items;
  const positions = normalizePositions(Array.isArray(items) ? items : []);
  if (positions.length > 0) return positions;

  // Fallback für Altbestand: Aufträge ohne JSONB-items haben relationale order_items.
  if (kind === "order") {
    const { data: oi } = await supabase.from("order_items").select("*").eq("order_id", id).order("sort_order");
    return ((oi as any[]) ?? []).map((i) => emptyPosition("free", {
      name: i.short_text ?? "", long_text: i.long_text ?? null,
      qty: Number(i.qty) || 1, unit: i.unit ?? "Stk",
      unit_price: Number(i.unit_price) || 0, discount_percent: Number(i.discount_percent) || 0,
      vat_rate: Number(i.vat_rate) || 20,
    }));
  }
  return positions;
}

/**
 * Ausgewählte (bereits geordnete) Positionen als NEUE Positionen kopieren.
 * - neue IDs (kein Konflikt mit Zielpositionen)
 * - Nummer/Zuordnung werden vom Builder neu berechnet (renumber)
 * - informativer Quellverweis (copied_from_*), KEIN Ketten-/Verrechnungsbezug
 * - withTitles=false → Titel-/Abschnittszeilen werden ausgelassen
 */
export function copyPositions(
  positions: DocPosition[],
  source: Pick<CopyableDoc, "id" | "doc_number" | "project_id">,
  opts: { withTitles: boolean },
): DocPosition[] {
  // Erst neue IDs vergeben und alt→neu merken, damit verknüpfte Bezüge (Regiematerial →
  // Regiestunde) korrekt auf die KOPIERTE Position zeigen statt ins Leere.
  const idMap = new Map<string, string>();
  const kept = positions.filter((p) => opts.withTitles || p.type !== "title");
  for (const p of kept) idMap.set(p.id, uid());

  return kept.map((p) => {
    const newId = idMap.get(p.id)!;
    // Regiematerial-Bezug remappen; ist die Bezugs-Regiestunde nicht mitkopiert,
    // Automatik abschalten (auf 'manual'), damit der Preis nicht still auf 0 fällt.
    let linked_regie_id = p.linked_regie_id ?? null;
    let regie_material_mode = p.regie_material_mode;
    if (p.is_regie_material && p.regie_material_mode === "percent") {
      const mapped = linked_regie_id ? idMap.get(linked_regie_id) : undefined;
      if (mapped) linked_regie_id = mapped;
      else { linked_regie_id = null; regie_material_mode = "manual"; }
    }
    return {
      ...p,
      id: newId,
      number: null,
      parent_title_id: null, // renumber() setzt Gliederung anhand der Reihenfolge neu
      linked_regie_id,
      regie_material_mode,
      copied_from_document_id: source.id,
      copied_from_document_number: source.doc_number ?? null,
      copied_from_position_id: p.id,
      copied_from_project_id: source.project_id ?? null,
    };
  });
}

/**
 * Mehrere bereits kopierte Positions-Listen (je Quelldokument, flach inkl. Titel-
 * zeilen) zu EINER Liste zusammenführen und dabei **gleichnamige Titel bündeln**:
 * Positionen aus Titeln mit identischem Namen (z. B. „GEMEINKOSTEN") landen unter
 * einem gemeinsamen Titel; Positionen ohne Titel bleiben in ihrer eigenen Gruppe.
 * Reihenfolge = erstes Auftreten je Titelname. Neue IDs/Quellhinweise sind bereits
 * von copyPositions gesetzt; renumber() im Builder vergibt Nummern/Gliederung neu.
 */
export function mergeCopiedByTitle(perDoc: DocPosition[][]): DocPosition[] {
  type Section = { title: DocPosition | null; items: DocPosition[] };
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const order: string[] = [];
  const map = new Map<string, Section>();
  const ensure = (name: string, title: DocPosition | null): Section => {
    let sec = map.get(name);
    if (!sec) { sec = { title, items: [] }; map.set(name, sec); order.push(name); }
    else if (!sec.title && title) sec.title = title;
    return sec;
  };
  for (const copied of perDoc) {
    let curName = "";        // "" = Gruppe ohne Titel (Positionen vor dem ersten Titel)
    let curTitle: DocPosition | null = null;
    for (const p of copied) {
      if (p.type === "title") { curName = norm(p.name); curTitle = p; ensure(curName, curTitle); }
      else ensure(curName, curTitle).items.push(p);
    }
  }
  const out: DocPosition[] = [];
  for (const name of order) {
    const sec = map.get(name)!;
    if (sec.title) out.push(sec.title);
    out.push(...sec.items);
  }
  return out;
}
