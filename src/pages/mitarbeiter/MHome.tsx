// ============================================================
// Installateursoftware – Mitarbeiter-App: Startseite (/m)
//
// Karten-Launcher im Fasching-Stil: Begrüßung, kompakte Wochen-Kennzahlen
// und große Aktions-Karten. Bewusster Fokus auf die zwei Kernfunktionen der
// Mitarbeiter-App: ZEITERFASSUNG und REGIEBERICHTE (letztere auch per Sprache).
// Projekte/Fotos bleiben als sekundäre Karte erreichbar. Wenig Text, dicke
// Touch-Ziele; nutzt ausschließlich zentrale Design-Tokens (var(--accent) …)
// → Dark/Light + alle Akzent-Themes automatisch.
// ============================================================
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, ClipboardList, Clock, Mic } from "lucide-react";
import { Empty, Spinner } from "../../components/ui";
import { useMyEmployee } from "../../lib/my-employee";
import {
  loadTimeEntries, summarize, loadEmployeeSollContext, loadCompanyHolidays, fmtHours, fmtSaldo,
} from "../../lib/time-entries";

// Montag der aktuellen Woche (lokale Zeit).
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Mo=0 … So=6
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}
const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type WeekStats = { ist: number; soll: number; saldo: number };

export default function MHome() {
  const { employee, loading } = useMyEmployee();
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    setStatsLoading(true);
    const today = new Date();
    const from = isoDate(startOfWeek(today));
    const to = isoDate(today);
    const year = today.getFullYear();
    Promise.all([
      loadTimeEntries({ employeeId: employee.id, from, to }),
      loadEmployeeSollContext(year, employee.id),
      loadCompanyHolidays(year, year),
    ])
      .then(([entries, ctx, holidays]) => {
        if (cancelled) return;
        const holiSet = new Set(holidays.map((h) => h.datum));
        const s = summarize(entries, from, to, ctx, holiSet);
        setStats({ ist: s.istTotal, soll: s.sollTotal, saldo: s.autoSaldo });
      })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [employee]);

  if (loading) return <Spinner />;

  const greeting = employee?.first_name ? `Hallo, ${employee.first_name}!` : "Hallo!";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{greeting}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Zeiterfassung und Regieberichte.</p>
      </div>

      {!employee ? (
        <Empty
          title="Kein Mitarbeiterprofil verknüpft"
          hint="Dein Login ist noch keinem Mitarbeiter zugeordnet. Bitte wende dich an die Verwaltung."
        />
      ) : (
        <>
          {/* Wochen-Kennzahlen */}
          <div className="glass p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Diese Woche</h2>
              <Link to="/m/zeit" className="text-xs font-semibold text-[var(--accent)]">Zur Zeiterfassung</Link>
            </div>
            {statsLoading ? (
              <div className="py-4"><Spinner /></div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--hover)" }}>
                  <div className="text-2xl font-extrabold tabular-nums">{fmtHours(stats?.ist ?? 0)}</div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Ist-Std.</div>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--hover)" }}>
                  <div className="text-2xl font-extrabold tabular-nums">{fmtHours(stats?.soll ?? 0)}</div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Soll-Std.</div>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--hover)" }}>
                  <div
                    className="text-2xl font-extrabold tabular-nums"
                    style={{ color: (stats?.saldo ?? 0) < 0 ? "var(--c-red)" : "var(--c-green)" }}
                  >
                    {fmtSaldo(stats?.saldo ?? 0)}
                  </div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Saldo</div>
                </div>
              </div>
            )}
          </div>

          {/* Aktions-Karten (Fasching-Stil): Icon-Kachel + Titel + Beschreibung + Button */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <ActionCard
              to="/m/zeit"
              icon={Clock}
              title="Zeiterfassung"
              desc="Arbeitszeit auf Projekte buchen"
              button="Stunden erfassen"
            />
            <ActionCard
              to="/m/regie/neu"
              icon={ClipboardList}
              title="Regiebericht"
              desc="Einsatz dokumentieren – auch per Sprache"
              button="Bericht erstellen"
              badge={
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <Mic size={12} /> Sprache
                </span>
              }
            />
            <ActionCard
              to="/m/projekte"
              icon={FolderOpen}
              title="Projekte & Fotos"
              desc="Projekte ansehen, Fotos hochladen"
              button="Projekte öffnen"
              variant="outline"
            />
          </div>
        </>
      )}
    </div>
  );
}

function ActionCard({
  to, icon: Icon, title, desc, button, variant = "primary", badge,
}: {
  to: string; icon: typeof Clock; title: string; desc: string; button: string;
  variant?: "primary" | "outline"; badge?: React.ReactNode;
}) {
  return (
    <Link to={to} className="glass glass-hover flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white"
          style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}
        >
          <Icon size={24} />
        </span>
        {badge}
      </div>
      <div>
        <div className="text-lg font-bold">{title}</div>
        <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{desc}</div>
      </div>
      <span className={`${variant === "primary" ? "btn-primary" : "btn-outline"} mt-1 min-h-[44px] w-full justify-center`}>
        {button}
      </span>
    </Link>
  );
}
