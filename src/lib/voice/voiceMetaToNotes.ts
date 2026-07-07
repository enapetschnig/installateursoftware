// ============================================================
// B4Y SuperAPP – Voice-Meta → Notizen
// ------------------------------------------------------------
// Pure Hilfsfunktionen, die die aus dem Sprach-Angebote-Flow
// extrahierten Ergaenzungen + Hinweise als formatierte Block-
// Suffixe an die bestehenden Angebot-Notizen anhaengen.
//
// Werden aus OfferEditor.applyVoiceResult() benutzt — bewusst
// extrahiert, damit sie unabhaengig vom React-Component testbar
// sind (OfferEditor selbst hat keinen RTL-Setup).
// ============================================================

export interface VoiceMetaForNotes {
  /** Items, die der User als „Ergaenzung" markiert hat. */
  ergaenzungen?: string[];
  /** Items, die der User als „Hinweis" markiert hat. */
  hinweise?: string[];
}

/**
 * Baut den (optional leeren) Suffix-Block, der an `head.notes`
 * angehaengt wird. Format:
 *
 *   \n\n
 *   Ergänzungen aus Sprachnotiz:
 *   • Item 1
 *   • Item 2
 *
 *   Hinweise aus Sprachnotiz:
 *   • Item 1
 *
 * Liefert leeren String, wenn beide Listen leer/undefined sind.
 */
export function buildVoiceNotesSuffix(meta: VoiceMetaForNotes): string {
  const blocks: string[] = [];
  if (meta.ergaenzungen && meta.ergaenzungen.length > 0) {
    blocks.push("Ergänzungen aus Sprachnotiz:");
    blocks.push(...meta.ergaenzungen.map((e) => "• " + e));
  }
  if (meta.hinweise && meta.hinweise.length > 0) {
    if (blocks.length > 0) blocks.push(""); // Leerzeile zwischen den Bloecken
    blocks.push("Hinweise aus Sprachnotiz:");
    blocks.push(...meta.hinweise.map((h) => "• " + h));
  }
  return blocks.length > 0 ? "\n\n" + blocks.join("\n") : "";
}

/**
 * Haengt die Voice-Meta-Blocks an die bestehenden Notizen an
 * (idempotent geschnitten, getrimmt). Bestehende Notizen werden
 * NIE ueberschrieben — nur ergaenzt.
 */
export function mergeVoiceNotes(
  prevNotes: string | null | undefined,
  meta: VoiceMetaForNotes,
): string {
  const suffix = buildVoiceNotesSuffix(meta);
  const merged = ((prevNotes ?? "") + suffix).trim();
  return merged;
}
