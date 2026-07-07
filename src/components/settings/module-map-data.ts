// ============================================================================
// B4Y SuperAPP – Modulmap / Systemkarte: Datenquelle
// ----------------------------------------------------------------------------
// READ-ONLY Systemübersicht (keine DB, keine produktiven Daten). Diese Datei ist
// die EINZIGE Pflegestelle für die in der Modulmap dargestellten Module und ihre
// Zusammenhänge. Die Visualisierung (ModuleMap.tsx) berechnet Layout/Look daraus.
//
// Pflege:
//  - Neues Modul  → Eintrag in MODULE_MAP_NODES (id eindeutig, group/level/status).
//  - Untermodul   → `parent` auf das übergeordnete Modul setzen (level 2/3).
//  - Beziehung    → Eintrag in MODULE_MAP_EDGES (sachliche Verbindung, kind).
//  Eltern-Kind-Verbindungen ergeben sich automatisch aus `parent` (nicht in EDGES
//  doppeln). EDGES enthält die fachlichen Quer-/Flussbeziehungen.
//
// Wichtig: Status ehrlich halten (produktiv | vorbereitet | geplant) – passend zum
// echten Code. Keine BAU4YOU-Hardcodierung als „so muss es sein" (nur Produktkontext).
// ============================================================================

export type ModuleStatus = "produktiv" | "vorbereitet" | "geplant";

export type ModuleGroupKey =
  | "projektfluss"
  | "finanzen"
  | "stammdaten"
  | "betrieb"
  | "rechte"
  | "ki"
  | "einstellungen";

export type EdgeKind = "flow" | "rechte" | "ki" | "link";

export type ModuleNode = {
  /** eindeutiger Schlüssel (kebab-case) */
  id: string;
  label: string;
  group: ModuleGroupKey;
  /** 1 = Hauptmodul, 2 = Untermodul, 3 = Unter-Untermodul */
  level: 1 | 2 | 3;
  /** id des übergeordneten Knotens (für Layout + Eltern-Kind-Linie) */
  parent?: string;
  status: ModuleStatus;
  /** kurzer Zweck (Detailpanel) */
  purpose: string;
  /** wichtige Unterfunktionen (Detailpanel) */
  subfunctions?: string[];
  /** relevantes Rechte-/Permission-Modul (soweit bekannt) */
  rights?: string;
  /** App-Route zum Öffnen (read-only Navigation), soweit sinnvoll */
  route?: string;
};

export type ModuleEdge = {
  from: string;
  to: string;
  kind: EdgeKind;
};

export type GroupMeta = { key: ModuleGroupKey; label: string; color: string };

/** Gruppen + Farben (auf dunklem „Space"-Grund gut unterscheidbar). */
export const MODULE_GROUPS: GroupMeta[] = [
  { key: "projektfluss",  label: "Projektfluss",        color: "#ff6b5e" },
  { key: "finanzen",      label: "Finanzen",            color: "#f6c453" },
  { key: "stammdaten",    label: "Stammdaten",          color: "#34d399" },
  { key: "betrieb",       label: "Betrieb & Steuerung", color: "#5aa9ff" },
  { key: "rechte",        label: "Rechte & Sicherheit", color: "#c084fc" },
  { key: "ki",            label: "KI & Sprache",        color: "#22d3ee" },
  { key: "einstellungen", label: "Einstellungen",       color: "#94a3b8" },
];

export const GROUP_BY_KEY: Record<ModuleGroupKey, GroupMeta> = MODULE_GROUPS.reduce(
  (acc, g) => { acc[g.key] = g; return acc; },
  {} as Record<ModuleGroupKey, GroupMeta>,
);

/**
 * Prozess-Spalten (Swimlanes) der Systemkarte, links → rechts als logischer Workflow.
 * Jede Lane = eine Gruppe; die Modulmap ordnet Knoten anhand ihrer `group` einer Spalte zu.
 * Reihenfolge = Lesefluss: Stammdaten → Projekt/Dokumente → Finanzen, dann Support-Spalten.
 * Mandantenneutral, hier pflegen (keine Layout-Hardcodes in ModuleMap.tsx).
 */
