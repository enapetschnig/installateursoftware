// ============================================================
// B4Y SuperAPP – Zentrale, wiederverwendbare Positionsnummern-Auswahl
// EINZIGE intelligente Nummernwahl für Artikel- und Leistungsanlage.
// Zeigt nach Gewerkauswahl die freien/belegten Positionsnummern eines
// Gewerks, schlägt die nächste freie Nummer in Zehnerschritten vor,
// erlaubt Suche, Auswahl freier Nummern und manuelle Eingabe mit
// Dublettenprüfung (Inline-Fehler, kein nativer alert/confirm).
//
// Bewusst datenquellen-agnostisch: Der aufrufende Stamm (ArticleForm /
// NewServiceForm) hat die – via Supabase-Client + RLS bereits
// mandantengefilterten – Datensätze ohnehin im State. Diese werden als
// `occupied`-Liste hereingereicht; es wird KEINE eigene/umgehende Query
// gefahren (keine Parallel-Logik, kein service_role).
//
// Nummern-Schema (zentral aus calc-types abgeleitet, nicht neu erfunden):
//   Volle Nummer = <Gewerknummer 2-stellig>-<Positionsnummer 3-stellig>
//   z.B. 01-010, 01-020, 01-030 …  (gewerkNo + isValidPosition + suggestPosition)
// ============================================================
import { useMemo, useState } from "react";
import { Search, CheckCircle2, Lock, Sparkles } from "lucide-react";
import { isValidPosition, suggestPosition } from "../../lib/calc-types";

/** Eine im aktuellen Gewerk bereits belegte Position (für Anzeige & Dublettenprüfung). */
export type OccupiedPosition = {
  /** Dreistellige Positionsnummer, z.B. "010". */
  pos: string;
  /** Kurzbeschreibung der belegenden Leistung/des Artikels (Name/Kurztext). */
  label: string;
};

