// ============================================================
// B4Y SuperAPP – Suchbare Artikel-Auswahl (Combobox mit Popover)
// ------------------------------------------------------------
// Ersetzt das einfache <select> bei „Material aus Artikelstamm":
// bei vielen Artikeln wird über Artikelnummer, Name, Beschreibung,
// Gewerk, Kategorie, Einheit und Lieferant gesucht. Treffer zeigen
// Nr., Name, Gewerk, Einheit, EK/VK netto und Status.
//
// Bedienung: Klick/Enter öffnet, Suchfeld ist fokussiert, ↑/↓ und
// Enter wählen, ESC schließt. Das Popover bleibt bewusst offen, bis
// im App-Bereich außerhalb geklickt oder ESC gedrückt wird (kein
// Schließen bei Fenster-/Fokuswechsel → screenshot-freundlich).
// Performance: Anzeige auf MAX_RESULTS begrenzt (Suche verfeinern).
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Article, Trade } from "../../lib/calc-types";
import { eur } from "../../lib/format";
import { Badge } from "../ui";

const MAX_RESULTS = 50;

export default function ArticleSearchSelect({
  articles, trades = [], value, onSelect, placeholder = "– frei –",
}: {
  articles: Article[];
  trades?: Trade[];
  /** aktuell verknüpfte Artikel-ID (oder null/"" = frei) */
  value: string | null | undefined;
  /** "" = Verknüpfung lösen („frei"), sonst Artikel-ID */
  onSelect: (articleId: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const tradeName = (id: string | null) => trades.find((t) => t.id === id)?.name ?? "";
  const selected = value ? articles.find((a) => a.id === value) ?? null : null;

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return articles;
    return articles.filter((a) =>
      [a.article_number, a.name, a.description, a.category, a.unit, a.supplier, tradeName(a.trade_id)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
    // tradeName ist von trades abgeleitet (stabil je Render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles, q, trades]);
  const shown = hits.slice(0, MAX_RESULTS);
  // Einträge inkl. „frei"-Option (null) für einheitliche Tastatur-Navigation
  const items: (Article | null)[] = [null, ...shown];

  // Schließen nur bei Klick außerhalb (im App-Fenster) oder ESC –
  // NICHT bei Fensterwechsel/Blur, damit offene Menüs screenshotbar bleiben.
  // Der Topbar-Screenshot-Button (data-screenshot-trigger) zählt bewusst
  // nicht als „außerhalb": das Menü bleibt für die Aufnahme offen.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("[data-screenshot-trigger]")) return;
      if (rootRef.current && !rootRef.current.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) { setQ(""); setHi(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  function choose(item: Article | null) {
    onSelect(item?.id ?? "");
    setOpen(false);
  }

  function scrollTo(idx: number) {
    const el = listRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => { const n = Math.min(h + 1, items.length - 1); scrollTo(n); return n; }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => { const n = Math.max(h - 1, 0); scrollTo(n); return n; }); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[Math.min(hi, items.length - 1)] ?? null); }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="input flex w-full items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`truncate ${selected ? "" : "text-slate-400"}`}>
          {selected
            ? `${selected.article_number ? `${selected.article_number} · ` : ""}${selected.name}`
            : placeholder}
        </span>
        <ChevronDown size={15} className="shrink-0 opacity-60" />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 min-w-[320px] overflow-hidden rounded-xl border shadow-xl"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="border-b p-2" style={{ borderColor: "var(--border)" }}>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                className="input py-1.5 pl-8 text-sm"
                placeholder="Suche: Nr., Name, Gewerk, Kategorie, Einheit, Lieferant …"
                value={q}
                onChange={(e) => { setQ(e.target.value); setHi(1); }}
                onKeyDown={onInputKey}
                role="combobox"
                aria-expanded={open}
                aria-controls="article-search-list"
              />
            </div>
          </div>
          <div ref={listRef} id="article-search-list" role="listbox" className="max-h-[320px] overflow-auto p-1">
            {items.map((a, idx) => a === null ? (
              <button
                key="__free__"
                type="button"
                role="option"
                aria-selected={!selected}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-400 hover:bg-[var(--hover)]"
                style={idx === hi ? { background: "var(--hover)" } : undefined}
                onMouseEnter={() => setHi(idx)}
                onClick={() => choose(null)}
              >
                {placeholder} (keine Verknüpfung)
              </button>
            ) : (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={a.id === value}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--hover)]"
                style={idx === hi ? { background: "var(--hover)" } : undefined}
                onMouseEnter={() => setHi(idx)}
                onClick={() => choose(a)}
              >
                <div className="flex items-center gap-2 text-sm">
                  {a.article_number && <span className="shrink-0 font-mono text-xs text-slate-400">{a.article_number}</span>}
                  <span className="truncate font-medium">{a.name}</span>
                  {!a.active && <Badge tone="slate">inaktiv</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                  {tradeName(a.trade_id) && <span>{tradeName(a.trade_id)}</span>}
                  {a.unit && <span>{a.unit}</span>}
                  <span>EK {eur(a.purchase_price)}</span>
                  <span>VK {eur(a.sale_price)}</span>
                </div>
              </button>
            ))}
            {shown.length === 0 && (
              <div className="px-2.5 py-3 text-center text-sm text-slate-400">Keine Artikel gefunden.</div>
            )}
            {hits.length > MAX_RESULTS && (
              <div className="px-2.5 py-2 text-center text-[11px] text-slate-400">
                {hits.length - MAX_RESULTS} weitere Treffer – Suche verfeinern.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
