// ============================================================
// Installateur SuperAPP – Einstellungen: Fachwissen-Regeln (Migr. 0155)
// ------------------------------------------------------------
// Der Betrieb hinterlegt hier sein Fachwissen für das Sprach-Angebot:
//   Wenn <Stichwort> im Diktat vorkommt → <dann: was fachlich dazugehört>
//   + optionale Rückfrage, wenn eine preisrelevante Angabe fehlt.
// Beispiel: "unterverteil|verteiler" → "FI + LS je Stromkreis + Messprotokoll"
//   Rückfrage: "Wie viele Stromkreise? Überspannungsschutz gewünscht?"
// Die Regeln fließen als {{FACHREGELN}}-Block in den KI-Prompt; Rückfragen
// zeigt der Voice-Dialog VOR der Übernahme (Antwort → Neu-Kalkulation).
// Gespeichert als JSONB in company_settings.kalk_fachregeln (mandantenfähig).
// ============================================================

import { useEffect, useState } from "react";
import { BrainCircuit, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { toast, toastError } from "../../lib/toast";
import { parseFachregeln, type Fachregel } from "../../lib/voice/loadStammdatenForVoice";

export default function FachregelnSettings({ canManage }: { canManage: boolean }) {
  const [regeln, setRegeln] = useState<Fachregel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("company_settings").select("id, kalk_fachregeln").limit(1).maybeSingle();
      if (!alive) return;
      if (error) toastError(`Fachregeln konnten nicht geladen werden: ${error.message}`);
      setRegeln(parseFachregeln((data as { kalk_fachregeln?: unknown } | null)?.kalk_fachregeln));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const patch = (i: number, p: Partial<Fachregel>) => {
    setRegeln((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
    setDirty(true);
  };
  const remove = (i: number) => { setRegeln((prev) => prev.filter((_, idx) => idx !== i)); setDirty(true); };
  const add = () => { setRegeln((prev) => [...prev, { stichwort: "", dann: "", frage: null }]); setDirty(true); };

  async function save() {
    // Nur vollständige Regeln speichern (Stichwort + "dann" sind Pflicht).
    const clean = regeln
      .map((r) => ({ stichwort: r.stichwort.trim(), dann: r.dann.trim(), frage: (r.frage ?? "").trim() || null }))
      .filter((r) => r.stichwort && r.dann);
    for (const r of clean) {
      try { new RegExp(r.stichwort, "i"); } catch {
        toastError(`Ungültiges Stichwort-Muster: „${r.stichwort}“`); return;
      }
    }
    setSaving(true);
    const { data } = await supabase.from("company_settings").select("id").limit(1).maybeSingle();
    const { error } = await supabase
      .from("company_settings")
      .update({ kalk_fachregeln: clean })
      .eq("id", (data as { id: number } | null)?.id ?? 1);
    setSaving(false);
    if (error) { toastError(`Speichern fehlgeschlagen: ${error.message}`); return; }
    setRegeln(clean);
    setDirty(false);
    toast("Fachregeln gespeichert – gelten ab dem nächsten Sprach-Angebot.");
  }

  return (
    <div className="card mt-4 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BrainCircuit size={16} style={{ color: "var(--accent)" }} /> Fachwissen der KI (Sprach-Angebot)
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Hinterlege, was zu einer Leistung fachlich dazugehört und was die KI nachfragen soll, bevor sie
        kalkuliert. Stichwort = Suchmuster im Diktat (mehrere Begriffe mit „|" trennen, z. B.
        „unterverteil|verteiler").
      </p>

      {loading ? (
        <div className="py-6 text-center text-sm text-slate-400">Lädt …</div>
      ) : (
        <div className="mt-3 space-y-3">
          {regeln.map((r, i) => (
            <div key={i} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
              <div className="grid gap-2 sm:grid-cols-[220px_1fr_auto]">
                <label className="text-xs text-slate-500">
                  Wenn im Diktat vorkommt …
                  <input className="input mt-1 text-sm" value={r.stichwort} disabled={!canManage}
                    placeholder="unterverteil|verteiler"
                    onChange={(e) => patch(i, { stichwort: e.target.value })} />
                </label>
                <label className="text-xs text-slate-500">
                  … gehört fachlich dazu (Mitdenken)
                  <textarea className="input mt-1 min-h-[38px] text-sm" value={r.dann} disabled={!canManage}
                    placeholder="FI-Schutzschalter + LS-Automat je Stromkreis + Messprotokoll …"
                    onChange={(e) => patch(i, { dann: e.target.value })} />
                </label>
                {canManage && (
                  <button className="btn-ghost mt-5 h-9 self-start px-2 text-rose-500" title="Regel entfernen"
                    onClick={() => remove(i)}><Trash2 size={15} /></button>
                )}
              </div>
              <label className="mt-2 block text-xs text-slate-500">
                Rückfrage, wenn die Angabe fehlt (optional)
                <input className="input mt-1 text-sm" value={r.frage ?? ""} disabled={!canManage}
                  placeholder="Wie viele Stromkreise soll die Verteilung bekommen?"
                  onChange={(e) => patch(i, { frage: e.target.value })} />
              </label>
            </div>
          ))}
          {regeln.length === 0 && (
            <div className="rounded-xl border border-dashed p-4 text-sm text-slate-400" style={{ borderColor: "var(--border)" }}>
              Keine Fachregeln hinterlegt.
            </div>
          )}
          {canManage && (
            <div className="flex flex-wrap justify-between gap-2">
              <button className="btn-outline px-3 py-2 text-sm" onClick={add}><Plus size={14} /> Regel hinzufügen</button>
              <button className="btn-primary px-3 py-2 text-sm" disabled={!dirty || saving} onClick={() => void save()}>
                <Save size={14} /> Fachregeln speichern
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
