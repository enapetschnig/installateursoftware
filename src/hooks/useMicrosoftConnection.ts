// ============================================================
// B4Y SuperAPP – useMicrosoftConnection
// ------------------------------------------------------------
// React-Hook, der den aktuellen Microsoft-OAuth-Status des einge-
// loggten Users bereitstellt und Aktionen zum Verbinden/Trennen
// bietet.
//
// Backend-Endpunkte (bereits deployed, siehe api/auth/*):
//   GET  /api/auth/microsoft-link      → 302 → Microsoft OAuth
//   GET  /api/auth/microsoft-status    → { connected, ... }
//   POST /api/auth/microsoft-unlink    → { ok: true }
//
// Auth-Muster: Supabase-Bearer aus supabase.auth.getSession() im
// Authorization-Header. `microsoft-link` erwartet das Token als
// Query-Param `?access_token=...`, weil es sich um ein Top-Level-
// Navigate handelt (kein fetch).
//
// Post-Callback: Nach Rueckkehr vom OAuth-Redirect haengt der
// Callback-Endpoint `?connected=ok` bzw. `?connected=fail` (+
// optional `reason=`) an die Redirect-URL. Der Hook beobachtet das
// beim Mount und triggert automatisch ein `refresh()`, danach wird
// der Query-Param via history.replaceState entfernt, damit ein
// erneutes Reload nicht noch einmal refresht.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// ── Public-Typen ───────────────────────────────────────────────
export interface MicrosoftConnectionStatus {
  loading: boolean;
  connected: boolean;
  microsoft_user_id?: string;
  microsoft_tenant_id?: string;
  expires_at?: string;
  scopes?: string[];
  /** true, wenn Backend den Status nicht sauber ermitteln konnte
   *  (Fallback auf `connected:false`). UI sollte einen Hinweis
   *  anzeigen statt "nicht verbunden" definitiv zu behaupten. */
  degraded?: boolean;
  error?: string;
  refresh: () => Promise<void>;
  /** Startet den OAuth-Flow: window.location Redirect zu
   *  /api/auth/microsoft-link?access_token=<supabase-jwt>. Kein
   *  Promise – der Browser navigiert vor dem Ende der Funktion weg. */
  startConnect: () => void;
  disconnect: () => Promise<void>;
}

// ── Interne Response-Typen (Backend-Schema) ────────────────────
interface StatusResponse {
  connected: boolean;
  microsoft_user_id?: string;
  microsoft_tenant_id?: string;
  expires_at?: string;
  scopes?: string[];
  degraded?: boolean;
  error?: string;
}

// ── Auth-Helfer (analog src/lib/anfragen.ts) ───────────────────
async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Nicht angemeldet");
  return token;
}

