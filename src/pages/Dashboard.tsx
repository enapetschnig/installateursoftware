import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FolderKanban, FileText, Receipt, CheckCircle2, Plus, Megaphone, UserPlus,
  TrendingUp, TrendingDown, Calendar, Clock, Building2, ArrowUpRight, ArrowRight,
  AlertTriangle, CalendarClock, Bell, ListChecks, MapPin, User, Inbox, Mail, Phone,
  Sparkles, type LucideIcon,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { AreaChart } from "../components/Charts";
import Weather from "../components/Weather";
import { Spinner, Badge, Tone } from "../components/ui";
import { Project, STAGES, stageTone } from "../lib/types";
import { eur } from "../lib/format";
import { fetchAppointments, materializeOccurrences, Appointment } from "../lib/appointments";

// Letzte 12 Monatsbuckets (älteste → aktuelle); summiert Rechnungs-Netto pro Monat (führende Kennzahl = netto).
function buildRevenue(rows: { net: number | null; invoice_date: string | null }[]): number[] {
  const now = new Date();
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { y: d.getFullYear(), m: d.getMonth(), sum: 0 };
  });
  for (const r of rows) {
    if (!r.invoice_date) continue;
    const d = new Date(r.invoice_date);
    const b = buckets.find((x) => x.y === d.getFullYear() && x.m === d.getMonth());
    if (b) b.sum += Number(r.net || 0);
  }
  return buckets.map((b) => b.sum);
}

type TaskRow = { id: string; title: string; due_date: string | null; priority: string | null; project_id: string | null };
type Reminder = { id: string; title: string; reminder_date: string | null; reminder_text: string | null };
type NewRequest = {
  id: string; source: string; subject: string | null; caller_name: string | null;
  ai_summary: string | null; ai_classification: string | null; ai_priority: string | null;
  created_at: string;
};

type DashData = {
  projectsActive: number; projectsRunning: number; projectsThisWeek: number;
  offersTotal: number; offersThisWeek: number;
  invoicesOpen: number; invoicesOverdue: number;
  tasksOpen: number; tasksOverdue: number;
  topProjects: Project[]; taskList: TaskRow[]; projTitle: Record<string, string>;
  reminders: Reminder[]; appts: Appointment[]; revenue: number[];
  newRequests: NewRequest[]; requestsNew: number;
  eingangOffen: number; eingangFaellig: number;
};

const EMPTY: DashData = {
  projectsActive: 0, projectsRunning: 0, projectsThisWeek: 0,
  offersTotal: 0, offersThisWeek: 0, invoicesOpen: 0, invoicesOverdue: 0,
  tasksOpen: 0, tasksOverdue: 0, topProjects: [], taskList: [], projTitle: {},
  reminders: [], appts: [], revenue: [], newRequests: [], requestsNew: 0,
  eingangOffen: 0, eingangFaellig: 0,
};

const REQ_SOURCE_ICON: Record<string, LucideIcon> = {
  email: Mail, phone_fonio: Phone, manual: User, website_form: Inbox,
};
const REQ_SOURCE_LABEL: Record<string, string> = {
  email: "E-Mail", phone_fonio: "Telefon", manual: "Manuell", website_form: "Website",
  instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", other: "Sonstige",
};
function reqPrioTone(p?: string | null): Tone {
  if (p === "hoch") return "red";
  if (p === "mittel") return "amber";
  return "slate";
}

function prioTone(p?: string | null): Tone {
  const s = (p ?? "").toLowerCase();
  if (s.includes("dring")) return "red";
  if (s.includes("hoch")) return "amber";
  return "slate";
}
function progressFor(stage: string): number {
  const i = STAGES.indexOf(stage as (typeof STAGES)[number]);
  if (i < 0) return 0;
  return Math.round(((i + 1) / STAGES.length) * 100);
}
const fmtDay = (d: string | Date) =>
  new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit" }).format(new Date(d));

