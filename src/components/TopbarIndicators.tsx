// ============================================================
// B4Y SuperAPP – Topbar-Indikatoren: Benachrichtigungen / Aufgaben / Mails
// ------------------------------------------------------------
// Ersetzt die frühere funktionslose Glocke (mit Fake-Badge „3").
// Alle Zähler sind DATENBASIERT – gibt es (noch) keine Daten oder
// keine Verbindung, zeigen die Panels einen erklärten Leerzustand.
//
// Quellen (bestehende Logik, nichts Neues erfunden):
//  - Aufgaben:            Tabelle `tasks` (done=false), RLS/Org serverseitig.
//  - Neue Mails:          Microsoft-Graph-Inbox über useMailList/useMicrosoftConnection
//                         (ungelesene der zuletzt geladenen Seite; ohne Verbindung
//                         erklärter Zustand mit Link zur E-Mail-Seite).
//  - Benachrichtigungen:  Projekt-Logbuch-Einträge der Automationen
//                         (project_log, kind='automation' – dort landet
//                         create_notification & Co., siehe lib/automations.ts).
//                         Keine eigene Notification-Tabelle nötig.
//
// Rechte: Indikatoren erscheinen nur mit passendem Modulrecht
// (usePermissions); RLS filtert serverseitig zusätzlich.
// Bedienung: Klick öffnet Panel, ESC/Klick außerhalb schließt.
// ============================================================
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ListTodo, Mail, Zap } from "lucide-react";
import { supabase } from "../lib/supabase";
import { usePermissions } from "../lib/permissions";
import { useMicrosoftConnection } from "../hooks/useMicrosoftConnection";
import { useMailList } from "../hooks/useMicrosoftMail";
import { dateAt } from "../lib/format";

type OpenTask = {
  id: string;
  title: string;
  due_date: string | null;
  priority: string | null;
  project_id: string | null;
};

type AutoLogEntry = {
  id: string;
  entry: string;
  created_at: string;
  project_id: string;
};

const badgeText = (n: number) => (n > 9 ? "9+" : String(n));

// ── Gemeinsames Popover (Panel + Overlay, ESC/Klick außerhalb schließt) ──
function IndicatorButton({
  icon, title, badge, dot, open, onToggle, children,
}: {
  icon: React.ReactNode;
  title: string;
  /** Zahl > 0 → rotes Zähler-Badge; 0/undefined → kein Badge */
  badge?: number;
  /** dezenter Punkt statt Zahl (z. B. „es gibt neue Einträge") */
  dot?: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onToggle(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onToggle]);
  return (
    <div className="relative">
      <button className="btn-ghost relative px-2.5" title={title} aria-label={title}
        aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}>
        {icon}
        {badge ? (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-bold leading-none text-white">
            {badgeText(badge)}
          </span>
        ) : dot ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
        ) : null}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div className="glass absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-1.5rem)] p-2" role="dialog" aria-label={title}>
            {children}
          </div>
        </>
      )}
    </div>
  );
}

const PanelHead = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text2)" }}>{children}</div>
);
const PanelEmpty = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2 pb-2 pt-1 text-sm text-slate-400">{children}</div>
);

