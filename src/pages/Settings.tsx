import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sun, Moon, Monitor, Eye, Check, Palette, Hash, Images, UserRound, FolderTree, Building2, ShieldCheck, Mail, CalendarClock, FileStack, ListChecks, Minimize2, Maximize2, Orbit, Plug } from "lucide-react";
import { useTheme, ACCENT_THEMES, ThemeMode } from "../lib/theme";
import { useAuth } from "../lib/auth";
import { usePermissions } from "../lib/permissions";
import { useUnsavedGuard } from "../lib/unsaved-changes";
import { PageHeader } from "../components/ui";
import NumberRanges from "../components/NumberRanges";
import MediaCategoryManager from "../components/media/MediaCategoryManager";
import ProjectTypesManager from "../components/ProjectTypesManager";
import ProjectStatusManager from "../components/ProjectStatusManager";
import CompanySettings from "../components/CompanySettings";
import AccessControl from "../components/access/AccessControl";
import MailTemplatesManager from "../components/MailTemplatesManager";
import WorkCalendar from "../components/WorkCalendar";
import WorkTimeModelsManager from "../components/WorkTimeModelsManager";
import DocumentTypesManager from "../components/DocumentTypesManager";
import OfferTypesManager from "../components/OfferTypesManager";
import KiSettings from "../components/KiSettings";
import ModuleMap from "../components/settings/ModuleMap";
import DataReset from "../components/settings/DataReset";
import IntegrationsTab from "../components/integrations/IntegrationsTab";
import KalkulationSettings from "../components/settings/KalkulationSettings";
import { extractConnectReason } from "../components/integrations/connect-reason";
import { toast, toastError } from "../lib/toast";
import { FileText, Sparkles, RefreshCcw, Calculator } from "lucide-react";

const MODE_OPTIONS: { key: ThemeMode; label: string; desc: string; icon: any }[] = [
  { key: "light", label: "Hell", desc: "Heller Tagmodus", icon: Sun },
  { key: "dark", label: "Dunkel", desc: "Klassischer Nachtmodus", icon: Moon },
  { key: "system", label: "System automatisch", desc: "Folgt der Einstellung deines Geräts", icon: Monitor },
];

type Tab = "darstellung" | "firma" | "integrationen" | "projekttypen" | "projektstatus" | "nummernkreise" | "medien" | "mailvorlagen" | "dokumentarten" | "angebote" | "kalkulation" | "buak" | "ki" | "modulmap" | "zugriffsrechte" | "datenreset" | "konto";

// Gültige Reiter-Keys (für URL-Validierung – ein unbekanntes ?tab= darf keinen leeren Inhalt erzeugen).
const ALL_TABS: Tab[] = [
  "darstellung", "firma", "integrationen", "projekttypen", "projektstatus", "nummernkreise", "medien",
  "mailvorlagen", "dokumentarten", "angebote", "kalkulation", "buak", "ki", "modulmap", "zugriffsrechte", "datenreset", "konto",
];
const isValidTab = (v: string | null): v is Tab => !!v && (ALL_TABS as string[]).includes(v);