export default function Dashboard() {
  const { profile, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<DashData>(EMPTY);
  const [clock, setClock] = useState(() => new Date());

  // Live-Uhrzeit (30-s-Takt reicht für HH:MM und vermeidet unnötige Re-Renders).
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const weekStart = (() => {
        const d = new Date(todayStart);
        const day = (d.getDay() + 6) % 7; // Montag = 0
        d.setDate(d.getDate() - day);
        return d;
      })();
      const todayDateStr = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, "0")}-${String(todayStart.getDate()).padStart(2, "0")}`;

      try {
        const [projRes, offRes, invRes, taskCntRes, taskOverdueRes, taskListRes] = await Promise.all([
          supabase.from("projects").select("*").eq("archived", false).order("created_at", { ascending: false }),
          supabase.from("offers").select("id,created_at,deleted_at"),
          supabase.from("invoices").select("net,gross,invoice_date,due_date,locked,payment_status,doc_status"),
          supabase.from("tasks").select("id", { count: "exact", head: true }).eq("done", false),
          supabase.from("tasks").select("id", { count: "exact", head: true }).eq("done", false).lt("due_date", todayDateStr),
          supabase.from("tasks").select("id,title,due_date,priority,project_id").eq("done", false)
            .lte("due_date", todayDateStr)
            .order("due_date", { ascending: true, nullsFirst: false }).limit(6),
        ]);

        const allProj = (projRes.data as Project[]) ?? [];
        const projTitle: Record<string, string> = {};
        for (const p of allProj) projTitle[p.id] = p.title;
        const isActiveStage = (s: string) => { const t = stageTone(s); return t !== "green" && t !== "red"; };
        const topProjects = allProj.filter((p) => isActiveStage(p.stage)).slice(0, 5);
        const reminders: Reminder[] = allProj
          .filter((p) => !p.reminder_done && p.reminder_date && p.reminder_date.slice(0, 10) <= todayDateStr)
          .sort((a, b) => (a.reminder_date! < b.reminder_date! ? -1 : 1))
          .slice(0, 4)
          .map((p) => ({ id: p.id, title: p.title, reminder_date: p.reminder_date, reminder_text: p.reminder_text }));

        const offers = (offRes.data as { created_at: string | null; deleted_at: string | null }[]) ?? [];
        const offersLive = offers.filter((o) => !o.deleted_at);
        const offersThisWeek = offersLive.filter((o) => o.created_at && new Date(o.created_at) >= weekStart).length;

        const inv = (invRes.data as { net: number | null; invoice_date: string | null; due_date: string | null; locked: boolean; payment_status: string; doc_status: string }[]) ?? [];
        const invoicesOpen = inv.filter((i) => i.doc_status !== "storniert" && i.payment_status !== "bezahlt").length;
        const invoicesOverdue = inv.filter((i) => i.doc_status !== "storniert" && i.locked && i.payment_status !== "bezahlt" && i.due_date && new Date(i.due_date) < todayStart).length;

        let appts: Appointment[] = [];
        try {
          const rows = await fetchAppointments({ to: todayEnd });
          appts = materializeOccurrences(rows, todayStart, todayEnd);
        } catch { /* Termine optional – leerer Block bei Fehler */ }

        // Neue Anfragen (smartes KI-Postfach) – optional, bricht das Dashboard
        // bei Fehler/RLS nicht ab.
        let newRequests: NewRequest[] = [];
        let requestsNew = 0;
        try {
          const [reqListRes, reqCntRes] = await Promise.all([
            supabase.from("anfragen")
              .select("id,source,subject,caller_name,ai_summary,ai_classification,ai_priority,created_at")
              .eq("status", "neu")
              .order("created_at", { ascending: false })
              .limit(5),
            supabase.from("anfragen").select("id", { count: "exact", head: true }).eq("status", "neu"),
          ]);
          newRequests = (reqListRes.data as NewRequest[]) ?? [];
          requestsNew = reqCntRes.count ?? 0;
        } catch { /* Anfragen optional */ }

        // Eingangsrechnungen (Buchhaltung) – offen/fällig, defensiv.
        let eingangOffen = 0;
        let eingangFaellig = 0;
        try {
          const [offenRes, faelligRes] = await Promise.all([
            supabase.from("eingangsrechnungen").select("id", { count: "exact", head: true })
              .in("status", ["offen", "geprueft", "freigegeben"]),
            supabase.from("eingangsrechnungen").select("id", { count: "exact", head: true })
              .in("status", ["offen", "geprueft", "freigegeben"]).lt("due_date", todayDateStr),
          ]);
          eingangOffen = offenRes.count ?? 0;
          eingangFaellig = faelligRes.count ?? 0;
        } catch { /* Buchhaltung optional */ }

        if (!alive) return;
        setData({
          projectsActive: allProj.length,
          projectsRunning: allProj.filter((p) => isActiveStage(p.stage)).length,
          projectsThisWeek: allProj.filter((p) => p.created_at && new Date(p.created_at) >= weekStart).length,
          offersTotal: offersLive.length,
          offersThisWeek,
          invoicesOpen,
          invoicesOverdue,
          tasksOpen: taskCntRes.count ?? 0,
          tasksOverdue: taskOverdueRes.count ?? 0,
          topProjects,
          taskList: (taskListRes.data as TaskRow[]) ?? [],
          projTitle,
          reminders,
          appts,
          revenue: buildRevenue(inv.map((i) => ({ net: i.net, invoice_date: i.invoice_date }))),
          newRequests,
          requestsNew,
          eingangOffen,
          eingangFaellig,
        });
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const monthRevenue = data.revenue.length ? data.revenue[data.revenue.length - 1] : 0;
  const prevRevenue = data.revenue.length > 1 ? data.revenue[data.revenue.length - 2] : 0;
  const revTrend = prevRevenue > 0 ? Math.round(((monthRevenue - prevRevenue) / prevRevenue) * 100) : null;
  const hasRevenue = data.revenue.some((v) => v > 0);
  const monthLabels = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      return new Intl.DateTimeFormat("de-AT", { month: "short" }).format(d).replace(".", "");
    });
  }, []);

  const hour = clock.getHours();
  const greet = hour < 11 ? "Guten Morgen" : hour < 18 ? "Schönen Tag" : "Guten Abend";
  const todayLong = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(clock);
  const timeStr = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" }).format(clock);
  const firstName = (profile?.name ?? session?.user.email ?? "").split(" ")[0].split("@")[0];

  const hints = data.invoicesOverdue + data.tasksOverdue;

  const kpis = [
    {
      to: "/projekte", label: "Projekte", value: data.projectsActive, desc: "Aktive Projekte",
      icon: FolderKanban, tone: "#ef4444",
      sub: data.projectsThisWeek > 0 ? `+${data.projectsThisWeek} diese Woche` : (data.projectsRunning > 0 ? `${data.projectsRunning} laufend` : null),
      subTone: (data.projectsThisWeek > 0 ? "green" : "slate") as Tone,
    },
    {
      to: "/angebote", label: "Angebote", value: data.offersTotal, desc: "Angebote gesamt",
      icon: FileText, tone: "#3b82f6",
      sub: data.offersThisWeek > 0 ? `+${data.offersThisWeek} diese Woche` : null,
      subTone: "blue" as Tone,
    },
    {
      to: "/rechnungen", label: "Offene Rechnungen", value: data.invoicesOpen, desc: "Noch nicht bezahlt",
      icon: Receipt, tone: "#f59e0b",
      sub: data.invoicesOverdue > 0 ? `${data.invoicesOverdue} überfällig` : (data.invoicesOpen > 0 ? "im Plan" : null),
      subTone: (data.invoicesOverdue > 0 ? "red" : "green") as Tone,
    },
    {
      to: "/aufgaben", label: "Offene Aufgaben", value: data.tasksOpen, desc: "Zu erledigen",
      icon: CheckCircle2, tone: "#22c55e",
      sub: data.tasksOverdue > 0 ? `${data.tasksOverdue} überfällig` : (data.tasksOpen > 0 ? "nichts überfällig" : null),
      subTone: (data.tasksOverdue > 0 ? "red" : "green") as Tone,
    },
  ];

  if (loading) return <Spinner />;

  return (
    <div className="anim-in dash space-y-5 pt-1">
      {error && (
        <div className="glass flex items-center gap-2 p-3 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle size={16} /> Einige Daten konnten nicht geladen werden. Bitte Seite neu laden.
        </div>
      )}

      {/* Kopf + Tageszusammenfassung */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight">{greet}, {firstName} 👋</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <Summary icon={CheckCircle2} label="offene Aufgaben" value={data.tasksOpen} />
            <Summary icon={Receipt} label="offene Rechnungen" value={data.invoicesOpen} />
            <Summary icon={FolderKanban} label="laufende Projekte" value={data.projectsRunning} />
            <Summary icon={CalendarClock} label="Termine heute" value={data.appts.length} />
            {data.requestsNew > 0 && (
              <Link to="/anfragen" className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: "var(--accent)" }}>
                <Inbox size={15} /> <span className="tabular-nums">{data.requestsNew}</span> neue Anfrage{data.requestsNew === 1 ? "" : "n"}
              </Link>
            )}
            {data.eingangFaellig > 0 && (
              <Link to="/buchhaltung" className="inline-flex items-center gap-1.5 font-semibold text-amber-600 hover:underline dark:text-amber-400">
                <Receipt size={15} /> <span className="tabular-nums">{data.eingangFaellig}</span> Eingangsrechnung{data.eingangFaellig === 1 ? "" : "en"} fällig
              </Link>
            )}
            {hints > 0 ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                <AlertTriangle size={15} /> {hints} überfällig – Aufmerksamkeit nötig
              </span>
            ) : (
              <span className="text-slate-400">Alles im grünen Bereich</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="glass flex items-center gap-2 px-3.5 py-2 text-sm font-medium"><Calendar size={15} style={{ color: "var(--accent)" }} /> {todayLong}</div>
          <div className="glass flex items-center gap-2 px-3.5 py-2 text-sm font-semibold tabular-nums"><Clock size={15} className="text-slate-400" /> {timeStr}</div>
        </div>
      </div>

      {/* KPI-Karten */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} to={k.to} className="glass glass-hover group flex flex-col p-4">
            <div className="flex items-start justify-between">
              <div className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${k.tone}1f`, color: k.tone }}><k.icon size={20} /></div>
              <ArrowUpRight size={16} className="text-slate-300 opacity-0 transition group-hover:opacity-100 dark:text-slate-500" />
            </div>
            <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">{k.label}</div>
            <div className="text-3xl font-extrabold leading-tight tabular-nums">{k.value}</div>
            <div className="mt-0.5 text-xs text-slate-400">{k.desc}</div>
            {k.sub && <div className="mt-2.5"><Badge tone={k.subTone}>{k.sub}</Badge></div>}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Linke 2/3 */}
        <div className="space-y-4 xl:col-span-2">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Aktuelle Projekte */}
            <div className="glass flex flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold">Aktuelle Projekte</h2>
                <Link to="/projekte" className="text-xs font-semibold hover:underline" style={{ color: "var(--accent)" }}>Alle anzeigen</Link>
              </div>
              {data.topProjects.length === 0 ? (
                <EmptyState icon={Building2} text="Keine aktiven Projekte" actionTo="/projekte" actionLabel="Projekt anlegen" />
              ) : (
                <ul className="space-y-3.5">
                  {data.topProjects.map((p) => {
                    const prog = progressFor(p.stage);
                    return (
                      <li key={p.id}>
                        <Link to={`/projekte/${p.id}`} className="group flex items-center gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: "linear-gradient(135deg,#64748b,#334155)" }}><Building2 size={18} /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-semibold group-hover:underline">{p.title}</span>
                              <span className="shrink-0 text-xs font-bold tabular-nums text-slate-400">{prog}%</span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                              {p.category && <span className="truncate">{p.category}</span>}
                              <Badge tone={stageTone(p.stage)}>{p.stage}</Badge>
                              {p.priority && p.priority !== "Normal" && <Badge tone={prioTone(p.priority)}>{p.priority}</Badge>}
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                              <div className="h-full rounded-full" style={{ width: `${prog}%`, background: "linear-gradient(90deg,var(--accent),var(--accent-h))" }} />
                            </div>
                            {p.responsible && (
                              <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><User size={11} /> {p.responsible}</div>
                            )}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Aufgaben für heute */}
            <div className="glass flex flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold">Aufgaben für heute</h2>
              </div>
              {data.taskList.length === 0 ? (
                <EmptyState icon={ListChecks} text="Keine offenen Aufgaben für heute" />
              ) : (
                <ul className="space-y-2">
                  {data.taskList.map((t) => {
                    const overdue = !!t.due_date && new Date(t.due_date) < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                    return (
                      <li key={t.id} className={`flex items-center gap-3 rounded-xl px-2 py-2 ${overdue ? "bg-rose-500/5" : ""}`}>
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${overdue ? "border-rose-400" : "border-slate-300 dark:border-white/20"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{t.title}</div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                            {t.project_id && data.projTitle[t.project_id] && <span className="truncate">{data.projTitle[t.project_id]}</span>}
                            {t.priority && <Badge tone={prioTone(t.priority)}>{t.priority}</Badge>}
                          </div>
                        </div>
                        {t.due_date && (
                          <span className={`shrink-0 text-xs font-medium tabular-nums ${overdue ? "text-rose-500" : "text-slate-400"}`}>
                            {overdue ? "überfällig · " : ""}{fmtDay(t.due_date)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Umsatz */}
          <div className="glass p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-bold">Umsatz (Monat)</h2>
              {revTrend !== null && (
                <span className={`inline-flex items-center gap-1 text-xs font-bold ${revTrend >= 0 ? "text-ok-500" : "text-brand-500"}`}>
                  {revTrend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(revTrend)}%
                </span>
              )}
            </div>
            {!hasRevenue ? (
              <EmptyState icon={Receipt} text="Noch kein Umsatz im Zeitraum erfasst" actionTo="/rechnungen" actionLabel="Rechnung erstellen" />
            ) : (
              <>
                <div className="text-3xl font-extrabold tabular-nums">{eur(monthRevenue)}</div>
                <div className="text-xs text-slate-400">
                  {revTrend !== null ? `vs. Vormonat (${eur(prevRevenue)})` : "Verrechnet im laufenden Monat"}
                </div>
                <div className="mt-2"><AreaChart data={data.revenue} /></div>
                <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                  {monthLabels.map((m, i) => (
                    <span key={i} className={i % 2 === 0 ? "" : "opacity-0 sm:opacity-100"}>{m}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Rechte 1/3 */}
        <div className="space-y-4">
          {/* Neue Anfragen – smartes KI-Postfach */}
          <div className="glass p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-bold">
                <Sparkles size={16} style={{ color: "var(--accent)" }} /> Neue Anfragen
                {data.requestsNew > 0 && (
                  <span className="rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: "var(--accent)" }}>
                    {data.requestsNew}
                  </span>
                )}
              </h2>
              <Link to="/anfragen" className="text-xs font-semibold hover:underline" style={{ color: "var(--accent)" }}>Alle anzeigen</Link>
            </div>
            {data.newRequests.length === 0 ? (
              <EmptyState icon={Inbox} text="Keine neuen Anfragen" actionTo="/anfragen" actionLabel="Posteingang öffnen" />
            ) : (
              <ul className="space-y-2.5">
                {data.newRequests.map((r) => {
                  const SrcIcon = REQ_SOURCE_ICON[r.source] ?? Inbox;
                  const who = r.caller_name?.trim() || r.subject?.trim() || "Unbekannt";
                  return (
                    <li key={r.id}>
                      <Link to={`/anfragen/${r.id}`} className="group flex items-start gap-2.5 rounded-xl px-1 py-1 hover:bg-[var(--hover)]">
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: "var(--accent-soft, rgba(239,68,68,0.1))", color: "var(--accent)" }}>
                          <SrcIcon size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold group-hover:underline">{who}</span>
                            <span className="shrink-0 text-[10px] text-slate-400">{fmtDay(r.created_at)}</span>
                          </div>
                          {r.ai_summary && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{r.ai_summary}</p>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge tone="slate">{REQ_SOURCE_LABEL[r.source] ?? r.source}</Badge>
                            {r.ai_priority && <Badge tone={reqPrioTone(r.ai_priority)}>{r.ai_priority}</Badge>}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Schnellaktionen */}
          <div className="glass p-4">
            <h2 className="mb-3 font-bold">Schnellaktionen</h2>
            <div className="space-y-2">
              <QA to="/projekte" icon={Plus} label="Neues Projekt" primary />
              <QA to="/angebote" icon={FileText} label="Angebot erstellen" />
              <QA to="/rechnungen" icon={Receipt} label="Rechnung erstellen" />
              <QA to="/marketing" icon={Megaphone} label="Beitrag planen" />
              <QA to="/kontakte" icon={UserPlus} label="Kontakt hinzufügen" />
            </div>
          </div>

          {/* Heute: Termine, Erinnerungen, Fristen */}
          <div className="glass p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Heute</h2>
              <Link to="/planung" className="text-xs font-semibold hover:underline" style={{ color: "var(--accent)" }}>Planung</Link>
            </div>
            {data.appts.length === 0 && data.reminders.length === 0 ? (
              <EmptyState icon={CalendarClock} text="Keine Termine oder Fristen für heute" actionTo="/planung" actionLabel="Termin planen" />
            ) : (
              <ul className="space-y-2.5">
                {data.appts.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/10" style={{ color: "var(--accent)" }}><CalendarClock size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.title}</div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                        <span className="tabular-nums">{a.all_day ? "Ganztägig" : new Date(a.start_datetime).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}</span>
                        {a.location && <span className="inline-flex items-center gap-1 truncate"><MapPin size={11} /> {a.location}</span>}
                      </div>
                    </div>
                  </li>
                ))}
                {data.reminders.map((r) => (
                  <li key={r.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-500"><Bell size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.reminder_text || r.title}</div>
                      <div className="text-[11px] text-slate-400">{r.title}{r.reminder_date ? ` · ${fmtDay(r.reminder_date)}` : ""}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Wetter (echte Daten, Open-Meteo) */}
          <Weather />
        </div>
      </div>
    </div>
  );
}

function Summary({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
      <Icon size={15} className="text-slate-400" />
      <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{value}</span> {label}
    </span>
  );
}

function EmptyState({ icon: Icon, text, actionTo, actionLabel }: { icon: LucideIcon; text: string; actionTo?: string; actionLabel?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5"><Icon size={22} /></div>
      <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
      {actionTo && actionLabel && (
        <Link to={actionTo} className="mt-0.5 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-100 dark:hover:bg-white/5" style={{ color: "var(--accent)" }}>
          {actionLabel} <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

function QA({ to, icon: Icon, label, primary }: { to: string; icon: LucideIcon; label: string; primary?: boolean }) {
  return (
    <Link to={to} className={`group flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition ${
      primary ? "text-white" : "border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"}`}
      style={primary ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))", boxShadow: "0 10px 26px -10px rgba(239,68,68,0.6)" } : undefined}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${primary ? "bg-white/20" : "bg-slate-100 dark:bg-white/5"}`}><Icon size={16} /></span>
      <span className="flex-1">{label}</span>
      <ArrowUpRight size={15} className="opacity-0 transition group-hover:opacity-100" />
    </Link>
  );
}
