// ============================================================
// B4Y SuperAPP – Angebot-Nachtrag: Übernahme in bestehenden Auftrag
// Ein angenommener Nachtrag (offers.kind='nachtrag') wird einem BESTEHENDEN
// Auftrag als Nachtragspositionen hinzugefügt – KEIN eigener Nachtragsauftrag,
// keine neue Auftragsnummer. Zentrale Logik, mandantenneutral.
// ============================================================
import { supabase } from "./supabase";
import { DocPosition, normalizePositions, isCommercial, lineNet, renumber, emptyPosition } from "./document-types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Nachträge, die bereits in einen AKTIVEN Auftrag übernommen wurden (Doppelübernahme-Schutz, dynamisch). */
export async function supplementsTakenIntoOrder(supplementOfferIds: string[]): Promise<Set<string>> {
  const ids = supplementOfferIds.filter(Boolean);
  if (!ids.length) return new Set();
  const { data: activeOrders } = await supabase
    .from("orders").select("id").is("deleted_at", null)
    .neq("status", "storniert").neq("status", "archiviert");
  const orderIds = (activeOrders ?? []).map((o: any) => o.id);
  if (!orderIds.length) return new Set();
  const { data } = await supabase
    .from("order_items").select("source_supplement_offer_id")
    .in("order_id", orderIds).in("source_supplement_offer_id", ids);
  return new Set((data ?? []).map((r: any) => r.source_supplement_offer_id as string));
}

export type AddSupplementResult = { error?: string; count?: number; net?: number; orderNumber?: string | null };

/**
 * Übernimmt die Positionen eines angenommenen Nachtrags in einen bestehenden Auftrag.
 * Serverseitiger Schutz: Nachtrag-Status, Doppelübernahme, aktiver Zielauftrag.
 * Summen werden additiv (bestehend + Nachtrag) neu berechnet – robust gegen
 * unvollständige JSONB-Positionslisten.
 */
export async function addSupplementToOrder(opts: { supplementOfferId: string; orderId: string }): Promise<AddSupplementResult> {
  // 1) Nachtrag laden + prüfen
  const { data: sup } = await supabase.from("offers").select("*").eq("id", opts.supplementOfferId).maybeSingle();
  if (!sup) return { error: "Nachtrag nicht gefunden." };
  const s = sup as any;
  if (s.kind !== "nachtrag") return { error: "Dokument ist kein Angebot-Nachtrag." };
  if (!["abgeschlossen", "versendet", "angenommen"].includes(s.status)) {
    return { error: "Nur ein abgeschlossener/angenommener Nachtrag kann in einen Auftrag übernommen werden." };
  }
  // 2) Doppelübernahme-Schutz
  const taken = await supplementsTakenIntoOrder([opts.supplementOfferId]);
  if (taken.has(opts.supplementOfferId)) return { error: "Dieser Nachtrag wurde bereits in einen Auftrag übernommen." };
  // 3) Zielauftrag laden + prüfen
  const { data: ord } = await supabase.from("orders").select("*").eq("id", opts.orderId).maybeSingle();
  if (!ord) return { error: "Zielauftrag nicht gefunden." };
  const o = ord as any;
  if (o.deleted_at || ["storniert", "archiviert", "entwurf"].includes(o.status)) {
    return { error: "Der Zielauftrag ist nicht aktiv/beauftragt." };
  }
  // 4) Nachtrag-Positionen
  const commercial = normalizePositions(s.items).filter((p) => isCommercial(p.type));
  if (!commercial.length) return { error: "Der Nachtrag enthält keine verrechenbaren Positionen." };
  const supNumber: string = s.number || "Nachtrag";

  // 5) An orders.items (JSONB) anhängen: Titelzeile „Nachtrag <Nr>" + Positionen (für Anzeige/PDF/Verrechnung)
  const orderPositions = normalizePositions(o.items);
  const titleRow: DocPosition = emptyPosition("title", { name: `Nachtrag ${supNumber}`, level: 1 });
  const merged = renumber([...orderPositions, titleRow, ...commercial.map((p) => ({ ...p }))]);

  // 6) Summen additiv neu (bestehend + Nachtrag) – finanziell korrekt, JSONB-unabhängig
  const supNet = round2(commercial.reduce((a, p) => a + lineNet(p), 0));
  const supVat = round2(commercial.reduce((a, p) => a + (lineNet(p) * (Number(p.vat_rate) || 0) / 100), 0));
  const newNet = round2(Number(o.net || 0) + supNet);
  const newVat = round2(Number(o.vat || 0) + supVat);
  const newGross = round2(newNet + newVat);

  // 7) Relationale order_items (Nachtrag gekennzeichnet) – Sortierung fortsetzen
  const { data: existing } = await supabase.from("order_items")
    .select("sort_order").eq("order_id", opts.orderId).order("sort_order", { ascending: false }).limit(1);
  let sort = (existing && existing[0] ? Number((existing[0] as any).sort_order) || 0 : merged.length) + 1;
  const rows = commercial.map((p) => {
    const net = lineNet(p);
    const gross = round2(net * (1 + (Number(p.vat_rate) || 0) / 100));
    return {
      order_id: opts.orderId, pos_no: p.number || null,
      service_number: null, short_text: p.name || null, long_text: p.long_text || p.description || null,
      qty: p.qty, unit: p.unit, unit_price: p.unit_price, discount_percent: p.discount_percent,
      vat_rate: p.vat_rate, net, gross,
      is_supplement: true, source_supplement_offer_id: opts.supplementOfferId, source_supplement_item_id: p.id,
      invoiced_qty: 0, sort_order: sort++,
    };
  });
  const { error: itemsErr } = await supabase.from("order_items").insert(rows);
  if (itemsErr) return { error: itemsErr.message };

  // 8) Auftrag aktualisieren (Positionen + Summen netto)
  const { error: ordErr } = await supabase.from("orders").update({
    items: merged, net: newNet, vat: newVat, gross: newGross, updated_at: new Date().toISOString(),
  }).eq("id", opts.orderId);
  if (ordErr) return { error: ordErr.message };

  // 9) Nachtrag-Status + Auftragsbezug fixieren
  await supabase.from("offers").update({ status: "in_auftrag_uebernommen", related_order_id: opts.orderId }).eq("id", opts.supplementOfferId);

  return { count: commercial.length, net: supNet, orderNumber: o.order_number ?? null };
}
