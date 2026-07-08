// ============================================================
// B4Y SuperAPP – Anfragen-Liste (Posteingang)
// ------------------------------------------------------------
// Zeigt alle eingehenden Anliegen aus den Quellen "phone_fonio" (Fonio-
// KI-Telefonassistent) und "manual" (in der UI erfasst). Backend-Endpunkte:
//   GET  /api/anfragen/list     – RLS-isolierte Liste
//   POST /api/anfragen/create   – manuelle Anlage
// Wrapper-Funktionen: src/lib/anfragen.ts (listAnfragen, createAnfrageManual).
//
// UI-Aufbau:
//   • Header mit "+ Anfrage erfassen"
//   • Tab-Bar: Alle Anrufe | Neue Anfragen | In Arbeit | Konvertiert | Spam/Info
//   • Filter-Bar (Quelle/Suche/Datum) + "Aktualisieren"
//   • Tabelle mit sticky Header (10/Seite); Klick → /anfragen/:id
//   • Manuell-Erfassen-Modal (Pflicht: subject)
//   • Auto-Refresh alle 30 s in Tabs "Alle Anrufe" / "Neue Anfragen"
//   • URL-synced Filter (useSearchParams) – Refresh + Back-Button
//   • md:↓ kollabiert die Tabelle in eine Karten-Liste
//
// Hinweis zu API-Filtern:
// Die List-API kennt aktuell nur einen sehr engen Whitelist-Block für
// `status` und `source` (z. B. NICHT "phone_fonio", "in_arbeit", "qualifiziert").
// Wir laden daher bewusst ohne API-seitige Quellen-/Status-Filter und filtern
// client-seitig – exakt das ist im List-Endpoint dokumentiert ("ALLE Fonio-
// Anrufe sichtbar, UI filtert nach status/classification"). Volltextsuche
// und Pagination laufen weiter über die API.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Inbox,
  Plus,
  Phone,
  RefreshCw,
  Search,
  AlertTriangle,
} from "lucide-react";
import {
  Spinner,
  Empty,
  Badge,
  Modal,
  TableCell,
} from "../components/ui";
import {
  listAnfragen,
  createAnfrageManual,
  type AnfrageRow,
  type AnfrageSource,
} from "../lib/anfragen";
import { toast, toastError, toastInfo } from "../lib/toast";
import { useNewAnfragenSubscription } from "../hooks/useNewAnfragenSubscription";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";
import { useAuth } from "../lib/auth";

// ── Konstanten ────────────────────────────────────────────────────────────
const PAGE_SIZE = 10;
// API liefert max 200/Request – für client-seitiges Tab-/Quelle-/Datum-Filtern
// laden wir bewusst eine "großzügige" Seite, damit die Tabellen-Pagination
// nicht durch unsichtbare Zeilen verzerrt wird. Wenn die Anfragen-Tabelle
// in einem Mandanten echte zehntausende Einträge erreicht, ziehen wir die
// Filter auf den Server – aktuell (Phase 1) ist das nicht der Fall.
const FETCH_LIMIT = 200;

type TabKey = "alle" | "neu" | "in_arbeit" | "konvertiert" | "spam_info";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "alle", label: "Alle Anrufe" },
  { key: "neu", label: "Neue Anfragen" },
  { key: "in_arbeit", label: "In Arbeit" },
  { key: "konvertiert", label: "Konvertiert" },
  { key: "spam_info", label: "Spam/Info" },
];

const SOURCE_LABEL: Record<string, string> = {
  phone_fonio: "Telefon",
  manual: "Manuell",
  website_form: "Website",
  email: "E-Mail",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  other: "Sonstige",
};

const SOURCE_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  phone_fonio: "blue",
  manual: "slate",
  website_form: "green",
  email: "amber",
  instagram: "amber",
  facebook: "amber",
  whatsapp: "green",
  other: "slate",
};

const STATUS_LABEL: Record<string, string> = {
  neu: "Neu",
  in_arbeit: "In Arbeit",
  qualifiziert: "Qualifiziert",
  kontakt_erstellt: "Konvertiert",
  abgewiesen: "Abgewiesen",
  archiviert: "Archiviert",
};

const STATUS_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  neu: "blue",
  in_arbeit: "amber",
  qualifiziert: "amber",
  kontakt_erstellt: "green",
  abgewiesen: "red",
  archiviert: "slate",
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  interessent: "Interessent",
  kunde_bestand: "Bestandskunde",
  spam: "Spam",
  termine_anfrage: "Terminanfrage",
  reklamation: "Reklamation",
  info_only: "Info",
  rueckruf_gewuenscht: "Rückruf",
  fehlanruf: "Fehlanruf",
  sonstiges: "Sonstiges",
};

