import { NavLink, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { ReactNode, useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, BarChart3, Mail, FolderKanban, Users, Calculator, ListTodo,
  Building2, Zap, Receipt, User, UsersRound, Settings,
  Eye, Check, LogOut, Search, Menu, ChevronRight, ChevronDown,
  Palette, X, Files, Newspaper, UserCheck, Inbox,
  CalendarClock, ClipboardList, Timer, Clock, Smartphone, Megaphone,
} from "lucide-react";
import GlobalSearch from "./GlobalSearch";
import TopbarIndicators from "./TopbarIndicators";
import ScreenshotButton from "./ScreenshotButton";
import { useTheme, ACCENT_THEMES } from "../lib/theme";
import { useAuth } from "../lib/auth";
import { usePermissions } from "../lib/permissions";
import Avatar from "./Avatar";
import { supabase } from "../lib/supabase";
import { useProjectConfig } from "../lib/project-config";
import { LogoFull } from "./Logo";
import { APP_NAME } from "../lib/branding";
import Isabella from "./Isabella";
import AiTourOverlay from "./ai/AiTourOverlay";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  group?: "projekte";
  section?: string; // Sektions-Überschrift; gleiche Sektion = ein Block
  module?: string; // Permission-Modul; undefined = immer sichtbar
  adminOnly?: boolean; // true = nur Administratoren (kein vergebbares Modul)
  hidden?: boolean; // true = vorerst ausgeblendet (Route bleibt bestehen, nur nicht im Menü)
};

// Gruppierte Navigation: Reihenfolge folgt dem realen Auftragsablauf
// (Anfrage → Kalkulation → Projekt → Planung → Zeit → Abrechnung).
// `hidden: true` = Modul hat noch keinen echten Inhalt ("in Vorbereitung") →
// erscheint nicht im Menü, die Route bleibt per Direkt-Link erreichbar.
const NAV: NavItem[] = [
  // Start (ohne Sektions-Überschrift)
  { to: "/", label: "Übersicht", icon: LayoutDashboard, end: true, module: "dashboard" },

  // Vertrieb & Kunden
  { to: "/crm", label: "CRM", icon: Inbox, section: "Vertrieb & Kunden", module: "requests" },
  { to: "/kontakte", label: "Kontakte", icon: Users, section: "Vertrieb & Kunden", module: "contacts" },
  { to: "/kalkulation", label: "Kalkulation", icon: Calculator, section: "Vertrieb & Kunden", module: "kalkulation" },
  { to: "/projekte", label: "Projekte", icon: FolderKanban, section: "Vertrieb & Kunden", group: "projekte", module: "projects" },

  // Planung & Ausführung
  { to: "/einsatzplanung", label: "Einsatzplanung", icon: CalendarClock, section: "Planung & Ausführung", module: "plantafel" },

  // Zeit & Leistung (vom Persönlichen zum Aggregierten)
  { to: "/meine-stunden", label: "Meine Stunden", icon: Clock, section: "Zeit & Leistung" },
  { to: "/stundenauswertung", label: "Stundenauswertung", icon: Timer, section: "Zeit & Leistung", module: "time_tracking" },
  { to: "/regieberichte", label: "Regieberichte", icon: ClipboardList, section: "Zeit & Leistung", module: "regiestunden" },

  // Finanzen
  { to: "/dokumente", label: "Dokumente", icon: Files, section: "Finanzen", module: "documents" },
  { to: "/buchhaltung", label: "Buchhaltung", icon: Receipt, section: "Finanzen", module: "buchhaltung" },

  // Kommunikation
  { to: "/email", label: "E-Mail", icon: Mail, section: "Kommunikation", module: "email" },
  { to: "/marketing", label: "Marketing", icon: Megaphone, section: "Kommunikation", module: "marketing" },

  // Team
  { to: "/mitarbeiter", label: "Mitarbeiter", icon: UsersRound, section: "Team", module: "employees" },
  { to: "/m", label: "Mitarbeiter-App", icon: Smartphone, section: "Team", module: "mitarbeiter_app" },

  // Steuerung & Analyse
  { to: "/auswertungen", label: "Auswertungen", icon: BarChart3, section: "Steuerung & Analyse", module: "analytics" },
  { to: "/automationen", label: "Automationen", icon: Zap, section: "Steuerung & Analyse", module: "automations" },

  // System
  { to: "/einstellungen", label: "Einstellungen", icon: Settings, section: "System" },

  // Ausgeblendet bis echter Inhalt existiert (Routen bleiben erreichbar).
  { to: "/aufgaben", label: "Aufgaben", icon: ListTodo, module: "tasks", hidden: true },
  { to: "/buero", label: "Büroorganisation", icon: Building2, module: "buero", hidden: true },
  { to: "/news", label: "News", icon: Newspaper, module: "news", hidden: true },
  { to: "/delegieren", label: "Delegieren", icon: UserCheck, module: "delegieren", hidden: true },
  { to: "/persoenliche-daten", label: "Persönliche Daten", icon: User, hidden: true },
];

