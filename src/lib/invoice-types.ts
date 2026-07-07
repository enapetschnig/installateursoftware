// ============================================================
// B4Y SuperAPP – Rechnungen: Typen + Status-Konstanten
// Phase 4: Rechnungs-Engine (AT-konform §11 UStG)
// ============================================================

export type InvoiceKind = "normal" | "teilrechnung" | "schlussrechnung" | "gutschrift" | "storno";
export type InvoiceDocStatus = "entwurf" | "finalisiert" | "versendet" | "bezahlt" | "storniert";

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  normal:          "Normale Rechnung",
  teilrechnung:    "Teilrechnung",
  schlussrechnung: "Schlussrechnung",
  gutschrift:      "Gutschrift",
  storno:          "Stornorechnung",
};

export const INVOICE_DOC_STATUS_LABEL: Record<string, string> = {
  entwurf:     "Entwurf",
  finalisiert: "Finalisiert",
  versendet:   "Versendet",
  bezahlt:     "Bezahlt",
  storniert:   "Storniert",
};

export function invoiceDocStatusTone(s: string): "slate" | "blue" | "green" | "amber" | "red" {
  if (s === "finalisiert" || s === "versendet") return "blue";
  if (s === "bezahlt") return "green";
  if (s === "storniert") return "red";
  return "slate";
}

// AT-Rechnungsaussteller-Stammdaten (BAU4YOU Baranowski Bau GmbH)
export const ISSUER = {
  name:   "BAU4YOU Baranowski Bau GmbH",
  street: "Hyegasse 3 / Lokal B",
  zip:    "1030",
  city:   "Wien",
  uid:    "ATU63544828",
  email:  "office@bau4you.at",
  web:    "www.bau4you.at",
};

export type InvoiceStatus =
  | "entwurf"
  | "finalisiert"
  | "bezahlt"
  | "teilbezahlt"
  | "überfällig"
  | "storniert";

// InvoiceItem aus der invoice_items-Tabelle (normalisiert)
export type InvoiceItem = {
  id: string;
  invoice_id: string;
  pos_no: string | null;
  service_number: string | null;
  short_text: string | null;
  long_text: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  net: number;
  gross: number;
  source_order_id: string | null;
  source_order_item_id: string | null;
  sort_order: number;
};

export type Invoice = {
  id: string;
  project_id: string | null;
  contact_id: string | null;
  person_id: string | null;
  number: string | null;
  title: string | null;
  invoice_type: string;
  invoice_kind: string;
  with_skonto: boolean;
  skonto_percent: number;
  payment_status: string;
  doc_status: string;
  items?: InvoiceItem[]; // inline (legacy, nicht mehr genutzt)
  net: number;
  vat: number;
  gross: number;
  invoice_date: string;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  order_ids: string[];
  offer_ids: string[];
  service_period: string | null;
  discount_percent: number;
  payment_term_days: number;
  snapshot: any;
  conditions_snapshot?: Record<string, unknown> | null; // festgeschriebene Konditionen (Migr. 0081)
  storno_of: string | null;
  locked: boolean;
  created_at: string;
  updated_at: string | null;
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  entwurf:    "Entwurf",
  finalisiert: "Finalisiert",
  bezahlt:    "Bezahlt",
  teilbezahlt: "Teilbezahlt",
  überfällig: "Überfällig",
  storniert:  "Storniert",
};

export const INVOICE_STATUS_COLOR: Record<
  InvoiceStatus,
  "slate" | "blue" | "green" | "amber" | "red"
> = {
  entwurf:    "slate",
  finalisiert: "blue",
  bezahlt:    "green",
  teilbezahlt: "amber",
  überfällig: "red",
  storniert:  "red",
};

/** Leitet den kombinierten Anzeige-Status aus DB-Feldern ab */
export function deriveInvoiceStatus(inv: {
  doc_status: string;
  payment_status: string;
  locked: boolean;
  due_date: string | null;
}): InvoiceStatus {
  if (inv.doc_status === "storniert") return "storniert";
  if (!inv.locked) return "entwurf";
  if (inv.payment_status === "bezahlt") return "bezahlt";
  if (inv.payment_status === "teilbezahlt") return "teilbezahlt";
  if (inv.due_date && new Date(inv.due_date) < new Date()) return "überfällig";
  return "finalisiert";
}

/**
 * Aktualisiert invoice_status am Auftrag basierend auf nicht-stornierten Rechnungen.
 * Muss nach jeder Rechnungserstellung, Finalisierung oder Stornierung aufgerufen werden.
 */
export async function updateOrderInvoiceStatus(
  orderId: string,
  supabase: any
): Promise<void> {
  const [{ data: order }, { data: invoices }] = await Promise.all([
    supabase.from("orders").select("gross").eq("id", orderId).maybeSingle(),
    supabase.from("invoices").select("gross, doc_status")
      .contains("order_ids", [orderId])
      .neq("doc_status", "storniert"),
  ]);
  if (!order) return;

  const invoicedTotal = Math.round(
    ((invoices as any[]) ?? []).reduce((s: number, i: any) => s + Number(i.gross || 0), 0) * 100
  ) / 100;
  const orderGross = Number(order.gross || 0);

  let invoiceStatus = "offen";
  if (invoicedTotal > 0) {
    if (orderGross > 0 && invoicedTotal > orderGross * 1.001) {
      invoiceStatus = "ueberverrechnet";
    } else if (orderGross > 0 && invoicedTotal >= orderGross * 0.999) {
      invoiceStatus = "voll_verrechnet";
    } else {
      invoiceStatus = "teilw_verrechnet";
    }
  }

  await supabase
    .from("orders")
    .update({ invoice_status: invoiceStatus, updated_at: new Date().toISOString() })
    .eq("id", orderId);
}

/** Mehrere Aufträge in einem Aufruf aktualisieren */
export async function refreshOrdersInvoiceStatus(supabase: any, orderIds: string[]) {
  for (const id of orderIds) await updateOrderInvoiceStatus(id, supabase);
}