export const MODULE_MAP_LANES: { key: ModuleGroupKey; title: string }[] = [
  { key: "stammdaten",    title: "Stammdaten" },
  { key: "projektfluss",  title: "Projekt & Dokumente" },
  { key: "finanzen",      title: "Finanzen & Abschluss" },
  { key: "betrieb",       title: "Betrieb & Steuerung" },
  { key: "ki",            title: "KI & Sprache" },
  { key: "rechte",        title: "Rechte & Sicherheit" },
  { key: "einstellungen", title: "Einstellungen" },
];

export const STATUS_META: Record<ModuleStatus, { label: string; color: string }> = {
  produktiv:   { label: "produktiv",   color: "#34d399" },
  vorbereitet: { label: "vorbereitet", color: "#f6c453" },
  geplant:     { label: "geplant",     color: "#94a3b8" },
};

// ----------------------------------------------------------------------------
// Knoten
// ----------------------------------------------------------------------------
export const MODULE_MAP_NODES: ModuleNode[] = [
  // ── Betrieb & Steuerung ───────────────────────────────────────────────────
  {
    id: "dashboard", label: "Übersicht / Dashboard", group: "betrieb", level: 1,
    status: "produktiv", rights: "dashboard", route: "/",
    purpose: "Tageszentrale mit Live-Kennzahlen, Aufgaben, Terminen, Umsatzverlauf und Bauwetter.",
    subfunctions: ["KPI-Karten", "Aufgaben heute", "12-Monats-Umsatz", "Bauwetter (Open-Meteo)"],
  },
  {
    id: "cockpit", label: "Cockpit (Leitstand)", group: "betrieb", level: 1,
    status: "produktiv", route: "/cockpit",
    purpose: "Admin-Leitstand: firmenweite KPIs, Angebots-Pipeline, Mitarbeiter-Einteilung, Automationen.",
    subfunctions: ["Pipeline", "Einteilung heute", "Schnell-Aufgaben", "Automations-Überblick"],
  },
  {
    id: "planung", label: "Planung", group: "betrieb", level: 1,
    status: "produktiv", rights: "plantafel", route: "/planung",
    purpose: "Termine, Ressourcen und Abwesenheiten mit Konfliktprüfung (Wochen-Plantafel & Monat).",
    subfunctions: ["Wochen-Plantafel", "Konfliktprüfung", "Abwesenheiten", "Ressourcen", "iCal-Export", "KI-Wochenanalyse"],
  },
  {
    id: "automationen", label: "Automationen", group: "betrieb", level: 1,
    status: "produktiv", rights: "automations", route: "/automationen",
    purpose: "Regeln bei Projektstatuswechsel: Aufgaben, Checklisten, Termine, Logbuch & E-Mail-Entwürfe.",
    subfunctions: ["Trigger: Projektstatus", "Bedingungen", "Duplizierungsschutz", "Test-/Simulationsmodus", "Protokoll"],
  },
  {
    id: "email", label: "E-Mail", group: "betrieb", level: 1,
    status: "vorbereitet", rights: "email", route: "/email",
    purpose: "Outlook-ähnliche Oberfläche – aktuell Vorschau/Demo; echte Microsoft-365-Anbindung & Versand folgen.",
    subfunctions: ["Postfächer/Ordner (Demo)", "Lesen & Kategorien", "Antwort-Entwürfe (kein Versand)"],
  },

  // ── Stammdaten ────────────────────────────────────────────────────────────
  {
    id: "kontakte", label: "Kontakte", group: "stammdaten", level: 1,
    status: "produktiv", rights: "contacts", route: "/kontakte",
    purpose: "Kunden, Lieferanten und Subunternehmer mit Ansprechpartnern und eigenen Konditionen.",
    subfunctions: ["Ansprechpersonen", "Konditionen (Skonto/Ziel)", "Adress-Autovervollständigung (AT)"],
  },
  {
    id: "kalkulation", label: "Kalkulation", group: "stammdaten", level: 1,
    status: "produktiv", rights: "kalkulation", route: "/kalkulation",
    purpose: "Preis-Basis aller Angebote: Stammdaten, zusammengesetzte Leistungen, Margen.",
    subfunctions: ["Gewerke", "Einheiten", "Stundensätze", "Artikel", "Leistungen", "Titel", "Textbausteine"],
  },
  { id: "k-gewerke",      label: "Gewerke",      group: "stammdaten", level: 2, parent: "kalkulation", status: "produktiv", route: "/kalkulation/gewerke",      purpose: "Gliederung in Gewerke mit automatischer Nummerierung." },
  { id: "k-einheiten",    label: "Einheiten",    group: "stammdaten", level: 2, parent: "kalkulation", status: "produktiv", route: "/kalkulation/einheiten",    purpose: "Maßeinheiten mit Verwendungsprüfung." },
  { id: "k-stundensaetze",label: "Stundensätze", group: "stammdaten", level: 2, parent: "kalkulation", status: "produktiv", route: "/kalkulation/stundensaetze", purpose: "Interne/Verkaufs-Sätze je Gewerk inkl. Marge." },
  { id: "k-artikel",      label: "Artikel",      group: "stammdaten", level: 2, parent: "kalkulation", status: "produktiv", route: "/kalkulation/artikel",      purpose: "Material-Stammdaten mit Bildern und CSV-Im-/Export." },
  { id: "k-leistungen",   label: "Leistungen",   group: "stammdaten", level: 2, parent: "kalkulation", status: "produktiv", route: "/kalkulation/leistungen",   purpose: "Zusammengesetzte Leistungen (Arbeit + Material + Pauschalen).",
    subfunctions: ["Arbeitszeit", "Material", "Pauschalen"] },
  { id: "k-arbeit",       label: "Arbeitszeit",  group: "stammdaten", level: 3, parent: "k-leistungen", status: "produktiv", purpose: "Arbeitszeit-Komponente einer Leistung." },
  { id: "k-material",     label: "Material",     group: "stammdaten", level: 3, parent: "k-leistungen", status: "produktiv", purpose: "Material-/Artikel-Komponente einer Leistung." },
  { id: "k-pauschalen",   label: "Pauschalen",   group: "stammdaten", level: 3, parent: "k-leistungen", status: "produktiv", purpose: "Fixe oder prozentuale Pauschalen." },
  { id: "k-titel",        label: "Titel",        group: "stammdaten", level: 2, parent: "kalkulation", status: "produktiv", route: "/kalkulation/titel",        purpose: "Wiederverwendbare Abschnitts-Überschriften." },
  { id: "textbausteine",  label: "Textbausteine",group: "stammdaten", level: 2, parent: "kalkulation", status: "produktiv", route: "/kalkulation/texte",
    purpose: "Vor-/Nachtexte, Rechtstexte & Platzhalter – fließen in Dokumente und Mailvorlagen.",
    subfunctions: ["Vor-/Nachtexte", "Platzhalter", "Standardtexte je Dokumentart"] },

  {
    id: "mitarbeiter", label: "Mitarbeiter", group: "stammdaten", level: 1,
    status: "produktiv", rights: "employees", route: "/mitarbeiter",
    purpose: "Personalstammdaten, Arbeitszeitmodelle, Signaturen und App-Einladung.",
    subfunctions: ["Stammdaten", "Arbeitszeitmodell", "Rollenzuweisung", "Signaturen"],
  },
  { id: "ma-rollen",     label: "Rollenzuweisung", group: "stammdaten", level: 2, parent: "mitarbeiter", status: "produktiv", purpose: "Genau eine Rolle je Mitarbeiter (RBAC)." },
  { id: "ma-arbeitszeit",label: "Arbeitszeit",     group: "stammdaten", level: 2, parent: "mitarbeiter", status: "produktiv", purpose: "Arbeitszeitmodell/Override je Mitarbeiter (Basis für Planung & Soll)." },
  { id: "ma-signaturen", label: "Signaturen",      group: "stammdaten", level: 2, parent: "mitarbeiter", status: "produktiv", purpose: "E-Mail- und Dokument-Signatur (mit Firmen-Fallback)." },

  // ── Projektfluss ──────────────────────────────────────────────────────────
  {
    id: "projekte", label: "Projekte / Projektakte", group: "projektfluss", level: 1,
    status: "produktiv", rights: "projects", route: "/projekte",
    purpose: "Zentrale Projektakte mit Logbuch, Medien, Terminen, Aufgaben und Beteiligten.",
    subfunctions: ["Logbuch", "Medien", "Termine", "Aufgaben", "Checklisten", "Baubesprechungen", "Beteiligte"],
  },
  { id: "p-logbuch",    label: "Logbuch",        group: "projektfluss", level: 2, parent: "projekte", status: "produktiv", purpose: "Chronologisches Audit-Log aller Projektaktionen." },
  { id: "p-medien",     label: "Medien",         group: "projektfluss", level: 2, parent: "projekte", status: "produktiv", purpose: "Fotos & Dokumente je Projekt (Upload/Galerie/Archiv)." },
  { id: "p-termine",    label: "Termine",        group: "projektfluss", level: 2, parent: "projekte", status: "produktiv", purpose: "Projektbezogene Termine (auch in der Planung)." },
  { id: "p-beteiligte", label: "Beteiligte",     group: "projektfluss", level: 2, parent: "projekte", status: "produktiv", purpose: "Personen/Firmen mit Rolle am Projekt." },

  {
    id: "dokumente", label: "Dokumente", group: "projektfluss", level: 1,
    status: "produktiv", rights: "documents", route: "/dokumente",
    purpose: "Zentrale, projektübergreifende Dokument-Engine mit Filtern, Suche und Export.",
    subfunctions: ["Dokumentketten", "PDF-Engine", "Versionierung", "Audit-Log"],
  },
  { id: "dokumentketten", label: "Dokumentketten", group: "projektfluss", level: 2, parent: "dokumente", status: "produktiv", purpose: "Angebot → Auftrag → Rechnung mit Positionsauswahl & Snapshot-Prinzip." },
  { id: "pdf-engine",     label: "PDF-Engine",     group: "projektfluss", level: 2, parent: "dokumente", status: "produktiv", purpose: "Eine Quelle für Vorschau/Druck/Download – druckfertiges A4-PDF." },
  { id: "versionierung",  label: "Versionierung",  group: "projektfluss", level: 2, parent: "dokumente", status: "produktiv", purpose: "Revisionssichere finale Versionen je Dokument.",
    subfunctions: ["PDF-Snapshot", "Audit-Log"] },
  { id: "pdf-snapshot",   label: "PDF-Snapshot",   group: "projektfluss", level: 3, parent: "versionierung", status: "produktiv", purpose: "Unveränderlicher Druckstand je finaler Version." },
  { id: "audit-log",      label: "Audit-Log",      group: "projektfluss", level: 3, parent: "versionierung", status: "produktiv", purpose: "Wer/wann/was je Dokumentänderung." },

  {
    id: "angebote", label: "Angebote", group: "projektfluss", level: 1,
    status: "produktiv", rights: "offers", route: "/dokumente?typ=angebote",
    purpose: "Angebote (Standard/Pauschal/Regie) mit Positions-Editor, Varianten und Nachträgen.",
    subfunctions: ["Positions-Editor", "Varianten", "Nachträge", "Sprach-/KI-Angebot"],
  },
  { id: "nachtraege", label: "Nachträge", group: "projektfluss", level: 2, parent: "angebote", status: "produktiv", purpose: "Angebots-Nachträge mit Übernahme in bestehende Aufträge." },

  {
    id: "auftraege", label: "Aufträge", group: "projektfluss", level: 1,
    status: "produktiv", rights: "orders", route: "/dokumente?typ=auftraege",
    purpose: "Aufträge aus Angeboten, Verrechnungsstatus, Überführung in Rechnungen.",
    subfunctions: ["Aus Angebot(en)", "Verrechnungsstatus", "Storno/Archiv"],
  },
  {
    id: "sub-auftraege", label: "SUB-Aufträge", group: "projektfluss", level: 1,
    status: "produktiv", rights: "orders",
    purpose: "Subunternehmer-Vergabe mit interner Marge, Übervergabe-Schutz und eigenem SUB-PDF.",
    subfunctions: ["Marge (intern)", "Übervergabe-Schutz", "SUB-PDF ohne Kundenpreise", "Signatur-Quelle"],
  },
  {
    id: "rechnungen", label: "Rechnungen", group: "finanzen", level: 1,
    status: "produktiv", rights: "invoices", route: "/dokumente?typ=rechnungen",
    purpose: "AT-konforme Rechnungen (§ 11 / § 19 UStG), Teil-/Schlussrechnung, Skonto, Storno.",
    subfunctions: ["§ 11 UStG", "§ 19 Reverse Charge", "Skonto/Fälligkeit", "Überverrechnungsschutz"],
  },

  // ── Finanzen ────────────────────────────────────────────────────────────
  {
    id: "auswertungen", label: "Auswertungen", group: "finanzen", level: 1,
    status: "produktiv", rights: "analytics", route: "/auswertungen",
    purpose: "Kalkulations- & Angebotsauswertungen (Margen, Lagerwert, Pipeline). Projekt-Soll/Ist folgt.",
    subfunctions: ["Top-Leistungen/Margen", "Artikel-Lagerwert", "Angebots-Pipeline", "Umsatztrend"],
  },

  // ── Rechte & Sicherheit ─────────────────────────────────────────────────
  {
    id: "rechte", label: "Rechte & Rollen", group: "rechte", level: 1,
    status: "produktiv", rights: "settings.permissions", route: "/einstellungen?tab=zugriffsrechte",
    purpose: "Rollenbasierte Zugriffskontrolle (RBAC) – serverseitig per RLS über alle geschützten Module.",
    subfunctions: ["Rollen & Rechte", "Datenbereich-Scopes", "„Ansicht als“", "Audit-Protokoll"],
  },

  // ── KI & Sprache ──────────────────────────────────────────────────────────
  {
    id: "ki", label: "KI · Isabella", group: "ki", level: 1,
    status: "produktiv",
    purpose: "Sprach-/Text-Assistent: findet & öffnet Daten, navigiert, bereitet Dokumente vor (Vorschau + Bestätigung).",
    subfunctions: ["Sprache & Text (de-AT)", "Sprach-/KI-Angebot", "Schulungsmodus", "Vorschau + Bestätigung"],
  },
  { id: "ki-sprachangebot", label: "Sprach-/KI-Angebot", group: "ki", level: 2, parent: "ki", status: "produktiv", purpose: "Diktiertes Angebot → cent-genau kalkulierter Entwurf." },
  { id: "ki-schulung",      label: "Schulungsmodus",     group: "ki", level: 2, parent: "ki", status: "produktiv", purpose: "Geführte Touren mit virtuellem Cursor (keine Datenänderung ohne Bestätigung)." },

  // ── Einstellungen ───────────────────────────────────────────────────────
  {
    id: "einstellungen", label: "Einstellungen", group: "einstellungen", level: 1,
    status: "produktiv", route: "/einstellungen",
    purpose: "Konfigurationszentrale – so viel wie möglich ohne Code: Firma, Dokumentarten, Nummernkreise, Design …",
    subfunctions: ["Firma & Design", "Dokumentarten", "Nummernkreise", "Projekttypen/-status", "Kalender (BUAK)", "KI", "Rechte"],
  },
  { id: "s-firma",         label: "Firma & Design",   group: "einstellungen", level: 2, parent: "einstellungen", status: "produktiv", route: "/einstellungen?tab=firma",        purpose: "Firmendaten, Logo, Bank, Design (hell/dunkel, Akzentfarben)." },
  { id: "s-dokumentarten", label: "Dokumentarten",    group: "einstellungen", level: 2, parent: "einstellungen", status: "produktiv", route: "/einstellungen?tab=dokumentarten", purpose: "Dokumentarten/-untertypen & Versionierungs-Regeln je Typ." },
  { id: "s-nummernkreise", label: "Nummernkreise",    group: "einstellungen", level: 2, parent: "einstellungen", status: "produktiv", route: "/einstellungen?tab=nummernkreise", purpose: "Fortlaufende Belegnummern je Dokumentart/Kontaktart." },
  { id: "s-projekttypen",  label: "Projekttypen/-status", group: "einstellungen", level: 2, parent: "einstellungen", status: "produktiv", route: "/einstellungen?tab=projekttypen", purpose: "Projektarten und gültige Status je Typ." },
  { id: "s-kalender",      label: "Kalender (BUAK)",  group: "einstellungen", level: 2, parent: "einstellungen", status: "produktiv", route: "/einstellungen?tab=buak",         purpose: "Jahreskalender (Wochenarten) & Arbeitszeitmodelle." },
  { id: "s-ki",            label: "KI-Einstellungen", group: "einstellungen", level: 2, parent: "einstellungen", status: "produktiv", route: "/einstellungen?tab=ki",           purpose: "Konfiguration des KI-Assistenten." },
];

