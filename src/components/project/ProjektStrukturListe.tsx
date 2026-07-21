// ============================================================
// Installateur SuperAPP – Projekt-Struktur (Art → Stufen, aufklappbar)
// ------------------------------------------------------------
// EIN Renderer für zwei Orte: die Projekte-Seite (mode="voll") und die
// Dashboard-Kachel (mode="kompakt"). Damit sieht die Struktur überall
// gleich aus – der Anwenderwunsch war ausdrücklich "übergreifend".
//
// Klick auf eine Projektart klappt ihre Stufen auf; Klick auf eine Stufe
// springt in die gefilterte Projektliste.
// ============================================================
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, FolderKanban } from "lucide-react";
import { eur } from "../../lib/format";
import { Empty } from "../ui";
import type { StrukturArt } from "../../lib/projekt-struktur";

const DOT: Record<string, string> = {
  blue: "var(--accent)",
  green: "var(--c-green)",
  amber: "var(--c-amber)",
  red: "var(--c-red)",
  violet: "var(--accent)",
  slate: "rgb(148 163 184)",
};

export default function ProjektStrukturListe({
  struktur, mode = "voll", offenInitial, onStufe, onArt,
}: {
  struktur: StrukturArt[];
  mode?: "voll" | "kompakt";
  /** Diese Projektart beim Öffnen aufgeklappt zeigen (z. B. aus der URL). */
  offenInitial?: string;
  /** Klick auf eine Stufe → gefilterte Liste. */
  onStufe?: (art: string, stufe: string) => void;
  /** Klick auf „Alle" bei einer Art. */
  onArt?: (art: string) => void;
}) {
  const [offen, setOffen] = useState<Set<string>>(
    () => new Set(offenInitial ? [offenInitial] : mode === "voll" && struktur.length <= 2 ? struktur.map((s) => s.art) : []),
  );
  const toggle = (art: string) =>
    setOffen((prev) => {
      const n = new Set(prev);
      n.has(art) ? n.delete(art) : n.add(art);
      return n;
    });

  if (struktur.length === 0) {
    return <Empty title="Keine Projekte" hint="Sobald Projekte angelegt sind, siehst du hier die Verteilung." />;
  }

  return (
    <div className="space-y-2">
      {struktur.map((a) => {
        const auf = offen.has(a.art);
        return (
          <div key={a.art} className="rounded-xl border" style={{ borderColor: "var(--border)" }}>
            {/* Kopf: Projektart */}
            <button
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-[var(--hover)]"
              onClick={() => toggle(a.art)}
              aria-expanded={auf}
            >
              {auf ? <ChevronDown size={16} className="shrink-0 text-slate-400" />
                   : <ChevronRight size={16} className="shrink-0 text-slate-400" />}
              <FolderKanban size={15} className="shrink-0" style={{ color: "var(--accent)" }} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.art}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {a.anzahl} {a.anzahl === 1 ? "Projekt" : "Projekte"}
              </span>
              {mode === "voll" && a.volumen > 0 && (
                <span className="hidden shrink-0 text-xs font-semibold text-[var(--accent)] sm:inline">{eur(a.volumen)}</span>
              )}
            </button>

            {/* Aufgeklappt: Stufen */}
            {auf && (
              <div className="border-t px-2 pb-2 pt-1" style={{ borderColor: "var(--border)" }}>
                <div className={mode === "kompakt" ? "max-h-64 space-y-0.5 overflow-y-auto" : "space-y-0.5"}>
                  {a.stufen.map((s) => {
                    const inhalt = (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[s.color] ?? DOT.slate }} />
                        <span className="min-w-0 flex-1 truncate">{s.label}</span>
                        <span className="shrink-0 font-semibold">{s.anzahl}</span>
                        {mode === "voll" && s.volumen > 0 && (
                          <span className="hidden shrink-0 text-slate-400 sm:inline">{eur(s.volumen)}</span>
                        )}
                      </>
                    );
                    return onStufe ? (
                      <button
                        key={s.label}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-[var(--hover)]"
                        onClick={() => onStufe(a.art, s.label)}
                        title={`${s.label}: Projekte anzeigen`}
                      >
                        {inhalt}
                      </button>
                    ) : (
                      <div key={s.label} className="flex items-center gap-2 px-2 py-2 text-sm">{inhalt}</div>
                    );
                  })}
                </div>
                {onArt && (
                  <button
                    className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--hover)]"
                    onClick={() => onArt(a.art)}
                  >
                    Alle {a.art}-Projekte anzeigen →
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Kompakte Variante für das Dashboard mit Sprung in die gefilterte Projektliste. */
export function ProjektStrukturKachel({ struktur }: { struktur: StrukturArt[] }) {
  const nav = useNavigate();
  return (
    <div className="glass p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-bold">Projekte nach Art &amp; Stufe</h2>
        <Link to="/projekte" className="text-xs font-semibold hover:underline" style={{ color: "var(--accent)" }}>
          Alle anzeigen
        </Link>
      </div>
      <ProjektStrukturListe
        struktur={struktur}
        mode="kompakt"
        onStufe={(art, stufe) =>
          nav(`/projekte?art=${encodeURIComponent(art)}&status=${encodeURIComponent(stufe)}&ansicht=liste`)}
        onArt={(art) => nav(`/projekte?art=${encodeURIComponent(art)}&ansicht=liste`)}
      />
    </div>
  );
}
