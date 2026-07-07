// ============================================================
// B4Y SuperAPP – Folge-Dokument-Workflow (Typ-Durchzug)
// Der Angebotstyp fließt durch den gesamten Dokumentworkflow:
//   Angebot → Auftrag → Rechnung
// Pro Typ-Familie wird je Stufe Bezeichnung + Vor-/Nachtext hinterlegt;
// die Darstellung (OfferDisplay) wird unverändert mitgenommen.
// Alles mandantenfähig & frei konfigurierbar – keine harten Werte.
// ============================================================
import { supabase } from "./supabase";
import { OfferDisplay } from "./offer-display";
import { loadTextBlocks, pickBestText, blockHtml, isEmptyHtml, MatchContext } from "./text-blocks";
import { variantLabel } from "./offer-kinds";

export type DocStage = "order" | "invoice" | "nachtrag" | "sub_order";

// Folgedokument-Stufe → Dokument-Nomen für die zentrale automatische Bezeichnung
// (variantLabel ⇒ z. B. „Standardauftrag", „Pauschalrechnung", „Regienachtrag",
// „Standardauftrag SUB"). Keine manuell pflegbaren Folge-Bezeichnungen mehr.
const STAGE_NOUN: Record<DocStage, "auftrag" | "rechnung" | "nachtrag" | "auftrag_sub"> = {
  order: "auftrag", invoice: "rechnung", nachtrag: "nachtrag", sub_order: "auftrag_sub",
};

// Folgedokument-Stufe → Dokumenttyp-Slug (für zentrale Standardtexte aus text_blocks).
const STAGE_DOCTYPE_SLUG: Record<DocStage, string> = {
  order: "auftraege", invoice: "rechnungen", nachtrag: "angebot_nachtrag", sub_order: "auftrag_sub",
};

/**
 * Standard-Vor-/Nachtext eines Folgedokuments ermitteln (zentrale Standardtextlogik).
 * Reihenfolge: 1) Legacy-Text aus document_type_transitions (falls gesetzt), sonst
 * 2) bester Standardtext aus text_blocks je Doctype/Variante. Liefert ROHE Texte mit
 * Platzhaltern ({{…}}) – die Auflösung passiert idempotent beim Rendern/Finalisieren.
 */
export async function resolveFollowStandardTexts(
  stage: DocStage,
  offerTypeId: string | null,
  transition: DocTransition | null,
): Promise<{ intro: string | null; closing: string | null }> {
  const legacyByStage = {
    order: [transition?.order_intro_text, transition?.order_closing_text],
    invoice: [transition?.invoice_intro_text, transition?.invoice_closing_text],
    nachtrag: [transition?.nachtrag_intro_text, transition?.nachtrag_closing_text],
    sub_order: [transition?.sub_order_intro_text, transition?.sub_order_closing_text],
  } as const;
  const [legIntro, legClosing] = legacyByStage[stage];
  let intro = legIntro && !isEmptyHtml(legIntro) ? legIntro : null;
  let closing = legClosing && !isEmptyHtml(legClosing) ? legClosing : null;
  if (intro && closing) return { intro, closing };

  // Zentrale Standardtexte je Dokumenttyp (+ Variante als Subtyp) aus text_blocks.
  try {
    const { data: dt } = await supabase.from("document_types").select("id").eq("slug", STAGE_DOCTYPE_SLUG[stage]).maybeSingle();
    let subtypeSlug: string | null = null;
    if (offerTypeId) {
      const { data: ot } = await supabase.from("offer_types").select("slug").eq("id", offerTypeId).maybeSingle();
      subtypeSlug = (ot as any)?.slug ?? null;
    }
    const ctx: MatchContext = { documentTypeId: (dt as any)?.id ?? null, documentSubtypeId: subtypeSlug };
    const blocks = await loadTextBlocks();
    if (!intro) { const m = pickBestText(blocks, "dokument_vortext", ctx, true); if (m.block) intro = blockHtml(m.block); }
    if (!closing) { const m = pickBestText(blocks, "dokument_nachtext", ctx, true); if (m.block) closing = blockHtml(m.block); }
  } catch { /* zentrale Texte optional – ohne sie bleibt es leer */ }
  return { intro, closing };
}

