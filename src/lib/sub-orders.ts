// ============================================================
// B4Y SuperAPP – Subunternehmer-Vergabe (Auftrag SUB)
// Aus einem ODER MEHREREN bestehenden Hauptaufträgen werden Positionen/
// Teilmengen an Subunternehmer vergeben → je Subunternehmer ein sub_orders-
// Dokument (mode "merge") bzw. je Quellauftrag eines ("perSource"), analog zur
// Angebot→Auftrag- / Auftrag→Rechnung-Umwandlung (document-chain.ts).
// KEINE Kunden-Dokumentkette; eigene Tabellen sub_orders / sub_order_items.
// Mengen-Tracking + serverseitiger Übervergabe-Schutz JE QUELLAUFTRAG.
// Quelldokumente bleiben unverändert. Mandantenneutral.
// ============================================================
import { supabase } from "./supabase";
import { normalizePositions, isCommercial, DocPosition } from "./document-types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type SubLine = {
  sourceKey: string;            // Position-ID aus orders.items (Hauptauftrag)
  sourceOrderId?: string | null; // Quellauftrag dieser Position (Mehrquellen); Default = primärer Auftrag
  posNo?: string | null; shortText?: string | null; longText?: string | null; unit?: string | null;
  qty: number;                  // an SUB vergebene Menge
  customerUnitPrice: number;    // Kundenpreis netto je Einheit (intern, für Marge)
  unitPrice: number;            // SUB-Einheitspreis netto
  discountPercent?: number; vatRate?: number; isTitle?: boolean; name?: string | null;
};
export type SubConditions = {
  paymentTermDays?: number | null; skontoPercent?: number | null; skontoDays?: number | null;
  retentionPercent?: number | null; discountPercent?: number | null; servicePeriod?: string | null;
  pdfLabel?: string | null; introText?: string | null; closingText?: string | null; title?: string | null;
  signatureSource?: "company" | "creator" | "none" | null; // Signaturquelle des SUB-PDFs (Default 'company')
};
export type SubGroup = { subcontractorId: string | null; conditions?: SubConditions; lines: SubLine[] };

const allocKey = (orderId: string, sourceKey: string) => `${orderId}::${sourceKey}`;

/** Bereits an AKTIVE Subunternehmer vergebene Menge je (Quellauftrag, Position).
 *  Aktiv = nicht gelöscht, nicht storniert → stornierte SUB geben Mengen wieder frei.
 *  Schlüssel = `${source_order_id}::${source_order_item_key}`. Robust auch bei
 *  Mehrquellen-SUB (Tracking über source_order_id der Position, nicht über den
 *  Kopf-`order_id` des SUB-Auftrags). */
export async function subAllocatedAcross(orderIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length) return m;
  const { data: subs } = await supabase.from("sub_orders").select("id")
    .is("deleted_at", null).neq("status", "storniert");
  const subIds = (subs ?? []).map((s: any) => s.id);
  if (!subIds.length) return m;
  const { data: rows } = await supabase.from("sub_order_items")
    .select("source_order_id, source_order_item_key, qty")
    .in("sub_order_id", subIds).in("source_order_id", ids);
  for (const r of (rows ?? [])) {
    const oid = (r as any).source_order_id, key = (r as any).source_order_item_key;
    if (!oid || !key) continue;
    m.set(allocKey(oid, key), (m.get(allocKey(oid, key)) || 0) + (Number((r as any).qty) || 0));
  }
  return m;
}

/** Rückwärtskompatibel: vergebene Menge je Position für GENAU EINEN Quellauftrag. */
export async function subAllocatedByOrderItem(orderId: string): Promise<Map<string, number>> {
  const across = await subAllocatedAcross([orderId]);
  const m = new Map<string, number>();
  for (const [k, v] of across) {
    const [oid, key] = k.split("::");
    if (oid === orderId && key) m.set(key, v);
  }
  return m;
}

export type CreateSubResult = {
  error?: string;
  created?: { id: string; number: string | null; subcontractorId: string | null; net: number; count: number }[];
};

const lineNetOf = (l: SubLine) => l.isTitle ? 0 : round2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPercent) || 0) / 100));

/** Legt EINEN Auftrag-SUB für eine Subunternehmer-Gruppe aus den übergebenen
 *  (bereits geprüften) Zeilen an. headerOrderId = informativer Kopf-Bezug. */
