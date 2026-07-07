// ============================================================
// B4Y SuperAPP – Angebotsdarstellung (PDF/Kundendarstellung)
// Globale Defaults (offer_display_settings, 1 Zeile) + pro-Angebot-Override.
// Steuert NUR die Darstellung – die interne Kalkulation bleibt unverändert.
// ============================================================

export type OfferDisplay = {
  is_lump_sum: boolean;
  show_unit_prices: boolean;
  show_position_totals: boolean;
  show_subtotals: boolean;
  show_only_grand_total: boolean;
  show_images: boolean;
  show_service_images: boolean;
  show_article_images: boolean;
  show_articles_inside_services: boolean;
  show_vat: boolean;
  group_titles: boolean;
  show_title_sums: boolean;
  show_quantities: boolean;
  show_long_texts: boolean;
  show_discount: boolean;
};

export const DEFAULT_DISPLAY: OfferDisplay = {
  is_lump_sum: false,
  show_unit_prices: true,
  show_position_totals: true,
  show_subtotals: true,
  show_only_grand_total: false,
  show_images: false,
  show_service_images: false,
  show_article_images: false,
  show_articles_inside_services: false,
  show_vat: true,
  group_titles: false,
  show_title_sums: true,
  show_quantities: true,
  show_long_texts: true,
  show_discount: true,
};

// Reihenfolge + Beschriftung für die UI.
// Hinweis: Es werden nur Schalter angeboten, die im PDF tatsächlich wirken.
// (Legacy-Flags `show_images` und `show_articles_inside_services` bleiben im Typ/
//  in der DB als no-op erhalten, werden aber NICHT mehr in der UI angeboten –
//  sie hatten keine erkennbare PDF-Wirkung.)
export const DISPLAY_FIELDS: { key: keyof OfferDisplay; label: string; help?: string }[] = [
  { key: "is_lump_sum", label: "Pauschalangebot", help: "Blendet Einzel- und Positionspreise aus." },
  { key: "show_unit_prices", label: "Einzelpreise anzeigen" },
  { key: "show_position_totals", label: "Positionssummen anzeigen" },
  { key: "show_subtotals", label: "Zwischensummen je Titel anzeigen" },
  { key: "show_title_sums", label: "Titelsummen in der Zusammenfassung" },
  { key: "group_titles", label: "Titel zusammenfassen", help: "Nur eine Zeile je Titel, Positionen ausgeblendet." },
  { key: "show_only_grand_total", label: "Nur Gesamtsumme am Ende", help: "Echtes Pauschalangebot – keine Detailpreise." },
  { key: "show_vat", label: "Mehrwertsteuer ausweisen" },
  { key: "show_service_images", label: "Leistungsfotos im PDF anzeigen" },
  { key: "show_article_images", label: "Artikelfotos im PDF anzeigen" },
  { key: "show_quantities", label: "Mengen anzeigen" },
  { key: "show_long_texts", label: "Langtexte anzeigen" },
  { key: "show_discount", label: "Rabatt anzeigen" },
];

/**
 * Technischer Fallback der Dokumentdarstellung.
 * Früher wurde hier eine globale, vom Nutzer pflegbare Zeile (`offer_display_settings`)
 * geladen. Diese „globale Fallback"-Einstellung wurde entfernt (für Nutzer doppelt zur
 * Variante/Dokumentart). Maßgeblich ist jetzt: Dokument-Override → Variante bzw.
 * Dokumentart → `DEFAULT_DISPLAY`. Diese Funktion liefert nur noch den technischen
 * Default; bestehende Dokument-Snapshots bleiben davon unberührt.
 */
export async function loadGlobalDisplay(): Promise<OfferDisplay> {
  return { ...DEFAULT_DISPLAY };
}

/** Effektive Darstellung: Basis (Variante/Dokumentart/Default), ggf. mit Dokument-Override. */
export function resolveOfferDisplay(global: OfferDisplay, offer: { use_global_display?: boolean | null; display?: Partial<OfferDisplay> | null }): OfferDisplay {
  if (offer.use_global_display === false && offer.display) {
    return { ...global, ...offer.display };
  }
  return global;
}
