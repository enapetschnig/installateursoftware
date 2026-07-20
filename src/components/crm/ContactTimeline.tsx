// ============================================================
// Installateur SuperAPP – Kunden-Zeitstrahl (CRM)
// ------------------------------------------------------------
// Zeigt ALLE Berührungspunkte mit einem Kontakt in einem Strang:
// erfasste Gespräche/Notizen, Angebote, Aufträge, Rechnungen, Projekte,
// Anfragen (inkl. Anruf-Transkript), Termine, Regieberichte, Mails,
// Wiedervorlagen. Quelle ist die View `contact_timeline` (Migration 0159) –
// dadurch rückwirkend gefüllt, ohne Datenkopien.
//
// Erfassung bewusst INLINE (kein Modal): je höher die Schwelle, desto
// weniger wird notiert – und ein CRM lebt von den Notizen.
// ============================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Phone, PhoneIncoming, PhoneOutgoing, Mail, MapPin, Users, StickyNote,
  AlertTriangle, Clock, FileText, Inbox, Calendar, ClipboardList,
  FolderKanban, CheckSquare, Search, Plus, Trash2, ChevronRight,
} from "lucide-react";
import { eur } from "../../lib/format";
import { Badge, Empty } from "../ui";
import type { ActivityType, TimelineEntry } from "../../lib/crm";
import { TIMELINE_FILTER } from "../../lib/crm";

const ICONS: Record<string, typeof Phone> = {
  "phone-incoming": PhoneIncoming,
  "phone-outgoing": PhoneOutgoing,
  phone: Phone,
  mail: Mail,
  send: Mail,
  "map-pin": MapPin,
  users: Users,
  "sticky-note": StickyNote,
  "alert-triangle": AlertTriangle,
  clock: Clock,
  "file-text": FileText,
  inbox: Inbox,
  calendar: Calendar,
  "clipboard-list": ClipboardList,
  "folder-kanban": FolderKanban,
  "check-square": CheckSquare,
};

const TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red"> = {
  slate: "slate", blue: "blue", green: "green", amber: "amber", red: "red", violet: "blue",
};

const dtf = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
const tf = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" });
const monatLabel = (iso: string) =>
  new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric" }).format(new Date(iso));

