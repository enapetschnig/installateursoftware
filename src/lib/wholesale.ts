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
import { DocPosition, emptyPosition } from "./document-types";

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
  // Mehrlieferantenfähig (Migration 0149): gleiche Artikelnummern zweier
  // Händler dürfen sich nicht vermischen; katalog_name = UI-Badge.
  catalog_id: string | null;
  katalog_name: string | null;
}

/** Kollisionsfreier Schlüssel eines Treffers (Katalog + Artikelnummer). */
export const hitKey = (h: Pick<CatalogHit, "catalog_id" | "artikelnummer">): string =>
  `${h.catalog_id ?? ""}:${h.artikelnummer}`;

/** Direkte Katalog-Suche (auch für UI-Suchfelder verwendbar). */
export async function searchCatalog(
  query: string,
  limit = 12,
  opts: { catalogId?: string | null } = {},
): Promise<CatalogHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("catalog_search", {
    p_query: q,
    p_limit: limit,
    p_catalog_id: opts.catalogId ?? null,
  });
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

/** Großgeschriebene Wörter im Originaltext = vermutlich Marken/Typen (Grohe, Laufen, Gira). */
function brandTokens(originalSegment: string): Set<string> {
  const brands = new Set<string>();
  for (const w of originalSegment.split(/\s+/)) {
    const clean = w.replace(/[^A-Za-zÄÖÜäöüß0-9-]/g, "");
    if (/^[A-ZÄÖÜ][a-zäöüß]{2,}$/.test(clean)) brands.add(clean.toLowerCase());
  }
  return brands;
}

// ── Gesprochene Sprache → Katalog-Terminologie ──────────────────────────
// Monteure sprechen anders, als Großhändler ihre Artikel benennen. Ohne diese
// Brücke findet das Retrieval Zufallstreffer ("Leitungslänge" → Verbinder mit
// Leitungslänge 200mm) statt NYM-Leitung und Kleinverteiler. Branchen-, nicht
// firmenspezifisch – gilt für jeden Elektro-/Sanitärbetrieb (mandantenneutral).
const SPOKEN_SYNONYM_QUERIES: Array<{ wenn: RegExp; queries: string[] }> = [
  // Verteiler = Kleinverteiler + Schutzorgane: FI und LS gehören zur Stückliste.
  { wenn: /unterverteil|verteilerkasten|sicherungskasten|z(ä|ae)hlerkasten/i,
    queries: ["kleinverteiler", "verteiler unterputz", "fehlerstromschutzschalter 40a", "leitungsschutzschalter b16"] },
  { wenn: /sat[- ]?steckdose|antennensteckdose|antennendose/i, queries: ["antennendose", "antennensteckdose sat"] },
  // Steckdosen-Auslass = Einsatz + UP-Dose + Rahmen (Komponenten mitsuchen).
  { wenn: /doppelsteckdose/i, queries: ["steckdose 2-fach", "doppelsteckdose"] },
  { wenn: /steckdose/i, queries: ["schuko-steckdose", "steckdose", "gerätedose unterputz", "rahmen 1-fach"] },
  { wenn: /fi[- /]?(schalter|schutz)|fehlerstrom/i, queries: ["fehlerstromschutzschalter", "fi/ls"] },
  { wenn: /brennstelle|lampenauslass|deckenauslass/i, queries: ["deckenauslass", "anschlussdose"] },
  { wenn: /leerrohr/i, queries: ["installationsrohr"] },
];

/** "3 mal 1,5" / "5 mal 2,5" (gesprochen) → Dimensions-Token "3x1,5". */
function normalizeSpokenDimensions(text: string): string {
  return text.replace(/(\d+(?:,\d+)?)\s*mal\s*(\d+(?:,\d+)?)/gi, "$1x$2");
}

