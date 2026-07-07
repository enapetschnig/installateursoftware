// ============================================================
// B4Y SuperAPP – Zentrale Auftrags-Status-Logik
// EINE Quelle der Wahrheit statt verstreuter hartkodierter Status-Strings.
// Mandantenneutral, keine firmenspezifische Logik.
// ============================================================
import { isDeletable } from "./document-delete";

export type OrderLike = { status?: string | null; deleted_at?: string | null } & Record<string, unknown>;

export const ORDER_DRAFT_STATUS = "entwurf";
/** Status, in denen ein Auftrag fachlich NICHT mehr aktiv ist. */
export const ORDER_INACTIVE_STATUSES = ["storniert", "archiviert"] as const;

const st = (o?: OrderLike | null): string => (o?.status ?? "").toLowerCase();

/** Frei bearbeitbarer/löschbarer Entwurf. */
export const isDraftOrder = (o?: OrderLike | null): boolean => st(o) === ORDER_DRAFT_STATUS;
export const isCancelledOrder = (o?: OrderLike | null): boolean => st(o) === "storniert";
export const isArchivedOrder = (o?: OrderLike | null): boolean => st(o) === "archiviert";

/**
 * Zählt dieser Auftrag als AKTIVE Beauftragung (für „bereits beauftragt"-Schutz,
 * offene Summen, Zähler)? Gelöscht/storniert/archiviert → nein.
 */
export const countsAsActiveOrder = (o?: OrderLike | null): boolean =>
  !!o && !o.deleted_at && !(ORDER_INACTIVE_STATUSES as readonly string[]).includes(st(o));

/** Verbindlich/finalisiert (nicht Entwurf, nicht inaktiv) – z. B. beauftragt / in Arbeit / verrechnet. */
export const isActiveOrder = (o?: OrderLike | null): boolean =>
  countsAsActiveOrder(o) && st(o) !== ORDER_DRAFT_STATUS;

/** Nur Entwürfe dürfen hart gelöscht werden (delegiert an die zentrale Lösch-Registry). */
export const canDeleteOrder = (o?: OrderLike | null): boolean => isDeletable("order", o as never);

/** Stornierbar: alles außer bereits storniert oder bloßer Entwurf (Entwürfe werden gelöscht). */
export const canCancelOrder = (o?: OrderLike | null): boolean =>
  !!o && !o.deleted_at && st(o) !== "storniert" && st(o) !== ORDER_DRAFT_STATUS;

/** Archivierbar: alles außer bereits archiviert. */
export const canArchiveOrder = (o?: OrderLike | null): boolean =>
  !!o && !o.deleted_at && st(o) !== "archiviert";

/** Storniert/archiviert → schreibgeschützt (nicht mehr bearbeitbar). */
export const isOrderReadonly = (o?: OrderLike | null): boolean =>
  isCancelledOrder(o) || isArchivedOrder(o);

/**
 * Zentrale Badge-Farbe je Auftragsstatus (EINE Quelle für alle Listen/Editoren).
 * Storniert ist IMMER rot sichtbar – storniert ist nicht gelöscht.
 */
export function orderStatusTone(s?: string | null): "slate" | "blue" | "green" | "amber" | "red" {
  const v = (s ?? "").toLowerCase();
  if (v === "beauftragt" || v === "in_arbeit") return "blue";
  if (v === "voll_verrechnet") return "green";
  if (v === "teilw_verrechnet") return "amber";
  if (v === "storniert") return "red";
  return "slate"; // entwurf, archiviert, unbekannt
}
