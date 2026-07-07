// ============================================================
// B4Y SuperAPP – Einstellungen: Firmeneinstellungen
// Adresse, Firmenbuch-/Steuernummer/UID, Geschäftsführer, Bankdaten,
// Kontakt und Logo. Speist Kopf-/Fußzeile der Dokumente.
// ============================================================
import { useEffect, useRef, useState, RefObject, CSSProperties } from "react";
import { Building2, Upload, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { ErrorBanner } from "./calc-ui";
import { CompanySettings as Co, refreshCompanySettings } from "../lib/company";
import RichTextEditor from "./RichTextEditor";
import { sanitizeHtml } from "../lib/sanitize";
import { useUnsavedChanges } from "../lib/unsaved-changes";

// Logos müssen ohne Auth lesbar sein (Login-Seite, PDF-Einbettung) → eigener
// ÖFFENTLICHER Bucket `branding` (project-files ist privat – siehe Migration 0064).
const BUCKET = "branding";

const empty: Co = {
  id: 1, name: "", street: "", zip: "", city: "", country: "Österreich",
  fn: "", fn_court: "", tax_number: "", uid: "", ceo: "",
  gesellschafter: [], geschaeftsfuehrer: [],
  bank_name: "", iban: "", bic: "", phone: "", mobile: "", email: "", web: "", logo_url: "", icon_logo_url: "",
  document_signature_html: "",
  document_signature_mode: "allow_employee",
  email_signature_html: "",
};

export default function CompanySettings({ canManage }: { canManage: boolean }) {
  const [f, setF] = useState<Co>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo_url" | "icon_logo_url" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const loadedRef = useRef<Co>(empty); // zuletzt geladener/gespeicherter Stand (für „Verwerfen")
  const mainRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof Co, v: any) => { setF((p) => ({ ...p, [k]: v })); setSavedAt(null); setDirty(true); };

  // Schutz vor ungespeicherten Änderungen (zentraler Guard): speichern oder verwerfen.
  useUnsavedChanges(
    "company-settings",
    canManage && dirty,
    () => save(),
    () => { setF(loadedRef.current); setDirty(false); setSavedAt(null); },
  );

  useEffect(() => {
    supabase.from("company_settings").select("*").limit(1).maybeSingle().then(({ data }) => {
      if (data) { const loaded = { ...empty, ...(data as Co) }; setF(loaded); loadedRef.current = loaded; }
      setLoading(false);
    });
  }, []);

  async function uploadLogo(file: File, field: "logo_url" | "icon_logo_url") {
    setUploading(field); setErr(null);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const slot = field === "icon_logo_url" ? "icon" : "logo";
      const path = `branding/${slot}_${Date.now()}.${ext}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600", upsert: true, contentType: file.type || "image/png",
      });
      if (up.error) throw up.error;
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      set(field, url);
    } catch (e: any) {
      setErr(e?.message ?? "Logo konnte nicht hochgeladen werden.");
    } finally {
      setUploading(null);
    }
  }

  async function save(): Promise<boolean> {
    setSaving(true); setErr(null);
    // Personen-Listen bereinigen: trimmen + leere Einträge entfernen (keine leeren Namen speichern).
    const cleanList = (a?: string[] | null) => (a ?? []).map((s) => (s ?? "").trim()).filter(Boolean);
    const payload = {
      ...f, id: (f as any).id ?? 1,
      gesellschafter: cleanList(f.gesellschafter),
      geschaeftsfuehrer: cleanList(f.geschaeftsfuehrer),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("company_settings")
      .upsert(payload, { onConflict: "id" });
    setSaving(false);
    if (error) { setErr(error.message); return false; }
    refreshCompanySettings(); // Logo in Sidebar & Co. sofort aktualisieren
    setSavedAt(new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }));
    setDirty(false);
    loadedRef.current = { ...f }; // gespeicherten Stand als neuen „Verwerfen"-Bezug merken
    return true;
  }

  if (!canManage) {
    return (
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Firmeneinstellungen</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Firmeneinstellungen können nur von Administrator, Geschäftsführung oder Buchhaltung verwaltet werden.
        </p>
      </div>
    );
  }

  const field = (label: string, k: keyof Co, placeholder?: string, span?: boolean) => (
    <div className={span ? "sm:col-span-2" : ""} key={k as string}>
      <label className="label">{label}</label>
      <input className="input" value={(f[k] as string) ?? ""} placeholder={placeholder}
        onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  // Mehrfach-Personenliste (Gesellschafter / Geschäftsführer): hinzufügen & entfernen.
  const personList = (
    label: string, k: "gesellschafter" | "geschaeftsfuehrer", addLabel: string, placeholder: string, hint?: string,
  ) => {
    const arr = (f[k] as string[]) ?? [];
    const update = (next: string[]) => set(k, next);
    return (
      <div className="sm:col-span-2">
        <label className="label">{label}</label>
        <div className="space-y-2">
          {arr.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input" value={v} placeholder={`${placeholder} ${i + 1}`}
                onChange={(e) => update(arr.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" className="btn-ghost px-2 text-rose-500" title="Entfernen"
                onClick={() => update(arr.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" className="btn-outline text-sm" onClick={() => update([...arr, ""])}>
            <Plus size={14} /> {addLabel}
          </button>
        </div>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>
    );
  };

  // Karierter Hintergrund, damit transparente PNG/SVG sichtbar sind (alle Themes).
  const CHECKER: CSSProperties = {
    backgroundColor: "#ffffff",
    backgroundImage:
      "linear-gradient(45deg,#e2e8f0 25%,transparent 25%),linear-gradient(-45deg,#e2e8f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f0 75%),linear-gradient(-45deg,transparent 75%,#e2e8f0 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
  };

  const logoCard = (
    k: "logo_url" | "icon_logo_url", title: string, hint: string,
    emptyLabel: string, variant: "main" | "icon", ref: RefObject<HTMLInputElement>,
  ) => (
    <div className="flex flex-col gap-3 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
      <div className="text-sm font-bold">{title}</div>
      {/* Vorschau: nie beschneiden (object-contain), zentriert, Seitenverhältnis bleibt. */}
      <div
        className={`mx-auto flex items-center justify-center overflow-hidden rounded-lg border ${
          variant === "icon" ? "h-[140px] w-[140px]" : "h-[130px] w-full max-w-[480px]"
        }`}
        style={{ borderColor: "var(--border)", ...CHECKER }}
      >
        {f[k]
          ? <img src={f[k] as string} alt={title} className="object-contain p-2" style={{ maxHeight: "100%", maxWidth: "100%" }} />
          : <span className="text-xs font-medium text-slate-500">{emptyLabel}</span>}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/svg+xml,.svg" className="hidden"
        onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadLogo(file, k); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-outline" onClick={() => ref.current?.click()} disabled={uploading !== null}>
          {uploading === k ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading === k ? "Lädt hoch …" : `${title} hochladen`}
        </button>
        {f[k] && <button className="btn-ghost text-xs text-rose-500" onClick={() => set(k, "")}>Entfernen</button>}
      </div>
      <span className="text-xs text-slate-400">{hint}</span>
    </div>
  );

  return (
    <div className="glass p-4">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><Building2 size={20} /> Firmeneinstellungen</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Diese Angaben erscheinen in Kopf- und Fußzeile deiner Dokumente.
      </p>
      <ErrorBanner message={err} />

      {loading ? <p className="text-sm text-slate-400">Lädt …</p> : (
        <div className="space-y-4">
          {/* Logos */}
          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-500">Logos</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {logoCard("logo_url", "Hauptlogo",
                "Wird für Dokumente, PDFs und Firmenauftritt verwendet. PNG, JPG oder SVG.",
                "Kein Logo", "main", mainRef)}
              {logoCard("icon_logo_url", "Icon-Logo",
                "Wird für kleine Darstellungen, Sidebar, App-Icon und mobile Ansicht verwendet. Ohne eigenes Icon-Logo wird automatisch das Hauptlogo verwendet.",
                "Kein Icon-Logo", "icon", iconRef)}
            </div>
          </div>

          {/* Stammdaten */}
          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-500">Firma & Adresse</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("Firmenname", "name", "BAU4YOU Baranowski Bau GmbH", true)}
              {field("Straße / Hausnummer", "street", "Hyegasse 3 / Lokal B", true)}
              {field("PLZ", "zip", "1030")}
              {field("Ort", "city", "Wien")}
              {field("Land", "country", "Österreich")}
            </div>
          </div>

          {/* Gesellschafter & Geschäftsführer (mehrfach, mandantenfähig) */}
          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-500">Gesellschafter & Geschäftsführer</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {personList("Gesellschafter", "gesellschafter", "Gesellschafter hinzufügen", "Gesellschafter",
                "Erscheint in der PDF-Firmenzeile bevorzugt, z. B. Gesellschafter: Lukasz Baranowski. Mehrere möglich.")}
              {personList("Geschäftsführer", "geschaeftsfuehrer", "Geschäftsführer hinzufügen", "Geschäftsführer",
                "Wird in der PDF-Firmenzeile nur verwendet, wenn kein Gesellschafter eingetragen ist (dann der erste). Mehrere möglich.")}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-500">Rechtliche Angaben</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("Firmenbuchnummer (FN)", "fn", "296600b")}
              {field("Firmenbuchgericht", "fn_court", "Wien")}
              {field("Steuernummer", "tax_number", "382375756")}
              {field("USt-IdNr. (UID)", "uid", "ATU63544828")}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-500">Bankverbindung</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("Bank", "bank_name", "BAWAG PSK", true)}
              {field("IBAN", "iban", "AT62 1400 0042 1083 2292")}
              {field("BIC", "bic", "BAWAATWW")}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-500">Kontakt</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("Telefon", "phone", "+43 …")}
              {field("Mobil", "mobile", "+43 664 5056387")}
              {field("E-Mail", "email", "office@bau4you.at")}
              {field("Webseite", "web", "www.bau4you.at")}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-500">Dokument-Signatur (Standard)</h3>
            <p className="mb-2 text-xs text-slate-400">
              Globale Standard-Signatur für Dokumente/PDFs (Angebote, Aufträge, Rechnungen). Wird verwendet,
              wenn der erstellende Mitarbeiter keine eigene aktive Dokument-Signatur hat. Bleibt das Feld leer,
              setzt die PDF-Engine automatisch „Mit freundlichen Grüßen" + Geschäftsführer/Gesellschafter ein.
              Getrennt von den E-Mail-Signaturen der Mitarbeiter.
            </p>
            {/* Firmen-Modus: erzwingen vs. Mitarbeiter-Signaturen erlauben (Migr. 0123). */}
            <label className="label">Modus</label>
            <select
              className="input mb-2"
              value={(f.document_signature_mode as string) ?? "allow_employee"}
              onChange={(e) => set("document_signature_mode", e.target.value)}
            >
              <option value="allow_employee">Mitarbeiter-Dokumentsignaturen erlauben</option>
              <option value="force_company">Firmen-Dokumentsignatur für alle erzwingen</option>
            </select>
            <p className="mb-2 text-xs text-slate-400">
              {(f.document_signature_mode as string) === "force_company"
                ? "Es wird immer die Firmen-Dokumentsignatur verwendet – die pro Dokument gewählte Quelle „Ersteller“ wird ignoriert."
                : "Mitarbeiter dürfen eigene Dokument-Signaturen verwenden (Quelle „Ersteller“), sofern sie beim Mitarbeiter aktiv und befüllt sind; sonst gilt diese Firmen-Signatur."}
            </p>
            <RichTextEditor
              value={f.document_signature_html ?? ""}
              onChange={(html) => set("document_signature_html", html)}
              placeholder="z. B. Mit freundlichen Grüßen, Ihr BAU4YOU-Team …"
            />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-500">E-Mail-Signatur (Standard)</h3>
            <p className="mb-2 text-xs text-slate-400">
              Allgemeine E-Mail-Signatur der Firma. Wird verwendet, wenn ein Mitarbeiter keine eigene
              aktive E-Mail-Signatur hat. Ist auch dieses Feld leer, wird keine Signatur angehängt.
              Bewusst getrennt von der Dokument-Signatur oben (PDF/Belege).
            </p>
            <RichTextEditor
              value={f.email_signature_html ?? ""}
              onChange={(html) => set("email_signature_html", html)}
              placeholder="z. B. BAU4YOU Baranowski Bau GmbH · office@bau4you.at · www.bau4you.at"
            />
            {f.email_signature_html?.trim() && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Vorschau</div>
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                  <div className="mail-editor text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(f.email_signature_html) }} />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3">
            {savedAt && <span className="text-xs text-emerald-500">gespeichert {savedAt}</span>}
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Speichern …" : "Speichern"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
