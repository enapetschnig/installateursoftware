// ============================================================
// Installateur SuperAPP – Aufgabe aus einem CRM-Vorgang verteilen
// ------------------------------------------------------------
// Direkt aus der Board-Karte: "Besichtigung vereinbaren" an Michael, bis
// Freitag. Die Aufgabe landet im normalen Aufgaben-Board (board="crm") und
// – bei Kundenbezug – zusätzlich in der Kundenakte. Kein zweites
// Aufgabensystem (Projektregel: keine Doppelstrukturen).
// ============================================================
import { useEffect, useState } from "react";
import { ListPlus } from "lucide-react";
import { Modal } from "../ui";
import { toast } from "../../lib/toast";
import { aufgabeAusVorgang, loadMitarbeiter, type Mitarbeiter, type Vorgang } from "../../lib/crm-board";

/** Häufige Aufgaben – ein Klick statt tippen (Board lebt von Tempo). */
const VORLAGEN = [
  "Kunden anrufen",
  "Besichtigung vereinbaren",
  "Angebot erstellen",
  "Angebot nachfassen",
  "Material bestellen",
  "Termin einplanen",
];

export default function AufgabeDialog({
  vorgang, onClose, onSaved,
}: { vorgang: Vorgang | null; onClose: () => void; onSaved: () => void }) {
  const [titel, setTitel] = useState("");
  const [faellig, setFaellig] = useState("");
  const [assignee, setAssignee] = useState("");
  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!vorgang) return;
    setTitel("");
    setFaellig("");
    setAssignee("");
    void loadMitarbeiter().then(setMitarbeiter);
  }, [vorgang]);

  async function speichern() {
    if (!vorgang || !titel.trim()) return;
    setBusy(true);
    const ok = await aufgabeAusVorgang({
      vorgang,
      titel: titel.trim(),
      faellig: faellig || null,
      assigneeAuthId: assignee || null,
      beschreibung: `Aus CRM-Vorgang: ${vorgang.titel}`,
    });
    setBusy(false);
    if (!ok) { toast("Die Aufgabe konnte nicht angelegt werden."); return; }
    toast("Aufgabe verteilt – sie erscheint im Aufgaben-Board.");
    onSaved();
    onClose();
  }

  return (
    <Modal open={!!vorgang} onClose={onClose} title="Aufgabe verteilen">
      <p className="text-xs text-slate-400">
        Zu: <b>{vorgang?.titel}</b>{vorgang?.kunde ? ` · ${vorgang.kunde}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {VORLAGEN.map((v) => (
          <button key={v} className="rounded-lg border px-2 py-1 text-xs text-slate-500 transition hover:border-brand-300"
                  style={{ borderColor: "var(--border)" }} onClick={() => setTitel(v)}>
            {v}
          </button>
        ))}
      </div>

      <label className="label mt-3">Aufgabe</label>
      <input className="input" value={titel} onChange={(e) => setTitel(e.target.value)}
             placeholder="Was ist zu tun?" autoFocus />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Wer</label>
          <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Niemand zugewiesen</option>
            {mitarbeiter.filter((m) => m.auth_user_id).map((m) => (
              <option key={m.id} value={m.auth_user_id ?? ""}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Bis wann</label>
          <input type="date" className="input" value={faellig} onChange={(e) => setFaellig(e.target.value)} />
          <div className="mt-1 flex gap-1">
            {[1, 3, 7].map((t) => (
              <button key={t} className="btn-ghost px-1.5 py-0.5 text-[11px]"
                      onClick={() => setFaellig(new Date(Date.now() + t * 86_400_000).toISOString().slice(0, 10))}>
                +{t} Tag{t > 1 ? "e" : ""}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !titel.trim()} onClick={() => void speichern()}>
          <ListPlus size={16} /> Aufgabe verteilen
        </button>
      </div>
    </Modal>
  );
}