const PROJ_OPEN_KEY = "b4y-nav-projekte-open";

export default function Layout({ children }: { children: ReactNode }) {
  const { resolvedBase, eyeCareMode, toggleEyeCare, accentTheme, setAccentTheme } = useTheme();
  const { profile, session, signOut } = useAuth();
  const [accentOpen, setAccentOpen] = useState(false);
  const { can, isAdmin } = usePermissions();
  const { types: projectTypes } = useProjectConfig();
  const visibleNav = NAV.filter((n) => !n.hidden && (n.adminOnly ? isAdmin : isAdmin || !n.module || can(n.module, "view")));
  const nav = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  // Projektanzahl je Projekttyp (category) für die Sidebar-Badges. Nur aktive (nicht
  // archivierte) Projekte – passend zur Standard-Projektliste. RLS/organization_id greift
  // serverseitig. Eine Query (nur category), im JS gruppiert; bei Navigation aktualisiert.
  const [projCounts, setProjCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    supabase.from("projects").select("category").eq("archived", false).then(({ data }) => {
      if (cancelled || !data) return;
      const c: Record<string, number> = {};
      for (const r of data as { category: string | null }[]) {
        const k = (r.category ?? "").trim();
        if (k) c[k] = (c[k] ?? 0) + 1;
      }
      setProjCounts(c);
    });
    return () => { cancelled = true; };
  }, [location.pathname]);
  const name = profile?.name ?? session?.user.email ?? "Nutzer";
  // Eigenes Mitarbeiterfoto (privat) für die Avatar-Anzeige in Sidebar/Topbar.
  const [myPhoto, setMyPhoto] = useState<string | null>(null);
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) { setMyPhoto(null); return; }
    supabase.from("employees").select("photo_url").eq("auth_user_id", uid).maybeSingle()
      .then(({ data }) => setMyPhoto((data as { photo_url: string | null } | null)?.photo_url ?? null));
  }, [session?.user?.id]);

  const onProjects = location.pathname === "/projekte" || location.pathname.startsWith("/projekte/");
  const activeTyp = params.get("typ");

  // ── Zentrale Scroll-/Höhen-Logik für Tabellen ──────────────────────────
  // Tabellen-Wrapper (.overflow-x-auto um eine <table>) sind beschränkte
  // Scrollbereiche, damit der sticky Tabellenkopf greift. Problem der fixen
  // CSS-max-height (100dvh − 210px): sie ignoriert, wie weit unten die Tabelle
  // tatsächlich beginnt → bei tief startenden Tabellen (z.B. Einstellungen →
  // Dokumentarten) ragt der Scrollbereich unter den Viewport und die letzten
  // Zeilen werden abgeschnitten. Hier berechnen wir die nutzbare Höhe je
  // Wrapper aus seiner echten Position im Scrollcontainer (<main>) und lassen
  // unten genug Platz (Floating-Button + Sicherheitsabstand). Appweit, zentral.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const GAP = 84; // Sicherheitsabstand unten (Floating-Assistant + Luft)
    let raf = 0;
    const recalc = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mainTop = main.getBoundingClientRect().top;
        const wrappers = main.querySelectorAll<HTMLElement>(".overflow-x-auto");
        wrappers.forEach((w) => {
          if (!w.querySelector(":scope > table")) return;
          // Abstand des Wrappers vom Inhaltsanfang (scroll-stabil)
          const topInMain = w.getBoundingClientRect().top - mainTop + main.scrollTop;
          const avail = main.clientHeight - topInMain - GAP;
          // Nur setzen, wenn sinnvoll Platz da ist; sonst CSS-Fallback greifen lassen
          w.style.maxHeight = avail > 180 ? `${Math.floor(avail)}px` : "";
          w.style.scrollPaddingBottom = "0.5rem";
        });
      });
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(main);
    // Inhaltswechsel (Tab-Wechsel, geladene Daten) → neu berechnen.
    // (Nur childList/subtree → eigene style-Änderungen lösen KEIN Re-Trigger aus.)
    const mo = new MutationObserver(recalc);
    mo.observe(main, { childList: true, subtree: true });
    window.addEventListener("resize", recalc);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [location.pathname]);

  // Modul-/Routenwechsel (Sidebar/Hauptnavigation) → Inhalt immer oben starten.
  // Bewusst NUR an den Pfad gebunden: Query-Änderungen (?tab=…, ?typ=…) und
  // In-Page-Aktionen (z. B. Scroll zu neu eingefügter Tabellenposition) bleiben unberührt.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const [projOpen, setProjOpen] = useState<boolean>(() => {
    const v = localStorage.getItem(PROJ_OPEN_KEY);
    return v === null ? true : v === "true";
  });
  useEffect(() => { if (onProjects && activeTyp) setProjOpen(true); }, [onProjects, activeTyp]);
  useEffect(() => { localStorage.setItem(PROJ_OPEN_KEY, String(projOpen)); }, [projOpen]);

  const activeStyle = { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" };

  // Einheitliche Klasse + feste Icon-Spalte → exakt bündige Menüpunkte (gleiche Einrückung,
  // Icon-Spalte, Abstand, Zeilenhöhe und Baseline für ALLE Einträge inkl. „Projekte").
  const navItemClass = (active: boolean) =>
    `flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
      active ? "text-white nav-active" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
    }`;
  const NavIcon = ({ I }: { I: typeof LayoutDashboard }) => (
    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center"><I size={18} /></span>
  );

  // Sichtbare Punkte in Sektions-Blöcke bündeln (Reihenfolge bleibt erhalten).
  const navSections = visibleNav.reduce<{ label: string | null; items: NavItem[] }[]>((acc, n) => {
    const label = n.section ?? null;
    const last = acc[acc.length - 1];
    if (last && last.label === label) last.items.push(n);
    else acc.push({ label, items: [n] });
    return acc;
  }, []);

  // Stabile Tour-Anker für den KI-Schulungsmodus: jeder Menüpunkt ist über
  // `nav-<slug>` adressierbar (Projekte behält den historischen Namen).
  const navTourId = (to: string) =>
    to === "/projekte" ? "project-nav" : `nav-${to === "/" ? "start" : to.replace(/^\//, "")}`;

  const renderNavItem = (n: NavItem) =>
    n.group === "projekte" ? (
      <div key={n.to}>
        <div className={navItemClass(onProjects)} style={onProjects ? activeStyle : undefined}>
          <NavLink to={n.to} onClick={() => setMobileOpen(false)} data-tour-id="project-nav"
            className="flex min-w-0 flex-1 items-center gap-3">
            <NavIcon I={n.icon} /> <span className="min-w-0 break-words leading-snug">{n.label}</span>
          </NavLink>
          <button onClick={() => setProjOpen((o) => !o)} aria-label="Projekttypen ein-/ausklappen"
            className={`-mr-1 shrink-0 rounded-lg p-1 transition ${onProjects ? "hover:bg-white/15" : "hover:bg-slate-200 dark:hover:bg-white/10"}`}>
            {projOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
        {projOpen && (
          <div className="mt-0.5 ml-1 space-y-0.5">
            {projectTypes.map((t) => {
              const active = onProjects && activeTyp === t.slug;
              return (
                <NavLink key={t.slug} to={`/projekte?typ=${t.slug}`} onClick={() => setMobileOpen(false)}
                  title={t.label}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] leading-snug transition hover:bg-slate-100 dark:hover:bg-white/5 ${
                    active ? "" : "text-slate-500 dark:text-slate-400"}`}
                  style={active
                    ? { color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 14%, transparent)", fontWeight: 500 }
                    : undefined}>
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t.label}</span>
                  {projCounts[t.category] ? (
                    <span className="shrink-0 rounded-full bg-slate-200/80 px-1.5 text-[10px] font-medium tabular-nums text-slate-500 dark:bg-white/10 dark:text-slate-300">
                      {projCounts[t.category]}
                    </span>
                  ) : null}
                </NavLink>
              );
            })}
          </div>
        )}
      </div>
    ) : (
      <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMobileOpen(false)}
        data-tour-id={navTourId(n.to)}
        className={({ isActive }) => navItemClass(isActive)}
        style={({ isActive }: any) => (isActive ? activeStyle : undefined)}>
        <NavIcon I={n.icon} /> <span className="min-w-0 break-words leading-snug">{n.label}</span>
      </NavLink>
    );

  const Side = (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex shrink-0 justify-center px-1">
        {/* Logo führt app-weit zur Übersicht (Dashboard). Branding bleibt mandantenfähig
            (LogoFull zieht das Mandanten-Logo) – egal welches Logo, der Klick geht immer auf "/". */}
        <NavLink to="/" end onClick={() => setMobileOpen(false)}
          aria-label="Zur Übersicht" title="Zur Übersicht"
          className="cursor-pointer rounded-xl transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          <LogoFull height={60} />
        </NavLink>
      </div>
      {/* Gruppierte Navigation: Sektions-Überschriften machen die Liste scanbar
          (statt 24 gleichrangiger Punkte untereinander). */}
      <nav className="flex-1 overflow-y-auto pr-1">
        {navSections.map((sec, i) => (
          <div key={sec.label ?? `start-${i}`} className={i > 0 ? "mt-3" : ""}>
            {sec.label && (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                {sec.label}
              </div>
            )}
            <div className="space-y-0.5">{sec.items.map(renderNavItem)}</div>
          </div>
        ))}
      </nav>
      <button onClick={() => nav("/einstellungen")} className="mt-3 flex items-center gap-2.5 rounded-xl border border-slate-200 p-2.5 text-left transition hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5">
        <Avatar name={name} url={myPhoto} size={36} />
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{name}</div><div className="text-[11px] text-slate-400">{APP_NAME}</div></div>
        <ChevronRight size={16} className="text-slate-400" />
      </button>
    </div>
  );

  return (
    <div className="relative flex h-full">
      <div className="app-bg" />

      <aside className="relative z-10 hidden w-64 shrink-0 pl-4 pr-2 pb-4 pt-3 lg:block">
        <div className="glass h-full px-4 pb-4 pt-4">{Side}</div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 p-4"><div className="glass h-full p-4">{Side}</div></aside>
        </div>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 px-3 py-2 sm:px-4">
          <div className="glass flex w-full items-center gap-3 px-3 py-2.5">
            <button className="btn-ghost px-2 lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <div className="relative hidden flex-1 sm:block">
              <GlobalSearch />
            </div>
            {/* Mobil: Such-Button öffnet Vollbild-Sheet (Eingabe ist auf kleinen Screens ausgeblendet) */}
            <div className="flex flex-1 sm:hidden">
              <button className="btn-ghost px-2" onClick={() => setMobileSearchOpen(true)} aria-label="Suchen"><Search size={20} /></button>
            </div>
            {/* Nur der Augenschonmodus bleibt als schnelle Komfortfunktion oben.
               Hell/Dunkel/System sind in Einstellungen → Design / Darstellung. */}
            <div className="seg" title="Augenschonmodus schnell ein-/ausschalten">
              <button className="seg-btn" data-active={eyeCareMode ? "true" : "false"} onClick={toggleEyeCare}
                title={eyeCareMode ? "Augenschonmodus ausschalten" : "Augenschonmodus einschalten"}>
                <Eye size={15} /> <span className="hidden xl:inline">Augenschon</span>{eyeCareMode && <Check size={13} />}
              </button>
            </div>

            {/* Akzentfarben-Schnellwahl */}
            <div className="relative">
              <button className="btn-ghost flex items-center gap-1.5 px-2.5" title="Farbschema wählen" onClick={() => setAccentOpen((o) => !o)}>
                <Palette size={18} />
                <span className="h-3 w-3 rounded-full" style={{ background: "var(--accent)" }} />
              </button>
              {accentOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAccentOpen(false)} />
                  <div className="glass absolute right-0 z-40 mt-2 w-52 p-2" style={{ borderColor: "var(--border)" }}>
                    <div className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text2)" }}>Farbschema</div>
                    {ACCENT_THEMES.map((a) => {
                      const active = accentTheme === a.key;
                      const dot = resolvedBase === "dark" ? a.darkSwatch : a.swatch;
                      return (
                        <button key={a.key} onClick={() => { setAccentTheme(a.key); setAccentOpen(false); }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-[var(--hover)]"
                          style={active ? { color: "var(--accent)", fontWeight: 600 } : { color: "var(--text)" }}>
                          <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: dot }} />
                          <span className="flex-1 text-left">{a.label}</span>
                          {active && <Check size={15} />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {/* Screenshot direkt aus der App (PNG-Download, immer sichtbar) */}
            <ScreenshotButton />
            {/* Benachrichtigungen / Aufgaben / neue Mails – datenbasiert, rechtegeprüft */}
            <TopbarIndicators />
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar name={name} url={myPhoto} size={32} />
              <span className="text-sm font-medium">{name}</span>
              <button onClick={async () => { await signOut(); nav("/login"); }} className="btn-ghost px-1.5" title="Abmelden"><LogOut size={16} /></button>
            </div>
          </div>
        </header>
        <main ref={mainRef} className="flex-1 overflow-y-auto px-3 pb-8 sm:px-4">{children}</main>
      </div>

      {mobileSearchOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileSearchOpen(false)} />
          <div className="absolute inset-x-0 top-0 p-3">
            <div className="glass flex items-center gap-2 p-2">
              <div className="min-w-0 flex-1"><GlobalSearch autoFocus onNavigate={() => setMobileSearchOpen(false)} /></div>
              <button className="btn-ghost shrink-0 px-2" onClick={() => setMobileSearchOpen(false)} aria-label="Suche schließen"><X size={20} /></button>
            </div>
          </div>
        </div>
      )}

      <Isabella />
      <AiTourOverlay />
    </div>
  );
}
