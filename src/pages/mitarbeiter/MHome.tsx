// ============================================================
// Installateursoftware – Mitarbeiter-App: Startseite (/m)
//
// Karten-Launcher im Fasching-Stil: Begrüßung, kompakte Wochen-Kennzahlen
// und große Aktions-Karten. Bewusster Fokus auf die zwei Kernfunktionen der
// Mitarbeiter-App: ZEITERFASSUNG und REGIEBERICHTE (letztere auch per Sprache).
// Projekte/Fotos bleiben als sekundäre Karte erreichbar. Wenig Text, dicke
// Touch-Ziele; nutzt ausschließlich zentrale Design-Tokens (var(--accent) …)
// → Dark/Light + alle Akzent-Themes automatisch.
// ============================================================
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, ClipboardList, Clock, Mic, CalendarDays, CheckCircle2, Camera } from "lucide-react";
import { Empty, Spinner } from "../../components/ui";
import { useMyEmployee } from "../../lib/my-employee";
import { loadEvents, addDays, fmtDate, fmtTime, type EventWithLinks } from "../../lib/planning";
import { loadProjectOptions } from "../../lib/documents-overview";
import { supabase } from "../../lib/supabase";
import QuickPhotoButton from "../../components/media/QuickPhotoButton";

export default function MHome() {
  const { employee, loading } = useMyEmployee();
  const [assignments, setAssignments] = useState<EventWithLinks[]>([]);
  const [projLabels, setProjLabels] = useState<Map<string, string>>(new Map());
  const [ladeFehler, setLadeFehler] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Eigene User-ID für den Foto-Upload (uploaded_by).
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id ?? null));
  }, []);

  // Meine Einteilung: eigene Plantafel-Einsätze der nächsten ~3 Wochen.
  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = addDays(start, 21);
    Promise.all([
      loadEvents(start.toISOString(), end.toISOString(), { employeeId: employee.id }),
      loadProjectOptions(),
    ])
      .then(([evs, projs]) => {
        if (cancelled) return;
        setAssignments(evs.slice(0, 8));
        setProjLabels(new Map(projs.map((p) => [p.id, p.label])));
      })
      .catch(() => { if (!cancelled) { setAssignments([]); setLadeFehler(true); } });
    return () => { cancelled = true; };
  }, [employee]);

  // Projekte der heutigen Einsätze – Vorauswahl beim Foto-Upload.
  const heuteIso = new Date().toDateString();
  const heutigeProjekte = assignments
    .filter((ev) => new Date(ev.start_at).toDateString() === heuteIso && ev.project_id)
    .map((ev) => ({ id: ev.project_id as string, label: projLabels.get(ev.project_id as string) ?? "Projekt" }))
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);

  if (loading) return <Spinner />;

  const greeting = employee?.first_name ? `Hallo, ${employee.first_name}!` : "Hallo!";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{greeting}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Zeiterfassung und Regieberichte.</p>
      </div>

      {!employee ? (
        <Empty
          title="Kein Mitarbeiterprofil verknüpft"
          hint="Dein Login ist noch keinem Mitarbeiter zugeordnet. Bitte wende dich an die Verwaltung."
        />
      ) : (
        <>
          {/* Foto-Schnellaufnahme – ganz oben, weil es die häufigste
              Handlung auf der Baustelle ist. Kamera ODER Galerie; die
              Projektzuordnung kommt NACH der Aufnahme. */}
          <div className="glass p-4">
            <div className="mb-3 flex items-center gap-2">
              <Camera size={16} className="text-[var(--accent)]" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Foto hinzufügen</h2>
            </div>
            <QuickPhotoButton
              projektVorschlaege={heutigeProjekte}
              uploadedBy={userId}
            />
          </div>

          {/* Meine Einteilung (Plantafel-Einsätze des Monteurs) */}
          <div className="glass p-4">
            <div className="mb-3 flex items-center gap-2">
              <CalendarDays size={16} className="text-[var(--accent)]" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Meine Einteilung</h2>
            </div>
            {ladeFehler ? (
              <p className="text-sm" style={{ color: "var(--c-amber)" }}>
                Die Einteilung konnte nicht geladen werden. Bitte später erneut versuchen.
              </p>
            ) : assignments.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Aktuell sind keine Einsätze für dich geplant.</p>
            ) : (
              <div className="space-y-2">
                {assignments.map((ev) => {
                  const s = new Date(ev.start_at);
                  const e = new Date(ev.end_at);
                  const oneDay = s.toDateString() === e.toDateString();
                  const when = ev.all_day
                    ? (oneDay ? fmtDate(ev.start_at) : `${fmtDate(ev.start_at)} – ${fmtDate(ev.end_at)}`)
                    : `${fmtDate(ev.start_at)} · ${fmtTime(ev.start_at)}–${fmtTime(ev.end_at)}`;
                  const proj = ev.project_id ? projLabels.get(ev.project_id) : null;
                  return (
                    <div key={ev.id} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: "var(--hover)" }}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white"
                        style={{ background: ev.done_at ? "var(--c-green)" : "linear-gradient(135deg,var(--accent),var(--accent-h))" }}>
                        {ev.done_at ? <CheckCircle2 size={18} /> : <CalendarDays size={18} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{ev.title || proj || "Einsatz"}</div>
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {when}{proj && ev.title ? ` · ${proj}` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Aktions-Karten (Fasching-Stil): Icon-Kachel + Titel + Beschreibung + Button */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            <ActionCard
              to="/m/zeit"
              icon={Clock}
              title="Zeiterfassung"
              desc="Arbeitszeit auf Projekte buchen"
              button="Stunden erfassen"
            />
            <ActionCard
              to="/m/regie/neu"
              icon={ClipboardList}
              title="Regiebericht"
              desc="Einsatz dokumentieren – auch per Sprache"
              button="Bericht erstellen"
              badge={
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <Mic size={12} /> Sprache
                </span>
              }
            />
            <ActionCard
              to="/m/projekte"
              icon={FolderOpen}
              title="Projekte & Fotos"
              desc="Projekte ansehen, Fotos hochladen"
              button="Projekte öffnen"
              variant="outline"
            />
          </div>
        </>
      )}
    </div>
  );
}

function ActionCard({
  to, icon: Icon, title, desc, button, variant = "primary", badge,
}: {
  to: string; icon: typeof Clock; title: string; desc: string; button: string;
  variant?: "primary" | "outline"; badge?: React.ReactNode;
}) {
  return (
    <Link to={to} className="glass glass-hover flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white"
          style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}
        >
          <Icon size={24} />
        </span>
        {badge}
      </div>
      <div>
        <div className="text-lg font-bold">{title}</div>
        <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{desc}</div>
      </div>
      <span className={`${variant === "primary" ? "btn-primary" : "btn-outline"} mt-1 min-h-[44px] w-full justify-center`}>
        {button}
      </span>
    </Link>
  );
}
