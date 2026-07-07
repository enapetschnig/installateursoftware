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

export interface VoiceStammdaten {
  /** Aktive Stamm-Leistungen (zum Bezug von service_id beim Konvertieren). */
  services: Service[];
  /** Kompakter Katalog für die Calc-Pipeline (`leistungsnummer`-basiert). */
  catalog: Catalog;
  /** Map Gewerk-Name → Stundensatz €/h (höchster aktiver Verkaufssatz). */
  stundensaetze: StundensaetzeMap;
  /** Kalkulations-Parameter aus company_settings (Migr. 0125). */
  kalkSettings: KalkSettings;
}

export const EMPTY_VOICE_STAMMDATEN: VoiceStammdaten = {
  services: [],
  catalog: { positionen: [] },
  stundensaetze: {},
  kalkSettings: DEFAULT_KALK_SETTINGS,
};

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
          "kalk_aufschlag_gesamt, kalk_aufschlag_material, kalk_stundensatz_default, kalk_material_cap",
        )
        .limit(1)
        .maybeSingle(),
    ]);
    const services = (svcRes.data as Service[]) ?? [];
    const hourlyRates = (hrRes.data as HourlyRate[]) ?? [];
    const trades = (trRes.data as Trade[]) ?? [];
    return {
      services,
      catalog: servicesToCatalog(services, trades),
      stundensaetze: buildStundensaetzeMap(hourlyRates, trades),
      kalkSettings: kalkSettingsFromCompanyRow(csRes?.data ?? null),
    };
  } catch {
    return EMPTY_VOICE_STAMMDATEN;
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
