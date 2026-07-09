// ============================================================
// Installateur SuperAPP – KI-Postfach (echte IMAP-Mails)
// ------------------------------------------------------------
// Zeigt die per IMAP abgeholten und von der KI eingeordneten E-Mails
// (public.incoming_mails). Das sind ECHTE Mails aus dem Firmenpostfach –
// keine Beispieldaten. Lesen läuft über RLS (org-isoliert); der Abruf
// selbst über /api/mail/poll ("Postfach abrufen").
//
// Wird auf /email angezeigt, solange kein Microsoft-Konto verbunden ist:
// Senden/Antworten braucht Microsoft, Lesen + KI-Triage nicht.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Mail, RefreshCw, Sparkles, Paperclip, Inbox, Receipt, AlertTriangle,
  Megaphone, Search,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Spinner, Empty, Badge, type Tone } from "../ui";
import { toast, toastError, toastInfo } from "../../lib/toast";
import { pollInbox, summarizePoll } from "../../lib/mail";

type MailClass = "kundenanfrage" | "rechnung" | "angebot" | "spam" | "sonstiges";

interface IncomingMail {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  created_at: string;
  body_text: string | null;
  body_snippet: string | null;
  has_attachments: boolean;
  attachments: { filename?: string; content_type?: string; size?: number }[];
  mail_class: MailClass | null;
  ai_summary: string | null;
  anfrage_id: string | null;
  status: string;
}

const CLASS_LABEL: Record<MailClass, string> = {
  kundenanfrage: "Kundenanfrage",
  rechnung: "Rechnung",
  angebot: "Lieferanten-Angebot",
  spam: "Spam",
  sonstiges: "Sonstiges",
};
const CLASS_TONE: Record<MailClass, Tone> = {
  kundenanfrage: "blue",
  rechnung: "amber",
  angebot: "slate",
  spam: "red",
  sonstiges: "slate",
};
const CLASS_ICON: Record<MailClass, typeof Mail> = {
  kundenanfrage: Inbox,
  rechnung: Receipt,
  angebot: Megaphone,
  spam: AlertTriangle,
  sonstiges: Mail,
};