/** Zerlegt ein Transkript in Such-Queries (max. `maxQueries`). */
export function extractSearchQueries(transcript: string, maxQueries = 12): string[] {
  transcript = normalizeSpokenDimensions(transcript);
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
    // word_similarity braucht KOMPAKTE Phrasen: max. 3 Wörter. Priorität:
    // Dimensionen ("3x1,5", "40a") und Marken/Typen (Grohe, Laufen) vor Rest –
    // Satzanfangs-Wörter zählen nicht als Marke.
    let pick = words;
    if (pick.length > 3) {
      const brands = brandTokens(seg.split(/\s+/).slice(1).join(" "));
      const prio = pick.filter((w) => /\d/.test(w) || brands.has(w.toLowerCase()));
      const rest = pick.filter((w) => !prio.includes(w));
      pick = [...rest.slice(0, Math.max(1, 3 - prio.length)), ...prio].slice(0, 3);
    }
    const q = pick.join(" ").toLowerCase();
    if (q.length < 4 || seen.has(q)) continue;
    seen.add(q);
    queries.push(q);
    if (queries.length >= maxQueries) break;
  }
  // Synonym-Erweiterung: gesprochene Begriffe zusätzlich in Katalogsprache
  // suchen (z. B. "Unterverteilung" → "kleinverteiler"). Dimensionen wie
  // "3x1,5" bei Leitung/Kabel gezielt als NYM-Query ansetzen.
  for (const syn of SPOKEN_SYNONYM_QUERIES) {
    if (!syn.wenn.test(transcript)) continue;
    for (const q of syn.queries) {
      if (!seen.has(q)) { seen.add(q); queries.push(q); }
    }
  }
  // Leitungs-Dimension ("3x1,5"): nur echte Querschnitte ansetzen – "4x2"
  // aus "4 mal 2 Steckdosen" ist KEINE Leitung. Zweite Zahl muss ein üblicher
  // Aderquerschnitt sein (0,75/1/1,5/2,5/4/6/10/16/25 mm²).
  if (/leitung|kabel|nym|ader/i.test(transcript)) {
    const QUERSCHNITTE = new Set(["0,75", "1", "1,5", "2,5", "4", "6", "10", "16", "25"]);
    for (const m of transcript.matchAll(/\b(\d{1,2})x(\d{1,2}(?:,\d+)?)\b/gi)) {
      if (!QUERSCHNITTE.has(m[2])) continue;
      const q = `nym-j ${m[1]}x${m[2]}`.toLowerCase();
      if (!seen.has(q)) { seen.add(q); queries.push(q); }
    }
  }
  return queries.slice(0, maxQueries + 8); // Synonyme dürfen das Limit moderat erweitern
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
  // 48 statt 36: Stücklisten brauchen auch die Nebenteile (Dosen, Rahmen,
  // FI/LS) – mit 36 wurden die zuletzt gefundenen Komponenten abgeschnitten.
  const maxTotal = opts.maxTotal ?? 48;
  const queries = extractSearchQueries(transcript);
  if (queries.length === 0) return [];

  const results = await Promise.all(queries.map((q) => searchCatalog(q, perQuery)));
  // Dedup je Katalog+Artikelnummer – zwei Händler mit gleicher Artikelnummer
  // bleiben getrennte Treffer (Preise dürfen sich nicht überschreiben).
  const byKey = new Map<string, CatalogHit>();
  for (const hits of results) {
    for (const h of hits) {
      const k = hitKey(h);
      const prev = byKey.get(k);
      if (!prev || h.score > prev.score) byKey.set(k, h);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTotal);
}

