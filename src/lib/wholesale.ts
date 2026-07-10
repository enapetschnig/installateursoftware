// ============================================================
// Installateur SuperAPP – Großhandels-Katalog (Client)
// ------------------------------------------------------------
// Zugriff auf die Datanorm-Katalog-Ebene (supplier_catalog_items) über die
// DB-Funktion catalog_search (pg_trgm, org-isoliert via RLS).
//
// Kernaufgabe für das Sprach-Angebot: aus einem gesprochenen Transkript die
// passenden Großhandels-Artikel mit ECHTEM EK (Liste − Rabatt bzw. Nettopreis)
// holen — Retrieval statt Prompt-Stuffing. Bei 641.000+ Artikeln entscheidet
// die DB-Suche, welche ~40 Artikel die KI zu sehen bekommt.
// ============================================================
import { supabase } from "./supabase";

export interface CatalogHit {
  artikelnummer: string;
  bezeichnung: string;
  einheit: string | null;
  ek_cent: number;        // EK in Cent je 1 Einheit (Rabatt/Netto eingerechnet)
  listen_cent: number | null;
  rabatt_prozent: number;
  warengruppe: string | null;
  ean: string | null;
  metall: string | null;  // CU/AL → Metallzuschlag des Händlers kommt noch dazu
  score: number;
}

/** Direkte Katalog-Suche (auch für UI-Suchfelder verwendbar). */
export async function searchCatalog(query: string, limit = 12): Promise<CatalogHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("catalog_search", { p_query: q, p_limit: limit });
  if (error) return []; // Suche ist Zusatznutzen – nie den Aufrufer crashen
  return (data as CatalogHit[]) ?? [];
}

// ── Transkript → Suchbegriffe ─────────────────────────────────────────
// Ohne zweiten KI-Aufruf: Das Transkript wird an Satz-/Aufzählungsgrenzen
// zerlegt; je Segment bilden die fachlich tragenden Wörter eine Suchanfrage.
const STOPWORDS = new Set([
  "und", "oder", "mit", "ohne", "für", "der", "die", "das", "den", "dem", "des",
  "ein", "eine", "einen", "einem", "einer", "im", "in", "am", "an", "auf", "aus",
  "bei", "bis", "dann", "noch", "auch", "sowie", "inklusive", "inkl", "zirka",
  "circa", "ca", "bitte", "wir", "ich", "man", "es", "ist", "sind", "wird",
  "werden", "soll", "sollen", "muss", "müssen", "neu", "neue", "neuen", "alte",
  "alten", "komplett", "gesamt", "stück", "stk", "meter", "laufmeter", "lfm",
  "montieren", "montage", "demontieren", "demontage", "liefern", "lieferung",
  "einbauen", "einbau", "tauschen", "austauschen", "wechseln", "erneuern",
  "verlegen", "anschließen", "anschluss", "setzen", "installieren", "herstellen",
  "eur", "euro", "preis", "angebot", "position", "positionen", "mal", "je", "pro",
  "betrifft", "dazu", "danach", "zuerst", "bauen", "unter", "über", "vom", "zum", "zur",
]);

/** Zahl-Wörter wie "3x1,5" / "40a" / "30ma" bleiben erhalten – sie sind fachlich tragend. */
function isMeaningful(word: string): boolean {
  const w = word.toLowerCase();
  if (STOPWORDS.has(w)) return false;
  if (/^\d+([.,]\d+)?$/.test(w)) return false; // reine Mengen ("15") sind keine Artikelmerkmale
  return w.length >= 3 || /\d/.test(w);
}

/** Zerlegt ein Transkript in Such-Queries (max. `maxQueries`). */
export function extractSearchQueries(transcript: string, maxQueries = 12): string[] {
  // Dezimal-Kommas schützen (deutsche Dimensionen wie "3x1,5" oder "2,5 mm²"
  // dürfen NICHT an ihrem Komma zerteilt werden), dann an Satz-/Aufzählungs-
  // Grenzen zerlegen und die Kommas wiederherstellen.
  const DECIMAL_GUARD = "__dez__";
  const protectedText = transcript.replace(/(\d),(\d)/g, `$1${DECIMAL_GUARD}$2`);
  const segments = protectedText
    .split(/[.,;\n]| und | dann | außerdem | sowie | plus /gi)
    .map((s) => s.split(DECIMAL_GUARD).join(",").trim())
    .filter((s) => s.length >= 4);

  const queries: string[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    // "Betrifft:"-Kopfzeilen sind Meta, keine Artikel.
    if (/^betrifft\s*:/i.test(seg.trim())) continue;
    const words = seg.split(/\s+/).filter(isMeaningful);
    if (words.length === 0) continue;
    // word_similarity braucht KOMPAKTE Phrasen: max. 3 Wörter, Wörter mit
    // Ziffern (Dimensionen wie "3x1,5", "40a") werden priorisiert behalten.
    let pick = words;
    if (pick.length > 3) {
      const dims = pick.filter((w) => /\d/.test(w));
      const rest = pick.filter((w) => !/\d/.test(w));
      pick = [...rest.slice(0, Math.max(1, 3 - dims.length)), ...dims].slice(0, 3);
    }
    const q = pick.join(" ").toLowerCase();
    if (q.length < 4 || seen.has(q)) continue;
    seen.add(q);
    queries.push(q);
    if (queries.length >= maxQueries) break;
  }
  return queries;
}

