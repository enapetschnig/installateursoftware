// ============================================================
// B4Y SuperAPP – Kalkulationslogik (reine Funktionen)
//
// Arbeitskosten   = Minuten / 60 × interner Stundensatz
// Arbeitsverkauf  = Minuten / 60 × Verkaufssatz
// Materialkosten  = Menge × Einkaufspreis
// Materialverkauf = Menge × Verkaufspreis
// Gemeinkosten    = Prozent auf (Arbeits- + Materialkosten der Basis)
// ============================================================
import type { ComponentKind } from "./calc-types";

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

// Minimaler Input, den die Berechnung braucht (funktioniert für DB-Zeilen
// UND für eingefrorene Angebots-Snapshots gleichermaßen).
export interface CalcComponent {
  kind: ComponentKind;
  minutes?: number | null;
  quantity?: number | null;
  cost_rate?: number | null;
  sale_rate?: number | null;
  percent?: number | null;
}

export interface LineResult {
  cost: number;
  sale: number;
}

export interface CalcResult {
  lines: LineResult[]; // gleiche Reihenfolge wie Input
  baseCost: number; // direkte Kosten ohne Gemeinkosten
  baseSale: number; // direkter Verkauf ohne Gemeinkosten
  overheadCost: number; // Gemeinkosten (Komponenten + Service-Zuschlag)
  overheadSale: number;
  cost: number; // Selbstkosten gesamt
  sale: number; // Verkaufspreis gesamt
  contribution: number; // Deckungsbeitrag = Verkauf − direkte Kosten
  profit: number; // Gewinn = Verkauf − Selbstkosten
  marginPct: number; // Marge % = Gewinn / Verkauf × 100
}

/** Kosten/Verkauf einer einzelnen Nicht-Gemeinkosten-Komponente. */
function directLine(c: CalcComponent): LineResult {
  if (c.kind === "arbeitszeit") {
    const hours = n(c.minutes) / 60;
    return { cost: hours * n(c.cost_rate), sale: hours * n(c.sale_rate) };
  }
  // material, maschine, subunternehmer, individuell
  const qty = n(c.quantity);
  return { cost: qty * n(c.cost_rate), sale: qty * n(c.sale_rate) };
}

/**
 * Berechnet eine komplette Leistung aus ihren Bestandteilen.
 * @param components Bestandteile in Anzeige-Reihenfolge
 * @param overheadPercent Service-weiter Gemeinkosten-Zuschlag in %
 */
export function calcService(components: CalcComponent[], overheadPercent = 0): CalcResult {
  let baseCost = 0;
  let baseSale = 0;

  // 1. Durchlauf: direkte Kosten/Verkauf der Basis-Komponenten
  for (const c of components) {
    if (c.kind === "gemeinkosten") continue;
    const r = directLine(c);
    baseCost += r.cost;
    baseSale += r.sale;
  }

  // 2. Durchlauf: Zeilenergebnisse (Gemeinkosten anteilig auf Basis)
  let gkCost = 0;
  let gkSale = 0;
  const lines: LineResult[] = components.map((c) => {
    if (c.kind === "gemeinkosten") {
      const p = n(c.percent) / 100;
      const cost = baseCost * p;
      const sale = baseSale * p;
      gkCost += cost;
      gkSale += sale;
      return { cost, sale };
    }
    return directLine(c);
  });

  // Service-weiter Zuschlag zusätzlich zu expliziten Gemeinkosten-Zeilen
  const op = n(overheadPercent) / 100;
  const overheadCost = gkCost + baseCost * op;
  const overheadSale = gkSale + baseSale * op;

  const cost = baseCost + overheadCost;
  const sale = baseSale + overheadSale;
  const contribution = sale - baseCost;
  const profit = sale - cost;
  const marginPct = sale > 0 ? (profit / sale) * 100 : 0;

  return {
    lines,
    baseCost: round2(baseCost),
    baseSale: round2(baseSale),
    overheadCost: round2(overheadCost),
    overheadSale: round2(overheadSale),
    cost: round2(cost),
    sale: round2(sale),
    contribution: round2(contribution),
    profit: round2(profit),
    marginPct: round2(marginPct),
  };
}

/** Tonfarbe (für Badge) je nach Marge. */
export function marginTone(marginPct: number): "green" | "amber" | "red" {
  if (marginPct >= 25) return "green";
  if (marginPct >= 10) return "amber";
  return "red";
}

