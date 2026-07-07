// ============================================================
// B4Y SuperAPP – Gemeinsames Dokument-Positionsmodell
// Wird von Angeboten, Aufträgen, Rechnungen, Nachträgen,
// Regieberichten und Leistungsverzeichnissen verwendet.
// Speicherung als JSONB (offers.items / orders.items …).
// ============================================================
import { FrozenSnapshot } from "./offer-types";

export type DocPositionType = "article" | "service" | "text" | "title" | "free";

/** Berechnungsart einer Regiematerial-Position. */
export type RegieMaterialMode = "none" | "manual" | "percent" | "fixed";

/** Eine Position im Dokument. Artikel/Leistung/Text/Titel/frei. */
export type DocPosition = {
  id: string;
  type: DocPositionType;

  // Herkunft aus Stammdaten (für „Preise aktualisieren")
  article_id: string | null;
  service_id: string | null;
  text_block_id: string | null;
  title_id: string | null;

  // Nummerierung & Gliederung
  number: string | null;        // automatisch berechnet
  parent_title_id: string | null;
  level: number;                // Titel-Ebene (1..3)

  // Inhalt
  name: string;                 // Bezeichnung / Titeltext
  description: string | null;   // Kurzbeschreibung
  long_text: string | null;     // Langtext (Leistung)
  content: string | null;       // Inhalt eines Textbausteins

  // Kaufmännisch (Artikel/Leistung/frei)
  qty: number;
  unit: string;
  unit_price: number;           // VK netto je Einheit
  unit_cost: number;            // EK/Selbstkosten je Einheit (Marge)
  vat_rate: number;
  discount_percent: number;
  material_cost: number;        // EK Material je Einheit (für Übersicht)
  labor_minutes: number;        // Arbeitsminuten je Einheit (für Übersicht)
  snapshot: FrozenSnapshot | null;

  // Dokumentlokaler Foto-Snapshot der Position (volle Storage-URL/Pfad). Beim Einsetzen
  // aus dem Stamm übernommen (Leistung→service-images, Artikel→article-images); ein
  // dokumentlokaler Upload/Ersatz liegt im mandantengetrennten Bucket document-images.
  // Ändert NIE den Stamm. Anzeige im PDF nur bei show_service_images/show_article_images.
  image_url?: string | null;

  // Variable Position: frei im Dokument anpassbar, KEIN Preis-Sync aus dem Stamm
  // (service_id bleibt null). Wird direkt im Editor eingefügt.
  is_variable?: boolean;

  // Regiestunden / Regiematerial (direkt im Editor eingefügt, nicht als Stammleistung)
  is_regie_hour?: boolean;                 // Position ist eine Regiestunde
  is_regie_material?: boolean;             // Position ist Regiematerial zu Regiestunden
  regie_material_mode?: RegieMaterialMode; // none | manual | percent | fixed
  regie_material_percent?: number;         // bei 'percent': % der verknüpften Regiestunde
  linked_regie_id?: string | null;         // Bezug auf die Regiestundenposition (DocPosition.id)
  manually_overridden?: boolean;           // Automatik (percent) bewusst überschrieben

  // Stammpreis-Schutz: EP wurde im Dokument manuell geändert → „Stammpreise" überschreibt
  // diese Position nicht still (nur nach Bestätigung). Migr.-frei (Teil des JSONB-Items).
  price_overridden?: boolean;
  // Aufschlag-Guard je Position: Standardaufschlag bereits in unit_price eingerechnet?
  // Verhindert Doppelanwendung bei erneutem Speichern/Konvertieren.
  surcharge_baked?: boolean;

  // Informativer Quellverweis bei aus einem anderen Dokument KOPIERTEN Positionen.
  // Rein informativ – KEIN Teil der fachlichen Dokumentkette (keine Konvertierung/Verrechnung).
  copied_from_document_id?: string | null;
  copied_from_document_number?: string | null;
  copied_from_position_id?: string | null;
  copied_from_project_id?: string | null;
};

