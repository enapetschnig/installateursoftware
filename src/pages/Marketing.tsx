// ============================================================
// Installateur SuperAPP – Marketing
// ------------------------------------------------------------
// Vier Bereiche:
//   • Übersicht      – Kennzahlen, nächste Beiträge, Kampagnen-Leistung
//   • Redaktionsplan – Beiträge als Liste ODER Monatskalender, Beitrag anlegen
//                      mit echtem KI-Textvorschlag + Live-Vorschau (FB/Instagram)
//   • Werbeanzeigen  – Kampagnen (Budget, Laufzeit, Zielgruppe, Ergebnisse)
//   • Kanäle         – Verbindungszustand der Plattformen
//
// EHRLICHE ABGRENZUNG: Beiträge werden hier geplant, nicht automatisch
// veröffentlicht. Solange kein Kanal verbunden ist, ist "Veröffentlicht" ein
// bewusster manueller Statuswechsel. Die UI behauptet nirgends, gepostet zu haben.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  Megaphone, Plus, Trash2, Pencil, Sparkles, CalendarDays, List, Image as ImageIcon,
  Facebook, Instagram, ThumbsUp, MessageCircle, Share2, Target, Plug, Link2, Clock,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "../components/ui";
import { ConfirmDialog, ErrorBanner } from "../components/calc-ui";
import { useCan } from "../lib/permissions";
import { eur, dateAt } from "../lib/format";
import { toast, toastError } from "../lib/toast";
import {
  type SocialPost, type AdCampaign, type SocialAccount, type Platform, type PostStatus,
  type CampaignStatus, type CampaignObjective,
  POST_STATUS_LABEL, POST_STATUS_TONE, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE,
  OBJECTIVE_LABEL, PLATFORM_LABEL, IMAGE_ACCEPT,
  listPosts, createPost, updatePost, deletePost,
  listCampaigns, createCampaign, updateCampaign, deleteCampaign,
  listAccounts, uploadPostImage, postImageUrl, generatePost,
  sumPostMetric, sumCampaignMetric,
} from "../lib/marketing";

type Tab = "uebersicht" | "beitraege" | "anzeigen" | "kanaele";

const nf = (n: number) => new Intl.NumberFormat("de-AT").format(Math.round(n));
const dateTimeAt = (s: string | null) =>
  s ? new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(s)) : "–";

