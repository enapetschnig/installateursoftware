// ============================================================
// B4Y SuperAPP – Angebote: Typen + eingefrorener Kalkulations-Snapshot
// ============================================================

export type OfferStatus =
  | "entwurf" | "abgeschlossen" | "versendet" | "angenommen" | "abgelehnt" | "storniert" | "in_auftrag_uebernommen";

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  entwurf: "Entwurf",
  abgeschlossen: "Abgeschlossen",
  versendet: "Versendet",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  storniert: "Storniert",
  in_auftrag_uebernommen: "In Auftrag übernommen",
};

export const OFFER_STATUS_TONE: Record<OfferStatus, "slate" | "blue" | "green" | "red" | "amber"> = {
  entwurf: "slate",
  abgeschlossen: "amber",
  versendet: "blue",
  angenommen: "green",
  abgelehnt: "red",
  storniert: "slate",
  in_auftrag_uebernommen: "green",
};

// Eingefrorener Kalkulations-Snapshot einer Leistung im Moment des Einfügens.
export type FrozenSnapshot = {
  frozen_at: string;
  overhead_percent: number;
  components: {
    kind: string;
    label: string;
    unit: string | null;
    minutes: number;
    quantity: number;
    cost_rate: number;
    sale_rate: number;
    percent: number;
  }[];
  totals: any;
};

export type OfferLine = {
  id: string;
  type: "service" | "free";
  service_id: string | null;
  number: string | null; // Leistungs-/Positionsnummer
  name: string;
  description: string | null;
  unit: string;
  qty: number;
  unit_price: number; // VK netto je Einheit (eingefroren)
  unit_cost: number; // Selbstkosten je Einheit (eingefroren, für Marge)
  snapshot: FrozenSnapshot | null;
};

export type Offer = {
  id: string;
  project_id: string | null;
  contact_id: string | null;
  number: string | null;
  title: string | null;
  status: OfferStatus;
  items: OfferLine[];
  net: number;
  vat: number;
  gross: number;
  notes: string | null;
  created_by?: string | null;
  closed_at?: string | null;
  sent_at?: string | null;
  sent_by?: string | null;
  offer_type_id?: string | null;   // Dokumentvariante (Standard/Pauschal/Regie …)
  conditions_snapshot?: Record<string, unknown> | null; // festgeschriebene Konditionen (Migr. 0081)
  created_at: string;
};

// Standard-Nachtext (erscheint im PDF nach der Zusammenfassung, vor der Grußformel)
export const DEFAULT_OFFER_CLOSING =
  "Preise gültig für die Dauer von 3 Monaten.\n" +
  "Die Aufmaß-Abrechnung erfolgt nach tatsächlichem Aufwand und ÖNORM.\n" +
  "Wir würden uns freuen, Ihr Projekt gemeinsam mit Ihnen umzusetzen und stehen Ihnen für Rückfragen jederzeit gerne zur Verfügung.";

// MwSt-Modus: regulär 20 % oder §19 Bauleistung (Reverse Charge, 0 %)
export type VatMode = "standard" | "par19";
export const VAT_RATE: Record<VatMode, number> = { standard: 20, par19: 0 };

// ============================================================
// §19-Reverse-Charge (Bauleistung ohne ausgewiesene USt) – zentral.
// Gilt für ALLE Rechnungsvarianten (Standard/Pauschal/Regie): ist die Rechnung
// eine §19-Bauleistung, MUSS der gesetzliche Hinweis auf das Reverse-Charge im
// PDF stehen. Eine Quelle, keine Doppellogik.
// ============================================================
export const PARAGRAPH_19_NOTE =
  "Die Umsatzsteuer für diese Bauleistung wird gemäß § 19 Abs. 1a UStG vom Leistungsempfänger geschuldet.";

/** §19-Reverse-Charge erkannt: 0 % USt bei positivem Netto (Bauleistung an Unternehmer). */
export function isReverseCharge(net: number | null | undefined, vat: number | null | undefined): boolean {
  return (Number(vat) || 0) === 0 && (Number(net) || 0) > 0;
}

/**
 * Hängt den §19-Hinweis an einen (HTML-)Schlusstext an – nur bei §19 und nur, wenn er
 * nicht ohnehin schon enthalten ist (idempotent). Gilt variantenunabhängig.
 */
export function withParagraph19Note(
  closingHtml: string | null | undefined,
  reverseCharge: boolean,
): string | undefined {
  const base = (closingHtml ?? "").trim();
  if (!reverseCharge) return base || undefined;
  if (/§\s*19/.test(base)) return base || undefined; // bereits vorhanden
  const note = `<p>${PARAGRAPH_19_NOTE}</p>`;
  return base ? `${base}${note}` : note;
}