export default function TopbarIndicators() {
  const { can, isAdmin } = usePermissions();
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState<"" | "bell" | "tasks" | "mail">("");
  const toggle = (k: "bell" | "tasks" | "mail") => setOpen((o) => (o === k ? "" : k));
  const close = () => setOpen("");

  const mayTasks = isAdmin || can("tasks", "view");
  const mayMail = isAdmin || can("email", "view");
  // Benachrichtigungen speisen sich aus dem Projekt-Logbuch (Automationen).
  const mayBell = isAdmin || can("projects", "view");

  // ── Aufgaben: offene Tasks (Zähler leichtgewichtig je Navigation) ──
  const [taskCount, setTaskCount] = useState(0);
  const [tasks, setTasks] = useState<OpenTask[]>([]);
  useEffect(() => {
    if (!mayTasks) return;
    let cancelled = false;
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("done", false)
      .then(({ count }) => { if (!cancelled) setTaskCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [mayTasks, location.pathname]);
  useEffect(() => {
    if (open !== "tasks" || !mayTasks) return;
    let cancelled = false;
    supabase.from("tasks").select("id,title,due_date,priority,project_id").eq("done", false)
      .order("due_date", { ascending: true, nullsFirst: false }).limit(6)
      .then(({ data }) => { if (!cancelled) setTasks((data as OpenTask[]) ?? []); });
    return () => { cancelled = true; };
  }, [open, mayTasks]);

  // ── Mails: Microsoft-Verbindung + ungelesene der Inbox ──
  const ms = useMicrosoftConnection();
  const mailEnabled = mayMail && ms.connected;
  const { messages: inbox } = useMailList({ folder: "inbox", enabled: mailEnabled });
  const unread = inbox.filter((m) => !m.isRead);

  // ── Benachrichtigungen: Automationen-Meldungen aus dem Projekt-Logbuch ──
  const [notes, setNotes] = useState<AutoLogEntry[]>([]);
  const [noteProjects, setNoteProjects] = useState<Record<string, string>>({});
  const [hasRecentNote, setHasRecentNote] = useState(false);
  useEffect(() => {
    if (!mayBell) return;
    let cancelled = false;
    supabase.from("project_log").select("id,entry,created_at,project_id")
      .eq("kind", "automation").order("created_at", { ascending: false }).limit(8)
      .then(async ({ data }) => {
        if (cancelled) return;
        const rows = (data as AutoLogEntry[]) ?? [];
        setNotes(rows);
        setHasRecentNote(rows.some((r) => Date.now() - new Date(r.created_at).getTime() < 24 * 3600_000));
        const ids = Array.from(new Set(rows.map((r) => r.project_id).filter(Boolean)));
        if (ids.length) {
          const { data: projs } = await supabase.from("projects").select("id,title,project_number").in("id", ids);
          if (cancelled) return;
          const m: Record<string, string> = {};
          for (const p of (projs as { id: string; title: string; project_number: string | null }[]) ?? []) {
            m[p.id] = p.project_number ? `${p.project_number} · ${p.title}` : p.title;
          }
          setNoteProjects(m);
        }
      });
    return () => { cancelled = true; };
  }, [mayBell, location.pathname]);

  const overdue = (d: string | null) => !!d && new Date(d) < new Date(new Date().toDateString());

  return (
    <>
      {mayBell && (
        <IndicatorButton icon={<Bell size={18} />} title="Benachrichtigungen" dot={hasRecentNote}
          open={open === "bell"} onToggle={() => toggle("bell")}>
          <PanelHead>Benachrichtigungen</PanelHead>
          {notes.length === 0 ? (
            <PanelEmpty>
              Keine Benachrichtigungen. Automationen erzeugen hier Meldungen
              (z.&nbsp;B. bei Status­wechseln) – einstellbar unter „Automationen".
            </PanelEmpty>
          ) : (
            <div className="max-h-80 overflow-auto">
              {notes.map((n) => (
                <button key={n.id} className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--hover)]"
                  onClick={() => { close(); nav(`/projekte/${n.project_id}`); }}>
                  <div className="flex items-start gap-2">
                    <Zap size={13} className="mt-0.5 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-sm">{n.entry}</div>
                      <div className="text-[11px] text-slate-400">
                        {dateAt(n.created_at)}{noteProjects[n.project_id] ? ` · ${noteProjects[n.project_id]}` : ""}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {(isAdmin || can("automations", "view")) && (
            <button className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium transition hover:bg-[var(--hover)]"
              style={{ color: "var(--accent)" }}
              onClick={() => { close(); nav("/automationen"); }}>
              Automationen verwalten →
            </button>
          )}
        </IndicatorButton>
      )}

      {mayTasks && (
        <IndicatorButton icon={<ListTodo size={18} />} title="Aufgaben" badge={taskCount}
          open={open === "tasks"} onToggle={() => toggle("tasks")}>
          <PanelHead>Offene Aufgaben{taskCount ? ` (${taskCount})` : ""}</PanelHead>
          {tasks.length === 0 ? (
            <PanelEmpty>Keine offenen Aufgaben. Aufgaben entstehen in Projekten, Besprechungen und über Automationen.</PanelEmpty>
          ) : (
            <div className="max-h-80 overflow-auto">
              {tasks.map((t) => (
                <button key={t.id}
                  className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--hover)] disabled:cursor-default"
                  disabled={!t.project_id}
                  title={t.project_id ? "Zum Projekt" : undefined}
                  onClick={() => { if (t.project_id) { close(); nav(`/projekte/${t.project_id}`); } }}>
                  <div className="truncate text-sm">{t.title}</div>
                  <div className={`text-[11px] ${overdue(t.due_date) ? "font-medium text-rose-500" : "text-slate-400"}`}>
                    {t.due_date ? `Fällig ${dateAt(t.due_date)}${overdue(t.due_date) ? " · überfällig" : ""}` : "Ohne Termin"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </IndicatorButton>
      )}

      {mayMail && (
        <IndicatorButton icon={<Mail size={18} />} title="Neue E-Mails" badge={mailEnabled ? unread.length : 0}
          open={open === "mail"} onToggle={() => toggle("mail")}>
          <PanelHead>Neue E-Mails{mailEnabled && unread.length ? ` (${unread.length})` : ""}</PanelHead>
          {!ms.connected ? (
            <PanelEmpty>
              Kein Microsoft-365-Konto verbunden – ohne Verbindung gibt es hier keine Mail-Zähler.
              Verbinden auf der E-Mail-Seite.
            </PanelEmpty>
          ) : unread.length === 0 ? (
            <PanelEmpty>Keine ungelesenen E-Mails im Posteingang.</PanelEmpty>
          ) : (
            <div className="max-h-80 overflow-auto">
              {unread.slice(0, 6).map((m) => (
                <button key={m.id} className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--hover)]"
                  onClick={() => { close(); nav("/email"); }}>
                  <div className="truncate text-sm font-medium">{m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Unbekannt"}</div>
                  <div className="truncate text-xs text-slate-400">{m.subject || "(kein Betreff)"}</div>
                </button>
              ))}
            </div>
          )}
          <button className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium transition hover:bg-[var(--hover)]"
            style={{ color: "var(--accent)" }}
            onClick={() => { close(); nav("/email"); }}>
            Zur E-Mail-Seite →
          </button>
        </IndicatorButton>
      )}
    </>
  );
}