export default function Marketing() {
  const can = useCan();
  const mayEdit = can("marketing", "edit");
  const mayCreate = can("marketing", "create");
  const mayDelete = can("marketing", "delete");

  const [tab, setTab] = useState<Tab>("uebersicht");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [company, setCompany] = useState("Ihr Betrieb");

  const [editPost, setEditPost] = useState<SocialPost | "new" | null>(null);
  const [editCamp, setEditCamp] = useState<AdCampaign | "new" | null>(null);
  const [delPost, setDelPost] = useState<SocialPost | null>(null);
  const [delCamp, setDelCamp] = useState<AdCampaign | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(initial = false) {
    if (initial) setLoading(true);
    setErr(null);
    try {
      const [p, c, a, cs] = await Promise.all([
        listPosts(), listCampaigns(), listAccounts(),
        supabase.from("company_settings").select("name").limit(1).maybeSingle(),
      ]);
      setPosts(p); setCampaigns(c); setAccounts(a);
      if (cs.data?.name) setCompany(cs.data.name as string);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Marketing konnte nicht geladen werden.");
    } finally {
      if (initial) setLoading(false);
    }
  }
  useEffect(() => { load(true); }, []);

  const anyConnected = accounts.some((a) => a.status === "verbunden");

  const kpis = useMemo(() => {
    const published = posts.filter((p) => p.status === "veroeffentlicht");
    const active = campaigns.filter((c) => c.status === "aktiv");
    return {
      geplant: posts.filter((p) => p.status === "geplant").length,
      veroeffentlicht: published.length,
      reichweite: sumPostMetric(published, "reach"),
      aktiveKampagnen: active.length,
      ausgegeben: sumCampaignMetric(campaigns, "spend"),
      budget: campaigns.reduce((s, c) => s + Number(c.budget_total ?? 0), 0),
      leads: sumCampaignMetric(campaigns, "leads"),
    };
  }, [posts, campaigns]);

  const upcoming = useMemo(
    () => posts.filter((p) => p.status === "geplant" && p.scheduled_at)
      .sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1)).slice(0, 5),
    [posts],
  );

  async function confirmDelPost() {
    if (!delPost) return;
    setBusy(true);
    try { await deletePost(delPost.id); toast("Beitrag gelöscht."); setDelPost(null); load(); }
    catch (e) { toastError(e instanceof Error ? e.message : "Löschen fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  async function confirmDelCamp() {
    if (!delCamp) return;
    setBusy(true);
    try { await deleteCampaign(delCamp.id); toast("Kampagne gelöscht."); setDelCamp(null); load(); }
    catch (e) { toastError(e instanceof Error ? e.message : "Löschen fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="pt-4"><Spinner /></div>;

  return (
    <div className="pt-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Megaphone size={22} style={{ color: "var(--accent)" }} /> Marketing
          </h1>
          <ErrorBanner message={err} />
          <p className="mt-0.5 text-sm text-slate-400">
            Beiträge planen, mit KI texten und Werbeanzeigen steuern
          </p>
        </div>
        {tab === "beitraege" && mayCreate && (
          <button className="btn-primary" data-tour-id="marketing-new-post" onClick={() => setEditPost("new")}><Plus size={16} /> Neuer Beitrag</button>
        )}
        {tab === "anzeigen" && mayCreate && (
          <button className="btn-primary" onClick={() => setEditCamp("new")}><Plus size={16} /> Neue Kampagne</button>
        )}
      </div>

      {/* Tabs */}
      <div className="glass mb-4 flex gap-1 overflow-x-auto p-1">
        {([["uebersicht", "Übersicht"], ["beitraege", "Redaktionsplan"], ["anzeigen", "Werbeanzeigen"], ["kanaele", "Kanäle"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-tour-id={`marketing-tab-${k}`}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === k ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
            style={tab === k ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
            {l}
          </button>
        ))}
      </div>

      {tab === "uebersicht" && (
        <Uebersicht kpis={kpis} upcoming={upcoming} campaigns={campaigns} company={company} />
      )}

      {tab === "beitraege" && (
        <Redaktionsplan
          posts={posts} company={company} mayEdit={mayEdit} mayDelete={mayDelete}
          onOpen={(p) => setEditPost(p)} onDelete={(p) => setDelPost(p)} anyConnected={anyConnected}
        />
      )}

      {tab === "anzeigen" && (
        <Anzeigen campaigns={campaigns} mayEdit={mayEdit} mayDelete={mayDelete}
          onOpen={(c) => setEditCamp(c)} onDelete={(c) => setDelCamp(c)} />
      )}

      {tab === "kanaele" && <Kanaele accounts={accounts} />}

      {editPost !== null && (
        <PostModal
          value={editPost === "new" ? null : editPost}
          campaigns={campaigns} company={company} canEdit={editPost === "new" ? mayCreate : mayEdit}
          anyConnected={anyConnected}
          onClose={() => setEditPost(null)}
          onSaved={() => load()}
        />
      )}
      {editCamp !== null && (
        <CampaignModal
          value={editCamp === "new" ? null : editCamp}
          canEdit={editCamp === "new" ? mayCreate : mayEdit}
          onClose={() => setEditCamp(null)}
          onSaved={() => load()}
        />
      )}

      <ConfirmDialog open={!!delPost} title="Beitrag löschen?" confirmLabel="Löschen"
        message={<><b>{delPost?.title || "Beitrag"}</b> wird endgültig gelöscht.</>}
        busy={busy} onConfirm={confirmDelPost} onClose={() => setDelPost(null)} />
      <ConfirmDialog open={!!delCamp} title="Kampagne löschen?" confirmLabel="Löschen"
        message={<><b>{delCamp?.name}</b> wird endgültig gelöscht.</>}
        busy={busy} onConfirm={confirmDelCamp} onClose={() => setDelCamp(null)} />
    </div>
  );
}

// ── KPI-Kachel ────────────────────────────────────────────────────────
function Kpi({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="glass rounded-xl p-3 text-center">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

// ── Übersicht ─────────────────────────────────────────────────────────
function Uebersicht({ kpis, upcoming, campaigns, company }: {
  kpis: { geplant: number; veroeffentlicht: number; reichweite: number; aktiveKampagnen: number; ausgegeben: number; budget: number; leads: number };
  upcoming: SocialPost[]; campaigns: AdCampaign[]; company: string;
}) {
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi value={String(kpis.geplant)} label="Geplante Beiträge" sub="im Redaktionsplan" />
        <Kpi value={nf(kpis.reichweite)} label="Reichweite" sub={`aus ${kpis.veroeffentlicht} Beiträgen`} />
        <Kpi value={String(kpis.aktiveKampagnen)} label="Aktive Kampagnen" sub={`${kpis.leads} Anfragen`} />
        <Kpi value={eur(kpis.ausgegeben)} label="Werbebudget genutzt" sub={`von ${eur(kpis.budget)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="glass p-4">
          <h2 className="mb-3 flex items-center gap-2 font-bold"><Clock size={16} style={{ color: "var(--accent)" }} /> Als Nächstes geplant</h2>
          {upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Keine geplanten Beiträge.</p>
          ) : (
            <ul className="space-y-2.5">
              {upcoming.map((p) => (
                <li key={p.id} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    <CalendarDays size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{p.title || "Ohne Titel"}</div>
                    <div className="text-[11px] text-slate-400">
                      {dateTimeAt(p.scheduled_at)} · {p.platforms.map((x) => PLATFORM_LABEL[x]).join(", ")}
                    </div>
                  </div>
                  <Badge tone={POST_STATUS_TONE[p.status]}>{POST_STATUS_LABEL[p.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass p-4">
          <h2 className="mb-3 flex items-center gap-2 font-bold"><Target size={16} style={{ color: "var(--accent)" }} /> Kampagnen-Leistung</h2>
          {campaigns.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Noch keine Kampagnen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <tr><th className="pb-2">Kampagne</th><th className="pb-2 text-right">Klicks</th><th className="pb-2 text-right">Anfragen</th><th className="pb-2 text-right">Kosten/Anfrage</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {campaigns.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2">
                        <div className="max-w-[180px] truncate font-medium">{c.name}</div>
                        <Badge tone={CAMPAIGN_STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
                      </td>
                      <td className="py-2 text-right tabular-nums">{nf(c.metrics?.clicks ?? 0)}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">{nf(c.metrics?.leads ?? 0)}</td>
                      <td className="py-2 text-right tabular-nums">{c.metrics?.cpl ? eur(c.metrics.cpl) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-400">Zahlen aus den hinterlegten Kampagnendaten von {company}.</p>
        </div>
      </div>
    </>
  );
}

// ── Redaktionsplan (Liste + Kalender) ─────────────────────────────────
const POST_FILTERS: { key: "alle" | PostStatus; label: string }[] = [
  { key: "alle", label: "Alle" }, { key: "entwurf", label: "Entwürfe" },
  { key: "geplant", label: "Geplant" }, { key: "veroeffentlicht", label: "Veröffentlicht" },
];

function Redaktionsplan({ posts, company, mayEdit, mayDelete, onOpen, onDelete, anyConnected }: {
  posts: SocialPost[]; company: string; mayEdit: boolean; mayDelete: boolean;
  onOpen: (p: SocialPost) => void; onDelete: (p: SocialPost) => void; anyConnected: boolean;
}) {
  const [filter, setFilter] = useState<"alle" | PostStatus>("alle");
  const [view, setView] = useState<"liste" | "kalender">("liste");
  const shown = useMemo(() => posts.filter((p) => filter === "alle" || p.status === filter), [posts, filter]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="glass flex gap-1 p-1">
          {POST_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filter === f.key ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
              style={filter === f.key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="glass ml-auto flex gap-1 p-1">
          <button onClick={() => setView("liste")} title="Liste"
            className={`rounded-lg px-2.5 py-1.5 transition ${view === "liste" ? "text-white" : "text-slate-500"}`}
            style={view === "liste" ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
            <List size={16} />
          </button>
          <button onClick={() => setView("kalender")} title="Kalender"
            className={`rounded-lg px-2.5 py-1.5 transition ${view === "kalender" ? "text-white" : "text-slate-500"}`}
            style={view === "kalender" ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
            <CalendarDays size={16} />
          </button>
        </div>
      </div>

      {!anyConnected && (
        <div className="glass mb-3 flex items-center gap-2 p-3 text-xs text-slate-500">
          <Plug size={14} style={{ color: "var(--accent)" }} />
          Noch kein Kanal verbunden — Beiträge werden geplant und freigegeben, die Veröffentlichung erfolgt nach der Kanal-Verbindung.
        </div>
      )}

      {shown.length === 0 ? (
        <Empty title="Keine Beiträge" hint="Lege deinen ersten Beitrag an — die KI hilft beim Text." />
      ) : view === "kalender" ? (
        <MonthCalendar posts={shown} onOpen={onOpen} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((p) => (
            <article key={p.id} className="glass flex flex-col p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{p.title || "Ohne Titel"}</h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <span>{p.scheduled_at ? dateTimeAt(p.scheduled_at) : p.published_at ? `veröffentlicht ${dateAt(p.published_at)}` : "kein Termin"}</span>
                    {p.platforms.map((pl) => (
                      <span key={pl} className="inline-flex items-center gap-1">
                        {pl === "facebook" ? <Facebook size={11} /> : <Instagram size={11} />}{PLATFORM_LABEL[pl]}
                      </span>
                    ))}
                  </div>
                </div>
                <Badge tone={POST_STATUS_TONE[p.status]}>{POST_STATUS_LABEL[p.status]}</Badge>
              </div>
              <p className="line-clamp-3 whitespace-pre-line text-sm text-slate-500 dark:text-slate-400">{p.content}</p>
              {p.hashtags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.hashtags.slice(0, 5).map((h) => (
                    <span key={h} className="text-[11px]" style={{ color: "var(--accent)" }}>#{h}</span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t pt-2 text-[11px] text-slate-400" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-3">
                  {p.status === "veroeffentlicht" ? (
                    <>
                      <span className="inline-flex items-center gap-1"><ThumbsUp size={12} /> {nf(p.metrics?.likes ?? 0)}</span>
                      <span className="inline-flex items-center gap-1"><MessageCircle size={12} /> {nf(p.metrics?.comments ?? 0)}</span>
                      <span className="inline-flex items-center gap-1"><Share2 size={12} /> {nf(p.metrics?.shares ?? 0)}</span>
                    </>
                  ) : p.ai_generated ? (
                    <span className="inline-flex items-center gap-1"><Sparkles size={12} /> KI-Text</span>
                  ) : <span>{company}</span>}
                </div>
                <div className="flex items-center gap-1">
                  {mayEdit && <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => onOpen(p)}><Pencil size={14} /></button>}
                  {mayDelete && <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => onDelete(p)}><Trash2 size={14} /></button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

// ── Monatskalender ────────────────────────────────────────────────────
function MonthCalendar({ posts, onOpen }: { posts: SocialPost[]; onOpen: (p: SocialPost) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const first = month;
  const startOffset = (first.getDay() + 6) % 7; // Montag = 0
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const byDay = new Map<string, SocialPost[]>();
  for (const p of posts) {
    const ts = p.scheduled_at || p.published_at;
    if (!ts) continue;
    const d = new Date(ts);
    const k = key(d);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const monthLabel = new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric" }).format(month);
  const today = new Date();

  return (
    <div className="glass p-3">
      <div className="mb-3 flex items-center justify-between">
        <button className="btn-outline px-2 py-1 text-xs" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>Zurück</button>
        <div className="font-semibold capitalize">{monthLabel}</div>
        <button className="btn-outline px-2 py-1 text-xs" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Weiter</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => <div key={d} className="pb-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="min-h-[84px] rounded-lg" />;
          const list = byDay.get(key(d)) ?? [];
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div key={key(d)} className="min-h-[84px] rounded-lg border p-1"
              style={{ borderColor: isToday ? "var(--accent)" : "var(--border)" }}>
              <div className={`px-1 text-[11px] tabular-nums ${isToday ? "font-bold" : "text-slate-400"}`}
                style={isToday ? { color: "var(--accent)" } : undefined}>{d.getDate()}</div>
              <div className="mt-0.5 space-y-0.5">
                {list.slice(0, 3).map((p) => (
                  <button key={p.id} onClick={() => onOpen(p)}
                    title={p.title || "Beitrag"}
                    className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium"
                    style={{
                      background: p.status === "veroeffentlicht" ? "color-mix(in srgb, var(--c-green,#22c55e) 16%, transparent)" : "var(--accent-soft)",
                      color: p.status === "veroeffentlicht" ? "var(--c-green,#16a34a)" : "var(--accent)",
                    }}>
                    {p.title || "Beitrag"}
                  </button>
                ))}
                {list.length > 3 && <div className="px-1 text-[10px] text-slate-400">+{list.length - 3} mehr</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Live-Vorschau (Facebook / Instagram) ──────────────────────────────
function PostPreview({ platform, company, title, content, hashtags, imageUrl }: {
  platform: Platform; company: string; title: string; content: string; hashtags: string[]; imageUrl: string;
}) {
  const initial = company.trim().charAt(0).toUpperCase() || "B";
  const tagLine = hashtags.length ? hashtags.map((h) => `#${h}`).join(" ") : "";
  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-[#242526]" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2.5 p-3">
        <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white"
          style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}>{initial}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{company}</div>
          <div className="text-[11px] text-slate-400">
            {platform === "facebook" ? "Gerade eben · Öffentlich" : "Gerade eben"}
          </div>
        </div>
        <span className="ml-auto shrink-0 text-slate-400">
          {platform === "facebook" ? <Facebook size={16} /> : <Instagram size={16} />}
        </span>
      </div>

      {platform === "facebook" && (
        <div className="px-3 pb-2 text-sm text-slate-800 dark:text-slate-200">
          {title && <div className="mb-1 font-semibold">{title}</div>}
          <p className="whitespace-pre-line">{content || <span className="text-slate-400">Der Beitragstext erscheint hier …</span>}</p>
          {tagLine && <p className="mt-1.5" style={{ color: "#1877F2" }}>{tagLine}</p>}
        </div>
      )}

      {imageUrl ? (
        <img src={imageUrl} alt="" className="max-h-72 w-full object-cover" />
      ) : (
        <div className="grid h-40 place-items-center bg-slate-100 text-slate-300 dark:bg-white/5 dark:text-slate-600">
          <ImageIcon size={28} />
        </div>
      )}

      {platform === "instagram" && (
        <div className="px-3 py-2 text-sm text-slate-800 dark:text-slate-200">
          <div className="mb-1 flex items-center gap-3 text-slate-500">
            <ThumbsUp size={16} /> <MessageCircle size={16} /> <Share2 size={16} />
          </div>
          <p className="whitespace-pre-line"><b>{company.toLowerCase().replace(/\s+/g, "")}</b> {content || <span className="text-slate-400">Bildunterschrift …</span>}</p>
          {tagLine && <p className="mt-1" style={{ color: "#00376B" }}>{tagLine}</p>}
        </div>
      )}

      {platform === "facebook" && (
        <div className="flex items-center justify-around border-t py-1.5 text-xs font-medium text-slate-500" style={{ borderColor: "var(--border)" }}>
          <span className="inline-flex items-center gap-1.5"><ThumbsUp size={15} /> Gefällt mir</span>
          <span className="inline-flex items-center gap-1.5"><MessageCircle size={15} /> Kommentieren</span>
          <span className="inline-flex items-center gap-1.5"><Share2 size={15} /> Teilen</span>
        </div>
      )}
    </div>
  );
}

// ── Beitrag anlegen/bearbeiten ────────────────────────────────────────
const TONES = ["freundlich", "professionell", "locker", "werblich", "informativ"] as const;

function PostModal({ value, campaigns, company, canEdit, anyConnected, onClose, onSaved }: {
  value: SocialPost | null; campaigns: AdCampaign[]; company: string; canEdit: boolean;
  anyConnected: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(value?.title ?? "");
  const [content, setContent] = useState(value?.content ?? "");
  const [hashtags, setHashtags] = useState((value?.hashtags ?? []).join(", "));
  const [platforms, setPlatforms] = useState<Platform[]>(value?.platforms ?? ["facebook"]);
  const [status, setStatus] = useState<PostStatus>(value?.status ?? "entwurf");
  const [scheduled, setScheduled] = useState(value?.scheduled_at ? value.scheduled_at.slice(0, 16) : "");
  const [linkUrl, setLinkUrl] = useState(value?.link_url ?? "");
  const [campaignId, setCampaignId] = useState(value?.campaign_id ?? "");
  const [imagePath, setImagePath] = useState(value?.image_path ?? "");
  const [imageUrl, setImageUrl] = useState("");
  const [aiGenerated, setAiGenerated] = useState(value?.ai_generated ?? false);

  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("freundlich");
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [timeHint, setTimeHint] = useState<string | null>(null);

  const previewPlatform: Platform = platforms.includes("facebook") ? "facebook" : "instagram";

  useEffect(() => { postImageUrl(imagePath).then(setImageUrl); }, [imagePath]);

  function togglePlatform(p: Platform) {
    setPlatforms((prev) => (prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p]));
  }

  async function runAi() {
    if (!topic.trim()) { toastError("Bitte kurz das Thema beschreiben."); return; }
    setGenerating(true);
    try {
      const g = await generatePost({ topic, platform: previewPlatform, tone, company });
      setTitle(g.title);
      setContent(g.content);
      setHashtags(g.hashtags.join(", "));
      setTimeHint(g.best_time_hint);
      setAiGenerated(true);
      toast("KI-Vorschlag erstellt — jetzt anpassen und planen.");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "KI-Vorschlag fehlgeschlagen.");
    } finally { setGenerating(false); }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setUploading(true);
    try { setImagePath(await uploadPostImage(file)); toast("Bild hochgeladen."); }
    catch (err) { toastError(err instanceof Error ? err.message : "Upload fehlgeschlagen."); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!canEdit) return;
    if (!content.trim()) { toastError("Der Beitragstext darf nicht leer sein."); return; }
    setBusy(true);
    try {
      const payload = {
        title: title.trim() || null,
        content: content.trim(),
        platforms,
        status,
        scheduled_at: status === "geplant" && scheduled ? new Date(scheduled).toISOString() : null,
        link_url: linkUrl.trim() || null,
        hashtags: hashtags.split(",").map((h) => h.trim().replace(/^#/, "")).filter(Boolean),
        image_path: imagePath || null,
        ai_generated: aiGenerated,
        campaign_id: campaignId || null,
      };
      if (value) {
        await updatePost(value.id, {
          ...payload,
          published_at: status === "veroeffentlicht" ? (value.published_at ?? new Date().toISOString()) : null,
        });
        toast("Beitrag gespeichert.");
      } else {
        await createPost(payload);
        toast("Beitrag angelegt.");
      }
      onSaved();
      onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={value ? "Beitrag bearbeiten" : "Neuer Beitrag"} size="2xl">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_.85fr]" data-tour-id="marketing-post-modal">
        {/* Formular */}
        <div className="space-y-3">
          {/* KI-Assistent */}
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--accent)" }}>
              <Sparkles size={15} /> Text mit KI erstellen
            </div>
            <textarea className="input min-h-[60px] text-sm" data-tour-id="marketing-ai-topic" value={topic} onChange={(e) => setTopic(e.target.value)}
              placeholder="Worum geht es? z. B. „Vorher/Nachher Badsanierung in Linz, 9 Tage, bodengleiche Dusche“"
              disabled={!canEdit || generating} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className="input max-w-[11rem] text-sm" value={tone} onChange={(e) => setTone(e.target.value as typeof tone)} disabled={!canEdit}>
                {TONES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
              <button className="btn-primary text-sm" data-tour-id="marketing-ai-generate" onClick={runAi} disabled={!canEdit || generating}>
                <Sparkles size={15} /> {generating ? "Schreibt …" : "Vorschlag erstellen"}
              </button>
              {timeHint && <span className="text-[11px] text-slate-500">Empfohlen: {timeHint}</span>}
            </div>
          </div>

          <label className="flex flex-col text-sm">
            <span className="label">Titel (intern)</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
          </label>

          <label className="flex flex-col text-sm">
            <span className="label">Beitragstext</span>
            <textarea className="input min-h-[150px]" value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="Der Text, den Ihre Kunden lesen …" disabled={!canEdit} />
          </label>

          <label className="flex flex-col text-sm">
            <span className="label">Hashtags (mit Komma getrennt)</span>
            <input className="input" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="badsanierung, linz, handwerk" disabled={!canEdit} />
          </label>

          <div>
            <span className="label">Kanäle</span>
            <div className="mt-1 flex gap-2">
              {(["facebook", "instagram"] as Platform[]).map((p) => {
                const on = platforms.includes(p);
                return (
                  <button key={p} type="button" onClick={() => canEdit && togglePlatform(p)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${on ? "text-white" : "text-slate-500"}`}
                    style={on ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))", borderColor: "transparent" } : { borderColor: "var(--border)" }}>
                    {p === "facebook" ? <Facebook size={14} /> : <Instagram size={14} />} {PLATFORM_LABEL[p]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col text-sm">
              <span className="label">Status</span>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as PostStatus)} disabled={!canEdit}>
                <option value="entwurf">Entwurf</option>
                <option value="geplant">Geplant</option>
                <option value="veroeffentlicht">Veröffentlicht</option>
                <option value="archiviert">Archiviert</option>
              </select>
            </label>
            <label className="flex flex-col text-sm">
              <span className="label">Veröffentlichen am</span>
              <input type="datetime-local" className="input" value={scheduled} onChange={(e) => setScheduled(e.target.value)}
                disabled={!canEdit || status !== "geplant"} />
            </label>
          </div>

          {status === "geplant" && !anyConnected && (
            <p className="text-[11px] text-slate-500">
              Hinweis: Der Termin wird gespeichert. Automatisch gepostet wird erst, wenn der Kanal verbunden ist.
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col text-sm">
              <span className="label">Link (optional)</span>
              <input className="input" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" disabled={!canEdit} />
            </label>
            <label className="flex flex-col text-sm">
              <span className="label">Kampagne (optional)</span>
              <select className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!canEdit}>
                <option value="">– keine –</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          {canEdit && (
            <label className={`btn-outline inline-flex cursor-pointer text-sm ${uploading ? "pointer-events-none opacity-60" : ""}`}>
              <ImageIcon size={15} /> {uploading ? "Lädt …" : imagePath ? "Bild ersetzen" : "Bild hinzufügen"}
              <input type="file" className="hidden" accept={IMAGE_ACCEPT} onChange={onUpload} />
            </label>
          )}
        </div>

        {/* Live-Vorschau */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Link2 size={13} /> Live-Vorschau
          </div>
          <PostPreview platform={previewPlatform} company={company} title={title}
            content={content} hashtags={hashtags.split(",").map((h) => h.trim().replace(/^#/, "")).filter(Boolean)}
            imageUrl={imageUrl} />
          <p className="mt-2 text-[11px] text-slate-400">So sieht der Beitrag für Ihre Kunden aus.</p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>Abbrechen</button>
        {canEdit && (
          <button className="btn-primary" data-tour-id="marketing-post-save" onClick={save} disabled={busy}>
            {busy ? "Speichere …" : value ? "Speichern" : "Beitrag anlegen"}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── Werbeanzeigen ─────────────────────────────────────────────────────
function Anzeigen({ campaigns, mayEdit, mayDelete, onOpen, onDelete }: {
  campaigns: AdCampaign[]; mayEdit: boolean; mayDelete: boolean;
  onOpen: (c: AdCampaign) => void; onDelete: (c: AdCampaign) => void;
}) {
  if (campaigns.length === 0) return <Empty title="Keine Kampagnen" hint="Lege eine Werbekampagne an, um Anfragen zu gewinnen." />;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {campaigns.map((c) => {
        const spent = Number(c.metrics?.spend ?? 0);
        const total = Number(c.budget_total ?? 0);
        const pct = total > 0 ? Math.min(100, Math.round((spent / total) * 100)) : 0;
        const aud = c.target_audience ?? {};
        return (
          <article key={c.id} className="glass p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{c.name}</h3>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    {c.platform === "instagram" ? <Instagram size={11} /> : <Facebook size={11} />} {PLATFORM_LABEL[c.platform]}
                  </span>
                  <span>· Ziel: {OBJECTIVE_LABEL[c.objective]}</span>
                  {c.start_date && <span>· {dateAt(c.start_date)}{c.end_date ? `–${dateAt(c.end_date)}` : ""}</span>}
                </div>
              </div>
              <Badge tone={CAMPAIGN_STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Budget genutzt</span>
                <span className="tabular-nums">{eur(spent)} / {eur(total)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,var(--accent),var(--accent-h))" }} />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                ["Impressionen", nf(c.metrics?.impressions ?? 0)],
                ["Klicks", nf(c.metrics?.clicks ?? 0)],
                ["CTR", c.metrics?.ctr ? `${c.metrics.ctr.toFixed(2)} %` : "–"],
                ["Anfragen", nf(c.metrics?.leads ?? 0)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-slate-50 py-1.5 dark:bg-white/5">
                  <div className="text-sm font-bold tabular-nums">{v}</div>
                  <div className="text-[10px] text-slate-400">{l}</div>
                </div>
              ))}
            </div>

            {(aud.ort || aud.interessen?.length) && (
              <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
                <Target size={12} />
                {aud.ort && <span>{aud.ort}{aud.radius_km ? ` +${aud.radius_km} km` : ""}</span>}
                {aud.alter_von && <span>· {aud.alter_von}–{aud.alter_bis} J.</span>}
                {aud.interessen?.slice(0, 3).map((i) => <span key={i} className="rounded bg-slate-100 px-1.5 dark:bg-white/5">{i}</span>)}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between border-t pt-2 text-[11px] text-slate-400" style={{ borderColor: "var(--border)" }}>
              <span>{c.metrics?.cpl ? `${eur(c.metrics.cpl)} pro Anfrage` : "noch keine Anfragen"}</span>
              <div className="flex items-center gap-1">
                {mayEdit && <button className="btn-ghost px-2" title="Bearbeiten" onClick={() => onOpen(c)}><Pencil size={14} /></button>}
                {mayDelete && <button className="btn-ghost px-2 text-rose-500" title="Löschen" onClick={() => onDelete(c)}><Trash2 size={14} /></button>}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ── Kampagne anlegen/bearbeiten ───────────────────────────────────────
function CampaignModal({ value, canEdit, onClose, onSaved }: {
  value: AdCampaign | null; canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(value?.name ?? "");
  const [platform, setPlatform] = useState(value?.platform ?? "facebook");
  const [objective, setObjective] = useState<CampaignObjective>(value?.objective ?? "leads");
  const [status, setStatus] = useState<CampaignStatus>(value?.status ?? "entwurf");
  const [budgetTotal, setBudgetTotal] = useState(value?.budget_total != null ? String(value.budget_total) : "");
  const [budgetDaily, setBudgetDaily] = useState(value?.budget_daily != null ? String(value.budget_daily) : "");
  const [start, setStart] = useState(value?.start_date ?? "");
  const [end, setEnd] = useState(value?.end_date ?? "");
  const [ort, setOrt] = useState(value?.target_audience?.ort ?? "");
  const [radius, setRadius] = useState(value?.target_audience?.radius_km != null ? String(value.target_audience.radius_km) : "");
  const [alterVon, setAlterVon] = useState(value?.target_audience?.alter_von != null ? String(value.target_audience.alter_von) : "");
  const [alterBis, setAlterBis] = useState(value?.target_audience?.alter_bis != null ? String(value.target_audience.alter_bis) : "");
  const [interessen, setInteressen] = useState((value?.target_audience?.interessen ?? []).join(", "));
  const [notes, setNotes] = useState(value?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const num = (s: string): number | null => {
    const t = s.trim().replace(/\./g, "").replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  async function save() {
    if (!canEdit) return;
    if (!name.trim()) { toastError("Bitte einen Kampagnennamen angeben."); return; }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        platform: platform as AdCampaign["platform"],
        objective, status,
        budget_total: num(budgetTotal),
        budget_daily: num(budgetDaily),
        start_date: start || null,
        end_date: end || null,
        target_audience: {
          ...(ort.trim() ? { ort: ort.trim() } : {}),
          ...(num(radius) != null ? { radius_km: num(radius)! } : {}),
          ...(num(alterVon) != null ? { alter_von: num(alterVon)! } : {}),
          ...(num(alterBis) != null ? { alter_bis: num(alterBis)! } : {}),
          ...(interessen.trim() ? { interessen: interessen.split(",").map((i) => i.trim()).filter(Boolean) } : {}),
        },
        notes: notes.trim() || null,
      };
      if (value) { await updateCampaign(value.id, payload); toast("Kampagne gespeichert."); }
      else { await createCampaign(payload); toast("Kampagne angelegt."); }
      onSaved(); onClose();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={value ? "Kampagne bearbeiten" : "Neue Kampagne"} size="xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col text-sm sm:col-span-2">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Frühjahrs-Aktion Komplettbad" disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Plattform</span>
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value as AdCampaign["platform"])} disabled={!canEdit}>
            <option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="google_ads">Google Ads</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Ziel</span>
          <select className="input" value={objective} onChange={(e) => setObjective(e.target.value as CampaignObjective)} disabled={!canEdit}>
            {(Object.keys(OBJECTIVE_LABEL) as CampaignObjective[]).map((o) => <option key={o} value={o}>{OBJECTIVE_LABEL[o]}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Budget gesamt (€)</span>
          <input className="input text-right tabular-nums" inputMode="decimal" value={budgetTotal} onChange={(e) => setBudgetTotal(e.target.value)} disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Tagesbudget (€)</span>
          <input className="input text-right tabular-nums" inputMode="decimal" value={budgetDaily} onChange={(e) => setBudgetDaily(e.target.value)} disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Start</span>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} disabled={!canEdit} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Ende</span>
          <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!canEdit} />
        </label>

        <div className="sm:col-span-2 mt-1 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Target size={15} style={{ color: "var(--accent)" }} /> Zielgruppe</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col text-sm"><span className="label">Ort</span>
              <input className="input" value={ort} onChange={(e) => setOrt(e.target.value)} placeholder="Linz" disabled={!canEdit} /></label>
            <label className="flex flex-col text-sm"><span className="label">Umkreis (km)</span>
              <input className="input text-right tabular-nums" value={radius} onChange={(e) => setRadius(e.target.value)} disabled={!canEdit} /></label>
            <label className="flex flex-col text-sm"><span className="label">Alter von</span>
              <input className="input text-right tabular-nums" value={alterVon} onChange={(e) => setAlterVon(e.target.value)} disabled={!canEdit} /></label>
            <label className="flex flex-col text-sm"><span className="label">Alter bis</span>
              <input className="input text-right tabular-nums" value={alterBis} onChange={(e) => setAlterBis(e.target.value)} disabled={!canEdit} /></label>
          </div>
          <label className="mt-3 flex flex-col text-sm"><span className="label">Interessen (mit Komma getrennt)</span>
            <input className="input" value={interessen} onChange={(e) => setInteressen(e.target.value)} placeholder="Eigenheim, Renovierung, Wohnen" disabled={!canEdit} /></label>
        </div>

        <label className="flex flex-col text-sm">
          <span className="label">Status</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)} disabled={!canEdit}>
            {(Object.keys(CAMPAIGN_STATUS_LABEL) as CampaignStatus[]).map((s) => <option key={s} value={s}>{CAMPAIGN_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="label">Notiz</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} />
        </label>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>Abbrechen</button>
        {canEdit && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Speichere …" : value ? "Speichern" : "Kampagne anlegen"}</button>}
      </div>
    </Modal>
  );
}

// ── Kanäle ────────────────────────────────────────────────────────────
function Kanaele({ accounts }: { accounts: SocialAccount[] }) {
  const [info, setInfo] = useState<SocialAccount | null>(null);
  const icon = (p: string) => (p === "instagram" ? <Instagram size={20} /> : p === "facebook" ? <Facebook size={20} /> : <Target size={20} />);
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <div key={a.id} className="glass flex flex-col p-4">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                {icon(a.platform)}
              </span>
              <div className="min-w-0">
                <div className="truncate font-semibold">{PLATFORM_LABEL[a.platform]}</div>
                <div className="truncate text-[11px] text-slate-400">{a.account_name || "kein Konto hinterlegt"}</div>
              </div>
            </div>
            <div className="mb-3">
              <Badge tone={a.status === "verbunden" ? "green" : a.status === "fehler" ? "red" : "slate"}>
                {a.status === "verbunden" ? "Verbunden" : a.status === "fehler" ? "Fehler" : "Nicht verbunden"}
              </Badge>
            </div>
            <button className="btn-outline mt-auto text-sm" onClick={() => setInfo(a)}>
              <Plug size={14} /> {a.status === "verbunden" ? "Verbindung verwalten" : "Kanal verbinden"}
            </button>
          </div>
        ))}
      </div>

      <Modal open={!!info} onClose={() => setInfo(null)} title={`${info ? PLATFORM_LABEL[info.platform] : ""} verbinden`} size="md">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Für die automatische Veröffentlichung wird das {info ? PLATFORM_LABEL[info.platform] : ""}-Konto über die offizielle
          Schnittstelle verbunden. Dieser Schritt ist noch nicht eingerichtet.
        </p>
        <p className="mt-3 text-sm text-slate-500">
          Bis dahin funktioniert alles andere vollständig: Beiträge texten (auch mit KI), planen, freigeben und im
          Redaktionskalender verwalten. Der Termin bleibt gespeichert und kann nach der Verbindung übernommen werden.
        </p>
        <div className="mt-5 flex justify-end">
          <button className="btn-primary" onClick={() => setInfo(null)}>Verstanden</button>
        </div>
      </Modal>
    </>
  );
}
