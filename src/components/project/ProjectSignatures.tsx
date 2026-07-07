// ============================================================
// B4Y SuperAPP – Projektbereich „Organisation": Unterschriften
// Digitale Subunternehmer-/Bestätigungs-Unterschriften, projektbezogen,
// optional mit Baubesprechung/Kontakt/Beteiligtem verknüpft.
// SignatureCaptureModal ist wiederverwendbar (auch in Baubesprechungen).
// ============================================================
import { useEffect, useState } from "react";
import { Trash2, PenLine, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Badge, Modal } from "../ui";
import { ConfirmDialog } from "../calc-ui";
import { useAuth } from "../../lib/auth";
import { useCan } from "../../lib/permissions";
import SignaturePad from "../SignaturePad";
import {
  ProjectSignature, SignatureInput, SIGNATURE_PURPOSE_LABEL, SignaturePurpose,
  listSignatures, createSignature, softDeleteSignature,
} from "../../lib/project-signatures";

const dt = (s?: string | null) =>
  s ? new Date(s).toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";

type ContactLite = { id: string; company: string | null; first_name: string | null; last_name: string | null; customer_type: string | null };
type ParticipantLite = { id: string; name: string | null; role: string | null; contact_id: string | null };

const contactName = (c: ContactLite) =>
  c.customer_type === "firma" ? (c.company || "Firma")
    : [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "–";

/* ============================================================
   Wiederverwendbares Erfassungs-Modal
============================================================ */
export function SignatureCaptureModal({
  projectId, meetingId = null, defaultPurpose = "protokoll", onClose, onSaved,
}: {
  projectId: string;
  meetingId?: string | null;
  defaultPurpose?: SignaturePurpose;
  onClose: () => void;
  onSaved: (sig: ProjectSignature) => void;
}) {
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [participants, setParticipants] = useState<ParticipantLite[]>([]);
  const [f, setF] = useState({
    contact_id: "", participant_id: "",
    signer_name: "", signer_company: "", signer_role: "",
    purpose: defaultPurpose as string, location: "", note: "",
  });
  const [data, setData] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    supabase.from("contacts").select("id,company,first_name,last_name,customer_type").order("company")
      .then(({ data }) => setContacts((data as ContactLite[]) ?? []));
    supabase.from("project_participants").select("id,name,role,contact_id").eq("project_id", projectId).order("sort_order")
      .then(({ data }) => setParticipants((data as ParticipantLite[]) ?? []));
  }, [projectId]);

  function pickParticipant(id: string) {
    set("participant_id", id);
    const p = participants.find((x) => x.id === id);
    if (p) {
      setF((s) => ({ ...s, participant_id: id, signer_name: p.name || s.signer_name, contact_id: p.contact_id || s.contact_id }));
    }
  }
  function pickContact(id: string) {
    set("contact_id", id);
    const c = contacts.find((x) => x.id === id);
    if (c) setF((s) => ({ ...s, contact_id: id, signer_company: c.customer_type === "firma" ? (c.company || s.signer_company) : s.signer_company, signer_name: c.customer_type !== "firma" ? (contactName(c) || s.signer_name) : s.signer_name }));
  }

  async function save() {
    if (!f.signer_name.trim()) { setErr("Bitte Name in Klarschrift eingeben."); return; }
    if (!data) { setErr("Bitte zuerst unterschreiben."); return; }
    setSaving(true); setErr(null);
    try {
      const input: SignatureInput = {
        project_id: projectId,
        meeting_id: meetingId,
        contact_id: f.contact_id || null,
        participant_id: f.participant_id || null,
        purpose: f.purpose,
        signer_name: f.signer_name.trim(),
        signer_company: f.signer_company.trim() || null,
        signer_role: f.signer_role.trim() || null,
        location: f.location.trim() || null,
        note: f.note.trim() || null,
        signature_data: data,
      };
      const sig = await createSignature(input);
      if (sig) onSaved(sig);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Fehler beim Speichern.");
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Unterschrift erfassen" size="xl">
      {err && <div className="mb-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">{err}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className="label">Verwendungszweck</label>
          <select className="input" value={f.purpose} onChange={(e) => set("purpose", e.target.value)}>
            {Object.entries(SIGNATURE_PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className="label">Projektbeteiligter (optional)</label>
          <select className="input" value={f.participant_id} onChange={(e) => pickParticipant(e.target.value)}>
            <option value="">– auswählen –</option>
            {participants.map((p) => <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>)}
          </select></div>
        <div><label className="label">Firma / Kontakt (optional)</label>
          <select className="input" value={f.contact_id} onChange={(e) => pickContact(e.target.value)}>
            <option value="">– auswählen –</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
          </select></div>
        <div><label className="label">Firma (Klarschrift)</label>
          <input className="input" value={f.signer_company} onChange={(e) => set("signer_company", e.target.value)} placeholder="z.B. Mustermann Bau GmbH" /></div>
        <div><label className="label">Name (Klarschrift) *</label>
          <input className="input" value={f.signer_name} onChange={(e) => set("signer_name", e.target.value)} placeholder="Vor- und Nachname" /></div>
        <div><label className="label">Funktion / Rolle</label>
          <input className="input" value={f.signer_role} onChange={(e) => set("signer_role", e.target.value)} placeholder="z.B. Polier, Bauleiter" /></div>
        <div><label className="label">Ort (optional)</label>
          <input className="input" value={f.location} onChange={(e) => set("location", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Bemerkung (optional)</label>
          <input className="input" value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
      </div>

      <div className="mt-4">
        <label className="label">Unterschrift</label>
        <SignaturePad value={data} onChange={setData} height={200} />
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button className="btn-outline" onClick={onClose}><X size={15} /> Abbrechen</button>
        <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Speichert …" : "Übernehmen"}</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   Bereich: Unterschriften eines Projekts
============================================================ */
export default function ProjectSignatures({ projectId }: { projectId: string }) {
  const { session } = useAuth();
  const can = useCan();
  const [items, setItems] = useState<ProjectSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [capture, setCapture] = useState(false);
  const [delId, setDelId] = useState<ProjectSignature | null>(null);

  async function load() {
    setLoading(true);
    try { setItems(await listSignatures(projectId)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);

  if (!can("signatures", "view")) {
    return <div className="glass p-4 text-sm text-slate-400">Keine Berechtigung für Unterschriften.</div>;
  }

  return (
    <div className="glass p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold">Subunternehmer-Unterschriften</h3>
        {can("signatures", "create") && (
          <button className="btn-primary" onClick={() => setCapture(true)}><PenLine size={16} /> Unterschrift erfassen</button>
        )}
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-400">Lädt …</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Noch keine Unterschriften erfasst.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((s) => (
            <li key={s.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{s.signer_company || s.signer_name}</div>
                  <div className="text-xs text-slate-400">
                    {s.signer_company ? `${s.signer_name} · ` : ""}{s.signer_role || ""}
                  </div>
                </div>
                <Badge tone="slate">{SIGNATURE_PURPOSE_LABEL[(s.purpose as SignaturePurpose)] || s.purpose}</Badge>
              </div>
              {s.signature_data && (
                <div className="mt-2 rounded-lg border bg-white p-1" style={{ borderColor: "var(--border)" }}>
                  <img src={s.signature_data} alt="Unterschrift" style={{ maxHeight: 80, objectFit: "contain", width: "100%" }} />
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">{dt(s.signed_at)}{s.meeting_id ? " · Baubesprechung" : ""}</span>
                {can("signatures", "delete") && (
                  <button className="btn-ghost px-2 text-rose-500" title="Entfernen" onClick={() => setDelId(s)}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {capture && (
        <SignatureCaptureModal
          projectId={projectId}
          defaultPurpose="anwesenheit"
          onClose={() => setCapture(false)}
          onSaved={() => load()}
        />
      )}
      <ConfirmDialog
        open={!!delId}
        title="Unterschrift entfernen?"
        message="Die Unterschrift wird entfernt. Bereits abgeschlossene Protokolle bleiben als Snapshot unverändert."
        confirmLabel="Entfernen"
        onConfirm={async () => { if (delId) { await softDeleteSignature(delId, session?.user?.id ?? null); setDelId(null); load(); } }}
        onClose={() => setDelId(null)}
      />
    </div>
  );
}
