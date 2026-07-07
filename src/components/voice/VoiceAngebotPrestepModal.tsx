// ============================================================
// B4Y SuperAPP – Sprach-Angebot Pre-Step-Modal
// ------------------------------------------------------------
// Erscheint VOR dem eigentlichen Voice-Dialog (VoiceAngebotDialog).
// Erzwingt eine Kunden-/Projekt-Auswahl, bevor ein Angebots-Draft
// in der DB angelegt wird.
//
// Aufrufer:
//   - Cockpit.tsx (startVoiceAngebot-Button)
//   - DocumentCreateMenu.tsx ("Per Sprache erstellen"-Eintrag)
//
// Der Modal-Submit triggert NICHT selbst den Insert in die offers-
// Tabelle — er ruft nur onConfirm({contactId, projectId}). Der
// Caller macht dann startCreateRoute(..., {contactId, projectId,
// voice:true}) und navigiert in den OfferEditor.
//
// Quick-Create-Pfad: Ein eingebetteter "Neuen Kunden"-Modus legt
// direkt einen minimalen Kontakt-Datensatz an und selektiert ihn
// automatisch. So muss der User nicht erst /kontakte besuchen.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Loader2, Mic, UserPlus, ArrowLeft } from "lucide-react";
import { Modal } from "../ui";
import { supabase } from "../../lib/supabase";
import type { Contact, Project } from "../../lib/types";
import { toast, toastError } from "../../lib/toast";

export interface VoiceAngebotPrestepResult {
  contactId: string | null;
  projectId: string | null;
}

export interface VoiceAngebotPrestepModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Wird mit der finalen Auswahl aufgerufen. Mindestens contactId ODER
   * projectId ist gesetzt (UI-Validierung im Modal verhindert leere
   * Submit-Aufrufe).
   */
  onConfirm: (r: VoiceAngebotPrestepResult) => void;
  /**
   * Wenn der Caller noch im Hintergrund die Offer anlegt → zeigt
   * Spinner + deaktiviert den Submit-Button. Modal kann waehrend
   * dessen NICHT geschlossen werden.
   */
  submitting?: boolean;
  /** Test-Injection: alternativer Loader fuer contacts. */
  contactsLoader?: () => Promise<Contact[]>;
  /** Test-Injection: alternativer Loader fuer projects. */
  projectsLoader?: () => Promise<Project[]>;
  /**
   * Test-Injection: alternativer Quick-Create-Handler.
   * Bekommt das vorbereitete Payload und gibt den frisch erzeugten
   * Contact zurueck (mit gueltiger id). Erlaubt es Tests, den
   * supabase-Insert zu mocken.
   */
  quickCreateContact?: (payload: QuickContactPayload) => Promise<Contact>;
}

export interface QuickContactPayload {
  customer_type: "privat" | "firma";
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
}

// ── Helper ───────────────────────────────────────────────────

export function contactDisplayLabel(c: Contact): string {
  const personName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (c.company && personName) return `${c.company} — ${personName}`;
  if (c.company) return c.company;
  if (personName) return personName;
  return "(unbenannter Kontakt)";
}

async function defaultContactsLoader(): Promise<Contact[]> {
  const r = await supabase
    .from("contacts")
    .select("*")
    .eq("status", "aktiv")
    .order("created_at", { ascending: false })
    .limit(500);
  return (r.data as Contact[]) ?? [];
}

async function defaultProjectsLoader(): Promise<Project[]> {
  const r = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  return (r.data as Project[]) ?? [];
}

async function defaultQuickCreate(payload: QuickContactPayload): Promise<Contact> {
  // RPC fuer Nummernkreis-Pull — falls kein Nummernkreis aktiv ist,
  // legen wir trotzdem an (contact_number bleibt null, kann spaeter
  // im Editor gepflegt werden).
  let contactNumber: string | null = null;
  try {
    const rpc = await supabase.rpc("next_document_number", { p_doc_type: "kunde" });
    if (typeof rpc.data === "string") contactNumber = rpc.data;
  } catch {
    /* ignore */
  }
  const insertPayload = {
    type: "kunde",
    customer_type: payload.customer_type,
    status: "aktiv",
    first_name: payload.first_name,
    last_name: payload.last_name,
    company: payload.company,
    phone: payload.phone,
    email: payload.email,
    contact_number: contactNumber,
  };
  const res = await supabase
    .from("contacts")
    .insert(insertPayload)
    .select("*")
    .single();
  if (res.error || !res.data) {
    throw new Error(res.error?.message || "Kontakt konnte nicht angelegt werden.");
  }
  return res.data as Contact;
}

