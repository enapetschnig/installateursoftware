// ============================================================
// Installateursoftware – Mitarbeiter-App: Rahmen/Layout (/m)
//
// Eigenes, schlankes, mobil-first Layout NUR für Monteure/Mitarbeiter.
// Bewusst OHNE die Admin-Sidebar: oben eine schlanke Kopfzeile (Firmenlogo,
// Name des eingeloggten Mitarbeiters, Logout), unten eine fixe Tab-Bar mit
// großen Touch-Zielen (Start · Projekte · Regie · Zeit). Der Inhalt liegt in
// einem eigenen scrollbaren Bereich; die Tab-Bar respektiert die iOS-Safe-Area
// (Klasse „safe-b"). Nutzt ausschließlich die zentralen Design-Tokens
// (--bg/--card/--border/--text/--accent) → Dark/Light + alle Akzent-Themes
// werden automatisch mitgetragen. Mandantenfähig: Logo/Name kommen aus den
// Firmen-/Mitarbeiterdaten (keine Hardcodierung).
// ============================================================
import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Home, FolderOpen, ClipboardList, Clock, LogOut } from "lucide-react";
import { LogoFull } from "../Logo";
import { useAuth } from "../../lib/auth";
import { useMyEmployee } from "../../lib/my-employee";

// Tab-Ziele der Mitarbeiter-App (Reihenfolge = Anzeige-Reihenfolge).
// `end` nur für die Startseite, damit /m nicht bei jeder Unterroute aktiv bleibt.
const TABS: { to: string; label: string; icon: typeof Home; end?: boolean }[] = [
  { to: "/m", label: "Start", icon: Home, end: true },
  { to: "/m/projekte", label: "Projekte", icon: FolderOpen },
  { to: "/m/regie", label: "Regie", icon: ClipboardList },
  { to: "/m/zeit", label: "Zeit", icon: Clock },
];

export default function MitarbeiterLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { employee } = useMyEmployee();

  const name =
    [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") ||
    profile?.name ||
    "Mitarbeiter";

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Kopfzeile: Firmenlogo · Name · Abmelden */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b px-4 py-2.5 backdrop-blur"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--card) 92%, transparent)" }}
      >
        <LogoFull height={30} />
        <div className="flex items-center gap-2">
          <span className="max-w-[42vw] truncate text-sm font-semibold">{name}</span>
          <button
            className="btn-ghost min-h-[44px] px-2"
            title="Abmelden"
            aria-label="Abmelden"
            onClick={() => void signOut()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Scrollbarer Inhaltsbereich (Platz unten für die fixe Tab-Bar). */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-4">{children}</main>

      {/* Fixe Tab-Bar (mobil-first, große Touch-Ziele, Safe-Area). */}
      <nav
        className="safe-b fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--card) 92%, transparent)" }}
      >
        <div className="mx-auto flex max-w-3xl">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                  isActive ? "text-[var(--accent)]" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`
              }
            >
              <t.icon size={22} />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
