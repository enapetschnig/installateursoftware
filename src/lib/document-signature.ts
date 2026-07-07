// ============================================================
// B4Y SuperAPP – Dokument-Signatur (zentral)
// ------------------------------------------------------------
// EIN Ort, der entscheidet, welche Signatur unter ein Dokument/PDF kommt.
// Die Auswahl erfolgt PRO DOKUMENT über `signature_source`:
//   • 'company'  → globale Standard-Dokumentsignatur (company_settings.document_signature_html).
//                  Ist sie leer → die PDF-Engine setzt die automatische Firmen-Signatur
//                  (Geschäftsführer/Gesellschafter aus company_settings) als Notnagel.
//   • 'creator'  → persönliche Dokument-Signatur des Erstellers
//                  (employees.document_signature_html via auth_user_id = created_by).
//                  Fehlt sie → Firmensignatur; ist auch die leer → automatischer Fallback.
//   • 'none'     → KEINE Signatur (auch KEIN automatischer Fallback).
//
// Zwei Ebenen bestimmen, welche Dokument-Signatur greift:
//   1) Firmen-MODUS (company_settings.document_signature_mode, Migr. 0123):
//        • 'force_company'  → Firmensignatur wird für alle erzwungen (Quelle „Ersteller"
//                             wird wie „Firma" behandelt).
//        • 'allow_employee' → Mitarbeiter dürfen eigene Dokument-Signaturen verwenden.
//   2) Bei 'allow_employee' + Quelle „Ersteller": die Mitarbeiter-Signatur gilt NUR,
//      wenn sie beim Mitarbeiter AKTIV (document_signature_active) UND befüllt ist,
//      sonst Firmen-Standardsignatur (symmetrisch zur E-Mail-Signatur-Logik).
//
// BEWUSST getrennt von der E-Mail-Signatur (employees.signature_html). Wird hier NIE
// vermischt. Die PDF-Engine rendert genau EINE Signatur (siehe printDocument.ts).
// ============================================================
import { supabase } from "./supabase";

/** Signaturquelle je Dokument (Spalte `signature_source` auf offers/orders/invoices/sub_orders). */
export type SignatureSource = "company" | "creator" | "none";

/** Firmen-Modus für die Dokument-Signatur (company_settings.document_signature_mode). */
export type DocumentSignatureMode = "force_company" | "allow_employee";

/** Normalisiert einen losen DB-Wert auf eine gültige Signaturquelle (Default 'company'). */
export function normalizeSignatureSource(v: unknown): SignatureSource {
  return v === "creator" || v === "none" ? v : "company";
}

/** Normalisiert den Firmen-Modus (Default 'allow_employee'). */
export function normalizeSignatureMode(v: unknown): DocumentSignatureMode {
  return v === "force_company" ? "force_company" : "allow_employee";
}

export type EmployeeDocSignature = {
  document_signature_html: string | null;
  document_signature_active: boolean | null;
};

/**
 * Effektive Dokument-Signatur eines Mitarbeiters (bei Quelle „Ersteller"): die
 * Mitarbeiter-Signatur greift nur, wenn sie AKTIV (`document_signature_active`) UND
 * befüllt ist, sonst Firmen-Standard. Liefert getrimmtes HTML oder "". Zentral genutzt
 * von der Vorschau in EmployeeDetail und vom Resolver.
 */
export function pickDocumentSignatureHtml(
  employee: EmployeeDocSignature | null | undefined,
  companyDefaultHtml: string | null | undefined,
): string {
  const active = employee?.document_signature_active === true;
  const emp = active ? (employee?.document_signature_html?.trim() || "") : "";
  if (emp) return emp;
  return (companyDefaultHtml ?? "").trim();
}

/** Quelle, die die effektive Dokument-Signatur eines Mitarbeiters bestimmt (für UI-Vorschau). */
export type DocSignatureEffectiveSource =
  | "forced_company"    // Firmenmodus erzwingt Firmensignatur
  | "employee"          // eigene, aktive Mitarbeiter-Signatur
  | "company_fallback"  // Firmen-Standardsignatur (Ersteller leer/inaktiv oder Quelle Firma)
  | "auto";             // nichts hinterlegt → PDF-Engine setzt automatische Firmen-Signatur

export type DocSignaturePreview = { source: DocSignatureEffectiveSource; html: string };

/**
 * Vorschau der effektiv verwendeten Dokument-Signatur eines Mitarbeiters (Quelle „Ersteller"),
 * unter Berücksichtigung des Firmen-Modus. EINE Quelle für die Anzeige in EmployeeDetail.
 */
