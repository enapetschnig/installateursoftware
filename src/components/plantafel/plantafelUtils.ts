// ============================================================
// B4Y SuperAPP – Plantafel: reine Helfer (ohne React/Supabase)
// ------------------------------------------------------------
// Rasteraufbau (Tage-Array), Positionierung eines Einsatz-Balkens
// (Start/Ende -> Spaltenindex + Breite in %), Lane-Stacking bei
// Überlappungen (überlappende Einsätze bekommen eigene Zeilen-Lanes,
// statt sich zu verdecken), Auto-Kontrast-Textfarbe und Einsatzfarbe
// (eigene Farbe > Projekt-Board-Farbe > deterministischer Hash).
//
// Bewusst dependency-frei: dadurch überall (auch in Tests) nutzbar und
// unabhängig vom Datenlayer. Datums-Navigation (startOfWeek etc.) kommt
// weiterhin aus src/lib/planning.ts – hier nur Raster-/Layout-Mathematik.
// ============================================================

// ── Datums-Grundlagen (lokal, ohne Zeitzonen-Überraschungen) ──

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Lokales ISO-Datum `YYYY-MM-DD` (ohne UTC-Verschiebung). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Tagesanfang (00:00:00.000) einer lokalen Zeit. */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** N Tage addieren (neues Date, lokal). */
function addDaysLocal(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Ganze Kalendertage zwischen zwei Zeitpunkten (b - a), robust gegen Sommerzeit. */
function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

/** Gleicher Kalendertag? */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Tages-Raster ──────────────────────────────────────────────

export type DayCell = {
  date: Date;            // lokaler Tagesanfang
  iso: string;           // YYYY-MM-DD
  weekday: number;       // 0 = Mo … 6 = So
  isWeekend: boolean;    // Sa/So
  isToday: boolean;
  isHoliday: boolean;
  holidayName: string | null;
};

/**
 * Baut das Tage-Array für die Tafel.
 * @param start  erster sichtbarer Tag
 * @param count  Anzahl Tage (7 = Woche, 28–31 = Monat)
 * @param holidays  Map iso->Bezeichnung ODER Set der Feiertags-ISO-Daten
 */
export function buildDayGrid(
  start: Date,
  count: number,
  holidays?: Map<string, string> | Set<string> | null,
): DayCell[] {
  const todayIso = isoDate(new Date());
  const base = startOfDay(start);
  const out: DayCell[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDaysLocal(base, i);
    const iso = isoDate(date);
    const weekday = (date.getDay() + 6) % 7; // Mo=0 … So=6
    let isHoliday = false;
    let holidayName: string | null = null;
    if (holidays instanceof Map) {
      if (holidays.has(iso)) { isHoliday = true; holidayName = holidays.get(iso) ?? null; }
    } else if (holidays instanceof Set) {
      if (holidays.has(iso)) isHoliday = true;
    }
    out.push({ date, iso, weekday, isWeekend: weekday >= 5, isToday: iso === todayIso, isHoliday, holidayName });
  }
  return out;
}

// ── Einsatz-Balken: Spaltenspanne & Position ──────────────────

export type DaySpan = {
  startIdx: number;      // erster belegter Spaltenindex (0-basiert, im Raster)
  endIdx: number;        // letzter belegter Spaltenindex (inklusive)
  clippedStart: boolean; // Balken beginnt vor dem sichtbaren Raster
  clippedEnd: boolean;   // Balken endet nach dem sichtbaren Raster
};

/**
 * Bestimmt die Spaltenspanne eines Einsatzes (Start/Ende) im Tages-Raster.
 * Liefert `null`, wenn der Einsatz komplett außerhalb des sichtbaren Zeitraums liegt.
 * Ein Ende exakt um 00:00 zählt NICHT als weiterer Tag (halb-offenes Intervall).
 */
export function eventDaySpan(
  startAt: string | Date,
  endAt: string | Date,
  gridStart: Date,
  dayCount: number,
): DaySpan | null {
  const gs = startOfDay(gridStart);
  const gridEndExcl = addDaysLocal(gs, dayCount); // 00:00 nach dem letzten Tag (exklusiv)
  const s = startAt instanceof Date ? startAt : new Date(startAt);
  const e = endAt instanceof Date ? endAt : new Date(endAt);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;

  // Letzter belegter Moment: Ende minus 1ms (aber nie vor dem Start).
  const effEnd = new Date(Math.max(e.getTime() - 1, s.getTime()));

  if (e.getTime() <= gs.getTime()) return null;              // endet vor dem Raster
  if (s.getTime() >= gridEndExcl.getTime()) return null;     // beginnt nach dem Raster

  const rawStartIdx = dayDiff(gs, s);
  const rawEndIdx = dayDiff(gs, effEnd);
  const startIdx = Math.max(0, rawStartIdx);
  const endIdx = Math.min(dayCount - 1, rawEndIdx);
  if (endIdx < startIdx) return null;

  return {
    startIdx,
    endIdx,
    clippedStart: rawStartIdx < 0,
    clippedEnd: rawEndIdx > dayCount - 1,
  };
}

export type BarPos = { leftPct: number; widthPct: number };

/** Wandelt eine Spaltenspanne in prozentuale Position/Breite (relativ zur Zeitleiste) um. */
export function barPosition(span: DaySpan, dayCount: number): BarPos {
  const cols = Math.max(1, dayCount);
  const leftPct = (span.startIdx / cols) * 100;
  const widthPct = ((span.endIdx - span.startIdx + 1) / cols) * 100;
  return { leftPct, widthPct };
}

// ── Lane-Stacking (Überlappungen sauber stapeln) ──────────────

export type LaneItem<T> = { item: T; span: DaySpan; lane: number };

/**
 * Verteilt (nach Spaltenspanne) überlappende Einträge auf möglichst wenige Lanes
 * (Greedy-Intervallfärbung). Zwei Einträge überlappen, wenn sich ihre Tagesspannen
 * berühren. Rückgabe: Einträge mit Lane-Index + Gesamtzahl der Lanes (min. 1).
 */
export function assignLanes<T>(entries: { item: T; span: DaySpan }[]): { rows: LaneItem<T>[]; laneCount: number } {
  const sorted = [...entries].sort(
    (a, b) => a.span.startIdx - b.span.startIdx || a.span.endIdx - b.span.endIdx,
  );
  const laneEnds: number[] = []; // je Lane der zuletzt belegte endIdx
  const rows: LaneItem<T>[] = [];
  for (const en of sorted) {
    let lane = laneEnds.findIndex((end) => end < en.span.startIdx);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(en.span.endIdx);
    } else {
      laneEnds[lane] = en.span.endIdx;
    }
    rows.push({ item: en.item, span: en.span, lane });
  }
  return { rows, laneCount: Math.max(1, laneEnds.length) };
}

