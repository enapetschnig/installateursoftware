// ============================================================
// B4Y SuperAPP – Anfragen-Detail (/anfragen/:id)
// ------------------------------------------------------------
// Detail-Sicht einer einzelnen Anfrage (Posteingang) – Lifecycle,
// Eckdaten, Inhalt (Betreff/Beschreibung/Transkript/Audio) sowie
// Activity-Timeline mit append-only Notizen.
//
// Datenfluss:
//   • Anfrage + Events werden direkt via Supabase-Client geladen
//     (RLS isoliert die Mandanten automatisch via current_org_id()).
//     Wir nutzen denselben Pfad wie ContactDetail.tsx – die schmalere
//     /api/anfragen/detail ist auf Listen-Spalten zugeschnitten und
//     liefert nicht alle KI-/Telefon-Felder, die diese Detail-Sicht braucht.
//   • Status-Wechsel, Notiz-Inserts und Lösch-Aktionen schreiben unmittelbar
//     in `anfragen` bzw. `anfrage_events`. Der Audit-Trail wird durch
//     denselben Insert in `anfrage_events` (event_type=status_changed/note)
//     gepflegt – das Webhook-Backend (api/webhooks/fonio.js) macht es ebenso.
//
// Konventionen:
//   • Komponenten aus components/ui.tsx (PageHeader, Modal, Badge, …)
//   • Glass-Karten, var(--accent), TONES-Palette
//   • tel:/mailto:-Links für Klick-zu-Anruf bzw. -Email
//   • Datum/Uhrzeit via lib/format.ts (dateAt / dateTimeAt)
// ============================================================
import { ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowDownLeft, ArrowUpRight, Phone, Mail, MapPin, User, Building2,
  Calendar, Clock, FileText, Headphones, MessageSquare, Trash2, UserPlus,
  Sparkles, Inbox, Send, AlertCircle, CheckCircle2, XCircle, History, Bot,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { Badge, Empty, Modal, PageHeader, Spinner, type Tone } from "../components/ui";
import { dateAt, dateTimeAt } from "../lib/format";
import { toast, toastError } from "../lib/toast";
import { convertAnfrageToContact, enrichAnfrage } from "../lib/anfragen";

// ── Typen (Spiegel der DB – siehe Migration 0117 / 0118) ───
type AnfrageStatus =
  | "neu" | "in_arbeit" | "qualifiziert"
  | "kontakt_erstellt" | "abgewiesen" | "archiviert";

type AnfrageSource =
  | "phone_fonio" | "website_form" | "email" | "manual"
  | "instagram" | "facebook" | "whatsapp" | "other";

type AnfrageClassification =
  | "interessent" | "kunde_bestand" | "spam" | "termine_anfrage"
  | "reklamation" | "info_only" | "rueckruf_gewuenscht" | "fehlanruf" | "sonstiges";

type AnfragePriority = "hoch" | "mittel" | "niedrig";

type Anfrage = {
  id: string;
  source: AnfrageSource;
  source_ref: string | null;
  status: AnfrageStatus;
  caller_name: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  caller_address: string | null;
  subject: string | null;
  description: string | null;
  transcript: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
  call_direction: "inbound" | "outbound" | null;
  call_started_at: string | null;
  call_ended_at: string | null;
  ai_summary: string | null;
  ai_classification: AnfrageClassification | null;
  ai_priority: AnfragePriority | null;
  ai_extracted_data: Record<string, unknown> | null;
  related_contact_id: string | null;
  related_project_id: string | null;
  converted_to_contact_at: string | null;
  created_at: string;
  updated_at: string;
};

type AnfrageEventType =
  | "created" | "status_changed" | "assigned" | "note" | "ai_classified"
  | "contact_linked" | "project_linked" | "converted" | "rejected"
  | "reopened" | "audio_played";

type AnfrageEvent = {
  id: string;
  anfrage_id: string;
  event_type: AnfrageEventType;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

// ── Label-/Ton-Mappings ─────────────────────────────────────
const STATUS_LABEL: Record<AnfrageStatus, string> = {
  neu: "Neu",
  in_arbeit: "In Arbeit",
  qualifiziert: "Qualifiziert",
  kontakt_erstellt: "Kontakt erstellt",
  abgewiesen: "Abgewiesen",
  archiviert: "Archiviert",
};

const STATUS_TONE: Record<AnfrageStatus, Tone> = {
  neu: "blue",
  in_arbeit: "amber",
  qualifiziert: "green",
  kontakt_erstellt: "green",
  abgewiesen: "red",
  archiviert: "slate",
};

const SOURCE_LABEL: Record<AnfrageSource, string> = {
  phone_fonio: "Telefon",
  website_form: "Webformular",
  email: "E-Mail",
  manual: "Manuell",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  other: "Sonstige",
};

const SOURCE_TONE: Record<AnfrageSource, Tone> = {
  phone_fonio: "blue",
  website_form: "blue",
  email: "slate",
  manual: "slate",
  instagram: "amber",
  facebook: "blue",
  whatsapp: "green",
  other: "slate",
};

const CLASSIFICATION_LABEL: Record<AnfrageClassification, string> = {
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

const CLASSIFICATION_TONE: Record<AnfrageClassification, Tone> = {
  interessent: "green",
  kunde_bestand: "blue",
  spam: "red",
  termine_anfrage: "amber",
  reklamation: "red",
  info_only: "slate",
  rueckruf_gewuenscht: "amber",
  fehlanruf: "slate",
  sonstiges: "slate",
};

const PRIORITY_TONE: Record<AnfragePriority, Tone> = {
  hoch: "red",
  mittel: "amber",
  niedrig: "slate",
};

const EVENT_LABEL: Record<AnfrageEventType, string> = {
  created: "Anfrage erstellt",
  status_changed: "Status geändert",
  assigned: "Bearbeiter zugewiesen",
  note: "Notiz",
  ai_classified: "KI-Klassifikation",
  contact_linked: "Kontakt verknüpft",
  project_linked: "Projekt verknüpft",
  converted: "In Kontakt konvertiert",
  rejected: "Abgewiesen",
  reopened: "Reaktiviert",
  audio_played: "Audio angehört",
};

// Manuell setzbare Status (kontakt_erstellt entsteht via "Als Kontakt anlegen").
const STATUS_OPTIONS: AnfrageStatus[] = [
  "neu", "in_arbeit", "qualifiziert", "abgewiesen", "archiviert",
];

// ── Hilfs-Komponenten ──────────────────────────────────────
function Card({ title, icon, action, children }: {
  title?: string; icon?: ReactNode; action?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="glass p-4">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--text)" }}>
            {icon}
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      {icon && <span className="mt-0.5 shrink-0" style={{ color: "var(--text2)" }}>{icon}</span>}
      <span
        className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide"
        style={{ color: "var(--text2)" }}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words" style={{ color: "var(--text)" }}>{children}</span>
    </div>
  );
}

function formatDuration(s: number | null | undefined): string {
  if (!s || s <= 0) return "–";
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m === 0) return `${rest}s`;
  return `${m}m ${String(rest).padStart(2, "0")}s`;
}

function eventIcon(t: AnfrageEventType): ReactNode {
  switch (t) {
    case "created": return <Inbox size={14} />;
    case "status_changed": return <History size={14} />;
    case "assigned": return <UserPlus size={14} />;
    case "note": return <MessageSquare size={14} />;
    case "ai_classified": return <Sparkles size={14} />;
    case "contact_linked": return <User size={14} />;
    case "project_linked": return <FileText size={14} />;
    case "converted": return <CheckCircle2 size={14} />;
    case "rejected": return <XCircle size={14} />;
    case "reopened": return <AlertCircle size={14} />;
    case "audio_played": return <Headphones size={14} />;
    default: return <History size={14} />;
  }
}

function eventTitle(e: AnfrageEvent): string {
  if (e.event_type === "status_changed" && (e.from_value || e.to_value)) {
    const from = STATUS_LABEL[(e.from_value ?? "") as AnfrageStatus] ?? e.from_value ?? "–";
    const to = STATUS_LABEL[(e.to_value ?? "") as AnfrageStatus] ?? e.to_value ?? "–";
    return `Status: ${from} → ${to}`;
  }
  if (e.event_type === "assigned" && (e.from_value || e.to_value)) {
    return `Bearbeiter: ${e.from_value ?? "–"} → ${e.to_value ?? "–"}`;
  }
  return EVENT_LABEL[e.event_type] ?? e.event_type;
}

// ── Seite ──────────────────────────────────────────────────
export default function AnfrageDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [anfrage, setAnfrage] = useState<Anfrage | null>(null);
  const [events, setEvents] = useState<AnfrageEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusOpen, setStatusOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<AnfrageStatus | "">("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertCustType, setConvertCustType] = useState<"privat" | "firma">("privat");
  const [convertFirst, setConvertFirst] = useState("");
  const [convertLast, setConvertLast] = useState("");
  const [convertCompany, setConvertCompany] = useState("");
  const [convertEmail, setConvertEmail] = useState("");
  const [convertPhone, setConvertPhone] = useState("");
  const [convertStreet, setConvertStreet] = useState("");
  const [convertCity, setConvertCity] = useState("");
  const [convertZip, setConvertZip] = useState("");
  const [convertNotes, setConvertNotes] = useState("");

  const [enrichBusy, setEnrichBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const [aRes, eRes] = await Promise.all([
      supabase.from("anfragen").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("anfrage_events")
        .select("*")
        .eq("anfrage_id", id)
        .order("created_at", { ascending: false }),
    ]);
    if (aRes.error) {
      toastError("Anfrage konnte nicht geladen werden.");
      setAnfrage(null);
    } else {
      setAnfrage((aRes.data as Anfrage | null) ?? null);
    }
    setEvents((eRes.data as AnfrageEvent[] | null) ?? []);
  }, [id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      await reload();
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [reload]);

  // ── Aktionen ─────────────────────────────────────────────
  async function changeStatus() {
    if (!anfrage || !pendingStatus || pendingStatus === anfrage.status) {
      setStatusOpen(false);
      return;
    }
    setStatusBusy(true);
    const prev = anfrage.status;
    const next = pendingStatus;
    const upd = await supabase.from("anfragen").update({ status: next }).eq("id", anfrage.id);
    if (upd.error) {
      setStatusBusy(false);
      toastError("Status konnte nicht geändert werden.");
      return;
    }
    // Audit-Eintrag – best-effort, der Status-Wechsel zählt auch ohne Log.
    const evIns = await supabase.from("anfrage_events").insert({
      anfrage_id: anfrage.id,
      event_type: "status_changed",
      from_value: prev,
      to_value: next,
    });
    if (evIns.error) {
      // eslint-disable-next-line no-console
      console.warn("anfrage_events insert (status_changed) failed:", evIns.error.message);
    }
    setStatusBusy(false);
    setStatusOpen(false);
    setPendingStatus("");
    toast(`Status auf „${STATUS_LABEL[next]}" gesetzt`);
    await reload();
  }

  async function addNote() {
    if (!anfrage) return;
    const text = noteText.trim();
    if (!text) return;
    setNoteBusy(true);
    const ins = await supabase.from("anfrage_events").insert({
      anfrage_id: anfrage.id,
      event_type: "note",
      note: text,
    });
    setNoteBusy(false);
    if (ins.error) {
      toastError("Notiz konnte nicht gespeichert werden.");
      return;
    }
    setNoteText("");
    toast("Notiz hinzugefügt");
    await reload();
  }

  async function deleteAnfrage() {
    if (!anfrage) return;
    setDeleteBusy(true);
    const { error } = await supabase.from("anfragen").delete().eq("id", anfrage.id);
    setDeleteBusy(false);
    if (error) {
      toastError("Anfrage konnte nicht gelöscht werden.");
      return;
    }
    setDeleteOpen(false);
    toast("Anfrage gelöscht");
    nav("/crm?ansicht=liste");
  }

  // "Als Kontakt anlegen" – oeffnet das Convert-Modal mit aus der Anfrage
  // vorausgefuellten Feldern. Nach Erfolg ist die Anfrage auf
  // "kontakt_erstellt" gesetzt und mit dem neuen Kontakt verknuepft.
  function openConvert() {
    if (!anfrage) return;
    const splitName = (anfrage.caller_name || "").trim();
    const parts = splitName.length > 0 ? splitName.split(/\s+/) : [];
    const first = parts.length > 0 ? parts[0] : "";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
    const companyHint =
      (anfrage.ai_extracted_data?.callerOrganization as string | undefined) ?? "";
    const addr = (anfrage.caller_address || "").trim();
    setConvertCustType(companyHint && !first && !last ? "firma" : "privat");
    setConvertFirst(first);
    setConvertLast(last);
    setConvertCompany(companyHint);
    setConvertEmail(anfrage.caller_email || "");
    setConvertPhone(anfrage.caller_phone || "");
    setConvertStreet("");
    setConvertCity(addr);
    setConvertZip("");
    setConvertNotes(anfrage.ai_summary || "");
    setConvertOpen(true);
  }

  async function submitConvert() {
    if (!anfrage) return;
    setConvertBusy(true);
    try {
      const res = await convertAnfrageToContact({
        anfrage_id: anfrage.id,
        type: "kunde",
        customer_type: convertCustType,
        first_name: convertFirst.trim() || undefined,
        last_name: convertLast.trim() || undefined,
        company: convertCompany.trim() || undefined,
        email: convertEmail.trim() || undefined,
        phone: convertPhone.trim() || undefined,
        street: convertStreet.trim() || undefined,
        zip: convertZip.trim() || undefined,
        city: convertCity.trim() || undefined,
        notes: convertNotes.trim() || undefined,
      });
      setConvertBusy(false);
      setConvertOpen(false);
      toast(
        res.contact_number
          ? `Kontakt ${res.contact_number} angelegt`
          : "Kontakt angelegt",
      );
      await reload();
      // Direkt zum neuen Kontakt navigieren wuerde den User aus der
      // Anfrage rausreissen — wir bleiben hier; der Link zum Kontakt ist
      // jetzt im Meta-Block sichtbar.
    } catch (e) {
      setConvertBusy(false);
      const msg = e instanceof Error ? e.message : "Konvertierung fehlgeschlagen";
      toastError(msg);
    }
  }

  async function runEnrich() {
    if (!anfrage) return;
    setEnrichBusy(true);
    try {
      const r = await enrichAnfrage(anfrage.id);
      setEnrichBusy(false);
      if (r.skipped) {
        toast("Kein Transkript zum Analysieren vorhanden.");
        return;
      }
      toast("KI-Analyse aktualisiert");
      await reload();
    } catch (e) {
      setEnrichBusy(false);
      const msg = e instanceof Error ? e.message : "KI-Analyse fehlgeschlagen";
      toastError(msg);
    }
  }

  // ── Render ───────────────────────────────────────────────
  if (loading) return <Spinner />;
  if (!anfrage) {
    return (
      <>
        <button type="button" onClick={() => nav("/crm?ansicht=liste")} className="btn-ghost mb-4 px-2">
          <ArrowLeft size={18} /> Zurück zu Anfragen
        </button>
        <Empty
          title="Anfrage nicht gefunden"
          hint="Die Anfrage existiert nicht (mehr) oder du hast keinen Zugriff."
        />
      </>
    );
  }

  const a = anfrage;
  const callerName = a.caller_name?.trim() || "Anonymer Anruf";
  const isConverted = a.status === "kontakt_erstellt" || !!a.related_contact_id;

  const aiExtraEntries = a.ai_extracted_data
    ? Object.entries(a.ai_extracted_data).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];
  const agentName =
    (a.ai_extracted_data?.agent_name as string | undefined) ??
    (a.ai_extracted_data?.agent as string | undefined) ?? null;
  const companyName =
    (a.ai_extracted_data?.company as string | undefined) ??
    (a.ai_extracted_data?.company_name as string | undefined) ?? null;

  return (
    <div className="anim-in space-y-4 pt-1">
      {/* ── Kopfzeile ── */}
      <button type="button" onClick={() => nav("/crm?ansicht=liste")} className="btn-ghost px-2">
        <ArrowLeft size={18} /> Zurück zu Anfragen
      </button>

      <PageHeader
        title={callerName}
        subtitle={a.subject || undefined}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!isConverted && (
              <button type="button" className="btn-primary" onClick={openConvert}>
                <UserPlus size={16} /> Als Kontakt anlegen
              </button>
            )}
            {isConverted && a.related_contact_id && (
              <Link to={`/kontakte/${a.related_contact_id}`} className="btn-outline">
                <User size={16} /> Kontakt öffnen
              </Link>
            )}
            {a.transcript && a.transcript.length > 0 && (
              <button
                type="button"
                className="btn-outline"
                onClick={runEnrich}
                disabled={enrichBusy}
                title="KI-Analyse erneut ausführen"
              >
                <Sparkles size={16} /> {enrichBusy ? "KI analysiert …" : "KI neu analysieren"}
              </button>
            )}
            <button
              type="button"
              className="btn-outline"
              onClick={() => { setPendingStatus(a.status); setStatusOpen(true); }}
            >
              <History size={16} /> Status ändern
            </button>
            <button
              type="button"
              className="btn-ghost text-rose-500 hover:bg-rose-500/10"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={16} /> Löschen
            </button>
          </div>
        }
      />

      {/* Status-/Klassifikations-Reihe direkt unter PageHeader */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
        {a.ai_classification && (
          <Badge tone={CLASSIFICATION_TONE[a.ai_classification]}>
            <Sparkles size={11} className="mr-1 inline" /> {CLASSIFICATION_LABEL[a.ai_classification]}
          </Badge>
        )}
        {a.ai_priority && (
          <Badge tone={PRIORITY_TONE[a.ai_priority]}>Priorität: {a.ai_priority}</Badge>
        )}
      </div>

      {/* ── 3 Spalten Desktop / Stack Mobile ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── Spalte 1: Eckdaten ── */}
        <div className="space-y-4">
          <Card title="Eckdaten" icon={<Inbox size={16} style={{ color: "var(--accent)" }} />}>
            <div className="space-y-3">
              <InfoRow icon={<Inbox size={14} />} label="Quelle">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge tone={SOURCE_TONE[a.source]}>{SOURCE_LABEL[a.source]}</Badge>
                  {a.source_ref && (
                    <span className="text-xs" style={{ color: "var(--text2)" }} title={a.source_ref}>
                      Ref: {a.source_ref.slice(0, 16)}{a.source_ref.length > 16 ? "…" : ""}
                    </span>
                  )}
                </span>
              </InfoRow>
              <InfoRow icon={<Calendar size={14} />} label="Eingegangen">
                <div>{dateTimeAt(a.created_at)}</div>
                {a.call_started_at && (
                  <div className="text-xs" style={{ color: "var(--text2)" }}>
                    Anruf: {dateTimeAt(a.call_started_at)}
                  </div>
                )}
              </InfoRow>
              {a.duration_seconds != null && a.duration_seconds > 0 && (
                <InfoRow icon={<Clock size={14} />} label="Dauer">{formatDuration(a.duration_seconds)}</InfoRow>
              )}
              {a.call_direction && (
                <InfoRow
                  icon={a.call_direction === "inbound" ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                  label="Richtung"
                >
                  {a.call_direction === "inbound" ? "Eingehend" : "Ausgehend"}
                </InfoRow>
              )}
              <InfoRow icon={<User size={14} />} label="Anrufer">
                {a.caller_name ? a.caller_name : <span style={{ color: "var(--text2)" }}>–</span>}
              </InfoRow>
              {a.caller_phone && (
                <InfoRow icon={<Phone size={14} />} label="Telefon">
                  <a href={`tel:${a.caller_phone}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                    {a.caller_phone}
                  </a>
                </InfoRow>
              )}
              {a.caller_email && (
                <InfoRow icon={<Mail size={14} />} label="E-Mail">
                  <a
                    href={`mailto:${a.caller_email}`}
                    className="break-all hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {a.caller_email}
                  </a>
                </InfoRow>
              )}
              {a.caller_address && (
                <InfoRow icon={<MapPin size={14} />} label="Adresse">
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(a.caller_address)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {a.caller_address}
                  </a>
                </InfoRow>
              )}
              {(agentName || companyName) && (
                <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                  {agentName && <InfoRow icon={<Bot size={14} />} label="Agent">{agentName}</InfoRow>}
                  {companyName && <InfoRow icon={<Building2 size={14} />} label="Firma">{companyName}</InfoRow>}
                </div>
              )}
            </div>
          </Card>

          {aiExtraEntries.length > 0 && (
            <Card
              title="KI-extrahierte Daten"
              icon={<Sparkles size={16} style={{ color: "var(--accent)" }} />}
            >
              <dl className="space-y-2 text-sm">
                {aiExtraEntries.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[140px_1fr] gap-2">
                    <dt
                      className="text-xs font-medium uppercase tracking-wide"
                      style={{ color: "var(--text2)" }}
                    >
                      {k}
                    </dt>
                    <dd className="break-words" style={{ color: "var(--text)" }}>
                      {typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                        ? String(v)
                        : <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(v, null, 2)}</pre>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>

        {/* ── Spalte 2: Inhalt ── */}
        <div className="space-y-4">
          <Card title="Betreff" icon={<FileText size={16} style={{ color: "var(--accent)" }} />}>
            <div className="text-lg font-bold leading-snug" style={{ color: "var(--text)" }}>
              {a.subject?.trim() || <span style={{ color: "var(--text2)" }}>(kein Betreff)</span>}
            </div>
          </Card>

          <Card
            title={a.ai_summary && !a.description ? "Zusammenfassung" : "Beschreibung"}
            icon={
              a.ai_summary && !a.description
                ? <Sparkles size={16} style={{ color: "var(--accent)" }} />
                : <FileText size={16} style={{ color: "var(--accent)" }} />
            }
          >
            {a.description || a.ai_summary ? (
              <p
                className="whitespace-pre-wrap text-sm leading-relaxed"
                style={{ color: "var(--text)" }}
              >
                {a.description || a.ai_summary}
              </p>
            ) : (
              <p className="text-sm italic" style={{ color: "var(--text2)" }}>
                Keine Beschreibung hinterlegt.
              </p>
            )}
            {a.description && a.ai_summary && a.description !== a.ai_summary && (
              <details className="mt-3 text-xs">
                <summary
                  className="cursor-pointer font-semibold"
                  style={{ color: "var(--text2)" }}
                >
                  KI-Zusammenfassung anzeigen
                </summary>
                <p
                  className="mt-2 whitespace-pre-wrap leading-relaxed"
                  style={{ color: "var(--text)" }}
                >
                  {a.ai_summary}
                </p>
              </details>
            )}
          </Card>

          {a.transcript && (
            <Card title="Transkript" icon={<MessageSquare size={16} style={{ color: "var(--accent)" }} />}>
              <pre
                className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg p-3 font-sans text-sm leading-relaxed"
                style={{ background: "var(--hover)", color: "var(--text)" }}
              >
                {a.transcript}
              </pre>
            </Card>
          )}

          {a.audio_url && (
            <Card title="Aufnahme" icon={<Headphones size={16} style={{ color: "var(--accent)" }} />}>
              <a href={a.audio_url} target="_blank" rel="noreferrer" className="btn-outline w-full">
                <Headphones size={16} /> Aufnahme / Gespräch bei Fonio öffnen
              </a>
              <p className="mt-2 text-xs" style={{ color: "var(--text2)" }}>
                Öffnet die externe Player-Seite des Quellsystems in einem neuen Tab.
              </p>
            </Card>
          )}
        </div>

        {/* ── Spalte 3: Activity-Timeline ── */}
        <div className="space-y-4">
          <Card title="Aktivitäten" icon={<History size={16} style={{ color: "var(--accent)" }} />}>
            {events.length === 0 ? (
              <p className="py-4 text-center text-sm" style={{ color: "var(--text2)" }}>
                Noch keine Einträge.
              </p>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                      style={{
                        background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                        color: "var(--accent)",
                      }}
                    >
                      {eventIcon(e.event_type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                        {eventTitle(e)}
                      </div>
                      <div className="text-xs tabular-nums" style={{ color: "var(--text2)" }}>
                        {dateTimeAt(e.created_at)}
                      </div>
                      {e.note && (
                        <p
                          className="mt-1.5 whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-sm"
                          style={{ background: "var(--hover)", color: "var(--text)" }}
                        >
                          {e.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {/* Notiz hinzufügen */}
            <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
              <label className="label" htmlFor="anfrage-note">Notiz hinzufügen</label>
              <textarea
                id="anfrage-note"
                className="input min-h-[80px] resize-y"
                placeholder="Was ist passiert? Was wurde besprochen?"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                disabled={noteBusy}
              />
              <button
                type="button"
                className="btn-primary mt-2 w-full"
                onClick={addNote}
                disabled={noteBusy || !noteText.trim()}
              >
                <Send size={16} /> {noteBusy ? "Wird gespeichert …" : "Notiz speichern"}
              </button>
            </div>
          </Card>

          {/* Meta-Karte */}
          <Card>
            <div className="space-y-2 text-xs" style={{ color: "var(--text2)" }}>
              <div className="flex items-center justify-between">
                <span>Erstellt</span>
                <span>{dateTimeAt(a.created_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Aktualisiert</span>
                <span>{dateTimeAt(a.updated_at)}</span>
              </div>
              {a.converted_to_contact_at && (
                <div className="flex items-center justify-between">
                  <span>In Kontakt konvertiert</span>
                  <span>{dateAt(a.converted_to_contact_at)}</span>
                </div>
              )}
              {a.related_contact_id && (
                <div className="flex items-center justify-between gap-2">
                  <span>Kontakt</span>
                  <Link
                    to={`/kontakte/${a.related_contact_id}`}
                    className="hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    Kontakt öffnen
                  </Link>
                </div>
              )}
              {a.related_project_id && (
                <div className="flex items-center justify-between gap-2">
                  <span>Projekt</span>
                  <Link
                    to={`/projekte/${a.related_project_id}`}
                    className="hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    Projekt öffnen
                  </Link>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>ID</span>
                <span className="tabular-nums" title={a.id}>{a.id.slice(0, 8)}…</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Convert-Dialog: Anfrage → Kontakt ── */}
      <Modal
        open={convertOpen}
        onClose={() => !convertBusy && setConvertOpen(false)}
        title="Als Kontakt anlegen"
        size="xl"
      >
        <p className="mb-3 text-sm" style={{ color: "var(--text2)" }}>
          Aus dieser Anfrage wird ein Kontakt erstellt. Die Anfrage wird auf
          „Kontakt erstellt" gesetzt und mit dem neuen Kontakt verknüpft.
        </p>

        <div className="mb-4 flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text2)" }}>
            Kundentyp
          </span>
          <div className="inline-flex rounded-lg p-0.5" style={{ background: "var(--hover)" }}>
            {(["privat", "firma"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setConvertCustType(opt)}
                disabled={convertBusy}
                className="rounded-md px-3 py-1 text-sm"
                style={{
                  background: convertCustType === opt ? "var(--accent)" : "transparent",
                  color: convertCustType === opt ? "white" : "var(--text)",
                }}
              >
                {opt === "privat" ? "Privatkunde" : "Firma"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {convertCustType === "firma" && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="conv-company">Firma *</label>
              <input
                id="conv-company"
                className="input"
                value={convertCompany}
                onChange={(e) => setConvertCompany(e.target.value)}
                disabled={convertBusy}
                placeholder="Firmenname"
              />
            </div>
          )}
          <div>
            <label className="label" htmlFor="conv-first">Vorname</label>
            <input
              id="conv-first"
              className="input"
              value={convertFirst}
              onChange={(e) => setConvertFirst(e.target.value)}
              disabled={convertBusy}
            />
          </div>
          <div>
            <label className="label" htmlFor="conv-last">Nachname</label>
            <input
              id="conv-last"
              className="input"
              value={convertLast}
              onChange={(e) => setConvertLast(e.target.value)}
              disabled={convertBusy}
            />
          </div>
          <div>
            <label className="label" htmlFor="conv-phone">Telefon</label>
            <input
              id="conv-phone"
              className="input"
              value={convertPhone}
              onChange={(e) => setConvertPhone(e.target.value)}
              disabled={convertBusy}
            />
          </div>
          <div>
            <label className="label" htmlFor="conv-email">E-Mail</label>
            <input
              id="conv-email"
              type="email"
              className="input"
              value={convertEmail}
              onChange={(e) => setConvertEmail(e.target.value)}
              disabled={convertBusy}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="conv-street">Straße</label>
            <input
              id="conv-street"
              className="input"
              value={convertStreet}
              onChange={(e) => setConvertStreet(e.target.value)}
              disabled={convertBusy}
            />
          </div>
          <div>
            <label className="label" htmlFor="conv-zip">PLZ</label>
            <input
              id="conv-zip"
              className="input"
              value={convertZip}
              onChange={(e) => setConvertZip(e.target.value)}
              disabled={convertBusy}
            />
          </div>
          <div>
            <label className="label" htmlFor="conv-city">Ort</label>
            <input
              id="conv-city"
              className="input"
              value={convertCity}
              onChange={(e) => setConvertCity(e.target.value)}
              disabled={convertBusy}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="conv-notes">Notiz zum Kontakt</label>
            <textarea
              id="conv-notes"
              className="input min-h-[70px] resize-y"
              value={convertNotes}
              onChange={(e) => setConvertNotes(e.target.value)}
              disabled={convertBusy}
              placeholder="Optional – wird beim Kontakt gespeichert."
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setConvertOpen(false)}
            disabled={convertBusy}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submitConvert}
            disabled={
              convertBusy ||
              (convertCustType === "privat" && !convertFirst.trim() && !convertLast.trim()) ||
              (convertCustType === "firma" && !convertCompany.trim())
            }
          >
            <UserPlus size={16} />
            {convertBusy ? "Lege Kontakt an …" : "Kontakt anlegen"}
          </button>
        </div>
      </Modal>

      {/* ── Status-Dialog ── */}
      <Modal open={statusOpen} onClose={() => setStatusOpen(false)} title="Status ändern" size="md">
        <p className="mb-3 text-sm" style={{ color: "var(--text2)" }}>
          Aktuell: <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
        </p>
        <label className="label" htmlFor="status-select">Neuer Status</label>
        <select
          id="status-select"
          className="input"
          value={pendingStatus || a.status}
          onChange={(e) => setPendingStatus(e.target.value as AnfrageStatus)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <p className="mt-2 text-xs" style={{ color: "var(--text2)" }}>
          Der Wechsel zu „Kontakt erstellt" passiert automatisch beim Anlegen
          eines Kontakts über die Aktion „Als Kontakt anlegen".
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setStatusOpen(false)}
            disabled={statusBusy}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={changeStatus}
            disabled={statusBusy || !pendingStatus || pendingStatus === a.status}
          >
            {statusBusy ? "Speichert …" : "Status setzen"}
          </button>
        </div>
      </Modal>

      {/* ── Lösch-Dialog ── */}
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Anfrage löschen?" size="md">
        <p className="text-sm" style={{ color: "var(--text)" }}>
          Diese Anfrage wird unwiderruflich gelöscht. Alle zugehörigen
          Aktivitäts-Einträge werden ebenfalls entfernt (Cascade).
        </p>
        <div className="mt-2 rounded-lg p-3 text-sm" style={{ background: "var(--hover)" }}>
          <div className="font-semibold" style={{ color: "var(--text)" }}>{callerName}</div>
          {a.subject && <div style={{ color: "var(--text2)" }}>{a.subject}</div>}
          <div className="mt-1 text-xs" style={{ color: "var(--text2)" }}>
            Eingegangen {dateTimeAt(a.created_at)}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setDeleteOpen(false)}
            disabled={deleteBusy}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="btn flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
            onClick={deleteAnfrage}
            disabled={deleteBusy}
          >
            <Trash2 size={16} /> {deleteBusy ? "Lösche …" : "Endgültig löschen"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