// ── Component ────────────────────────────────────────────────

type Mode = "picker" | "quick-create";

export function VoiceAngebotPrestepModal({
  open,
  onClose,
  onConfirm,
  submitting = false,
  contactsLoader,
  projectsLoader,
  quickCreateContact,
}: VoiceAngebotPrestepModalProps) {
  const [mode, setMode] = useState<Mode>("picker");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  const [contactSearch, setContactSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  // Quick-Create-State
  const [qcCustType, setQcCustType] = useState<"privat" | "firma">("privat");
  const [qcFirst, setQcFirst] = useState("");
  const [qcLast, setQcLast] = useState("");
  const [qcCompany, setQcCompany] = useState("");
  const [qcPhone, setQcPhone] = useState("");
  const [qcEmail, setQcEmail] = useState("");
  const [qcBusy, setQcBusy] = useState(false);

  // ── Datenladung beim Open ─────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [c, p] = await Promise.all([
          (contactsLoader ?? defaultContactsLoader)(),
          (projectsLoader ?? defaultProjectsLoader)(),
        ]);
        if (!alive) return;
        setContacts(c);
        setProjects(p);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "Daten konnten nicht geladen werden.";
        toastError(msg);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, contactsLoader, projectsLoader]);

  // Reset beim Schliessen
  useEffect(() => {
    if (open) return;
    setMode("picker");
    setContactSearch("");
    setSelectedContactId("");
    setSelectedProjectId("");
    setQcCustType("privat");
    setQcFirst("");
    setQcLast("");
    setQcCompany("");
    setQcPhone("");
    setQcEmail("");
    setQcBusy(false);
  }, [open]);

  // Projekt-Wahl → Auto-Kunde (nur wenn noch keiner gewaehlt ist)
  useEffect(() => {
    if (!selectedProjectId) return;
    const p = projects.find((x) => x.id === selectedProjectId);
    if (p?.contact_id && !selectedContactId) {
      setSelectedContactId(p.contact_id);
    }
  }, [selectedProjectId, projects, selectedContactId]);

  // ── Such-Filter ───────────────────────────────────────────
  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts.slice(0, 100);
    return contacts
      .filter((c) => contactDisplayLabel(c).toLowerCase().includes(q))
      .slice(0, 100);
  }, [contacts, contactSearch]);

  // ── Submit ────────────────────────────────────────────────
  const canSubmit =
    (selectedContactId.length > 0 || selectedProjectId.length > 0) &&
    !submitting &&
    !loading;

  function handleSubmit() {
    if (!canSubmit) return;
    onConfirm({
      contactId: selectedContactId || null,
      projectId: selectedProjectId || null,
    });
  }

  // ── Quick-Create ──────────────────────────────────────────
  const qcCanSubmit =
    (qcCustType === "privat" && (qcFirst.trim() || qcLast.trim())) ||
    (qcCustType === "firma" && qcCompany.trim().length > 0);

  async function handleQuickCreate() {
    if (!qcCanSubmit || qcBusy) return;
    setQcBusy(true);
    try {
      const payload: QuickContactPayload = {
        customer_type: qcCustType,
        first_name: qcFirst.trim() || null,
        last_name: qcLast.trim() || null,
        company: qcCompany.trim() || null,
        phone: qcPhone.trim() || null,
        email: qcEmail.trim() || null,
      };
      const created = await (quickCreateContact ?? defaultQuickCreate)(payload);
      // Liste aktualisieren + neuen Kontakt sofort selektieren
      setContacts((prev) => [created, ...prev]);
      setSelectedContactId(created.id);
      toast(`Kontakt „${contactDisplayLabel(created)}" angelegt`);
      setMode("picker");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kontakt konnte nicht angelegt werden.";
      toastError(msg);
    } finally {
      setQcBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={() => !submitting && !qcBusy && onClose()}
      title={mode === "picker" ? "Sprach-Angebot vorbereiten" : "Neuen Kunden anlegen"}
      size="md"
    >
      {mode === "picker" ? (
        <>
          <p className="mb-4 text-sm" style={{ color: "var(--text2)" }}>
            Wähle den Kunden (optional zusätzlich ein Projekt). Im nächsten Schritt
            diktierst du das Angebot per Sprache.
          </p>

          {/* Kunden-Picker */}
          <div className="mb-4">
            <label className="label" htmlFor="vap-contact-search">
              Kunde {selectedProjectId ? "(optional, kann vom Projekt geerbt werden)" : "*"}
            </label>
            <input
              id="vap-contact-search"
              className="input mb-2"
              type="text"
              placeholder="Suchen nach Name oder Firma …"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              disabled={submitting || loading}
            />
            <select
              className="input"
              size={6}
              value={selectedContactId}
              onChange={(e) => setSelectedContactId(e.target.value)}
              disabled={submitting || loading}
              data-testid="vap-contact-select"
            >
              <option value="">– kein Kunde gewählt –</option>
              {filteredContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {contactDisplayLabel(c)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-ghost mt-2 text-xs"
              onClick={() => setMode("quick-create")}
              disabled={submitting || loading}
            >
              <UserPlus size={14} /> Neuen Kunden anlegen
            </button>
          </div>

          {/* Projekt-Picker (optional) */}
          <div className="mb-2">
            <label className="label" htmlFor="vap-project-select">
              Projekt (optional)
            </label>
            <select
              id="vap-project-select"
              className="input"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              disabled={submitting || loading}
              data-testid="vap-project-select"
            >
              <option value="">– kein Projekt –</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            {selectedProjectId && (
              <p className="mt-1 text-xs" style={{ color: "var(--text2)" }}>
                Wenn das Projekt bereits einen Kunden hat, wird dieser automatisch
                übernommen (oben überschreibbar).
              </p>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="vap-submit"
            >
              {submitting ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Mic size={16} />
              )}
              {submitting ? "Angebot wird angelegt …" : "Weiter mit Sprache"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm" style={{ color: "var(--text2)" }}>
            Minimal-Angaben reichen — du kannst alle weiteren Details später im
            Kontakt-Editor ergänzen.
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
                  onClick={() => setQcCustType(opt)}
                  disabled={qcBusy}
                  className="rounded-md px-3 py-1 text-sm"
                  style={{
                    background: qcCustType === opt ? "var(--accent)" : "transparent",
                    color: qcCustType === opt ? "white" : "var(--text)",
                  }}
                >
                  {opt === "privat" ? "Privatkunde" : "Firma"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {qcCustType === "firma" && (
              <div className="sm:col-span-2">
                <label className="label" htmlFor="qc-company">Firma *</label>
                <input
                  id="qc-company"
                  className="input"
                  value={qcCompany}
                  onChange={(e) => setQcCompany(e.target.value)}
                  disabled={qcBusy}
                />
              </div>
            )}
            <div>
              <label className="label" htmlFor="qc-first">Vorname</label>
              <input
                id="qc-first"
                className="input"
                value={qcFirst}
                onChange={(e) => setQcFirst(e.target.value)}
                disabled={qcBusy}
              />
            </div>
            <div>
              <label className="label" htmlFor="qc-last">Nachname</label>
              <input
                id="qc-last"
                className="input"
                value={qcLast}
                onChange={(e) => setQcLast(e.target.value)}
                disabled={qcBusy}
              />
            </div>
            <div>
              <label className="label" htmlFor="qc-phone">Telefon</label>
              <input
                id="qc-phone"
                className="input"
                value={qcPhone}
                onChange={(e) => setQcPhone(e.target.value)}
                disabled={qcBusy}
              />
            </div>
            <div>
              <label className="label" htmlFor="qc-email">E-Mail</label>
              <input
                id="qc-email"
                type="email"
                className="input"
                value={qcEmail}
                onChange={(e) => setQcEmail(e.target.value)}
                disabled={qcBusy}
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setMode("picker")}
              disabled={qcBusy}
            >
              <ArrowLeft size={14} /> Zurück
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleQuickCreate}
              disabled={!qcCanSubmit || qcBusy}
              data-testid="vap-qc-submit"
            >
              {qcBusy ? <Loader2 className="animate-spin" size={16} /> : <UserPlus size={16} />}
              {qcBusy ? "Lege Kontakt an …" : "Anlegen und auswählen"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default VoiceAngebotPrestepModal;
