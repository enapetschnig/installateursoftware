// ============================================================
// B4Y SuperAPP – Adress-Autovervollständigung (zentral, wiederverwendbar)
// ------------------------------------------------------------
// Ruft die Edge Function `address-search` auf (Proxy zum Adress-Provider, Österreich).
// Vorteile: kein CORS, kein Provider-Key im Frontend, Provider serverseitig austauschbar
// (Default Photon/OSM; per ENV ADDRESS_UPSTREAM_URL auf BEV/data.gv.at umstellbar).
// Bei Fehler/inaktiv → leeres Ergebnis (Eingabe bleibt manuell möglich, kein Crash).
//
// Wichtig (zentrale Verbesserung): Eine Eingabe wie "Hyegasse 7" lieferte beim Provider
// schlechtere Treffer als "Hyegasse" allein (die Hausnummer stört das Geocoder-Ranking).
// Deshalb wird die Straße von der Hausnummer GETRENNT, nur mit der (normalisierten) Straße
// gesucht, und die Hausnummer beim Übernehmen wieder an die gefundene Straße angehängt.
// Optionaler PLZ/Ort-Kontext verbessert das Ranking (clientseitig stabil, ohne Provider-/
// Edge-Änderung). Davon profitieren alle Aufrufer von AddressAutocomplete (Kontakte,
// Projekte, Mitarbeiter, Firmeneinstellungen). Reine Parse-/Ranking-Logik liegt in
// ./address-format (unit-getestet).
// ============================================================
import { supabase } from "./supabase";
import {
  AddressSuggestion,
  AddressContext,
  splitStreet,
  normalizeStreetQuery,
  reattachHouseNo,
  rankByContext,
} from "./address-format";

// Re-Export für bestehende Importe (z. B. AddressAutocomplete) und Wiederverwendung.
export type { AddressSuggestion, AddressContext } from "./address-format";
export { splitStreet, normalizeStreetQuery, reattachHouseNo, rankByContext } from "./address-format";

/**
 * Sucht Adressvorschläge (mind. 3 Zeichen). Trennt Hausnummer ab, sucht straßen-basiert,
 * hängt die Hausnummer wieder an und rankt optional per PLZ/Ort. Liefert [] bei zu kurzer
 * Eingabe/Fehler.
 */
export async function searchAddress(query: string, ctx?: AddressContext): Promise<AddressSuggestion[]> {
  const raw = (query ?? "").trim();
  if (raw.length < 3) return [];

  const { street, houseNo } = splitStreet(raw);
  const streetQuery = normalizeStreetQuery(street);
  // Mit der Straße allein suchen (besseres Geocoder-Ranking). Falls die Straße zu kurz
  // wäre, fällt die Suche auf die Roh-Eingabe zurück (kein leeres Ergebnis erzwingen).
  const q = streetQuery.length >= 3 ? streetQuery : raw;

  try {
    const { data, error } = await supabase.functions.invoke("address-search", { body: { q } });
    if (error) return [];
    const list = (data as { suggestions?: AddressSuggestion[] } | null)?.suggestions;
    if (!Array.isArray(list)) return [];
    const withHouse = list.map((s) => reattachHouseNo(s, houseNo));
    return rankByContext(withHouse, ctx);
  } catch {
    return [];
  }
}
