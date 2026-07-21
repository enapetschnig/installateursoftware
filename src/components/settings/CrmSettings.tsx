// ============================================================
// Installateur SuperAPP – Einstellungen: CRM
// ------------------------------------------------------------
// Pflegt die beiden konfigurierbaren Wertelisten des CRM:
//   * Aktivitätsarten (crm_activity_types, Migr. 0158) – womit ein Kontakt
//     im Verlauf festgehalten wird (Telefonat, Notiz, Vor-Ort-Termin …).
//   * Pipeline-Stufen (crm_pipeline_stages, Migr. 0163) – die Spalten des
//     Verkaufschancen-Boards.
// Beides sind DATEN, keine Programmlogik – jede Firma definiert ihre eigenen
// Arten und Stufen (Projektregel: nichts hartcodieren).
// ============================================================

import { useEffect, useState } from "react";
import { Contact2, Plus, Save, Trash2, GitBranch, BellRing } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { toast, toastError } from "../../lib/toast";

interface Art {
  id?: string; slug: string; label: string; icon: string | null; color: string | null;
  direction_default: string | null; counts_as_contact: boolean; active: boolean; sort_order: number;
}
interface Stufe {
  id?: string; slug: string; label: string; color: string | null; sort_order: number;
  is_won: boolean; is_lost: boolean; default_probability: number | null; active: boolean;
}

const FARBEN = ["blue", "green", "amber", "red", "violet", "slate"];
const slugify = (s: string) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
   .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "neu";

