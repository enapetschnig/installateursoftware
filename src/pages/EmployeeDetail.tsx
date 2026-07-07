// B4Y SuperAPP – Mitarbeiterverwaltung (Detailseite)
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, User, ShieldCheck, Server, Briefcase, Coins, FileText, Landmark,
  PenLine, KeyRound, CalendarOff, Clock, Scale, FolderArchive, Lock, Save,
  ExternalLink, Mail, Info,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { PageHeader, Spinner, Empty, Badge } from "../components/ui";
import { Toggle, ErrorBanner } from "../components/calc-ui";
import { dateAt } from "../lib/format";
import { usePermissions } from "../lib/permissions";
import { useAuth } from "../lib/auth";
import { loadCompanySettings } from "../lib/company";
import { sanitizeHtml } from "../lib/sanitize";
import { appUrl } from "../lib/branding";
import { TITLE_SUGGESTIONS } from "../lib/types";
import { sortAlphaStrings } from "../lib/sortOptions";
import AddressAutocomplete from "../components/AddressAutocomplete";
import { assignSingleRole } from "../lib/user-roles";

// Mitarbeiter-Anrede bewusst nur Herr/Frau (Kontakt-Anreden bleiben unverändert).
const EMP_SALUTATIONS = ["Herr", "Frau"];
import {
  Employee, EMPLOYEE_COLUMNS, EMPLOYMENT_TYPES, AT_STATES, fullName,
  POSITIONS, KV_OPTIONS, WEEKDAYS, WeekHours, sumWeek,
} from "../lib/employee-types";
import { loadWorkTimeModels, WorkTimeTemplate } from "../lib/work-time-models";
import PhotoUpload from "../components/PhotoUpload";
import RichTextEditor from "../components/RichTextEditor";
import { resolveEmailSignature } from "../lib/email-signature";
import { previewEmployeeDocSignature } from "../lib/document-signature";
import { useUnsavedChanges, useUnsavedGuard } from "../lib/unsaved-changes";

type TopTab = "uebersicht" | "urlaub" | "zeit" | "ausgleich" | "dokumente";
type SubTab =
  | "persoenliches" | "berechtigungen" | "mailserver" | "anstellung" | "lohngruppe"
  | "steuerdaten" | "bankdaten" | "signatur" | "passwort";

