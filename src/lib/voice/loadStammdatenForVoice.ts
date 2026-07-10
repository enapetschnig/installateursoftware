// ────────────────────────────────────────────────────────────────────────────
//  loadStammdatenForVoice – Lädt die Stamm-Daten, die der VoiceAngebotDialog
//  als Props benötigt (Catalog, Stundensaetze, Services).
//
//  Phase 5 – Bindeglied zwischen OfferEditor und VoiceAngebotDialog:
//  Statt im OfferEditor eine grosse Lade-Logik einzubauen, bündelt dieses
//  Modul die drei Supabase-Calls und macht aus den Roh-Tabellen
//  (services, hourly_rates, trades) die für die Calc-Pipeline benötigten
//  Strukturen (Catalog mit Hero-`leistungsnummer`, StundensaetzeMap nach
//  Gewerk-Name).
//
//  Reine Read-Operation – keine Mutation, kein State. Tests stubbe via
//  `supabaseImpl`-Parameter den Client.
// ────────────────────────────────────────────────────────────────────────────

import { supabase as defaultSupabase } from "../supabase";
import type { Catalog, CatalogPosition, KalkSettings, StundensaetzeMap } from "../calc/types";
import { DEFAULT_KALK_SETTINGS } from "../calc/types";
import type { Service, HourlyRate, Trade } from "../calc-types";
import { isReservedSpecialServiceNumber } from "../service-numbers";

/** Handelsüblicher VK-Richtwert je Leistungskategorie (company_settings.kalk_richtwerte, Migr. 0150). */
export interface Richtwert {
  /** Regex (case-insensitive) auf den Positionsnamen, z. B. "steckdose|schalter". */
  stichwort: string;
  bezeichnung: string;
  einheit?: string | null;
  vk_min: number;
  vk_max: number;
}

export interface VoiceStammdaten {
  /** Aktive Stamm-Leistungen (zum Bezug von service_id beim Konvertieren). */
  services: Service[];
  /** Kompakter Katalog für die Calc-Pipeline (`leistungsnummer`-basiert). */
  catalog: Catalog;
  /** Map Gewerk-Name → Stundensatz €/h (höchster aktiver Verkaufssatz). */
  stundensaetze: StundensaetzeMap;
  /** Kalkulations-Parameter aus company_settings (Migr. 0125). */
  kalkSettings: KalkSettings;
  /** Handelsübliche Richtwert-Spannen (Migr. 0150) – Prompt-Kalibrierung + Plausibilitäts-Guard. */
  richtwerte: Richtwert[];
  /** Aktive Gewerke des Betriebs (mit Positionsnummern-Prefix) – bestimmt die
   *  Angebots-Gliederung der KI. Ein Elektriker bekommt so ein Elektriker-
   *  Angebot, kein Baubetriebs-Gerüst aus Gemeinkosten/Abbruch/Reinigung. */
  gewerke: BetriebsGewerk[];
  /** Fachwissen-Regeln (Migr. 0155) – Mitdenken + Rückfragen. */
  fachregeln: Fachregel[];
}

/** Aktives Gewerk des Betriebs für die Prompt-Gliederung. */
export interface BetriebsGewerk { name: string; prefix: string }

/** Fachwissen-Regel des Betriebs (company_settings.kalk_fachregeln, Migr. 0155). */
export interface Fachregel {
  /** Regex (case-insensitive) auf das Transkript, z. B. "unterverteil|verteiler". */
  stichwort: string;
  /** Was fachlich dazugehört (fließt ins Mitdenken der KI). */
  dann: string;
  /** Rückfrage, wenn die Info im Transkript fehlt (optional). */
  frage?: string | null;
}

/** Validiert das JSONB-Array aus company_settings.kalk_fachregeln (tolerant). */
export function parseFachregeln(raw: unknown): Fachregel[] {
  if (!Array.isArray(raw)) return [];
  const out: Fachregel[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const stichwort = typeof o.stichwort === "string" ? o.stichwort.trim() : "";
    const dann = typeof o.dann === "string" ? o.dann.trim() : "";
    if (!stichwort || !dann) continue;
    try { new RegExp(stichwort, "i"); } catch { continue; }
    out.push({ stichwort, dann, frage: typeof o.frage === "string" && o.frage.trim() ? o.frage.trim() : null });
  }
  return out;
}

export const EMPTY_VOICE_STAMMDATEN: VoiceStammdaten = {
  services: [],
  catalog: { positionen: [] },
  stundensaetze: {},
  kalkSettings: DEFAULT_KALK_SETTINGS,
  richtwerte: [],
  gewerke: [],
  fachregeln: [],
};

/**
 * Leitet die aktiven Gewerke des Betriebs ab: aktive trades, die aktive
 * Leistungen haben. Der Positionsnummern-Prefix ("05" in "05-160") wird aus
 * den echten service_numbers des Gewerks gelesen (häufigster Prefix) –
 * nichts hartcodiert, funktioniert für jede Firma/Nummernlogik.
 */
