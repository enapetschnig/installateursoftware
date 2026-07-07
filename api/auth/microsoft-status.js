// ============================================================
// B4Y SuperAPP – Microsoft OAuth Status
// ------------------------------------------------------------
// GET /api/auth/microsoft-status
//
// Liefert ob der eingeloggte User ein aktives Microsoft-Konto
// verbunden hat. KEINE Tokens im Response.
//
// Response:
//   200 { connected: false }
//   200 { connected: true, microsoft_user_id, expires_at, scopes: [...] }
//   401 wenn kein User-Bearer
//
// Auth: User-JWT im Bearer. RLS erledigt den Rest (User sieht nur
// eigene Row via microsoft_oauth_tokens.msot_org_user_isolation).
// ============================================================

import { bearerFromRequest, verifyUser } from "../_lib/security.js";
import { logSafe } from "../_lib/safe-log.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://xyhgckqxowqnzjtoblfs.supabase.co";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_akH66S1-i4WaHAbVrCd50A_qd7OrwfD";

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Nur GET erlaubt." });
    return;
  }

  const token = bearerFromRequest(req);
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }

  try {
    // User-Token → RLS zeigt nur die eigene Row an. is_active-Filter server-seitig.
    const url =
      `${SUPABASE_URL}/rest/v1/microsoft_oauth_tokens` +
      `?select=microsoft_user_id,microsoft_tenant_id,expires_at,scopes,is_active` +
      `&is_active=eq.true&limit=1`;

    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!r.ok) {
      logSafe({
        userId: user.id,
        action: "ms.oauth.status",
        status: "error",
        error: `http_${r.status}`,
      });
      // Bei Backend-Fehler faellen wir auf connected:false zurueck damit
      // die UI mindestens eine sinnvolle Anzeige hat.
      res.status(200).json({ connected: false, degraded: true });
      return;
    }

    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    logSafe({
      userId: user.id,
      action: "ms.oauth.status",
      status: "ok",
      durationMs: Date.now() - started,
      extra: { connected: !!row },
    });

    if (!row) {
      res.status(200).json({ connected: false });
      return;
    }

    res.status(200).json({
      connected: true,
      microsoft_user_id: row.microsoft_user_id,
      microsoft_tenant_id: row.microsoft_tenant_id,
      expires_at: row.expires_at,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
    });
  } catch (e) {
    logSafe({
      userId: user.id,
      action: "ms.oauth.status",
      status: "error",
      error: e?.message || String(e),
    });
    res.status(500).json({ error: "Status konnte nicht ermittelt werden." });
  }
}