const CLASSIFICATION_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  interessent: "blue",
  kunde_bestand: "green",
  spam: "red",
  termine_anfrage: "blue",
  reklamation: "amber",
  info_only: "slate",
  rueckruf_gewuenscht: "amber",
  fehlanruf: "slate",
  sonstiges: "slate",
};

// Datum-Format:
//   • Heute      → "Heute 14:23"
//   • Gestern    → "gestern 09:12"
//   • dieses Jahr → "23.11. 14:23"
//   • sonst      → "23.11.2024 14:23"
function formatRowDate(d: string | null | undefined): { primary: string; secondary: string } {
  if (!d) return { primary: "–", secondary: "" };
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return { primary: "–", secondary: "" };
  const time = new Intl.DateTimeFormat("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (diffDays === 0) return { primary: "Heute", secondary: time };
  if (diffDays === 1) return { primary: "gestern", secondary: time };
  if (date.getFullYear() === now.getFullYear()) {
    const md = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit" }).format(date);
    return { primary: md, secondary: time };
  }
  const dmy = new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  return { primary: dmy, secondary: time };
}

// "Telefon" mit klickbarem tel:-Link, ohne Row-Klick auszulösen.
function PhoneLink({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-slate-400">–</span>;
  return (
    <a
      href={`tel:${phone.replace(/\s+/g, "")}`}
      className="text-[var(--accent)] hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {phone}
    </a>
  );
}

// Zeigt einen Anrufer-Namen. Fallback: Telefonnummer, dann "Unbekannt".
function callerLabel(r: AnfrageRow): string {
  if (r.caller_name && r.caller_name.trim()) return r.caller_name;
  if (r.caller_phone && r.caller_phone.trim()) return r.caller_phone;
  if (r.caller_email && r.caller_email.trim()) return r.caller_email;
  return "Unbekannt";
}

// Tab-Filter (client-seitig). "Spam/Info" wertet ai_classification aus.
function matchesTab(r: AnfrageRow, tab: TabKey): boolean {
  switch (tab) {
    case "alle":
      return true;
    case "neu":
      return r.status === "neu";
    case "in_arbeit":
      return r.status === "in_arbeit" || r.status === "qualifiziert";
    case "konvertiert":
      return r.status === "kontakt_erstellt";
    case "spam_info":
      return r.ai_classification === "spam"
        || r.ai_classification === "info_only"
        || r.ai_classification === "fehlanruf";
    default:
      return true;
  }
}

// Yyyy-mm-dd Vergleich (Datumsfilter, ohne Zeit/TZ-Stolperfallen).
function dateInRange(iso: string, fromYmd: string, toYmd: string): boolean {
  if (!fromYmd && !toYmd) return true;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return true;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const ymd = `${y}-${m}-${day}`;
  if (fromYmd && ymd < fromYmd) return false;
  if (toYmd && ymd > toYmd) return false;
  return true;
}

// ── Manuell-Erfassen-Modal ───────────────────────────────────────────────
function ManualModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  // Beim Öffnen Felder zurücksetzen, damit nichts "klebt".
  useEffect(() => {
    if (!open) return;
    setName(""); setPhone(""); setEmail(""); setAddress("");
    setSubject(""); setDescription(""); setBusy(false);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = subject.trim();
    if (!s) {
      toastError("Betreff ist erforderlich.");
      return;
    }
    setBusy(true);
    try {
      await createAnfrageManual({
        subject: s,
        description: description.trim() || undefined,
        caller_name: name.trim() || undefined,
        caller_phone: phone.trim() || undefined,
        caller_email: email.trim() || undefined,
        caller_address: address.trim() || undefined,
      });
      toast("Anfrage erfasst.");
      onCreated();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler.";
      toastError(`Anfrage konnte nicht angelegt werden: ${msg}`);
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Anfrage erfassen" size="md">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-semibold">Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anrufer / Absender"
            maxLength={200}
            autoFocus
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-semibold">Telefon</span>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+43 ..."
            maxLength={60}
            inputMode="tel"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-semibold">E-Mail</span>
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@beispiel.at"
            maxLength={320}
            inputMode="email"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-semibold">Adresse / Firma</span>
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Optional"
            maxLength={400}
          />
        </label>
        <label className="flex flex-col text-sm sm:col-span-2">
          <span className="mb-1 font-semibold">
            Betreff <span className="text-rose-500">*</span>
          </span>
          <input
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Worum geht es?"
            maxLength={200}
            required
          />
        </label>
        <label className="flex flex-col text-sm sm:col-span-2">
          <span className="mb-1 font-semibold">Beschreibung</span>
          <textarea
            className="input min-h-[110px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notizen, Anliegen, Rückruf-Wunsch …"
            maxLength={4000}
          />
        </label>
        <div className="mt-2 flex items-center justify-end gap-2 sm:col-span-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Abbrechen
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Speichere …" : "Anfrage erfassen"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Tab-Bar (analog Contacts.tsx) ─────────────────────────────────────────
function TabBar({
  current,
  counts,
  onChange,
}: {
  current: TabKey;
  counts: Record<TabKey, number>;
  onChange: (t: TabKey) => void;
}) {
  return (
    <div
      className="mb-4 flex flex-wrap gap-1.5 rounded-2xl border p-1.5"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {TABS.map((t) => {
        const active = current === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
              active
                ? "text-white"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            }`}
            style={
              active
                ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }
                : undefined
            }
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 text-[11px] ${
                active ? "bg-white/20" : "bg-slate-200 dark:bg-white/10"
              }`}
            >
              {counts[t.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Filter-Bar (kompakt, eine Zeile) ──────────────────────────────────────
function FilterBar({
  source, setSource,
  search, setSearch,
  from, setFrom,
  to, setTo,
  onRefresh,
  refreshing,
}: {
  source: AnfrageSource | "";
  setSource: (v: AnfrageSource | "") => void;
  search: string;
  setSearch: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select
        className="input max-w-[12rem]"
        value={source}
        onChange={(e) => setSource(e.target.value as AnfrageSource | "")}
        title="Quelle filtern"
      >
        <option value="">Alle Quellen</option>
        <option value="phone_fonio">Telefon (Fonio)</option>
        <option value="manual">Manuell</option>
        <option value="website_form">Website</option>
        <option value="email">E-Mail</option>
      </select>

      <div className="relative w-full sm:w-[320px] lg:w-[420px]">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Suche: Betreff, Beschreibung, Anrufer, Telefon, E-Mail"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden sm:inline">von</span>
        <input
          type="date"
          className="input max-w-[10rem]"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          title="Datum von"
        />
        <span className="hidden sm:inline">bis</span>
        <input
          type="date"
          className="input max-w-[10rem]"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          title="Datum bis"
        />
      </div>

      <button
        type="button"
        className="btn-secondary"
        onClick={onRefresh}
        disabled={refreshing}
        title="Liste neu laden"
      >
        <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
        Aktualisieren
      </button>
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────────
export default function Anfragen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();

  // URL-synchronisierter State – damit Refresh + Back-Button funktionieren.
  const initialTab = ((): TabKey => {
    const t = sp.get("tab");
    return TABS.some((x) => x.key === t) ? (t as TabKey) : "alle";
  })();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [source, setSource] = useState<AnfrageSource | "">((sp.get("src") as AnfrageSource) || "");
  const [searchInput, setSearchInput] = useState(sp.get("q") ?? "");
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<AnfrageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Such-Eingabe debouncen, damit nicht jede Tastenbewegung ein Reload triggert.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // URL synchron halten (replace, damit Back nicht jede Tab-Klick-History sammelt).
  useEffect(() => {
    const next = new URLSearchParams(sp);
    tab !== "alle" ? next.set("tab", tab) : next.delete("tab");
    source ? next.set("src", source) : next.delete("src");
    search ? next.set("q", search) : next.delete("q");
    from ? next.set("from", from) : next.delete("from");
    to ? next.set("to", to) : next.delete("to");
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, source, search, from, to]);

  // Bei Filter-Wechsel auf Seite 1 zurück.
  useEffect(() => {
    setPage(0);
  }, [tab, source, search, from, to]);

  // ── Daten laden ────────────────────────────────────────────────────────
  // Aktuelle Request-Folge halten, damit veraltete Antworten überholt
  // werden (z. B. wenn die Suche schneller tippt als das Netzwerk antwortet).
  const reqRef = useRef(0);
  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      const reqId = ++reqRef.current;
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        // API-seitig laden wir bewusst NUR mit Volltextsuche; status/source
        // filtern wir client-seitig (siehe Datei-Kommentar oben).
        const r = await listAnfragen({ search: search || undefined, limit: FETCH_LIMIT, offset: 0 });
        if (reqId !== reqRef.current) return;
        // Defensive: bei unerwarteter Antwort (z. B. /api nicht erreichbar) niemals
        // rows auf undefined setzen – die Liste würde sonst beim Filtern abstürzen.
        if (Array.isArray(r?.rows)) {
          setRows(r.rows);
        } else {
          setRows([]);
          setError("Anfragen sind derzeit nicht verfügbar (API nicht erreichbar).");
        }
      } catch (e) {
        if (reqId !== reqRef.current) return;
        const msg = e instanceof Error ? e.message : "Anfragen konnten nicht geladen werden.";
        setError(msg);
      } finally {
        if (reqId === reqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [search],
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  // Auto-Refresh als Fallback alle 60 s — Supabase-Realtime erledigt den
  // Live-Push der neuen Anfragen; das Intervall faengt nur "Stale-Edits"
  // bei Updates ab (Status-Aenderung im Detail-Tab, KI-Klassifizierung).
  useEffect(() => {
    if (tab !== "alle" && tab !== "neu") return;
    const iv = window.setInterval(() => load("refresh"), 60_000);
    return () => window.clearInterval(iv);
  }, [tab, load]);

  // Realtime: neue Anfragen direkt prepended ohne Reload.
  const onNewAnfrage = useCallback((a: AnfrageRow) => {
    setRows((prev) => {
      if (prev.some((r) => r.id === a.id)) return prev;
      return [a, ...prev];
    });
    const who = a.caller_name?.trim() || a.caller_phone || "Unbekannt";
    toastInfo(`Neue Anfrage: ${who}`);
  }, []);
  useNewAnfragenSubscription(onNewAnfrage);

  // ── Client-seitige Filter ──────────────────────────────────────────────
  const filteredAll = useMemo(() => {
    return rows.filter((r) => {
      if (source && r.source !== source) return false;
      if (!dateInRange(r.created_at, from, to)) return false;
      return true;
    });
  }, [rows, source, from, to]);

  const counts = useMemo<Record<TabKey, number>>(() => {
    const acc: Record<TabKey, number> = {
      alle: 0, neu: 0, in_arbeit: 0, konvertiert: 0, spam_info: 0,
    };
    for (const r of filteredAll) {
      if (matchesTab(r, "alle")) acc.alle++;
      if (matchesTab(r, "neu")) acc.neu++;
      if (matchesTab(r, "in_arbeit")) acc.in_arbeit++;
      if (matchesTab(r, "konvertiert")) acc.konvertiert++;
      if (matchesTab(r, "spam_info")) acc.spam_info++;
    }
    return acc;
  }, [filteredAll]);

  const visible = useMemo(
    () => filteredAll.filter((r) => matchesTab(r, tab)),
    [filteredAll, tab],
  );

  // Sortierung wirkt auf die gefilterte Liste VOR der Pagination.
  const { session } = useAuth();
  const anfrageSort = useTableSort<AnfrageRow>(
    "anfragen",
    {
      date: { get: (r) => r.created_at, type: "date" },
      source: { get: (r) => SOURCE_LABEL[r.source] ?? r.source, type: "text" },
      caller: { get: (r) => { const n = callerLabel(r); return n === "Unbekannt" ? null : n; }, type: "text" },
      phone: { get: (r) => r.caller_phone, type: "text" },
      subject: { get: (r) => r.subject, type: "text" },
      status: { get: (r) => STATUS_LABEL[r.status] ?? r.status, type: "text" },
      ki: { get: (r) => (r.ai_classification ? CLASSIFICATION_LABEL[r.ai_classification] ?? r.ai_classification : null), type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "date", dir: "desc" } }
  );
  const visibleSorted = useMemo(() => anfrageSort.sortRows(visible), [anfrageSort, visible]);

  const totalPages = Math.max(1, Math.ceil(visibleSorted.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageRows = visibleSorted.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* Eigener Header-Block: PageHeader unterstützt aktuell nur string-titles,
          wir brauchen aber ein farbiges Inbox-Icon im Titel. */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Inbox size={22} style={{ color: "var(--accent)" }} />
            Anfragen
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Posteingang aus dem KI-Telefonagenten (Fonio) und manuell erfassten Anliegen
          </p>
        </div>
        <button className="btn-primary" onClick={() => setModalOpen(true)}>
          <Plus size={18} /> Anfrage erfassen
        </button>
      </div>

      <TabBar current={tab} counts={counts} onChange={setTab} />

      <FilterBar
        source={source}
        setSource={setSource}
        search={searchInput}
        setSearch={setSearchInput}
        from={from}
        setFrom={setFrom}
        to={to}
        setTo={setTo}
        onRefresh={() => load("refresh")}
        refreshing={refreshing}
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <div
          className="glass flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
          style={{ borderLeft: "3px solid var(--c-red, #e11d48)" }}
        >
          <AlertTriangle size={28} className="text-rose-500" />
          <div className="font-semibold">Anfragen konnten nicht geladen werden.</div>
          <div className="max-w-md text-sm text-slate-500 dark:text-slate-400">{error}</div>
          <button className="btn-secondary" onClick={() => load("initial")}>
            <RefreshCw size={16} /> Erneut versuchen
          </button>
        </div>
      ) : visible.length === 0 ? (
        <Empty
          title="Noch keine Anfragen."
          hint="Fonio-Anrufe und manuelle Anfragen erscheinen hier."
        />
      ) : (
        <>
          {/* Desktop-Tabelle */}
          <div className="glass hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <SortHeader label="Datum" sortKey="date" sort={anfrageSort.sort} onSort={anfrageSort.onSort} padClass="px-3 py-2" />
                    <SortHeader label="Quelle" sortKey="source" sort={anfrageSort.sort} onSort={anfrageSort.onSort} padClass="px-3 py-2" />
                    <SortHeader label="Anrufer" sortKey="caller" sort={anfrageSort.sort} onSort={anfrageSort.onSort} padClass="px-3 py-2" />
                    <SortHeader label="Telefon" sortKey="phone" sort={anfrageSort.sort} onSort={anfrageSort.onSort} padClass="px-3 py-2" />
                    <SortHeader label="Betreff" sortKey="subject" sort={anfrageSort.sort} onSort={anfrageSort.onSort} padClass="px-3 py-2" />
                    <SortHeader label="Status" sortKey="status" sort={anfrageSort.sort} onSort={anfrageSort.onSort} padClass="px-3 py-2" />
                    <SortHeader label="KI" sortKey="ki" sort={anfrageSort.sort} onSort={anfrageSort.onSort} padClass="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const d = formatRowDate(r.created_at);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => nav(`/anfragen/${r.id}`)}
                        className="cursor-pointer border-t hover:bg-[var(--hover)]"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div>{d.primary}</div>
                          {d.secondary && (
                            <div className="text-[11px] text-slate-400">{d.secondary}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={SOURCE_TONE[r.source] ?? "slate"}>
                            <span className="inline-flex items-center gap-1">
                              {r.source === "phone_fonio" && <Phone size={11} />}
                              {SOURCE_LABEL[r.source] ?? r.source}
                            </span>
                          </Badge>
                        </td>
                        <TableCell maxW="200px">{callerLabel(r)}</TableCell>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <PhoneLink phone={r.caller_phone} />
                        </td>
                        <TableCell maxW="320px">{r.subject || "(ohne Betreff)"}</TableCell>
                        <td className="px-3 py-2">
                          <Badge tone={STATUS_TONE[r.status] ?? "slate"}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {r.ai_classification ? (
                            <Badge tone={CLASSIFICATION_TONE[r.ai_classification] ?? "slate"}>
                              {CLASSIFICATION_LABEL[r.ai_classification] ?? r.ai_classification}
                            </Badge>
                          ) : (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile-Karten-Liste */}
          <div className="grid grid-cols-1 gap-2 md:hidden">
            {pageRows.map((r) => {
              const d = formatRowDate(r.created_at);
              return (
                <Link
                  key={r.id}
                  to={`/anfragen/${r.id}`}
                  className="glass block p-3 transition-colors hover:bg-[var(--hover)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {r.subject || "(ohne Betreff)"}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {callerLabel(r)}
                        {r.caller_phone ? ` · ${r.caller_phone}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-slate-400">
                      <div>{d.primary}</div>
                      {d.secondary && <div>{d.secondary}</div>}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={SOURCE_TONE[r.source] ?? "slate"}>
                      <span className="inline-flex items-center gap-1">
                        {r.source === "phone_fonio" && <Phone size={11} />}
                        {SOURCE_LABEL[r.source] ?? r.source}
                      </span>
                    </Badge>
                    <Badge tone={STATUS_TONE[r.status] ?? "slate"}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                    {r.ai_classification && (
                      <Badge tone={CLASSIFICATION_TONE[r.ai_classification] ?? "slate"}>
                        {CLASSIFICATION_LABEL[r.ai_classification] ?? r.ai_classification}
                      </Badge>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <div>
              {visible.length} Anfrage{visible.length === 1 ? "" : "n"}
              {rows.length >= FETCH_LIMIT && (
                <span className="ml-2 text-xs text-amber-500">
                  (Anzeige limitiert auf neueste {FETCH_LIMIT})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={pageSafe <= 0}
              >
                Zurück
              </button>
              <span>
                Seite {pageSafe + 1} von {totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={pageSafe >= totalPages - 1}
              >
                Weiter
              </button>
            </div>
          </div>
        </>
      )}

      <ManualModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => load("refresh")}
      />
    </>
  );
}