// ── Hook ───────────────────────────────────────────────────────
export function useMicrosoftConnection(): MicrosoftConnectionStatus {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [microsoftUserId, setMicrosoftUserId] = useState<string | undefined>(undefined);
  const [microsoftTenantId, setMicrosoftTenantId] = useState<string | undefined>(undefined);
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  const [scopes, setScopes] = useState<string[] | undefined>(undefined);
  const [degraded, setDegraded] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  // Verhindert setState nach Unmount, wenn ein noch laufender Fetch
  // spaeter zurueckkommt.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // ── refresh: Status vom Backend nachziehen ───────────────────
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const token = await getAccessToken();
      const r = await fetch("/api/auth/microsoft-status", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) throw new Error("Nicht angemeldet");
      const body = (await r.json().catch(() => ({}))) as StatusResponse & { error?: string };
      if (!r.ok) {
        throw new Error(body?.error || `HTTP ${r.status}`);
      }
      if (!activeRef.current) return;
      setConnected(!!body.connected);
      setMicrosoftUserId(body.microsoft_user_id);
      setMicrosoftTenantId(body.microsoft_tenant_id);
      setExpiresAt(body.expires_at);
      setScopes(Array.isArray(body.scopes) ? body.scopes : undefined);
      setDegraded(body.degraded);
    } catch (e) {
      if (!activeRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Bei Fehler NICHT `connected` toggeln – Zustand vor dem
      // Fehler beibehalten, damit die UI nicht flackert.
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, []);

  // ── Initial-Load + Callback-Auto-Refresh ─────────────────────
  useEffect(() => {
    // Erst-Aufruf
    void refresh();

    // Auf ?connected=ok|fail aus dem Callback reagieren.
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("connected");
    if (flag === "ok" || flag === "fail") {
      // `refresh()` haben wir gerade schon getriggert – zweiter
      // Aufruf ist harmlos (idempotent) und stellt sicher, dass
      // der Status nach dem Redirect final aktuell ist.
      void refresh();

      // Query-Param(s) entfernen, damit ein Reload keinen zweiten
      // "Verbindung erfolgreich"-Toast triggern kann. `reason` wird
      // vom Callback bei Fehlern zusaetzlich gesetzt.
      params.delete("connected");
      params.delete("reason");
      const qs = params.toString();
      const url =
        window.location.pathname +
        (qs ? `?${qs}` : "") +
        window.location.hash;
      window.history.replaceState(null, "", url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── startConnect: POST /api/auth/microsoft-link mit Bearer, dann
  //    window.location.href = {target}.
  //
  //  Warum POST + Fetch statt GET mit ?access_token=…:
  //   1) JWT landet NICHT in der URL → nicht in Vercel-Access-Logs, nicht in
  //      Browser-History, nicht in Referrer-Header.
  //   2) Bestimmte Browser / Corporate-Proxies / Ad-Blocker filtern lange
  //      Query-Params ODER die URL komplett — User bekam vorher einen
  //      "leeren Bildschirm" statt Redirect. POST mit JSON-Antwort ist robust.
  //   3) Backend setzt beim POST-Response das HttpOnly-Cookie ganz normal
  //      (same-origin Set-Cookie); der spaetere Callback bekommt es zurueck
  //      weil SameSite=Lax auch bei Top-Level-Navigation greift.
  const startConnect = useCallback((): void => {
    void (async () => {
      try {
        const token = await getAccessToken();
        const r = await fetch("/api/auth/microsoft-link", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
          // credentials same-origin ist default — Cookie wird trotzdem gesetzt.
        });
        if (r.status === 401) throw new Error("Nicht angemeldet");
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(
            `Microsoft-Anbindung nicht bereit (HTTP ${r.status}). ${t.slice(0, 200)}`,
          );
        }
        const j = (await r.json()) as { target?: string };
        if (!j.target || typeof j.target !== "string") {
          throw new Error("Ungueltige Antwort vom Server.");
        }
        // Top-Level-Navigation zu Microsoft. Der Browser sendet beim Callback
        // das Set-Cookie zurueck (SameSite=Lax erlaubt Top-Level-Cookies).
        window.location.href = j.target;
      } catch (e) {
        if (!activeRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    })();
  }, []);

  // ── disconnect: Token-Row deaktivieren + Status neu laden ────
  const disconnect = useCallback(async (): Promise<void> => {
    setError(undefined);
    try {
      const token = await getAccessToken();
      const r = await fetch("/api/auth/microsoft-unlink", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) throw new Error("Nicht angemeldet");
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body?.error || `HTTP ${r.status}`);
      }
      await refresh();
    } catch (e) {
      if (!activeRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Kein throw – Caller (UI) liest `error` aus dem Hook-State.
    }
  }, [refresh]);

  return {
    loading,
    connected,
    microsoft_user_id: microsoftUserId,
    microsoft_tenant_id: microsoftTenantId,
    expires_at: expiresAt,
    scopes,
    degraded,
    error,
    refresh,
    startConnect,
    disconnect,
  };
}
