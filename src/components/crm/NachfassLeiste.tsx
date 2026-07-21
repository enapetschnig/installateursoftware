// ============================================================
// Installateur SuperAPP – Nachfass-Erinnerungen (CRM)
// ------------------------------------------------------------
// Zeigt oben im CRM, bei welchen versendeten Angeboten nachgefasst werden
// sollte (Standard: 5 Tage nach Versand, konfigurierbar).
//
// WICHTIG – bewusste Produktentscheidung (2026-07-21): Die Mail geht NIE
// von selbst raus. Sie wird als Entwurf vorbereitet, der Anwender sieht den
// vollständigen Text und gibt ihn frei. Grund: Ein automatischer Versand
// trifft irgendwann den Fall "Kunde hat gestern telefonisch abgesagt" oder
// "Angebot war fehlerhaft" – und der Schaden ist beim Kunden, nicht in der App.
// ============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, Send, X, Clock, FileText, Loader2 } from "lucide-react";
import { eur } from "../../lib/format";
import { Badge, Modal } from "../ui";
import { toast } from "../../lib/toast";
import { stoppeNachfass, markiereNachfassGesendet, type Nachfass } from "../../lib/crm-board";
import { supabase } from "../../lib/supabase";
import { sendMail } from "../../lib/microsoft/mailClient";

const dtf = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit" });

export default function NachfassLeiste({
  eintraege, onChange,
}: { eintraege: Nachfass[]; onChange: () => void }) {
  const [offen, setOffen] = useState<Nachfass | null>(null);
  const [betreff, setBetreff] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const heute = new Date().toISOString().slice(0, 10);
  const faellig = eintraege.filter((e) => e.faellig_am <= heute);
  const bald = eintraege.filter((e) => e.faellig_am > heute);

  async function entwurfOeffnen(n: Nachfass) {
    setOffen(n);
    setBetreff(n.mail_betreff ?? `Nachfrage zu unserem Angebot ${n.angebot_nummer ?? ""}`.trim());
    setText(n.mail_text ?? standardText(n));
  }

  async function freigebenUndSenden() {
    if (!offen) return;
    setBusy(true);
    try {
      // Empfängeradresse frisch aus dem Kontakt holen (nie aus dem Entwurf raten).
      const { data } = await supabase
        .from("contacts").select("email,invoice_email").eq("id", offen.contact_id ?? "").maybeSingle();
      const empfaenger = (data as { email?: string; invoice_email?: string } | null)?.email
        ?? (data as { invoice_email?: string } | null)?.invoice_email;
      if (!empfaenger) {
        toast("Für diesen Kunden ist keine E-Mail-Adresse hinterlegt.");
        setBusy(false);
        return;
      }
      await sendMail({
        to: [{ address: empfaenger }],
        subject: betreff,
        html: text.split("\n").map((z) => `<p>${z || "&nbsp;"}</p>`).join(""),
      });
      await markiereNachfassGesendet(offen.id);
      toast("Nachfass-Mail gesendet und im Kundenverlauf vermerkt.");
      setOffen(null);
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Die Mail konnte nicht gesendet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function stoppen(n: Nachfass) {
    if (!(await stoppeNachfass(n.id))) { toast("Konnte nicht gestoppt werden."); return; }
    toast("Nachfassen gestoppt.");
    onChange();
  }

  return (
    <div className="glass mb-3 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BellRing size={16} style={{ color: "var(--accent)" }} />
        Angebote nachfassen
        {faellig.length > 0 && <Badge tone="amber">{faellig.length} fällig</Badge>}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Die Mail wird vorbereitet – gesendet wird erst nach deiner Freigabe.
      </p>

      <div className="mt-2 space-y-1.5">
        {[...faellig, ...bald].slice(0, 6).map((n) => {
          const istFaellig = n.faellig_am <= heute;
          return (
            <div key={n.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-2"
                 style={{ borderColor: "var(--border)" }}>
              <FileText size={14} className="shrink-0 text-slate-400" />
              <Link to={`/angebote/${n.offer_id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">
                {n.angebot_nummer || "Angebot"}{n.kunde ? ` · ${n.kunde}` : ""}
              </Link>
              {n.angebot_netto ? <span className="text-xs font-semibold text-[var(--accent)]">{eur(n.angebot_netto)}</span> : null}
              <Badge tone={istFaellig ? "amber" : "slate"}>
                <Clock size={11} className="mr-1 inline" />
                {istFaellig ? "jetzt fällig" : `ab ${dtf.format(new Date(n.faellig_am))}`}
              </Badge>
              <div className="flex gap-1">
                <button className="btn-outline px-2 py-1 text-xs" onClick={() => void entwurfOeffnen(n)}>
                  <Send size={12} /> Entwurf ansehen
                </button>
                <button className="btn-ghost px-2 py-1 text-xs text-slate-400" title="Nicht nachfassen"
                        onClick={() => void stoppen(n)}>
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!offen} onClose={() => setOffen(null)} title="Nachfass-Mail freigeben" size="xl">
        <p className="text-xs text-slate-400">
          An: <b>{offen?.kunde ?? "Kunde"}</b> · Angebot {offen?.angebot_nummer ?? ""}
          {offen?.angebot_netto ? ` · ${eur(offen.angebot_netto)}` : ""}
        </p>
        <label className="label mt-3">Betreff</label>
        <input className="input" value={betreff} onChange={(e) => setBetreff(e.target.value)} />
        <label className="label mt-3">Text</label>
        <textarea className="input min-h-[220px] text-sm" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="btn-outline" onClick={() => setOffen(null)}>Abbrechen</button>
          <button className="btn-primary" disabled={busy || !betreff.trim() || !text.trim()}
                  onClick={() => void freigebenUndSenden()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Freigeben und senden
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** Vorlagentext, falls noch kein Entwurf vorbereitet wurde. */
function standardText(n: Nachfass): string {
  return [
    "Guten Tag,",
    "",
    `vor Kurzem haben wir Ihnen unser Angebot ${n.angebot_nummer ?? ""}${n.angebot_titel ? ` (${n.angebot_titel})` : ""} übermittelt.`,
    "",
    "Wir wollten kurz nachfragen, ob Sie dazu noch Fragen haben – etwa zum Umfang, zu den eingesetzten Materialien oder zum möglichen Ausführungstermin. Gerne passen wir das Angebot an Ihre Wünsche an.",
    "",
    "Für ein kurzes Telefonat stehen wir jederzeit zur Verfügung.",
    "",
    "Mit freundlichen Grüßen",
  ].join("\n");
}