/** MwSt-Berechnung für Angebote/Belege. */
export function vatTotals(net: number, vatPercent: number) {
  const vat = round2(n(net) * (n(vatPercent) / 100));
  return { net: round2(n(net)), vat, gross: round2(n(net) + vat) };
}

export { round2 };

// ============================================================
// Leistungs-Kalkulation V2: EK je Bereich + Aufschlag → VK (manuell überschreibbar)
// Lohn = Min/60 × Satz · Material = Menge × EK · Pauschale (fix/%/...) · Sonstige
// ============================================================
export interface ServiceCalcInput {
  components: CalcComponent[]; // arbeitszeit (Lohn), material (Artikel), individuell (Sonstige)
  aufschlag_percent: number;
  vat_rate: number;
  vk_net_manual: number | null | undefined;
  material_mode: string;
  pauschale_type: string;
  pauschale_fix: number;
  pauschale_percent: number;
}

export interface ServiceCalcV2 {
  lohnTotal: number;
  materialArtikelTotal: number;
  pauschaleTotal: number;
  sonstigeTotal: number;
  ekTotal: number;
  aufschlagPercent: number;
  vkNetCalc: number;
  vkNetFinal: number;
  isManual: boolean;
  vkBrutto: number;
  db: number;       // Deckungsbeitrag / Gewinn = VK final − EK
  marginPct: number;
}

export function calcServiceV2(inp: ServiceCalcInput): ServiceCalcV2 {
  const mode = inp.material_mode || "artikel";
  const includesArtikel = mode === "artikel" || mode === "artikel_pauschale";
  const includesPauschale = mode === "pauschale_fix" || mode === "pauschale_prozent" || mode === "artikel_pauschale";

  let lohnTotal = 0, materialArtikelRaw = 0, sonstigeTotal = 0;
  for (const c of inp.components) {
    if (c.kind === "arbeitszeit") lohnTotal += (n(c.minutes) / 60) * n(c.cost_rate);
    else if (c.kind === "material") materialArtikelRaw += n(c.quantity) * n(c.cost_rate);
    else if (c.kind === "individuell") sonstigeTotal += (n(c.quantity) || 1) * n(c.cost_rate);
  }
  const materialArtikelTotal = includesArtikel ? materialArtikelRaw : 0;

  let pauschaleTotal = 0;
  if (includesPauschale) {
    const baseEk = lohnTotal + materialArtikelTotal + sonstigeTotal;
    const p = n(inp.pauschale_percent) / 100;
    switch (inp.pauschale_type) {
      case "fix": pauschaleTotal = n(inp.pauschale_fix); break;
      case "prozent_lohn": pauschaleTotal = lohnTotal * p; break;
      case "prozent_material": pauschaleTotal = materialArtikelTotal * p; break;
      case "prozent_ek": pauschaleTotal = baseEk * p; break;
      default: pauschaleTotal = 0;
    }
  }

  const ekTotal = lohnTotal + materialArtikelTotal + pauschaleTotal + sonstigeTotal;
  const aufschlagPercent = n(inp.aufschlag_percent);
  const vkNetCalc = ekTotal * (1 + aufschlagPercent / 100);
  const hasManual = inp.vk_net_manual !== null && inp.vk_net_manual !== undefined && !Number.isNaN(Number(inp.vk_net_manual));
  const vkNetFinal = hasManual ? n(inp.vk_net_manual) : vkNetCalc;
  const vkBrutto = vkNetFinal * (1 + n(inp.vat_rate) / 100);
  const db = vkNetFinal - ekTotal;
  const marginPct = vkNetFinal > 0 ? (db / vkNetFinal) * 100 : 0;

  return {
    lohnTotal: round2(lohnTotal),
    materialArtikelTotal: round2(materialArtikelTotal),
    pauschaleTotal: round2(pauschaleTotal),
    sonstigeTotal: round2(sonstigeTotal),
    ekTotal: round2(ekTotal),
    aufschlagPercent,
    vkNetCalc: round2(vkNetCalc),
    vkNetFinal: round2(vkNetFinal),
    isManual: hasManual,
    vkBrutto: round2(vkBrutto),
    db: round2(db),
    marginPct: round2(marginPct),
  };
}
