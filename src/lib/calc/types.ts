// ────────────────────────────────────────────────────────────────────────────
//  Calc-Pipeline – gemeinsame Typen für die portierte bau4you-Logik
//  Quelle: bau4you-app/src/lib/claude.js + prompts.js + fixGewerkZuordnung.js
//
//  Bewusst getrennt von src/lib/document-types.ts (DocPosition lebt im
//  Editor/PDF-Kontext). Hier modellieren wir das Datenformat das die KI-Pipeline
//  produziert/konsumiert – nahe am bau4you-JSON, damit die portierten Funktionen
//  möglichst 1:1 bleiben und der Cent-Identitäts-Test funktioniert.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Eine Angebots-Position wie sie aus der KI-Pipeline kommt.
 * Alle numerischen Felder sind nullable, weil verschiedene Pipeline-Stufen
 * sie sukzessive befüllen. `fixPositionKosten` garantiert finite Numbers.
 */
export interface Position {
  /** Leistungsnummer im Hero-Format `XX-NNN` oder `XX-NEU[N]` (Neu-Pos). */
  leistungsnummer?: string | null
  /** Kurzname (z. B. "Wand spachteln Q3"). */
  leistungsname?: string | null
  /** Langtext / Detailbeschreibung. */
  beschreibung?: string | null
  /** Einheit – m², lfm, Stk, pauschal … */
  einheit?: string | null
  /** Menge in der jeweiligen Einheit. */
  menge?: number | null
  /** Gewerk (Maler, Abbruch, Reinigung …) – kann durch Präfix-Routing korrigiert werden. */
  gewerk?: string | null

  // ── Kalkulations-Felder (Cent-Identität) ───────────────────────────────
  /** Material-EK netto pro Einheit. */
  materialkosten_einheit?: number | null
  /** Lohn-EK netto pro Einheit (= minuten/60 × stundensatz). */
  lohnkosten_einheit?: number | null
  /** Arbeitsminuten pro Einheit. */
  lohnkosten_minuten?: number | null
  /** Stundensatz €/h für dieses Gewerk. */
  stundensatz?: number | null
  /** VK netto pro Einheit (= (mat+lohn) × (1 + aufschlag/100)). */
  vk_netto_einheit?: number | null
  /** Menge × VK. */
  gesamtpreis?: number | null
  /** Aufschlag-Prozent das auf diese Position angewendet wurde. */
  aufschlag_prozent?: number | null
  /** Materialanteil in % (= material / (material+lohn) × 100). */
  materialanteil_prozent?: number | null
  /** Lohnanteil in %. */
  lohnanteil_prozent?: number | null

  // ── Pipeline-Flags ─────────────────────────────────────────────────────
  /** Aus Katalog übernommen vs. neu kalkuliert (bau4you: aus_preisliste). */
  /** VK wurde deterministisch aus dem Großhandels-EK gerechnet (applyWholesalePricing).
   *  Die Calc-Pipeline (fixPositionKosten, verifyAufschlaege) darf ihn NICHT
   *  erneut ableiten/anheben – sonst Doppelaufschlag (siehe wholesale.ts). */
  preis_deterministisch?: boolean | null
  aus_preisliste?: boolean
  /** KI-Vorschlag-Badge (keine direkte Texterwähnung in der User-Eingabe). */
  isVorschlag?: boolean
  /** Material wurde auf 30 % gecapped, Lohn entsprechend hochgerechnet. */
  material_capped?: boolean
  /** Material-Original-Wert bevor gecapped (Audit). */
  material_capped_original?: number
  /** Soft-Delete-Flag für Pipeline-Aufrufe. */
  deleted?: boolean
  /** Manuell vom User bearbeitet (verhindert Auto-Recalc). */
  manuellBearbeitet?: boolean
  /** Reinigung wurde vom User entfernt (verhindert smartReinigung Re-Insert). */
  reinigungEntfernt?: boolean

  // ── Snapshot aus Katalog (bau4you: _katalog_snapshot) ──────────────────
  /** Eingefrorene Stammdaten zum Zeitpunkt der Erstellung. */
  _katalog_snapshot?: KatalogSnapshot | null

  /** Pass-Through für unbekannte Felder (Pipeline mutiert nicht zerstörerisch). */
  [key: string]: unknown
}

export interface KatalogSnapshot {
  service_id?: string | null
  leistungsnummer?: string | null
  leistungsname?: string | null
  beschreibung?: string | null
  einheit?: string | null
  vk_netto_einheit?: number | null
  lohnkosten_einheit?: number | null
  materialkosten_einheit?: number | null
  lohnkosten_minuten?: number | null
  stundensatz?: number | null
}

/**
 * Ein Gewerk-Block im Angebot (z. B. "Maler" mit allen seinen Positionen).
 */
export interface Gewerk {
  name: string
  /** Optionaler Stundensatz – wird bei Bedarf aus stundensaetze-Map nachgereicht. */
  stundensatz?: number
  positionen: Position[]
}

