// ============================================================
// B4Y SuperAPP – KI-Aktions-Labels für Dokumente (zentral)
// Leitet aus Dokumenttyp + Dokumentvariante (Standard/Pauschal/Regie) verständliche
// DEUTSCHE Labels für das „+ KI"-Menü ab – KEINE technischen Slugs. Eine Quelle,
// damit Labels nicht verstreut hartcodiert werden.
// ============================================================

export type AiDocKind = "angebot" | "auftrag" | "nachtrag" | "rechnung";

/** Variantenwort aus einem offer_type-Namen/-Slug ableiten. */
export function aiVariantWord(variant?: string | null): "Standard" | "Pauschal" | "Regie" {
  const s = (variant ?? "").toLowerCase();
  if (s.includes("pausch")) return "Pauschal";
  if (s.includes("regie")) return "Regie";
  return "Standard";
}

const KIND_NOUN: Record<AiDocKind, string> = {
  angebot: "angebot", auftrag: "auftrag", nachtrag: "nachtrag", rechnung: "rechnung",
};

/**
 * Liefert die Labels für das „+ KI"-Menü eines Dokuments.
 * Immer enthalten: „+ KI Leistung". Zusätzlich ein dokument-/variantenspezifisches
 * Label, z. B. „+ KI Pauschalangebot", „+ KI Standardauftrag", „+ KI Regienachtrag".
 * Bei Rechnung nur die Standard-Variante (keine Pauschal/Regie-Aufteilung).
 */
export function aiDocActionLabels(kind: AiDocKind, variant?: string | null): string[] {
  const leistung = "+ KI Leistung";
  if (kind === "rechnung") return [leistung, "+ KI Standardrechnung"];
  const word = aiVariantWord(variant);
  const noun = KIND_NOUN[kind];
  // „angebot" → „Pauschalangebot"; Großschreibung des zusammengesetzten Wortes.
  const composed = `${word}${noun}`;
  return [leistung, `+ KI ${composed.charAt(0).toUpperCase()}${composed.slice(1)}`];
}
