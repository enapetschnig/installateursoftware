// ============================================================
// B4Y SuperAPP – Einstellungen: Kalkulation (Voice-Angebote)
// ------------------------------------------------------------
// Pflegt die vier Kalkulations-Parameter der Sprach-Angebote-
// Pipeline (Migr. 0125, Spalten an company_settings):
//
//   * kalk_aufschlag_gesamt    – Gesamt-Aufschlag % (Default 20)
//   * kalk_aufschlag_material  – Material-Aufschlag % (Default 30)
//   * kalk_stundensatz_default – Fallback-Stundensatz € (Default 70)
//   * kalk_material_cap        – Material-Anteils-Obergrenze % (Default 30)
//
// Die Pipeline (runCalcPipeline via VoiceAngebotDialog) bekommt die
// Werte ueber loadStammdatenForVoice → kalkSettingsFromCompanyRow.
// Wer hier speichert, veraendert also die naechste Sprach-Kalkulation.
//
// Die spezifischen Stundensaetze PRO GEWERK werden weiterhin unter
// Stammdaten → Stundensaetze gepflegt (hourly_rates-Tabelle) — dieser
// Reiter deckt nur die globalen Fallbacks/Aufschlaege ab.
// ============================================================

import { useEffect, useState } from "react";
import { Calculator, Info, Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { toast, toastError } from "../../lib/toast";
import { DEFAULT_KALK_SETTINGS } from "../../lib/calc/types";

interface KalkForm {
  aufschlagGesamt: string;
  aufschlagMaterial: string;
  stundensatzDefault: string;
  materialCap: string;
}

const EMPTY_FORM: KalkForm = {
  aufschlagGesamt: String(DEFAULT_KALK_SETTINGS.aufschlagGesamt),
  aufschlagMaterial: String(DEFAULT_KALK_SETTINGS.aufschlagMaterial),
  stundensatzDefault: String(DEFAULT_KALK_SETTINGS.stundensatzDefault),
  materialCap: String(DEFAULT_KALK_SETTINGS.materialCapPercent),
};

/** Parst ein Prozent-/Betrags-Feld: Komma erlaubt, muss >= 0 sein. */
function parseNum(v: string): number | null {
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export default function KalkulationSettings({ canManage }: { canManage: boolean }) {
  const [form, setForm] = useState<KalkForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("company_settings")
        .select(
          "kalk_aufschlag_gesamt, kalk_aufschlag_material, kalk_stundensatz_default, kalk_material_cap",
        )
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      if (data) {
        setForm({
          aufschlagGesamt: String(data.kalk_aufschlag_gesamt ?? DEFAULT_KALK_SETTINGS.aufschlagGesamt),
          aufschlagMaterial: String(data.kalk_aufschlag_material ?? DEFAULT_KALK_SETTINGS.aufschlagMaterial),
          stundensatzDefault: String(data.kalk_stundensatz_default ?? DEFAULT_KALK_SETTINGS.stundensatzDefault),
          materialCap: String(data.kalk_material_cap ?? DEFAULT_KALK_SETTINGS.materialCapPercent),
        });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const setF = (k: keyof KalkForm, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  async function save() {
    const gesamt = parseNum(form.aufschlagGesamt);
    const material = parseNum(form.aufschlagMaterial);
    const satz = parseNum(form.stundensatzDefault);
    const cap = parseNum(form.materialCap);
    if (gesamt === null || gesamt > 500) { toastError("Gesamt-Aufschlag: 0–500 % erlaubt."); return; }
    if (material === null || material > 500) { toastError("Material-Aufschlag: 0–500 % erlaubt."); return; }
    if (satz === null || satz > 1000) { toastError("Stundensatz: 0–1000 € erlaubt."); return; }
    if (cap === null || cap > 100) { toastError("Material-Obergrenze: 0–100 % erlaubt."); return; }

    setSaving(true);
    const { error } = await supabase
      .from("company_settings")
      .update({
        kalk_aufschlag_gesamt: gesamt,
        kalk_aufschlag_material: material,
        kalk_stundensatz_default: satz,
        kalk_material_cap: cap,
      })
      .gte("id", 0); // RLS begrenzt auf die eigene Org-Row; Filter nur pro forma noetig
    setSaving(false);
    if (error) {
      toastError("Speichern fehlgeschlagen: " + error.message);
      return;
    }
    setDirty(false);
    toast("Kalkulations-Einstellungen gespeichert");
  }

  if (loading) {
    return (
      <div className="glass p-6 text-sm" style={{ color: "var(--text2)" }}>
        Kalkulations-Einstellungen werden geladen …
      </div>
    );
  }

  const fields: Array<{
    key: keyof KalkForm;
    label: string;
    suffix: string;
    hint: string;
  }> = [
    {
      key: "aufschlagGesamt",
      label: "Gesamt-Aufschlag",
      suffix: "%",
      hint: "Wird auf jede neu kalkulierte Position aufgeschlagen (Gewinn/Risiko/Gemeinkosten).",
    },
    {
      key: "aufschlagMaterial",
      label: "Material-Aufschlag",
      suffix: "%",
      hint: "Aufschlag auf den Material-Einkaufspreis bei neu kalkulierten Positionen.",
    },
    {
      key: "stundensatzDefault",
      label: "Fallback-Stundensatz",
      suffix: "€/h",
      hint: "Greift nur, wenn für das Gewerk kein eigener Stundensatz gepflegt ist (Stammdaten → Stundensätze).",
    },
    {
      key: "materialCap",
      label: "Material-Obergrenze",
      suffix: "%",
      hint: "Deckelt den Material-Anteil einer Position (Rest wird als Arbeitszeit gerechnet).",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="glass p-5">
        <div className="mb-4 flex items-center gap-2">
          <Calculator size={18} style={{ color: "var(--accent)" }} />
          <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>
            Kalkulation (Sprach-Angebote)
          </h2>
        </div>

        <p className="mb-5 text-sm" style={{ color: "var(--text2)" }}>
          Diese Werte steuern, wie die KI-Pipeline neue Positionen aus deinen
          Sprachnotizen kalkuliert. Positionen aus der Preisliste behalten ihren
          Katalog-Preis — die Aufschläge greifen nur bei frei kalkulierten Leistungen.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={`kalk-${f.key}`}>
                {f.label}
              </label>
              <div className="relative">
                <input
                  id={`kalk-${f.key}`}
                  className="input pr-12"
                  inputMode="decimal"
                  value={form[f.key]}
                  onChange={(e) => setF(f.key, e.target.value)}
                  disabled={!canManage || saving}
                />
                <span
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: "var(--text2)" }}
                >
                  {f.suffix}
                </span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--text2)" }}>
                {f.hint}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div
            className="flex items-start gap-2 text-xs"
            style={{ color: "var(--text2)" }}
          >
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              Die Gewerk-Stundensätze pflegst du unter Stammdaten → Stundensätze;
              die Preisliste unter Stammdaten → Leistungen.
            </span>
          </div>
          {canManage && (
            <button
              type="button"
              className="btn-primary shrink-0"
              onClick={save}
              disabled={saving || !dirty}
            >
              <Save size={16} /> {saving ? "Speichert …" : "Speichern"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
