// ============================================================
// B4Y SuperAPP – E-Mail-Signatur (zentral)
// ------------------------------------------------------------
// EIN Ort, der entscheidet, welche Signatur unter eine E-Mail kommt:
//   1. aktive E-Mail-Signatur des Mitarbeiters (employees.signature_active + signature_html)
//   2. sonst globale Standard-E-Mail-Signatur (company_settings.email_signature_html)
//   3. sonst leer → keine Signatur anhängen/anzeigen.
//
// BEWUSST getrennt von der Dokument-/PDF-Signatur (document-signature.ts,
// employees.document_signature_*, company_settings.document_signature_html).
// E-Mail- und Dokument-Signatur werden hier NIE vermischt.
// ============================================================
import { supabase } from "./supabase";
import { htmlHasVisibleContent } from "./sanitize";

export type EmployeeEmailSignature = {
  signature_html: string | null;
  signature_active: boolean | null;
};

/** Quelle der effektiv verwendeten E-Mail-Signatur (für UI-Hinweise). */
export type EmailSignatureSource = "employee" | "company" | "none";

/**
 * Wählt die zu verwendende E-Mail-Signatur (HTML) aus Mitarbeiter- und Firmen-Default.
 * Mitarbeiter-Signatur nur, wenn aktiv UND befüllt. Liefert getrimmtes HTML oder "".
 */
export function pickEmailSignatureHtml(
  employee: EmployeeEmailSignature | null | undefined,
  companyDefaultHtml: string | null | undefined,
): string {
  // Visuell leeres RichText-Markup (z. B. <p><br></p>) zählt NICHT als Signatur.
  const emp = (employee?.signature_active && htmlHasVisibleContent(employee?.signature_html))
    ? (employee!.signature_html as string).trim()
    : "";
  if (emp) return emp;
  return htmlHasVisibleContent(companyDefaultHtml) ? (companyDefaultHtml as string).trim() : "";
}

/**
 * Wie pickEmailSignatureHtml, gibt aber zusätzlich die Quelle zurück – damit die UI
 * den effektiv verwendeten Zustand anzeigen kann (eigene / Firmen-Fallback / keine).
 */
export function resolveEmailSignature(
  employee: EmployeeEmailSignature | null | undefined,
  companyDefaultHtml: string | null | undefined,
): { html: string; source: EmailSignatureSource } {
  const emp = (employee?.signature_active && htmlHasVisibleContent(employee?.signature_html))
    ? (employee!.signature_html as string).trim()
    : "";
  if (emp) return { html: emp, source: "employee" };
  const company = htmlHasVisibleContent(companyDefaultHtml) ? (companyDefaultHtml as string).trim() : "";
  if (company) return { html: company, source: "company" };
  return { html: "", source: "none" };
}

/** Lädt die E-Mail-Signatur eines Mitarbeiters (Verknüpfung auth_user_id). */
export async function loadEmployeeEmailSignature(
  authUserId: string | null | undefined,
): Promise<EmployeeEmailSignature | null> {
  if (!authUserId) return null;
  const { data } = await supabase
    .from("employees")
    .select("signature_html, signature_active")
    .eq("auth_user_id", authUserId)
    .limit(1)
    .maybeSingle();
  return (data as EmployeeEmailSignature) ?? null;
}

/**
 * Komplett-Resolver für den (späteren) E-Mail-Versand: liefert die zu verwendende
 * Signatur-HTML (Mitarbeiter bevorzugt, sonst globaler Firmen-Default, sonst "").
 */
export async function resolveEmailSignatureHtml(
  authUserId: string | null | undefined,
  companyDefaultHtml: string | null | undefined,
): Promise<string> {
  const emp = await loadEmployeeEmailSignature(authUserId);
  return pickEmailSignatureHtml(emp, companyDefaultHtml);
}
