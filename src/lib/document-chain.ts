// ============================================================
// B4Y SuperAPP – Zentrale Dokumentketten-Engine
// ============================================================
// EINE Quelle der Wahrheit für das Weiterführen von Dokumenten:
//   Angebot(e) → Auftrag/Aufträge   und   Auftrag/Aufträge → Rechnung(en)
//
// Unterstützte Ketten (mandantenfähig, nicht auf BAU4YOU hartcodiert):
//   • 1 Quelle            → 1 Zieldokument
//   • mehrere Quellen     → 1 gemeinsames Zieldokument        (mode "merge")
//   • mehrere Quellen     → je Quelle ein eigenes Zieldokument (mode "perSource")
//
// Grundsätze:
//   • Statusregel zentral: nur finalisierte Quellen (canConvertOffer/Order),
//     Entwürfe/storniert/archiviert/gelöscht sind gesperrt.
//   • Positionsauswahl je Quelle über itemFilter (Map<docId, selectedIds>).
//   • Quellverweise bleiben erhalten: Positionsebene (order_items.source_offer_id /
//     invoice-JSONB source_order_id) + Dokumentebene (offer_ids/order_ids) + snapshot.
//   • Variante (offer_type) fließt via document_type_transitions/deriveFollowDoc durch.
//     Bei gemischten Varianten muss eine Zielvariante bewusst gewählt werden.
//   • Gleichnamige Titel/Gewerke mehrerer Quellen werden zusammengeführt
//     (Herkunft je Position bleibt über die Quellverweise nachvollziehbar).
// ============================================================
import { supabase } from "./supabase";
import {
  DocPosition, normalizePositions, renumber, computeSummary, isCommercial, lineNet,
} from "./document-types";
import { loadTransitionFor, deriveFollowDoc, resolveFollowStandardTexts, canConvertOffer, canConvertOrder } from "./document-transitions";
import { isEmptyHtml } from "./text-blocks";
import { conditionsFromSnapshot, conditionsToSnapshot } from "./payment-conditions";

/**
 * Normalisiert eine optionale UUID-Referenz: leere/whitespace-Strings → null.
 *
 * Formularfelder liefern für „kein Projekt“ einen LEEREN STRING statt null.
 * `??` fängt den nicht ab, sodass `project_id: ""` bis in den Insert durchrutschte
 * und Postgres mit `invalid input syntax for type uuid: ""` (400) abbrach – die
 * Auftrags-/Rechnungserstellung schlug dann still fehl. Zentral hier abfangen,
 * damit ALLE Kettenfunktionen (und ihre Aufrufer) sicher sind.
 */
const idOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Konditionen-Snapshot vom Vorgängerdokument übernehmen (nicht erneut live vom Kunden).
 * Der Standardaufschlag ist in den kopierten Einzelpreisen bereits enthalten →
 * surchargeApplied=true, damit er im Folgedokument nicht erneut angewendet wird.
 */
