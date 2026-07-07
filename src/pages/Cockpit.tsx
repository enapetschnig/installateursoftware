import { ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Gauge, Receipt, FolderKanban, UsersRound, FileText, TrendingUp, TrendingDown,
  Zap, Phone, MapPin, Clock, Calendar, ArrowUpRight, ArrowRight, Plus, ListChecks,
  Mic, AlertTriangle, CalendarClock, Building2, Send, BarChart3, UserPlus, CheckCircle2,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { AreaChart } from "../components/Charts";
import { Badge, Spinner, type Tone } from "../components/ui";
import { eur, dateTimeAt } from "../lib/format";
import { statusLabel, statusTone } from "../lib/planning";
import { PROJECT_PRIORITIES } from "../lib/types";
import {
  loadCockpit, createCockpitTask, EMPTY_COCKPIT,
  type CockpitData, type AssignmentEvent,
} from "../lib/cockpit";
import { loadCompanySettings } from "../lib/company";
import { startCreateRoute, type DocTypeOption } from "../lib/documents-overview";
import { toast, toastError } from "../lib/toast";
import { useNewAnfragenSubscription } from "../hooks/useNewAnfragenSubscription";
import { VoiceAngebotPrestepModal, type VoiceAngebotPrestepResult } from "../components/voice/VoiceAngebotPrestepModal";

// ── Hilfen ─────────────────────────────────────────────────
function prioTone(p?: string | null): Tone {
  const s = (p ?? "").toLowerCase();
  if (s.includes("dring") || s.includes("krit")) return "red";
  if (s.includes("hoch")) return "amber";
  return "slate";
}
const runTone = (s: string): Tone => (s === "ok" ? "green" : s === "error" ? "red" : "amber");
const runLabel = (s: string) => (s === "ok" ? "OK" : s === "error" ? "Fehler" : "Teilweise");
// Anfragen-Quelle → Label/Ton fuer die Cockpit-Liste (siehe AnfrageDetail.tsx fuer die volle Palette).
const reqSourceLabel = (s: string): string => {
  switch (s) {
    case "phone_fonio": return "Telefon";
    case "website_form": return "Webformular";
    case "email": return "E-Mail";
    case "manual": return "Manuell";
    case "instagram": return "Instagram";
    case "facebook": return "Facebook";
    case "whatsapp": return "WhatsApp";
    default: return "Sonstige";
  }
};
const reqSourceTone = (s: string): Tone => {
  switch (s) {
    case "phone_fonio":
    case "website_form":
    case "facebook":
      return "blue";
    case "whatsapp":
      return "green";
    case "instagram":
      return "amber";
    default:
      return "slate";
  }
};
const evTime = (e: AssignmentEvent) =>
  e.all_day
    ? "Ganztägig"
    : new Date(e.start_at).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
const monthLabelsLast12 = () => {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return new Intl.DateTimeFormat("de-AT", { month: "short" }).format(d).replace(".", "");
  });
};