export default function Settings() {
  const { profile, session } = useAuth();
  const { isAdmin, can } = usePermissions();
  // Allgemeine Einstellungsverwaltung rein über das Rollensystem (keine hartcodierten
  // Rollennamen mehr). Admins haben ohnehin Vollzugriff; sonst zählt das Recht auf
  // Firmeneinstellungen. Die Zugriffsrechte-Lasche nutzt zusätzlich settings.permissions.
  const guard = useUnsavedGuard(); // sichert Reiterwechsel bei ungespeicherten Änderungen ab
  const canManage = isAdmin || can("settings.company", "edit"); // Firmen-/allgemeine Einstellungen
  // Editierrecht pro Einstellungs-Modul (Codex: nicht alle Tabs über settings.company gaten).
  const canEdit = (mod: string) => isAdmin || can(mod, "edit");
  const canPerms = isAdmin || can("settings.permissions", "view");
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const requestedSub = params.get("sub");
  const [tab, setTab] = useState<Tab>(isValidTab(requestedTab) ? requestedTab : "darstellung");

  // Reiter-Klick: sichtbaren Tab UND `?tab=` synchron halten. Ohne URL-Update laufen
  // State und Query auseinander (Reload/Teilen landet am falschen Reiter; „Modul öffnen"
  // in der Modulmap tut nichts, wenn das Ziel-?tab= noch als Rest in der URL steht).
  // `sub` gehört zum jeweiligen Reiter (Deep-Link Zugriffsrechte) und OAuth-Reste
  // (connected/reason) zum Integrationen-Rücksprung – beim manuellen Wechsel entfernen.
  // guard() umschließt State + URL, damit der Ungespeichert-Dialog weiter greift.
  const switchTab = (next: Tab) =>
    guard(() => {
      setTab(next);
      const p = new URLSearchParams(params);
      p.set("tab", next);
      p.delete("sub");
      p.delete("connected");
      p.delete("reason");
      setParams(p);
    });

  // „Modul öffnen" (Modulmap) und andere programmatische Navigationen ändern nur den
  // Query-String `?tab=`, während <Settings/> gemountet bleibt. useState liest den
  // Initialwert nur einmal → der sichtbare Reiter muss daher aktiv auf URL-Änderungen
  // reagieren. Nur auf gültige (und ggf. berechtigte) Tabs umschalten.
  useEffect(() => {
    if (!isValidTab(requestedTab)) return;
    if (requestedTab === "zugriffsrechte" && !canPerms) return;
    if (requestedTab === "datenreset" && !isAdmin) return;
    setTab(requestedTab);
  }, [requestedTab, canPerms, isAdmin]);

  // OAuth-Rueckkehr: /einstellungen?tab=integrationen&connected=ok|fail&reason=...
  // Wir zeigen einmalig einen Toast, aktivieren den Reiter und "verbrauchen"
  // dieselben Query-Parameter, damit Neuladen der Seite die Meldung nicht
  // erneut zeigt. Guard mit useRef, um StrictMode-Double-Invoke zu tolerieren.
  const connectHandledRef = useRef(false);
  useEffect(() => {
    if (connectHandledRef.current) return;
    const connectResult = extractConnectReason(params);
    if (connectResult.status === "none") return;
    connectHandledRef.current = true;
    if (connectResult.status === "ok") {
      toast("Microsoft-Konto erfolgreich verbunden.");
    } else {
      toastError(
        connectResult.message ?? "Verbindung fehlgeschlagen. Bitte erneut versuchen.",
      );
    }
    setTab("integrationen");
    // URL saeubern (ohne History-Eintrag) – tab bleibt erhalten, connected/reason weg.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* window.history nicht verfuegbar (SSR/Test) – ignorieren */
    }
  }, [params]);

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: "darstellung",   label: "Design / Darstellung", icon: Palette },
    { key: "firma",         label: "Firmeneinstellungen", icon: Building2 },
    { key: "integrationen", label: "Integrationen",      icon: Plug },
    { key: "projekttypen",  label: "Projekttypen",       icon: FolderTree },
    { key: "projektstatus", label: "Projektstatus",      icon: ListChecks },
    { key: "nummernkreise", label: "Nummernkreise",      icon: Hash },
    { key: "medien",        label: "Fotos & Videos",     icon: Images },
    { key: "mailvorlagen",  label: "Mailvorlagen",       icon: Mail },
    { key: "dokumentarten", label: "Dokumentarten",      icon: FileStack },
    { key: "angebote",      label: "Dokumentvarianten",  icon: FileText },
    { key: "kalkulation",   label: "Kalkulation",        icon: Calculator },
    { key: "buak",          label: "Kalender & Arbeitszeiten", icon: CalendarClock },
    { key: "ki",            label: "KI-Einstellungen",   icon: Sparkles },
    { key: "modulmap",      label: "Modulmap",           icon: Orbit },
    ...(canPerms ? [{ key: "zugriffsrechte" as Tab, label: "Zugriffsrechte", icon: ShieldCheck }] : []),
    ...(isAdmin ? [{ key: "datenreset" as Tab, label: "Datenreset", icon: RefreshCcw }] : []),
    { key: "konto",         label: "Konto",              icon: UserRound },
  ];

  return (
    <div className="anim-in space-y-5 pt-1">
      {/* Kein statischer Beschreibungstext mehr – die Reiter zeigen die Bereiche selbst.
         (Bewusst keine harte Bereichsliste, damit sie nicht wieder veraltet.) */}
      <PageHeader title="Einstellungen" />

      {/* Reiter-Navigation */}
      <div className="flex flex-wrap gap-1 rounded-2xl border bg-[var(--card)] p-1" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                active ? "text-white" : "text-slate-500 hover:bg-[var(--hover)] dark:text-slate-400"
              }`}
              style={active ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))" } : undefined}
            >
              <t.icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Design / Darstellung */}
      {tab === "darstellung" && <DesignSettings />}

      {/* Firmeneinstellungen */}
      {tab === "firma" && <CompanySettings canManage={canManage} />}

      {/* Integrationen (Microsoft/Outlook usw.) */}
      {tab === "integrationen" && <IntegrationsTab />}

      {/* Projekttypen */}
      {tab === "projekttypen" && <ProjectTypesManager canManage={canEdit("settings.project_templates")} />}

      {/* Projektstatus (zentral/global) */}
      {tab === "projektstatus" && <ProjectStatusManager canManage={canEdit("settings.project_statuses")} />}

      {/* Nummernkreise */}
      {tab === "nummernkreise" && <NumberRanges canManage={canEdit("settings.number_ranges")} />}

      {/* Fotos & Videos */}
      {tab === "medien" && <MediaCategoryManager canManage={canEdit("settings.media_categories")} />}

      {/* Mailvorlagen */}
      {tab === "mailvorlagen" && <MailTemplatesManager canManage={canManage} />}

      {/* Dokumentarten */}
      {tab === "dokumentarten" && <DocumentTypesManager canManage={canEdit("settings.document_types")} />}

      {/* Dokumentvarianten: Varianten & Texte (Angebot/Auftrag/Rechnung).
          Die PDF-Darstellung wird je Variante (hier) bzw. je Dokumentart (Tab Dokumentarten)
          und im konkreten Dokument gepflegt – kein separater globaler Fallback-Block mehr. */}
      {tab === "angebote" && <OfferTypesManager canManage={canEdit("settings.document_types")} />}

      {/* Kalkulation: globale Parameter der Voice-Angebote-Pipeline (Migr. 0125) */}
      {tab === "kalkulation" && <KalkulationSettings canManage={canManage} />}

      {/* Kalender & Arbeitszeiten: Jahreskalender (Wochenarten) + Arbeitszeitmodell-Vorlagen */}
      {tab === "buak" && (
        <div className="space-y-4">
          <WorkCalendar canManage={canManage} />
          <WorkTimeModelsManager canManage={canManage} />
        </div>
      )}

      {tab === "ki" && <KiSettings canManage={canEdit("settings.system")} />}

      {/* Modulmap / Systemkarte – read-only, interaktive 3D-Systemübersicht (keine DB, keine produktiven Daten) */}
      {tab === "modulmap" && <ModuleMap />}

      {/* Zugriffsrechte */}
      {tab === "zugriffsrechte" && canPerms && (
        <AccessControl canManage={isAdmin || can("settings.permissions", "edit")} initialSub={requestedSub} />
      )}

      {/* Datenreset (nur Administratoren) */}
      {tab === "datenreset" && <DataReset canManage={isAdmin} />}

      {/* Konto */}
      {tab === "konto" && (
        <div className="glass p-4">
          <h2 className="mb-3 text-lg font-bold">Konto</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-white/5">
              <dt className="text-slate-400">Name</dt><dd className="font-medium">{profile?.name ?? "–"}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-white/5">
              <dt className="text-slate-400">E-Mail</dt><dd className="font-medium">{session?.user.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Rolle</dt><dd className="font-medium">{profile?.role ?? "–"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-400">
            Firmendaten, Outlook-Anbindung und Nutzerverwaltung folgen in einem nächsten Schritt.
          </p>
        </div>
      )}
    </div>
  );
}

/* ===================== Reiter: Design / Darstellung ===================== */
function DesignSettings() {
  const { themeMode, setThemeMode, accentTheme, setAccentTheme, eyeCareMode, setEyeCareMode, compactMode, setCompactMode, resolvedBase } = useTheme();

  return (
    <div className="space-y-5">
      {/* 1) Darstellungsmodus */}
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Darstellungsmodus</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Hell, Dunkel oder automatisch dem System folgen. Die Auswahl wird gespeichert.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODE_OPTIONS.map((o) => {
            const active = themeMode === o.key;
            return (
              <button
                key={o.key}
                onClick={() => setThemeMode(o.key)}
                className="glass glass-hover flex flex-col items-start gap-2 p-4 text-left"
                style={active ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}
              >
                <div
                  className="grid h-11 w-11 place-items-center rounded-xl"
                  style={{
                    background: active ? "linear-gradient(135deg,var(--accent),var(--accent-h))" : "rgba(120,130,150,.15)",
                    color: active ? "var(--color-button-primary-text)" : "inherit",
                  }}
                >
                  <o.icon size={22} />
                </div>
                <div className="flex items-center gap-1.5 font-semibold">
                  {o.label}
                  {active && <Check size={15} style={{ color: "var(--accent)" }} />}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{o.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2) Farbschema / Akzentfarbe */}
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Farbschema</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Bestimmt die Akzentfarbe für Buttons, aktive Menüpunkte, Tabs, Badges und Fokusrahmen.
        </p>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          {ACCENT_THEMES.map((a) => {
            const active = accentTheme === a.key;
            const dot = resolvedBase === "dark" ? a.darkSwatch : a.swatch;
            return (
              <button
                key={a.key}
                onClick={() => setAccentTheme(a.key)}
                className="glass glass-hover flex items-center gap-3 p-3.5 text-left"
                style={active ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                  style={{ background: dot, color: "#fff" }}
                >
                  {active && <Check size={16} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{a.label}</span>
                  {active && <span className="text-xs" style={{ color: "var(--accent)" }}>aktiv</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3) Augenschonmodus */}
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Augenschonmodus</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Wärmere, ruhigere Flächen und weichere Kontraste – wird über das gewählte Farbschema gelegt.
        </p>
        <div className="seg w-fit">
          <button className="seg-btn" data-active={!eyeCareMode ? "true" : "false"} onClick={() => setEyeCareMode(false)}>
            <Sun size={15} /> Aus
          </button>
          <button className="seg-btn" data-active={eyeCareMode ? "true" : "false"} onClick={() => setEyeCareMode(true)}>
            <Eye size={15} /> Ein
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">Stufen (Leicht / Mittel / Stark) sind später ergänzbar.</p>
      </div>

      {/* 3b) Kompaktmodus (kleiner Bildschirm / Laptop) */}
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Kompaktmodus</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Dichtere Darstellung mit weniger Abständen und kompakterer Toolbar – ideal für kleine Bildschirme/Laptops,
          damit Navigation, Werkzeugleiste, Positionsbereich und rechte Seitenleiste im Dokumenteditor lesbar bleiben.
        </p>
        <div className="seg w-fit">
          <button className="seg-btn" data-active={!compactMode ? "true" : "false"} onClick={() => setCompactMode(false)}>
            <Maximize2 size={15} /> Normal
          </button>
          <button className="seg-btn" data-active={compactMode ? "true" : "false"} onClick={() => setCompactMode(true)}>
            <Minimize2 size={15} /> Kompakt
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">Auf schmalen Breiten greift die kompakte Darstellung im Dokumenteditor zusätzlich automatisch.</p>
      </div>

      {/* 4) Live-Vorschau */}
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Vorschau</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          So wirken Modus, Farbschema und Augenschon zusammen.
        </p>
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          {/* Beispiel-Sidebar */}
          <div className="rounded-2xl border p-3" style={{ background: "var(--color-sidebar-bg)", borderColor: "var(--color-card-border)" }}>
            <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text2)" }}>Sidebar</div>
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white" style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}>
              <Palette size={16} /> Aktiver Eintrag
            </div>
            <div className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium" style={{ color: "var(--text2)" }}>
              <Hash size={16} /> Inaktiv
            </div>
          </div>

          {/* Beispiel-Karte mit Button, Tab, Badges */}
          <div className="rounded-2xl border p-5" style={{ background: "var(--color-card-bg)", borderColor: "var(--color-card-border)" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold" style={{ color: "var(--text)" }}>Beispiel-Karte</h3>
              <div className="flex gap-1.5">
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Akzent</span>
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "color-mix(in srgb,var(--color-success) 18%,transparent)", color: "var(--color-success)" }}>Erfolg</span>
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "color-mix(in srgb,var(--color-danger) 18%,transparent)", color: "var(--color-danger)" }}>Gefahr</span>
              </div>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--text2)" }}>
              Karten und große Flächen bleiben neutral; die Akzentfarbe erscheint nur dezent.
            </p>

            {/* Beispiel-Tabs */}
            <div className="mt-4 flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="-mb-px border-b-2 px-3 pb-2 text-sm font-semibold" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Aktiver Tab</div>
              <div className="px-3 pb-2 text-sm font-medium" style={{ color: "var(--text2)" }}>Anderer Tab</div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn-primary">Primäre Aktion</button>
              <button className="btn-outline">Sekundär</button>
              <input className="input max-w-[180px]" placeholder="Fokus-Test (klick rein)" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
