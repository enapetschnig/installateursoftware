// ============================================================
// B4Y SuperAPP – RRULE-Hilfsfunktionen (Terminserien)
// Reine String-Verarbeitung ohne externe rrule-Bibliothek.
// Unterstützt (RFC 5545): FREQ (DAILY/WEEKLY/MONTHLY/YEARLY), INTERVAL,
// BYDAY, BYMONTHDAY (inkl. -1 = letzter Tag), BYSETPOS (n-ter/letzter
// Wochentag), BYMONTH, COUNT, UNTIL.
// Mandantenneutral: keine firmenspezifische Logik.
// ============================================================

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface RRuleOptions {
  freq: Frequency;
  interval?: number;            // Standard 1
  byDay?: Weekday[];            // v. a. für WEEKLY, oder mit BYSETPOS für MONTHLY/YEARLY
  byMonthDay?: number[];        // BYMONTHDAY (1..31, -1 = letzter Tag des Monats)
  bySetPos?: number | null;     // BYSETPOS (1..4 oder -1 = letzter)
  byMonth?: number[];           // BYMONTH (1..12), v. a. für YEARLY
  count?: number | null;        // COUNT
  until?: Date | null;          // UNTIL (RFC 5545, UTC)
}

// Reihenfolge Mo→So (ISO). Index 0 = Montag.
const WD_ORDER: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const WD_LABEL_DE: Record<Weekday, string> = { MO: "Mo", TU: "Di", WE: "Mi", TH: "Do", FR: "Fr", SA: "Sa", SU: "So" };
const WD_LABEL_EN: Record<Weekday, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const WD_FULL_DE: Record<Weekday, string> = { MO: "Montag", TU: "Dienstag", WE: "Mittwoch", TH: "Donnerstag", FR: "Freitag", SA: "Samstag", SU: "Sonntag" };
const MONTHS_DE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WORKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

const pad = (n: number): string => String(n).padStart(2, "0");
const isWeekday = (s: string): s is Weekday => (WD_ORDER as string[]).includes(s);

/** 0 = Montag … 6 = Sonntag */
function weekdayIndex(w: Weekday): number { return WD_ORDER.indexOf(w); }
/** Wochentag eines Datums als RRULE-Kürzel (Mo-basiert) */
function dateToWeekday(d: Date): Weekday { return WD_ORDER[(d.getDay() + 6) % 7]; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeekMonday(d: Date): Date {
  const x = new Date(d); const off = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - off); x.setHours(0, 0, 0, 0); return x;
}
function daysInMonth(year: number, month0: number): number { return new Date(year, month0 + 1, 0).getDate(); }
/** Prüft, ob die Wochentagsliste exakt Mo–Fr (alle Werktage) abdeckt. */
function isWorkdaySet(days?: Weekday[]): boolean {
  if (!days || days.length < 5) return false;
  return WORKDAYS.every((d) => days.includes(d));
}

/** Date → UNTIL-String im RFC-5545-UTC-Format (YYYYMMDDTHHMMSSZ). */
function toUntilString(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** UNTIL-String → Date. Akzeptiert YYYYMMDD und YYYYMMDDTHHMMSS(Z). */
function parseUntilString(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!m) { const fallback = new Date(s); return isNaN(fallback.getTime()) ? null : fallback; }
  const [, y, mo, da, h, mi, se, z] = m;
  if (h === undefined) return new Date(Number(y), Number(mo) - 1, Number(da), 23, 59, 59);
  if (z) return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(se)));
  return new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(se));
}

/**
 * Baut einen RRULE-String aus den Optionen.
 * → z. B. "FREQ=MONTHLY;INTERVAL=3;BYDAY=SA;BYSETPOS=1"
 * COUNT und UNTIL schließen sich gegenseitig aus (RFC 5545); COUNT hat Vorrang.
 */
