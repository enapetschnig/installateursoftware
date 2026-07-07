// ============================================================
// B4Y SuperAPP – Globale Suche (UI)
// ============================================================
// Eingabe + Dropdown-Panel mit gruppierten, relevanzsortierten Treffern.
// - Debounce, Mindestlänge, Abbruch veralteter Abfragen
// - Tastatur-Navigation (↑/↓/Enter/Esc), Klick-außerhalb schließt
// - Loading / Leer / Keine-Treffer-Zustände
// - Theme-Tokens (Hell/Dunkel/Augenschon), responsiv (Desktop-Bar + Mobile-Sheet)
// Sicherheit/Mandant/Rechte werden zentral in lib/search.ts + RLS erzwungen.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, X, Loader2, FolderKanban, Users, Truck, HardHat, Contact as ContactIcon,
  FileText, ClipboardList, Receipt, UsersRound, Wrench, Package, Layers, Ruler,
} from "lucide-react";
import { usePermissions } from "../lib/permissions";
import {
  runGlobalSearch, totalResults, type SearchGroupResult, type SearchResult,
} from "../lib/search";

const GROUP_ICON: Record<string, typeof Search> = {
  Projekte: FolderKanban, Kunden: Users, Lieferanten: Truck, Subunternehmer: HardHat,
  Ansprechpartner: ContactIcon, Angebote: FileText, Aufträge: ClipboardList,
  Rechnungen: Receipt, Dokumente: FileText, Mitarbeiter: UsersRound,
  Leistungen: Wrench, Artikel: Package, Gewerke: Layers, Einheiten: Ruler, Kontakte: Users,
};

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

export default function GlobalSearch({
  autoFocus = false,
  onNavigate,
}: {
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const { can, isAdmin } = usePermissions();
  const nav = useNavigate();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<SearchGroupResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  // Flache Liste aller Treffer (für Tastatur-Navigation).
  const flat = useMemo<SearchResult[]>(() => groups.flatMap((g) => g.results), [groups]);
  const total = totalResults(groups);
  const trimmed = query.trim();

  // ----- Debounced Suche -----
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setGroups([]);
      setLoading(false);
      reqId.current++; // laufende Anfrage verwerfen
      return;
    }
    setLoading(true);
    const myId = ++reqId.current;
    const handle = setTimeout(async () => {
      try {
        const res = await runGlobalSearch(trimmed, { isAdmin, can });
        if (myId !== reqId.current) return; // veraltete Antwort verwerfen
        setGroups(res);
        setActiveIdx(0);
      } catch {
        if (myId === reqId.current) setGroups([]);
      } finally {
        if (myId === reqId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed, isAdmin, can]);

  // ----- Klick außerhalb schließt -----
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const go = (r: SearchResult) => {
    setOpen(false);
    setQuery("");
    setGroups([]);
    onNavigate?.();
    nav(r.route);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else setOpen(false);
      return;
    }
    if (!open || !flat.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = flat[activeIdx];
      if (r) go(r);
    }
  };

  const showPanel = open && trimmed.length >= MIN_CHARS;
  let runningIdx = -1; // globaler Index über alle Gruppen für Highlight

  return (
    <div ref={wrapRef} className="relative w-full">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showPanel}
        aria-autocomplete="list"
        className="w-full rounded-xl border border-transparent bg-slate-100/70 py-2 pl-9 pr-9 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
        placeholder="Suchen … (Projekte, Kontakte, Angebote, Artikel …)"
      />
      {query && (
        <button
          type="button"
          onClick={() => { setQuery(""); inputRef.current?.focus(); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10"
          aria-label="Suche leeren"
        >
          <X size={14} />
        </button>
      )}

      {showPanel && (
        <div
          className="glass absolute left-0 right-0 z-50 mt-2 max-h-[70vh] overflow-y-auto p-1.5 shadow-xl"
          style={{ borderColor: "var(--border)" }}
        >
          {loading && (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Suche läuft …
            </div>
          )}

          {!loading && total === 0 && (
            <div className="px-3 py-5 text-center">
              <div className="text-sm font-medium">Keine Ergebnisse gefunden.</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Bitte Suchbegriff prüfen oder anderen Begriff verwenden.
              </div>
            </div>
          )}

          {!loading && total > 0 && (
            <div className="space-y-1">
              {groups.map((g) => {
                const I = GROUP_ICON[g.group] ?? Search;
                return (
                  <div key={g.group}>
                    <div
                      className="sticky top-0 z-10 flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--text2)", background: "var(--card)" }}
                    >
                      <I size={12} /> {g.group}
                      <span className="font-normal opacity-60">· {g.results.length}</span>
                    </div>
                    {g.results.map((r) => {
                      runningIdx++;
                      const active = runningIdx === activeIdx;
                      const idx = runningIdx;
                      return (
                        <button
                          key={`${r.type}-${r.id}`}
                          type="button"
                          onMouseEnter={() => setActiveIdx(idx)}
                          onClick={() => go(r)}
                          className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition"
                          style={active ? { background: "color-mix(in srgb, var(--accent) 14%, transparent)" } : undefined}
                        >
                          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 dark:text-slate-300" style={{ background: "var(--hover)" }}>
                            <I size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{r.title}</span>
                              {r.status && (
                                <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--hover)", color: "var(--text2)" }}>
                                  {r.status}
                                </span>
                              )}
                            </span>
                            {r.subtitle && (
                              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{r.subtitle}</span>
                            )}
                          </span>
                          {(r.amount || r.date) && (
                            <span className="ml-2 shrink-0 text-right text-[11px] text-slate-400">
                              {r.amount && <span className="block font-medium text-slate-500 dark:text-slate-300">{r.amount}</span>}
                              {r.date && <span className="block">{r.date}</span>}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
