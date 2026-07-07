// ============================================================
// B4Y SuperAPP – Zentrale HTML-Sanitisierung (DOMPurify)
// ------------------------------------------------------------
// Schutz gegen Stored-XSS: Rich-Text/Textbausteine, E-Mail-/Signatur-HTML
// und alle weiteren benutzergenerierten HTML-Inhalte werden NUR über diese
// Helfer in den DOM bzw. in das PDF-/Druck-HTML geschrieben.
//
// `<script>`, Event-Handler (onerror/onclick …), `javascript:`-URLs etc.
// werden entfernt; übliche Formatierung (Fett/Kursiv/Listen/Links/Absätze)
// bleibt erhalten. Links erhalten automatisch rel/target-Schutz.
// ============================================================
import DOMPurify from "dompurify";

// Links sicher machen: target=_blank immer mit rel=noopener noreferrer.
if (typeof window !== "undefined") {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/**
 * Bereinigt benutzergeneriertes HTML (Rich-Text/Textbausteine/Signatur).
 * Liefert immer einen String (nie null/undefined) für direkte Verwendung in
 * `dangerouslySetInnerHTML` / `innerHTML` / PDF-HTML.
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(String(dirty), { USE_PROFILES: { html: true } });
}

/**
 * Prüft, ob ein (Rich-Text-)HTML tatsächlich SICHTBAREN Inhalt hat.
 * RichText-Editoren hinterlassen bei „leerem" Inhalt oft Markup wie `<p><br></p>`
 * oder `<div>&nbsp;</div>` – das ist visuell leer. Ein reines `.trim()` würde das
 * fälschlich als befüllt werten. Bilder/Tabellen/Trennlinien zählen als Inhalt.
 */
export function htmlHasVisibleContent(html: string | null | undefined): boolean {
  if (!html) return false;
  if (/<(img|table|hr|svg)\b/i.test(html)) return true;
  const text = String(html)
    .replace(/<[^>]*>/g, "")        // Tags entfernen
    .replace(/&nbsp;/gi, " ")        // geschützte Leerzeichen
    .replace(/&#160;|&#xa0;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0;
}