/** Baut den Prompt-Block mit echten Großhandels-EK-Preisen für die Voice-KI. */
export function buildWholesaleBlock(hits: CatalogHit[]): string {
  if (hits.length === 0) return "";
  // Lieferantenname nur anzeigen, wenn mehrere Kataloge im Spiel sind.
  const mehrereKataloge = new Set(hits.map((h) => h.catalog_id ?? "")).size > 1;
  const lines = hits.map((h) => {
    const ekEur = (h.ek_cent / 100).toFixed(2).replace(".", ",");
    const metall = h.metall ? ` (+${h.metall}-Zuschlag)` : "";
    const lieferant = mehrereKataloge && h.katalog_name ? ` | ${h.katalog_name}` : "";
    return `${h.artikelnummer} | ${h.bezeichnung} | ${h.einheit ?? "STK"} | EK ${ekEur} €${metall}${lieferant}`;
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
  // Gesamtaufschlag (Gemeinkosten/Gewinn) auf Material+Lohn – identisch zur
  // Prompt-Kalkulationsformel (Material×1,3 + Lohn)×1,2. Default 0 hält alte
  // Aufrufer stabil; die Voice-Pipeline übergibt kalkSettings.aufschlagGesamt.
  aufschlagGesamtProzent?: number;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/** Eingaben des deterministischen Preis-Kerns (eine Formel für Voice UND Editor). */
export interface WholesaleCalcInput {
  ekCent: number;                    // EK in Cent je 1 Einheit (aus CatalogHit)
  mengeProEinheit?: number;          // Materialmenge je Abrechnungseinheit (Default 1)
  minuten?: number;                  // Arbeitszeit je Einheit (Default 0 = reine Materialposition)
  stundensatz: number;               // €/h
  aufschlagMaterialProzent: number;
  aufschlagGesamtProzent?: number;
}

/**
 * DER Preis-Kern: VK = (EK×Menge×(1+Materialaufschlag) + Minuten/60×Satz) × (1+Gesamtaufschlag).
 * Rundung erst auf die Summe (round2) – Cent-identisch für alle Aufrufer.
 */
export function calcWholesaleVk(i: WholesaleCalcInput): number {
  const menge = Number(i.mengeProEinheit ?? 1) || 1;
  const minuten = Math.max(0, Number(i.minuten ?? 0) || 0);
  const materialEuro = (i.ekCent / 100) * menge * (1 + i.aufschlagMaterialProzent / 100);
  const lohnEuro = (minuten / 60) * i.stundensatz;
  return round2((materialEuro + lohnEuro) * (1 + (i.aufschlagGesamtProzent ?? 0) / 100));
}

/** Ein Bauteil der Material-Stückliste einer Position (aus dem Katalog-Block). */
export interface VoiceMaterialTeil {
  artikelnummer?: string | null;
  menge_pro_einheit?: number | null;
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
  preis_deterministisch?: boolean | null;
  // Von der KI gelieferte Material-Fakten (optional):
  // BEVORZUGT: komplette Stückliste (mehrere Bauteile je Position – Verteiler =
  // Kleinverteiler + FI + LS; Steckdose = UP-Dose + Einsatz + Rahmen).
  material_stueckliste?: VoiceMaterialTeil[] | null;
  // Legacy/einfach: genau ein Artikel.
  material_artikelnummer?: string | null;
  material_menge_pro_einheit?: number | null;
  arbeitszeit_min_einheit?: number | null;
}
interface VoiceGewerkLike { name?: string; stundensatz?: number; positionen?: VoicePositionLike[] }

/**
 * Überschreibt den VK aller Positionen, die Material aus dem Großhandels-Block
 * tragen, mit der deterministischen Kalkulation. Bevorzugt die komplette
 * `material_stueckliste` (Summe aller Bauteil-EKs), fällt auf die einzelne
 * `material_artikelnummer` zurück. Positionen aus der eigenen Preisliste
 * (aus_preisliste=true) bleiben unberührt.
 * Gibt die Anzahl der neu bepreisten Positionen zurück.
 */
export function applyWholesalePricing(
  gewerke: VoiceGewerkLike[],
  hits: CatalogHit[],
  opts: WholesalePricingOpts,
): number {
  if (!hits.length) return 0;
  // Bei Artikelnummer-Kollision zweier Kataloge gewinnt der Treffer mit dem
  // HÖCHSTEN Score (die KI referenziert nur die Artikelnummer; ein naives
  // new Map(hits.map(...)) wäre last-wins = niedrigster Score).
  const byArtnr = new Map<string, CatalogHit>();
  for (const h of hits) {
    const prev = byArtnr.get(h.artikelnummer);
    if (!prev || h.score > prev.score) byArtnr.set(h.artikelnummer, h);
  }
  let count = 0;
  for (const g of gewerke) {
    for (const p of g.positionen ?? []) {
      if (p.aus_preisliste) continue;
      // Stückliste zusammenstellen: bevorzugt material_stueckliste (mehrere
      // Bauteile), sonst die einzelne material_artikelnummer. Nur Artikel,
      // die wirklich im Katalog-Block standen (byArtnr) – keine erfundenen.
      const teile: Array<{ hit: CatalogHit; menge: number }> = [];
      for (const t of p.material_stueckliste ?? []) {
        const nr = String(t?.artikelnummer ?? "").trim();
        const hit = nr ? byArtnr.get(nr) : undefined;
        if (!hit) continue;
        teile.push({ hit, menge: Math.max(0, Number(t?.menge_pro_einheit ?? 1) || 1) });
      }
      if (teile.length === 0) {
        const artnr = (p.material_artikelnummer ?? "").trim();
        const hit = artnr ? byArtnr.get(artnr) : undefined;
        if (hit) teile.push({ hit, menge: Math.max(0, Number(p.material_menge_pro_einheit ?? 1) || 1) });
      }
      if (teile.length === 0) continue;
      const satz = Number(p.stundensatz ?? g.stundensatz ?? opts.stundensatzDefault) || opts.stundensatzDefault;
      const materialEkCent = teile.reduce((sum, t) => sum + t.hit.ek_cent * t.menge, 0);
      const vk = calcWholesaleVk({
        ekCent: materialEkCent,
        minuten: Number(p.arbeitszeit_min_einheit ?? 0) || 0,
        stundensatz: satz,
        aufschlagMaterialProzent: opts.aufschlagMaterialProzent,
        aufschlagGesamtProzent: opts.aufschlagGesamtProzent,
      });
      if (vk <= 0) continue;
      p.vk_netto_einheit = vk;
      p.preis_deterministisch = true; // Pipeline: nicht erneut ableiten/anheben
      annotateStueckliste(p, teile);
      count++;
    }
    // NOTNAGEL: Neu-Kalkulationen, die ohne Preis (≤ 0) aus der KI kommen und
    // keine Artikelnummer tragen, per Token-Übereinstimmung gegen die
    // Katalog-Treffer nachbepreisen – verhindert 0-€-Positionen im Angebot.
    for (const p of g.positionen ?? []) {
      if (p.aus_preisliste || Number(p.vk_netto_einheit ?? 0) > 0) continue;
      const hit = bestTokenMatch(`${p.leistungsname ?? ""} ${p.beschreibung ?? ""}`, hits);
      if (!hit) continue;
      const satz = Number(p.stundensatz ?? g.stundensatz ?? opts.stundensatzDefault) || opts.stundensatzDefault;
      const vk = calcWholesaleVk({
        ekCent: hit.ek_cent,
        minuten: defaultMinuten(p.einheit),
        stundensatz: satz,
        aufschlagMaterialProzent: opts.aufschlagMaterialProzent,
        aufschlagGesamtProzent: opts.aufschlagGesamtProzent,
      });
      if (vk <= 0) continue;
      p.vk_netto_einheit = vk;
      p.preis_deterministisch = true; // Pipeline: nicht erneut ableiten/anheben
      annotate(p, hit, " (automatisch nachkalkuliert)");
      count++;
    }
  }
  return count;
}

/** Schreibt die komplette Stückliste (n× Art. … Bezeichnung) in die Beschreibung. */
function annotateStueckliste(p: VoicePositionLike, teile: Array<{ hit: CatalogHit; menge: number }>): void {
  if (teile.length === 1 && teile[0].menge === 1) { annotate(p, teile[0].hit); return; }
  const zeilen = teile.map((t) =>
    `${t.menge % 1 === 0 ? t.menge : t.menge.toFixed(2)}× Art. ${t.hit.artikelnummer} ${t.hit.bezeichnung.slice(0, 50)}`);
  const metall = teile.some((t) => t.hit.metall);
  const hinweis = `Material lt. Großhandelskatalog: ${zeilen.join(" | ")}` +
    (metall ? " – zzgl. tagesaktueller Metallzuschlag" : "");
  const besch = String(p.beschreibung ?? "").trim();
  if (!besch.includes(teile[0].hit.artikelnummer)) {
    p.beschreibung = besch ? `${besch}\n${hinweis}` : hinweis;
  }
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

// ── Katalog-Treffer → Dokument-Position (manueller Picker im Editor) ────────
// Genutzt von ContentSidebar/MultiInsertModal in ALLEN Dokument-Editoren
// (Angebot, Auftrag, Rechnung, Nachtrag). Gleicher Preis-Kern wie die
// Voice-Pipeline → EINE Preiswelt, keine Doppellogik.

/** Datanorm-Einheiten auf App-Einheiten mappen (PCE→Stk, MTR→m …). */
export function normalizeCatalogUnit(einheit: string | null | undefined): string {
  const e = (einheit ?? "").trim().toUpperCase();
  if (!e) return "Stk";
  if (["PCE", "ST", "STK", "STCK", "C62"].includes(e)) return "Stk";
  if (["MTR", "M", "LFM"].includes(e)) return "m";
  if (["MTK", "M2", "QM"].includes(e)) return "m²";
  if (["PAA", "PR"].includes(e)) return "Paar";
  if (["SET", "SA"].includes(e)) return "Set";
  if (["PAK", "PK"].includes(e)) return "Pkg";
  if (["ROL", "RO"].includes(e)) return "Rolle";
  if (["KGM", "KG"].includes(e)) return "kg";
  return einheit as string; // unbekannt → Original beibehalten
}

export interface CatalogHitToPositionOpts {
  kalk: { aufschlagMaterial: number; aufschlagGesamt?: number; stundensatzDefault: number };
  qty?: number;          // Default 1
  minuten?: number;      // Arbeitszeit je Einheit; Default 0 = reine Materialposition
  stundensatz?: number;  // überschreibt kalk.stundensatzDefault
  vatRate?: number;      // MUSS vom Dokument kommen (Reverse Charge §19: 0) – Default 20
}

/**
 * Macht aus einem Katalog-Treffer eine fertige Dokument-Position.
 * unit_price = deterministischer VK (calcWholesaleVk), unit_cost/material_cost = EK.
 * surcharge_baked=true: der Standardaufschlag ist bereits im VK enthalten –
 * applySurchargeToPositions darf beim Speichern nicht noch einmal aufschlagen
 * (gleiche Konvention wie heroToDocPositions für Voice-Positionen).
 */
export function catalogHitToDocPosition(hit: CatalogHit, opts: CatalogHitToPositionOpts): DocPosition {
  const ekEuro = round2(hit.ek_cent / 100);
  const minuten = Math.max(0, Number(opts.minuten ?? 0) || 0);
  const vk = calcWholesaleVk({
    ekCent: hit.ek_cent,
    minuten,
    stundensatz: Number(opts.stundensatz ?? opts.kalk.stundensatzDefault) || opts.kalk.stundensatzDefault,
    aufschlagMaterialProzent: opts.kalk.aufschlagMaterial,
    aufschlagGesamtProzent: opts.kalk.aufschlagGesamt,
  });
  const lieferant = hit.katalog_name ? ` (${hit.katalog_name})` : "";
  const beschreibung =
    `Art. ${hit.artikelnummer} lt. Großhandelskatalog${lieferant}` +
    (hit.metall ? ", zzgl. tagesaktueller Metallzuschlag" : "");
  return emptyPosition("free", {
    name: hit.bezeichnung,
    description: beschreibung,
    qty: Math.max(0.01, Number(opts.qty ?? 1) || 1),
    unit: normalizeCatalogUnit(hit.einheit),
    unit_price: vk,
    unit_cost: ekEuro,
    material_cost: ekEuro,
    labor_minutes: minuten,
    vat_rate: Number.isFinite(opts.vatRate as number) ? (opts.vatRate as number) : 20,
    surcharge_baked: true,
    price_overridden: false,
  });
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
