// ============================================================
// B4Y SuperAPP – Adress-Parsing/-Ranking (rein, ohne Netzwerk – testbar)
// ------------------------------------------------------------
// Reine Hilfsfunktionen für die zentrale Adresssuche (src/lib/address-lookup.ts):
// Straße/Hausnummer trennen, Straße für die Provider-Suche normalisieren, Hausnummer
// wieder anhängen und Treffer per PLZ/Ort-Kontext ranken. Bewusst ohne Supabase-Import,
// damit sie isoliert unit-getestet werden können.
// ============================================================

export type AddressSuggestion = {
  label: string;
  street: string;
  zip: string;
  city: string;
  country: string;
};

/** Optionaler Ranking-Kontext aus dem Formular (PLZ/Ort), falls bereits bekannt. */
export type AddressContext = {
  zip?: string | null;
  city?: string | null;
};

/**
 * Trennt eine "Straße Hausnummer"-Eingabe in Straße + Hausnummer.
 * Die Hausnummer muss am Ende stehen (z. B. "7", "7a", "7/2", "7-9"); Bindestriche im
 * Straßennamen (z. B. "Maria-Theresien-Straße") bleiben Teil der Straße.
 */
export function splitStreet(input: string): { street: string; houseNo: string } {
  const s = (input ?? "").trim();
  const m = s.match(/^(.+?)[\s,]+(\d+\s*[a-zA-Z]?(?:\s*[/-]\s*\d+\s*[a-zA-Z]?)*)$/);
  if (m && m[1].trim()) {
    return { street: m[1].trim().replace(/[\s,]+$/, ""), houseNo: m[2].replace(/\s+/g, "") };
  }
  return { street: s, houseNo: "" };
}

/** Normalisiert die Straße für die Provider-Suche (Mehrfach-Leerzeichen, Rand-Kommata). */
export function normalizeStreetQuery(street: string): string {
  return (street ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/** Hängt die ursprünglich getippte Hausnummer wieder an einen Straßentreffer an. */
export function reattachHouseNo(s: AddressSuggestion, houseNo: string): AddressSuggestion {
  if (!houseNo) return s;
  // Wenn der Treffer bereits eine Hausnummer enthält, nicht doppelt anhängen.
  const hasNumber = /\d/.test(s.street);
  const street = hasNumber ? s.street : `${s.street} ${houseNo}`.trim();
  const label = [street, [s.zip, s.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { ...s, street, label };
}

/** Sortiert Treffer nach PLZ/Ort-Kontext (stabil – keine Veränderung ohne Kontext). */
export function rankByContext(list: AddressSuggestion[], ctx?: AddressContext): AddressSuggestion[] {
  const zip = (ctx?.zip ?? "").trim();
  const city = (ctx?.city ?? "").trim().toLowerCase();
  if (!zip && !city) return list;
  const score = (s: AddressSuggestion): number => {
    let n = 0;
    if (zip && s.zip) {
      if (s.zip === zip) n += 3;
      else if (s.zip.slice(0, 2) === zip.slice(0, 2)) n += 1; // grobe Regions-Nähe
    }
    if (city && s.city && s.city.toLowerCase().includes(city)) n += 2;
    return n;
  };
  return list
    .map((s, i) => ({ s, i, sc: score(s) }))
    .sort((a, b) => b.sc - a.sc || a.i - b.i) // bei Gleichstand ursprüngliche Reihenfolge
    .map((x) => x.s);
}
