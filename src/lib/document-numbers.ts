// ============================================================
// B4Y SuperAPP – Zentrale Nummernvergabe für Belege
// ------------------------------------------------------------
// Regel (Stand 2026-07-06): Entwürfe verbrauchen KEINE Nummer aus dem
// Nummernkreis. Die fachliche Nummer wird erst beim verbindlichen Schritt
// vergeben (Angebot/Nachtrag: Abschließen · Auftrag: Beauftragen/Abschließen
// bzw. direkt-verbindliche Erzeugung · SUB: erster Wechsel aus Entwurf ·
// Rechnung: Finalisierung).
// ensureDocumentNumber ruft die atomare, IDEMPOTENTE RPC
// public.ensure_document_number auf (Migration 0126): hat der Beleg schon
// eine Nummer (Altbestand, Korrekturversion, Re-Finalize), wird KEINE neue
// gezogen – so entstehen keine Lücken und keine Doppelvergaben.
// ============================================================
import { supabase } from "./supabase";

export type NumberKind = "offer" | "order" | "sub_order" | "invoice";

export async function ensureDocumentNumber(
  kind: NumberKind,
  id: string,
): Promise<{ number: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("ensure_document_number", {
    p_kind: kind,
    p_id: id,
  });
  if (error) return { number: null, error: error.message };
  const num = typeof data === "string" && data.trim() ? data : null;
  return { number: num, error: num ? null : "Nummer konnte nicht vergeben werden." };
}