/**
 * Katalog = vollständige Stammdaten-Liste (in b4y-superapp: services-Tabelle).
 * Aus Sicht der Pipeline ist die Quelle egal – wichtig ist die Lookup-Funktion.
 */
export interface CatalogPosition {
  leistungsnummer: string
  leistungsname: string
  beschreibung?: string
  einheit?: string
  vk_netto_einheit?: number | null
  lohnkosten_einheit?: number | null
  materialkosten_einheit?: number | null
  lohnkosten_minuten?: number | null
  stundensatz?: number | null
  gewerk?: string
}

export interface Catalog {
  positionen: CatalogPosition[]
}

/**
 * Map Gewerk-Name → Stundensatz €/h.
 * z. B. { "Maler": 75, "Abbruch": 65, "Reinigung": 58 }
 */
export type StundensaetzeMap = Record<string, number>

/**
 * Globale Kalkulations-Settings die in der Pipeline durchgereicht werden.
 *
 * Standardwerte (bau4you-Default für b4y-superapp übernommen):
 *   aufschlagGesamt = 20      // % auf (mat+lohn)
 *   aufschlagMaterial = 30    // % zusätzlich auf Material (vor Gesamt-Aufschlag)
 *   stundensatzDefault = 70   // €/h Fallback
 *   materialCapPercent = 30   // Material max 30 % vom Lohn+Material
 */
export interface KalkSettings {
  aufschlagGesamt: number
  aufschlagMaterial: number
  stundensatzDefault: number
  materialCapPercent: number
  /** Pro-Gewerk-Override für aufschlagGesamt. */
  aufschlagPerGewerk?: Record<string, number>
}

export const DEFAULT_KALK_SETTINGS: KalkSettings = {
  aufschlagGesamt: 20,
  aufschlagMaterial: 30,
  stundensatzDefault: 70,
  materialCapPercent: 30,
}

/**
 * Feste Reihenfolge der Gewerke im Ausgabe-Dokument.
 * Quelle: bau4you/claude.js GEWERKE_REIHENFOLGE (Z. 9), 1:1 wie in Hero.
 * "Reinigung" steht IMMER am Ende.
 */
export const GEWERKE_REIHENFOLGE: readonly string[] = [
  'Gemeinkosten',
  'Abbruch',
  'Bautischler',
  'Glaser',
  'Elektriker',
  'Installateur',
  'Baumeister',
  'Trockenbau',
  'Maler',
  'Anstreicher',
  'Fliesenleger',
  'Bodenleger',
  'Elektrozuleitung',
  'Reinigung',
] as const

/**
 * Präfix-Map: Gewerk-Name → 2-stelliges Leistungsnummer-Präfix.
 * Quelle: bau4you/claude.js GEWERK_PREFIX_MAP (Z. 645), identisch mit Hero.
 * Präfix 14, 15 sind absichtlich frei (Hero verwendet sie nicht).
 */
export const GEWERK_PREFIX_MAP: Record<string, string> = {
  Gemeinkosten: '01',
  Abbruch: '02',
  Bautischler: '03',
  Glaser: '04',
  Elektriker: '05',
  Installateur: '06',
  Baumeister: '07',
  Trockenbau: '08',
  Maler: '09',
  Anstreicher: '10',
  Fliesenleger: '11',
  Bodenleger: '12',
  Reinigung: '13',
  Elektrozuleitung: '16',
}

/**
 * Umgekehrte Map: Präfix → Gewerk-Name.
 */
export const PREFIX_TO_GEWERK: Record<string, string> = Object.fromEntries(
  Object.entries(GEWERK_PREFIX_MAP).map(([gewerk, prefix]) => [prefix, gewerk])
)

/** Valide Leistungsnummern: `XX-NNN` oder `XX-NEU[N]`. */
export const VALID_LEISTUNGSNR = /^\d{2}-(\d{3,}|NEU\d*)$/
/** Nur Katalog-Format (kein NEU). */
export const CATALOG_NR_RE = /^\d{2}-\d{3,}$/

/**
 * Spezial-Techniken: Standard-Katalog-Preis ist 3-10× zu niedrig, KI muss
 * neu kalkulieren (höchster Wiener Marktpreis).
 * Quelle: bau4you/claude.js SPEZIAL_TECHNIK_KEYWORDS (Z. 951).
 */
export const SPEZIAL_TECHNIK_KEYWORDS: readonly string[] = [
  'venezianisch',
  'tadelakt',
  'marmorino',
  'spachteltechnik',
  'stucco',
  'metallic',
  'beton-optik',
  'betonoptik',
  'betonlook',
  'kalkputz',
  'sumpfkalk',
  'sgraffito',
]

/**
 * Staub-intensive Arbeiten – triggert automatische Feinreinigung (13-100).
 * Quelle: bau4you/claude.js STAUBINTENSIV_KW (Z. 2182).
 */
export const STAUBINTENSIV_KW: readonly string[] = [
  'abbruch',
  'stemm',
  'fliesen',
  'spachtel',
  'schleifen',
  'maler',
  'trockenbau',
  'estrich',
  'putz',
]
