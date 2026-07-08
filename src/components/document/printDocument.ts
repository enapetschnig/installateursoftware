// ============================================================
// B4Y SuperAPP – PDF/Druckansicht (Layout im BAU4YOU/Hero-Stil)
// ============================================================
// PDF-Erzeugung über paged.js (clientseitig, ohne Backend):
//   • paged.js paginiert das HTML in echte A4-Seiten und setzt den
//     Druck-@page auf margin:0 → der Browser druckt KEINE eigene
//     Kopf-/Fußzeile mehr (kein Datum, kein Titel, kein about:blank,
//     keine Browser-Seitenzahl).
//   • Eigener Footer (Firmendaten + Dokumentnummer) als „running element"
//     in den @bottom-Margin-Boxen → fix am unteren Seitenrand, auf JEDER
//     Seite, mit reserviertem Platz (Inhalt läuft nie hinein).
//   • Eigene Seitenzählung „Seite X von Y" über counter(page)/counter(pages).
//   • Logo oben rechts, Empfänger-Adresse links auf Höhe des rechten
//     Dokumentdatenblocks (Nr./Projekt/Datum/Ansprechpartner).
//   • Positionstabelle mit Gewerk-Gruppen, Zwischensummen, Zusammenfassung.
// Darstellung (Einzelpreise/Summen/MwSt/Pauschal/Regie …) kommt aus
// OfferDisplay (offer_types-Variante) – unverändert übernommen.
// ============================================================
import { DocPosition, DocSummary, isCommercial, lineNet, computeSummary } from "../../lib/document-types";
import { eur } from "../../lib/format";
import { loadCompanySettings, companyLines, CompanySettings } from "../../lib/company";
import { resolveDocumentSignature, SignatureSource } from "../../lib/document-signature";
import { OfferDisplay, DEFAULT_DISPLAY } from "../../lib/offer-display";
import { signedUrl, detectBucket } from "../../lib/storage";
import { sanitizeHtml } from "../../lib/sanitize";
import logoUrl from "../../assets/logo-full.png";

type CompanyLines = ReturnType<typeof companyLines>;

// paged.js-Polyfill (clientseitig, gepinnte Version). Wird im Druckfenster
// nachgeladen; läuft im echten Browser des Nutzers (nicht in der Sandbox).
const PAGEDJS_URL = "https://cdn.jsdelivr.net/npm/pagedjs@0.4.3/dist/paged.polyfill.js";

// Neutraler Fallback, falls noch keine Firmeneinstellungen geladen werden konnten.
// White-Label: KEINE firmenspezifischen Stamm-/Bankdaten hier hartcodieren – die
// echten Daten kommen aus company_settings des aktuellen Mandanten.
const FALLBACK_CO: CompanyLines = {
  name: "",
  headLine: "",
  regLine: "",
  bankLine: "",
  contactLine: "",
  contactName: "",
  signerRole: "",
  contactMobile: "",
  contactEmail: "",
  iban: "",
  logoUrl: "",
  iconLogoUrl: "",
};

export type PrintMeta = {
  docLabel: string;                 // Variante/Anzeigename (Betreff): z.B. "Pauschalangebot"
  numberLabel?: string;             // Grund-Dokumenttyp für Nummer/Dateiname/Titel: "Angebot"|"Auftrag"|"Rechnung"
  number: string;
  title: string;                    // Betreff
  customer: string;
  date: string;
  vatLabel: string;
  notes?: string | null;
  // Optional – für den vollen Hero-Kopf
  recipientLines?: string[];        // Empfänger-Adressblock (mehrzeilig)
  projectNumber?: string | null;
  customerVatId?: string | null;    // USt-IdNr. (Kunde) – v.a. Rechnung
  subtitleLines?: string[];         // z.B. Leistungszeitraum, externe Auftragsnr.
  projectAddress?: string | null;   // Projektadresse für die Betrifft-Zeile
  intro?: string | null;            // Anrede/Einleitung (Plaintext-Fallback)
  introHtml?: string | null;        // Dokument-Vortext als Rich-Text (HTML)
  prePositionsHtml?: string | null; // „Einleitung vor Positionen" (Rich-Text, direkt vor Tabelle)
  closingHtml?: string | null;      // Dokument-Nachtext als Rich-Text (HTML)
  legalHtml?: string | null;        // Rechtstexte / Zahlungsbedingungen als Rich-Text (HTML)
  showLinePrices?: boolean;         // false = Pauschal (nur Gruppensummen)
  display?: OfferDisplay;           // Angebotsdarstellung (Spalten/Summen/MwSt …)
  payment?: PaymentInfo;            // Zahlungs-/Skonto-Block (v.a. Rechnung)
  footerNote?: string | null;       // optionaler Fußzeilen-Zusatztext je Variante
  showPageNumbers?: boolean;        // eigene „Seite X von Y" (Default: an)
  // Textdokument-Modus (Brief/Anschreiben): KEINE Leistungstabelle/Summen/MwSt/Zahlung,
  // stattdessen freier Rich-Text-Inhalt. Kopf/Empfänger/Betreff/Fußzeile/Signatur bleiben.
  textMode?: boolean;
  bodyHtml?: string | null;         // Hauptinhalt (Rich-Text) im Textdokument-Modus
  // Dokument-Signatur (zentral aufgelöst): die Quelle wird PRO DOKUMENT gewählt
  // (Firmensignatur / Ersteller-Signatur / keine). Default (undefined) = wie 'company'.
  // createdBy dient der Auflösung der Ersteller-Signatur in den async-Wrappern
  // (printDocument/render…). signatureHtml/_signatureNone werden dort aus signatureSource
  // aufgelöst und an buildHtml weitergegeben (keine Doppellogik in den Editoren).
  signatureSource?: SignatureSource;
  createdBy?: string | null;
  signatureHtml?: string | null;
  _signatureNone?: boolean;         // intern: 'none' → KEINE Signatur (kein Auto-Fallback)
};

