// ============================================================
// B4Y SuperAPP – Offer-Mail Template
// ------------------------------------------------------------
// Baut Subject/HTML-Body fuer den E-Mail-Versand eines Angebots.
// Wird vom OfferEditor.SendDialog verwendet und liefert vor-
// befuellte Defaults, die der User im Dialog noch ueber-
// schreiben kann.
//
// Sprache: Deutsch (Sie-Form) – MVP: kein Personalisierungs-
// Text ausser Kunde + Angebotsnummer + Absender. Weitere
// Personalisierungen (Anrede pro Kontakt, Sprache, …) folgen
// spaeter mit den Textbausteinen.
//
// KEIN externer Sign-Off/Signature-Text: Microsoft Graph
// haengt die Outlook-Signatur des Users automatisch beim
// Senden an (sofern in Outlook aktiviert). Deshalb setzt der
// Baustein bewusst nur "Mit freundlichen Gruessen" als kurze
// Grussformel und lastet den Rest der Signatur auf Outlook.
// ============================================================

export interface OfferMailContext {
  /** Nummer aus dem Nummernkreis, z. B. "ANGEBOT-0009-2026". null bei Entwuerfen. */
  offerNumber: string | null;
  /** Anzeigename des Empfaengers/Kunden. Kann leer sein → generische Anrede. */
  customerName: string;
  /** Optionaler Anzeigename des Absenders (z. B. profile.name). */
  senderName?: string;
}

// ── HTML-Escaping (leichtgewichtig – wir bauen einen kleinen Body, kein Editor).
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Subject: "Ihr Angebot" + optional " Nr. <num>".
 * - Ohne Nummer (Entwurf): "Ihr Angebot".
 * - Mit Nummer: "Ihr Angebot Nr. ANGEBOT-0009-2026".
 */
export function buildOfferMailSubject(ctx: OfferMailContext): string {
  const num = (ctx?.offerNumber ?? "").trim();
  return num ? `Ihr Angebot Nr. ${num}` : "Ihr Angebot";
}

/**
 * HTML-Body: simpler, mehrzeiliger Textbaustein.
 * Wird 1:1 im SendDialog vorbefuellt und kann vom User editiert werden.
 * Wir liefern HTML mit <p>-Absaetzen – Graph/Outlook rendert das sauber
 * und der Editor im Dialog kann Rich-Text.
 */
export function buildOfferMailHtml(ctx: OfferMailContext): string {
  const num = (ctx?.offerNumber ?? "").trim();
  const name = (ctx?.customerName ?? "").trim();
  const sender = (ctx?.senderName ?? "").trim();

  // Anrede: Wenn Name bekannt → "Sehr geehrte(r) Damen und Herren <Name>," wirkt
  // ueberformell und Genus-unsicher. Wir bleiben bei "Sehr geehrte Damen und Herren"
  // und erwaehnen den Kunden im Body-Text, wenn ein Name vorliegt.
  const greeting = "Sehr geehrte Damen und Herren,";

  const offerRef = num ? ` Nr. ${esc(num)}` : "";
  const forName = name ? ` fuer ${esc(name)}` : "";

  const parts: string[] = [];
  parts.push(`<p>${esc(greeting)}</p>`);
  parts.push(
    `<p>anbei erhalten Sie unser Angebot${offerRef}${forName}. ` +
    `Fuer Rueckfragen stehen wir Ihnen gerne zur Verfuegung.</p>`,
  );
  parts.push(`<p>Mit freundlichen Gruessen${sender ? `<br>${esc(sender)}` : ""}</p>`);

  return parts.join("\n");
}
