// ============================================================
// B4Y SuperAPP – Zentrale Produkt-/Domain-Konfiguration (white-label-fähig)
// ============================================================
// EINZIGE Quelle für Produktname + App-URL. Beides ist über Build-Env
// überschreibbar, damit die App für andere Firmen/Produkte (z.B.
// „Handwerk SuperAPP") ohne Code-Umbau ausgeliefert werden kann und KEINE
// feste Vercel-Domain im Code steht.
//
//   VITE_APP_NAME  → Produktname        (Default: „B4Y SuperAPP")
//   VITE_APP_URL   → öffentliche Domain (Default: https://b4y-superapp.app)
//
// WICHTIG: Firmenname/Logo/Farben/PDF-Firmendaten kommen weiterhin pro Mandant
// aus den Firmeneinstellungen (company_settings) – das hier ist der PRODUKT-Layer
// (Marke/Domain), bewusst getrennt von der Mandanten-Identität.
// ============================================================

const env = import.meta.env as Record<string, string | undefined>;

/** Produkt-/App-Name (Anzeige: Titel, Login, Meldungen …). */
export const APP_NAME: string = (env.VITE_APP_NAME?.trim()) || "B4Y SuperAPP";

/** Konfigurierte öffentliche App-URL (ohne Trailing-Slash). */
export const APP_URL: string = ((env.VITE_APP_URL?.trim()) || "https://b4y-superapp.app").replace(/\/+$/, "");

/**
 * Absolute App-URL für Links (Mail/PDF/externe Verweise).
 * Im Browser wird bewusst der AKTUELLE Origin bevorzugt → funktioniert lokal,
 * auf der Custom Domain und (falls noch erreichbar) auf der Vercel-Domain gleich,
 * ohne harte Domain im Code. Für serverseitige Nutzung greift APP_URL als Fallback.
 */
export function appUrl(path = ""): string {
  const base = (typeof window !== "undefined" && window.location?.origin)
    ? window.location.origin
    : APP_URL;
  const clean = base.replace(/\/+$/, "");
  return path ? `${clean}/${String(path).replace(/^\/+/, "")}` : clean;
}

/** Feste konfigurierte Domain (origin-unabhängig) – für Canonical/Absenderzeilen. */
export const APP_CANONICAL_URL: string = APP_URL;
