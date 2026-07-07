// ============================================================
// B4Y SuperAPP – Zentrale Zahlungskonditionen-Logik
// ------------------------------------------------------------
// EINE Quelle der Wahrheit, welche Zahlungskonditionen eines Kontakts in einer
// bestimmten Richtung gelten:
//   • "out" = Ausgangsrechnung  (wir berechnen den Kunden)   → bestehende Felder
//   • "in"  = Eingangsrechnung  (Lieferant/Sub berechnet uns) → in_*-Felder (Migr. 0066)
//
// Die Funktionen akzeptieren bewusst nur die benötigten Felder (Teil-Selects/loose
// Typen erlaubt). Geldfremde Aufbereitung (Rundung etc.) bleibt in der Dokumentlogik;
// hier wird NUR der richtige Satz ausgewählt und als unveränderlicher Snapshot geliefert.
// ============================================================

export type PaymentDirection = "out" | "in";

export interface PaymentConditions {
  termDays: number | null;     // Zahlungsziel in Tagen
  skontoPercent: number | null;
  skontoDays: number | null;
  paymentMethod: string | null;
  paymentNote: string | null;
}

/** Nur die für die Konditionen relevanten Kontaktfelder (Teil-Selects erlaubt). */
export type ContactPaymentParts = {
  payment_term_days?: number | null;
  skonto_percent?: number | null;
  skonto_days?: number | null;
  payment_method?: string | null;
  payment_note?: string | null;
  default_discount_percent?: number | null;   // Ausgangs-Standardnachlass (sichtbar)
  default_surcharge_percent?: number | null;   // Ausgangs-Standardaufschlag (intern/unsichtbar)
  in_payment_term_days?: number | null;
  in_skonto_percent?: number | null;
  in_skonto_days?: number | null;
  in_payment_method?: string | null;
  in_payment_note?: string | null;
  in_discount_percent?: number | null;          // Eingangs-Standardnachlass
};

/**
 * Vollständige Dokument-Konditionen = Zahlungskonditionen + Nachlass + Aufschlag.
 * Wird je Beleg als `conditions_snapshot` (jsonb) festgeschrieben (Migration 0081).
 *   • discountPercent  = Standardnachlass  → im PDF SICHTBAR
 *   • surchargePercent = Standardaufschlag → im PDF UNSICHTBAR, einmalig in EP eingerechnet
 *   • surchargeApplied = Guard, damit der Aufschlag bei Folgedokumenten nicht erneut wirkt
 */
export interface DocumentConditions extends PaymentConditions {
  discountPercent: number | null;
  surchargePercent: number | null;
  surchargeApplied: boolean;
}

const EMPTY: PaymentConditions = {
  termDays: null, skontoPercent: null, skontoDays: null, paymentMethod: null, paymentNote: null,
};

/**
 * Liefert die geltenden Zahlungskonditionen eines Kontakts für die Richtung.
 * Optionaler Default-Zahlungsweg (z. B. "Überweisung"), wenn keiner gesetzt ist.
 */
export function resolvePaymentConditions(
  c: ContactPaymentParts | null | undefined,
  direction: PaymentDirection,
  opts: { defaultMethod?: string | null } = {},
): PaymentConditions {
  if (!c) return { ...EMPTY, paymentMethod: opts.defaultMethod ?? null };
  const out: PaymentConditions = direction === "in"
    ? {
        termDays: c.in_payment_term_days ?? null,
        skontoPercent: c.in_skonto_percent ?? null,
        skontoDays: c.in_skonto_days ?? null,
        paymentMethod: c.in_payment_method ?? null,
        paymentNote: c.in_payment_note ?? null,
      }
    : {
        termDays: c.payment_term_days ?? null,
        skontoPercent: c.skonto_percent ?? null,
        skontoDays: c.skonto_days ?? null,
        paymentMethod: c.payment_method ?? null,
        paymentNote: c.payment_note ?? null,
      };
  if (out.paymentMethod == null && opts.defaultMethod != null) out.paymentMethod = opts.defaultMethod;
  return out;
}

/**
 * Unveränderlicher Snapshot der Konditionen (Kopie) – zum Festschreiben auf einem
 * Dokument, damit spätere Stammdatenänderungen den Dokumentstand nicht verändern.
 */
export function paymentConditionsSnapshot(
  c: ContactPaymentParts | null | undefined,
  direction: PaymentDirection,
  opts: { defaultMethod?: string | null } = {},
): PaymentConditions {
  return { ...resolvePaymentConditions(c, direction, opts) };
}

// ============================================================
// Dokument-Konditionen (Zahlung + Nachlass + Aufschlag)
// ============================================================

