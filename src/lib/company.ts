// ============================================================
// B4Y SuperAPP – Firmeneinstellungen (Aussteller-Stammdaten)
// Zentral in den Einstellungen pflegbar, speist Kopf-/Fußzeile der Dokumente.
// ============================================================
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type CompanySettings = {
  id: number;
  name: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  fn: string | null;          // Firmenbuchnummer
  fn_court: string | null;    // Firmenbuchgericht
  tax_number: string | null;  // Steuernummer
  uid: string | null;         // USt-IdNr.
  ceo: string | null;         // (Altfeld) früher einzelner Geschäftsführer – nur noch Fallback
  gesellschafter: string[] | null;     // Gesellschafter (0..n)
  geschaeftsfuehrer: string[] | null;  // Geschäftsführer (0..n)
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  web: string | null;
  logo_url: string | null;        // Hauptlogo (Dokumente, Kopfzeilen, offizielle Auftritte)
  icon_logo_url: string | null;   // Icon-Logo (Sidebar, App-Icon, kleine Ansichten)
  document_signature_html: string | null; // Globale Standard-Signatur für Dokumente/PDFs (getrennt von E-Mail-Signatur)
  document_signature_mode?: string | null; // Firmen-Modus (Migr. 0123): 'force_company' | 'allow_employee'
  email_signature_html: string | null;    // Globale Standard-E-Mail-Signatur (HTML) – getrennt von der Dokument-Signatur
  // Kalkulations-Parameter der Voice-Angebote-Pipeline (Migr. 0125).
  // Spalten-Defaults matchen die frueheren Hardcode-Werte (DEFAULT_KALK_SETTINGS).
  kalk_aufschlag_gesamt?: number | null;
  kalk_aufschlag_material?: number | null;
  kalk_stundensatz_default?: number | null;
  kalk_material_cap?: number | null;
  updated_at?: string;
};

export async function loadCompanySettings(): Promise<CompanySettings | null> {
  // Mandantengerecht: RLS liefert genau die company_settings-Zeile der aktuellen
  // Organisation. Kein hartes id=1 mehr (das war Single-Tenant-spezifisch).
  const { data } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
  return (data as CompanySettings) ?? null;
}

// ============================================================
// Live-Cache für Logo-Konsumenten (Sidebar, Login, kleine Ansichten).
// Damit ein in den Firmeneinstellungen hochgeladenes Logo automatisch
// in der ganzen App erscheint – ohne dass jede Komponente selbst lädt.
// ============================================================
export type CompanyBranding = { logo_url: string | null; icon_logo_url: string | null };

/**
 * Lädt nur die Logo-URLs – über die öffentliche View `company_branding`.
 * Diese ist auch ohne Anmeldung lesbar, damit das Logo bereits auf der
 * Login-Seite erscheint. Sensible Firmendaten bleiben über die View verborgen.
 */
export async function loadCompanyBranding(): Promise<CompanyBranding | null> {
  const { data } = await supabase.from("company_branding")
    .select("logo_url, icon_logo_url").limit(1).maybeSingle();
  return (data as CompanyBranding) ?? null;
}

let cachedBranding: CompanyBranding | null | undefined; // undefined = noch nicht geladen
let inflight = false;
const companyListeners = new Set<() => void>();
const notifyCompany = () => companyListeners.forEach((l) => l());

function loadBrandingIntoCache() {
  inflight = true;
  loadCompanyBranding()
    .then((s) => { cachedBranding = s; })
    .catch(() => { cachedBranding = null; })
    .finally(() => { inflight = false; notifyCompany(); });
}

function ensureCompanyLoaded() {
  if (cachedBranding !== undefined || inflight) return;
  loadBrandingIntoCache();
}

/** Nach dem Speichern der Firmeneinstellungen aufrufen → Logo überall live aktualisieren. */
export function refreshCompanySettings() {
  loadBrandingIntoCache();
}

