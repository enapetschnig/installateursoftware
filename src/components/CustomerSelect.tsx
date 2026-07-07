// ============================================================
// B4Y SuperAPP – Durchsuchbare Kundenauswahl (Combobox)
// Zeigt ausschließlich Kontakte mit Rolle „Kunde" (type === "kunde").
// Suche nach Name, Kundennummer, Adresse und E-Mail.
// Eine bereits gespeicherte (evtl. abweichende) Auswahl bleibt sichtbar,
// neu auswählbar sind aber nur Kunden.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, X } from "lucide-react";
import { Contact } from "../lib/types";
import { sortAlphaBy } from "../lib/sortOptions";
import { formatAddressInline } from "../lib/contact-name";

const nameOf = (c: Contact) =>
  c.customer_type === "firma"
    ? (c.company || "Firma")
    : [c.salutation, c.title, c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "Kontakt";

// Kompaktadresse (Straße / Zusatz, PLZ Ort) – zentral, ohne Land.
const addrOf = (c: Contact) => formatAddressInline(c);

export default function CustomerSelect({
  contacts, value, onChange, placeholder = "Kunde suchen …", disabled,
}: {
  contacts: Contact[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Nur Kunden – technisch über die Kontaktrolle, keine Namensprüfung.
  const customers = useMemo(() => sortAlphaBy(contacts.filter((c) => c.type === "kunde"), nameOf), [contacts]);
  // Aktuelle Auswahl aus der vollständigen Liste (bestehende Projekte bleiben intakt).
  const selected = contacts.find((c) => c.id === value) || null;

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = !s ? customers : customers.filter((c) =>
      [nameOf(c), c.contact_number, addrOf(c), c.email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)));
    return base.slice(0, 50);
  }, [customers, q]);

  useEffect(() => {
    if (open) { setActive(0); const t = setTimeout(() => inputRef.current?.focus(), 10); return () => clearTimeout(t); }
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(c: Contact) { onChange(c.id); setOpen(false); setQ(""); }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[active]) pick(results[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="input flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={selected ? "truncate" : "truncate text-slate-400"}>
          {selected ? nameOf(selected) : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selected && !disabled && (
            <X
              size={15}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            />
          )}
          <ChevronDown size={16} className="text-slate-400" />
        </span>
      </button>

      {open && !disabled && (
        <div
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border shadow-lg"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="relative border-b p-2" style={{ borderColor: "var(--border)" }}>
            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              className="input pl-8"
              placeholder={placeholder}
              value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={onKey}
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {results.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-400">Keine Kunden gefunden.</div>
            ) : (
              results.map((c, i) => {
                const sub = [c.contact_number, addrOf(c), c.email].filter(Boolean).join(" · ");
                return (
                  <button
                    type="button"
                    key={c.id}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(c)}
                    className={`block w-full px-3 py-2 text-left transition-colors ${
                      i === active ? "bg-slate-100 dark:bg-white/10" : "hover:bg-slate-50 dark:hover:bg-white/5"
                    }`}
                  >
                    <div className="font-semibold">{nameOf(c)}</div>
                    {sub && <div className="text-xs text-slate-500">{sub}</div>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