export default function ContactTimeline({
  entries, activityTypes, loading, canEdit, hasMore,
  onAdd, onDelete, onLoadMore,
}: {
  entries: TimelineEntry[];
  activityTypes: ActivityType[];
  loading: boolean;
  canEdit: boolean;
  hasMore: boolean;
  onAdd: (input: { typeSlug: string; subject: string; note: string; occurredAt: string; durationMinutes: number | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLoadMore: () => void;
}) {
  const [filter, setFilter] = useState<keyof typeof TIMELINE_FILTER>("alles");
  const [suche, setSuche] = useState("");
  const [erfassen, setErfassen] = useState(false);
  const [typSlug, setTypSlug] = useState("");
  const [betreff, setBetreff] = useState("");
  const [notiz, setNotiz] = useState("");
  const [datum, setDatum] = useState(() => new Date().toISOString().slice(0, 16));
  const [dauer, setDauer] = useState("");
  const [speichert, setSpeichert] = useState(false);

  const gefiltert = useMemo(() => {
    const kinds = TIMELINE_FILTER[filter] ?? [];
    const n = suche.trim().toLowerCase();
    return entries.filter((e) => {
      if (kinds.length && !kinds.includes(e.kind)) return false;
      if (!n) return true;
      return [e.title, e.subtitle, e.note, e.status].filter(Boolean).some((v) => String(v).toLowerCase().includes(n));
    });
  }, [entries, filter, suche]);

  // Nach Monat gruppieren – so liest sich der Strang wie ein Tagebuch.
  const gruppen = useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const e of gefiltert) {
      const k = monatLabel(e.occurred_at);
      const list = map.get(k) ?? [];
      list.push(e);
      map.set(k, list);
    }
    return [...map.entries()];
  }, [gefiltert]);

  async function speichern() {
    if (!typSlug || (!betreff.trim() && !notiz.trim())) return;
    setSpeichert(true);
    await onAdd({
      typeSlug: typSlug,
      subject: betreff,
      note: notiz,
      occurredAt: new Date(datum).toISOString(),
      durationMinutes: dauer.trim() ? Math.max(0, Number(dauer) || 0) : null,
    });
    setSpeichert(false);
    setBetreff(""); setNotiz(""); setDauer("");
    setErfassen(false);
  }

  return (
    <div>
      {/* Erfassung – ein Klick, kein Modal */}
      {canEdit && (
        <div className="mb-4">
          {!erfassen ? (
            <button
              className="btn-outline w-full justify-start py-3 text-sm text-slate-500"
              onClick={() => { setErfassen(true); setTypSlug(activityTypes[0]?.slug ?? ""); }}
              data-testid="crm-erfassen-oeffnen"
            >
              <Plus size={16} /> Gespräch, Notiz oder Telefonat festhalten …
            </button>
          ) : (
            <div className="rounded-2xl border p-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="flex flex-wrap gap-1.5">
                {activityTypes.map((t) => {
                  const Icon = ICONS[t.icon ?? ""] ?? StickyNote;
                  const aktiv = typSlug === t.slug;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTypSlug(t.slug)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                        aktiv ? "border-brand-400 bg-brand-50/60 dark:bg-brand-500/15" : "text-slate-500 hover:border-brand-300"
                      }`}
                      style={{ borderColor: aktiv ? undefined : "var(--border)" }}
                    >
                      <Icon size={13} /> {t.label}
                    </button>
                  );
                })}
              </div>
              <input
                className="input mt-3 text-sm"
                placeholder="Kurz: worum ging es? (z. B. Zählerkasten E-Auto)"
                value={betreff}
                onChange={(e) => setBetreff(e.target.value)}
                data-testid="crm-betreff"
              />
              <textarea
                className="input mt-2 min-h-[90px] text-sm"
                placeholder="Was wurde besprochen? Vereinbarungen, Zusagen, offene Punkte …"
                value={notiz}
                onChange={(e) => setNotiz(e.target.value)}
                data-testid="crm-notiz"
              />
              <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <label className="flex items-center gap-1.5">
                    Wann
                    <input type="datetime-local" className="input w-auto py-1 text-xs" value={datum} onChange={(e) => setDatum(e.target.value)} />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Dauer
                    <input type="number" min={0} className="input w-20 py-1 text-xs" placeholder="Min" value={dauer} onChange={(e) => setDauer(e.target.value)} />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button className="btn-ghost" onClick={() => setErfassen(false)}>Abbrechen</button>
                  <button
                    className="btn-primary"
                    disabled={speichert || !typSlug || (!betreff.trim() && !notiz.trim())}
                    onClick={() => void speichern()}
                    data-testid="crm-speichern"
                  >
                    Festhalten
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter + Suche */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--hover)] p-1">
          {(Object.keys(TIMELINE_FILTER) as Array<keyof typeof TIMELINE_FILTER>).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold capitalize transition ${
                filter === k ? "bg-[var(--card)] shadow-sm" : "text-slate-400 hover:text-[var(--text)]"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="relative min-w-[160px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-8 py-1.5 text-sm" placeholder="Im Verlauf suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
        </div>
      </div>

      {/* Zeitstrahl */}
      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">Verlauf wird geladen …</div>
      ) : gruppen.length === 0 ? (
        <Empty
          title="Noch kein Verlauf"
          hint={suche || filter !== "alles" ? "Keine Treffer – Filter zurücksetzen." : "Sobald Angebote, Termine oder Gespräche dazukommen, stehen sie hier."}
        />
      ) : (
        <div className="space-y-6">
          {gruppen.map(([monat, eintraege]) => (
            <div key={monat}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{monat}</div>
              <div className="relative space-y-2 border-l pl-4" style={{ borderColor: "var(--border)" }}>
                {eintraege.map((e) => {
                  const Icon = ICONS[e.icon ?? ""] ?? StickyNote;
                  const tone = TONE[e.color ?? "slate"] ?? "slate";
                  const inhalt = (
                    <div className="rounded-xl border p-2.5 transition hover:border-brand-300" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 rounded-lg p-1.5" style={{ background: "var(--hover)", color: "var(--accent)" }}>
                          <Icon size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold">{e.title}</span>
                            {e.status && <Badge tone={tone}>{e.status}</Badge>}
                            {e.duration_minutes ? <span className="text-[11px] text-slate-400">{e.duration_minutes} Min.</span> : null}
                          </div>
                          {e.subtitle && <div className="truncate text-[11px] text-slate-400">{e.subtitle}</div>}
                          {e.note && <div className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{e.note}</div>}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[11px] text-slate-400">
                            {dtf.format(new Date(e.occurred_at))}
                            <span className="ml-1 opacity-70">{tf.format(new Date(e.occurred_at))}</span>
                          </div>
                          {e.amount_gross ? <div className="text-sm font-semibold text-[var(--accent)]">{eur(e.amount_gross)}</div> : null}
                        </div>
                        {e.kind === "ereignis" && canEdit && (
                          <button
                            className="shrink-0 rounded p-1 text-slate-300 transition hover:text-rose-500"
                            title="Eintrag löschen"
                            onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); void onDelete(e.ref_id); }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                        {e.route && <ChevronRight size={14} className="mt-1 shrink-0 text-slate-300" />}
                      </div>
                    </div>
                  );
                  return e.route ? (
                    <Link key={`${e.kind}-${e.ref_id}`} to={e.route} className="block">{inhalt}</Link>
                  ) : (
                    <div key={`${e.kind}-${e.ref_id}`}>{inhalt}</div>
                  );
                })}
              </div>
            </div>
          ))}
          {hasMore && (
            <button className="btn-outline w-full" onClick={onLoadMore}>Ältere Einträge laden</button>
          )}
        </div>
      )}
    </div>
  );
}
