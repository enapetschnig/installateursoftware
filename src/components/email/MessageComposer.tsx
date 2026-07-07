// ============================================================
// B4Y SuperAPP – E-Mail: Composer (Entwurf)
// Antworten / Allen antworten / Weiterleiten / Neu öffnen ein Entwurfsfenster
// mit vorbelegten Empfängern/Betreff. SENDET NICHTS (kein Graph, kein Versand).
// Bewusst klar als Demo gekennzeichnet; „Senden" ist deaktiviert.
// ============================================================
import { useState } from "react";
import { Send, X, Info } from "lucide-react";
import { Modal } from "../ui";
import { EmailAddress } from "../../lib/email-types";
import { addressLabel } from "../../lib/email";

export type ComposerDraft = {
  mode: "reply" | "replyAll" | "forward" | "new";
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  bodyText: string;
};

const joinAddr = (list: EmailAddress[]) => list.map(addressLabel).join(", ");

export default function MessageComposer({ draft, onClose }: { draft: ComposerDraft; onClose: () => void }) {
  const [to, setTo] = useState(joinAddr(draft.to));
  const [cc, setCc] = useState(joinAddr(draft.cc));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.bodyText);
  const title = draft.mode === "forward" ? "Weiterleiten (Entwurf)"
    : draft.mode === "new" ? "Neue Nachricht (Entwurf)" : "Antwort (Entwurf)";

  return (
    <Modal open onClose={onClose} title={title} size="xl">
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>Demo-/Vorschau-Modus: Dieser Entwurf wird <b>nicht versendet</b>. Der echte Versand folgt mit der Microsoft-Graph-Anbindung.</span>
      </div>
      <div className="space-y-2.5">
        <div><label className="label">An</label>
          <input className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label className="label">Cc</label>
          <input className="input" value={cc} onChange={(e) => setCc(e.target.value)} /></div>
        <div><label className="label">Betreff</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div><label className="label">Nachricht</label>
          <textarea className="input min-h-[180px]" value={body} onChange={(e) => setBody(e.target.value)} /></div>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">Entwurf bleibt nur lokal – nichts wird gespeichert oder gesendet.</span>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={onClose}><X size={15} /> Verwerfen</button>
          <button className="btn-primary cursor-not-allowed opacity-60" disabled title="Versand erst nach Microsoft-Graph-Anbindung">
            <Send size={15} /> Senden (deaktiviert)
          </button>
        </div>
      </div>
    </Modal>
  );
}