export default function PositionNumberPicker({
  gewerkNo,
  value,
  onChange,
  occupied,
  kind,
  disabled,
}: {
  /** Zwei-stellige Gewerknummer des aktuell gewählten Gewerks (oder null, falls keins/ohne Nummer). */
  gewerkNo: string | null;
  /** Aktuelle (dreistellige) Positionsnummer. */
  value: string;
  /** Liefert die neue Positionsnummer (immer 3-stellig erzwungen, max. 999). */
  onChange: (pos: string) => void;
  /** Bereits belegte Positionsnummern dieses Gewerks (mandantengefiltert vom Aufrufer). */
  occupied: OccupiedPosition[];
  /** Quelle: Artikel oder Leistung – nur für Texte/Platzhalter. */
  kind: "article" | "service";
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const noun = kind === "article" ? "Artikel" : "Leistung";

  // Belegte Positionen nach Nummer indexieren (nur gültige 3-stellige Nummern).
  const occMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of occupied) {
      if (o.pos && isValidPosition(o.pos) && !m.has(o.pos)) m.set(o.pos, o.label);
    }
    return m;
  }, [occupied]);

  const occList = useMemo(
    () => [...occMap.entries()].map(([pos, label]) => ({ pos, label })).sort((a, b) => a.pos.localeCompare(b.pos)),
    [occMap]
  );

  // Nächste freie Nummer (Zehnerschritte) – zentrale Engine.
  const suggestion = useMemo(() => suggestPosition([...occMap.keys()]), [occMap]);

  // Vorschlags-Raster: nächste freie 10er-Stufen, plus belegte für Kontext.
  const grid = useMemo(() => {
    const free: string[] = [];
    for (let n = 10; n <= 990 && free.length < 12; n += 10) {
      const p = String(n).padStart(3, "0");
      if (!occMap.has(p)) free.push(p);
    }
    return free;
  }, [occMap]);

  const isTaken = isValidPosition(value) && occMap.has(value);
  const takenLabel = isTaken ? occMap.get(value) : null;

  const q = search.trim().toLowerCase();
  const filteredOcc = q
    ? occList.filter((o) => o.pos.includes(q) || o.label.toLowerCase().includes(q))
    : occList;
  const filteredFree = q ? grid.filter((p) => p.includes(q)) : grid;

  const norm = (raw: string) => raw.replace(/\D/g, "").slice(0, 3);

  if (!gewerkNo) {
    return (
      <p className="rounded-xl border px-3 py-2.5 text-[11px] text-rose-500" style={{ borderColor: "var(--border)" }}>
        Dieses Gewerk hat keine Gewerknummer. Bitte zuerst beim Gewerk eine Nummer hinterlegen.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Manuelle Eingabe + Vorschlag */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-xl border px-3 py-2.5 font-mono text-sm"
          style={{ background: "var(--hover)", borderColor: "var(--border)" }}
        >
          {gewerkNo}-
        </span>
        <input
          className="input max-w-[7rem] font-mono"
          inputMode="numeric"
          value={value}
          placeholder="010"
          disabled={disabled}
          aria-invalid={isTaken}
          onChange={(e) => onChange(norm(e.target.value))}
        />
        <span className="text-sm text-slate-400">
          ergibt{" "}
          <b className="font-mono" style={{ color: "var(--accent)" }}>
            {gewerkNo}-{isValidPosition(value) ? value : "???"}
          </b>
        </span>
        {value !== suggestion && (
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={disabled}
            onClick={() => onChange(suggestion)}
            title={`Nächste freie Nummer ${gewerkNo}-${suggestion} übernehmen`}
          >
            <Sparkles size={14} /> Vorschlag {suggestion}
          </button>
        )}
      </div>

      {/* Inline-Fehler / Hinweise (kein nativer alert) */}
      {isTaken ? (
        <p className="flex items-center gap-1.5 text-[12px] text-rose-500">
          <Lock size={13} /> Nummer {gewerkNo}-{value} ist bereits vergeben
          {takenLabel ? <span className="text-rose-400">· {takenLabel}</span> : null}
        </p>
      ) : !isValidPosition(value) ? (
        <p className="text-[11px] text-slate-400">Die Positionsnummer muss dreistellig sein (001–999).</p>
      ) : (
        <p className="flex items-center gap-1.5 text-[12px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={13} /> Nummer {gewerkNo}-{value} ist frei.
        </p>
      )}

      {/* Suche im Picker – eigene Enter-Bedeutung (kein Modal-Submit beim Suchen) */}
      <div className="relative" data-no-enter-submit>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9 text-sm"
          placeholder="Nummer oder Bezeichnung suchen …"
          value={search}
          disabled={disabled}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Freie Nummern – auswählbar */}
      {filteredFree.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Freie Nummern
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filteredFree.map((p) => (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => onChange(p)}
                className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs transition ${
                  value === p ? "text-white" : ""
                }`}
                style={
                  value === p
                    ? { background: "var(--accent)", borderColor: "var(--accent)" }
                    : { borderColor: "var(--border)", background: "var(--card)" }
                }
              >
                {gewerkNo}-{p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Belegte Nummern – Kontext (nicht auswählbar) */}
      {filteredOcc.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Belegt ({occList.length})
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {filteredOcc.map((o) => (
              <div
                key={o.pos}
                className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                style={{ borderColor: "var(--border)", background: "var(--hover)" }}
              >
                <Lock size={12} className="shrink-0 text-slate-400" />
                <span className="font-mono">{gewerkNo}-{o.pos}</span>
                <span className="truncate text-slate-500 dark:text-slate-400" title={o.label}>
                  belegt: {o.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredFree.length === 0 && filteredOcc.length === 0 && (
        <p className="text-[11px] text-slate-400">
          Keine {q ? "passenden " : ""}Nummern. Noch keine {noun} in diesem Gewerk angelegt – {gewerkNo}-{suggestion} ist frei.
        </p>
      )}
    </div>
  );
}
