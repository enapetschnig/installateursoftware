// ============================================================
// B4Y SuperAPP - useMicrosoftMail Hooks
// ------------------------------------------------------------
// Zwei Daten-Hooks fuer die Microsoft-365-Mail-Integration:
//   - useMailList: Inbox-/Ordner-Liste mit Suche + Auto-Refresh + LoadMore.
//   - useMailDetail: Einzelnachricht (Body + Anhang-Metadaten).
//
// Kein React-Query im Projekt (siehe package.json) - beide Hooks sind
// bewusst schlanke useState + useEffect Kombinationen, damit sie sich
// nahtlos in das bestehende useAsync-Muster einfuegen.
//
// Typen kommen aus src/lib/microsoft/mailClient.ts (Phase 2, parallel).
// Der API-Client dort exponiert:
//   fetchMailList({folder, search, top, nextLink?, signal}) -> MailListResult
//   fetchMailDetail(id, {signal}) -> MailDetail
//
// Auth: der mailClient legt Bearer-Header analog anfragen.ts selber an.
// Fehlermeldungen sind Error.message, 401 wird als "Nicht angemeldet"
// signalisiert - wir setzen dann lediglich error (MVP, kein globaler
// connected-Event-Bus).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchMailList,
  fetchMailDetail,
  type MailListItem,
  type MailListResult,
  type MailDetail,
} from "../lib/microsoft/mailClient";

// ── Konstanten ────────────────────────────────────────────────
const DEBOUNCE_MS = 300;
const AUTO_REFRESH_MS = 60_000;
const DEFAULT_FOLDER = "inbox";

// ── useMailList ───────────────────────────────────────────────

export interface UseMailListOpts {
  folder?: string;
  search?: string;
  enabled?: boolean;
}

export interface UseMailListResult {
  messages: MailListItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
}

/**
 * Laedt die Nachrichtenliste eines Ordners.
 *
 * Verhalten:
 *   - search wird 300ms debounced, damit Tipp-Bursts nicht jedes
 *     Zeichen ein Graph-Request ausloesen.
 *   - Auto-Refresh alle 60s (nur wenn kein loadMore/nextLink-Fetch laeuft),
 *     ersetzt die aktuelle Liste durch die frischen Ergebnisse.
 *   - refresh() forciert einen Reload jetzt.
 *   - loadMore() fordert die naechste Seite via nextLink an und haengt
 *     die Nachrichten unten dran (Deduplizierung ueber id).
 *   - enabled=false pausiert alle Fetches (z.B. wenn Microsoft-Konto
 *     nicht verbunden ist).
 */
