// ============================================================
// B4Y SuperAPP – Microsoft OAuth Unlink
// ------------------------------------------------------------
// POST /api/auth/microsoft-unlink
//
// Trennt das Microsoft-Konto des eingeloggten Users:
//   * setzt is_active=false + loescht die verschluesselten Tokens
//     (Access + Refresh) aus der Row → auch bei DB-Kompromittierung
//     kein Missbrauch mehr moeglich.
//   * kein Widerruf gegen Azure/Graph noetig (die verlassen sich
//     ohnehin auf ihre Token-Lifetimes); optional koennten wir
//     `POST /consumers/oauth2/v2.0/logout` machen, tun es aber nicht
//     (Silent-Reconnect fuer denselben User bleibt so einfacher).
//
// Auth: User-Bearer. RLS erlaubt UPDATE nur auf die eigene Row.
// ============================================================

import { bearerFromRequest, verifyUser } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_SI2t5XGM8ftCbPiav3-HPA_XC26KXtg";

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Nur POST erlaubt." });
    return;
  }

  const token = bearerFromRequest(req);
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }

  try {
    // Wir nutzen User-Token (RLS) — der User darf nur seine eigene Row
    // updaten. Tokens werden auf leer/NULL gesetzt + is_active=false.
    // Update per user_id-Filter geht sowohl fuer 0 als auch 1 Row.
    // access_token_enc ist NOT NULL — wir setzen einen sichtbaren
    // Marker-String statt Klartext-NULL, damit RLS+Constraint zufrieden
    // bleiben und man in der DB auf einen Blick sieht dass die Row inaktiv ist.
    const url = `${SUPABASE_URL}/rest/v1/microsoft_oauth_tokens?user_id=eq.${user.id}`;
    const r = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        is_active: false,
        access_token_enc: "REVOKED",
        refresh_token_enc: null,
        last_error_message: "Manuell getrennt vom User",
      }),
    });

    if (!r.ok) {
      const t = (await r.text().catch(() => "")).slice(0, 200);
      logSafe({
        userId: user.id,
        action: "ms.oauth.unlink",
        status: "error",
        error: `http_${r.status}: ${t}`,
      });
      res.status(502).json({ error: "Trennen fehlgeschlagen." });
      return;
    }

    logSafe({
      userId: user.id,
      action: "ms.oauth.unlink",
      status: "ok",
      durationMs: Date.now() - started,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.oauth.unlink",
      status: "error",
      error: e?.message || String(e),
    });
    res.status(500).json({ error: "Trennen fehlgeschlagen." });
  }
}