function inheritConditionsSnapshot(src: any): Record<string, unknown> | null {
  const c = conditionsFromSnapshot(src?.conditions_snapshot);
  if (!c) return null;
  return conditionsToSnapshot({ ...c, surchargeApplied: true });
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Gemeinsame „Einleitung vor Positionen" mehrerer Quellen:
 *  alle leer → keine; genau eine (gemeinsame) → übernehmen; unterschiedliche → keine (nicht blind mischen). */
function commonPrePositions(sources: { pre_positions_text?: string | null }[]): string | null {
  const uniq = [...new Set(sources.map((s) => s?.pre_positions_text || "").filter((v) => !isEmptyHtml(v)))];
  return uniq.length === 1 ? uniq[0] : null;
}

export type ChainMode = "merge" | "perSource";
/** Auswahl je Quelldokument: docId → Liste übernommener Positions-IDs (fehlt = alle). */
export type ItemFilter = Map<string, string[]>;
/** Teilmengen je Quelldokument: docId → (positionId → abzurechnende Menge). */
export type QtyFilter = Map<string, Map<string, number>>;

export type ChainResult = { ids: string[]; numbers: string[]; error?: string };

// ── eine Position mit Herkunft (für Quellverweise auf Positionsebene) ──
type SourcedPosition = DocPosition & { _srcDocId?: string; _srcItemId?: string | null };

// ============================================================
// Status-/Varianten-Prüfungen
// ============================================================
type OfferLike = { id: string; status?: string | null; deleted_at?: string | null; offer_type_id?: string | null; number?: string | null };
type OrderLike = { id: string; status?: string | null; deleted_at?: string | null; offer_type_id?: string | null; order_number?: string | null };

/** Prüft alle Angebote zentral; liefert den ersten Sperrgrund (oder null = ok). */
export function checkOffersConvertible(offers: OfferLike[]): string | null {
  if (!offers.length) return "Keine Angebote ausgewählt.";
  for (const o of offers) {
    const c = canConvertOffer(o as any);
    if (!c.ok) return `${o.number ? `Angebot ${o.number}: ` : ""}${c.reason}`;
  }
  return null;
}

/** Prüft alle Aufträge zentral; liefert den ersten Sperrgrund (oder null = ok). */
export function checkOrdersConvertible(orders: OrderLike[]): string | null {
  if (!orders.length) return "Keine Aufträge ausgewählt.";
  for (const o of orders) {
    const c = canConvertOrder(o as any);
    if (!c.ok) return `${o.order_number ? `Auftrag ${o.order_number}: ` : ""}${c.reason}`;
  }
  return null;
}

/** true, wenn unter den Quellen mehr als eine Variante (offer_type_id) vorkommt. */
export function hasVariantConflict(sources: { offer_type_id?: string | null }[]): boolean {
  const ids = new Set(sources.map((s) => s.offer_type_id ?? "__none__"));
  return ids.size > 1;
}

/** Eindeutige Variante der Quellen oder null (wenn gemischt/leer). */
export function singleVariantId(sources: { offer_type_id?: string | null }[]): string | null {
  const ids = new Set(sources.map((s) => s.offer_type_id ?? null));
  return ids.size === 1 ? ([...ids][0] ?? null) : null;
}

// ============================================================
// Positionen mehrerer Quellen zusammenführen
//   - gleichnamige Titel/Gewerke werden EINER Gruppe zugeordnet
//   - Positionen ohne Titel landen in der Gruppe "" (== "Positionen")
//   - jede Position trägt _srcDocId/_srcItemId (Herkunft) für Quellverweise
//   - optionaler itemFilter je Quelle (nur gewählte kaufmännische Positionen)
// ============================================================
export function mergeSourcePositions(
  sources: { docId: string; positions: DocPosition[] }[],
  itemFilter?: ItemFilter,
): SourcedPosition[] {
  type Grp = { name: string; level: number; items: SourcedPosition[] };
  const groups: Grp[] = [];
  const groupByName = new Map<string, Grp>();
  const ensure = (name: string, level: number): Grp => {
    let g = groupByName.get(name);
    if (!g) { g = { name, level, items: [] }; groups.push(g); groupByName.set(name, g); }
    return g;
  };

  for (const src of sources) {
    const sel = itemFilter?.get(src.docId);
    let curName = "";
    let curLevel = 1;
    for (const p of src.positions) {
      if (p.type === "title") { curName = p.name || ""; curLevel = p.level || 1; ensure(curName, curLevel); continue; }
      if (isCommercial(p.type)) {
        if (sel && !sel.includes(p.id)) continue; // nicht ausgewählt
        ensure(curName, curLevel).items.push({ ...p, _srcDocId: src.docId, _srcItemId: p.id });
      } else if (p.type === "text") {
        // Begleittexte mitnehmen (an aktuelle Gruppe), aber nur wenn Gruppe Inhalt bekommt
        ensure(curName, curLevel).items.push({ ...p, _srcDocId: src.docId, _srcItemId: p.id });
      }
    }
  }

  // Ausgabe: Gruppen mit mindestens einer kaufmännischen Position; Titelzeile + Items
  const out: SourcedPosition[] = [];
  for (const g of groups) {
    const hasCommercial = g.items.some((it) => isCommercial(it.type));
    if (!hasCommercial) continue;
    if (g.name) {
      out.push({
        ...({} as DocPosition),
        id: cryptoId(), type: "title", name: g.name, level: g.level,
        article_id: null, service_id: null, text_block_id: null, title_id: null,
        number: null, parent_title_id: null, description: null, long_text: null, content: null,
        qty: 1, unit: "Stk", unit_price: 0, unit_cost: 0, vat_rate: 20, discount_percent: 0,
        material_cost: 0, labor_minutes: 0, snapshot: null,
      });
    }
    for (const it of g.items) out.push(it);
  }
  return renumber(out) as SourcedPosition[];
}

function cryptoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ============================================================
// Folge-Snapshot (Typ/Texte/Darstellung) für das Zieldokument ableiten
// ============================================================
async function deriveFollow(
  stage: "order" | "invoice",
  targetOfferTypeId: string | null,
  fallbackDisplay: any,
  prePositionsText: string | null,
) {
  const transition = await loadTransitionFor(targetOfferTypeId);
  const display = fallbackDisplay ?? null;
  let typeInfo: { slug?: string | null; name?: string | null } | null = null;
  // Bei bewusst gewählter Zielvariante deren Darstellung + Slug/Name (für das
  // automatische Folge-Label) verwenden.
  if (targetOfferTypeId) {
    // offer_types hat KEINE "display"-Spalte (Darstellung kommt aus fallbackDisplay
    // bzw. den default_show_*-Feldern der Variante). Früher wurde sie mitselektiert →
    // PostgREST antwortete mit 400 und typeInfo (slug/name) ging still verloren.
    const { data } = await supabase.from("offer_types").select("slug,name").eq("id", targetOfferTypeId).maybeSingle();
    if (data) {
      typeInfo = { slug: (data as any).slug, name: (data as any).name };
    }
  }
  const follow = deriveFollowDoc(stage, {
    offer_type_id: targetOfferTypeId,
    display_settings_snapshot: display,
    display,
    pre_positions_text: prePositionsText,
  }, transition, typeInfo);
  // Vor-/Nachtext zentral aus den Standardtexten (text_blocks) je Doctype/Variante;
  // Legacy-Transition-Texte gewinnen weiterhin, falls gesetzt.
  const texts = await resolveFollowStandardTexts(stage, targetOfferTypeId, transition);
  follow.doc_intro_text = texts.intro;
  follow.doc_closing_text = texts.closing;
  return follow;
}

// ============================================================
// ANGEBOT(E) → AUFTRAG
// ============================================================
export type CreateOrderOpts = {
  projectId: string;
  contactId?: string | null;
  offers: any[];                 // ausgewählte Angebote (Offer-Datensätze inkl. items)
  itemFilter?: ItemFilter;
  title?: string | null;
  targetOfferTypeId?: string | null; // bei gemischten Varianten Pflicht
};

/**
 * Liefert die Angebots-Positions-IDs, die bereits in einem AKTIVEN Auftrag
 * enthalten sind (Schutz gegen Doppelbeauftragung). Aktiv = nicht gelöscht,
 * nicht storniert. Dynamisch berechnet → nach Storno/Löschen wieder frei.
 */
export async function orderedOfferItemIds(offerIds: string[]): Promise<Set<string>> {
  const ids = offerIds.filter(Boolean);
  if (!ids.length) return new Set();
  // Aktiv = nicht gelöscht, nicht storniert, nicht archiviert. Archivierte/stornierte
  // Aufträge geben ihre Angebotspositionen wieder frei (Anforderung Storno-Rückrechnung).
  const { data: activeOrders } = await supabase
    .from("orders").select("id").is("deleted_at", null)
    .neq("status", "storniert").neq("status", "archiviert");
  const orderIds = (activeOrders ?? []).map((o: any) => o.id);
  if (!orderIds.length) return new Set();
  const { data: rows } = await supabase
    .from("order_items").select("source_offer_item_id")
    .in("order_id", orderIds)
    .in("source_offer_id", ids)
    .not("source_offer_item_id", "is", null);
  return new Set((rows ?? []).map((r: any) => r.source_offer_item_id as string));
}

/**
 * Aktiver Auftrag, der bereits aus diesem Angebot erstellt wurde (offer_ids enthält
 * die Angebots-ID; gelöschte/stornierte Aufträge zählen nicht). Zentrale Quelle für
 * den Duplikat-Schutz in der UI („Auftrag bereits erstellt" / „Zum Auftrag wechseln").
 * Serverseitig schützt zusätzlich der Positions-Guard in createOrderFromOffers
 * (bereits beauftragte Positionen werden ausgeschlossen).
 */
export async function findActiveOrderForOffer(
  offerId: string,
): Promise<{ id: string; order_number: string | null } | null> {
  const { data } = await supabase
    .from("orders")
    .select("id, order_number")
    .contains("offer_ids", [offerId])
    .is("deleted_at", null)
    .neq("status", "storniert")
    .limit(1);
  const row = (data as { id: string; order_number: string | null }[] | null)?.[0];
  return row ?? null;
}

/** Erstellt EINEN Auftrag aus einem/mehreren Angeboten. Liefert die neue Auftrags-ID. */
export async function createOrderFromOffers(opts: CreateOrderOpts): Promise<{ id?: string; number?: string; error?: string }> {
  const blocked = checkOffersConvertible(opts.offers);
  if (blocked) return { error: blocked };

  const variant = opts.targetOfferTypeId ?? singleVariantId(opts.offers);
  if (variant === null && hasVariantConflict(opts.offers)) {
    return { error: "Die gewählten Angebote haben unterschiedliche Varianten. Bitte eine Zielvariante wählen." };
  }

  // Schutz gegen Doppelbeauftragung: bereits in aktiven Aufträgen enthaltene
  // Positionen serverseitig ausschließen – auch bei manipulierter UI/direktem Aufruf.
  const usedItemIds = await orderedOfferItemIds(opts.offers.map((o) => o.id));
  const sources = opts.offers.map((o) => ({ docId: o.id, positions: normalizePositions(o.items) }));
  const effFilter: ItemFilter = new Map();
  for (const s of sources) {
    const wanted = opts.itemFilter?.get(s.docId) ?? s.positions.filter((p) => isCommercial(p.type)).map((p) => p.id);
    effFilter.set(s.docId, wanted.filter((id) => !usedItemIds.has(id)));
  }
  const merged = mergeSourcePositions(sources, effFilter);
  if (!merged.some((p) => isCommercial(p.type))) {
    return { error: "Alle gewählten Positionen sind bereits in einem aktiven Auftrag enthalten – es kann kein weiterer Auftrag erstellt werden." };
  }
  // §19-Modus aus dem Quell-Angebot in den Auftrag übernehmen (Reverse-Charge 0 % USt).
  const srcOffer: any = opts.offers[0] ?? {};
  const vatModeFollow: string = srcOffer.vat_mode === "par19" ? "par19" : "standard";
  const summary = computeSummary(merged, vatModeFollow === "par19" ? 0 : null);

  const { data: numData } = await supabase.rpc("next_document_number", { p_doc_type: "auftrag" });
  const follow = await deriveFollow("order", variant, srcOffer.display_settings_snapshot ?? srcOffer.display ?? null, commonPrePositions(opts.offers));

  const title = opts.title || (opts.offers.length === 1 ? opts.offers[0].title : null) || null;
  const contactId = idOrNull(opts.contactId) ?? idOrNull(opts.offers[0]?.contact_id);

  const { data: newOrder, error } = await supabase.from("orders").insert({
    order_number: numData as string,
    order_date: new Date().toISOString().slice(0, 10),
    title, project_id: idOrNull(opts.projectId), contact_id: contactId,
    status: "beauftragt", invoice_status: "offen",
    net: summary.net, vat: summary.vat, gross: summary.gross,
    vat_mode: vatModeFollow,
    offer_type_id: follow.offer_type_id,
    pdf_label: follow.pdf_label,
    doc_intro_text: follow.doc_intro_text,
    doc_closing_text: follow.doc_closing_text,
    pre_positions_text: follow.pre_positions_text,
    display_settings_snapshot: follow.display_settings_snapshot,
    conditions_snapshot: inheritConditionsSnapshot(srcOffer),
    items: stripSourceFields(merged),
    offer_ids: opts.offers.map((o) => o.id),
    snapshot: {
      created_from_offers: true,
      offer_ids: opts.offers.map((o) => o.id),
      offer_numbers: opts.offers.map((o) => o.number),
      frozen_at: new Date().toISOString(),
    },
  }).select("id").single();

  if (error || !newOrder) return { error: error?.message || "Auftrag konnte nicht erstellt werden." };

  // Relationale order_items (Verrechnungslogik + Quellverweise je Position)
  const commercial = merged.filter((p) => isCommercial(p.type));
  if (commercial.length > 0) {
    const rows = commercial.map((p, i) => {
      const net = lineNet(p);
      const gross = round2(net * (1 + (Number(p.vat_rate) || 0) / 100));
      return {
        order_id: newOrder.id, pos_no: p.number || String(i + 1).padStart(2, "0"),
        service_number: null, short_text: p.name || null, long_text: p.long_text || p.description || null,
        qty: p.qty, unit: p.unit, unit_price: p.unit_price, discount_percent: p.discount_percent,
        vat_rate: p.vat_rate, net, gross,
        source_offer_id: (p as SourcedPosition)._srcDocId ?? null,
        source_offer_item_id: (p as SourcedPosition)._srcItemId ?? null,
        invoiced_qty: 0, sort_order: i,
      };
    });
    await supabase.from("order_items").insert(rows);
  }

  return { id: newOrder.id, number: numData as string };
}

/** Erstellt JE Angebot einen eigenen Auftrag. Liefert alle neuen IDs/Nummern. */
export async function createOrdersPerOffer(opts: CreateOrderOpts): Promise<ChainResult> {
  const blocked = checkOffersConvertible(opts.offers);
  if (blocked) return { ids: [], numbers: [], error: blocked };
  const ids: string[] = []; const numbers: string[] = [];
  for (const offer of opts.offers) {
    const r = await createOrderFromOffers({
      // je Angebot dessen eigenes Projekt (projektübergreifende Sammelaktion möglich)
      projectId: (idOrNull(offer.project_id) ?? idOrNull(opts.projectId)) as string,
      contactId: idOrNull(offer.contact_id) ?? idOrNull(opts.contactId),
      offers: [offer],
      itemFilter: opts.itemFilter,
      title: offer.title ?? null,
      targetOfferTypeId: offer.offer_type_id ?? null,
    });
    if (r.error) return { ids, numbers, error: r.error };
    if (r.id) ids.push(r.id);
    if (r.number) numbers.push(r.number);
  }
  return { ids, numbers };
}

// ============================================================
// AUFTRAG/AUFTRÄGE → RECHNUNG
// ============================================================
export type CreateInvoiceOpts = {
  projectId?: string | null;
  contactId?: string | null;
  orders: any[];                 // ausgewählte Aufträge (inkl. items + offer_type_id)
  itemFilter?: ItemFilter;       // optional je Auftrag Positionsauswahl (welche Positionen)
  // Teilmengen: orderId → (orderItemId → abzurechnende Menge). Überschreibt die Menge
  // der betreffenden Position für DIESE Rechnung (Restmenge bleibt offen).
  qtyFilter?: QtyFilter;
  targetOfferTypeId?: string | null;
};

/** Liest die Positionen eines Auftrags (JSONB bevorzugt, sonst relational). */
async function loadOrderPositions(order: any): Promise<DocPosition[]> {
  const jsonb = Array.isArray(order.items) ? order.items : [];
  if (jsonb.length > 0) return normalizePositions(jsonb);
  const { data } = await supabase.from("order_items").select("*").eq("order_id", order.id).order("sort_order");
  const rows = (data as any[]) ?? [];
  return normalizePositions(rows.map((i) => ({
    id: i.id, type: "free", name: i.short_text ?? "", long_text: i.long_text ?? null,
    number: i.pos_no ?? null, qty: Number(i.qty) || 0, unit: i.unit ?? "Stk",
    unit_price: Number(i.unit_price) || 0, discount_percent: Number(i.discount_percent) || 0,
    vat_rate: Number(i.vat_rate) || 20,
  })));
}

/** Wandelt zusammengeführte DocPositions in Rechnungs-JSONB (mit Gewerk-Gruppe + Quellverweis). */
function positionsToInvoiceJson(positions: SourcedPosition[]): { items: any[]; net: number; vat: number } {
  const items: any[] = [];
  let group = "";
  let net = 0, vat = 0;
  let n = 0;
  for (const p of positions) {
    if (p.type === "title") { group = p.name || ""; continue; }
    if (!isCommercial(p.type)) continue;
    n += 1;
    const lineNetVal = round2((Number(p.qty) || 0) * (Number(p.unit_price) || 0) * (1 - (Number(p.discount_percent) || 0) / 100));
    const gross = round2(lineNetVal * (1 + (Number(p.vat_rate) || 0) / 100));
    net += lineNetVal; vat += (gross - lineNetVal);
    items.push({
      group,
      pos_no: p.number || String(n).padStart(2, "0"),
      short_text: p.name || "",
      long_text: p.long_text || p.description || "",
      qty: Number(p.qty) || 0,
      unit: p.unit || "Stk",
      unit_price: Number(p.unit_price) || 0,
      discount_percent: Number(p.discount_percent) || 0,
      vat_rate: Number(p.vat_rate) || 20,
      net: lineNetVal,
      gross,
      source_order_id: p._srcDocId ?? null,
      source_order_item_id: p._srcItemId ?? null,
    });
  }
  return { items, net: round2(net), vat: round2(vat) };
}

/**
 * Direktweg Angebot → Rechnung: erstellt im Hintergrund zuerst EINEN Auftrag aus
 * dem Angebot (damit die Kette lückenlos bleibt und §19/Snapshots/Quellverweise
 * korrekt übernommen werden) und daraus sofort die Rechnung. Liefert Rechnung +
 * (zur Info) den miterzeugten Auftrag.
 */
export async function createInvoiceFromOffer(
  offer: any,
  opts?: { projectId?: string | null; contactId?: string | null; targetOfferTypeId?: string | null },
): Promise<{ id?: string; number?: string; orderId?: string; orderNumber?: string; error?: string }> {
  const blocked = checkOffersConvertible([offer]);
  if (blocked) return { error: blocked };

  const projectId = idOrNull(opts?.projectId) ?? idOrNull(offer.project_id);
  const contactId = idOrNull(opts?.contactId) ?? idOrNull(offer.contact_id);

  // 1) Auftrag aus dem Angebot (nutzt die geprüfte Ketten-Logik inkl. Doppelbeauftragungs-Schutz).
  const order = await createOrderFromOffers({
    projectId: projectId as string,
    contactId,
    offers: [offer],
    targetOfferTypeId: opts?.targetOfferTypeId ?? offer.offer_type_id ?? null,
  });
  if (order.error || !order.id) return { error: order.error ?? "Auftrag konnte nicht erstellt werden." };

  // 2) Frisch geladenen Auftrag als Quelle für die Rechnung (createInvoiceFromOrders braucht items/status/vat_mode).
  const { data: orderRow, error: loadErr } = await supabase.from("orders").select("*").eq("id", order.id).maybeSingle();
  if (loadErr || !orderRow) {
    return { error: "Der erstellte Auftrag konnte nicht geladen werden.", orderId: order.id, orderNumber: order.number };
  }

  // 3) Rechnung aus dem Auftrag.
  const inv = await createInvoiceFromOrders({ orders: [orderRow], projectId, contactId });
  if (inv.error || !inv.id) {
    return { error: inv.error ?? "Rechnung konnte nicht erstellt werden.", orderId: order.id, orderNumber: order.number };
  }
  return { id: inv.id, number: inv.number, orderId: order.id, orderNumber: order.number };
}

/** Erstellt EINE Rechnung aus einem/mehreren Aufträgen. Liefert die neue Rechnungs-ID. */
export async function createInvoiceFromOrders(opts: CreateInvoiceOpts): Promise<{ id?: string; number?: string; error?: string }> {
  const blocked = checkOrdersConvertible(opts.orders);
  if (blocked) return { error: blocked };

  const variant = opts.targetOfferTypeId ?? singleVariantId(opts.orders);
  if (variant === null && hasVariantConflict(opts.orders)) {
    return { error: "Die gewählten Aufträge haben unterschiedliche Varianten. Bitte eine Zielvariante wählen." };
  }

  const sources: { docId: string; positions: DocPosition[] }[] = [];
  for (const o of opts.orders) sources.push({ docId: o.id, positions: await loadOrderPositions(o) });
  const merged = mergeSourcePositions(sources, opts.itemFilter);

  // Teilmengen anwenden: Menge je Position auf die gewählte Teilmenge setzen (Restmenge bleibt offen).
  if (opts.qtyFilter) {
    for (const p of merged) {
      if (!isCommercial(p.type)) continue;
      const sp = p as SourcedPosition;
      const q = opts.qtyFilter.get(sp._srcDocId ?? "")?.get(sp._srcItemId ?? "");
      if (q != null) p.qty = q;
    }
  }

  const srcOrder: any = opts.orders[0] ?? {};
  // §19-Modus aus dem Quell-Auftrag in die Rechnung übernehmen (Reverse-Charge 0 % USt).
  const invVatMode: string = srcOrder.vat_mode === "par19" ? "par19" : "standard";
  const { items, net, vat: vatRaw } = positionsToInvoiceJson(merged);
  const vat = invVatMode === "par19" ? 0 : vatRaw;
  const gross = round2(net + vat);

  const follow = await deriveFollow("invoice", variant, srcOrder.display_settings_snapshot ?? null, commonPrePositions(opts.orders));
  const title = opts.orders.length === 1 ? (srcOrder.title || null) : null;
  const projectId = idOrNull(opts.projectId) ?? idOrNull(srcOrder.project_id);
  const contactId = idOrNull(opts.contactId) ?? idOrNull(srcOrder.contact_id);

  const { data: newInv, error } = await supabase.from("invoices").insert({
    title,
    invoice_date: new Date().toISOString().slice(0, 10),
    payment_term_days: srcOrder.payment_term_days || 30,
    project_id: projectId, contact_id: contactId,
    order_ids: opts.orders.map((o) => o.id),
    items, net, vat, gross,
    vat_mode: invVatMode,
    doc_status: "entwurf", locked: false,
    offer_type_id: follow.offer_type_id,
    pdf_label: follow.pdf_label,
    doc_intro_text: follow.doc_intro_text,
    doc_closing_text: follow.doc_closing_text,
    pre_positions_text: follow.pre_positions_text,
    display_settings_snapshot: follow.display_settings_snapshot,
    conditions_snapshot: inheritConditionsSnapshot(srcOrder),
    snapshot: {
      created_from_orders: true,
      order_ids: opts.orders.map((o) => o.id),
      order_numbers: opts.orders.map((o) => o.order_number),
      frozen_at: new Date().toISOString(),
    },
  }).select("id, number").single();

  if (error || !newInv) return { error: error?.message || "Rechnung konnte nicht erstellt werden." };
  return { id: (newInv as any).id, number: (newInv as any).number };
}

/** Erstellt JE Auftrag eine eigene Rechnung. */
export async function createInvoicesPerOrder(opts: CreateInvoiceOpts): Promise<ChainResult> {
  const blocked = checkOrdersConvertible(opts.orders);
  if (blocked) return { ids: [], numbers: [], error: blocked };
  const ids: string[] = []; const numbers: string[] = [];
  for (const order of opts.orders) {
    const r = await createInvoiceFromOrders({
      projectId: idOrNull(opts.projectId) ?? idOrNull(order.project_id),
      contactId: idOrNull(order.contact_id) ?? idOrNull(opts.contactId),
      orders: [order],
      itemFilter: opts.itemFilter,
      qtyFilter: opts.qtyFilter,
      targetOfferTypeId: order.offer_type_id ?? null,
    });
    if (r.error) return { ids, numbers, error: r.error };
    if (r.id) ids.push(r.id);
    if (r.number) numbers.push(r.number || "");
  }
  return { ids, numbers };
}

// ── interne Hilfe: _src-Felder vor dem Speichern der JSONB entfernen ──
function stripSourceFields(positions: SourcedPosition[]): DocPosition[] {
  return positions.map(({ _srcDocId, _srcItemId, ...rest }) => rest as DocPosition);
}
