// ============================================================
// B4Y SuperAPP – E-Mail: Pure Helper fuer Empfaenger-Parsing
// ------------------------------------------------------------
// Nimmt einen Freitext ("a@x.com, Bob <b@y.com>; c@z.com") und
// zerlegt ihn in Recipient-Objekte fuer sendMail(). Fehlerhafte
// Eintraege werden in `invalid[]` gesammelt, damit die UI sie
// als roten Chip markieren kann.
//
// Bewusst OHNE React – so testbar (vitest) und in ComposeDialog
// wiederverwendbar. Regex ist eine RFC-5322-Naeherung: reicht
// fuer Compose-Validierung; Backend + Graph validieren streng.
// ============================================================
import type { Recipient } from "../../lib/microsoft/mailClient";

// Naeherung: local@domain, mind. ein Punkt in domain, keine Whitespace.
const EMAIL_RE =
  /^[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface ParseEmailListResult {
  recipients: Recipient[];
  invalid: string[];
}

/**
 * Wandelt eine Freitext-Empfaengerliste in Recipient[]-Objekte um.
 *
 * Akzeptiert:
 *   - Komma und Semikolon als Trenner ("a@x, b@y; c@z")
 *   - Name-Notation "Bob <b@y.com>" und blanke Adresse "b@y.com"
 *   - Extra-Whitespace, Quotes rund um Namen
 *
 * Nicht gueltige Eintraege landen unveraendert in `invalid[]`;
 * leere Segmente werden ignoriert.
 */
export function parseEmailList(input: string): ParseEmailListResult {
  const out: Recipient[] = [];
  const invalid: string[] = [];
  if (!input || typeof input !== "string") return { recipients: out, invalid };

  // Sowohl `,` als auch `;` als Trenner erlauben – Outlook-kompatibel.
  const segments = input
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const seg of segments) {
    // "Bob <b@y.com>" oder "Bob" + "b@y.com"
    const m = seg.match(/^(.*?)<\s*([^<>\s]+)\s*>$/);
    let name = "";
    let address = "";
    if (m) {
      name = m[1].trim().replace(/^"|"$/g, "").trim();
      address = m[2].trim();
    } else {
      address = seg;
    }
    if (!EMAIL_RE.test(address)) {
      invalid.push(seg);
      continue;
    }
    out.push(name ? { name, address } : { address });
  }
  return { recipients: out, invalid };
}

/** Convenience: `true`, wenn die Liste keine invalidenEintraege hat. */
export function isEmailListValid(input: string): boolean {
  const { invalid } = parseEmailList(input);
  return invalid.length === 0;
}
