// ============================================================
// B4Y SuperAPP – Adress-Eingabe mit Autovervollständigung (wiederverwendbar)
// ------------------------------------------------------------
// Eingabefeld für die Straße/Hausnummer; ab 3 Zeichen werden (debounced) Adress-
// vorschläge gezeigt. Bei Auswahl wird onSelect mit der vollständigen Adresse aufgerufen
// (Straße, PLZ, Ort, Land) – der Aufrufer füllt damit seine Felder.
// Verwendet zentral src/lib/address-lookup.ts. Einsetzbar in Kontakten, Projekten,
// Mitarbeitern, Firmeneinstellungen.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { searchAddress, AddressSuggestion } from "../lib/address-lookup";

export default function AddressAutocomplete({
  value, onChange, onSelect, placeholder, disabled, list, zip, city,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: AddressSuggestion) => void;
  placeholder?: string;
  disabled?: boolean;
  list?: string; // optionales <datalist>-id (bestehende Vorschläge bleiben nutzbar)
  // Optionaler PLZ/Ort-Kontext aus demselben Formular → besseres Treffer-Ranking.
  zip?: string | null;
  city?: string | null;
}) {
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function handleChange(v: string) {
    onChange(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) { setItems([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      const res = await searchAddress(v, { zip, city });
      setItems(res);
      setActive(0);
      setOpen(res.length > 0);
      setLoading(false);
    }, 350);
  }

  function pick(s: AddressSuggestion) {
    onSelect(s);
    setOpen(false);
    setItems([]);
  }

  // Tastaturbedienung der Vorschläge: ↑/↓ navigieren, Enter übernimmt den
  // markierten Vorschlag (preventDefault → löst KEINE Modal-Primäraktion aus),
  // ESC schließt. Bei geschlossenem Popup bleibt Enter unangetastet, damit das
  // zentrale Enter-Muster (Modal-Primäraktion) normal greift.
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[active]) pick(items[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="input"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        list={list}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-autocomplete="list"
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => { if (items.length) setOpen(true); }}
      />
      {loading && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">…</span>}
      {open && items.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border py-1 shadow-lg"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          {items.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)]"
                style={i === active ? { background: "var(--hover)" } : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}>
                <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                <span>{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