async function insertOneSub(
  group: SubGroup, lines: SubLine[], headerOrderId: string | null,
  projectId: string | null, fallbackTitle: string | null, createdBy: string | null,
  vatMode: string = "standard",
): Promise<{ created?: NonNullable<CreateSubResult["created"]>[number]; error?: string }> {
  const usable = lines.filter((l) => l.isTitle || (Number(l.qty) || 0) > 0);
  if (!usable.some((l) => !l.isTitle)) return {}; // keine Position → überspringen
  const c = group.conditions || {};
  // OHNE Nummer: SUB-Entwürfe verbrauchen keine Nummer – Vergabe erst beim ersten
  // Statuswechsel aus 'entwurf' (versendet/akzeptiert) via ensure_document_number.

  let net = 0, cost = 0;
  const jsonbItems: Partial<DocPosition>[] = usable.map((l, i) => l.isTitle
    ? { id: `t-${i}`, type: "title", name: l.name || l.shortText || "", level: 1 }
    : { id: l.sourceKey || `p-${i}`, type: "free", name: l.shortText || l.name || "", long_text: l.longText ?? null, number: l.posNo ?? null, qty: Number(l.qty) || 0, unit: l.unit || "Stk", unit_price: Number(l.unitPrice) || 0, discount_percent: Number(l.discountPercent) || 0, vat_rate: Number(l.vatRate) || 20 });
  for (const l of usable) { net += lineNetOf(l); cost += l.isTitle ? 0 : round2((Number(l.qty) || 0) * (Number(l.customerUnitPrice) || 0)); }
  net = round2(net); cost = round2(cost);
  // §19 (Reverse Charge): keine USt ausweisen. Modus wird vom Quellauftrag geerbt.
  const p19 = vatMode === "par19";
  const vat = p19 ? 0 : round2(net * 0.2);

  const { data: sub, error: subErr } = await supabase.from("sub_orders").insert({
    sub_number: null, title: c.title || fallbackTitle || null,
    project_id: projectId ?? null, order_id: headerOrderId,
    subcontractor_id: group.subcontractorId, status: "entwurf",
    vat_mode: p19 ? "par19" : "standard",
    payment_term_days: c.paymentTermDays ?? null, skonto_percent: c.skontoPercent ?? null, skonto_days: c.skontoDays ?? null,
    retention_percent: c.retentionPercent ?? null, discount_percent: c.discountPercent ?? null, service_period: c.servicePeriod ?? null,
    items: jsonbItems, net, vat, gross: round2(net + vat), cost_basis_net: cost, margin_net: round2(cost - net),
    pdf_label: c.pdfLabel ?? null, doc_intro_text: c.introText ?? null, doc_closing_text: c.closingText ?? null,
    signature_source: c.signatureSource ?? "company",
    created_by: createdBy ?? null,
  }).select("id, sub_number").single();
  if (subErr || !sub) return { error: subErr?.message || "Subunternehmerauftrag konnte nicht erstellt werden." };

  const itemRows = usable.map((l, i) => ({
    sub_order_id: (sub as any).id,
    source_order_id: l.isTitle ? null : (l.sourceOrderId ?? headerOrderId ?? null),
    source_order_item_key: l.isTitle ? null : l.sourceKey,
    pos_no: l.posNo ?? null, short_text: l.shortText ?? l.name ?? null, long_text: l.longText ?? null,
    qty: l.isTitle ? 0 : (Number(l.qty) || 0), unit: l.unit ?? null,
    customer_unit_price: l.isTitle ? 0 : (Number(l.customerUnitPrice) || 0),
    unit_price: l.isTitle ? 0 : (Number(l.unitPrice) || 0),
    discount_percent: Number(l.discountPercent) || 0, vat_rate: Number(l.vatRate) || 20,
    net: lineNetOf(l), is_title: !!l.isTitle, sort_order: i,
  }));
  const { error: itErr } = await supabase.from("sub_order_items").insert(itemRows);
  if (itErr) return { error: itErr.message };

  return { created: { id: (sub as any).id, number: (sub as any).sub_number ?? null, subcontractorId: group.subcontractorId, net, count: usable.filter((l) => !l.isTitle).length } };
}

/**
 * Erstellt Auftrag-SUB aus EINEM ODER MEHREREN Hauptaufträgen für eine
 * Subunternehmer-Gruppe. mode="merge" → ein gemeinsamer SUB über alle Quellen;
 * mode="perSource" → je Quellauftrag ein eigener SUB. Serverseitiger
 * Übervergabe-Schutz je (Quellauftrag, Position) gegen die noch offene Menge.
 */