// ============================================================
// Zentrale Status-Workflow-Regel: Ein Dokument darf erst dann in die
// nächste Stufe überführt werden, wenn es abgeschlossen/finalisiert ist.
// Entwürfe, stornierte/archivierte/gelöschte Dokumente sind gesperrt.
// Gilt zentral für alle Dokumentketten (Angebot→Auftrag→Rechnung) und
// ist über die Status-Listen leicht erweiterbar.
// ============================================================
/** Angebots-Status, aus denen ein Auftrag erstellt werden darf (finalisiert). */
export const OFFER_CONVERTIBLE_STATUSES = ["abgeschlossen", "versendet", "angenommen"];
/** Auftrags-Status, aus denen KEINE Rechnung erstellt werden darf. */
export const ORDER_BLOCKED_STATUSES = ["entwurf", "storniert", "archiviert"];

export type ConvertCheck = { ok: boolean; reason?: string };

type DocLike = { status?: string | null; deleted_at?: string | null } | null | undefined;

/** Darf aus diesem Angebot ein Auftrag erstellt werden? Zentrale Statusprüfung. */
export function canConvertOffer(offer: DocLike): ConvertCheck {
  if (!offer) return { ok: false, reason: "Dieses Angebot existiert nicht mehr." };
  if (offer.deleted_at) return { ok: false, reason: "Dieses Angebot wurde gelöscht." };
  const s = (offer.status || "").toLowerCase();
  if (s === "entwurf")
    return { ok: false, reason: "Dieses Angebot muss zuerst abgeschlossen werden, bevor daraus ein Auftrag erstellt werden kann." };
  if (!OFFER_CONVERTIBLE_STATUSES.includes(s))
    return { ok: false, reason: "Aus diesem Status kann kein Auftrag erstellt werden." };
  return { ok: true };
}

/** Darf aus diesem Auftrag eine Rechnung erstellt werden? Zentrale Statusprüfung. */
export function canConvertOrder(order: DocLike): ConvertCheck {
  if (!order) return { ok: false, reason: "Dieser Auftrag existiert nicht mehr." };
  if (order.deleted_at) return { ok: false, reason: "Dieser Auftrag wurde gelöscht." };
  const s = (order.status || "").toLowerCase();
  if (s === "entwurf")
    return { ok: false, reason: "Dieser Auftrag muss zuerst abgeschlossen werden, bevor daraus eine Rechnung erstellt werden kann." };
  if (ORDER_BLOCKED_STATUSES.includes(s))
    return { ok: false, reason: "Aus diesem Status kann keine Rechnung erstellt werden." };
  return { ok: true };
}

export type DocTransition = {
  id: string;
  offer_type_id: string;
  order_label: string | null;
  order_intro_text: string | null;
  order_closing_text: string | null;
  invoice_label: string | null;
  invoice_intro_text: string | null;
  invoice_closing_text: string | null;
  // Eigene Bezeichnung/Texte je Variante für Nachtrag und Auftrag-SUB (Migr. 0075).
  nachtrag_label: string | null;
  nachtrag_intro_text: string | null;
  nachtrag_closing_text: string | null;
  sub_order_label: string | null;
  sub_order_intro_text: string | null;
  sub_order_closing_text: string | null;
};

const COLS =
  "id,offer_type_id,order_label,order_intro_text,order_closing_text," +
  "invoice_label,invoice_intro_text,invoice_closing_text," +
  "nachtrag_label,nachtrag_intro_text,nachtrag_closing_text," +
  "sub_order_label,sub_order_intro_text,sub_order_closing_text";

function fromRow(r: any): DocTransition {
  return {
    id: r.id,
    offer_type_id: r.offer_type_id,
    order_label: r.order_label ?? null,
    order_intro_text: r.order_intro_text ?? null,
    order_closing_text: r.order_closing_text ?? null,
    invoice_label: r.invoice_label ?? null,
    invoice_intro_text: r.invoice_intro_text ?? null,
    invoice_closing_text: r.invoice_closing_text ?? null,
    nachtrag_label: r.nachtrag_label ?? null,
    nachtrag_intro_text: r.nachtrag_intro_text ?? null,
    nachtrag_closing_text: r.nachtrag_closing_text ?? null,
    sub_order_label: r.sub_order_label ?? null,
    sub_order_intro_text: r.sub_order_intro_text ?? null,
    sub_order_closing_text: r.sub_order_closing_text ?? null,
  };
}

/** Alle Übergänge (für Verwaltung). */
export async function loadTransitions(): Promise<DocTransition[]> {
  const { data, error } = await supabase.from("document_type_transitions").select(COLS);
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map(fromRow);
}