/**
 * Holt für ein Sprach-Transkript die relevantesten Katalog-Artikel
 * (dedupliziert, nach Treffer-Güte sortiert, gedeckelt).
 * Liefert [] wenn kein Katalog importiert ist → Voice-Flow läuft wie bisher.
 */
export async function searchCatalogForTranscript(
  transcript: string,
  opts: { perQuery?: number; maxTotal?: number } = {},
): Promise<CatalogHit[]> {
  const perQuery = opts.perQuery ?? 4;
  const maxTotal = opts.maxTotal ?? 36;
  const queries = extractSearchQueries(transcript);
  if (queries.length === 0) return [];

  const results = await Promise.all(queries.map((q) => searchCatalog(q, perQuery)));
  const byArtnr = new Map<string, CatalogHit>();
  for (const hits of results) {
    for (const h of hits) {
      const prev = byArtnr.get(h.artikelnummer);
      if (!prev || h.score > prev.score) byArtnr.set(h.artikelnummer, h);
    }
  }
  return [...byArtnr.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTotal);
}

/** Baut den Prompt-Block mit echten Großhandels-EK-Preisen für die Voice-KI. */
export function buildWholesaleBlock(hits: CatalogHit[]): string {
  if (hits.length === 0) return "";
  const lines = hits.map((h) => {
    const ekEur = (h.ek_cent / 100).toFixed(2).replace(".", ",");
    const metall = h.metall ? ` (+${h.metall}-Zuschlag)` : "";
    return `${h.artikelnummer} | ${h.bezeichnung} | ${h.einheit ?? "STK"} | EK ${ekEur} €${metall}`;
  });
  return (
    "GROSSHANDELSKATALOG (echte Einkaufspreise deines Großhändlers, bereits rabattiert – Auszug passend zur Anfrage):\n" +
    "Artikelnummer | Bezeichnung | Einheit | EK netto je Einheit\n" +
    lines.join("\n")
  );
}

// ── Deterministische Material-Nachkalkulation ─────────────────────────
// Das LLM ist bei Preisen unzuverlässig (klebt an unpassenden Preislisten-
// Positionen). Deshalb liefert es für Material-Positionen nur FAKTEN
// (material_artikelnummer aus dem Katalog-Block + Zeitschätzung); den VK
// rechnet dieser Code: EK × (1+Materialaufschlag) + Minuten × Stundensatz.
export interface WholesalePricingOpts {
  aufschlagMaterialProzent: number;   // z. B. 30
  stundensatzDefault: number;         // €/h, z. B. 70
}

interface VoicePositionLike {
  leistungsnummer?: string | null;
  leistungsname?: string | null;
  beschreibung?: string | null;
  einheit?: string | null;
  menge?: number | null;
  vk_netto_einheit?: number | null;
  aus_preisliste?: boolean | null;
  stundensatz?: number | null;
  // Von der KI gelieferte Material-Fakten (optional):
  material_artikelnummer?: string | null;
  material_menge_pro_einheit?: number | null;
  arbeitszeit_min_einheit?: number | null;
}
interface VoiceGewerkLike { name?: string; stundensatz?: number; positionen?: VoicePositionLike[] }

/**
 * Überschreibt den VK aller Positionen, die eine `material_artikelnummer`
 * aus dem Großhandels-Block tragen, mit der deterministischen Kalkulation.
 * Positionen aus der eigenen Preisliste (aus_preisliste=true) bleiben unberührt.
 * Gibt die Anzahl der neu bepreisten Positionen zurück.
 */