export function buildBetriebsGewerke(services: Service[], trades: Trade[]): BetriebsGewerk[] {
  const prefixVotes = new Map<string, Map<string, number>>(); // trade_id → prefix → count
  for (const svc of services) {
    if (!svc.trade_id) continue;
    const m = /^([A-Za-z0-9]+)-/.exec((svc.service_number || "").trim());
    if (!m) continue;
    const votes = prefixVotes.get(svc.trade_id) ?? new Map<string, number>();
    votes.set(m[1], (votes.get(m[1]) ?? 0) + 1);
    prefixVotes.set(svc.trade_id, votes);
  }
  const out: BetriebsGewerk[] = [];
  for (const t of [...trades].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))) {
    if (t.active === false) continue;
    const votes = prefixVotes.get(t.id);
    if (!votes || votes.size === 0) continue; // keine aktiven Leistungen → kein Angebots-Gewerk
    const prefix = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({ name: t.name, prefix });
  }
  return out;
}

/** Validiert das JSONB-Array aus company_settings.kalk_richtwerte (tolerant, kein Throw). */
export function parseRichtwerte(raw: unknown): Richtwert[] {
  if (!Array.isArray(raw)) return [];
  const out: Richtwert[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const stichwort = typeof o.stichwort === "string" ? o.stichwort.trim() : "";
    const min = Number(o.vk_min), max = Number(o.vk_max);
    if (!stichwort || !Number.isFinite(min) || !Number.isFinite(max) || max <= 0) continue;
    try { new RegExp(stichwort, "i"); } catch { continue; } // kaputte Regex überspringen
    out.push({
      stichwort,
      bezeichnung: typeof o.bezeichnung === "string" ? o.bezeichnung : stichwort,
      einheit: typeof o.einheit === "string" ? o.einheit : null,
      vk_min: Math.max(0, min),
      vk_max: max,
    });
  }
  return out;
}

/**
 * Lädt aktive Services + HourlyRates + Trades aus Supabase und baut daraus
 * die für die Voice-Pipeline benötigten Strukturen.
 *
 * Bei Fehlern (z. B. RLS-Probleme) → leere Defaults, KEIN Throw. Voice-Pipeline
 * kann auch ohne Katalog laufen (alle Positionen werden dann als "neu"
 * kalkuliert und als free-Positionen ins Dokument geschrieben).
 */
export async function loadStammdatenForVoice(
  supabase: typeof defaultSupabase = defaultSupabase,
): Promise<VoiceStammdaten> {
  try {
    const [svcRes, hrRes, trRes, csRes] = await Promise.all([
      supabase.from("services").select("*").eq("active", true),
      supabase.from("hourly_rates").select("*").eq("active", true),
      supabase.from("trades").select("*"),
      supabase
        .from("company_settings")
        .select(
          "kalk_aufschlag_gesamt, kalk_aufschlag_material, kalk_stundensatz_default, kalk_material_cap, kalk_richtwerte, kalk_auto_nebenpositionen, kalk_fachregeln",
        )
        .limit(1)
        .maybeSingle(),
    ]);
    const services = (svcRes.data as Service[]) ?? [];
    const hourlyRates = (hrRes.data as HourlyRate[]) ?? [];
    const trades = (trRes.data as Trade[]) ?? [];
    const csRow = (csRes?.data ?? null) as ({ kalk_richtwerte?: unknown; kalk_fachregeln?: unknown } & Parameters<typeof kalkSettingsFromCompanyRow>[0]) | null;
    return {
      services,
      catalog: servicesToCatalog(services, trades),
      stundensaetze: buildStundensaetzeMap(hourlyRates, trades),
      kalkSettings: kalkSettingsFromCompanyRow(csRow),
      richtwerte: parseRichtwerte(csRow?.kalk_richtwerte),
      gewerke: buildBetriebsGewerke(services, trades),
      fachregeln: parseFachregeln(csRow?.kalk_fachregeln),
    };
  } catch {
    return EMPTY_VOICE_STAMMDATEN;
  }
}

/**
 * Schlanke Variante für den Katalog-Picker im Dokument-Editor: nur die
 * Kalkulations-Parameter (ohne Services/Stundensätze). Fehler → Defaults.
 */
export async function loadKalkSettings(
  supabase: typeof defaultSupabase = defaultSupabase,
): Promise<KalkSettings> {
  try {
    const { data } = await supabase
      .from("company_settings")
      .select("kalk_aufschlag_gesamt, kalk_aufschlag_material, kalk_stundensatz_default, kalk_material_cap")
      .limit(1)
      .maybeSingle();
    return kalkSettingsFromCompanyRow(data ?? null);
  } catch {
    return DEFAULT_KALK_SETTINGS;
  }
}

