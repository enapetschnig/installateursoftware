// ============================================================
// B4Y SuperAPP – Kalkulationsmodul: Typen + Zod-Validierung
// ============================================================
import { z } from "zod";

// ---------- Konstanten ----------
export const COMPONENT_KINDS = [
  "arbeitszeit",
  "material",
  "maschine",
  "subunternehmer",
  "gemeinkosten",
  "individuell",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const KIND_LABELS: Record<ComponentKind, string> = {
  arbeitszeit: "Arbeitszeit",
  material: "Material",
  maschine: "Maschine",
  subunternehmer: "Subunternehmer",
  gemeinkosten: "Gemeinkosten",
  individuell: "Individuell",
};

export const UNITS = ["Stk", "h", "m", "m²", "m³", "lfm", "kg", "t", "l", "pauschal", "Satz"] as const;
export const ARTICLE_UNITS = ["Stk", "m", "m²", "m³", "lfm", "kg", "Std", "Pauschale"] as const;
export const VAT_RATES = [20, 13, 10, 0] as const;

// Leistungsnummer-Helfer: Gewerknummer = 2-stellige Gewerk-Sortiernummer
export const gewerkNo = (sortOrder?: number | null): string | null =>
  sortOrder && sortOrder > 0 ? String(sortOrder).padStart(2, "0") : null;
export const isValidPosition = (p: string): boolean => /^\d{3}$/.test(p) && p !== "000";
export function suggestPosition(existing: string[]): string {
  const nums = existing.map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  const next = max === 0 ? 10 : (Math.floor(max / 10) + 1) * 10;
  return String(Math.min(next, 999)).padStart(3, "0");
}

export const MATERIAL_MODES: { value: MaterialMode; label: string }[] = [
  { value: "kein", label: "Kein Material" },
  { value: "artikel", label: "Nur Artikel aus Artikelstamm" },
  { value: "pauschale_fix", label: "Nur Materialpauschale (fix)" },
  { value: "pauschale_prozent", label: "Nur Materialpauschale (prozentuell)" },
  { value: "artikel_pauschale", label: "Artikel + Materialpauschale" },
];

export const PAUSCHALE_TYPES: { value: PauschaleType; label: string }[] = [
  { value: "kein", label: "Kein Material" },
  { value: "fix", label: "Fixbetrag netto je Einheit" },
  { value: "prozent_lohn", label: "Prozent auf Lohnkosten" },
  { value: "prozent_material", label: "Prozent auf Materialkosten" },
  { value: "prozent_ek", label: "Prozent auf EK gesamt" },
];

// Standard-Umsatzsteuersatz Österreich
export const DEFAULT_VAT = 20;

// ---------- DB-Zeilen-Typen ----------
export type Unit = {
  id: string;
  name: string;
  code: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Trade = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type HourlyRate = {
  id: string;
  trade_id: string | null;
  label: string;
  internal_rate: number;
  sale_rate: number;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type Article = {
  id: string;
  article_number: string | null;
  positions_nummer: string | null;
  trade_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  purchase_price: number;   // EK netto
  sale_price: number;       // VK netto
  list_price: number;       // Listenpreis netto
  vat_rate: number;         // MwSt %
  supplier: string | null;
  supplier_email: string | null;
  image_url: string | null;
  calculation_text: string | null;  // Berechnungs-/Staffelpreis-Text (Migr. 0128, analog services)
  is_stock: boolean;
  active: boolean;
  usage_count?: number;
  created_at: string;
  updated_at: string;
};

export type MaterialMode = "kein" | "artikel" | "pauschale_fix" | "pauschale_prozent" | "artikel_pauschale";
export type PauschaleType = "kein" | "fix" | "prozent_lohn" | "prozent_material" | "prozent_ek";

export type Service = {
  id: string;
  service_number: string | null;
  positions_nummer: string | null;
  name: string;
  internal_name: string | null;
  short_text: string | null;
  long_text: string | null;
  calculation_text: string | null;   // Berechnungs-/Staffelpreis-Text (Migr. 0096)
  image_url: string | null;          // Leistungsbild im privaten Storage (Migr. 0096)
  trade_id: string | null;
  category: string | null;
  unit: string | null;
  vat_rate: number;
  internal_note: string | null;
  sort_order: number;
  overhead_percent: number;
  aufschlag_percent: number;
  vk_net_manual: number | null;
  material_mode: MaterialMode;
  pauschale_active: boolean;
  pauschale_type: PauschaleType;
  pauschale_fix: number;
  pauschale_percent: number;
  active: boolean;
  is_variable_template?: boolean;       // Vorlage „Variable Position – <Gewerk>" (frei im Dokument anpassbar)
  is_regie_material_template?: boolean; // „Material Regie – <Gewerk>" (frei anpassbar wie variable Position)
  is_regie_hour_template?: boolean;     // „Regiestunde – <Satz>" (nutzt Stundensatz, normale priced Leistung)
  system_generated?: boolean;           // automatisch je Gewerk/Stundensatz erzeugt
  source_hourly_rate_id?: string | null;
  usage_count?: number;
  created_at: string;
  updated_at: string;
};

export type ServiceComponent = {
  id: string;
  service_id: string;
  kind: ComponentKind;
  sort_order: number;
  label: string | null;
  hourly_rate_id: string | null;
  article_id: string | null;
  minutes: number;
  quantity: number;
  unit: string | null;
  cost_rate: number;
  sale_rate: number;
  percent: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

// ---------- Zod-Schemas (Formular-Validierung) ----------
const num = z.coerce.number().finite();
const numNonNeg = num.min(0, "Wert darf nicht negativ sein");

export const tradeSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung erforderlich"),
  code: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  color: z.string().trim().optional().nullable(),
  sort_order: z.coerce.number().int().optional().default(0),
  active: z.boolean().optional().default(true),
});
export type TradeInput = z.infer<typeof tradeSchema>;

export const unitSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung erforderlich"),
  code: z.string().trim().min(1, "Kurzbezeichnung erforderlich"),
  sort_order: z.coerce.number().int().optional().default(0),
  active: z.boolean().optional().default(true),
});
export type UnitInput = z.infer<typeof unitSchema>;

