// ============================================================
// Installateur SuperAPP – Leitstand-Sektion der Startseite
// ------------------------------------------------------------
// Ersetzt die frühere separate Seite /cockpit. Es gibt nur noch EINE
// Startseite: die persönliche Übersicht. Administratoren sehen darunter
// zusätzlich diesen Leitstand-Block mit der Firmensicht.
//
// Bewusst übernommen wurden ausschließlich die Blöcke, die es auf der
// Übersicht NICHT schon gab:
//   • Offene Forderungen (mit Beträgen, nicht nur Anzahl)
//   • Angebots-Pipeline (Entwurf → Angenommen, je Anzahl + Summe)
//   • Mitarbeiter-Einteilung heute (inkl. „ohne Zuordnung“ und Abwesenheiten)
// Weggefallen sind die Doppelungen (KPIs, Anfragen, Schnellaktionen) und
// der Platzhalter „KI-Telefonagent“.
// ============================================================
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Gauge, TrendingUp, Receipt, UsersRound, CalendarClock, MapPin, ArrowRight, AlertTriangle,
} from "lucide-react";
import { Badge, type Tone } from "../ui";
import { eur } from "../../lib/format";
import { loadCockpit, EMPTY_COCKPIT, type CockpitData, type AssignmentEvent } from "../../lib/cockpit";

const timeFmt = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" });
const evTime = (e: AssignmentEvent) =>
  e.all_day ? "Ganztägig" : `${timeFmt.format(new Date(e.start_at))}–${timeFmt.format(new Date(e.end_at))}`;

function statusTone(s: string): Tone {
  const t = (s || "").toLowerCase();
  if (t.includes("abgeschlossen") || t.includes("erledigt")) return "green";
  if (t.includes("abgesagt") || t.includes("storn")) return "red";
  if (t.includes("plan")) return "blue";
  return "slate";
}

function Panel({ title, icon: Icon, to, toLabel, children, className = "" }: {
  title: string; icon: typeof Gauge; to?: string; toLabel?: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`glass flex flex-col p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold">
          <Icon size={16} style={{ color: "var(--accent)" }} /> {title}
        </h3>
        {to && (
          <Link to={to} className="shrink-0 text-xs font-semibold hover:underline" style={{ color: "var(--accent)" }}>
            {toLabel ?? "Öffnen"}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

/** Eine Stufe der Angebots-Pipeline: Anzahl, Summe und Balken im Verhältnis zum Maximum. */
function PipeRow({ label, n, sum, max, color }: { label: string; n: number; sum: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((sum / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label} <span className="text-slate-400">· {n}</span></span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">{eur(sum)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function Leitstand() {
  const [data, setData] = useState<CockpitData>(EMPTY_COCKPIT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadCockpit()
      .then((d) => { if (alive) setData(d); })
      .catch(() => { /* Leitstand ist optional – Startseite bleibt nutzbar */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return null; // kein Skeleton-Flackern über der persönlichen Übersicht

  const pipeMax = Math.max(data.offerDraftSum, data.offerDoneSum, data.offerSentSum, data.offerAcceptedSum, 1);
  const nothingPlanned =
    data.assignmentsToday.length === 0 && data.unassignedToday.length === 0 && data.absencesToday.length === 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-1">
        <Gauge size={16} style={{ color: "var(--accent)" }} />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Leitstand</h2>
        <span className="text-xs text-slate-400">Firmensicht · nur für Administratoren</span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Offene Forderungen */}
        <Panel title="Offene Forderungen" icon={Receipt} to="/dokumente?typ=rechnungen" toLabel="Rechnungen">
          <div className="text-3xl font-extrabold tabular-nums">{eur(data.invoicesOpenSum)}</div>
          <div className="text-xs text-slate-400">{data.invoicesOpenCount} offene Rechnung{data.invoicesOpenCount === 1 ? "" : "en"}</div>
          {data.invoicesOverdueCount > 0 ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-500">
              <AlertTriangle size={15} />
              {data.invoicesOverdueCount} überfällig · {eur(data.invoicesOverdueSum)}
            </div>
          ) : (
            <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Nichts überfällig
            </div>
          )}
        </Panel>

        {/* Angebots-Pipeline */}
        <Panel title="Angebots-Pipeline" icon={TrendingUp} to="/dokumente?typ=angebote" toLabel="Angebote" className="xl:col-span-2">
          {data.offersLive === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <p className="text-sm text-slate-400">Noch keine Angebote in der Pipeline</p>
              <Link to="/dokumente?typ=angebote" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--accent)" }}>
                Angebot erstellen <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-3 text-xs text-slate-400">{data.offersLive} Angebot{data.offersLive === 1 ? "" : "e"} in Bearbeitung</div>
              <div className="space-y-2.5">
                <PipeRow label="Entwurf" n={data.offerDraftN} sum={data.offerDraftSum} max={pipeMax} color="#94a3b8" />
                <PipeRow label="Abgeschlossen" n={data.offerDoneN} sum={data.offerDoneSum} max={pipeMax} color="#f59e0b" />
                <PipeRow label="Versendet" n={data.offerSentN} sum={data.offerSentSum} max={pipeMax} color="#3b82f6" />
                <PipeRow label="Angenommen" n={data.offerAcceptedN} sum={data.offerAcceptedSum} max={pipeMax} color="#22c55e" />
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* Mitarbeiter-Einteilung heute */}
      <Panel title="Mitarbeiter-Einteilung heute" icon={UsersRound} to="/einsatzplanung?ansicht=plan" toLabel="Einsatzplanung">
        {nothingPlanned ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <CalendarClock size={22} className="text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-400">Heute ist niemand eingeteilt</p>
            <Link to="/einsatzplanung?ansicht=plan" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--accent)" }}>
              Einsatz planen <ArrowRight size={13} />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-slate-400">
              {data.onSiteToday} von {data.employeesActive} Mitarbeitern im Einsatz
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {data.assignmentsToday.map((a) => (
                <div key={a.employeeId} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      <UsersRound size={14} />
                    </span>
                    <span className="truncate text-sm font-semibold">{a.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                      {a.events.length} Einsatz{a.events.length === 1 ? "" : "e"}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {a.events.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 text-xs">
                        <span className="shrink-0 font-medium tabular-nums text-slate-500 dark:text-slate-400">{evTime(e)}</span>
                        <span className="truncate">{e.title}</span>
                        {e.location && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 truncate text-slate-400">
                            <MapPin size={11} /> {e.location}
                          </span>
                        )}
                        <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {data.unassignedToday.length > 0 && (
              <div className="rounded-xl border border-dashed border-amber-300/60 p-3 dark:border-amber-400/30">
                <div className="mb-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Ohne Zuordnung ({data.unassignedToday.length})
                </div>
                <ul className="space-y-1">
                  {data.unassignedToday.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-xs">
                      <span className="shrink-0 tabular-nums text-slate-400">{evTime(e)}</span>
                      <span className="truncate">{e.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.absencesToday.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-400">Abwesend:</span>
                {data.absencesToday.map((a, i) => (
                  <Badge key={`${a.employeeId ?? "x"}-${i}`} tone="amber">{a.name} · {a.label}</Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </section>
  );
}
