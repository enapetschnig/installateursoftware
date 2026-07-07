export const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));

export const dateAt = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d)) : "–";

/** Datum + Uhrzeit (TT.MM.JJJJ, HH:mm) – für Listen mit mehreren Einträgen pro Tag.
 *  Liest aus dem echten Zeitstempel; Sortierung bleibt nach Rohwert. */
export const dateTimeAt = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("de-AT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(d)) : "–";

/** Nur Uhrzeit (HH:mm) – zum Stapeln unter das Datum (schmalere Tabellen). */
export const timeAt = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d)) : "";

export const initials = (name?: string | null) =>
  (name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
