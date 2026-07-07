// ============================================================
// Installateursoftware – Mitarbeiter-App: Startseite (/m)
//
// Begrüßung + kompakte Wochen-Kennzahlen (Ist/Soll/Saldo aus der zentralen
// Zeiterfassungs-Engine) + große Schnellzugriff-Kacheln zu Projekten,
// Regieberichten und Zeiterfassung. Bewusst wenig Text, dicke Touch-Ziele.
// Die Kennzahlen nutzen dieselbe Logik wie das Admin-Zeitmodul
// (loadTimeEntries + summarize + loadEmployeeSollContext), damit Zahlen
// überall konsistent sind.
// ============================================================
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, ClipboardList, Clock, ChevronRight } from "lucide-react";
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

const TILES = [
  { to: "/m/projekte", label: "Projekte", hint: "Ansehen & Fotos hochladen", icon: FolderOpen },
  { to: "/m/regie", label: "Regieberichte", hint: "Erstellen & ansehen", icon: ClipboardList },
  { to: "/m/zeit", label: "Zeit erfassen", hint: "Stunden buchen", icon: Clock },
];

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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{greeting}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Willkommen in deiner Mitarbeiter-App.</p>
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

          {/* Schnellzugriff */}
          <div className="space-y-3">
            {TILES.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="glass glass-hover flex min-h-[64px] items-center gap-4 p-4"
              >
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}
                >
                  <t.icon size={24} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{t.label}</span>
                  <span className="block text-sm text-slate-500 dark:text-slate-400">{t.hint}</span>
                </span>
                <ChevronRight size={20} className="shrink-0 text-slate-400" />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
