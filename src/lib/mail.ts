// ============================================================
// Installateur SuperAPP – Smartes KI-Postfach (Frontend-Client)
// ------------------------------------------------------------
// Dünner Wrapper um den serverseitigen E-Mail-Poller:
//   POST /api/mail/poll   – holt ungelesene Mails, KI-Triage, routet
//                           Kundenanfragen → public.anfragen.
//
// Auth: Supabase-Session-Token als Bearer (analog src/lib/anfragen.ts).
// Der Endpoint akzeptiert zusätzlich ein Cron-Secret (Vercel Cron) – das
// ist hier nicht relevant, der manuelle "Jetzt abrufen"-Button nutzt das
// User-JWT.
// ============================================================
import { supabase } from "./supabase";

export interface PollResult {
  ok: boolean;
  reason?: "not_configured" | "no_openai" | "backend" | string;
  message?: string;
  fetched?: number;
  processed?: number;
  markedSeen?: number;
  errors?: number;
  routed?: Partial<Record<
    "kundenanfrage" | "rechnung" | "angebot" | "spam" | "sonstiges",
    number
  >>;
}

/**
 * Löst einen manuellen Postfach-Abruf aus ("Jetzt abrufen").
 * Wirft bei Netzwerk-/Serverfehler; gibt sonst das (ggf. ok:false) Ergebnis
 * zurück, damit die UI z. B. "Postfach nicht verbunden" freundlich anzeigen kann.
 */
export async function pollInbox(): Promise<PollResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Nicht angemeldet");

  const r = await fetch("/api/mail/poll", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) throw new Error("Nicht angemeldet");
  const data = (await r.json().catch(() => ({}))) as PollResult;
  if (!r.ok) {
    throw new Error(data?.message || `Abruf fehlgeschlagen (HTTP ${r.status}).`);
  }
  return data;
}

/** Baut eine kurze, menschenlesbare Zusammenfassung eines Poll-Ergebnisses. */
export function summarizePoll(r: PollResult): string {
  if (!r.ok) {
    if (r.reason === "not_configured") return "Postfach ist noch nicht verbunden.";
    if (r.reason === "no_openai") return "KI ist nicht verbunden.";
    return r.message || "Abruf nicht möglich.";
  }
  const fetched = r.fetched ?? 0;
  if (fetched === 0) return "Keine neuen E-Mails.";
  const ro = r.routed || {};
  const parts: string[] = [];
  if (ro.kundenanfrage) parts.push(`${ro.kundenanfrage} Anfrage${ro.kundenanfrage === 1 ? "" : "n"}`);
  if (ro.rechnung) parts.push(`${ro.rechnung} Rechnung${ro.rechnung === 1 ? "" : "en"}`);
  const rest = (ro.angebot ?? 0) + (ro.spam ?? 0) + (ro.sonstiges ?? 0);
  if (rest) parts.push(`${rest} Sonstige`);
  const detail = parts.length ? ` (${parts.join(", ")})` : "";
  return `${fetched} neue E-Mail${fetched === 1 ? "" : "s"} verarbeitet${detail}.`;
}