export type PaymentInfo = {
  dueDate?: string | null;          // Fälligkeitsdatum (formatiert)
  termDays?: number;
  withSkonto?: boolean;
  skontoPercent?: number;
  skontoDays?: number;              // Skontoziel in Tagen (NICHT das Zahlungsziel!)
  skontoAmount?: number;
  skontoDate?: string | null;       // letzter Skonto-Tag (formatiert)
  openAmount?: number;              // offener Bruttobetrag
  totalGross?: number;              // Gesamtsumme (brutto) der ganzen Leistung
  alreadyInvoiced?: number;         // bereits gestellte Teilrechnungen (brutto)
  iban?: string;
  overview?: { label: string; date?: string; net?: number; vat?: number; gross: number }[];
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escLines = (s: unknown) => esc(s).replace(/\n/g, "<br>");
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const hasGreeting = (s: string | null | undefined) => /freundlichen\s+gr[üu]ßen/i.test(s || "");

/**
 * Liefert GENAU EINE Signatur unter dem Dokument – keine doppelte Grußformel.
 *  • Signaturquelle 'none' (meta._signatureNone) → KEINE Signatur, auch kein Auto-Fallback.
 *  • Enthält der Nachtext bereits „Mit freundlichen Grüßen" → KEINE zusätzliche Signatur.
 *  • Sonst, wenn eine konfigurierte Dokument-Signatur (meta.signatureHtml) vorliegt →
 *    diese rendern; die Grußformel „Mit freundlichen Grüßen" wird nur vorangestellt,
 *    wenn die Signatur sie nicht selbst schon enthält.
 *  • Sonst Fallback: automatische Firmen-Signatur (Geschäftsführer aus company_settings).
 */
function signatureBlock(meta: PrintMeta, co: CompanyLines): string {
  if (meta._signatureNone) return "";
  if (hasGreeting(meta.closingHtml)) return "";
  const sig = (meta.signatureHtml || "").trim();
  if (sig) {
    const greet = hasGreeting(sig) ? "" : `<div class="greet">Mit freundlichen Grüßen</div>`;
    return `<div class="closing sign rt">${greet}${sanitizeHtml(sig)}</div>`;
  }
  return `<div class="closing sign">Mit freundlichen Grüßen

${esc(co.contactName)}
${co.signerRole ? esc(co.signerRole) + " / " : ""}${esc(co.name)}</div>`;
}


function buildHtml(
  positions: DocPosition[], summary: DocSummary, meta: PrintMeta,
  logoData: string, co: CompanyLines, autoPrint: boolean,
  posImages: Record<string, string> = {},
): string {
  // Effektive Darstellungseinstellungen (Fallback: alt-Verhalten via showLinePrices)
  const d: OfferDisplay = meta.display ?? {
    ...DEFAULT_DISPLAY,
    show_unit_prices: meta.showLinePrices !== false,
    show_position_totals: meta.showLinePrices !== false,
  };
  const onlyGrand = d.show_only_grand_total;
  const groupTitles = d.group_titles && !onlyGrand;
  const showEP = !onlyGrand && !groupTitles && d.show_unit_prices && !d.is_lump_sum;
  const showPosTot = !onlyGrand && !groupTitles && d.show_position_totals && !d.is_lump_sum;
  const showSub = !onlyGrand && !groupTitles && d.show_subtotals;
  const showTitleSums = !onlyGrand && d.show_title_sums;
  const showVat = d.show_vat;
  const showQty = d.show_quantities !== false;
  const showLongTexts = d.show_long_texts !== false;
  const showDiscount = d.show_discount !== false;
  const showGesamtCol = showPosTot || showSub || groupTitles;
  const moneyN = (showEP ? 1 : 0) + (showGesamtCol ? 1 : 0);
  const cols = 3 + moneyN;

  // Spaltenbreiten: ALLE Spalten EXPLIZIT in % (Summe 100), damit table-layout:fixed
  // auf JEDER Seite identisch rechnet. Eine „auto"-Spalte (ohne Breite) wird von paged.js
  // über Seitenumbrüche hinweg unterschiedlich breit berechnet → Bezeichnung wäre auf
  // Folgeseiten plötzlich schmal. Mit fester Breite ist die Tabelle auf Seite 1/2/3 gleich.
  // Bezeichnung-Spalte bewusst breiter: schmalere Pos/Menge (4/7 %) und Geldspalten (11 %)
  // geben der Bezeichnung mehr Platz; Summe bleibt exakt 100 % (table-layout:fixed, paged.js-stabil).
  // Menge-Spalte 10% (vorher 7%): längere Einheiten wie „pauschal"/„Pauschale"/„lfm"
  // passen so vollständig in die Spalte und laufen nicht mehr in die Bezeichnung.
  // Reicht der Platz dennoch nicht (sehr lange Einheit), bricht die Einheit innerhalb
  // der Menge-Spalte sauber um (siehe CSS td.qty) – nie abgeschnitten.
  const descW = 100 - 4 - 10 - (showEP ? 11 : 0) - (showGesamtCol ? 11 : 0);
  const COLGROUP = `<colgroup><col style="width:4%"><col style="width:10%"><col style="width:${descW}%">`
    + `${showEP ? `<col style="width:11%">` : ""}${showGesamtCol ? `<col style="width:11%">` : ""}</colgroup>`;
  const THEAD = `<tr><th>Pos</th><th>Menge</th><th>Bezeichnung</th>`
    + `${showEP ? `<th class="r">Einheitspreis</th>` : ""}${showGesamtCol ? `<th class="r">Gesamt</th>` : ""}</tr>`;
  const moneyCells = (ep: string, tot: string) =>
    `${showEP ? `<td class="r">${ep}</td>` : ""}${showGesamtCol ? `<td class="r">${tot}</td>` : ""}`;

  // ---- Positionszeilen mit Gewerk-Gruppen ----
  type Grp = { no: string; name: string; sum: number };
  const groups: Grp[] = [];
  let bodyRows = "";
  let grossNoDiscount = 0;
  let openGroup = false;
  let gNo = "", gName = "", gSum = 0;

  // Titel einer Gewerk-/Positionsgruppe: „Pos. <Nr> <Name>" in EINER Zelle, damit die
  // schmale Pos-Spalte (4 %) die Nummer nicht in den Titel der Nachbarspalte überlaufen
  // lässt (vorher „Pos. 1GEMEINKOSTEN"). Ohne Nummer (namenlose Sammelgruppe) KEIN
  // „Pos."-Präfix → „Positionen" statt „Pos. Positionen".
  const grpTitleHtml = (no: string, name: string): string => {
    const n = esc(no);
    const nm = esc(name);
    if (!n) return `<b>${nm}</b>`;
    return `<b>Pos.&nbsp;${n}${nm ? `&nbsp;&nbsp;${nm}` : ""}</b>`;
  };

  const closeGroup = () => {
    if (!openGroup) return;
    groups.push({ no: gNo, name: gName, sum: gSum });
    if (groupTitles) {
      bodyRows += `<tr class="grp"><td class="grpname" colspan="${cols - 1}">${grpTitleHtml(gNo, gName)}</td>`
        + `<td class="r"><b>${eur(gSum)}</b></td></tr>`;
    } else if (showSub) {
      bodyRows += `<tr class="sum"><td></td><td colspan="${cols - 1 - moneyN}" class="sumname">Summe ${esc(gNo)} ${esc(gName)}</td>${moneyCells("", `<b>${eur(gSum)}</b>`)}</tr>`;
    }
    openGroup = false; gSum = 0;
  };

  for (const p of positions) {
    if (p.type === "title") {
      closeGroup();
      openGroup = true; gNo = p.number ?? ""; gName = p.name; gSum = 0;
      if (!groupTitles) bodyRows += `<tr class="grp"><td class="grpname" colspan="${cols}">${grpTitleHtml(gNo, gName)}</td></tr>`;
      continue;
    }
    if (p.type === "text") {
      const t = p.content ?? p.name ?? "";
      if (t && !groupTitles) bodyRows += `<tr class="txt"><td></td><td colspan="${cols - 1}">${escLines(t)}</td></tr>`;
      continue;
    }
    // kaufmännische Position
    if (!openGroup) { openGroup = true; gNo = ""; gName = "Positionen"; gSum = 0; }
    const net = lineNet(p);
    gSum = round2(gSum + net);
    grossNoDiscount = round2(grossNoDiscount + (Number(p.qty) || 0) * (Number(p.unit_price) || 0));
    if (groupTitles) continue; // Detailzeilen ausgeblendet (Titel zusammengefasst)
    const qty = (Number(p.qty) || 0).toLocaleString("de-AT");
    const long = p.long_text || p.description || "";
    const lt = (long && showLongTexts) ? `<div class="lt">${escLines(long)}</div>` : "";
    // Leistungs-/Artikelfoto (dokumentlokaler Snapshot) – nur wenn die jeweilige
    // Darstellungsoption aktiv ist und das Bild als base64-Data-URL aufgelöst wurde.
    const imgData = posImages[p.id];
    const allowImg = (p.type === "service" && d.show_service_images) || (p.type === "article" && d.show_article_images);
    const img = (imgData && allowImg) ? `<div class="posimg"><img src="${imgData}" alt=""></div>` : "";
    bodyRows += `<tr>
      <td class="pos">${esc(p.number ?? "")}</td>
      <td class="qty">${showQty ? `<span class="qn">${qty}</span> <span class="qu">${esc(p.unit)}</span>` : `<span class="qu">${esc(p.unit)}</span>`}</td>
      <td class="desc"><div class="nm"><b>${esc(p.name)}</b></div>${lt}${img}</td>
      ${moneyCells(showEP ? eur(p.unit_price) : "", showPosTot ? eur(net) : "")}
    </tr>`;
  }
  closeGroup();

  // ---- Zusammenfassung ----
  const net = round2(summary.net);
  // Positions-Rabatte (qty*EP ohne Zeilen-Rabatt → Zwischensumme nach Zeilen-Rabatt)
  const subAfterLine = round2(summary.subtotalNet);
  const lineRabatt = round2(grossNoDiscount - subAfterLine);
  const hasLineRabatt = lineRabatt > 0.005;
  // Dokument-Standardnachlass (eigene Zeile, reduziert die Summe)
  const docDiscPct = Number(summary.discountPercent) || 0;
  const docDiscAmt = round2(summary.discountAmount || 0);
  const hasDocDisc = docDiscPct > 0 && docDiscAmt > 0.005;
  const docDiscLabel = `Nachlass ${docDiscPct.toLocaleString("de-AT")} %`;
  const zusGroups = showTitleSums
    ? groups.map((g) =>
      `<tr><td class="zpos"><b>${g.no ? `Pos.&nbsp;${esc(g.no)}` : ""}</b></td><td class="znm">${esc(g.name)}</td><td class="r"><b>${eur(g.sum)}</b></td></tr>`).join("")
    : "";

  const breakdown = (showDiscount && (hasLineRabatt || hasDocDisc))
    ? `<div class="trow"><span>Nettobetrag (ohne Rabatt)</span><span>${eur(grossNoDiscount)}</span></div>`
      + (hasLineRabatt ? `<div class="trow"><span>Rabatt</span><span>-${eur(lineRabatt)}</span></div>` : "")
      + (hasDocDisc ? `<div class="trow"><span>${esc(docDiscLabel)}</span><span>-${eur(docDiscAmt)}</span></div>` : "")
    : "";

  const totals = showVat
    ? (breakdown
      + `<div class="trow"><span>Nettobetrag</span><span>${eur(net)}</span></div>
         <div class="trow"><span>${esc(meta.vatLabel)}</span><span>${eur(summary.vat)}</span></div>
         <div class="trow grand"><span>Gesamtsumme</span><span>${eur(summary.gross)}</span></div>`)
    : `<div class="trow grand"><span>Gesamtbetrag</span><span>${eur(summary.gross)}</span></div>`;

  // ---- Meta-Block (rechts) ----
  const metaRow = (label: string, value?: string | null, cls = "") =>
    value ? `<div class="mrow${cls ? " " + cls : ""}"><span class="ml">${esc(label)}</span><span class="mv">${esc(value)}</span></div>` : "";
  // Rechter Dokumentdatenblock: beginnt bewusst mit der PROJEKTNUMMER und startet
  // damit auf gleicher Höhe wie die Kundenadresse links. Die Dokumentnummer-Zeile
  // (z.B. „Angebot-Nr."/„Pauschalangebot-Nr.") wird hier NICHT mehr angezeigt –
  // die Nummer lebt weiter in Dateiname, PDF-Titel, Fußzeile, Listen & Versionen.
  const metaBlock =
    metaRow("Projektnummer", meta.projectNumber) +
    metaRow("USt-IdNr. (Kunde)", meta.customerVatId) +
    metaRow("Datum", meta.date) +
    metaRow("Ansprechpartner", co.contactName) +
    metaRow("Mobil", co.contactMobile) +
    metaRow("E-Mail", co.contactEmail);

  const recipient = (meta.recipientLines && meta.recipientLines.length
    ? meta.recipientLines : [meta.customer]).filter(Boolean).map(esc).join("<br>");

  const subtitle = (meta.subtitleLines || []).filter(Boolean)
    .map((l) => `<div class="sub">${esc(l)}</div>`).join("");

  // Kein automatischer Standard-/Anredetext mehr: leeres Feld → es erscheint NICHTS.
  const subjectLine = `Betrifft: ${esc(meta.docLabel)}${meta.title ? " – " + esc(meta.title) : ""}${meta.projectAddress ? " – " + esc(meta.projectAddress) : ""}`;
  const docNumberLabel = `${esc(meta.number || "Entwurf")}`;

  // ---- Zahlungs-/Skonto-Block (v.a. Rechnung) ----
  let paymentHtml = "";
  const pay = meta.payment;
  if (pay) {
    const ovRows = (pay.overview || []).map((r) =>
      `<tr><td>${esc(r.label)}</td><td class="r">${r.date ? esc(r.date) : ""}</td>` +
      `<td class="r">${r.net != null ? eur(r.net) : ""}</td>` +
      `<td class="r">${r.vat != null ? eur(r.vat) : ""}</td>` +
      `<td class="r"><b>${eur(r.gross)}</b></td></tr>`).join("");
    const ovTable = ovRows
      ? `<table class="pay"><thead><tr><th>Position</th><th class="r">Datum</th><th class="r">Netto</th><th class="r">MwSt</th><th class="r">Brutto</th></tr></thead><tbody>${ovRows}</tbody></table>`
      : "";
    const open = pay.openAmount;
    const dedTxt = (pay.alreadyInvoiced && pay.alreadyInvoiced > 0)
      ? `Gesamtsumme ${eur(pay.totalGross ?? 0)}, abzüglich bereits gestellter Teilrechnungen ${eur(pay.alreadyInvoiced)}. `
      : "";
    // Zahlungsziel: bei Rechnung mit offenem Betrag/Fälligkeit; bei Angebot/Auftrag als
    // reine Bedingung „Zahlbar innerhalb von X Tagen netto." (kein offener Betrag).
    const dueTxt = open != null
      ? `${dedTxt}Bitte überweisen Sie den offenen Betrag von <b>${eur(open)}</b>${pay.dueDate ? ` bis spätestens ${esc(pay.dueDate)}` : ""}.`
      : (pay.dueDate ? `Zahlbar bis ${esc(pay.dueDate)}.` : (pay.termDays ? `Zahlbar innerhalb von ${pay.termDays} Tagen netto.` : ""));
    const skP = pay.skontoPercent ? String(pay.skontoPercent).replace(".", ",") : "";
    // Skontofrist = Skontoziel (skontoDays), NICHT das Zahlungsziel (termDays). Ohne gepflegtes
    // Skontoziel KEIN Rückfall auf das Zahlungsziel → generischer Text „innerhalb der Skontofrist".
    const skontoFrist = pay.skontoDays;
    const skontoAmtTxt = pay.skontoAmount && pay.skontoAmount > 0 ? ` (${eur(pay.skontoAmount)})` : "";
    const skontoNetTxt = open != null ? ` Somit zahlen Sie nur ${eur(round2(open - (pay.skontoAmount ?? 0)))}.` : "";
    const skontoTxt = pay.withSkonto && pay.skontoPercent
      ? `Bei Zahlung innerhalb von ${skontoFrist ? `${skontoFrist} Tagen` : "der Skontofrist"}${pay.skontoDate ? `, also bis ${esc(pay.skontoDate)},` : ""} gewähren wir Ihnen ${skP} % Skonto${skontoAmtTxt}.${skontoNetTxt}`
      : "";
    const ibanVal = pay.iban || co.iban;
    const ibanTxt = ibanVal ? `<br>Zahlung auf unser Konto: IBAN ${esc(ibanVal)}.` : "";
    if (ovTable || dueTxt || skontoTxt) {
      paymentHtml = `<div class="paywrap">${ovTable}` +
        `<div class="payinfo">${dueTxt}${skontoTxt ? ` ${skontoTxt}` : ""}${ibanTxt}</div></div>`;
    }
  }

  // Seitenzahlen werden IMMER angezeigt (frühere Abschaltung über show_page_numbers
  // entfernt; die Variantenspalte bleibt als Legacy bestehen, steuert das PDF aber nicht mehr).
  const showPageNums = true;
  // Eigene Seitenzählung in die rechte untere Margin-Box (paged.js: counter(pages)).
  const pageNumberRule = showPageNums
    ? `@bottom-right { content: "Seite " counter(page) " von " counter(pages); font-size: 7.5px; color: #334155; line-height: 1.45; vertical-align: bottom; padding-bottom: 6mm; }`
    : "";
  const footerCenter = [co.headLine, co.regLine, co.bankLine, co.contactLine, meta.footerNote || ""]
    .filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join("");

  // Saubere Dokumentnummer als Seitentitel (Browser nutzt ihn als Vorschlag beim
  // „Als PDF speichern" / Drucken). Keine Varianten-Bezeichnung, keine UUID.
  const cleanTitle = meta.number || `${meta.numberLabel || meta.docLabel} Entwurf`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>${esc(cleanTitle)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2937; font-size: 10.5px; line-height: 1.45; }

  /* ---- Seitenlayout (paged.js) ----
     Seitenränder reservieren oben Platz für den Kopf und UNTEN den Bereich
     für die fixe Fußzeile + Seitenzahl. paged.js setzt beim Druck @page
     margin:0, daher erscheint KEINE Browser-Kopf-/Fußzeile. */
  @page {
    size: A4;
    /* oberer Rand bewusst knapp → Logo sitzt hoch (zentral für alle Dokumenttypen);
       5mm ist die praktische Untergrenze (Drucker-Randzone).
       UNTEN 24mm: reserviert die Höhe der Firmen-Fußzeile (bis ~6 Zeilen) PLUS einen
       Sicherheitsabstand zum Blattrand, damit auch nicht-randlose Drucker (Hardware-Rand
       ~4–5mm) keine Fußzeilenzeile abschneiden. Von 28mm auf 24mm reduziert → mehr nutzbare
       A4-Höhe pro Seite (weniger Umbrüche), Fußzeile bleibt drucksicher (padding-bottom 6mm). */
    margin: 5mm 14mm 24mm 14mm;
    /* Firmen-Fußzeile links (läuft auf jeder Seite, reservierter Platz), Seitenzahl rechts.
       padding-bottom 6mm = Sicherheitsabstand zum unteren Blattrand (Drucker-Randzone). */
    /* Fußzeile in drei Zonen: Dokumentnummer links, Firmendaten mittig zentriert,
       Seitenzahl rechts – einheitliche Schrift/Größe/Farbe/Zeilenhöhe, bündig unten. */
    @bottom-left { content: element(docNum); vertical-align: bottom; padding-bottom: 6mm; }
    @bottom-center { content: element(coFoot); vertical-align: bottom; padding-bottom: 6mm; }
    ${pageNumberRule}
  }
  /* Laufendes Fußzeilen-Element: aus dem Fluss genommen, in die Margin-Box jeder Seite platziert.
     line-height kompakt (1.45), damit die gesamte Fußzeile sicher in die reservierte
     Margin-Box (28mm − 6mm Sicherheitsabstand = ~22mm nutzbar) passt. */
  /* Einheitliche Fußzeilen-Typografie für ALLE drei Zonen (links/mitte/rechts):
     gleiche Schriftart (vom body geerbt), Größe 7.5px, Farbe, Zeilenhöhe. */
  .docNum { position: running(docNum); font-size: 7.5px; color: #334155; line-height: 1.45; font-weight: 700; white-space: nowrap; }
  .coFoot { position: running(coFoot); font-size: 7.5px; color: #334155; line-height: 1.45; text-align: center; }

  /* Bildschirm-Vorschau: echte Seitenblätter mit Schatten + Abstand.
     WICHTIG: NUR @media screen. Im Druck darf eine paged.js-Seite KEINEN
     margin/Schatten haben – sonst überschreitet die Seitenbox A4 und es
     entstehen leere Spillover-Seiten (nur Fußzeile). */
  @media screen {
    .pagedjs_pages { background: #f1f5f9; padding: 10px 0; }
    .pagedjs_page  { background: #fff; box-shadow: 0 2px 14px rgba(15,23,42,.14); margin: 10px auto; }
  }
  /* Druck: Seiten randlos (paged.js hat Ränder + Fußzeile bereits in die Seite
     eingebaut); zusätzlich Browser-@page auf margin:0 → kein doppelter Rand,
     keine Browser-Kopf-/Fußzeile, keine Spillover-Seiten. */
  @media print {
    /* KEIN @page{margin:0} hier! paged.js verwendet die oben definierten
       Seitenränder (5/14/24/14mm) und entfernt die Browser-Kopf-/Fußzeile selbst.
       margin:0 würde sämtliche Seitenränder im Druck auf 0 zwingen. */
    .pagedjs_pages { background: #fff; }
    .pagedjs_page  { margin: 0 !important; box-shadow: none !important; }
  }

  /* ---- Kopfbereich: Logo oben rechts (gleiche Breite wie der Datenblock),
         darunter Adresse links + Datenblock rechts ---- */
  /* Logo-Band: vom Datenblock darunter ENTKOPPELT (klarer Abstand) und vertikal
     mittig zwischen oberem Rand und dem Datenblock platziert. Rechtsbündig,
     gleiche Breite wie der Datenblock. */
  /* Logo ca. 5mm tiefer als zuvor (margin-top 5mm) und mittig zwischen oberem
     Blattrand und dem rechten Datenblock platziert; rechtsbündig, feste Höhe,
     damit es nie abgeschnitten wird oder mit Adresse/Datenblock kollidiert. */
  .logo { width: 252px; height: 30mm; margin: 5mm 0 10mm auto; display: flex; align-items: center; justify-content: flex-end; }
  .logo img { display: block; max-width: 100%; max-height: 22mm; width: auto; height: auto; object-fit: contain; object-position: right center; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .recipient { font-size: 11px; line-height: 1.5; max-width: 58%; overflow-wrap: anywhere; }
  .headright { width: 252px; flex: 0 0 auto; }
  .meta { width: 100%; }
  .mrow { display: flex; justify-content: space-between; gap: 12px; padding: 1.5px 0; }
  .mrow .ml { color: #64748b; }
  .mrow .mv { font-weight: 600; text-align: right; }
  /* Dokumentnummer: gleiche Schriftart/Größe wie der Kopf, aber abgesetzt/hervorgehoben */
  .mrow.mrow-num { background: #f1f5f9; border-radius: 4px; padding: 3px 8px; margin: 2px 0; }
  .mrow.mrow-num .ml { color: #334155; font-weight: 700; }
  .mrow.mrow-num .mv { font-weight: 800; color: #0f172a; }

  .title { font-size: 12.5px; font-weight: 700; margin: 16px 0 4px; overflow-wrap: anywhere; }
  .sub { color: #475569; }
  .intro { color: #334155; margin: 10px 0 4px; white-space: pre-wrap;
           border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
  .prepos { color: #334155; margin: 10px 0 2px; white-space: pre-wrap; }
  .prepos.rt { white-space: normal; }

  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.lv { table-layout: fixed; }            /* festes Spaltenraster (Pos/Menge/Bez/EP/Gesamt) */
  /* Spaltenbreiten ZUSÄTZLICH an den Zellen: paged.js kopiert <colgroup> NICHT in
     Folgeseiten-Fragmente. Ohne Breitenquelle rechnet die UMBRUCH-Berechnung dort mit
     gleich breiten Spalten (Bezeichnung schmal → Zeilen viel höher) und bricht Seiten
     deutlich zu früh um → riesige Leerräume (z. B. Seite 2 nur zu 1/3 gefüllt).
     Mit Zellbreiten stimmt bereits die Pagination; restoreColgroups() bleibt als
     Sicherheitsnetz für die finale Optik. (Kein Effekt auf Tabellen MIT colgroup –
     <col>-Breiten haben bei table-layout:fixed Vorrang vor Zellbreiten.) */
  table.lv td.pos { width: 4%; }
  table.lv td.qty { width: 10%; }
  table.lv td.desc { width: ${descW}%; }
  table.lv td.r { width: 11%; }
  thead { display: table-header-group; }       /* Tabellenkopf wiederholt sich auf Folgeseiten */
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }  /* Positionszeilen nie über Seiten trennen */
  /* Titel-/Gewerkzeile (und Begleittext) NIE allein am Seitenende: Der Umbruch wird
     hinter einer Titel-/Textzeile vermieden, dadurch wandert der Titel zusammen mit
     der ersten darunterliegenden Position auf die nächste Seite. */
  tr.grp, tr.txt { break-after: avoid; page-break-after: avoid; }
  /* Kopf etwas höher + mehr Sperrung → wirkt ruhiger/hochwertiger; Datenzeilen
     minimal kompakter (5px statt 6px vertikal) → mehr Inhalt je Seite ohne Quetschen. */
  th { text-align: left; border-bottom: 1.5px solid #334155; padding: 7px 5px;
       font-size: 9px; text-transform: uppercase; letter-spacing: .4px; color: #334155; }
  th.r { text-align: right; }
  td { padding: 5px; vertical-align: top; }
  td.r { text-align: right; white-space: nowrap; }
  td.pos { white-space: nowrap; color: #475569; font-size: 9.5px; }
  /* Menge-Zelle: Umbruch nur ZWISCHEN Zahl und Einheit (white-space normal),
     NIE mitten im Wort – overflow-wrap:anywhere hatte Einheiten wie „pauschal"
     hässlich zu „paus/chal" zerteilt. Die 10%-Spalte fasst gängige Einheiten;
     die Zahl (.qn) bleibt immer zusammen. */
  td.qty { color: #475569; white-space: normal; overflow-wrap: normal; }
  td.qty .qn { white-space: nowrap; }
  td.qty .qu { hyphens: none; }
  td.desc, .nm, .lt, .znm { overflow-wrap: anywhere; }
  td.znm { font-weight: 600; }
  td.zpos { white-space: nowrap; color: #475569; font-size: 9.5px; }
  /* Zusammenfassungs-Spaltenbreiten auch als Zellbreiten (für Folgeseiten-Fragmente
     ohne colgroup – gleiche Logik wie table.lv td.pos/qty/desc/r oben). */
  table.lv td.zpos { width: 10%; }
  table.lv td.znm { width: 76%; }
  tr.grp td { border-top: 1px solid #e2e8f0; padding-top: 9px; }
  tr.grpname { font-size: 11.5px; }
  /* Blocksatz für Positions-Kurz-/Langtext: nur MEHRZEILIGE Texte werden ausgerichtet
     (CSS justify streckt nie die letzte/einzige Zeile → einzeilige Texte bleiben optisch
     unverändert linksbündig). text-justify:inter-word vermeidet Buchstabensperrung. */
  .nm { font-size: 11px; text-align: justify; text-justify: inter-word; }
  .lt { color: #475569; font-size: 9.5px; margin-top: 2px; white-space: pre-wrap;
        text-align: justify; text-justify: inter-word; }
  .posimg { margin-top: 5px; }
  .posimg img { width: 50%; max-width: 50%; height: auto; border-radius: 4px; border: 1px solid #e2e8f0; }
  tr.txt td { color: #475569; padding-top: 2px; }
  tr.sum td { border-top: 1px solid #cbd5e1; border-bottom: 1.5px solid #cbd5e1; padding: 7px 5px; }
  tr.sum .sumname { font-weight: 700; }

  /* Zusammenfassung: NICHT als Ganzes unteilbar – ein großer avoid-Block würde bei
     vielen Titeln komplett auf die nächste Seite springen und davor eine große
     Leerfläche hinterlassen (Ursache „halb leere Seite vor der Zusammenfassung").
     Stattdessen fein gesteuert: Überschrift klebt an der ersten Zeile (break-after
     avoid), die Titel-Summen-Tabelle darf zwischen Zeilen umbrechen (tr-avoid gilt
     global), nur der Summenblock (.tot) bleibt als Einheit zusammen. */
  .zus { margin-top: 12px; }
  .zus-h { font-weight: 700; font-size: 12px; margin-bottom: 6px; break-after: avoid; page-break-after: avoid; }
  .tot { margin-top: 10px; margin-left: auto; width: 320px; max-width: 100%; break-inside: avoid; page-break-inside: avoid; }
  .trow { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; }
  .trow span:last-child { text-align: right; white-space: nowrap; }
  .trow.grand { border-top: 2px solid #334155; margin-top: 4px; padding-top: 7px;
                font-weight: 700; font-size: 13px; }

  .paywrap { margin-top: 14px; break-inside: avoid; page-break-inside: avoid; }
  table.pay { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  table.pay th { font-size: 9px; text-transform: uppercase; color: #334155; border-bottom: 1.5px solid #334155; padding: 5px; text-align: left; }
  table.pay th.r { text-align: right; }
  table.pay td { padding: 5px; border-bottom: 1px solid #f1f5f9; }
  .payinfo { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 9px 11px; color: #334155; }

  /* Abschlussgruppe: Nachtext + Signatur als EINE Einheit, die nicht zwischen den
     Seiten zerrissen wird. So entsteht keine fast leere Folgeseite mit nur der Signatur;
     bei echtem Platzmangel wandert die ganze Gruppe gemeinsam auf die nächste Seite.
     Der Zahlungsblock (.paywrap) liegt bewusst AUSSERHALB dieser Gruppe. */
  .closing-group { break-inside: avoid; page-break-inside: avoid; }
  .closing { margin-top: 14px; color: #334155; white-space: pre-wrap; break-inside: avoid; page-break-inside: avoid; }
  .sign { margin-top: 14px; }
  .sign.rt { white-space: normal; }
  .sign .greet { margin-bottom: 12px; }

  /* Rich-Text-Bausteine (Vor-/Nachtext, Rechts-/Zahlungstexte) – sauberer Druck */
  .rt p { margin: 0 0 6px; }
  .rt p:last-child { margin-bottom: 0; }
  .rt ul, .rt ol { margin: 4px 0 6px; padding-left: 20px; }
  .rt li { margin: 2px 0; }
  .rt strong, .rt b { font-weight: 700; }
  .rt em, .rt i { font-style: italic; }
  .rt a { color: inherit; text-decoration: underline; }
  .intro.rt { white-space: normal; }
  /* Einheitliche Schriftgröße für ALLE Rich-Text-Bausteine: eingefügte/gemischte
     Formatierungen (Inline-font-size aus Copy&Paste, Überschriften h1–h6) dürfen die
     Fließtextgröße NICHT verändern. !important schlägt auch Inline-Styles. Überschriften
     bleiben fett, aber in Textgröße – kein „großer" erster Punkt mehr. */
  .rt, .rt p, .rt ul, .rt ol, .rt li, .rt span, .rt div,
  .rt h1, .rt h2, .rt h3, .rt h4, .rt h5, .rt h6 {
    font-size: 10.5px !important; line-height: 1.5 !important;
  }
  .rt h1, .rt h2, .rt h3, .rt h4, .rt h5, .rt h6 { margin: 0 0 6px; font-weight: 700; }
  .docbody { margin-top: 14px; color: #1f2937; line-height: 1.55; }
  .block-post { margin-top: 12px; color: #334155; }
  .block-legal { margin-top: 12px; color: #475569; font-size: 9.7px; line-height: 1.5; }
  .ph-missing { background: #fde68a; color: #92400e; border-radius: 3px; padding: 0 3px; }
</style></head><body data-autoprint="${autoPrint ? "1" : "0"}">

  <!-- Laufende Fußzeile (paged.js platziert sie in die @bottom-Margin-Box jeder Seite) -->
  <!-- Fußzeile: Dokumentnummer (links), Firmendaten (mittig zentriert), Seitenzahl (rechts, via @bottom-right) -->
  <div class="docNum">${docNumberLabel}</div>
  <div class="coFoot">${footerCenter}</div>

  <div class="content">
    <div class="logo"><img src="${logoData}" alt="${esc(co.name)}"></div>
    <div class="head">
      <div class="recipient">${recipient || "&nbsp;"}</div>
      <div class="headright"><div class="meta">${metaBlock}</div></div>
    </div>

    <div class="title">${subjectLine}</div>
    ${subtitle}
    ${meta.introHtml ? `<div class="intro rt">${sanitizeHtml(meta.introHtml)}</div>` : (meta.intro ? `<div class="intro">${escLines(meta.intro)}</div>` : "")}
    ${meta.prePositionsHtml ? `<div class="prepos rt">${sanitizeHtml(meta.prePositionsHtml)}</div>` : ""}

    ${meta.textMode
      ? `<div class="docbody rt">${meta.bodyHtml ? sanitizeHtml(meta.bodyHtml) : ""}</div>`
      : `<table class="lv">
      ${COLGROUP}
      <thead>${THEAD}</thead>
      <tbody>${bodyRows || `<tr><td colspan="${cols}" style="color:#94a3b8">Keine Positionen.</td></tr>`}</tbody>
    </table>

    <div class="zus">
      <div class="zus-h">Zusammenfassung</div>
      ${/* Pos.-Spalte 10% (vorher 6%): „Pos. 12" braucht mit nowrap mehr Platz –
            sonst lief die Nummer optisch in den Titel („Pos.GEMEINKOSTEN"). */""}
      ${zusGroups ? `<table class="lv"><colgroup><col style="width:10%"><col style="width:76%"><col style="width:14%"></colgroup><tbody>${zusGroups}</tbody></table>` : ""}
      <div class="tot">${totals}</div>
    </div>`}

    ${meta.legalHtml ? `<div class="block-legal rt">${sanitizeHtml(meta.legalHtml)}</div>` : ""}

    ${meta.textMode ? "" : paymentHtml}

    <!-- Abschlussgruppe: Nachtext + (optionaler Notiz-Nachtext) + Signatur bleiben ZUSAMMEN
         (break-inside:avoid). Bei echtem Platzmangel wandern sie GEMEINSAM auf die nächste
         Seite – nie nur die Signatur allein auf eine fast leere Folgeseite. Der Zahlungsblock
         steht bewusst AUSSERHALB (oben), damit die Gruppe nicht zu groß wird. -->
    <div class="closing-group">
      ${meta.closingHtml ? `<div class="block-post rt">${sanitizeHtml(meta.closingHtml)}</div>` : ""}
      ${(!meta.closingHtml && meta.notes) ? `<div class="closing">${escLines(meta.notes)}</div>` : ""}
      ${signatureBlock(meta, co)}
    </div>
  </div>

  <script src="${PAGEDJS_URL}"></script>
  <script>
    (function () {
      // Ready-Signal für den Server-Renderer (PDFShift wait_for="b4yPdfReady"):
      // true erst, wenn paged.js fertig paginiert hat (afterRendered → __pagedReady).
      // So wartet der Renderer GENAU so lange wie nötig statt eines fixen Delays.
      window.b4yPdfReady = function () { return window.__pagedReady === true; };
      var auto = document.body.getAttribute("data-autoprint") === "1";
      var printed = false;
      function doPrint() { if (printed) return; printed = true; try { window.focus(); } catch (e) {} window.print(); }
      // ---- ZENTRALER FIX: Spaltenbreiten über Seitenumbrüche stabil halten ----
      // paged.js 0.4.3 zerteilt lange Tabellen in mehrere <table>-Fragmente (je Seite),
      // KOPIERT dabei aber WEDER <colgroup> NOCH <thead> in die Folgeseiten-Fragmente.
      // Mit table-layout:fixed fehlt dem Fragment dann jede Breitenquelle → alle Spalten
      // werden gleich breit (Bezeichnung schrumpft auf Folgeseiten, Umbruch/Preise springen).
      // Lösung: nach dem Rendern jedes Fragment ohne colgroup mit dem colgroup SEINER
      // Ursprungstabelle (gleiche data-ref) wieder versorgen. Das definiert die Breiten
      // zeilentyp-unabhängig (auch bei Titel-/Summenzeilen) und löst einen sofortigen
      // Reflow aus → Seite 1/2/3… exakt identisch. Greift zentral für ALLE Dokumenttypen.
      function restoreColgroups() {
        try {
          // Defensiv: doppelte colgroups entfernen (mehr als eine = doppelte
          // Spaltendefinitionen → Tabelle würde auf halbe Breite gequetscht).
          document.querySelectorAll("table.lv").forEach(function (t) {
            var cgs = t.querySelectorAll(":scope > colgroup");
            for (var i = 1; i < cgs.length; i++) cgs[i].remove();
          });
          var map = {};
          document.querySelectorAll("table.lv").forEach(function (t) {
            var cg = t.querySelector(":scope > colgroup");
            if (cg) { var k = t.getAttribute("data-ref"); if (k && !map[k]) map[k] = cg.outerHTML; }
          });
          document.querySelectorAll("table.lv").forEach(function (t) {
            if (!t.querySelector(":scope > colgroup")) {
              var k = t.getAttribute("data-ref");
              if (k && map[k]) t.insertAdjacentHTML("afterbegin", map[k]);
            }
          });
        } catch (e) { /* Layout bleibt im Zweifel wie bisher – kein harter Fehler */ }
      }
      // ---- Tabellenkopf auf Folgeseiten wiederholen ----
      // paged.js 0.4.3 wiederholt <thead> NICHT auf Folgeseiten-Fragmenten (kein
      // table-header-group-Repeat). Wir setzen den Kopf seiner Ursprungstabelle
      // (gleiche data-ref) nachträglich ein – MIT Overflow-Schutz: würde der Kopf
      // die letzte Zeile über den Seiteninhalt drücken (Gefahr: Abschneiden), wird
      // er auf DIESER Seite wieder entfernt. So niemals Datenverlust. Tabellen ohne
      // eigenen Kopf (z.B. Zusammenfassung) bleiben unberührt (kein data-ref-Eintrag).
      function repeatHeaders() {
        try {
          var map = {};
          document.querySelectorAll("table.lv").forEach(function (t) {
            var th = t.querySelector(":scope > thead");
            if (th) { var k = t.getAttribute("data-ref"); if (k && !map[k]) map[k] = th.outerHTML; }
          });
          document.querySelectorAll("table.lv").forEach(function (t) {
            if (t.querySelector(":scope > thead")) return;           // erste Seite: Kopf schon da
            var k = t.getAttribute("data-ref");
            var html = map[k];
            if (!html) return;                                       // Tabelle ohne Kopf (z.B. Zusammenfassung)
            var box = t.closest(".pagedjs_page_content") || t.closest(".pagedjs_page");
            var cg = t.querySelector(":scope > colgroup");
            if (cg) cg.insertAdjacentHTML("afterend", html); else t.insertAdjacentHTML("afterbegin", html);
            if (box) {
              var rows = t.querySelectorAll(":scope > tbody > tr");
              var lastAfter = rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom : 0;
              if (lastAfter > box.getBoundingClientRect().bottom + 1) {
                var added = t.querySelector(":scope > thead");
                if (added) added.remove();                           // kein Platz → Seite unverändert lassen
              }
            }
          });
        } catch (e) { /* Kopf-Wiederholung ist optional – nie blockierend */ }
      }
      if (window.Paged && window.Paged.registerHandlers) {
        class PrintHandler extends window.Paged.Handler {
          // WICHTIG: KEIN renderNode-Hook zum Colgroup-Injizieren! Der Hook feuert
          // bereits beim ERST-Rendern der Tabelle (bevor paged.js die originale
          // colgroup als Kind anhängt) → die Tabelle bekäme ZWEI colgroups
          // (doppelte Spaltendefinitionen) und der Inhalt würde auf halbe Breite
          // gequetscht (Bug 2026-07-07: Seite 1 + Zusammenfassung schmal/verklebt).
          // Die korrekte Umbruch-Berechnung der Folgeseiten übernehmen die
          // Zellbreiten im CSS (table.lv td.pos/qty/desc/r).
          afterRendered() { restoreColgroups(); repeatHeaders(); window.__pagedReady = true; if (auto) setTimeout(doPrint, 350); }
        }
        window.Paged.registerHandlers(PrintHandler);
      } else {
        // paged.js nicht erreichbar → Ready-Signal trotzdem setzen (der Server-Renderer
        // würde sonst bis zum 30s-Cap warten) und im Autoprint-Fall trotzdem drucken.
        window.addEventListener("load", function () {
          setTimeout(function () { window.__pagedReady = true; if (auto) doPrint(); }, 1500);
        });
      }
    })();
  </script>
</body></html>`;
}

async function logoAsDataUrl(src: string): Promise<string> {
  try {
    const abs = new URL(src, document.baseURI).href;
    const res = await fetch(abs);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch {
    return src; // Fallback: direkte URL
  }
}

/**
 * Löst die Fotos der Positionen zu base64-Data-URLs auf (nur Leistungs-/Artikel-
 * positionen mit aktiver Darstellungsoption). Private Buckets → erst signierte URL,
 * dann base64 – damit das Bild im (auch finalisierten) PDF-Snapshot dauerhaft gültig
 * bleibt (signierte URLs würden ablaufen). Liefert Map Positions-ID → Data-URL.
 */
async function resolvePositionImages(positions: DocPosition[], display?: OfferDisplay): Promise<Record<string, string>> {
  const d = display ?? DEFAULT_DISPLAY;
  const out: Record<string, string> = {};
  const wanted = positions.filter((p) => !!p.image_url && (
    (p.type === "service" && d.show_service_images) || (p.type === "article" && d.show_article_images)
  ));
  await Promise.all(wanted.map(async (p) => {
    try {
      const bucket = detectBucket(p.image_url) ?? (p.type === "article" ? "article-images" : "service-images");
      const signed = await signedUrl(bucket, p.image_url);
      if (!signed) return;
      const dataUrl = await logoAsDataUrl(signed);
      if (dataUrl && dataUrl.startsWith("data:")) out[p.id] = dataUrl;
    } catch { /* einzelnes Bild überspringen, Rest des PDFs nicht blockieren */ }
  }));
  return out;
}

/**
 * Fügt eine bildschirm-only App-Leiste mit „Drucken" + „Schließen / Zurück zur App"
 * in das PDF-/Druckfenster ein. Im Druck/PDF (@media print) ist die Leiste komplett
 * ausgeblendet → Inhalt, Download und Druck bleiben unverändert. Wird auf neue und
 * gespeicherte HTMLs angewandt, OHNE den gespeicherten Snapshot selbst zu verändern
 * (Manipulation passiert nur am transient angezeigten Fenster, wie data-autoprint).
 */
function injectAppBar(html: string, returnUrl?: string): string {
  const retLit = JSON.stringify(returnUrl || "");
  const css = `<style>
  @media screen {
    body.b4y-has-bar { padding-top: 48px !important; }
    .b4y-appbar { position: fixed; top: 0; left: 0; right: 0; height: 44px; display: flex;
      align-items: center; justify-content: flex-end; gap: 8px; padding: 0 14px;
      background: #1f2937; color: #fff; z-index: 2147483647;
      box-shadow: 0 1px 6px rgba(0,0,0,.25); font-family: system-ui, -apple-system, sans-serif; }
    .b4y-appbar .b4y-title { margin-right: auto; font-size: 13px; opacity: .85; }
    .b4y-appbar button { font: inherit; font-size: 13px; padding: 6px 12px; border: 0;
      border-radius: 6px; background: #374151; color: #fff; cursor: pointer; }
    .b4y-appbar button.primary { background: #dc2626; }
    .b4y-appbar button:hover { filter: brightness(1.12); }
  }
  @media print { .b4y-appbar { display: none !important; } body.b4y-has-bar { padding-top: 0 !important; } }
</style>`;
  const bar = `<div class="b4y-appbar">
    <span class="b4y-title">PDF-Ansicht</span>
    <button type="button" onclick="window.print()">Drucken / Als PDF speichern</button>
    <button type="button" class="primary" onclick="b4yCloseView()">Schließen</button>
  </div>
  <script>
    document.body.classList.add('b4y-has-bar');
    var b4yRet = ${retLit};
    function b4yCloseView(){
      try { window.close(); } catch(e) {}
      // Fallback, falls der Browser das Schließen blockiert (Fenster nicht per Script geöffnet):
      // zurück zur GENAU gespeicherten Herkunfts-URL (returnUrl inkl. ?versions=1) → exakte
      // Vorher-Ansicht; sonst Opener-URL/Referrer.
      setTimeout(function(){
        if (!window.closed) {
          var u = b4yRet || '';
          try { if (!u && window.opener && !window.opener.closed && window.opener.location) u = window.opener.location.href; } catch(e) {}
          try { if (window.opener && !window.opener.closed) { window.opener.focus(); window.close(); } } catch(e) {}
          if (!window.closed) { location.href = u || document.referrer || '/'; }
        }
      }, 300);
    }
    window.addEventListener('keydown', function(e){ if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); b4yCloseView(); } }, true);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); b4yCloseView(); } }, true);
  </script>`;
  let out = html;
  if (out.includes("</head>")) out = out.replace("</head>", css + "</head>");
  out = out.replace(/(<body[^>]*>)/, "$1" + bar);
  return out;
}

/**
 * Reichert die Meta um die zentral aufgelöste Dokument-Signatur an. Die Quelle
 * (Firmensignatur / Ersteller / keine) steckt in meta.signatureSource und wird zentral
 * über resolveDocumentSignature() aufgelöst (KEINE Doppellogik hier). Eine bereits
 * gesetzte meta.signatureHtml hat Vorrang (z. B. aus einem gespeicherten Snapshot/Override).
 * Bei Fehlern bleibt die Meta unverändert → Fallback auf die automatische Firmen-Signatur.
 */
async function withSignature(meta: PrintMeta, s: CompanySettings | null): Promise<PrintMeta> {
  if (meta.signatureHtml != null || meta._signatureNone) return meta;
  try {
    const resolved = await resolveDocumentSignature({
      source: meta.signatureSource,
      createdBy: meta.createdBy,
      companyDefaultHtml: s ? (s.document_signature_html ?? null) : undefined,
      companyMode: s ? (s.document_signature_mode ?? null) : undefined,
    });
    if (resolved.mode === "none") return { ...meta, _signatureNone: true };
    return { ...meta, signatureHtml: resolved.html };
  } catch {
    return meta;
  }
}

export async function printDocument(positions: DocPosition[], summary: DocSummary, meta: PrintMeta, returnUrl?: string, targetWin?: Window | null) {
  // targetWin: bereits im Klick geöffnetes Fenster wiederverwenden (kein neues
  // window.open nach await → kein Popup-Blocker beim Server-PDF-Fallback).
  const w = targetWin && !targetWin.closed ? targetWin : window.open("", "_blank", "width=900,height=1200");
  if (!w) { alert("Bitte Popups erlauben, um das PDF zu erstellen."); return; }
  let co: CompanyLines = FALLBACK_CO;
  let s: CompanySettings | null = null;
  try { s = await loadCompanySettings(); if (s) co = companyLines(s); } catch { /* Fallback */ }
  const metaSig = await withSignature(meta, s);
  const logoData = await logoAsDataUrl(co.logoUrl || logoUrl);
  const posImages = await resolvePositionImages(positions, meta.display);
  const html = injectAppBar(buildHtml(positions, summary, metaSig, logoData, co, true, posImages), returnUrl);
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

/**
 * Druckt einen bereits gespeicherten Dokument-Snapshot (print_html aus
 * document_versions). So bleibt ein finalisiertes/versendetes Dokument beim
 * erneuten Drucken exakt unverändert – auch wenn sich Firmendaten, Logo oder
 * Texte später ändern. autoPrint wird aktiviert.
 */
export function printStoredHtml(html: string, returnUrl?: string, targetWin?: Window | null) {
  const w = targetWin && !targetWin.closed ? targetWin : window.open("", "_blank", "width=900,height=1200");
  if (!w) { alert("Bitte Popups erlauben, um das PDF zu erstellen."); return; }
  const withAutoprint = html.includes('data-autoprint="0"')
    ? html.replace('data-autoprint="0"', 'data-autoprint="1"')
    : html;
  const out = injectAppBar(withAutoprint, returnUrl);
  w.document.open();
  w.document.write(out);
  w.document.close();
  w.focus();
}

export const countPrintable = (positions: DocPosition[]) => positions.filter((p) => isCommercial(p.type)).length;

/**
 * Liefert den fertigen Druckstand als HTML-String (für Versions-Snapshots).
 * Verwendet die öffentliche Logo-URL (kompakter als Data-URL); identisch druckbar.
 * autoPrint=false → beim späteren Öffnen wird nicht automatisch gedruckt.
 */
export async function renderDocumentHtml(positions: DocPosition[], summary: DocSummary, meta: PrintMeta): Promise<string> {
  let co: CompanyLines = FALLBACK_CO;
  let s: CompanySettings | null = null;
  try { s = await loadCompanySettings(); if (s) co = companyLines(s); } catch { /* Fallback */ }
  // Signatur in den Snapshot fest einbetten → spätere Stamm-/Signaturänderungen ändern den
  // finalisierten Druckstand NICHT (revisionssicher).
  const metaSig = await withSignature(meta, s);
  // Fotos als base64 in den Snapshot einbetten → dauerhaft gültig (auch nach Stamm-/Bucket-Änderung).
  const posImages = await resolvePositionImages(positions, meta.display);
  return buildHtml(positions, summary, metaSig, co.logoUrl || logoUrl, co, false, posImages);
}

// ============================================================
// Textdokument-PDF (Brief/Anschreiben) – KEINE Leistungstabelle/Summen/MwSt/Zahlung.
// Verwendet dieselbe Engine (buildHtml) im textMode → identischer Kopf/Logo/Empfänger/
// Fußzeile/Seitenzahlen/Signatur, nur freier Rich-Text statt Positionen. Keine Doppellogik.
// ============================================================
type TextPrintMeta = Omit<PrintMeta, "vatLabel" | "textMode"> & { vatLabel?: string };

/** Öffnet das Textdokument als druckbares PDF-Fenster. */
export async function printTextDocument(meta: TextPrintMeta, returnUrl?: string) {
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) { alert("Bitte Popups erlauben, um das PDF zu erstellen."); return; }
  let co: CompanyLines = FALLBACK_CO;
  let s: CompanySettings | null = null;
  try { s = await loadCompanySettings(); if (s) co = companyLines(s); } catch { /* Fallback */ }
  const full: PrintMeta = await withSignature({ vatLabel: "", ...meta, textMode: true }, s);
  const logoData = await logoAsDataUrl(co.logoUrl || logoUrl);
  const html = injectAppBar(buildHtml([], computeSummary([]), full, logoData, co, true), returnUrl);
  w.document.open(); w.document.write(html); w.document.close(); w.focus();
}

/** Liefert den fertigen Textdokument-Druckstand als HTML (für PDF-Snapshots). */
export async function renderTextDocumentHtml(meta: TextPrintMeta): Promise<string> {
  let co: CompanyLines = FALLBACK_CO;
  let s: CompanySettings | null = null;
  try { s = await loadCompanySettings(); if (s) co = companyLines(s); } catch { /* Fallback */ }
  const full: PrintMeta = await withSignature({ vatLabel: "", ...meta, textMode: true }, s);
  return buildHtml([], computeSummary([]), full, co.logoUrl || logoUrl, co, false);
}