export function useMailList(opts: UseMailListOpts = {}): UseMailListResult {
  const { folder = DEFAULT_FOLDER, search = "", enabled = true } = opts;

  const [messages, setMessages] = useState<MailListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [nextLink, setNextLink] = useState<string | null>(null);

  // Debounced search - separater State, damit Fetches nicht bei jedem
  // Tastendruck neu ausgeloest werden.
  const [debouncedSearch, setDebouncedSearch] = useState<string>(search);

  // Wir zaehlen "Fetch-Generationen": jeder frische Reload und jedes
  // refresh() erhoeht den Counter. Late-arriving Antworten aus alten
  // Generationen werden dann verworfen (Race-Guard).
  const generationRef = useRef<number>(0);

  // Merker, ob gerade eine loadMore-Anfrage laeuft - Auto-Refresh
  // pausiert waehrenddessen, damit die Liste nicht unter dem Nutzer
  // wegspringt.
  const loadingMoreRef = useRef<boolean>(false);

  // ── Debounce fuer search ─────────────────────────────────
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  // ── Kern-Fetch (initial + refresh + folder/search-change) ─
  const doFetch = useCallback(
    async (abortSignal: AbortSignal, gen: number) => {
      setLoading(true);
      setError(null);
      try {
        const res: MailListResult = await fetchMailList({
          folder,
          search: debouncedSearch,
          signal: abortSignal,
        });
        if (abortSignal.aborted) return;
        if (gen !== generationRef.current) return;
        setMessages(res.messages);
        setNextLink(res.nextLink);
      } catch (e) {
        if (abortSignal.aborted) return;
        if (gen !== generationRef.current) return;
        const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
        setError(msg);
      } finally {
        if (gen === generationRef.current) setLoading(false);
      }
    },
    [folder, debouncedSearch],
  );

  // ── Trigger: enabled/folder/debouncedSearch change ────────
  useEffect(() => {
    if (!enabled) {
      // Deaktiviert: Zustand zuruecksetzen, damit Konsumenten leere
      // Liste sehen und nichts Stale angezeigt wird.
      setMessages([]);
      setNextLink(null);
      setError(null);
      setLoading(false);
      return;
    }
    generationRef.current += 1;
    const gen = generationRef.current;
    const ac = new AbortController();
    void doFetch(ac.signal, gen);
    return () => {
      ac.abort();
    };
  }, [enabled, folder, debouncedSearch, doFetch]);

  // ── Auto-Refresh alle 60s ─────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => {
      if (loadingMoreRef.current) return; // nicht mitten in loadMore
      generationRef.current += 1;
      const gen = generationRef.current;
      const ac = new AbortController();
      void doFetch(ac.signal, gen);
      // Wir cleanen den Controller nicht explizit - der naechste
      // Trigger via doFetch bricht per generationRef ab, und pending
      // Requests haben typischerweise <15s Lebenszeit (Vercel-Timeout).
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [enabled, doFetch]);

  // ── refresh() ─────────────────────────────────────────────
  const refresh = useCallback(() => {
    if (!enabled) return;
    generationRef.current += 1;
    const gen = generationRef.current;
    const ac = new AbortController();
    void doFetch(ac.signal, gen);
  }, [enabled, doFetch]);

  // ── loadMore() ────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!enabled) return;
    if (!nextLink) return;
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoading(true);
    const gen = generationRef.current;
    try {
      const res: MailListResult = await fetchMailList({
        folder,
        search: debouncedSearch,
        nextLink,
      });
      // Wenn zwischenzeitlich refresh/folder-change lief, verwerfen -
      // die neuen Seiten wuerden sonst zur alten Liste passen.
      if (gen !== generationRef.current) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const additions = res.messages.filter((m) => m.id && !seen.has(m.id));
        return [...prev, ...additions];
      });
      setNextLink(res.nextLink);
    } catch (e) {
      if (gen !== generationRef.current) return;
      const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
      setError(msg);
    } finally {
      loadingMoreRef.current = false;
      if (gen === generationRef.current) setLoading(false);
    }
  }, [enabled, folder, debouncedSearch, nextLink]);

  return {
    messages,
    loading,
    error,
    refresh,
    loadMore,
    hasMore: !!nextLink,
  };
}

// ── useMailDetail ─────────────────────────────────────────────

export interface UseMailDetailResult {
  mail: MailDetail | null;
  loading: boolean;
  error: string | null;
}

/**
 * Laedt eine einzelne Mail bei id-Wechsel.
 * id=null -> Reset auf leeren Zustand (kein Fetch).
 * Alte Antworten werden per AbortController verworfen, damit ein
 * schneller id-Wechsel nicht in einer alten Nachricht endet.
 */
export function useMailDetail(id: string | null): UseMailDetailResult {
  const [mail, setMail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setMail(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    // Wir behalten die vorige Mail nicht - waehrend Loading zeigt die
    // UI ein Skeleton, und ein stale-Zustand waere hier verwirrend.
    setMail(null);

    (async () => {
      try {
        const res = await fetchMailDetail(id, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setMail(res);
      } catch (e) {
        if (ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
        setError(msg);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [id]);

  return { mail, loading, error };
}