export function buildRRule(opts: RRuleOptions): string {
  const parts: string[] = [`FREQ=${opts.freq}`];
  const interval = opts.interval ?? 1;
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (opts.byDay && opts.byDay.length) {
    const ordered = [...opts.byDay].sort((a, b) => weekdayIndex(a) - weekdayIndex(b));
    parts.push(`BYDAY=${ordered.join(",")}`);
  }
  if (opts.byMonthDay && opts.byMonthDay.length) parts.push(`BYMONTHDAY=${opts.byMonthDay.join(",")}`);
  if (opts.byMonth && opts.byMonth.length) parts.push(`BYMONTH=${opts.byMonth.join(",")}`);
  if (opts.bySetPos != null) parts.push(`BYSETPOS=${opts.bySetPos}`);
  if (opts.count != null && opts.count > 0) parts.push(`COUNT=${opts.count}`);
  else if (opts.until) parts.push(`UNTIL=${toUntilString(opts.until)}`);
  return parts.join(";");
}

/** Zerlegt einen RRULE-String wieder in Optionen. */
export function parseRRule(rrule: string): RRuleOptions {
  const out: RRuleOptions = { freq: "DAILY", interval: 1 };
  for (const token of rrule.split(";")) {
    const [rawKey, rawVal] = token.split("=");
    if (!rawKey || rawVal === undefined) continue;
    const key = rawKey.trim().toUpperCase();
    const val = rawVal.trim();
    switch (key) {
      case "FREQ":
        if (val === "DAILY" || val === "WEEKLY" || val === "MONTHLY" || val === "YEARLY") out.freq = val;
        break;
      case "INTERVAL": {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n > 0) out.interval = n;
        break;
      }
      case "BYDAY":
        out.byDay = val.split(",").map((s) => s.trim().toUpperCase()).filter(isWeekday);
        break;
      case "BYMONTHDAY":
        out.byMonthDay = val.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        break;
      case "BYMONTH":
        out.byMonth = val.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 1 && n <= 12);
        break;
      case "BYSETPOS": {
        const n = parseInt(val, 10);
        if (!isNaN(n)) out.bySetPos = n;
        break;
      }
      case "COUNT": {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n > 0) out.count = n;
        break;
      }
      case "UNTIL": {
        const d = parseUntilString(val);
        if (d) out.until = d;
        break;
      }
    }
  }
  return out;
}

// ── interne Datums-Auflöser ────────────────────────────────
/** Konkretes Datum für eine BYMONTHDAY-Regel in einem Monat (null, wenn es den Tag nicht gibt). */
function resolveMonthDay(year: number, month0: number, monthDay: number): Date | null {
  const dim = daysInMonth(year, month0);
  const day = monthDay === -1 ? dim : monthDay;
  if (day < 1 || day > dim) return null; // z. B. 31. in kurzen Monaten → überspringen
  return new Date(year, month0, day);
}
/** Konkretes Datum für „n-ter/letzter Wochentag" (BYDAY + BYSETPOS) in einem Monat. */
function resolveSetPos(year: number, month0: number, byDay: Weekday[], setPos: number): Date | null {
  const dim = daysInMonth(year, month0);
  const matches: Date[] = [];
  for (let day = 1; day <= dim; day++) {
    const d = new Date(year, month0, day);
    if (byDay.includes(dateToWeekday(d))) matches.push(d);
  }
  if (!matches.length) return null;
  if (setPos === -1) return matches[matches.length - 1];
  return matches[setPos - 1] ?? null;
}
/** Liefert das Vorkommen in (year, month0) gemäß Monats-/Jahres-Regel – oder null. */
function resolveInMonth(year: number, month0: number, opt: RRuleOptions, fallbackDay: number): Date | null {
  if (opt.byMonthDay && opt.byMonthDay.length) return resolveMonthDay(year, month0, opt.byMonthDay[0]);
  if (opt.bySetPos != null && opt.byDay && opt.byDay.length) return resolveSetPos(year, month0, opt.byDay, opt.bySetPos);
  return resolveMonthDay(year, month0, fallbackDay);
}