/**
 * Mappt die company_settings-Kalkulations-Spalten (Migr. 0125) auf
 * KalkSettings. Fehlende/ungueltige Werte fallen pro Feld einzeln auf
 * die bisherigen Defaults zurueck — eine halb gepflegte Row soll nicht
 * die ganze Kalkulation auf Default zuruecksetzen.
 */
export function kalkSettingsFromCompanyRow(
  row: {
    kalk_aufschlag_gesamt?: number | null;
    kalk_aufschlag_material?: number | null;
    kalk_stundensatz_default?: number | null;
    kalk_material_cap?: number | null;
    kalk_auto_nebenpositionen?: boolean | null;
  } | null,
): KalkSettings {
  const num = (v: unknown, fallback: number): number => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    aufschlagGesamt: num(row?.kalk_aufschlag_gesamt, DEFAULT_KALK_SETTINGS.aufschlagGesamt),
    aufschlagMaterial: num(row?.kalk_aufschlag_material, DEFAULT_KALK_SETTINGS.aufschlagMaterial),
    stundensatzDefault: num(row?.kalk_stundensatz_default, DEFAULT_KALK_SETTINGS.stundensatzDefault),
    materialCapPercent: num(row?.kalk_material_cap, DEFAULT_KALK_SETTINGS.materialCapPercent),
    // null/undefined → true (Baubetriebs-Default, B4Y-kompatibel)
    autoNebenpositionen: row?.kalk_auto_nebenpositionen !== false,
  };
}

// ──── Helper: Service[] → Catalog ───────────────────────────────────────────

/**
 * Wandelt aktive Service-Stammdaten in einen Catalog (CatalogPosition[]) um,
 * der von `runCalcPipeline` (enrichFromCatalog, fixNullpreise, …) konsumiert
 * werden kann. Reine Map-Operation – kein I/O.
 *
 * Services ohne `service_number` werden übersprungen – die Calc-Pipeline
 * matcht ausschliesslich über `leistungsnummer`.
 */
export function servicesToCatalog(services: Service[], trades: Trade[]): Catalog {
  const tradeById = new Map<string, string>();
  for (const t of trades) tradeById.set(t.id, t.name);
  const positionen: CatalogPosition[] = [];
  for (const s of services) {
    const nr = (s.service_number || "").trim();
    if (!nr) continue;
    // Reservierte Spezialnummern 980–999 (Variable/Regie/Material) gehören nicht in
    // den Katalog – sie werden dokumentlokal über die Editor-Buttons erzeugt.
    if (isReservedSpecialServiceNumber(nr)) continue;
    // Beschreibung + Berechnung kontrolliert zusammensetzen: Der Berechnungs-/Staffelpreis-
    // Block liegt seit Migr. 0096 separat in `calculation_text` (zuvor als „Berechnung:"-Block
    // im long_text). Wir hängen ihn mit „Berechnung: "-Anker wieder an, damit die nachgelagerte
    // Staffelpreis-Logik (parseStaffelPreis) unverändert funktioniert.
    const baseDesc = (s.short_text || s.long_text) || "";
    const calcTxt = (s.calculation_text || "").trim();
    const beschreibung = [baseDesc, calcTxt ? `Berechnung: ${calcTxt}` : ""]
      .filter(Boolean).join("\n") || undefined;
    positionen.push({
      leistungsnummer: nr,
      leistungsname: s.name || "",
      beschreibung,
      einheit: s.unit || undefined,
      vk_netto_einheit: typeof s.vk_net_manual === "number" ? s.vk_net_manual : null,
      lohnkosten_einheit: null,
      materialkosten_einheit: null,
      lohnkosten_minuten: null,
      stundensatz: null,
      gewerk: (s.trade_id && tradeById.get(s.trade_id)) || undefined,
    });
  }
  return { positionen };
}

/**
 * Map Gewerk-Name → Stundensatz €/h. Nimmt pro Gewerk den höchsten aktiven
 * Verkaufs-Stundensatz – existieren mehrere Sätze (Senior/Junior etc.), liegt
 * die KI dann eher zu hoch als zu niedrig (Qualitätsbetrieb-Prinzip aus
 * Prompt: "im Zweifel aufrunden"). Sätze ohne trade_id werden ignoriert.
 */
export function buildStundensaetzeMap(rates: HourlyRate[], trades: Trade[]): StundensaetzeMap {
  const tradeById = new Map<string, string>();
  for (const t of trades) tradeById.set(t.id, t.name);
  const out: StundensaetzeMap = {};
  for (const r of rates) {
    const tradeName = r.trade_id ? tradeById.get(r.trade_id) : null;
    if (!tradeName) continue;
    const sale = Number(r.sale_rate) || 0;
    if (!sale) continue;
    const cur = out[tradeName] ?? 0;
    if (sale > cur) out[tradeName] = sale;
  }
  return out;
}
