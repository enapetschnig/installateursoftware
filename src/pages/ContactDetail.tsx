// ============================================================
// Installateur SuperAPP – Kundenakte (CRM)
// ------------------------------------------------------------
// Aus der früheren reinen Stammdaten-Ansicht wird die Akte: „wann habe ich
// den Kunden kontaktiert, was wurde besprochen, was läuft gerade".
//
// Die Historie kommt aus der View `contact_timeline` (Migration 0159) und
// führt Belege, Projekte, Anfragen, Termine, Regieberichte, Mails, Aufgaben
// und erfasste Gespräche zusammen – dadurch ab dem ersten Tag rückwirkend
// gefüllt, ohne Datenkopien.
//
// Für Nicht-Kunden (Lieferant/Subunternehmer) bleibt die schlanke
// Stammdatenansicht – die Akte ist bewusst auf Kunden beschränkt
// (Entscheidung 2026-07-11). Die zugrunde liegende View ist typunabhängig,
// eine spätere Ausweitung ist daher eine Einzeiler-Änderung.
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Mail, Phone, MapPin, Building2, FolderKanban, History,
  BarChart3, Users, CalendarClock, Plus, Check, Pencil, Smartphone,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { Contact, Project } from "../lib/types";
import { PageHeader, Spinner, Badge, Empty, Modal } from "../components/ui";
import { contactDisplayName } from "../lib/contact-name";
import { eur } from "../lib/format";
import { useCan } from "../lib/permissions";
import { toast } from "../lib/toast";
import ContactTimeline from "../components/crm/ContactTimeline";
import {
  loadTimeline, loadActivityTypes, loadCrmStats, loadFollowUps,
  logContactEvent, deleteContactEvent, createFollowUp, completeFollowUp, seitLabel,
  type TimelineEntry, type ActivityType, type CrmStats, type FollowUp,
} from "../lib/crm";

const SEITE = 30;

