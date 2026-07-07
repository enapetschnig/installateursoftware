// ============================================================
// B4Y SuperAPP – Stammdaten für die Dokument-Seitenleiste
// Lädt Artikel, Leistungen (inkl. Kalkulation) und Textbausteine
// und erzeugt daraus DocPosition-Objekte zum Einfügen.
// ============================================================
import { supabase } from "./supabase";
import { Article, Service, ServiceComponent, HourlyRate, Trade } from "./calc-types";
import { calcServiceV2, CalcComponent } from "./calc";
import { FrozenSnapshot } from "./offer-types";
import { DocPosition, emptyPosition } from "./document-types";
import { sortAlphaStrings, sortByNumberThenName } from "./sortOptions";
import { isReservedSpecialServiceNumber } from "./service-numbers";

export type SidebarArticle = Article & { _kind: "article" };
export type SidebarService = Service & {
  _kind: "service";
  _sale: number; _cost: number; _margin: number; _laborMin: number; _material: number;
  _components: ServiceComponent[];
};
export type TextBlock = {
  id: string;
  title: string;
  content: string;
  type: "text" | "titel";
  category: string;
  level: number;
  sort_order: number;
  usage_count: number;
  active: boolean;
};

/** Stundensatz für die Regiestunden-Auswahl im Editor (mit Gewerk-Name). */
export type SidebarHourlyRate = HourlyRate & { _tradeName: string };

export type SidebarData = {
  articles: SidebarArticle[];
  services: SidebarService[];          // alle aktiven Leistungen (Stamm)
  hourlyRates: SidebarHourlyRate[];    // aktive Stundensätze (für „Regiestunde einfügen")
  texts: TextBlock[];      // type = 'text'
  titles: TextBlock[];     // type = 'titel'
  suppliers: string[];
  tradeNames: Record<string, string>;
  trades: Trade[];          // vollständige Gewerke (für zentrale Anlegemasken)
  unitCodes: string[];      // zentrale Einheiten (für zentrale Anlegemasken)
  categories: string[];
};

export async function loadSidebarData(): Promise<SidebarData> {
  const [a, s, sc, t, tr, hr, un] = await Promise.all([
    supabase.from("articles").select("*").eq("active", true).order("usage_count", { ascending: false }),
    supabase.from("services").select("*").eq("active", true).order("name"),
    supabase.from("service_components").select("*"),
    supabase.from("text_blocks").select("*").eq("active", true).order("sort_order"),
    supabase.from("trades").select("*").order("sort_order"),
    supabase.from("hourly_rates").select("*").eq("active", true).order("label"),
    supabase.from("units").select("code").eq("active", true).order("sort_order"),
  ]);

  const comps = (sc.data as ServiceComponent[]) ?? [];
  const trades = (tr.data as Trade[]) ?? [];
  const unitCodes = ((un.data as { code: string }[]) ?? []).map((x) => x.code).filter(Boolean);
  const tradeNames: Record<string, string> = {};
  for (const row of trades) tradeNames[row.id] = row.name;

  // Nach Artikelnummer natürlich sortieren (nummerierte zuerst, dann nach Name) –
  // zentral, damit Sidebar UND „Mehrere einfügen" dieselbe Reihenfolge nutzen.
  const articlesRaw: SidebarArticle[] = ((a.data as Article[]) ?? []).map((x) => ({ ...x, _kind: "article" }));
  const articles = sortByNumberThenName(articlesRaw, "article_number", "name");

  const allServices: SidebarService[] = ((s.data as Service[]) ?? []).map((svc) => {
    const own = comps.filter((c) => c.service_id === svc.id);
    const r = calcServiceV2({
      components: own as CalcComponent[],
      aufschlag_percent: svc.aufschlag_percent, vat_rate: svc.vat_rate,
      vk_net_manual: svc.vk_net_manual, material_mode: svc.material_mode,
      pauschale_type: svc.pauschale_type, pauschale_fix: svc.pauschale_fix,
      pauschale_percent: svc.pauschale_percent,
    });
    const laborMin = own.filter((c) => c.kind === "arbeitszeit").reduce((m, c) => m + (Number(c.minutes) || 0), 0);
    return {
      ...svc, _kind: "service",
      _sale: r.vkNetFinal, _cost: r.ekTotal, _margin: r.marginPct,
      _laborMin: laborMin, _material: r.materialArtikelTotal, _components: own,
    };
  });

  // Variable Position / Regiestunde / Regiematerial werden NICHT mehr als Stammleistungen
  // geführt, sondern direkt im Editor eingefügt (Migration 0060). Importierte Katalog-
  // Leistungen im reservierten Spezialbereich XX-980–999 (z. B. aus dem Hero-Import)
  // werden daher aus der normalen Leistungsauswahl ausgeblendet, damit sie die saubere
  // dokumentlokale Regie-/Variable-Logik nicht doppeln/umgehen. Gefiltert wird über das
  // Nummernschema (siehe service-numbers.ts), NICHT über is_variable_template (im Import
  // inkonsistent gesetzt – echte Leistungen wie „Mulde" XX-910 bleiben sichtbar).
  // Nach Leistungsnummer natürlich sortieren (nummerierte zuerst, dann nach Name).
  const services = sortByNumberThenName(
    allServices.filter((s) => !isReservedSpecialServiceNumber(s.service_number)),
    "service_number", "name",
  );

  const hourlyRates: SidebarHourlyRate[] = ((hr.data as HourlyRate[]) ?? []).map((r) => ({
    ...r, _tradeName: (r.trade_id && tradeNames[r.trade_id]) || "Allgemein",
  }));

  const allTexts = (t.data as TextBlock[]) ?? [];
  const suppliers = sortAlphaStrings(Array.from(new Set(articles.map((x) => x.supplier).filter(Boolean) as string[])));
  const categories = sortAlphaStrings(Array.from(new Set([
    ...articles.map((x) => x.category).filter(Boolean) as string[],
    ...services.map((x) => x.category).filter(Boolean) as string[],
  ])));

  return {
    articles, services, hourlyRates,
    texts: allTexts.filter((x) => x.type === "text"),
    titles: allTexts.filter((x) => x.type === "titel"),
    suppliers, tradeNames, trades, unitCodes, categories,
  };
}