/**
 * Berechnet die konkreten Termine einer Serie ab `dtstart`.
 * Begrenzt durch COUNT/UNTIL der Regel oder – als Sicherheitsnetz – durch `count`
 * bzw. eine Obergrenze. Liefert die Startzeitpunkte (inkl. dtstart als erstem Treffer,
 * sofern dieser die Regel erfüllt).
 */
export function getOccurrences(rrule: string, dtstart: Date, count?: number): Date[] {
  const opt = parseRRule(rrule);
  const interval = Math.max(1, opt.interval ?? 1);
  const until = opt.until ? opt.until.getTime() : null;
  const limit = opt.count ?? count ?? (until ? 10000 : 200);
  const MAX_ITER = 20000;
  const out: Date[] = [];
  const within = (d: Date): boolean => until === null || d.getTime() <= until;
  const applyTime = (d: Date): Date => {
    const x = new Date(d);
    x.setHours(dtstart.getHours(), dtstart.getMinutes(), dtstart.getSeconds(), 0);
    return x;
  };

  // ── WEEKLY mit konkreten Wochentagen ─────────────────────
  if (opt.freq === "WEEKLY" && opt.byDay && opt.byDay.length) {
    const targets = opt.byDay.map(weekdayIndex).sort((a, b) => a - b);
    let weekStart = startOfWeekMonday(dtstart);
    let iter = 0;
    while (out.length < limit && iter < MAX_ITER) {
      for (const t of targets) {
        const d = applyTime(addDays(weekStart, t));
        if (d.getTime() < dtstart.getTime()) continue; // Treffer vor Serienstart überspringen
        if (!within(d)) return out;
        out.push(d);
        if (out.length >= limit) return out;
      }
      weekStart = addDays(weekStart, 7 * interval);
      iter++;
    }
    return out;
  }

  // ── MONTHLY mit BYMONTHDAY oder BYSETPOS ──────────────────
  if (opt.freq === "MONTHLY" && ((opt.byMonthDay && opt.byMonthDay.length) || opt.bySetPos != null)) {
    let year = dtstart.getFullYear();
    let month0 = dtstart.getMonth();
    let iter = 0;
    while (out.length < limit && iter < MAX_ITER) {
      if (until !== null && new Date(year, month0, 1).getTime() > until) break;
      const base = resolveInMonth(year, month0, opt, dtstart.getDate());
      if (base) {
        const d = applyTime(base);
        if (d.getTime() >= dtstart.getTime()) {
          if (!within(d)) break;
          out.push(d);
        }
      }
      month0 += interval;
      year += Math.floor(month0 / 12);
      month0 = ((month0 % 12) + 12) % 12;
      iter++;
    }
    return out;
  }

  // ── YEARLY ────────────────────────────────────────────────
  if (opt.freq === "YEARLY") {
    const months = (opt.byMonth && opt.byMonth.length ? [...opt.byMonth].sort((a, b) => a - b) : [dtstart.getMonth() + 1]);
    let year = dtstart.getFullYear();
    let iter = 0;
    while (out.length < limit && iter < MAX_ITER) {
      if (until !== null && new Date(year, 0, 1).getTime() > until) break;
      for (const m of months) {
        const base = resolveInMonth(year, m - 1, opt, dtstart.getDate());
        if (!base) continue;
        const d = applyTime(base);
        if (d.getTime() < dtstart.getTime()) continue;
        if (!within(d)) return out;
        out.push(d);
        if (out.length >= limit) return out;
      }
      year += interval;
      iter++;
    }
    return out;
  }

  // ── DAILY / WEEKLY (ohne BYDAY) / MONTHLY (einfacher Schritt) ──
  let cur = new Date(dtstart);
  let iter = 0;
  while (out.length < limit && iter < MAX_ITER) {
    if (!within(cur)) break;
    out.push(new Date(cur));
    if (opt.freq === "DAILY") cur = addDays(cur, interval);
    else if (opt.freq === "WEEKLY") cur = addDays(cur, 7 * interval);
    else { const n = new Date(cur); n.setMonth(n.getMonth() + interval); cur = n; }
    iter++;
  }
  return out;
}