// ----------------------------------------------------------------------------
// Fachliche Quer-/Fluss-Verbindungen (Eltern-Kind ergibt sich aus `parent`).
//   kind: "flow"  = Geschäftsfluss (Projekt-/Dokumentkette)
//         "rechte"= Sicherheits-/Rechte-Schicht über geschützte Module
//         "ki"    = KI greift auf das Modul zu
//         "link"  = sonstige fachliche Verbindung
// ----------------------------------------------------------------------------
export const MODULE_MAP_EDGES: ModuleEdge[] = [
  // Projekt- & Dokumentfluss
  { from: "kontakte", to: "projekte", kind: "flow" },
  { from: "projekte", to: "dokumente", kind: "flow" },
  { from: "projekte", to: "angebote", kind: "flow" },
  { from: "angebote", to: "auftraege", kind: "flow" },
  { from: "auftraege", to: "sub-auftraege", kind: "flow" },
  { from: "auftraege", to: "rechnungen", kind: "flow" },
  { from: "dokumentketten", to: "angebote", kind: "flow" },
  { from: "dokumentketten", to: "auftraege", kind: "flow" },
  { from: "dokumentketten", to: "rechnungen", kind: "flow" },
  { from: "kalkulation", to: "angebote", kind: "flow" },
  { from: "rechnungen", to: "auswertungen", kind: "flow" },
  { from: "s-nummernkreise", to: "dokumente", kind: "link" },

  // Stammdaten/Texte → Dokumente & E-Mail
  { from: "textbausteine", to: "dokumente", kind: "link" },
  { from: "textbausteine", to: "email", kind: "link" },

  // Mitarbeiter → Planung / Rechte / Signaturen
  { from: "mitarbeiter", to: "planung", kind: "link" },
  { from: "ma-rollen", to: "rechte", kind: "link" },
  { from: "ma-signaturen", to: "dokumente", kind: "link" },

  // Automationen → Status / Aufgaben / Termine / E-Mail
  { from: "automationen", to: "s-projekttypen", kind: "link" },
  { from: "automationen", to: "p-termine", kind: "link" },
  { from: "automationen", to: "email", kind: "link" },

  // KI greift auf zentrale Module zu
  { from: "ki", to: "kalkulation", kind: "ki" },
  { from: "ki", to: "angebote", kind: "ki" },
  { from: "ki", to: "dokumente", kind: "ki" },
  { from: "ki", to: "planung", kind: "ki" },

  // Rechte/Sicherheit als verbindende Schicht über die geschützten Module
  { from: "rechte", to: "dashboard", kind: "rechte" },
  { from: "rechte", to: "projekte", kind: "rechte" },
  { from: "rechte", to: "kontakte", kind: "rechte" },
  { from: "rechte", to: "kalkulation", kind: "rechte" },
  { from: "rechte", to: "dokumente", kind: "rechte" },
  { from: "rechte", to: "angebote", kind: "rechte" },
  { from: "rechte", to: "auftraege", kind: "rechte" },
  { from: "rechte", to: "rechnungen", kind: "rechte" },
  { from: "rechte", to: "planung", kind: "rechte" },
  { from: "rechte", to: "mitarbeiter", kind: "rechte" },
  { from: "rechte", to: "automationen", kind: "rechte" },
  { from: "rechte", to: "email", kind: "rechte" },
  { from: "rechte", to: "auswertungen", kind: "rechte" },
  { from: "rechte", to: "einstellungen", kind: "rechte" },
];

// ----------------------------------------------------------------------------
// Fokus-Presets (Buttons): heben eine sinnvolle Teilmenge hervor.
// ----------------------------------------------------------------------------
export type FocusKey = "projektfluss" | "dokumentkette" | "rechte";
export const MODULE_MAP_FOCUS: { key: FocusKey; label: string; nodeIds: string[] }[] = [
  {
    key: "projektfluss", label: "Projektfluss",
    nodeIds: ["kontakte", "projekte", "dokumente", "angebote", "auftraege", "sub-auftraege", "rechnungen"],
  },
  {
    key: "dokumentkette", label: "Dokumentkette",
    nodeIds: ["angebote", "auftraege", "sub-auftraege", "rechnungen", "dokumente", "dokumentketten", "pdf-engine", "versionierung", "pdf-snapshot", "audit-log", "s-nummernkreise"],
  },
  {
    key: "rechte", label: "Rechte / Sicherheit",
    nodeIds: ["rechte", "dashboard", "projekte", "kontakte", "kalkulation", "dokumente", "angebote", "auftraege", "rechnungen", "planung", "mitarbeiter", "automationen", "email", "auswertungen", "einstellungen"],
  },
];