/**
 * Liefert das hochgeladene Logo (Haupt- und Icon-Logo) aus den Firmeneinstellungen.
 * Fällt auf einen leeren String zurück, solange nichts hochgeladen/geladen ist –
 * die Logo-Komponenten zeigen dann das mitgelieferte App-Logo.
 */
export function useCompanyLogo() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    companyListeners.add(fn);
    ensureCompanyLoaded();
    return () => { companyListeners.delete(fn); };
  }, []);
  const c = cachedBranding ?? null;
  return {
    logoUrl: c?.logo_url?.trim() || "",
    iconLogoUrl: (c?.icon_logo_url?.trim() || c?.logo_url?.trim() || ""),
    loading: cachedBranding === undefined,
  };
}

const join = (parts: (string | null | undefined)[], sep: string) =>
  parts.map((p) => (p ?? "").trim()).filter(Boolean).join(sep);

/** Baut die Textzeilen + Kontaktangaben für die Dokument-Engine. */
export function companyLines(c: CompanySettings | null) {
  const name = c?.name?.trim() || "";

  // Personen-Logik: Gesellschafter haben Vorrang vor Geschäftsführer.
  // Altfeld `ceo` dient nur noch als Fallback für noch nicht migrierte Mandanten.
  const clean = (arr?: string[] | null) => (arr ?? []).map((s) => (s ?? "").trim()).filter(Boolean);
  const gesellschafter = clean(c?.gesellschafter);
  const gfList = clean(c?.geschaeftsfuehrer);
  const gfFallback = gfList.length ? gfList : (c?.ceo?.trim() ? [c.ceo.trim()] : []);
  // Fußzeile/Firmenzeile: Gesellschafter bevorzugt (alle), sonst erster Geschäftsführer (kompakt).
  // Keine leeren „Geschäftsführer:"-Texte, kein falsches Label.
  const personLabel = gesellschafter.length ? "Gesellschafter" : (gfFallback.length ? "Geschäftsführer" : "");
  const personValue = gesellschafter.length ? gesellschafter.join(", ") : (gfFallback[0] ?? "");
  const personLine = personLabel && personValue ? `${personLabel}: ${personValue}` : "";
  // Signatur: Name + rollenkorrekte Bezeichnung (kein „Geschäftsführer" für Gesellschafter).
  const signerName = (gfFallback[0] || gesellschafter[0] || "").trim();
  const signerRole = gfFallback.length ? "Geschäftsführer" : (gesellschafter.length ? "Gesellschafter" : "");

  const headLine = join([
    name,
    c?.street,
    join([c?.zip, c?.city], " "),
    personLine,
  ], " | ");
  const regLine = join([
    c?.fn ? `FN ${c.fn}${c?.fn_court ? " " + c.fn_court : ""}` : "",
    c?.tax_number ? `Steuernummer: ${c.tax_number}` : "",
    c?.uid ? `USt-IdNr.: ${c.uid}` : "",
  ], " | ");
  const bankLine = join([
    c?.bank_name,
    c?.iban ? `IBAN: ${c.iban}` : "",
    c?.bic ? `BIC: ${c.bic}` : "",
  ], " | ");
  // Kontaktzeile für die Fußzeile (Tel. | E-Mail | Web) – alle aus den Firmeneinstellungen.
  const contactLine = join([
    (c?.phone || c?.mobile) ? `Tel.: ${c?.phone || c?.mobile}` : "",
    c?.email ? `E-Mail: ${c.email}` : "",
    c?.web ? `Web: ${c.web}` : "",
  ], " | ");
  return {
    name,
    headLine,
    regLine,
    bankLine,
    contactLine,
    contactName: signerName,
    signerRole,
    contactMobile: (c?.mobile || c?.phone || "").trim(),
    contactEmail: c?.email?.trim() || "",
    iban: c?.iban?.trim() || "",
    logoUrl: c?.logo_url?.trim() || "",
    // Icon-Logo mit Fallback auf das Hauptlogo
    iconLogoUrl: (c?.icon_logo_url?.trim() || c?.logo_url?.trim() || ""),
  };
}