/** Positions-Label für BYSETPOS (1..4 / -1). */
function setPosLabel(pos: number, en: boolean): string {
  if (pos === -1) return en ? "last" : "letzten";
  const de = ["", "ersten", "zweiten", "dritten", "vierten"];
  const enL = ["", "first", "second", "third", "fourth"];
  return (en ? enL[pos] : de[pos]) ?? (en ? `${pos}.` : `${pos}.`);
}

/**
 * Liefert eine menschenlesbare Beschreibung der Serie.
 * → z. B. "Monatlich am ersten Samstag" · Standard-Sprache Deutsch.
 */
export function humanReadableRRule(rrule: string, locale = "de"): string {
  if (!rrule) return "";
  const en = locale.toLowerCase().startsWith("en");
  const opt = parseRRule(rrule);
  const n = opt.interval ?? 1;
  const labels = en ? WD_LABEL_EN : WD_LABEL_DE;

  let base: string;
  if (opt.freq === "DAILY") {
    base = n === 1 ? (en ? "Daily" : "Täglich") : (en ? `Every ${n} days` : `Alle ${n} Tage`);
  } else if (opt.freq === "WEEKLY") {
    base = n === 1 ? (en ? "Weekly" : "Wöchentlich") : (en ? `Every ${n} weeks` : `Alle ${n} Wochen`);
    if (opt.byDay && opt.byDay.length) {
      const days = [...opt.byDay].sort((a, b) => weekdayIndex(a) - weekdayIndex(b)).map((d) => labels[d]).join(", ");
      base += en ? ` on ${days}` : ` am ${days}`;
    }
  } else if (opt.freq === "MONTHLY") {
    if (n === 3) base = en ? "Quarterly" : "Quartalsweise";
    else base = n === 1 ? (en ? "Monthly" : "Monatlich") : (en ? `Every ${n} months` : `Alle ${n} Monate`);
    base += monthlyDetail(opt, en);
  } else { // YEARLY
    base = n === 1 ? (en ? "Yearly" : "Jährlich") : (en ? `Every ${n} years` : `Alle ${n} Jahre`);
    if (opt.byMonth && opt.byMonth.length) {
      const mName = MONTHS_DE[(opt.byMonth[0] - 1) % 12];
      base += en ? ` in ${mName}` : ` im ${mName}`;
    }
    base += monthlyDetail(opt, en);
  }

  if (opt.count != null) base += ` · ${opt.count}×`;
  else if (opt.until) {
    const f = new Intl.DateTimeFormat(en ? "en-GB" : "de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(opt.until);
    base += en ? ` · until ${f}` : ` · bis ${f}`;
  }
  return base;
}

/** Zusatztext für Monats-/Jahresregeln (am 15. / am ersten Samstag / am letzten Werktag). */
function monthlyDetail(opt: RRuleOptions, en: boolean): string {
  if (opt.byMonthDay && opt.byMonthDay.length) {
    const md = opt.byMonthDay[0];
    if (md === -1) return en ? " on the last day" : " am letzten Tag";
    return en ? ` on the ${md}.` : ` am ${md}.`;
  }
  if (opt.bySetPos != null && opt.byDay && opt.byDay.length) {
    const pos = setPosLabel(opt.bySetPos, en);
    if (isWorkdaySet(opt.byDay)) return en ? ` on the ${pos} workday` : ` am ${pos} Werktag`;
    const day = en ? WD_LABEL_EN[opt.byDay[0]] : WD_FULL_DE[opt.byDay[0]];
    return en ? ` on the ${pos} ${day}` : ` am ${pos} ${day}`;
  }
  return "";
}

export { dateToWeekday, isWorkdaySet, WD_ORDER, WD_FULL_DE, MONTHS_DE };