const SECTIONS = [
  { key: "verlauf", label: "Verlauf", icon: History },
  { key: "projekte", label: "Projekte", icon: FolderKanban },
  { key: "wiedervorlagen", label: "Wiedervorlagen", icon: CalendarClock },
  { key: "personen", label: "Ansprechpartner", icon: Users },
  { key: "zahlen", label: "Zahlen", icon: BarChart3 },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

interface Person {
  id: string; first_name: string | null; last_name: string | null;
  function: string | null; email: string | null; phone: string | null;
  mobile: string | null; salutation: string | null; active: boolean | null;
}

export default function ContactDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const [c, setC] = useState<Contact | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [personen, setPersonen] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const [section, setSection] = useState<SectionKey>("verlauf");
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [stats, setStats] = useState<CrmStats | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [wvOffen, setWvOffen] = useState(false);
  const [wvTitel, setWvTitel] = useState("");
  const [wvDatum, setWvDatum] = useState("");

  const darfSchreiben = can("contacts", "edit");
  const darfZahlen = can("invoices", "view") || can("offers", "view");

  const ladeAkte = useCallback(async (contactId: string) => {
    setTimelineLoading(true);
    const [tl, ty, st, fu] = await Promise.all([
      loadTimeline(contactId, { limit: SEITE }),
      loadActivityTypes(),
      loadCrmStats(contactId),
      loadFollowUps(contactId),
    ]);
    setEntries(tl);
    setHasMore(tl.length === SEITE);
    setTypes(ty);
    setStats(st);
    setFollowUps(fu);
    setTimelineLoading(false);
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [{ data: kontakt }, { data: pr }, { data: pers }] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
        supabase.from("projects").select("*").eq("contact_id", id).order("created_at", { ascending: false }),
        supabase.from("contact_persons").select("id,first_name,last_name,function,email,phone,mobile,salutation,active")
          .eq("contact_id", id).order("sort_order"),
      ]);
      if (!alive) return;
      const k = kontakt as Contact | null;
      setC(k);
      setProjects((pr as Project[]) ?? []);
      setPersonen((pers as Person[]) ?? []);
      setLoading(false);
      if (k && k.type === "kunde") void ladeAkte(id);
      else setTimelineLoading(false);
    })();
    return () => { alive = false; };
  }, [id, ladeAkte]);

  async function mehrLaden() {
    if (!id) return;
    const weitere = await loadTimeline(id, { limit: SEITE, offset: entries.length });
    setEntries((prev) => [...prev, ...weitere]);
    setHasMore(weitere.length === SEITE);
  }

  async function ereignisAnlegen(input: {
    typeSlug: string; subject: string; note: string; occurredAt: string; durationMinutes: number | null;
  }) {
    if (!id) return;
    const typ = types.find((t) => t.slug === input.typeSlug);
    const neu = await logContactEvent({
      contactId: id,
      typeSlug: input.typeSlug,
      subject: input.subject,
      note: input.note,
      occurredAt: input.occurredAt,
      durationMinutes: input.durationMinutes,
      direction: typ?.direction_default ?? null,
    });
    if (!neu) { toast("Der Eintrag konnte nicht gespeichert werden."); return; }
    await ladeAkte(id);
    toast("Im Verlauf festgehalten.");
  }

  async function ereignisLoeschen(eventId: string) {
    if (!id) return;
    if (!(await deleteContactEvent(eventId))) { toast("Der Eintrag konnte nicht gelöscht werden."); return; }
    setEntries((prev) => prev.filter((e) => !(e.kind === "ereignis" && e.ref_id === eventId)));
  }

  async function wiedervorlageAnlegen() {
    if (!id || !wvTitel.trim() || !wvDatum) return;
    const ok = await createFollowUp({ contactId: id, title: wvTitel.trim(), dueDate: wvDatum });
    if (!ok) { toast("Die Wiedervorlage konnte nicht angelegt werden."); return; }
    setWvOffen(false); setWvTitel(""); setWvDatum("");
    await ladeAkte(id);
    toast("Wiedervorlage angelegt – sie erscheint auch in den Aufgaben.");
  }

  async function wiedervorlageErledigt(taskId: string) {
    if (!id) return;
    if (!(await completeFollowUp(taskId))) return;
    setFollowUps((prev) => prev.map((f) => (f.id === taskId ? { ...f, done: true } : f)));
  }

  if (loading) return <Spinner />;
  if (!c) return <Empty title="Kontakt nicht gefunden" />;

  const name = contactDisplayName(c, { withSalutation: true });
  const addr = [c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const istKunde = c.type === "kunde";
  const letzterKontakt = seitLabel((c as unknown as { last_contact_at?: string }).last_contact_at);
  const offeneWv = followUps.filter((f) => !f.done);

  const stammkarte = (
    <div className="glass p-4">
      <h3 className="mb-3 font-bold">Kontaktdaten</h3>
      <div className="space-y-3 text-sm">
        {c.company && <div className="flex items-center gap-2"><Building2 size={16} className="text-slate-400" /> {c.company}</div>}
        {c.customer_number && (
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <span className="text-slate-400">Kundennr.</span> {c.customer_number}
          </div>
        )}
        {c.email && <a className="flex items-center gap-2 hover:text-brand-600" href={`mailto:${c.email}`}><Mail size={16} className="text-slate-400" /> {c.email}</a>}
        {c.phone && <a className="flex items-center gap-2 hover:text-brand-600" href={`tel:${c.phone}`}><Phone size={16} className="text-slate-400" /> {c.phone}</a>}
        {c.mobile && <a className="flex items-center gap-2 hover:text-brand-600" href={`tel:${c.mobile}`}><Smartphone size={16} className="text-slate-400" /> {c.mobile}</a>}
        {addr && (
          <a className="flex items-center gap-2 hover:text-brand-600" target="_blank" rel="noreferrer"
             href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`}>
            <MapPin size={16} className="text-slate-400" /> {addr}
          </a>
        )}
        <div className="pt-1 text-xs text-slate-400">Anrede: {c.address_form === "du" ? "Du-Form" : "Sie-Form"}</div>
      </div>
      {c.notes && (
        <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
          {c.notes}
        </div>
      )}
    </div>
  );

  // Nicht-Kunden behalten die schlanke Ansicht (Entscheidung: Akte nur für Kunden).
  if (!istKunde) {
    return (
      <>
        <button onClick={() => nav(-1)} className="btn-ghost mb-4 px-2"><ArrowLeft size={18} /> Zurück</button>
        <PageHeader title={name} subtitle={c.company ?? undefined} action={<Badge tone="blue">{c.type}</Badge>} />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1">{stammkarte}</div>
          <div className="glass p-4 lg:col-span-2">
            <h3 className="mb-3 flex items-center gap-2 font-bold"><FolderKanban size={18} /> Projekte ({projects.length})</h3>
            {projects.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Keine Projekte mit diesem Kontakt.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-3">
                    <Link to={`/projekte/${p.id}`} className="font-medium hover:text-brand-600">{p.title}</Link>
                    <Badge tone="blue">{p.stage}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <button onClick={() => nav(-1)} className="btn-ghost mb-4 px-2"><ArrowLeft size={18} /> Zurück</button>
      <PageHeader
        title={name}
        subtitle={[c.company, c.customer_number ? `Kundennr. ${c.customer_number}` : null].filter(Boolean).join(" · ") || undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {letzterKontakt && <Badge tone={letzterKontakt.includes("Jahr") ? "amber" : "slate"}>Letzter Kontakt {letzterKontakt}</Badge>}
            <Badge tone="blue">{c.type}</Badge>
            <Link to="/kontakte" className="btn-outline px-2 py-1.5 text-xs" title="Stammdaten bearbeiten">
              <Pencil size={14} /> Stammdaten
            </Link>
          </div>
        }
      />

      {/* Kennzahlen – nur mit Beleg-Berechtigung */}
      {darfZahlen && stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KPI label="Umsatz 12 Monate" value={eur(stats.revenue_net_12m)} hint={`${stats.invoices_count} Rechnungen`} />
          <KPI label="Offene Angebote" value={String(stats.offers_open_count)} hint={eur(stats.offers_open_net)} />
          <KPI label="Offene Forderungen" value={eur(stats.open_receivables_gross)} tone={stats.open_receivables_gross > 0 ? "amber" : undefined} />
          <KPI label="Projekte" value={String(projects.length)} hint={offeneWv.length ? `${offeneWv.length} Wiedervorlagen` : undefined} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Bereichswahl: Sidebar am Desktop, Scroll-Tabs am iPad/Handy */}
        <nav className="lg:col-span-1">
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-[var(--hover)] p-1 lg:flex-col lg:bg-transparent lg:p-0">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const aktiv = section === s.key;
              const anzahl =
                s.key === "projekte" ? projects.length :
                s.key === "wiedervorlagen" ? offeneWv.length :
                s.key === "personen" ? personen.length : null;
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition lg:w-full ${
                    aktiv ? "bg-[var(--card)] shadow-sm lg:border" : "text-slate-400 hover:text-[var(--text)]"
                  }`}
                  style={aktiv ? { borderColor: "var(--border)" } : undefined}
                >
                  <Icon size={15} /> {s.label}
                  {anzahl ? <span className="ml-auto text-xs opacity-60">{anzahl}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 hidden lg:block">{stammkarte}</div>
        </nav>

        <div className="lg:col-span-3">
          {section === "verlauf" && (
            <div className="glass p-4">
              <ContactTimeline
                entries={entries}
                activityTypes={types}
                loading={timelineLoading}
                canEdit={darfSchreiben}
                hasMore={hasMore}
                onAdd={ereignisAnlegen}
                onDelete={ereignisLoeschen}
                onLoadMore={() => void mehrLaden()}
              />
            </div>
          )}

          {section === "projekte" && (
            <div className="glass p-4">
              <h3 className="mb-3 flex items-center gap-2 font-bold"><FolderKanban size={18} /> Projekte ({projects.length})</h3>
              {projects.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">Keine Projekte mit diesem Kunden.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {projects.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-3">
                      <Link to={`/projekte/${p.id}`} className="min-w-0 flex-1 font-medium hover:text-brand-600">
                        <span className="truncate">{p.title}</span>
                        {p.project_number && <span className="ml-2 text-xs text-slate-400">{p.project_number}</span>}
                      </Link>
                      <Badge tone="blue">{p.stage}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {section === "wiedervorlagen" && (
            <div className="glass p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-bold"><CalendarClock size={18} /> Wiedervorlagen</h3>
                {darfSchreiben && (
                  <button className="btn-outline px-2 py-1.5 text-xs" onClick={() => setWvOffen(true)}>
                    <Plus size={14} /> Neu
                  </button>
                )}
              </div>
              <p className="mb-3 text-xs text-slate-400">
                Wiedervorlagen sind Aufgaben mit Kundenbezug – sie erscheinen auch im Aufgaben-Board und im Dashboard.
              </p>
              {followUps.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">Nichts offen.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {followUps.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 py-2.5">
                      {darfSchreiben && !f.done && (
                        <button className="rounded p-1 text-slate-400 transition hover:text-emerald-500" title="Erledigt"
                                onClick={() => void wiedervorlageErledigt(f.id)}>
                          <Check size={16} />
                        </button>
                      )}
                      <div className={`min-w-0 flex-1 ${f.done ? "text-slate-400 line-through" : ""}`}>
                        <div className="truncate text-sm font-medium">{f.title}</div>
                        {f.description && <div className="truncate text-xs text-slate-400">{f.description}</div>}
                      </div>
                      {f.due_date && (
                        <Badge tone={!f.done && new Date(f.due_date) < new Date() ? "red" : "slate"}>
                          {new Intl.DateTimeFormat("de-AT").format(new Date(f.due_date))}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {section === "personen" && (
            <div className="glass p-4">
              <h3 className="mb-3 flex items-center gap-2 font-bold"><Users size={18} /> Ansprechpartner ({personen.length})</h3>
              {personen.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">Keine Ansprechpartner hinterlegt.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {personen.map((p) => (
                    <li key={p.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{[p.first_name, p.last_name].filter(Boolean).join(" ") || "—"}</span>
                        {p.function && <Badge tone="slate">{p.function}</Badge>}
                        {p.active === false && <Badge tone="amber">inaktiv</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                        {p.email && <a className="hover:text-brand-600" href={`mailto:${p.email}`}>{p.email}</a>}
                        {p.phone && <a className="hover:text-brand-600" href={`tel:${p.phone}`}>{p.phone}</a>}
                        {p.mobile && <a className="hover:text-brand-600" href={`tel:${p.mobile}`}>{p.mobile}</a>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {section === "zahlen" && (
            <div className="glass p-4">
              <h3 className="mb-3 flex items-center gap-2 font-bold"><BarChart3 size={18} /> Zahlen</h3>
              {!darfZahlen ? (
                <p className="py-6 text-center text-sm text-slate-400">Keine Berechtigung für Umsatzdaten.</p>
              ) : !stats ? (
                <p className="py-6 text-center text-sm text-slate-400">Keine Belege vorhanden.</p>
              ) : (
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Zeile label="Umsatz gesamt (netto)" value={eur(stats.revenue_net_total)} />
                  <Zeile label="Umsatz letzte 12 Monate" value={eur(stats.revenue_net_12m)} />
                  <Zeile label="Offene Forderungen (brutto)" value={eur(stats.open_receivables_gross)} />
                  <Zeile label="Angebote gesamt" value={`${stats.offers_count} (${stats.offers_open_count} offen)`} />
                  <Zeile label="Offenes Angebotsvolumen" value={eur(stats.offers_open_net)} />
                  <Zeile label="Aufträge" value={String(stats.orders_count)} />
                  <Zeile label="Erster Beleg" value={stats.first_document_at ? new Intl.DateTimeFormat("de-AT").format(new Date(stats.first_document_at)) : "—"} />
                  <Zeile label="Letzter Beleg" value={stats.last_document_at ? new Intl.DateTimeFormat("de-AT").format(new Date(stats.last_document_at)) : "—"} />
                </dl>
              )}
            </div>
          )}

          <div className="mt-4 lg:hidden">{stammkarte}</div>
        </div>
      </div>

      <Modal open={wvOffen} onClose={() => setWvOffen(false)} title="Wiedervorlage anlegen">
        <label className="label">Worum geht es?</label>
        <input className="input" value={wvTitel} onChange={(e) => setWvTitel(e.target.value)}
               placeholder="z. B. Angebot Zählerkasten nachfassen" autoFocus />
        <label className="label mt-3">Wann erinnern?</label>
        <input type="date" className="input" value={wvDatum} onChange={(e) => setWvDatum(e.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          {[7, 14, 30].map((t) => (
            <button key={t} className="btn-ghost px-2 py-1 text-xs"
                    onClick={() => setWvDatum(new Date(Date.now() + t * 86_400_000).toISOString().slice(0, 10))}>
              in {t} Tagen
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-outline" onClick={() => setWvOffen(false)}>Abbrechen</button>
          <button className="btn-primary" disabled={!wvTitel.trim() || !wvDatum} onClick={() => void wiedervorlageAnlegen()}>
            Anlegen
          </button>
        </div>
      </Modal>
    </>
  );
}

function KPI({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "amber" }) {
  return (
    <div className="glass p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold" style={tone === "amber" ? { color: "var(--c-amber)" } : undefined}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function Zeile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)" }}>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  );
}