export const hourlyRateSchema = z
  .object({
    trade_id: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1, "Bezeichnung erforderlich"),
    internal_rate: numNonNeg,
    sale_rate: numNonNeg,
    valid_from: z.string().trim().optional().nullable(),
    valid_to: z.string().trim().optional().nullable(),
    active: z.boolean().optional().default(true),
    note: z.string().trim().optional().nullable(),
  })
  .refine(
    (v) => !v.valid_from || !v.valid_to || v.valid_from <= v.valid_to,
    { message: "\u201egültig bis\u201c darf nicht vor \u201egültig ab\u201c liegen", path: ["valid_to"] }
  );
export type HourlyRateInput = z.infer<typeof hourlyRateSchema>;

export const articleSchema = z.object({
  article_number: z.string().trim().min(1, "Artikelnummer erforderlich"),
  positions_nummer: z.string().trim().regex(/^\d{3}$/, "Positionsnummer muss dreistellig sein").optional().nullable(),
  trade_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Artikelname erforderlich"),
  description: z.string().trim().optional().nullable(),
  category: z.string().trim().optional().nullable(),
  unit: z.string().trim().optional().nullable(),
  purchase_price: numNonNeg,
  sale_price: numNonNeg,
  list_price: numNonNeg,
  vat_rate: z.coerce.number().min(0).max(100).default(20),
  supplier: z.string().trim().optional().nullable(),
  supplier_email: z.string().trim().optional().nullable(),
  image_url: z.string().trim().optional().nullable(),
  calculation_text: z.string().trim().optional().nullable(),
  is_stock: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
});
export type ArticleInput = z.infer<typeof articleSchema>;

export const serviceSchema = z.object({
  service_number: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1, "Bezeichnung erforderlich"),
  internal_name: z.string().trim().optional().nullable(),
  short_text: z.string().trim().optional().nullable(),
  long_text: z.string().trim().optional().nullable(),
  calculation_text: z.string().trim().optional().nullable(),
  image_url: z.string().trim().optional().nullable(),
  trade_id: z.string().uuid().nullable().optional(),
  category: z.string().trim().optional().nullable(),
  unit: z.string().trim().optional().nullable(),
  vat_rate: z.coerce.number().min(0).max(100).default(20),
  internal_note: z.string().trim().optional().nullable(),
  sort_order: z.coerce.number().int().optional().default(0),
  aufschlag_percent: z.coerce.number().min(0).max(100000).optional().default(0),
  vk_net_manual: z.coerce.number().min(0).nullable().optional(),
  material_mode: z.enum(["kein","artikel","pauschale_fix","pauschale_prozent","artikel_pauschale"]).optional().default("artikel"),
  pauschale_active: z.boolean().optional().default(false),
  pauschale_type: z.enum(["kein","fix","prozent_lohn","prozent_material","prozent_ek"]).optional().default("kein"),
  pauschale_fix: numNonNeg.optional().default(0),
  pauschale_percent: numNonNeg.optional().default(0),
  active: z.boolean().optional().default(true),
});
export type ServiceInput = z.infer<typeof serviceSchema>;
