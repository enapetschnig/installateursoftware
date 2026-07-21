// ============================================================
// Installateur SuperAPP – Projekt-Struktur (Art → Stufe → Anzahl)
// ------------------------------------------------------------
// „Badsanierung aufklappen und sehen, wie viele in welcher Stufe sind."
//
// Zwei Wege zur selben Struktur:
//   * buildStruktur(projekte)     – aus bereits geladenen Projekten
//     (Projekte-Seite: 0 Extra-Requests, Zähler folgen den aktiven Filtern)
//   * loadStrukturAggregat()      – EIN Request auf die View projekt_verteilung
//     (Dashboard: dort sind die Projekte gar nicht geladen)
// ============================================================
import { supabase } from "./supabase";

export interface StrukturStufe {
  label: string;
  anzahl: number;
  volumen: number;
  /** Farbe aus project_statuses_global.color (Fallback slate). */
  color: string;
}

export interface StrukturArt {
  art: string;
  anzahl: number;
  volumen: number;
  stufen: StrukturStufe[];
}

/** Projekt-Minimalform, die für die Struktur reicht. */
export interface StrukturProjekt {
  category?: string | null;
  stage?: string | null;
  budget?: number | string | null;
}

export const OHNE_ART = "(ohne Projektart)";
export const OHNE_STUFE = "(ohne Stufe)";

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Baut die Struktur aus geladenen Projekten – EIN Durchlauf, keine
 * verschachtelten filter()-Aufrufe.
 * `stufenReihenfolge` (Labels je Art) und `farben` kommen aus der
 * Projekt-Konfiguration, damit die Reihenfolge der echten Stufenfolge
 * entspricht und nicht alphabetisch ist.
 */
export function buildStruktur(
  projekte: StrukturProjekt[],
  opts: {
    artReihenfolge?: string[];
    stufenFuerArt?: (art: string) => string[];
    farben?: Record<string, string>;
  } = {},
): StrukturArt[] {
  const map = new Map<string, Map<string, { anzahl: number; volumen: number }>>();
  for (const p of projekte) {
    const art = (p.category ?? "").trim() || OHNE_ART;
    const stufe = (p.stage ?? "").trim() || OHNE_STUFE;
    const inner = map.get(art) ?? new Map();
    const cur = inner.get(stufe) ?? { anzahl: 0, volumen: 0 };
    cur.anzahl += 1;
    cur.volumen += num(p.budget);
    inner.set(stufe, cur);
    map.set(art, inner);
  }
  return sortiere(map, opts);
}

/** Struktur direkt aus der Aggregat-View (ein Request). */
export async function loadStrukturAggregat(
  opts: {
    artReihenfolge?: string[];
    stufenFuerArt?: (art: string) => string[];
    farben?: Record<string, string>;
  } = {},
): Promise<StrukturArt[]> {
  const { data, error } = await supabase.from("projekt_verteilung").select("*");
  if (error) {
    console.error("Projekt-Struktur konnte nicht geladen werden:", error);
    return [];
  }
  const map = new Map<string, Map<string, { anzahl: number; volumen: number }>>();
  for (const r of (data as Record<string, unknown>[]) ?? []) {
    const art = (r.art as string) ?? OHNE_ART;
    const stufe = (r.stufe as string) ?? OHNE_STUFE;
    const inner = map.get(art) ?? new Map();
    inner.set(stufe, { anzahl: num(r.anzahl), volumen: num(r.volumen_netto) });
    map.set(art, inner);
  }
  return sortiere(map, opts);
}

function sortiere(
  map: Map<string, Map<string, { anzahl: number; volumen: number }>>,
  opts: {
    artReihenfolge?: string[];
    stufenFuerArt?: (art: string) => string[];
    farben?: Record<string, string>;
  },
): StrukturArt[] {
  const artIdx = new Map((opts.artReihenfolge ?? []).map((a, i) => [a, i]));
  const arten: StrukturArt[] = [];

  for (const [art, inner] of map) {
    // Stufen in der ECHTEN Reihenfolge der Projektart; real vorkommende,
    // aber nicht konfigurierte Stufen hinten anhängen (nie verschlucken).
    const soll = opts.stufenFuerArt?.(art) ?? [];
    const idx = new Map(soll.map((s, i) => [s, i]));
    const stufen: StrukturStufe[] = [...inner.entries()]
      .map(([label, v]) => ({
        label,
        anzahl: v.anzahl,
        volumen: v.volumen,
        color: opts.farben?.[label] ?? "slate",
      }))
      .sort((a, b) => (idx.get(a.label) ?? 999) - (idx.get(b.label) ?? 999) || a.label.localeCompare(b.label, "de"));

    arten.push({
      art,
      anzahl: stufen.reduce((s, x) => s + x.anzahl, 0),
      volumen: stufen.reduce((s, x) => s + x.volumen, 0),
      stufen,
    });
  }

  return arten.sort((a, b) => {
    // "(ohne Projektart)" immer ans Ende
    if (a.art === OHNE_ART) return 1;
    if (b.art === OHNE_ART) return -1;
    const ia = artIdx.get(a.art) ?? 999;
    const ib = artIdx.get(b.art) ?? 999;
    return ia - ib || a.art.localeCompare(b.art, "de");
  });
}
