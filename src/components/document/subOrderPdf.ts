// ============================================================
// B4Y SuperAPP – PDF für Auftrag-SUB (Subunternehmer)
// Erzeugt das SUB-PDF über die zentrale Print-Engine. Empfänger = Subunternehmer.
// Es werden NUR die SUB-Positionen/-Preise gedruckt (sub_orders.items enthält
// keine Kundenpreise/Marge) → keine internen Werte im Subunternehmer-PDF.
// ============================================================
import { supabase } from "../../lib/supabase";
import { normalizePositions, computeSummary } from "../../lib/document-types";
import { dateAt } from "../../lib/format";
import { printDocument } from "./printDocument";
import { contactDisplayName, resolveRecipientLines, RecipientOverride } from "../../lib/contact-name";
import { buildDocPlaceholders, resolveDocTexts } from "../../lib/document-placeholders";
import { loadCompanySettings } from "../../lib/company";
import { withParagraph19Note } from "../../lib/offer-types";
import { normalizeSignatureSource } from "../../lib/document-signature";

export async function openSubOrderPdf(subOrderId: string): Promise<{ error?: string }> {
  const { data: sub } = await supabase
    .from("sub_orders")
    .select("*, subcontractor:contacts(*), project:projects(*)")
    .eq("id", subOrderId)
    .maybeSingle();
  if (!sub) return { error: "Auftrag-SUB nicht gefunden." };
  const s = sub as any;

  const positions = normalizePositions(s.items);   // nur SUB-Positionen (SUB-Preise)
  // §19 (Reverse Charge): Summe MIT 0-%-Override rechnen, damit Beträge, Label und
  // Hinweis konsistent sind (sonst wies das SUB-PDF §19 aus, summierte aber 20 %).
  const subReverseCharge = s.vat_mode === "par19";
  const summary = computeSummary(positions, subReverseCharge ? 0 : null);

  const sc = s.subcontractor;
  // Zentrale Namens-/Empfängerlogik: respektiert die Kontaktform (Einzelperson →
  // Personenname, auch wenn ein alter Firmenname noch gespeichert ist).
  const scName = contactDisplayName(sc, { fallback: "Subunternehmer" });
  // Dokumentbezogene Empfängeranschrift (Override) hat Vorrang vor dem Kontaktstamm.
  const ovrLines = resolveRecipientLines((s.recipient_override as RecipientOverride) ?? null, sc);
  const recipientLines = ovrLines.length ? ovrLines : [scName];

  const subtitleLines: string[] = [];
  if (s.service_period) subtitleLines.push(`Ausführungszeitraum: ${s.service_period}`);
  if (s.retention_percent) subtitleLines.push(`Haftrücklass: ${s.retention_percent} %`);

  // Platzhalter in den (variantenspezifischen) Vor-/Nachtexten zentral auflösen, damit im
  // SUB-PDF keine rohen {{…}} stehen. Empfänger = Subunternehmer, Projekt aus der Verknüpfung.
  const subLabel = s.pdf_label || "Auftrag SUB";
  const company = await loadCompanySettings().catch(() => null);
  const subPh = buildDocPlaceholders({
    customer: sc ?? null, project: s.project ?? null,
    docNumber: s.sub_number, docDate: s.sub_date,
    docLabel: subLabel, company, bearbeiter: "",
    conditions: { paymentTermDays: s.payment_term_days ?? null, skontoPercent: s.skonto_percent ?? null, skontoDays: s.skonto_days ?? null },
  });
  const subTexts = resolveDocTexts({ intro: s.doc_intro_text, closing: s.doc_closing_text }, subPh);

  await printDocument(positions, summary, {
    docLabel: subLabel,
    numberLabel: "Auftrag",
    number: s.sub_number || "",
    title: s.title || "",
    customer: scName,
    date: dateAt(s.sub_date),
    vatLabel: subReverseCharge ? "MwSt §19 (0 %)" : "MwSt",
    recipientLines,
    subtitleLines: subtitleLines.length ? subtitleLines : undefined,
    introHtml: subTexts.introHtml,
    closingHtml: withParagraph19Note(subTexts.closingHtml, subReverseCharge),
    // Signaturquelle des SUB-Belegs (Firmensignatur/Ersteller/keine) – zentral aufgelöst.
    signatureSource: normalizeSignatureSource(s.signature_source),
    createdBy: s.created_by ?? null,
    payment: {
      termDays: s.payment_term_days ?? undefined,
      withSkonto: !!s.skonto_percent,
      skontoPercent: s.skonto_percent ?? undefined,
      skontoDays: s.skonto_days ?? undefined, // Skontoziel → korrekte Skontofrist im SUB-PDF
    },
  });
  return {};
}