function fmt(d: string | null | undefined): string {
  if (!d) return "–";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "–";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat("de-AT", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

const senderLabel = (m: IncomingMail) => m.from_name?.trim() || m.from_email || "Unbekannt";

export default function KiPostfach() {
  const [mails, setMails] = useState<IncomingMail[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"alle" | MailClass>("alle");

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("incoming_mails")
      .select("id,from_email,from_name,subject,received_at,created_at,body_text,body_snippet," +
        "has_attachments,attachments,mail_class,ai_summary,anfrage_id,status")
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) setErr(error.message);
    else setMails((data as unknown as IncomingMail[]) ?? []);
    if (initial) setLoading(false);
  }, []);

  useEffect(() => { load(true); }, [load]);

  const handlePoll = useCallback(async () => {
    setPolling(true);
    try {
      const res = await pollInbox();
      const msg = summarizePoll(res);
      if (!res.ok && res.reason === "not_configured") toastInfo(msg);
      else if (!res.ok) toastError(msg);
      else toast(msg);
      if (res.ok) load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Abruf fehlgeschlagen.");
    } finally { setPolling(false); }
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mails.filter((m) => {
      if (filter !== "alle" && m.mail_class !== filter) return false;
      if (!q) return true;
      return [m.subject, m.from_email, m.from_name, m.ai_summary]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [mails, search, filter]);

  const selected = useMemo(
    () => shown.find((m) => m.id === selectedId) ?? shown[0] ?? null,
    [shown, selectedId],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { alle: mails.length };
    for (const m of mails) if (m.mail_class) c[m.mail_class] = (c[m.mail_class] ?? 0) + 1;
    return c;
  }, [mails]);

  if (loading) return <Spinner />;

  return (
    <div className="anim-in">
      {/* Kopfleiste */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[300px]">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Suchen: Betreff, Absender, Zusammenfassung"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="glass flex gap-1 overflow-x-auto p-1">
          {(["alle", "kundenanfrage", "rechnung", "sonstiges"] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                filter === k ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
              style={filter === k ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
              {k === "alle" ? "Alle" : CLASS_LABEL[k]}
              {counts[k] ? <span className="ml-1 opacity-70">{counts[k]}</span> : null}
            </button>
          ))}
        </div>
        <button className="btn-outline ml-auto" onClick={handlePoll} disabled={polling}>
          <RefreshCw size={15} className={polling ? "animate-spin" : ""} />
          {polling ? "Rufe ab …" : "Postfach abrufen"}
        </button>
      </div>

      {err && (
        <div className="glass mb-3 flex items-center gap-2 p-3 text-sm text-rose-500">
          <AlertTriangle size={16} /> {err}
        </div>
      )}

      {mails.length === 0 ? (
        <Empty title="Noch keine E-Mails abgeholt."
          hint="Klicke auf „Postfach abrufen“ – neue Mails werden von der KI gelesen und eingeordnet." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,380px)_1fr]">
          {/* Liste */}
          <div className="glass max-h-[68vh] overflow-y-auto">
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {shown.map((m) => {
                const active = selected?.id === m.id;
                const Icon = m.mail_class ? CLASS_ICON[m.mail_class] : Mail;
                return (
                  <li key={m.id}>
                    <button onClick={() => setSelectedId(m.id)}
                      className={`flex w-full items-start gap-2.5 p-3 text-left transition ${active ? "" : "hover:bg-[var(--hover)]"}`}
                      style={active ? { background: "var(--accent-soft)" } : undefined}>
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                        style={{ background: "var(--card-2, rgba(0,0,0,.04))", color: "var(--accent)" }}>
                        <Icon size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{senderLabel(m)}</span>
                          <span className="shrink-0 text-[11px] text-slate-400">{fmt(m.received_at ?? m.created_at)}</span>
                        </div>
                        <div className="truncate text-sm">{m.subject || "(ohne Betreff)"}</div>
                        {m.ai_summary && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{m.ai_summary}</p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {m.mail_class && <Badge tone={CLASS_TONE[m.mail_class]}>{CLASS_LABEL[m.mail_class]}</Badge>}
                          {m.has_attachments && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Paperclip size={11} />{m.attachments?.length || 1}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Detail */}
          <div className="glass max-h-[68vh] overflow-y-auto p-4">
            {!selected ? (
              <p className="py-16 text-center text-sm text-slate-400">Keine E-Mail ausgewählt.</p>
            ) : (
              <>
                <h2 className="text-lg font-bold">{selected.subject || "(ohne Betreff)"}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-medium text-slate-500 dark:text-slate-300">{senderLabel(selected)}</span>
                  {selected.from_email && <span>&lt;{selected.from_email}&gt;</span>}
                  <span>· {fmt(selected.received_at ?? selected.created_at)}</span>
                  {selected.mail_class && <Badge tone={CLASS_TONE[selected.mail_class]}>{CLASS_LABEL[selected.mail_class]}</Badge>}
                </div>

                {selected.ai_summary && (
                  <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--accent)" }}>
                      <Sparkles size={13} /> KI-Zusammenfassung
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-200">{selected.ai_summary}</p>
                  </div>
                )}

                {/* Weiterleitung ins passende Modul */}
                {(selected.anfrage_id || selected.mail_class === "rechnung") && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selected.anfrage_id && (
                      <Link to={`/anfragen/${selected.anfrage_id}`} className="btn-outline text-sm">
                        <Inbox size={14} /> Zur Anfrage
                      </Link>
                    )}
                    {selected.mail_class === "rechnung" && (
                      <Link to="/buchhaltung" className="btn-outline text-sm">
                        <Receipt size={14} /> Zur Buchhaltung
                      </Link>
                    )}
                  </div>
                )}

                {selected.has_attachments && (selected.attachments?.length ?? 0) > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-xs font-semibold text-slate-500">Anhänge</div>
                    <ul className="flex flex-wrap gap-2">
                      {selected.attachments.map((a, i) => (
                        <li key={i} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs"
                          style={{ borderColor: "var(--border)" }}>
                          <Paperclip size={12} className="text-slate-400" /> {a.filename || `Anhang ${i + 1}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4 whitespace-pre-line border-t pt-4 text-sm leading-relaxed" style={{ borderColor: "var(--border)" }}>
                  {selected.body_text || selected.body_snippet || <span className="text-slate-400">Kein Textinhalt.</span>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