const numOrNull = (v: number | "") => (v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const numField = (v: number | null) => (v === null || v === undefined ? "" : v) as number | "";
const SCALAR_SAVE: SubTab[] = ["persoenliches", "anstellung", "lohngruppe", "steuerdaten", "bankdaten", "signatur"];

export default function EmployeeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isAdmin, can } = usePermissions();
  const { session } = useAuth();
  const canEdit = isAdmin || can("employees", "edit");

  const [emp, setEmp] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [top, setTop] = useState<TopTab>("uebersicht");
  const [sub, setSub] = useState<SubTab>("persoenliches");
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [companyEmailSig, setCompanyEmailSig] = useState<string | null>(null);
  const [companyDocSig, setCompanyDocSig] = useState<string | null>(null);
  const [companyDocMode, setCompanyDocMode] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const guard = useUnsavedGuard();

  const [f, setF] = useState<any>(null);
  const set = (k: string, v: any) => { setF((p: any) => ({ ...p, [k]: v })); setSaved(false); setDirty(true); };

  // Schutz vor ungespeicherten Mitarbeiter-Änderungen (zentraler Guard, deckt auch die Signaturen ab).
  // „Verwerfen" setzt das Formular auf den zuletzt geladenen/gespeicherten Stand zurück.
  useUnsavedChanges(
    "employee-detail",
    canEdit && dirty,
    () => save(),
    () => { if (emp) setF(toForm(emp)); setDirty(false); setSaved(false); },
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("employees").select(EMPLOYEE_COLUMNS).eq("id", id).maybeSingle();
      const e = data as unknown as Employee | null;
      setEmp(e);
      if (e) setF(toForm(e));
      setLoading(false);
    })();
    loadCompanySettings().then((c) => {
      setCompanyLogo(c?.logo_url ?? c?.icon_logo_url ?? null);
      setCompanyEmailSig(c?.email_signature_html ?? null);
      setCompanyDocSig(c?.document_signature_html ?? null);
      setCompanyDocMode(c?.document_signature_mode ?? null);
    }).catch(() => {});
  }, [id]);

  async function save(): Promise<boolean> {
    if (!emp || !canEdit) return false;
    setErr(null);
    if (!f.first_name.trim()) { setErr("Bitte Vorname eingeben."); setSub("persoenliches"); return false; }
    if (!f.last_name.trim()) { setErr("Bitte Nachname eingeben."); setSub("persoenliches"); return false; }
    if (!f.email.trim()) { setErr("Bitte E-Mail-Adresse eingeben."); setSub("persoenliches"); return false; }
    setBusy(true);
    const { error } = await supabase.from("employees").update(toPayload(f)).eq("id", emp.id);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    setSaved(true);
    setDirty(false);
    const { data } = await supabase.from("employees").select(EMPLOYEE_COLUMNS).eq("id", emp.id).maybeSingle();
    if (data) { const fresh = data as unknown as Employee; setEmp(fresh); setF(toForm(fresh)); }
    return true;
  }

  if (loading) return <Spinner />;
  if (!emp || !f) return <Empty title="Mitarbeiter nicht gefunden" />;

  const TOP_TABS: { key: TopTab; label: string; icon: typeof User; ready: boolean }[] = [
    { key: "uebersicht", label: "Übersicht", icon: User, ready: true },
    { key: "urlaub", label: "Urlaub & Abwesenheiten", icon: CalendarOff, ready: false },
    { key: "zeit", label: "Zeiterfassung", icon: Clock, ready: false },
    { key: "ausgleich", label: "Stundenausgleich", icon: Scale, ready: false },
    { key: "dokumente", label: "Dokumente", icon: FolderArchive, ready: false },
  ];
  const SUB_TABS = ([
    { key: "persoenliches", label: "Persönliches", icon: User },
    { key: "berechtigungen", label: "Berechtigungen", icon: ShieldCheck },
    { key: "mailserver", label: "Mailserver", icon: Server },
    { key: "anstellung", label: "Anstellung", icon: Briefcase },
    { key: "lohngruppe", label: "Lohngruppe", icon: Coins, adminOnly: true },
    { key: "steuerdaten", label: "Steuerdaten", icon: FileText, adminOnly: true },
    { key: "bankdaten", label: "Bankdaten", icon: Landmark, adminOnly: true },
    { key: "signatur", label: "Signaturen", icon: PenLine },
    { key: "passwort", label: "Passwort ändern", icon: KeyRound },
  ] as { key: SubTab; label: string; icon: typeof User; adminOnly?: boolean }[])
    .filter((s) => !s.adminOnly || isAdmin);

  const showSave = top === "uebersicht" && SCALAR_SAVE.includes(sub) && canEdit;

  return (
    <>
      <button onClick={() => guard(() => nav("/mitarbeiter"))} className="btn-ghost mb-4 px-2"><ArrowLeft size={18} /> Zurück zur Liste</button>

      <PageHeader
        title={fullName(emp)}
        subtitle={emp.position || (emp.email ?? undefined)}
        action={emp.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}
      />

      {/* Top-Tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5 rounded-2xl border p-1.5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {TOP_TABS.map((t) => (
          <button key={t.key} onClick={() => guard(() => setTop(t.key))}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all ${top === t.key ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
            style={top === t.key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
            <t.icon size={16} /> {t.label}{!t.ready && <Lock size={12} className="opacity-60" />}
          </button>
        ))}
      </div>

      <ErrorBanner message={err} />

      {top === "uebersicht" ? (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          {/* Linke Spalte: Foto + Unter-Navigation */}
          <div className="space-y-4">
            <div className="glass p-4">
              <PhotoUpload
                employeeId={emp.id}
                url={emp.photo_url}
                name={`${emp.first_name} ${emp.last_name}`}
                canEdit={canEdit}
                onChange={(url) => setEmp((p) => (p ? { ...p, photo_url: url } : p))}
              />
            </div>
            <nav className="glass h-fit space-y-1 p-2">
              {SUB_TABS.map((s) => (
                <button key={s.key} onClick={() => guard(() => setSub(s.key))}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${sub === s.key ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
                  style={sub === s.key ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" } : undefined}>
                  <s.icon size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 break-words leading-snug">{s.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Inhalt */}
          <div className="glass p-4">
            {sub === "persoenliches" && <Persoenliches f={f} set={set} canEdit={canEdit} />}
            {sub === "berechtigungen" && <Berechtigungen emp={emp} isAdmin={isAdmin} onGotoSettings={() => guard(() => nav("/einstellungen?tab=zugriffsrechte&sub=zuweisung"))} />}
            {sub === "mailserver" && <Mailserver />}
            {sub === "anstellung" && <Anstellung f={f} set={set} canEdit={canEdit} />}
            {sub === "lohngruppe" && <Lohngruppe f={f} set={set} canEdit={canEdit} />}
            {sub === "steuerdaten" && <Steuerdaten f={f} set={set} canEdit={canEdit} />}
            {sub === "bankdaten" && <Bankdaten f={f} set={set} canEdit={canEdit} />}
            {sub === "signatur" && <Signatur f={f} set={set} canEdit={canEdit} companyLogo={companyLogo} companyEmailSig={companyEmailSig} companyDocSig={companyDocSig} companyDocMode={companyDocMode} />}
            {sub === "passwort" && <Passwort emp={emp} ownAccount={!!emp.auth_user_id && emp.auth_user_id === session?.user.id} />}

            {showSave && (
              <div className="mt-6 flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
                {saved && <span className="text-sm font-medium text-emerald-600">Gespeichert ✓</span>}
                <button className="btn-primary" disabled={busy} onClick={save}><Save size={16} /> {busy ? "Speichern …" : "Speichern"}</button>
              </div>
            )}
            <div className="mt-4 text-xs text-slate-400">Zuletzt geändert: {dateAt(emp.updated_at ?? emp.created_at)}</div>
          </div>
        </div>
      ) : (
        <div className="glass p-8"><Soon /></div>
      )}
    </>
  );
}

// ---------- Formular-Mapping ----------
// photo_url, phone, supervisor_id, personnel_number werden bewusst NICHT
// ins Formular/Payload übernommen → bestehende Werte bleiben unangetastet.
function toForm(e: Employee) {
  return {
    salutation: e.salutation ?? "", title: e.title ?? "",
    first_name: e.first_name ?? "", last_name: e.last_name ?? "",
    birth_date: e.birth_date ?? "", email: e.email ?? "", mobile: e.mobile ?? "",
    street: e.street ?? "", address_extra: e.address_extra ?? "",
    zip: e.zip ?? "", city: e.city ?? "", country: e.country ?? "Österreich",
    notes_internal: e.notes_internal ?? "", active: e.active,
    // Anstellung
    entry_date: e.entry_date ?? "", exit_date: e.exit_date ?? "",
    employment_type: e.employment_type ?? "", position: e.position ?? "",
    weekly_hours: numField(e.weekly_hours),
    vacation_days_per_year: numField(e.vacation_days_per_year),
    probation_until: e.probation_until ?? "", notice_period: e.notice_period ?? "",
    work_state: e.work_state ?? "Wien", worktime_model: e.worktime_model ?? "",
    work_time_model_id: e.work_time_model_id ?? "",
    trade_kv: e.trade_kv ?? "", worktime_valid_from: e.worktime_valid_from ?? "",
    week_short: (e.week_short ?? {}) as WeekHours, week_long: (e.week_long ?? {}) as WeekHours,
    // Lohngruppe
    wage_group: e.wage_group ?? "", collective_agreement: e.collective_agreement ?? "",
    wage_category: e.wage_category ?? "",
    hourly_wage_gross: numField(e.hourly_wage_gross), monthly_wage_gross: numField(e.monthly_wage_gross),
    overtime_rate: numField(e.overtime_rate), surcharges: e.surcharges ?? "",
    wage_valid_from: e.wage_valid_from ?? "", wage_note: e.wage_note ?? "",
    // Signatur (E-Mail) + Dokument-Signatur (getrennt)
    signature_active: e.signature_active ?? false, signature_html: e.signature_html ?? "",
    document_signature_active: e.document_signature_active ?? false,
    document_signature_html: e.document_signature_html ?? "",
    // Steuer
    ssn: e.ssn ?? "", citizenship: e.citizenship ?? "", birth_place: e.birth_place ?? "",
    marital_status: e.marital_status ?? "", commuter_allowance: e.commuter_allowance ?? false,
    sole_earner: e.sole_earner ?? "", tax_note: e.tax_note ?? "",
    // Bank
    account_holder: e.account_holder ?? "", iban: e.iban ?? "", bic: e.bic ?? "",
    bank_name: e.bank_name ?? "", bank_note: e.bank_note ?? "",
  };
}
function toPayload(f: any) {
  return {
    salutation: f.salutation || null, title: f.title || null,
    first_name: f.first_name.trim(), last_name: f.last_name.trim(),
    birth_date: f.birth_date || null, email: f.email.trim(), mobile: f.mobile || null,
    street: f.street || null, address_extra: f.address_extra || null,
    zip: f.zip || null, city: f.city || null, country: f.country || null,
    notes_internal: f.notes_internal || null, active: f.active,
    entry_date: f.entry_date || null, exit_date: f.exit_date || null,
    employment_type: f.employment_type || null, position: f.position || null,
    weekly_hours: numOrNull(f.weekly_hours),
    vacation_days_per_year: numOrNull(f.vacation_days_per_year),
    probation_until: f.probation_until || null, notice_period: f.notice_period || null,
    work_state: f.work_state || null, worktime_model: f.worktime_model || null,
    work_time_model_id: f.work_time_model_id || null,
    trade_kv: f.trade_kv || null,
    week_short: f.week_short ?? {}, week_long: f.week_long ?? {},
    hours_short_week: sumWeek(f.week_short), hours_long_week: sumWeek(f.week_long),
    worktime_valid_from: f.worktime_valid_from || null,
    wage_group: f.wage_group || null, collective_agreement: f.collective_agreement || null,
    wage_category: f.wage_category || null,
    hourly_wage_gross: numOrNull(f.hourly_wage_gross), monthly_wage_gross: numOrNull(f.monthly_wage_gross),
    overtime_rate: numOrNull(f.overtime_rate), surcharges: f.surcharges || null,
    wage_valid_from: f.wage_valid_from || null, wage_note: f.wage_note || null,
    signature_active: f.signature_active, signature_html: f.signature_html || null,
    document_signature_active: f.document_signature_active, document_signature_html: f.document_signature_html || null,
    ssn: f.ssn || null, citizenship: f.citizenship || null, birth_place: f.birth_place || null,
    marital_status: f.marital_status || null, commuter_allowance: f.commuter_allowance,
    sole_earner: f.sole_earner || null, tax_note: f.tax_note || null,
    account_holder: f.account_holder || null, iban: f.iban || null, bic: f.bic || null,
    bank_name: f.bank_name || null, bank_note: f.bank_note || null,
  };
}

// ---------- Abschnitte ----------
const grid = "grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2";
const SectionTitle = ({ children }: { children: any }) => <h3 className="mb-4 text-lg font-bold">{children}</h3>;
const SensitiveHint = () => (
  <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-700 dark:text-amber-300">
    <Lock size={16} className="mt-0.5 shrink-0" /> Sensible Daten – nur für berechtigte Benutzer sichtbar.
  </div>
);

function Persoenliches({ f, set, canEdit }: { f: any; set: (k: string, v: any) => void; canEdit: boolean }) {
  const dis = !canEdit;
  return (
    <>
      <datalist id="titel-opts">{TITLE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
      <SectionTitle>Persönliches</SectionTitle>
      <div className={grid}>
        <div><label className="label">Anrede</label>
          <select className="input" value={f.salutation} disabled={dis} onChange={(e) => set("salutation", e.target.value)}>
            <option value="">– bitte wählen –</option>
            {/* Mitarbeiter-Anrede: nur Herr/Frau. Ein evtl. vorhandener Altwert (z. B. „Divers")
                bleibt sichtbar, bis er geändert wird. Kontakt-Anreden bleiben unverändert. */}
            {(f.salutation && !EMP_SALUTATIONS.includes(f.salutation) ? [f.salutation, ...EMP_SALUTATIONS] : EMP_SALUTATIONS)
              .map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="label">Titel</label>
          <input className="input" list="titel-opts" value={f.title} disabled={dis} onChange={(e) => set("title", e.target.value)} placeholder="z.B. Ing., Mag." /></div>
        <div><label className="label label-req">Vorname</label>
          <input className="input" value={f.first_name} disabled={dis} onChange={(e) => set("first_name", e.target.value)} /></div>
        <div><label className="label label-req">Nachname</label>
          <input className="input" value={f.last_name} disabled={dis} onChange={(e) => set("last_name", e.target.value)} /></div>
        <div><label className="label">Geburtsdatum</label>
          <input type="date" className="input" value={f.birth_date} disabled={dis} onChange={(e) => set("birth_date", e.target.value)} /></div>
        <div><label className="label label-req">E-Mail</label>
          <input type="email" className="input" value={f.email} disabled={dis} onChange={(e) => set("email", e.target.value)} /></div>
        <div><label className="label">Mobilnummer</label>
          <input className="input" value={f.mobile} disabled={dis} onChange={(e) => set("mobile", e.target.value)} /></div>
        <div />

        <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Adresse</div>
        <div className="sm:col-span-2"><label className="label">Straße und Hausnummer</label>
          {/* Zentrale Adress-Autovervollständigung wie bei Kontakten/Projekten: Auswahl füllt
              Straße, PLZ, Ort und Land automatisch (überschreibbar). */}
          <AddressAutocomplete value={f.street} zip={f.zip} city={f.city} disabled={dis} placeholder="z. B. Getreidegasse 7 – Vorschläge ab 3 Zeichen"
            onChange={(v) => set("street", v)}
            onSelect={(s) => { set("street", s.street); if (s.zip) set("zip", s.zip); if (s.city) set("city", s.city); if (s.country) set("country", s.country); }} /></div>
        <div className="sm:col-span-2"><label className="label">Adresszusatz</label>
          <input className="input" value={f.address_extra} disabled={dis} onChange={(e) => set("address_extra", e.target.value)} placeholder="z. B. / Stiege 1 / Top 14 oder / Hof" /></div>
        <div><label className="label">PLZ</label>
          <input className="input" value={f.zip} disabled={dis} onChange={(e) => set("zip", e.target.value)} /></div>
        <div><label className="label">Ort</label>
          <input className="input" value={f.city} disabled={dis} onChange={(e) => set("city", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Land</label>
          <input className="input" value={f.country} disabled={dis} onChange={(e) => set("country", e.target.value)} /></div>

        <div className="flex items-center pb-1"><Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" disabled={dis} /></div>
      </div>
    </>
  );
}

function Anstellung({ f, set, canEdit }: { f: any; set: (k: string, v: any) => void; canEdit: boolean }) {
  const dis = !canEdit;
  // Arbeitszeitmodell-Vorlagen (aktive) zur Zuweisung laden.
  const [models, setModels] = useState<WorkTimeTemplate[]>([]);
  useEffect(() => { loadWorkTimeModels(true).then(setModels).catch(() => setModels([])); }, []);
  // Funktion/Position-Auswahl aus den AKTIVEN Rollen ableiten (eine Wahrheit mit dem
  // Rollensystem). Reines Stammdaten-/Label-Feld (employees.position) – KEINE Rechtequelle;
  // Rechte werden ausschließlich über die Rollenzuweisung (Reiter „Berechtigungen") gesteuert.
  // Fällt auf die statische POSITIONS-Liste zurück, falls (noch) keine Rollen geladen sind.
  const [roleNames, setRoleNames] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from("roles").select("name,active").eq("active", true);
        if (alive) setRoleNames(((data ?? []) as { name: string }[]).map((r) => r.name).filter(Boolean));
      } catch { if (alive) setRoleNames([]); }
    })();
    return () => { alive = false; };
  }, []);
  const basePositions = roleNames.length ? roleNames : POSITIONS;
  // Bestehenden (Frei-)Wert nicht verlieren, falls er nicht in der Liste ist.
  const posOpts = sortAlphaStrings(!f.position || basePositions.includes(f.position) ? basePositions : [f.position, ...basePositions]);
  const kvOpts = sortAlphaStrings(!f.trade_kv || KV_OPTIONS.includes(f.trade_kv) ? KV_OPTIONS : [f.trade_kv, ...KV_OPTIONS]);
  return (
    <>
      <SectionTitle>Anstellung</SectionTitle>
      <div className={grid}>
        <div><label className="label">Eintrittsdatum</label>
          <input type="date" className="input" value={f.entry_date} disabled={dis} onChange={(e) => set("entry_date", e.target.value)} /></div>
        <div><label className="label">Austrittsdatum</label>
          <input type="date" className="input" value={f.exit_date} disabled={dis} onChange={(e) => set("exit_date", e.target.value)} /></div>
        <div><label className="label">Beschäftigungsart</label>
          <select className="input" value={f.employment_type} disabled={dis} onChange={(e) => set("employment_type", e.target.value)}>
            <option value="">– bitte wählen –</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select></div>
        <div><label className="label">Funktion / Position</label>
          <select className="input" value={f.position} disabled={dis} onChange={(e) => set("position", e.target.value)}>
            <option value="">– bitte wählen –</option>
            {posOpts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">Nur Funktion/Bezeichnung. Zugriffsrechte werden über die Rolle im Reiter „Berechtigungen" vergeben.</p></div>
        <div><label className="label">Wochenstunden gesamt</label>
          <input type="number" min="0" step="0.5" className="input" value={f.weekly_hours} disabled={dis} onChange={(e) => set("weekly_hours", e.target.value === "" ? "" : Number(e.target.value))} placeholder="z.B. 38.5" /></div>
        <div><label className="label">Urlaubstage pro Jahr</label>
          <input type="number" min="0" step="1" className="input" value={f.vacation_days_per_year} disabled={dis} onChange={(e) => set("vacation_days_per_year", e.target.value === "" ? "" : Number(e.target.value))} placeholder="z.B. 25" /></div>
        <div><label className="label">Probezeit bis</label>
          <input type="date" className="input" value={f.probation_until} disabled={dis} onChange={(e) => set("probation_until", e.target.value)} /></div>
        <div><label className="label">Kündigungsfrist</label>
          <input className="input" value={f.notice_period} disabled={dis} onChange={(e) => set("notice_period", e.target.value)} placeholder="z.B. 1 Monat zum Monatsende" /></div>
        <div><label className="label">Bundesland der Arbeitsstätte</label>
          <select className="input" value={f.work_state} disabled={dis} onChange={(e) => set("work_state", e.target.value)}>
            {sortAlphaStrings(AT_STATES).map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="label">Kollektivvertrag</label>
          <select className="input" value={f.trade_kv} disabled={dis} onChange={(e) => set("trade_kv", e.target.value)}>
            <option value="">– bitte wählen –</option>
            {kvOpts.map((k) => <option key={k} value={k}>{k}</option>)}
          </select></div>
        <div><label className="label">Arbeitszeitmodell</label>
          <select className="input" value={f.work_time_model_id} disabled={dis} onChange={(e) => set("work_time_model_id", e.target.value)}>
            <option value="">– kein Modell (Firmen-Standard) –</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <p className="mt-0.5 text-[11px] text-slate-400">Vorlagen verwalten: Einstellungen → Kalender & Arbeitszeiten.</p></div>
        <div><label className="label">Gültig ab</label>
          <input type="date" className="input" value={f.worktime_valid_from} disabled={dis} onChange={(e) => set("worktime_valid_from", e.target.value)} /></div>
      </div>

      {/* Individuelle Tages-Sollstunden (optionaler Override der Vorlage je Mitarbeiter) */}
      <p className="mt-5 text-xs text-slate-400">Individuelle Tagesstunden (optional) – überschreiben das gewählte Arbeitszeitmodell für diesen Mitarbeiter. Leer lassen = Werte aus der Vorlage.</p>
      <div className="mt-2 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <WeekTable title="Override kurze Woche" tone="var(--c-amber)" value={f.week_short} disabled={dis} onChange={(v) => set("week_short", v)} />
        <WeekTable title="Override lange Woche" tone="var(--c-blue)" value={f.week_long} disabled={dis} onChange={(v) => set("week_long", v)} />
      </div>

      <div className="mt-4"><label className="label">Interne Notiz</label>
        <textarea className="input min-h-[60px]" value={f.notes_internal} disabled={dis} onChange={(e) => set("notes_internal", e.target.value)} /></div>

      <p className="mt-3 text-xs text-slate-400">
        Die Tagesstunden je Woche und das Arbeitszeitmodell sind die Basis für Zeiterfassung, Urlaub, Feiertage und Stundenausgleich.
        Ob eine Kalenderwoche <b>kurz</b> oder <b>lang</b> ist, kommt aus dem <b>BUAK-Kalender</b> (Einstellungen) – es wird kein fixer Wechsel angenommen.
      </p>
    </>
  );
}

// Tagesstunden Mo–So mit Auto-Summe; Dezimal mit Komma erlaubt (z.B. 8,5).
function WeekTable({ title, tone, value, onChange, disabled }: {
  title: string; tone: string; value: WeekHours; onChange: (v: WeekHours) => void; disabled?: boolean;
}) {
  const [strs, setStrs] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    WEEKDAYS.forEach((d) => { const v = (value || {})[d.key]; o[d.key] = v == null ? "" : String(v).replace(".", ","); });
    return o;
  });
  const parse = (s: string) => { const n = Number((s || "").replace(",", ".")); return Number.isNaN(n) ? 0 : n; };
  const change = (k: string, raw: string) => {
    const next = { ...strs, [k]: raw };
    setStrs(next);
    const nums: WeekHours = {};
    WEEKDAYS.forEach((d) => { const r = next[d.key]; if (r && r.trim() !== "") { const n = Number(r.replace(",", ".")); if (!Number.isNaN(n)) (nums as any)[d.key] = n; } });
    onChange(nums);
  };
  const sum = WEEKDAYS.reduce((a, d) => a + parse(strs[d.key]), 0);
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", borderLeft: `4px solid ${tone}` }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-bold">{title}</div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums dark:bg-white/10">
          Summe {String(Math.round(sum * 100) / 100).replace(".", ",")} h
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div key={d.key} className="text-center">
            <label className={`mb-1 block text-[11px] font-medium ${d.weekend ? "text-slate-400" : "text-slate-500 dark:text-slate-300"}`}>{d.short}</label>
            <input inputMode="decimal" className="input px-1 text-center" disabled={disabled}
              value={strs[d.key]} onChange={(e) => change(d.key, e.target.value)} placeholder="0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Lohngruppe({ f, set, canEdit }: { f: any; set: (k: string, v: any) => void; canEdit: boolean }) {
  const dis = !canEdit;
  return (
    <>
      <SectionTitle>Lohngruppe</SectionTitle>
      <SensitiveHint />
      <div className={grid}>
        <div><label className="label">Lohngruppe</label>
          <input className="input" value={f.wage_group} disabled={dis} onChange={(e) => set("wage_group", e.target.value)} placeholder="z.B. Facharbeiter" /></div>
        <div><label className="label">Kollektivvertrag</label>
          <input className="input" value={f.collective_agreement} disabled={dis} onChange={(e) => set("collective_agreement", e.target.value)} placeholder="z.B. Bauindustrie/Baugewerbe" /></div>
        <div><label className="label">Kategorie</label>
          <input className="input" value={f.wage_category} disabled={dis} onChange={(e) => set("wage_category", e.target.value)} placeholder="z.B. III, IV" /></div>
        <div><label className="label">Gültig ab</label>
          <input type="date" className="input" value={f.wage_valid_from} disabled={dis} onChange={(e) => set("wage_valid_from", e.target.value)} /></div>
        <div><label className="label">Stundenlohn brutto (€)</label>
          <input type="number" min="0" step="0.01" className="input" value={f.hourly_wage_gross} disabled={dis} onChange={(e) => set("hourly_wage_gross", e.target.value === "" ? "" : Number(e.target.value))} /></div>
        <div><label className="label">Monatslohn brutto (€)</label>
          <input type="number" min="0" step="0.01" className="input" value={f.monthly_wage_gross} disabled={dis} onChange={(e) => set("monthly_wage_gross", e.target.value === "" ? "" : Number(e.target.value))} /></div>
        <div><label className="label">Überstundensatz (€)</label>
          <input type="number" min="0" step="0.01" className="input" value={f.overtime_rate} disabled={dis} onChange={(e) => set("overtime_rate", e.target.value === "" ? "" : Number(e.target.value))} /></div>
        <div><label className="label">Zuschläge</label>
          <input className="input" value={f.surcharges} disabled={dis} onChange={(e) => set("surcharges", e.target.value)} placeholder="z.B. Erschwernis, Schmutz, Montage" /></div>
        <div className="sm:col-span-2"><label className="label">Notiz</label>
          <textarea className="input min-h-[60px]" value={f.wage_note} disabled={dis} onChange={(e) => set("wage_note", e.target.value)} /></div>
      </div>
    </>
  );
}

function Steuerdaten({ f, set, canEdit }: { f: any; set: (k: string, v: any) => void; canEdit: boolean }) {
  const dis = !canEdit;
  return (
    <>
      <SectionTitle>Steuerdaten</SectionTitle>
      <SensitiveHint />
      <div className={grid}>
        <div><label className="label">Sozialversicherungsnummer</label>
          <input className="input" value={f.ssn} disabled={dis} onChange={(e) => set("ssn", e.target.value)} /></div>
        <div><label className="label">Staatsbürgerschaft</label>
          <input className="input" value={f.citizenship} disabled={dis} onChange={(e) => set("citizenship", e.target.value)} placeholder="z.B. Österreich" /></div>
        <div><label className="label">Geburtsort</label>
          <input className="input" value={f.birth_place} disabled={dis} onChange={(e) => set("birth_place", e.target.value)} /></div>
        <div><label className="label">Familienstand</label>
          <input className="input" value={f.marital_status} disabled={dis} onChange={(e) => set("marital_status", e.target.value)} placeholder="z.B. ledig, verheiratet" /></div>
        <div><label className="label">Alleinverdiener / Alleinerzieher</label>
          <input className="input" value={f.sole_earner} disabled={dis} onChange={(e) => set("sole_earner", e.target.value)} placeholder="optional" /></div>
        <div className="flex items-center pb-1"><Toggle checked={f.commuter_allowance} onChange={(v) => set("commuter_allowance", v)} label="Pendlerpauschale" disabled={dis} /></div>
        <div className="sm:col-span-2"><label className="label">Notiz</label>
          <textarea className="input min-h-[60px]" value={f.tax_note} disabled={dis} onChange={(e) => set("tax_note", e.target.value)} /></div>
      </div>
    </>
  );
}

function Bankdaten({ f, set, canEdit }: { f: any; set: (k: string, v: any) => void; canEdit: boolean }) {
  const dis = !canEdit;
  return (
    <>
      <SectionTitle>Bankdaten</SectionTitle>
      <SensitiveHint />
      <div className={grid}>
        <div><label className="label">Kontoinhaber</label>
          <input className="input" value={f.account_holder} disabled={dis} onChange={(e) => set("account_holder", e.target.value)} /></div>
        <div><label className="label">Bankname</label>
          <input className="input" value={f.bank_name} disabled={dis} onChange={(e) => set("bank_name", e.target.value)} /></div>
        <div><label className="label">IBAN</label>
          <input className="input font-mono" value={f.iban} disabled={dis} onChange={(e) => set("iban", e.target.value)} placeholder="ATxx xxxx xxxx xxxx xxxx" /></div>
        <div><label className="label">BIC</label>
          <input className="input font-mono" value={f.bic} disabled={dis} onChange={(e) => set("bic", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Zahlungsreferenz / Notiz</label>
          <textarea className="input min-h-[60px]" value={f.bank_note} disabled={dis} onChange={(e) => set("bank_note", e.target.value)} /></div>
      </div>
    </>
  );
}

function Signatur({ f, set, canEdit, companyLogo, companyEmailSig, companyDocSig, companyDocMode }: {
  f: any; set: (k: string, v: any) => void; canEdit: boolean;
  companyLogo: string | null; companyEmailSig: string | null; companyDocSig: string | null;
  companyDocMode: string | null;
}) {
  // Effektiv verwendete E-Mail-Signatur (eigene → Firma → keine).
  const emailEff = resolveEmailSignature(
    { signature_active: f.signature_active, signature_html: f.signature_html },
    companyEmailSig,
  );
  const emailLabel = emailEff.source === "employee" ? "Eigene E-Mail-Signatur"
    : emailEff.source === "company" ? "Verwendet wird die Firmen-E-Mail-Signatur"
    : "Keine E-Mail-Signatur hinterlegt";

  // Effektiv verwendete Dokument-Signatur bei Signaturquelle „Ersteller", zentral aufgelöst
  // (berücksichtigt Firmen-Modus + Aktiv-Schalter). EINE Quelle: previewEmployeeDocSignature.
  const forceCompany = companyDocMode === "force_company";
  const docPreview = previewEmployeeDocSignature(
    { document_signature_active: f.document_signature_active, document_signature_html: f.document_signature_html },
    companyDocSig,
    companyDocMode,
  );
  const docEff = docPreview.html;
  const docLabel =
    docPreview.source === "forced_company" ? "Firma erzwingt Firmen-Dokument-Signatur"
    : docPreview.source === "employee" ? "Eigene Dokument-Signatur"
    : docPreview.source === "company_fallback" ? "Ersatzweise Firmen-Dokument-Signatur"
    : "Keine – die PDF-Engine setzt die automatische Firmen-Signatur";

  const badge = (text: string) => (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold normal-case"
      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{text}</span>
  );

  return (
    <>
      <SectionTitle>E-Mail-Signatur</SectionTitle>
      <div className="mb-4"><Toggle checked={f.signature_active} onChange={(v) => set("signature_active", v)} label="Signatur aktiv" disabled={!canEdit} /></div>
      <label className="label">Signatur</label>
      <RichTextEditor value={f.signature_html} onChange={(html) => set("signature_html", html)} placeholder="Signatur eingeben …" disabled={!canEdit} />
      <div className="mt-4">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Effektiv verwendet {badge(emailLabel)}
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
          {companyLogo && <img src={companyLogo} alt="Logo" className="mb-2 h-10 object-contain" />}
          {emailEff.html
            ? <div className="mail-editor text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(emailEff.html) }} />
            : <div className="text-sm text-slate-400">Keine E-Mail-Signatur hinterlegt.</div>}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">Bei aktiver eigener Signatur wird diese verwendet, sonst die Firmen-E-Mail-Signatur (Firmeneinstellungen), sonst keine. Die automatische Einfügung beim Mailversand folgt mit dem E-Mail-Modul.</p>

      <SectionTitle>Dokument-Signatur</SectionTitle>
      <p className="mb-3 text-xs text-slate-400">
        Persönliche Signatur für Dokumente/PDFs (Angebote, Aufträge, Rechnungen) – getrennt von der E-Mail-Signatur.
        Wird verwendet, wenn ein Dokument als Signaturquelle „Ersteller" wählt und dieser Schalter aktiv ist;
        sonst gilt die globale Standard-Signatur aus den Firmeneinstellungen.
      </p>
      {forceCompany && (
        <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Die Firma erzwingt derzeit die Firmen-Dokument-Signatur (Einstellungen → Firmeneinstellungen).
          Eine eigene Dokument-Signatur wird dann nicht verwendet.
        </div>
      )}
      <div className="mb-4">
        <Toggle checked={!!f.document_signature_active} onChange={(v) => set("document_signature_active", v)}
          label="Eigene Dokument-Signatur verwenden" disabled={!canEdit || forceCompany} />
      </div>
      <label className="label">Signatur</label>
      <RichTextEditor value={f.document_signature_html} onChange={(html) => set("document_signature_html", html)} placeholder="z. B. Name, Funktion …" disabled={!canEdit} />
      <div className="mt-4">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Effektiv verwendet {badge(docLabel)}
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
          {docEff
            ? <div className="mail-editor text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(docEff) }} />
            : <div className="text-sm text-slate-400">Keine eigene/Firmen-Dokument-Signatur – die PDF-Engine ergänzt automatisch „Mit freundlichen Grüßen" + Geschäftsführer/Gesellschafter.</div>}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">Die Vorschau zeigt, was bei Signaturquelle „Ersteller" verwendet würde. Die PDF-Engine rendert genau eine Signatur und vermeidet doppelte Grußformeln.</p>
    </>
  );
}

function Berechtigungen({ emp, isAdmin, onGotoSettings }: { emp: Employee; isAdmin: boolean; onGotoSettings: () => void }) {
  const [roles, setRoles] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [roleId, setRoleId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Einladung (für Mitarbeiter ohne App-Login): optionale Rolle + Versand-Status.
  const [inviteRole, setInviteRole] = useState<string>("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const hasLogin = !!emp.auth_user_id;

  useEffect(() => {
    (async () => {
      // Rollen immer laden (auch ohne Login – für die Rollenauswahl bei der Einladung).
      const r = await supabase.from("roles").select("id,name,active").eq("active", true).order("name");
      setRoles((r.data as any) ?? []);
      if (hasLogin) {
        const ur = await supabase.from("user_roles").select("role_id").eq("user_id", emp.auth_user_id);
        setRoleId((ur.data?.[0] as any)?.role_id ?? "");
      }
      setLoading(false);
    })();
  }, [emp.auth_user_id, hasLogin]);

  async function sendInvite() {
    if (!isAdmin) return;
    setInviteMsg(null); setErr(null);
    if (!emp.email) { setErr("Für die Einladung wird eine E-Mail-Adresse am Mitarbeiter benötigt."); return; }
    setInviting(true);
    const { data: res, error: invErr } = await supabase.functions.invoke("invite-employee", {
      body: { employeeId: emp.id, email: emp.email, roleId: inviteRole || null },
    });
    setInviting(false);
    if (invErr || (res as any)?.error) {
      setErr(`Einladung fehlgeschlagen: ${(res as any)?.message || invErr?.message || "unbekannt"} (SMTP/E-Mail-Versand in Supabase prüfen).`);
      return;
    }
    setInviteMsg(`Einladung an ${emp.email} versendet. Nach dem Setzen des Passworts ist der Login aktiv. Bitte Seite neu laden.`);
  }

  async function changeRole(newRole: string) {
    if (!isAdmin || !emp.auth_user_id) return;
    setErr(null); setSaved(false);
    setRoleId(newRole);
    // Zentrale, idempotente Zuweisung (gleiche Rolle = No-Op, kein Duplicate-Key).
    const { error } = await assignSingleRole(emp.auth_user_id, newRole);
    if (error) { setErr(error); return; }
    setSaved(true);
  }

  return (
    <>
      <SectionTitle>Berechtigungen</SectionTitle>
      {!hasLogin ? (
        <div className="flex items-start gap-2 rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)" }}>
          <Info size={18} className="mt-0.5 shrink-0 text-slate-400" />
          <div className="w-full">
            <div className="font-medium">Dieser Mitarbeiter hat noch keinen App-Login.</div>
            <p className="mt-1 text-slate-500 dark:text-slate-400">
              Lade den Mitarbeiter sicher per E-Mail ein – er setzt sein Passwort selbst über den Link (kein Klartext-Passwort).
              Rollen, Modulrechte und Abweichungen werden zentral unter <b>Einstellungen → Zugriffsrechte</b> verwaltet.
            </p>
            <ErrorBanner message={err} />
            {inviteMsg && <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{inviteMsg}</div>}
            {isAdmin ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="label">Rolle bei Einladung (optional)</label>
                  <select className="input min-w-[12rem]" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    <option value="">– keine Rolle (kein Admin) –</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <button className="btn-primary" disabled={inviting || !emp.email} onClick={sendInvite}>
                  <Mail size={15} /> {inviting ? "Einladung wird gesendet …" : "App-Zugang einladen"}
                </button>
                <button className="btn-outline" onClick={onGotoSettings}><ExternalLink size={15} /> Zu den Zugriffsrechten</button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">Nur Administratoren können Mitarbeiter einladen.</p>
            )}
          </div>
        </div>
      ) : loading ? <Spinner /> : (
        <>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Die Rolle bestimmt die Modulrechte (über das zentrale Rechte-System). Feineinstellungen und Abweichungen unter <b>Einstellungen → Zugriffsrechte → Mitarbeiterrechte</b>.
          </p>
          <ErrorBanner message={err} />
          <div className="max-w-md">
            <label className="label">Rolle</label>
            <select className="input" value={roleId} disabled={!isAdmin} onChange={(e) => changeRole(e.target.value)}>
              <option value="">– keine Rolle –</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {!isAdmin && <p className="mt-1 text-xs text-slate-400">Nur Administratoren können Rollen ändern.</p>}
            {saved && <p className="mt-2 text-sm font-medium text-emerald-600">Rolle gespeichert ✓</p>}
          </div>
          <button className="btn-outline mt-4" onClick={onGotoSettings}><ExternalLink size={15} /> Detaillierte Rechte & Abweichungen</button>
        </>
      )}
    </>
  );
}

function Mailserver() {
  return (
    <>
      <SectionTitle>Mailserver</SectionTitle>
      <div className="flex items-start gap-2 rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)" }}>
        <Server size={18} className="mt-0.5 shrink-0 text-slate-400" />
        <div>
          <div className="font-medium">Mailserver-Einstellungen werden später eingerichtet.</div>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Hier werden künftig E-Mail-Verbindungsdaten (SMTP / Microsoft Graph / Automatisierung) je Mitarbeiter verwaltet – verschlüsselt gespeichert.
          </p>
        </div>
      </div>
    </>
  );
}

function Passwort({ emp, ownAccount }: { emp: Employee; ownAccount: boolean }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function savePassword() {
    setErr(null); setMsg(null);
    if (pw1.length < 8) { setErr("Passwort muss mindestens 8 Zeichen haben."); return; }
    if (pw1 !== pw2) { setErr("Die Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPw1(""); setPw2(""); setMsg("Passwort geändert ✓");
  }
  async function sendReset() {
    setErr(null); setMsg(null);
    if (!emp.email) { setErr("Keine E-Mail-Adresse hinterlegt."); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emp.email, { redirectTo: appUrl("/#/passwort-setzen") });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMsg(`Reset-Link an ${emp.email} gesendet.`);
  }

  return (
    <>
      <SectionTitle>Passwort ändern</SectionTitle>
      <ErrorBanner message={err} />
      {msg && <div className="mb-3 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-600">{msg}</div>}

      <div className="max-w-md space-y-3">
        <div><label className="label">Neues Passwort</label>
          <input type="password" className="input" value={pw1} onChange={(e) => setPw1(e.target.value)} disabled={!ownAccount} autoComplete="new-password" /></div>
        <div><label className="label">Passwort wiederholen</label>
          <input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={!ownAccount} autoComplete="new-password" /></div>
        <button className="btn-primary" disabled={busy || !ownAccount} onClick={savePassword}><KeyRound size={16} /> Passwort speichern</button>
        {!ownAccount && (
          <p className="text-xs text-slate-400">
            Ein Passwort direkt setzen ist nur für das eigene Konto möglich. Für andere Mitarbeiter den Reset-Link verwenden.
          </p>
        )}
      </div>

      <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="mb-2 text-sm font-medium">Passwort zurücksetzen</div>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Sendet einen Reset-Link an die hinterlegte E-Mail-Adresse des Mitarbeiters.</p>
        <button className="btn-outline" disabled={busy} onClick={sendReset}><Mail size={15} /> Reset-Link senden</button>
      </div>
    </>
  );
}

function Soon() {
  return (
    <div className="py-10 text-center">
      <Lock size={28} className="mx-auto mb-3 text-slate-300" />
      <div className="font-semibold">Dieser Bereich wird in der nächsten Ausbaustufe erweitert</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
        Urlaub & Abwesenheiten, Zeiterfassung, Stundenausgleich und Dokumente folgen – inklusive Feiertage und BUAK-Kalender (kurze/lange Woche).
      </p>
    </div>
  );
}