const EMPTY_DOC: DocumentConditions = {
  ...EMPTY, discountPercent: null, surchargePercent: null, surchargeApplied: false,
};

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Vollständige Dokument-Konditionen aus einem Kontakt ableiten.
 *   • out: Zahlung/Skonto + default_discount_percent + default_surcharge_percent
 *   • in : Zahlung/Skonto + in_discount_percent (kein Aufschlag)
 * surchargeApplied bleibt false – die Einrechnung in die EP erfolgt einmalig in der
 * Dokumentlogik (Editor/Kette), die danach das Flag setzt.
 */
export function resolveDocumentConditions(
  c: ContactPaymentParts | null | undefined,
  direction: PaymentDirection,
  opts: { defaultMethod?: string | null } = {},
): DocumentConditions {
  const pay = resolvePaymentConditions(c, direction, opts);
  return {
    ...pay,
    discountPercent: direction === "in" ? toNum(c?.in_discount_percent) : toNum(c?.default_discount_percent),
    surchargePercent: direction === "in" ? null : toNum(c?.default_surcharge_percent),
    surchargeApplied: false,
  };
}

/** Normalisiert einen aus der DB gelesenen conditions_snapshot (jsonb) robust. */
export function conditionsFromSnapshot(raw: unknown): DocumentConditions | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    termDays: toNum(r.termDays),
    skontoPercent: toNum(r.skontoPercent),
    skontoDays: toNum(r.skontoDays),
    paymentMethod: (r.paymentMethod as string) ?? null,
    paymentNote: (r.paymentNote as string) ?? null,
    discountPercent: toNum(r.discountPercent),
    surchargePercent: toNum(r.surchargePercent),
    surchargeApplied: r.surchargeApplied === true,
  };
}

/** Plain-Objekt für die jsonb-Spalte (unveränderliche Kopie). */
export function conditionsToSnapshot(c: DocumentConditions): Record<string, unknown> {
  return {
    termDays: c.termDays, skontoPercent: c.skontoPercent, skontoDays: c.skontoDays,
    paymentMethod: c.paymentMethod, paymentNote: c.paymentNote,
    discountPercent: c.discountPercent, surchargePercent: c.surchargePercent,
    surchargeApplied: c.surchargeApplied === true,
  };
}

/** Multiplikator für den (unsichtbaren) Aufschlag: 1 + pct/100. Ungültig/0 → 1. */
export function surchargeMultiplier(pct: number | null | undefined): number {
  const n = Number(pct);
  return Number.isFinite(n) && n > 0 ? 1 + n / 100 : 1;
}

export const emptyDocumentConditions = (): DocumentConditions => ({ ...EMPTY_DOC });

export type PaymentDocKind = "angebot" | "nachtrag" | "auftrag" | "rechnung" | "sub";

/**
 * Zentrale Regel, ob der automatische Zahlungskonditionen-Block im PDF eines
 * Dokumenttyps erscheint.
 *   • normales Angebot → NEIN (ein Angebot nennt noch keine Zahlungskonditionen)
 *   • Auftrag          → NEIN (Stand 2026-07-06: Zahlungsbedingungen kommen im
 *     Auftrag ausschließlich über Textbausteine/Platzhalter in den Text – keine
 *     automatisch erzeugte Box nach der Summe)
 *   • Angebot-Nachtrag, Rechnung, SUB-Auftrag → JA (Rechnungs-/Zahlungslogik unverändert)
 * Eine Stelle für alle Editoren/PDFs – keine verstreuten docType-Sonderfälle.
 */
export function showPaymentForDoc(kind: PaymentDocKind): boolean {
  return kind !== "angebot" && kind !== "auftrag";
}

/**
 * Baut die Zahlungs-Meta für die PDF-Engine (PrintMeta.payment) aus den Konditionen –
 * für Angebot/Auftrag (Zahlungsziel + Skonto/Skontoziel als reine Bedingung, ohne Betrag).
 * Liefert undefined, wenn weder Zahlungsziel noch Skonto gesetzt sind.
 */
export function conditionsToPaymentMeta(c: DocumentConditions | null | undefined):
  { termDays?: number; withSkonto?: boolean; skontoPercent?: number; skontoDays?: number } | undefined {
  if (!c) return undefined;
  const hasTerm = c.termDays != null;
  const hasSkonto = (Number(c.skontoPercent) || 0) > 0;
  if (!hasTerm && !hasSkonto) return undefined;
  return {
    termDays: c.termDays ?? undefined,
    withSkonto: hasSkonto,
    skontoPercent: c.skontoPercent ?? undefined,
    skontoDays: c.skontoDays ?? undefined,
  };
}