export function applyWholesalePricing(
  gewerke: VoiceGewerkLike[],
  hits: CatalogHit[],
  opts: WholesalePricingOpts,
): number {
  if (!hits.length) return 0;
  const byArtnr = new Map(hits.map((h) => [h.artikelnummer, h]));
  let count = 0;
  for (const g of gewerke) {
    for (const p of g.positionen ?? []) {
      if (p.aus_preisliste) continue;
      const artnr = (p.material_artikelnummer ?? "").trim();
      const hit = artnr ? byArtnr.get(artnr) : undefined;
      if (!hit) continue;
      const mengeProEinheit = Number(p.material_menge_pro_einheit ?? 1) || 1;
      const minuten = Math.max(0, Number(p.arbeitszeit_min_einheit ?? 0) || 0);
      const satz = Number(p.stundensatz ?? g.stundensatz ?? opts.stundensatzDefault) || opts.stundensatzDefault;
      const materialEuro = (hit.ek_cent / 100) * mengeProEinheit * (1 + opts.aufschlagMaterialProzent / 100);
      const lohnEuro = (minuten / 60) * satz;
      const vk = Math.round((materialEuro + lohnEuro) * 100) / 100;
      if (vk <= 0) continue;
      p.vk_netto_einheit = vk;
      annotate(p, hit);
      count++;
    }
    // NOTNAGEL: Neu-Kalkulationen, die ohne Preis (≤ 0) aus der KI kommen und
    // keine Artikelnummer tragen, per Token-Übereinstimmung gegen die
    // Katalog-Treffer nachbepreisen – verhindert 0-€-Positionen im Angebot.
    for (const p of g.positionen ?? []) {
      if (p.aus_preisliste || Number(p.vk_netto_einheit ?? 0) > 0) continue;
      const hit = bestTokenMatch(`${p.leistungsname ?? ""} ${p.beschreibung ?? ""}`, hits);
      if (!hit) continue;
      const minuten = defaultMinuten(p.einheit);
      const satz = Number(p.stundensatz ?? g.stundensatz ?? opts.stundensatzDefault) || opts.stundensatzDefault;
      const materialEuro = (hit.ek_cent / 100) * (1 + opts.aufschlagMaterialProzent / 100);
      const vk = Math.round((materialEuro + (minuten / 60) * satz) * 100) / 100;
      if (vk <= 0) continue;
      p.vk_netto_einheit = vk;
      annotate(p, hit, " (automatisch nachkalkuliert)");
      count++;
    }
  }
  return count;
}

function annotate(p: VoicePositionLike, hit: CatalogHit, suffix = ""): void {
  const hinweis = `Material: Art. ${hit.artikelnummer} (${hit.bezeichnung.slice(0, 60)}) lt. Großhandelskatalog${suffix}` +
    (hit.metall ? ", zzgl. tagesaktueller Metallzuschlag" : "");
  const besch = String(p.beschreibung ?? "").trim();
  if (!besch.includes(hit.artikelnummer)) {
    p.beschreibung = besch ? `${besch}\n${hinweis}` : hinweis;
  }
}

/** Konservative Montagezeit je Einheit, wenn die KI keine liefert (Notnagel). */
function defaultMinuten(einheit?: string | null): number {
  const e = (einheit ?? "").toLowerCase();
  if (/^(m|lfm|mtr|meter)/.test(e)) return 6;
  if (/^(stk|st|pce|stück)/.test(e)) return 20;
  return 15;
}

/** Bestes Katalog-Match über gemeinsame Fach-Tokens (mind. ein Ziffern-Token wie "3x1,5"). */
function bestTokenMatch(text: string, hits: CatalogHit[]): CatalogHit | null {
  const tokens = text.toLowerCase().split(/[^a-zäöüß0-9,x-]+/).filter((t) => t.length >= 3 || /\d/.test(t));
  if (tokens.length === 0) return null;
  let best: CatalogHit | null = null;
  let bestScore = 0;
  for (const h of hits) {
    const hay = h.bezeichnung.toLowerCase();
    let common = 0, dims = 0;
    for (const t of tokens) {
      if (hay.includes(t)) { common++; if (/\d/.test(t)) dims++; }
    }
    // Verlangt mind. ein dimensionsartiges Token (z. B. "3x1,5", "40a") UND
    // insgesamt 2 Übereinstimmungen – sonst zu unsicher für Auto-Preis.
    const score = dims >= 1 && common >= 2 ? common + dims : 0;
    if (score > bestScore) { bestScore = score; best = h; }
  }
  return best;
}