export const isCommercial = (t: DocPositionType): boolean =>
  t === "article" || t === "service" || t === "free";

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Leere Position mit sinnvollen Defaults. */
export function emptyPosition(type: DocPositionType, patch: Partial<DocPosition> = {}): DocPosition {
  return {
    id: uid(),
    type,
    article_id: null,
    service_id: null,
    text_block_id: null,
    title_id: null,
    number: null,
    parent_title_id: null,
    level: 1,
    name: "",
    description: null,
    long_text: null,
    content: null,
    qty: 1,
    unit: "Stk",
    unit_price: 0,
    unit_cost: 0,
    vat_rate: 20,
    discount_percent: 0,
    material_cost: 0,
    labor_minutes: 0,
    snapshot: null,
    image_url: null,
    is_variable: false,
    is_regie_hour: false,
    is_regie_material: false,
    regie_material_mode: "none",
    regie_material_percent: 0,
    linked_regie_id: null,
    manually_overridden: false,
    price_overridden: false,
    surcharge_baked: false,
    ...patch,
  };
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Nettobetrag einer Position (mit Rabatt). */
export function lineNet(p: DocPosition): number {
  if (!isCommercial(p.type)) return 0;
  const gross = (Number(p.qty) || 0) * (Number(p.unit_price) || 0);
  return round2(gross * (1 - (Number(p.discount_percent) || 0) / 100));
}

/** Selbstkosten einer Position. */
export function lineCost(p: DocPosition): number {
  if (!isCommercial(p.type)) return 0;
  return round2((Number(p.qty) || 0) * (Number(p.unit_cost) || 0));
}

/**
 * Prozentuelles Regiematerial automatisch nachrechnen.
 * Greift NUR bei Positionen mit is_regie_material + mode 'percent' + nicht manuell
 * überschrieben. Setzt qty=1 und unit_price = X % des Nettobetrags der verknüpften
 * Regiestundenposition. Normale Positionen/Artikel bleiben unangetastet.
 * Wird bei jeder Positionsänderung im Builder ausgeführt → Auto-Aktualisierung.
 */
export function recalcRegieMaterial(positions: DocPosition[]): DocPosition[] {
  const byId = new Map(positions.map((p) => [p.id, p]));
  return positions.map((p) => {
    if (!p.is_regie_material || p.regie_material_mode !== "percent" || p.manually_overridden) return p;
    const base = p.linked_regie_id ? byId.get(p.linked_regie_id) : undefined;
    const baseNet = base ? lineNet(base) : 0;
    const pct = Number(p.regie_material_percent) || 0;
    const price = round2(baseNet * pct / 100);
    if (p.qty === 1 && (Number(p.discount_percent) || 0) === 0 && p.unit_price === price) return p;
    return { ...p, qty: 1, discount_percent: 0, unit_price: price };
  });
}

// ------------------------------------------------------------
// Automatische Positionsnummerierung
//   Titel        → 1, 2, 3 …  (Abschnittsnummer)
//   Position     → unter Titel: "1.01", "1.02"; sonst "01", "02"
//   Textbaustein → keine Nummer
// Setzt zugleich parent_title_id & number neu.
// ------------------------------------------------------------
export function renumber(positions: DocPosition[]): DocPosition[] {
  let section = 0;
  let posInSection = 0;
  let currentTitleId: string | null = null;
  let currentSectionNo = "";

  return positions.map((p) => {
    if (p.type === "title") {
      section += 1;
      posInSection = 0;
      currentTitleId = p.id;
      currentSectionNo = String(section);
      return { ...p, number: currentSectionNo, parent_title_id: null };
    }
    if (p.type === "text") {
      return { ...p, number: null, parent_title_id: currentTitleId };
    }
    // Artikel / Leistung / frei
    posInSection += 1;
    const number = currentSectionNo
      ? `${currentSectionNo}.${String(posInSection).padStart(2, "0")}`
      : String(posInSection).padStart(2, "0");
    return { ...p, number, parent_title_id: currentTitleId };
  });
}

// ------------------------------------------------------------
// Gliederung (anklickbare Titelliste)
// ------------------------------------------------------------
export type OutlineEntry = { id: string; number: string; title: string; level: number };

export function buildOutline(positions: DocPosition[]): OutlineEntry[] {
  return positions
    .filter((p) => p.type === "title")
    .map((p) => ({ id: p.id, number: p.number ?? "", title: p.name || "Titel", level: p.level || 1 }));
}

// ------------------------------------------------------------
// Angebots-/Dokumentübersicht
// ------------------------------------------------------------
export type DocSummary = {
  countPositions: number;
  countArticles: number;
  countServices: number;
  materialCost: number;   // EK Material
  laborMinutes: number;   // Arbeitszeit gesamt (Minuten)
  laborHours: number;
  subtotalNet: number;       // Zwischensumme netto VOR Dokument-Nachlass
  discountPercent: number;   // Dokument-Standardnachlass in %
  discountAmount: number;    // Nachlass-Betrag (netto)
  net: number;            // Gesamt netto NACH Nachlass
  vat: number;
  gross: number;          // Gesamt brutto
  cost: number;           // Selbstkosten gesamt
  profit: number;         // Ertrag
  marginPct: number;
  hourlyYield: number;    // Ertrag je Arbeitsstunde
};

/**
 * @param vatOverride  Wenn gesetzt (z.B. §19 = 0), wird dieser MwSt-Satz
 *                     auf den Gesamtnetto angewandt statt der Positionssätze.
 */
export function computeSummary(positions: DocPosition[], vatOverride?: number | null, documentDiscountPercent?: number | null): DocSummary {
  let countPositions = 0, countArticles = 0, countServices = 0;
  let materialCost = 0, laborMinutes = 0, subtotal = 0, cost = 0, vatFromLines = 0;

  for (const p of positions) {
    if (!isCommercial(p.type)) continue;
    countPositions += 1;
    if (p.type === "article") countArticles += 1;
    if (p.type === "service") countServices += 1;
    const qty = Number(p.qty) || 0;
    const n = lineNet(p);
    subtotal += n;
    cost += lineCost(p);
    materialCost += qty * (Number(p.material_cost) || 0);
    laborMinutes += qty * (Number(p.labor_minutes) || 0);
    if (vatOverride === null || vatOverride === undefined) {
      vatFromLines += n * ((Number(p.vat_rate) || 0) / 100);
    }
  }

  // Dokument-Standardnachlass (Rabattzeile): reduziert das Netto vor der MwSt.
  // MwSt sinkt proportional mit; Geldbeträge konsistent gerundet.
  const subtotalNet = round2(subtotal);
  const d = Math.max(0, Number(documentDiscountPercent) || 0);
  const discountAmount = round2(subtotalNet * d / 100);
  const net = round2(subtotalNet - discountAmount);
  const factor = d > 0 ? (1 - d / 100) : 1;
  cost = round2(cost);
  const vat = round2(vatOverride !== null && vatOverride !== undefined ? net * (vatOverride / 100) : vatFromLines * factor);
  const gross = round2(net + vat);
  const profit = round2(net - cost);
  const marginPct = net > 0 ? Math.round((profit / net) * 1000) / 10 : 0;
  const laborHours = Math.round((laborMinutes / 60) * 100) / 100;
  const hourlyYield = laborHours > 0 ? round2(profit / laborHours) : 0;

  return {
    countPositions, countArticles, countServices,
    materialCost: round2(materialCost), laborMinutes, laborHours,
    subtotalNet, discountPercent: d, discountAmount,
    net, vat, gross, cost, profit, marginPct, hourlyYield,
  };
}

// ------------------------------------------------------------
// Migration alter Angebots-Positionen (OfferLine) → DocPosition
// Alte items hatten type "service" | "free" ohne Artikel/Text/Titel.
// ------------------------------------------------------------
// ------------------------------------------------------------
// Standardaufschlag (intern/unsichtbar) in Einzelpreise einrechnen
// ------------------------------------------------------------
/**
 * Rechnet einen kundenspezifischen Standardaufschlag EINMALIG in die Einzelpreise
 * der Positionen ein (im PDF nicht sichtbar – nur höhere EP). Guard je Position
 * (`surcharge_baked`) verhindert Doppelanwendung; manuell geänderte Preise
 * (`price_overridden`) sowie Titel/Text/Regie-Positionen bleiben unangetastet.
 * Gibt unverändertes Array zurück, wenn kein Aufschlag (>0) vorliegt.
 */
export function applySurchargeToPositions(positions: DocPosition[], surchargePercent: number | null | undefined): DocPosition[] {
  const pct = Number(surchargePercent) || 0;
  if (pct <= 0) return positions;
  const factor = 1 + pct / 100;
  return positions.map((p) => {
    if (!isCommercial(p.type)) return p;          // Titel/Text nie
    if (p.is_regie_hour || p.is_regie_material) return p; // Regie nicht aufschlagen
    if (p.surcharge_baked) return p;              // schon eingerechnet
    if (p.price_overridden) return p;             // manuell gesetzten Preis nicht still ändern
    return { ...p, unit_price: round2((Number(p.unit_price) || 0) * factor), surcharge_baked: true };
  });
}

export function normalizePositions(raw: unknown): DocPosition[] {
  if (!Array.isArray(raw)) return [];
  const out = raw.map((r: any): DocPosition => {
    const base = emptyPosition((r?.type as DocPositionType) ?? "free");
    return {
      ...base,
      id: r?.id ?? base.id,
      type: (r?.type as DocPositionType) ?? "free",
      article_id: r?.article_id ?? null,
      service_id: r?.service_id ?? null,
      text_block_id: r?.text_block_id ?? null,
      title_id: r?.title_id ?? null,
      number: r?.number ?? null,
      parent_title_id: r?.parent_title_id ?? null,
      level: Number(r?.level) || 1,
      name: r?.name ?? "",
      description: r?.description ?? null,
      long_text: r?.long_text ?? null,
      content: r?.content ?? null,
      qty: Number(r?.qty ?? 1),
      unit: r?.unit ?? "Stk",
      unit_price: Number(r?.unit_price ?? 0),
      unit_cost: Number(r?.unit_cost ?? 0),
      vat_rate: Number(r?.vat_rate ?? 20),
      discount_percent: Number(r?.discount_percent ?? 0),
      material_cost: Number(r?.material_cost ?? 0),
      labor_minutes: Number(r?.labor_minutes ?? 0),
      snapshot: r?.snapshot ?? null,
      image_url: r?.image_url ?? null,
      is_variable: r?.is_variable ?? false,
      is_regie_hour: r?.is_regie_hour ?? false,
      is_regie_material: r?.is_regie_material ?? false,
      regie_material_mode: r?.regie_material_mode ?? "none",
      regie_material_percent: Number(r?.regie_material_percent ?? 0),
      linked_regie_id: r?.linked_regie_id ?? null,
      manually_overridden: r?.manually_overridden ?? false,
      price_overridden: r?.price_overridden ?? false,
      surcharge_baked: r?.surcharge_baked ?? false,
      copied_from_document_id: r?.copied_from_document_id ?? null,
      copied_from_document_number: r?.copied_from_document_number ?? null,
      copied_from_position_id: r?.copied_from_position_id ?? null,
      copied_from_project_id: r?.copied_from_project_id ?? null,
    };
  });
  return renumber(out);
}
