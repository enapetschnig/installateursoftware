import { NavLink, Outlet } from "react-router-dom";
import { Hammer, Ruler, Clock, Package, ListChecks, Heading, FileText } from "lucide-react";
import { PageHeader } from "../../components/ui";

const TABS = [
  { to: "/kalkulation/gewerke", label: "Gewerke", icon: Hammer },
  { to: "/kalkulation/einheiten", label: "Einheiten", icon: Ruler },
  { to: "/kalkulation/stundensaetze", label: "Stundensätze", icon: Clock },
  { to: "/kalkulation/artikel", label: "Artikelstamm", icon: Package },
  { to: "/kalkulation/leistungen", label: "Leistungen", icon: ListChecks },
  { to: "/kalkulation/titel", label: "Titel", icon: Heading },
  { to: "/kalkulation/texte", label: "Texte", icon: FileText },
];

export default function KalkLayout() {
  return (
    <div className="pt-4">
      <PageHeader
        title="Kalkulation"
        subtitle="Gewerke, Stundensätze, Artikel und Leistungen – Basis für Angebote, Aufträge & Rechnungen."
      />
      <div className="mb-6 flex flex-wrap gap-1.5 rounded-2xl border p-1.5"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all ${
                isActive ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
              }`
            }
            style={({ isActive }: any) =>
              isActive ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined
            }
          >
            <t.icon size={16} /> {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