// ------------------------------------------------------------
// Positions-Erzeuger
// ------------------------------------------------------------
export function makeArticlePosition(a: SidebarArticle): DocPosition {
  return emptyPosition("article", {
    article_id: a.id,
    name: a.name,
    description: a.category ?? a.description ?? null,
    unit: a.unit ?? "Stk",
    qty: 1,
    unit_price: Number(a.sale_price) || 0,
    unit_cost: Number(a.purchase_price) || 0,
    material_cost: Number(a.purchase_price) || 0,
    vat_rate: Number(a.vat_rate) || 20,
    labor_minutes: 0,
    image_url: a.image_url ?? null,
  });
}

export function makeServicePosition(s: SidebarService): DocPosition {
  const snapshot: FrozenSnapshot = {
    frozen_at: new Date().toISOString(),
    overhead_percent: 0,
    components: s._components.map((c) => ({
      kind: c.kind, label: c.label ?? "", unit: c.unit, minutes: Number(c.minutes) || 0,
      quantity: Number(c.quantity) || 0, cost_rate: Number(c.cost_rate) || 0,
      sale_rate: Number(c.sale_rate) || 0, percent: Number(c.percent) || 0,
    })),
    totals: { sale: s._sale, cost: s._cost, margin: s._margin },
  };
  return emptyPosition("service", {
    service_id: s.id,
    name: s.name,
    description: s.short_text ?? null,
    long_text: s.long_text ?? null,
    unit: s.unit ?? "Stk",
    qty: 1,
    unit_price: s._sale,
    unit_cost: s._cost,
    material_cost: s._material,
    labor_minutes: s._laborMin,
    vat_rate: Number(s.vat_rate) || 20,
    snapshot,
    image_url: s.image_url ?? null,
  });
}

/**
 * Variable Position: leere, frei anpassbare Leistungsposition (kein Preis-Sync
 * aus dem Stamm, service_id=null, is_variable=true). Wird direkt im Editor
 * eingefügt; Bezeichnung/Menge/Einheit/Preis frei. Aus ihr kann später eine
 * echte Stammleistung gespeichert werden (saveAsMaster).
 */
export function makeVariablePosition(vatRate = 20): DocPosition {
  return emptyPosition("service", {
    service_id: null,
    is_variable: true,
    name: "",
    description: null,
    unit: "Einheit",
    qty: 1,
    unit_price: 0,
    unit_cost: 0,
    vat_rate: vatRate,
  });
}

/**
 * Regiestunde: Position aus einem gewählten Stundensatz. Bepreist mit dem
 * Verkaufs-Stundensatz (sale_rate), Selbstkosten = internal_rate. Menge =
 * geleistete Stunden (Default 1). is_regie_hour markiert sie, damit im Editor
 * „Material hinzufügen" angeboten werden kann und das PDF sie sauber ausweist.
 */
export function makeRegieHourPosition(rate: SidebarHourlyRate, vatRate = 20): DocPosition {
  return emptyPosition("service", {
    service_id: null,
    is_regie_hour: true,
    name: `Regiestunde – ${rate.label}`,
    description: rate._tradeName || null,
    unit: "Std",
    qty: 1,
    unit_price: Number(rate.sale_rate) || 0,
    unit_cost: Number(rate.internal_rate) || 0,
    vat_rate: vatRate,
  });
}

/**
 * Regiematerial: Materialzeile zu Regiestunden. Modus steuert die Berechnung:
 *   manual  – Menge/Preis frei eingeben
 *   percent – Preis = % des Nettobetrags der verknüpften Regiestunde (Auto-Recalc)
 *   fixed   – fixer Pauschalbetrag (qty=1)
 * linkedRegieId verknüpft (bei percent) die zugehörige Regiestundenposition.
 */
export function makeRegieMaterialPosition(opts: {
  mode: "manual" | "percent" | "fixed";
  percent?: number;
  linkedRegieId?: string | null;
  vatRate?: number;
}): DocPosition {
  return emptyPosition("service", {
    service_id: null,
    is_regie_material: true,
    regie_material_mode: opts.mode,
    regie_material_percent: opts.mode === "percent" ? (Number(opts.percent) || 0) : 0,
    linked_regie_id: opts.mode === "percent" ? (opts.linkedRegieId ?? null) : null,
    name: "Regiematerial",
    unit: opts.mode === "fixed" ? "pauschal" : "Einheit",
    qty: 1,
    unit_price: 0,
    unit_cost: 0,
    vat_rate: opts.vatRate ?? 20,
  });
}

export function makeTextPosition(t: TextBlock): DocPosition {
  return emptyPosition("text", {
    text_block_id: t.id,
    name: t.title,
    content: t.content,
  });
}

export function makeTitlePosition(t: TextBlock): DocPosition {
  return emptyPosition("title", {
    title_id: t.id,
    text_block_id: t.id,
    name: t.title,
    level: t.level || 1,
  });
}