// ── Farben ────────────────────────────────────────────────────

/** Normalisiert einen Hex-String zu 6-stelligem Kleinbuchstaben-Hex ohne #; sonst null. */
function normalizeHex(input?: string | null): string | null {
  if (!input) return null;
  let h = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(h) ? h : null;
}

/**
 * Wählt eine gut lesbare Textfarbe (dunkles Slate oder Weiß) passend zur
 * Hintergrundfarbe (relative Helligkeit). Fallback: dunkel.
 */
export function autoContrastText(hex: string): string {
  const c = normalizeHex(hex);
  if (!c) return "#0f172a";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0f172a" : "#ffffff";
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const color = ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Deterministische, angenehme Farbe aus einem beliebigen Seed (z. B. Projekt-/Einsatz-ID). */
export function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 60, 52);
}

/**
 * Farbe eines Einsatz-Balkens: eigene Einsatzfarbe > Projekt-Board-Farbe > Hash-Fallback.
 * Nur gültige Hex-Werte gewinnen; sonst wird stabil aus dem Seed abgeleitet.
 */
export function einsatzColor(opts: { eventColor?: string | null; boardColor?: string | null; seed: string }): string {
  const own = normalizeHex(opts.eventColor);
  if (own) return `#${own}`;
  const board = normalizeHex(opts.boardColor);
  if (board) return `#${board}`;
  return hashColor(opts.seed || "einsatz");
}
