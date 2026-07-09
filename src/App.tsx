import { ReactNode, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "./lib/auth";
import { usePermissions } from "./lib/permissions";
import { loadCompanySettings } from "./lib/company";
import { Toaster } from "./lib/toast";
import { UnsavedChangesProvider } from "./lib/unsaved-changes";

// Browser-Favicon / App-Icon aus dem Icon-Logo setzen (Fallback: Hauptlogo).
function useBrandingFavicon() {
  useEffect(() => {
    loadCompanySettings().then((c) => {
      const url = c?.icon_logo_url || c?.logo_url;
      if (!url) return;
      (["icon", "apple-touch-icon"] as const).forEach((rel) => {
        let l = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
        if (!l) { l = document.createElement("link"); l.rel = rel; document.head.appendChild(l); }
        l.href = url;
      });
    }).catch(() => { /* still Fallback im index.html */ });
  }, []);
}
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Contacts from "./pages/Contacts";
import ContactDetail from "./pages/ContactDetail";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Placeholder from "./pages/Placeholder";
import Buchhaltung from "./pages/Buchhaltung";
import Marketing from "./pages/Marketing";
import Settings from "./pages/Settings";
import KalkLayout from "./pages/kalkulation/KalkLayout";
import Trades from "./pages/kalkulation/Trades";
import HourlyRates from "./pages/kalkulation/HourlyRates";
import Articles from "./pages/kalkulation/Articles";
import Services from "./pages/kalkulation/Services";
import Units from "./pages/kalkulation/Units";
import Titel from "./pages/kalkulation/Titel";
import Texte from "./pages/kalkulation/Texte";
import ServiceEditor from "./pages/kalkulation/ServiceEditor";
import OfferEditor from "./pages/OfferEditor";
import OrderEditor from "./pages/OrderEditor";
import SubOrderEditor from "./pages/SubOrderEditor";
import InvoiceEditor from "./pages/InvoiceEditor";
import Reports from "./pages/Reports";
import Documents from "./pages/Documents";
import DocumentEditorRouter from "./pages/DocumentEditorRouter";
import Planung from "./pages/Planung";
import Automationen from "./pages/Automationen";
import Employees from "./pages/Employees";
import EmployeeDetail from "./pages/EmployeeDetail";
import Email from "./pages/Email";
import Anfragen from "./pages/Anfragen";
import AnfrageDetail from "./pages/AnfrageDetail";
import PasswordSet from "./pages/PasswordSet";
import MeineStunden from "./pages/MeineStunden";
import Stundenauswertung from "./pages/Stundenauswertung";
import Regieberichte from "./pages/Regieberichte";
import RegieberichtDetail from "./pages/RegieberichtDetail";
import Plantafel from "./pages/Plantafel";
// Mitarbeiter-App (eigener, mobil-first Bereich unter /m)
import MitarbeiterLayout from "./components/mitarbeiter/MitarbeiterLayout";
import MHome from "./pages/mitarbeiter/MHome";
import MProjekte from "./pages/mitarbeiter/MProjekte";
import MProjektDetail from "./pages/mitarbeiter/MProjektDetail";
import MRegie from "./pages/mitarbeiter/MRegie";
import MZeit from "./pages/mitarbeiter/MZeit";

function Forbidden() {
  return (
    <div className="anim-in grid place-items-center py-24 text-center">
      <div className="glass max-w-md p-8">
        <ShieldAlert size={40} className="mx-auto mb-3 text-rose-500" />
        <h2 className="text-lg font-bold">Keine Berechtigung für diesen Bereich.</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Wende dich an einen Administrator, wenn du Zugriff benötigst.
        </p>
      </div>
    </div>
  );
}

function Guard({ module, action = "view", children }: { module: string; action?: string; children: ReactNode }) {
  const { can, isAdmin, loading } = usePermissions();
  if (loading) return <div className="grid h-full place-items-center text-slate-400">Lädt …</div>;
  return isAdmin || can(module, action) ? <>{children}</> : <Forbidden />;
}

// Startseite: reine Mitarbeiter (Monteure) ohne Dashboard-Recht landen in der
// Mitarbeiter-App (/m). Alle anderen sehen das normale Dashboard.
function HomeRedirect() {
  const { can, isAdmin, loading } = usePermissions();
  if (loading) return <div className="grid h-full place-items-center text-slate-400">Lädt …</div>;
  if (!isAdmin && !can("dashboard", "view") && can("mitarbeiter_app", "view")) {
    return <Navigate to="/m" replace />;
  }
  return <Dashboard />;
}

// Eigener, mobil-first Bereich nur für Mitarbeiter/Monteure – komplett eigenes
// Layout (keine Admin-Sidebar). Zugang über das Modul 'mitarbeiter_app'.
function MitarbeiterApp() {
  const { can, isAdmin, loading } = usePermissions();
  if (loading) return <div className="grid h-full place-items-center text-slate-400">Lädt …</div>;
  if (!isAdmin && !can("mitarbeiter_app", "view")) return <Forbidden />;
  return (
    <MitarbeiterLayout>
      <Toaster />
      <Routes>
        <Route path="/m" element={<MHome />} />
        <Route path="/m/projekte" element={<MProjekte />} />
        <Route path="/m/projekte/:id" element={<MProjektDetail />} />
        <Route path="/m/regie" element={<MRegie />} />
        <Route path="/m/regie/neu" element={<MRegie />} />
        <Route path="/m/zeit" element={<MZeit />} />
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Routes>
    </MitarbeiterLayout>
  );
}

export default function App() {
  const { session, loading } = useAuth();
  const location = useLocation();
  useBrandingFavicon();

  if (loading) return <div className="grid h-full place-items-center text-slate-400">Lädt …</div>;
  if (!session) return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );

  // Mitarbeiter-App: eigener Bereich mit eigenem Layout (außerhalb der Admin-Shell).
  if (location.pathname === "/m" || location.pathname.startsWith("/m/")) {
    return <MitarbeiterApp />;
  }

  return (
    <UnsavedChangesProvider>
    <Layout>
      <Toaster />
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        {/* Cockpit ist in die Startseite aufgegangen (Leitstand-Abschnitt für Admins).
            Alte Links/Lesezeichen bleiben gültig. */}
        <Route path="/cockpit" element={<Navigate to="/" replace />} />
        {/* Passwort festlegen nach Einladungs-/Recovery-Link – ohne Guard (eigenes Konto). */}
        <Route path="/passwort-setzen" element={<PasswordSet />} />
        <Route path="/kontakte" element={<Guard module="contacts"><Contacts /></Guard>} />
        <Route path="/kontakte/:id" element={<Guard module="contacts"><ContactDetail /></Guard>} />
        <Route path="/projekte" element={<Guard module="projects"><Projects /></Guard>} />
        <Route path="/projekte/:id" element={<Guard module="projects"><ProjectDetail /></Guard>} />
        {/* Alte Einzel-Übersichten leiten auf die zentrale Dokumentenübersicht (mit Typ-Filter). */}
        <Route path="/angebote" element={<Navigate to="/dokumente?typ=angebote" replace />} />
        <Route path="/angebote/:id" element={<Guard module="offers"><OfferEditor /></Guard>} />
        <Route path="/auftraege" element={<Navigate to="/dokumente?typ=auftraege" replace />} />
        <Route path="/auftraege/:id" element={<Guard module="orders"><OrderEditor /></Guard>} />
        {/* Auftrag-SUB nutzt dasselbe Rechte-Modul wie Aufträge ('orders'). */}
        <Route path="/auftraege-sub/:id" element={<Guard module="orders"><SubOrderEditor /></Guard>} />
        <Route path="/buchhaltung" element={<Guard module="buchhaltung"><Buchhaltung /></Guard>} />
        <Route path="/marketing" element={<Guard module="marketing"><Marketing /></Guard>} />
        <Route path="/rechnungen" element={<Navigate to="/dokumente?typ=rechnungen" replace />} />
        <Route path="/rechnungen/:id" element={<Guard module="invoices"><InvoiceEditor /></Guard>} />
        <Route path="/persoenliche-daten" element={<Placeholder title="Persönliche Daten" note="Eigenes Profil, Stammdaten, Kontodaten – in Vorbereitung." />} />
        <Route path="/mitarbeiter" element={<Guard module="employees"><Employees /></Guard>} />
        <Route path="/mitarbeiter/:id" element={<Guard module="employees"><EmployeeDetail /></Guard>} />
        <Route path="/email" element={<Guard module="email"><Email /></Guard>} />
        <Route path="/anfragen" element={<Guard module="requests"><Anfragen /></Guard>} />
        <Route path="/anfragen/:id" element={<Guard module="requests"><AnfrageDetail /></Guard>} />
        {/* Zeiterfassung: Eigensicht (jeder Mitarbeiter) + Auswertung (Modul time_tracking). */}
        <Route path="/zeiterfassung" element={<Navigate to="/meine-stunden" replace />} />
        <Route path="/meine-stunden" element={<MeineStunden />} />
        <Route path="/stundenauswertung" element={<Guard module="time_tracking"><Stundenauswertung /></Guard>} />
        {/* Regieberichte (Modul regiestunden). */}
        <Route path="/regieberichte" element={<Guard module="regiestunden"><Regieberichte /></Guard>} />
        <Route path="/regieberichte/:id" element={<Guard module="regiestunden"><RegieberichtDetail /></Guard>} />
        <Route path="/doku" element={<Guard module="documents"><Placeholder title="Baustellendokumentation" note="Fotos, Logbuch, Checklisten, Aufmaß, Unterschrift." /></Guard>} />
        <Route path="/planung" element={<Guard module="plantafel"><Planung /></Guard>} />
        {/* Moderne Wochen-/Monats-Plantafel (Einsatzplanung). */}
        <Route path="/plantafel" element={<Guard module="plantafel"><Plantafel /></Guard>} />
        <Route path="/wartung" element={<Placeholder title="Wartungsverträge" note="Objekte mit wiederkehrenden Wartungen." />} />
        <Route path="/aufgaben" element={<Guard module="tasks"><Placeholder title="Aufgaben" note="Aufgabenverwaltung, projektbezogen." /></Guard>} />
        <Route path="/buero" element={<Guard module="buero"><Placeholder title="Büro-Organisation" note="Wiederkehrende Büroaufgaben (wöchentlich, monatlich, vertraglich)." /></Guard>} />
        <Route path="/automationen" element={<Guard module="automations"><Automationen /></Guard>} />
        {/* Zentrale, projektübergreifende Dokumentenübersicht (nicht zu verwechseln mit
            den Dokumenten innerhalb eines Projekts). Eigenes Modul „documents". */}
        <Route path="/dokumente" element={<Guard module="documents"><Documents /></Guard>} />
        <Route path="/dokumente/:id" element={<Guard module="documents"><DocumentEditorRouter /></Guard>} />
        <Route path="/news" element={<Guard module="news"><Placeholder title="News" subtitle="Aktuelle Informationen, interne Meldungen und wichtige Neuigkeiten." note="Dieses Modul wird als Nächstes gebaut." /></Guard>} />
        <Route path="/delegieren" element={<Guard module="delegieren"><Placeholder title="Delegieren" subtitle="Aufgaben, Verantwortlichkeiten und Übergaben gezielt delegieren." note="Dieses Modul wird als Nächstes gebaut." /></Guard>} />
        <Route path="/kalkulation" element={<Guard module="kalkulation"><KalkLayout /></Guard>}>
          <Route index element={<Navigate to="/kalkulation/gewerke" replace />} />
          <Route path="gewerke" element={<Trades />} />
          <Route path="einheiten" element={<Units />} />
          <Route path="stundensaetze" element={<HourlyRates />} />
          <Route path="artikel" element={<Articles />} />
          <Route path="leistungen" element={<Services />} />
          <Route path="titel" element={<Titel />} />
          <Route path="texte" element={<Texte />} />
        </Route>
        <Route path="/kalkulation/leistungen/:id" element={<ServiceEditor />} />
        <Route path="/artikel" element={<Navigate to="/kalkulation/artikel" replace />} />
        <Route path="/auswertungen" element={<Guard module="analytics"><Reports /></Guard>} />
        <Route path="/einstellungen" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
    </UnsavedChangesProvider>
  );
}
