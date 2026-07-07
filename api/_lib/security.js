// ============================================================
// B4Y SuperAPP – Gemeinsame Serverless-Sicherheitshelfer
// ------------------------------------------------------------
// Zentrale, wiederverwendbare Bausteine für alle Vercel-Functions:
//  • verifyUser(token) – validiert das Supabase-JWT (User-Token) gegen
//    /auth/v1/user. Liefert das User-Objekt oder null.
//  • checkRateLimit(userId) – einfaches In-Memory-Pro-User-Limit pro Instanz
//    (Schutz vor Kostenmissbrauch bei OpenAI/PDFShift). Bewusst leichtgewichtig;
//    bei echtem Mehrinstanz-Bedarf später durch Upstash/DB ersetzbar.
//
// Der Ordner `_lib` (Unterstrich) wird von Vercel NICHT als Route behandelt.
// ============================================================

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://pqwcpgmsutpbuvdzslbc.supabase.co";
// anon/publishable Key ist bewusst öffentlich (nur zum Validieren des User-Tokens nötig)
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_SI2t5XGM8ftCbPiav3-HPA_XC26KXtg";

/** Bearer-Token aus dem Request-Header lesen (case-insensitive). */
export function bearerFromRequest(req) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

/** Supabase-User-Token validieren. Liefert User-Objekt oder null. */
export async function verifyUser(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

// ── Pro-User-Rate-Limit (In-Memory, pro Serverless-Instanz) ──
const rateLimitMap = new Map(); // userId -> { count, resetAt }

/**
 * Gibt true zurück, wenn der Aufruf erlaubt ist, false bei Überschreitung.
 * @param {string} userId
 * @param {number} max      max. Aufrufe pro Fenster (Default 20)
 * @param {number} windowMs Fenster in ms (Default 60s)
 */
export function checkRateLimit(userId, max = 20, windowMs = 60_000) {
  if (!userId) return false;
  const now = Date.now();
  let limit = rateLimitMap.get(userId);
  if (!limit || now > limit.resetAt) {
    limit = { count: 0, resetAt: now + windowMs };
  }
  if (limit.count >= max) {
    rateLimitMap.set(userId, limit);
    return false;
  }
  limit.count++;
  rateLimitMap.set(userId, limit);
  return true;
}