export function previewEmployeeDocSignature(
  employee: EmployeeDocSignature | null | undefined,
  companyDefaultHtml: string | null | undefined,
  mode: unknown,
): DocSignaturePreview {
  const m = normalizeSignatureMode(mode);
  const company = (companyDefaultHtml ?? "").trim();
  if (m === "force_company") {
    return { source: "forced_company", html: company };
  }
  const active = employee?.document_signature_active === true;
  const emp = active ? (employee?.document_signature_html?.trim() || "") : "";
  if (emp) return { source: "employee", html: emp };
  if (company) return { source: "company_fallback", html: company };
  return { source: "auto", html: "" };
}

/** Lädt die Dokument-Signatur des Erstellers (Verknüpfung created_by = employees.auth_user_id). */
export async function loadCreatorDocSignature(
  createdBy: string | null | undefined,
): Promise<EmployeeDocSignature | null> {
  if (!createdBy) return null;
  const { data } = await supabase
    .from("employees")
    .select("document_signature_html, document_signature_active")
    .eq("auth_user_id", createdBy)
    .limit(1)
    .maybeSingle();
  return (data as EmployeeDocSignature) ?? null;
}

/** Lädt den Anzeigenamen des Erstellers (für UI-Hinweise „Ersteller-Signatur: <Name>"). */
export async function loadCreatorName(
  createdBy: string | null | undefined,
): Promise<string> {
  if (!createdBy) return "";
  const { data } = await supabase
    .from("employees")
    .select("first_name, last_name")
    .eq("auth_user_id", createdBy)
    .limit(1)
    .maybeSingle();
  const e = (data as { first_name?: string | null; last_name?: string | null } | null) ?? null;
  return [e?.first_name, e?.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
}

/**
 * Ergebnis der zentralen Auflösung für die PDF-Engine.
 *  • mode 'none'   → KEINE Signatur (kein Fallback) → signatureBlock liefert "".
 *  • mode 'render' → html ist die zu rendernde Signatur ODER null (= leer → Engine setzt
 *                    automatische Firmen-Signatur als Notnagel).
 */
export type ResolvedSignature = { mode: "render" | "none"; html: string | null };

/**
 * Zentraler Resolver für die PDF-Engine: bestimmt aus `source` (+ ggf. Ersteller über
 * `createdBy`) die effektiv zu rendernde Signatur. Lädt company_settings selbst, sofern
 * nicht übergeben. EINZIGE Stelle der Quellen-Logik – keine Doppellogik in den Editoren.
 */
export async function resolveDocumentSignature(opts: {
  source: SignatureSource | null | undefined;
  createdBy?: string | null;
  /** Optional vorgeladene Firmen-Standardsignatur (spart einen Reload). */
  companyDefaultHtml?: string | null;
  /** Optional vorgeladener Firmen-Modus; sonst wird er zusammen mit dem HTML nachgeladen. */
  companyMode?: unknown;
}): Promise<ResolvedSignature> {
  const source = normalizeSignatureSource(opts.source);
  if (source === "none") return { mode: "none", html: null };

  // Firmen-Standardsignatur + Modus: übergeben oder gemeinsam nachladen.
  let companyHtml = opts.companyDefaultHtml;
  let companyMode = opts.companyMode;
  if (companyHtml === undefined || companyMode === undefined) {
    const { data } = await supabase
      .from("company_settings")
      .select("document_signature_html, document_signature_mode")
      .limit(1)
      .maybeSingle();
    const row = data as { document_signature_html?: string | null; document_signature_mode?: string | null } | null;
    if (companyHtml === undefined) companyHtml = row?.document_signature_html ?? null;
    if (companyMode === undefined) companyMode = row?.document_signature_mode ?? null;
  }
  const company = (companyHtml ?? "").trim();
  const forceCompany = normalizeSignatureMode(companyMode) === "force_company";

  // Firmenmodus erzwingt die Firmensignatur (Quelle „Ersteller" wird wie „Firma" behandelt).
  if (source === "creator" && !forceCompany) {
    const emp = await loadCreatorDocSignature(opts.createdBy);
    // Ersteller-Signatur nur bei aktiv+befüllt; sonst Firmensignatur; sonst Engine-Fallback.
    const empHtml = pickDocumentSignatureHtml(emp, null);
    return { mode: "render", html: empHtml || company || null };
  }

  // source === 'company' oder erzwungen: globale Standard-Signatur; leer → Engine-Fallback.
  return { mode: "render", html: company || null };
}