export async function createSubOrdersFromOrders(opts: {
  orderIds: string[]; projectId?: string | null; mode?: "merge" | "perSource";
  group: SubGroup; createdBy?: string | null;
}): Promise<CreateSubResult> {
  const orderIds = [...new Set((opts.orderIds || []).filter(Boolean))];
  if (!orderIds.length) return { error: "Kein Quellauftrag angegeben." };
  const mode = opts.mode ?? "merge";

  const { data: orders } = await supabase.from("orders").select("*").in("id", orderIds);
  const orderById = new Map<string, any>((orders ?? []).map((o: any) => [o.id, o]));
  for (const id of orderIds) {
    const o = orderById.get(id);
    if (!o) return { error: "Ein gewählter Hauptauftrag wurde nicht gefunden." };
    if (o.deleted_at || ["storniert", "entwurf"].includes(o.status)) {
      return { error: `Auftrag ${o.order_number || ""} kann nicht vergeben werden (muss beauftragt sein, nicht storniert/Entwurf).` };
    }
  }

  // verfügbare Menge je (Quellauftrag, Position)
  const availByKey = new Map<string, number>();
  for (const id of orderIds) {
    for (const p of normalizePositions(orderById.get(id).items)) {
      if (isCommercial(p.type)) availByKey.set(allocKey(id, p.id), Number(p.qty) || 0);
    }
  }

  // Normalisiere Zeilen: jede Position kennt ihren Quellauftrag (Default: einzige Quelle)
  const defOrder = orderIds.length === 1 ? orderIds[0] : null;
  const lines: SubLine[] = (opts.group.lines || []).map((l) => ({ ...l, sourceOrderId: l.sourceOrderId ?? defOrder }));
  // Sicherheit: jede Position MUSS zu einem geprüften (geladenen, beauftragten)
  // Quellauftrag UND zu einer realen verrechenbaren Position dieses Auftrags
  // gehören. Sonst könnte ein manipuliertes Payload (fremde/erfundene
  // sourceOrderId oder sourceKey) den Übervergabe-Schutz umgehen, da availByKey
  // dann keinen Maximalwert liefert (Codex-Finding PR #54).
  for (const l of lines) {
    if (l.isTitle) continue;
    if (!l.sourceOrderId || !orderById.has(l.sourceOrderId)) {
      return { error: "Ungültiger oder nicht autorisierter Quellauftrag für eine Position." };
    }
    if (!availByKey.has(allocKey(l.sourceOrderId, l.sourceKey))) {
      return { error: "Eine Position gehört nicht zum gewählten Quellauftrag oder ist nicht verrechenbar." };
    }
  }

  // bereits vergeben + in diesem Aufruf geplant → Übervergabe je (Quellauftrag, Position) verhindern
  const allocated = await subAllocatedAcross(orderIds);
  const planned = new Map<string, number>();
  for (const l of lines) if (!l.isTitle) {
    const k = allocKey(l.sourceOrderId as string, l.sourceKey);
    planned.set(k, (planned.get(k) || 0) + (Number(l.qty) || 0));
  }
  for (const [key, plannedQty] of planned) {
    const max = availByKey.get(key);
    if (max != null && (allocated.get(key) || 0) + plannedQty > round2(max) + 0.0001) {
      return { error: `Übervergabe verhindert: eine Position überschreitet die verfügbare Menge (max ${max}).` };
    }
  }

  const created: NonNullable<CreateSubResult["created"]> = [];
  const titleOf = (id: string) => orderById.get(id)?.title ?? null;

  if (mode === "perSource") {
    for (const id of orderIds) {
      const sub = lines.filter((l) => l.sourceOrderId === id);
      if (!sub.some((l) => !l.isTitle && (Number(l.qty) || 0) > 0)) continue;
      const r = await insertOneSub(opts.group, sub, id, opts.projectId ?? orderById.get(id)?.project_id ?? null, titleOf(id), opts.createdBy ?? null, orderById.get(id)?.vat_mode === "par19" ? "par19" : "standard");
      if (r.error) return { error: r.error };
      if (r.created) created.push(r.created);
    }
  } else {
    const headerOrderId = orderIds[0];
    // Merge: §19 gilt, sobald einer der Quellaufträge §19 ist.
    const mergedVatMode = orderIds.some((id) => orderById.get(id)?.vat_mode === "par19") ? "par19" : "standard";
    const r = await insertOneSub(opts.group, lines, headerOrderId, opts.projectId ?? orderById.get(headerOrderId)?.project_id ?? null, orderIds.length === 1 ? titleOf(headerOrderId) : null, opts.createdBy ?? null, mergedVatMode);
    if (r.error) return { error: r.error };
    if (r.created) created.push(r.created);
  }

  if (!created.length) return { error: "Keine Positionen ausgewählt." };
  return { created };
}

/** Rückwärtskompatibel: ein Quellauftrag, mehrere Subunternehmer-Gruppen. */
export async function createSubOrdersFromOrder(opts: {
  orderId: string; projectId?: string | null; groups: SubGroup[]; createdBy?: string | null;
}): Promise<CreateSubResult> {
  const created: NonNullable<CreateSubResult["created"]> = [];
  for (const g of opts.groups) {
    const r = await createSubOrdersFromOrders({
      orderIds: [opts.orderId], projectId: opts.projectId ?? null, mode: "merge", group: g, createdBy: opts.createdBy ?? null,
    });
    if (r.error) return { error: r.error };
    if (r.created) created.push(...r.created);
  }
  if (!created.length) return { error: "Keine Positionen ausgewählt." };
  return { created };
}