export default function Cockpit() {
  const nav = useNavigate();
  const [data, setData] = useState<CockpitData>(EMPTY_COCKPIT);
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [voicePrestepOpen, setVoicePrestepOpen] = useState(false);

  // Schnell-Aufgabe Formular
  const [tProject, setTProject] = useState("");
  const [tTitle, setTTitle] = useState("");
  const [tAssignee, setTAssignee] = useState("");
  const [tDue, setTDue] = useState("");
  const [tPrio, setTPrio] = useState("Normal");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, c] = await Promise.all([loadCockpit(), loadCompanySettings().catch(() => null)]);
        if (!alive) return;
        setData(d);
        setCompany(c?.name ?? "");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    try { setData(await loadCockpit()); } catch { /* best-effort */ }
  }, []);

  // Realtime-Push: jede neue Anfrage triggert ein Cockpit-Refresh, damit
  // requestsNewToday + recentRequests sofort aktuell sind.
  useNewAnfragenSubscription(useCallback(() => { refresh(); }, [refresh]));

  // Sprach-Schnellstart:
  //   1) Pre-Step-Modal oeffnen → User waehlt Kunde (+ optional Projekt).
  //   2) onConfirm legt den Draft mit contact_id + project_id an und navigiert
  //      mit ?voice=1 in den Editor. Der OfferEditor oeffnet dann den Voice-
  //      Dialog automatisch.
  // Wir starten den Draft NICHT mehr ohne Kunden — das war die Wurzel der
  // alten Beschwerde "uebernimmt nichts ins Angebot".
  function startVoiceAngebot() {
    if (voiceStarting) return;
    setVoicePrestepOpen(true);
  }

  async function handleVoicePrestepConfirm(r: VoiceAngebotPrestepResult) {
    if (voiceStarting) return;
    setVoiceStarting(true);
    try {
      const angeboteType = { slug: "angebote" } as DocTypeOption;
      const res = await startCreateRoute(angeboteType, {
        contactId: r.contactId,
        projectId: r.projectId,
      });
      if (res.error) {
        toastError(res.error);
        return;
      }
      if (res.route) {
        setVoicePrestepOpen(false);
        nav(`${res.route}?voice=1`);
      }
    } finally {
      setVoiceStarting(false);
    }
  }

  async function submitTask(e: React.FormEvent) {
    e.preventDefault();
    if (!tProject || !tTitle.trim()) { toastError("Bitte Projekt und Titel angeben."); return; }
    setSaving(true);
    const { error } = await createCockpitTask({
      projectId: tProject, title: tTitle, assigneeAuthId: tAssignee || null,
      dueDate: tDue || null, priority: tPrio,
    });
    setSaving(false);
    if (error) { toastError(error); return; }
    toast("Aufgabe verteilt");
    setTTitle(""); setTAssignee(""); setTDue(""); setTPrio("Normal");
    refresh();
  }

  if (loading) return <Spinner />;

  const todayLong = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(clock);
  const timeStr = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" }).format(clock);
  const hints = data.invoicesOverdueCount + data.tasksOverdue + data.projectsOverdue;
  const hasRevenue = data.revenue.some((v) => v > 0);
  const months = monthLabelsLast12();
  const pipeMax = Math.max(1, data.offerDraftN, data.offerDoneN, data.offerSentN, data.offerAcceptedN);
  const projTitle = new Map(data.projects.map((p) => [p.id, p.title]));
  const assignable = data.employees.filter((e) => e.active && e.auth_user_id);

  return (
    <div className="anim-in space-y-5 pt-1">
      {/* ── Kopf ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
            <Gauge size={28} style={{ color: "var(--accent)" }} /> Cockpit
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500 dark:text-slate-400">
            {company && <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200"><Building2 size={15} className="text-slate-400" /> {company}</span>}
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

      {data.errors.length > 0 && (
        <div className="glass flex items-center gap-2 p-3 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle size={16} /> Einige Bereiche konnten nicht geladen werden: {data.errors.join(", ")}.
        </div>
      )}

      {/* ── Schnell starten: prominentes 1-Klick-Onboarding fuer Sprache ── */}
      <button
        type="button"
        onClick={startVoiceAngebot}
        disabled={voiceStarting}
        className="glass glass-hover group relative flex w-full items-center gap-4 overflow-hidden p-5 text-left disabled:opacity-70"
        style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))", color: "white" }}
      >
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30">
          <Mic size={26} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wider text-white/80">Schnell starten</span>
          <span className="mt-0.5 block text-xl font-extrabold leading-tight">
            {voiceStarting ? "Entwurf wird angelegt …" : "Neues Angebot per Sprache erstellen"}
          </span>
          <span className="mt-0.5 block text-sm text-white/85">
            Sprich eine Aufnahme ein – Positionen, Mengen und Preise werden automatisch aus deinen Stammdaten erkannt.
          </span>
        </span>
        <ArrowUpRight size={22} className="shrink-0 opacity-70 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
      </button>

      {/* ── Große KPI-Kacheln ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          to="/rechnungen" icon={Receipt} tone="#22c55e" label="Umsatz (Monat)"
          value={eur(data.monthRevenue)}
          desc={data.revTrend !== null ? `vs. Vormonat (${eur(data.prevRevenue)})` : "im laufenden Monat verrechnet"}
          sub={data.revTrend !== null ? `${data.revTrend >= 0 ? "▲" : "▼"} ${Math.abs(data.revTrend)} %` : null}
          subTone={data.revTrend !== null ? (data.revTrend >= 0 ? "green" : "red") : "slate"}
        />
        <KpiTile
          to="/rechnungen" icon={Receipt} tone="#f59e0b" label="Offene Rechnungen"
          value={eur(data.invoicesOpenSum)} desc={`${data.invoicesOpenCount} offen`}
          sub={data.invoicesOverdueCount > 0 ? `${data.invoicesOverdueCount} überfällig · ${eur(data.invoicesOverdueSum)}` : "nichts überfällig"}
          subTone={data.invoicesOverdueCount > 0 ? "red" : "green"}
        />
        <KpiTile
          to="/projekte" icon={FolderKanban} tone="#3b82f6" label="Aktive Projekte"
          value={data.projectsActive} desc={`${data.projectsRunning} laufend`}
          sub={data.projectsOverdue > 0 ? `${data.projectsOverdue} überfällig` : (data.projectsThisWeek > 0 ? `+${data.projectsThisWeek} diese Woche` : null)}
          subTone={data.projectsOverdue > 0 ? "red" : "green"}
        />
        <KpiTile
          to="/planung" icon={UsersRound} tone="#8b5cf6" label="Mitarbeiter heute"
          value={`${data.onSiteToday}/${data.employeesActive}`} desc="im Einsatz / aktiv"
          sub={data.absencesToday.length > 0 ? `${data.absencesToday.length} abwesend` : null}
          subTone="amber"
        />
      </div>

      {/* ── Finanzen + Kommunikation ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Umsatz & Angebote" icon={TrendingUp} to="/auswertungen" toLabel="Auswertungen" className="xl:col-span-2">
          {!hasRevenue ? (
            <Empty icon={Receipt} text="Noch kein Umsatz im Zeitraum erfasst" to="/rechnungen" label="Rechnung erstellen" />
          ) : (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-extrabold tabular-nums">{eur(data.monthRevenue)}</div>
                  <div className="text-xs text-slate-400">laufender Monat (netto)</div>
                </div>
                {data.revTrend !== null && (
                  <span className={`inline-flex items-center gap-1 text-xs font-bold ${data.revTrend >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    {data.revTrend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(data.revTrend)} %
                  </span>
                )}
              </div>
              <div className="mt-2"><AreaChart data={data.revenue} /></div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                {months.map((m, i) => <span key={i} className={i % 2 === 0 ? "" : "opacity-0 sm:opacity-100"}>{m}</span>)}
              </div>
            </>
          )}

          {/* Angebots-Pipeline */}
          <div className="mt-5 border-t border-slate-200/70 pt-4 dark:border-white/10">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-sm font-bold">Angebots-Pipeline</h3>
              <span className="text-xs text-slate-400">{data.offersLive} in Pipeline</span>
            </div>
            <div className="space-y-2.5">
              <PipeRow label="Entwurf" n={data.offerDraftN} sum={data.offerDraftSum} max={pipeMax} color="#94a3b8" />
              <PipeRow label="Abgeschlossen" n={data.offerDoneN} sum={data.offerDoneSum} max={pipeMax} color="#f59e0b" />
              <PipeRow label="Versendet" n={data.offerSentN} sum={data.offerSentSum} max={pipeMax} color="#3b82f6" />
              <PipeRow label="Angenommen" n={data.offerAcceptedN} sum={data.offerAcceptedSum} max={pipeMax} color="#22c55e" />
            </div>
          </div>
        </Panel>

        {/* Kommunikation / Delegation */}
        <Panel title="Kommunikation & Delegation" icon={Mic} to="/delegieren" toLabel="Delegieren">
          <div className="grid grid-cols-2 gap-3">
            <MiniStat icon={Mic} label="Sprachaufnahmen (Woche)" value={data.voiceWeek} tone="#0ea5e9" />
            <MiniStat icon={FileText} label="→ Angebot erzeugt" value={data.voiceProducedRate !== null ? `${data.voiceProducedRate} %` : "–"} tone="#22c55e" />
            <MiniStat icon={ListChecks} label="Offene Entwürfe" value={data.draftsOpen} tone="#f59e0b" />
            <MiniStat icon={AlertTriangle} label="Fehler (Woche)" value={data.voiceErrors} tone={data.voiceErrors > 0 ? "#ef4444" : "#94a3b8"} />
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Sprich Aufnahmen ein und lass daraus automatisch Angebote &amp; Nachrichten erzeugen.
          </p>
        </Panel>
      </div>

      {/* ── Mitarbeiter-Einteilung + Aufgaben verteilen ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Einteilung heute */}
        <Panel title="Mitarbeiter-Einteilung – heute" icon={UsersRound} to="/planung" toLabel="Planung">
          {data.assignmentsToday.length === 0 && data.unassignedToday.length === 0 && data.absencesToday.length === 0 ? (
            <Empty icon={CalendarClock} text="Heute niemand eingeteilt" to="/planung" label="Einsatz planen" />
          ) : (
            <div className="space-y-3">
              {data.assignmentsToday.map((a) => (
                <div key={a.employeeId} className="rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-500"><UsersRound size={14} /></span>
                    <span className="truncate text-sm font-semibold">{a.name}</span>
                    <span className="ml-auto text-[11px] text-slate-400">{a.events.length} Einsatz{a.events.length === 1 ? "" : "e"}</span>
                  </div>
                  <ul className="space-y-1.5 pl-1">
                    {a.events.map((e) => (
                      <li key={e.id + a.employeeId} className="flex items-center gap-2 text-xs">
                        <span className="shrink-0 tabular-nums font-medium text-slate-500 dark:text-slate-400">{evTime(e)}</span>
                        <span className="truncate">{e.title}</span>
                        {e.location && <span className="inline-flex items-center gap-0.5 truncate text-slate-400"><MapPin size={11} /> {e.location}</span>}
                        <Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {data.unassignedToday.length > 0 && (
                <div className="rounded-xl border border-dashed border-amber-300/60 p-3 dark:border-amber-400/30">
                  <div className="mb-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">Ohne Zuordnung ({data.unassignedToday.length})</div>
                  <ul className="space-y-1">
                    {data.unassignedToday.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 text-xs">
                        <span className="shrink-0 tabular-nums text-slate-400">{evTime(e)}</span>
                        <span className="truncate">{e.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.absencesToday.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-xs text-slate-400">Abwesend:</span>
                  {data.absencesToday.map((a, i) => (
                    <Badge key={i} tone="red">{a.name} · {a.label}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* Aufgaben verteilen */}
        <Panel title="Aufgabe schnell verteilen" icon={Send} to="/aufgaben" toLabel="Alle Aufgaben">
          <form onSubmit={submitTask} className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="text-xs font-medium">
                <span className="mb-1 block text-slate-500 dark:text-slate-400">Projekt *</span>
                <select className="input" value={tProject} onChange={(e) => setTProject(e.target.value)} required>
                  <option value="">– wählen –</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium">
                <span className="mb-1 block text-slate-500 dark:text-slate-400">Zuständig</span>
                <select className="input" value={tAssignee} onChange={(e) => setTAssignee(e.target.value)}>
                  <option value="">– niemand –</option>
                  {assignable.map((e) => (
                    <option key={e.id} value={e.auth_user_id!}>{[e.first_name, e.last_name].filter(Boolean).join(" ")}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs font-medium">
              <span className="mb-1 block text-slate-500 dark:text-slate-400">Aufgabe *</span>
              <input className="input" value={tTitle} onChange={(e) => setTTitle(e.target.value)} placeholder="z. B. Material bestellen, Kunde anrufen …" required />
            </label>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="text-xs font-medium">
                <span className="mb-1 block text-slate-500 dark:text-slate-400">Fällig</span>
                <input type="date" className="input" value={tDue} onChange={(e) => setTDue(e.target.value)} />
              </label>
              <label className="text-xs font-medium">
                <span className="mb-1 block text-slate-500 dark:text-slate-400">Priorität</span>
                <select className="input" value={tPrio} onChange={(e) => setTPrio(e.target.value)}>
                  {PROJECT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
            <button type="submit" disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}>
              <Plus size={16} /> {saving ? "Wird verteilt …" : "Aufgabe verteilen"}
            </button>
          </form>

          {/* Offene Aufgaben */}
          <div className="mt-4 border-t border-slate-200/70 pt-3 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">Offene Aufgaben</h3>
              <span className="text-xs text-slate-400">{data.tasksOpen} offen{data.tasksOverdue > 0 ? ` · ${data.tasksOverdue} überfällig` : ""}</span>
            </div>
            {data.taskList.length === 0 ? (
              <p className="py-3 text-center text-sm text-slate-400">Keine offenen Aufgaben 🎉</p>
            ) : (
              <ul className="space-y-1.5">
                {data.taskList.map((t) => {
                  const overdue = !!t.due_date && new Date(t.due_date) < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                  return (
                    <li key={t.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${overdue ? "bg-rose-500/5" : ""}`}>
                      <CheckCircle2 size={15} className={overdue ? "text-rose-400" : "text-slate-300 dark:text-white/20"} />
                      <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                      {t.project_id && projTitle.get(t.project_id) && <span className="hidden truncate text-[11px] text-slate-400 sm:inline">{projTitle.get(t.project_id)}</span>}
                      {t.priority && t.priority !== "Normal" && <Badge tone={prioTone(t.priority)}>{t.priority}</Badge>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Anfragen + Automationen + KI-Telefonagent + Schnellaktionen ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Anfragen-Posteingang (Live ab Migration 0117/0118) */}
        <Panel title="Anfragen" icon={Inbox} to="/anfragen" toLabel="Öffnen">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Neu heute</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-500">{data.requestsNewToday}</div>
            </div>
            <div className="rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Unbearbeitet</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-amber-500">{data.requestsOpen}</div>
            </div>
          </div>
          <h3 className="mb-2 text-sm font-bold">Zuletzt eingegangen</h3>
          {data.recentRequests.length === 0 ? (
            <p className="py-2 text-sm text-slate-400">Noch keine Anfragen eingegangen.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.recentRequests.map((r) => {
                const who = r.caller_name?.trim() || r.caller_phone || r.caller_email || "Anonym";
                const subj = r.subject?.trim() || "(kein Betreff)";
                return (
                  <li key={r.id} className="flex items-center gap-2 text-xs">
                    <Badge tone={reqSourceTone(r.source)}>{reqSourceLabel(r.source)}</Badge>
                    <Link to={`/anfragen/${r.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      <span className="text-slate-700 dark:text-slate-200">{who}</span>
                      <span className="text-slate-400"> · </span>
                      <span className="text-slate-500 dark:text-slate-400">{subj}</span>
                    </Link>
                    <span className="shrink-0 tabular-nums text-slate-400">{dateTimeAt(r.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Automationen */}
        <Panel title="Automatisierungen" icon={Zap} to="/automationen" toLabel="Verwalten">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tabular-nums">{data.automationsActive}</span>
            <span className="text-sm text-slate-400">von {data.automationsTotal} aktiv</span>
          </div>
          <h3 className="mb-2 text-sm font-bold">Letzte Läufe</h3>
          {data.automationRuns.length === 0 ? (
            <p className="py-2 text-sm text-slate-400">Noch keine Ausführungen protokolliert.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.automationRuns.map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <Badge tone={runTone(r.status)}>{runLabel(r.status)}</Badge>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.automation_name || "Automation"}</span>
                  {r.dry_run && <span className="shrink-0 text-[10px] text-slate-400">Test</span>}
                  <span className="shrink-0 tabular-nums text-slate-400">{dateTimeAt(r.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* KI-Telefonagent (Platzhalter) */}
        <div className="glass relative flex flex-col overflow-hidden p-4">
          <div className="absolute right-3 top-3"><Badge tone="blue">Demnächst</Badge></div>
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/15 text-sky-500"><Phone size={20} /></div>
          <h2 className="mt-3 font-bold">KI-Telefonagent</h2>
          <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">
            Bald: ein- und ausgehende Anrufe automatisch annehmen, qualifizieren und direkt ins Cockpit
            einspielen – Termine, Aufgaben und Rückrufe entstehen ohne manuelle Erfassung.
          </p>
          <button disabled className="mt-3 cursor-not-allowed rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-400 dark:border-white/10">
            In Vorbereitung
          </button>
        </div>

        {/* Schnellaktionen */}
        <Panel title="Schnellaktionen" icon={Plus}>
          <div className="space-y-2">
            <QAButton onClick={startVoiceAngebot} disabled={voiceStarting} icon={Mic} label="Angebot per Sprache" primary />
            <QA to="/angebote" icon={FileText} label="Angebot erstellen" />
            <QA to="/planung" icon={CalendarClock} label="Einsatz planen" />
            <QA to="/projekte" icon={FolderKanban} label="Projekte" />
            <QA to="/mitarbeiter" icon={UserPlus} label="Mitarbeiter" />
            <QA to="/auswertungen" icon={BarChart3} label="Auswertungen" />
          </div>
        </Panel>
      </div>

      <VoiceAngebotPrestepModal
        open={voicePrestepOpen}
        onClose={() => setVoicePrestepOpen(false)}
        onConfirm={handleVoicePrestepConfirm}
        submitting={voiceStarting}
      />
    </div>
  );
}

// ── Bausteine ──────────────────────────────────────────────
function KpiTile({ to, icon: Icon, tone, label, value, desc, sub, subTone }: {
  to?: string; icon: LucideIcon; tone: string; label: string; value: ReactNode; desc?: string; sub?: string | null; subTone?: Tone;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <div className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon size={20} /></div>
        {to && <ArrowUpRight size={16} className="text-slate-300 opacity-0 transition group-hover:opacity-100 dark:text-slate-500" />}
      </div>
      <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-3xl font-extrabold leading-tight tabular-nums">{value}</div>
      {desc && <div className="mt-0.5 text-xs text-slate-400">{desc}</div>}
      {sub && <div className="mt-2.5"><Badge tone={subTone ?? "slate"}>{sub}</Badge></div>}
    </>
  );
  return to
    ? <Link to={to} className="glass glass-hover group flex flex-col p-4">{body}</Link>
    : <div className="glass flex flex-col p-4">{body}</div>;
}

function Panel({ title, icon: Icon, to, toLabel, className, children }: {
  title: string; icon?: LucideIcon; to?: string; toLabel?: string; className?: string; children: ReactNode;
}) {
  return (
    <div className={`glass flex flex-col p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">{Icon && <Icon size={16} style={{ color: "var(--accent)" }} />}{title}</h2>
        {to && <Link to={to} className="shrink-0 text-xs font-semibold hover:underline" style={{ color: "var(--accent)" }}>{toLabel ?? "Öffnen"}</Link>}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: ReactNode; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
      <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${tone}1f`, color: tone }}><Icon size={15} /></div>
      <div className="mt-2 text-xl font-extrabold tabular-nums">{value}</div>
      <div className="text-[11px] leading-tight text-slate-400">{label}</div>
    </div>
  );
}

function PipeRow({ label, n, sum, max, color }: { label: string; n: number; sum: number; max: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-slate-400">{n} · {eur(sum)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function Empty({ icon: Icon, text, to, label }: { icon: LucideIcon; text: string; to?: string; label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5"><Icon size={22} /></div>
      <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
      {to && label && (
        <Link to={to} className="mt-0.5 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-100 dark:hover:bg-white/5" style={{ color: "var(--accent)" }}>
          {label} <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

function QA({ to, icon: Icon, label, primary }: { to: string; icon: LucideIcon; label: string; primary?: boolean }) {
  return (
    <Link to={to} className={`group flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition ${
      primary ? "text-white" : "border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"}`}
      style={primary ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${primary ? "bg-white/20" : "bg-slate-100 dark:bg-white/5"}`}><Icon size={16} /></span>
      <span className="flex-1">{label}</span>
      <ArrowUpRight size={15} className="opacity-0 transition group-hover:opacity-100" />
    </Link>
  );
}

function QAButton({ onClick, disabled, icon: Icon, label, primary }: { onClick: () => void; disabled?: boolean; icon: LucideIcon; label: string; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`group flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm font-semibold transition disabled:opacity-60 ${
        primary ? "text-white" : "border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"}`}
      style={primary ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${primary ? "bg-white/20" : "bg-slate-100 dark:bg-white/5"}`}><Icon size={16} /></span>
      <span className="flex-1">{label}</span>
      <ArrowUpRight size={15} className="opacity-0 transition group-hover:opacity-100" />
    </button>
  );
}