/** Übergang eines bestimmten Angebotstyps (oder null). */
export async function loadTransitionFor(offerTypeId: string | null): Promise<DocTransition | null> {
  if (!offerTypeId) return null;
  const { data } = await supabase
    .from("document_type_transitions")
    .select(COLS)
    .eq("offer_type_id", offerTypeId)
    .maybeSingle();
  return data ? fromRow(data) : null;
}

/** Übergang anlegen/aktualisieren (1 Zeile je Typ & Firma). */
export async function saveTransition(t: Partial<DocTransition> & { offer_type_id: string }): Promise<{ error?: string }> {
  const payload: any = {
    offer_type_id: t.offer_type_id,
    order_label: t.order_label ?? null,
    order_intro_text: t.order_intro_text ?? null,
    order_closing_text: t.order_closing_text ?? null,
    invoice_label: t.invoice_label ?? null,
    invoice_intro_text: t.invoice_intro_text ?? null,
    invoice_closing_text: t.invoice_closing_text ?? null,
    nachtrag_label: t.nachtrag_label ?? null,
    nachtrag_intro_text: t.nachtrag_intro_text ?? null,
    nachtrag_closing_text: t.nachtrag_closing_text ?? null,
    sub_order_label: t.sub_order_label ?? null,
    sub_order_intro_text: t.sub_order_intro_text ?? null,
    sub_order_closing_text: t.sub_order_closing_text ?? null,
    updated_at: new Date().toISOString(),
  };
  if (t.id) payload.id = t.id;
  const { error } = await supabase
    .from("document_type_transitions")
    .upsert(payload, { onConflict: "organization_id,offer_type_id" })
    .select("id");
  return { error: error?.message };
}

/** Quell-Angebot, aus dem ein Folgedokument abgeleitet wird. */
export type FollowSource = {
  offer_type_id: string | null;
  display_settings_snapshot: OfferDisplay | Record<string, unknown> | null;
  display?: Record<string, unknown> | null;
  offer_intro_text?: string | null;
  offer_closing_text?: string | null;
  pre_positions_text?: string | null;
  pdf_label?: string | null;
};

/** Snapshot-Felder, die in das Folgedokument (Auftrag/Rechnung) geschrieben werden. */
export type FollowDocSnapshot = {
  offer_type_id: string | null;
  pdf_label: string | null;
  doc_intro_text: string | null;
  doc_closing_text: string | null;
  pre_positions_text: string | null;
  display_settings_snapshot: OfferDisplay | Record<string, unknown> | null;
};

/**
 * Leitet aus einem Quelldokument (Angebot bzw. Auftrag) die Snapshot-Felder
 * des nächsten Workflow-Schritts ab. Die Darstellung wird 1:1 übernommen;
 * Bezeichnung & Vor-/Nachtext kommen aus der (editierbaren) Übergangsdefinition.
 */
export function deriveFollowDoc(
  stage: DocStage,
  src: FollowSource,
  transition: DocTransition | null,
  offerType?: { slug?: string | null; name?: string | null } | null,
): FollowDocSnapshot {
  // Vor-/Nachtext weiterhin als Legacy-Wert aus der Übergangsdefinition (die zentralen
  // Standardtexte aus text_blocks überschreiben das anschließend in resolveFollowStandardTexts).
  const textByStage = {
    order: [transition?.order_intro_text, transition?.order_closing_text],
    invoice: [transition?.invoice_intro_text, transition?.invoice_closing_text],
    nachtrag: [transition?.nachtrag_intro_text, transition?.nachtrag_closing_text],
    sub_order: [transition?.sub_order_intro_text, transition?.sub_order_closing_text],
  } as const;
  const [intro, closing] = textByStage[stage];
  return {
    offer_type_id: src.offer_type_id ?? null,
    // Folge-Bezeichnung AUTOMATISCH & zentral aus Dokumentart + Variante (variantLabel).
    // Keine manuellen *_label-Overrides mehr (Felder im Varianten-Editor entfernt).
    pdf_label: variantLabel(STAGE_NOUN[stage], offerType ?? null),
    doc_intro_text: intro ?? null,
    doc_closing_text: closing ?? null,
    pre_positions_text: src.pre_positions_text ?? null,
    display_settings_snapshot:
      (src.display_settings_snapshot as OfferDisplay) ??
      (src.display as OfferDisplay) ??
      null,
  };
}