export default function CrmSettings({ canManage }: { canManage: boolean }) {
  const [arten, setArten] = useState<Art[]>([]);
  const [stufen, setStufen] = useState<Stufe[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Nachfass-Automatik (Migr. 0164): Erinnerung X Tage nach Angebotsversand.
  const [nachfassTage, setNachfassTage] = useState("5");
  const [nachfassAktiv, setNachfassAktiv] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, s, cs] = await Promise.all([
        supabase.from("crm_activity_types").select("*").order("sort_order"),
        supabase.from("crm_pipeline_stages").select("*").order("sort_order"),
        supabase.from("company_settings").select("crm_nachfass_tage, crm_nachfass_aktiv").limit(1).maybeSingle(),
      ]);
      if (!alive) return;
      setArten((a.data as Art[]) ?? []);
      setStufen((s.data as Stufe[]) ?? []);
      const c = cs.data as { crm_nachfass_tage?: number; crm_nachfass_aktiv?: boolean } | null;
      setNachfassTage(String(c?.crm_nachfass_tage ?? 5));
      setNachfassAktiv(c?.crm_nachfass_aktiv !== false);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  async function speichereArten() {
    setSaving(true);
    for (const a of arten) {
      const row = {
        slug: a.slug || slugify(a.label), label: a.label.trim(), icon: a.icon, color: a.color,
        direction_default: a.direction_default, counts_as_contact: a.counts_as_contact,
        active: a.active, sort_order: a.sort_order,
      };
      if (!row.label) continue;
      const res = a.id
        ? await supabase.from("crm_activity_types").update(row).eq("id", a.id)
        : await supabase.from("crm_activity_types").insert(row);
      if (res.error) { setSaving(false); toastError(`Speichern fehlgeschlagen: ${res.error.message}`); return; }
    }
    setSaving(false);
    toast("Aktivitätsarten gespeichert.");
    const { data } = await supabase.from("crm_activity_types").select("*").order("sort_order");
    setArten((data as Art[]) ?? []);
  }

  async function speichereStufen() {
    setSaving(true);
    for (const s of stufen) {
      const row = {
        slug: s.slug || slugify(s.label), label: s.label.trim(), color: s.color,
        sort_order: s.sort_order, is_won: s.is_won, is_lost: s.is_lost,
        default_probability: s.default_probability, active: s.active,
      };
      if (!row.label) continue;
      const res = s.id
        ? await supabase.from("crm_pipeline_stages").update(row).eq("id", s.id)
        : await supabase.from("crm_pipeline_stages").insert(row);
      if (res.error) { setSaving(false); toastError(`Speichern fehlgeschlagen: ${res.error.message}`); return; }
    }
    setSaving(false);
    toast("Pipeline-Stufen gespeichert.");
    const { data } = await supabase.from("crm_pipeline_stages").select("*").order("sort_order");
    setStufen((data as Stufe[]) ?? []);
  }

  async function loeschen(tabelle: "crm_activity_types" | "crm_pipeline_stages", id: string | undefined, i: number) {
    if (!id) {
      if (tabelle === "crm_activity_types") setArten((p) => p.filter((_, idx) => idx !== i));
      else setStufen((p) => p.filter((_, idx) => idx !== i));
      return;
    }
    // Bereits verwendete Einträge nicht hart löschen – sonst reißt es die
    // Historie auf (contact_events.activity_type_id ist ON DELETE RESTRICT).
    const { error } = await supabase.from(tabelle).update({ active: false }).eq("id", id);
    if (error) { toastError(`Deaktivieren fehlgeschlagen: ${error.message}`); return; }
    if (tabelle === "crm_activity_types") setArten((p) => p.map((x, idx) => (idx === i ? { ...x, active: false } : x)));
    else setStufen((p) => p.map((x, idx) => (idx === i ? { ...x, active: false } : x)));
    toast("Deaktiviert – bestehende Einträge bleiben erhalten.");
  }

  async function speichereNachfass() {
    const tage = Number(nachfassTage);
    if (!Number.isFinite(tage) || tage < 1 || tage > 90) {
      toastError("Bitte 1–90 Tage angeben.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("company_settings")
      .update({ crm_nachfass_tage: tage, crm_nachfass_aktiv: nachfassAktiv })
      .gte("id", 0);
    setSaving(false);
    if (error) { toastError(`Speichern fehlgeschlagen: ${error.message}`); return; }
    toast("Nachfass-Einstellungen gespeichert.");
  }

  if (loading) return <div className="card p-6 text-sm text-slate-400">CRM-Einstellungen werden geladen …</div>;

  return (
    <div className="space-y-4">
      {/* Nachfass-Automatik */}
      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BellRing size={16} style={{ color: "var(--accent)" }} /> Angebote nachfassen
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Nach dem Versand eines Angebots erscheint im CRM eine Erinnerung mit fertigem
          Mail-Entwurf. <b>Gesendet wird erst nach deiner Freigabe</b> – es geht nie
          automatisch etwas an Kunden raus.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            Erinnerung nach … Tagen
            <input className="input mt-1 w-28 text-sm" type="number" min={1} max={90}
                   value={nachfassTage} disabled={!canManage}
                   onChange={(e) => setNachfassTage(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-slate-500">
            <input type="checkbox" className="h-4 w-4" checked={nachfassAktiv} disabled={!canManage}
                   onChange={(e) => setNachfassAktiv(e.target.checked)} />
            Nachfassen aktiv
          </label>
          {canManage && (
            <button className="btn-primary px-3 py-2 text-sm" disabled={saving} onClick={() => void speichereNachfass()}>
              <Save size={14} /> Speichern
            </button>
          )}
        </div>
      </div>

      {/* Aktivitätsarten */}
      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Contact2 size={16} style={{ color: "var(--accent)" }} /> Aktivitätsarten (Kundenverlauf)
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Womit ein Kundenkontakt festgehalten wird. „Zählt als Kontakt“ steuert, ob der Eintrag das
          Feld „Letzter Kontakt“ beim Kunden aktualisiert (eine interne Notiz z. B. nicht).
        </p>
        <div className="mt-3 space-y-2">
          {arten.map((a, i) => (
            <div key={a.id ?? `neu-${i}`} className={`grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_130px_120px_auto] ${a.active ? "" : "opacity-50"}`}
                 style={{ borderColor: "var(--border)" }}>
              <input className="input text-sm" value={a.label} disabled={!canManage} placeholder="Bezeichnung"
                     onChange={(e) => setArten((p) => p.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))} />
              <select className="input text-sm" value={a.color ?? "slate"} disabled={!canManage}
                      onChange={(e) => setArten((p) => p.map((x, idx) => (idx === i ? { ...x, color: e.target.value } : x)))}>
                {FARBEN.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" className="h-4 w-4" checked={a.counts_as_contact} disabled={!canManage}
                       onChange={(e) => setArten((p) => p.map((x, idx) => (idx === i ? { ...x, counts_as_contact: e.target.checked } : x)))} />
                zählt als Kontakt
              </label>
              {canManage && (
                <button className="btn-ghost px-2 text-rose-500" title="Deaktivieren" onClick={() => void loeschen("crm_activity_types", a.id, i)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <div className="flex flex-wrap justify-between gap-2">
              <button className="btn-outline px-3 py-2 text-sm"
                      onClick={() => setArten((p) => [...p, { slug: "", label: "", icon: "sticky-note", color: "slate", direction_default: null, counts_as_contact: true, active: true, sort_order: (p.length ? p[p.length - 1].sort_order : 0) + 10 }])}>
                <Plus size={14} /> Art hinzufügen
              </button>
              <button className="btn-primary px-3 py-2 text-sm" disabled={saving} onClick={() => void speichereArten()}>
                <Save size={14} /> Speichern
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pipeline-Stufen */}
      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch size={16} style={{ color: "var(--accent)" }} /> Verkaufschancen-Stufen
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Die Spalten des Boards unter Anfragen → Verkaufschancen. „Gewonnen“/„Verloren“ sind
          Endstufen: sie zählen nicht mehr zum offenen Volumen.
        </p>
        <div className="mt-3 space-y-2">
          {stufen.map((s, i) => (
            <div key={s.id ?? `neu-${i}`} className={`grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_110px_90px_auto_auto] ${s.active ? "" : "opacity-50"}`}
                 style={{ borderColor: "var(--border)" }}>
              <input className="input text-sm" value={s.label} disabled={!canManage} placeholder="Stufenname"
                     onChange={(e) => setStufen((p) => p.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))} />
              <select className="input text-sm" value={s.color ?? "slate"} disabled={!canManage}
                      onChange={(e) => setStufen((p) => p.map((x, idx) => (idx === i ? { ...x, color: e.target.value } : x)))}>
                {FARBEN.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <input className="input text-sm" type="number" min={0} max={100} placeholder="%" disabled={!canManage}
                     value={s.default_probability ?? ""}
                     onChange={(e) => setStufen((p) => p.map((x, idx) => (idx === i ? { ...x, default_probability: e.target.value === "" ? null : Number(e.target.value) } : x)))} />
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <label className="flex items-center gap-1">
                  <input type="checkbox" className="h-4 w-4" checked={s.is_won} disabled={!canManage}
                         onChange={(e) => setStufen((p) => p.map((x, idx) => (idx === i ? { ...x, is_won: e.target.checked, is_lost: e.target.checked ? false : x.is_lost } : x)))} />
                  gewonnen
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" className="h-4 w-4" checked={s.is_lost} disabled={!canManage}
                         onChange={(e) => setStufen((p) => p.map((x, idx) => (idx === i ? { ...x, is_lost: e.target.checked, is_won: e.target.checked ? false : x.is_won } : x)))} />
                  verloren
                </label>
              </div>
              {canManage && (
                <button className="btn-ghost px-2 text-rose-500" title="Deaktivieren" onClick={() => void loeschen("crm_pipeline_stages", s.id, i)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <div className="flex flex-wrap justify-between gap-2">
              <button className="btn-outline px-3 py-2 text-sm"
                      onClick={() => setStufen((p) => [...p, { slug: "", label: "", color: "slate", sort_order: (p.length ? p[p.length - 1].sort_order : 0) + 10, is_won: false, is_lost: false, default_probability: null, active: true }])}>
                <Plus size={14} /> Stufe hinzufügen
              </button>
              <button className="btn-primary px-3 py-2 text-sm" disabled={saving} onClick={() => void speichereStufen()}>
                <Save size={14} /> Speichern
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
