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
    const words = seg.split(/\s+/).filter(isMeaningful).slice(0, 5);
    if (words.length === 0) continue;
    const q = words.join(" ").toLowerCase();
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
