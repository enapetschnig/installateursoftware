// ============================================================
// B4Y SuperAPP – KI-Einstellungen (mandantenfähig)
// Provider/Modell, Feature-Freigaben, optionaler API-Key (Anbindung später),
// System-Prompt + Verbindungstest. Schreibt in ai_settings.
// ============================================================
import { useEffect, useState } from "react";
import { Sparkles, Save, Plug, Check } from "lucide-react";
import { Spinner } from "./ui";
import { ErrorBanner, Toggle } from "./calc-ui";
import { AiSettings, AI_MODULES, loadAiSettings, saveAiSettings, aiAsk } from "../lib/ai";

const MODULE_LABEL: Record<string, string> = { isabella: "Isabella-Assistent", planung: "Planung", dokumente: "Dokumente" };

export default function KiSettings({ canManage = true }: { canManage?: boolean }) {
  const [s, setS] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok?: boolean; msg: string } | null>(null);

  useEffect(() => {
    loadAiSettings().then((d) => {
      setS(d ?? { active: true, allowed_modules: [...AI_MODULES], auto_suggestions: true, language: "de", provider: "anthropic", model: "claude-sonnet-4-6", api_key: null, system_prompt: null });
    }).finally(() => setLoading(false));
  }, []);

  if (loading || !s) return <Spinner />;
  const set = (patch: Partial<AiSettings>) => { setS({ ...s, ...patch }); setSaved(false); };
  const toggleModule = (m: string) => {
    const cur = s.allowed_modules ?? [];
    set({ allowed_modules: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] });
  };

  async function save() {
    if (!s) return;
    setBusy(true); setErr(null);
    const { error } = await saveAiSettings(s);
    setBusy(false);
    if (error) setErr(error); else { setSaved(true); loadAiSettings().then((d) => d && setS(d)); }
  }

  async function runTest() {
    if (!s) return;
    setBusy(true); setTest(null); setErr(null);
    // vor dem Test speichern, damit ein neu eingegebener Key serverseitig greift
    await saveAiSettings(s);
    const r = await aiAsk("Antworte mit genau einem kurzen, freundlichen Satz auf Deutsch.", { module: "isabella", action: "verbindungstest" });
    setBusy(false);
    if (r.error) setTest({ ok: false, msg: r.error });
    else setTest({ ok: true, msg: r.text || "Verbindung erfolgreich." });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold"><Sparkles size={20} /> KI-Einstellungen</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Modell, Funktionen und Verbindung der KI-Funktionen – mandantenfähig.</p>
      </div>
      <ErrorBanner message={err} />

      <div className="glass p-4">
        <Toggle checked={s.active !== false} onChange={(v) => set({ active: v })} label="KI-Funktionen aktiv" disabled={!canManage} />
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {AI_MODULES.map((m) => (
            <label key={m} className="flex items-center gap-2 rounded-lg border p-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <input type="checkbox" disabled={!canManage} checked={(s.allowed_modules ?? []).includes(m)} onChange={() => toggleModule(m)} />
              {MODULE_LABEL[m] ?? m}
            </label>
          ))}
        </div>
        <div className="mt-3">
          <Toggle checked={!!s.auto_suggestions} onChange={(v) => set({ auto_suggestions: v })} label="Automatische KI-Vorschläge erlauben" disabled={!canManage} />
        </div>
      </div>

      <div className="glass space-y-3 p-4">
        <h3 className="font-bold">Modell & Verbindung</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-500">Anbieter
            <select className="input mt-1" value={s.provider ?? "anthropic"} onChange={(e) => set({ provider: e.target.value })} disabled={!canManage}>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">Modell
            <input className="input mt-1" value={s.model ?? ""} onChange={(e) => set({ model: e.target.value })} placeholder="claude-sonnet-4-6" disabled={!canManage} />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-500">API-Key (optional – Anbindung kann später erfolgen)
          <input className="input mt-1" type="password" value={s.api_key ?? ""} onChange={(e) => set({ api_key: e.target.value || null })}
            placeholder="sk-ant-… (leer lassen, wenn serverseitig hinterlegt)" disabled={!canManage} autoComplete="off" />
        </label>
        <p className="text-[11px] text-slate-400">Ist serverseitig bereits ein Schlüssel hinterlegt, kann dieses Feld leer bleiben. Der Schlüssel wird ausschließlich für deine KI-Aufrufe verwendet.</p>
        <label className="block text-xs font-medium text-slate-500">System-Prompt (optional, global)
          <textarea className="input mt-1" rows={3} value={s.system_prompt ?? ""} onChange={(e) => set({ system_prompt: e.target.value || null })}
            placeholder="z. B. Tonalität, Firmenkontext, Standardsprache …" disabled={!canManage} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <button className="btn-primary" disabled={busy} onClick={save}><Save size={16} /> Speichern{saved ? " ✓" : ""}</button>}
          <button className="btn-outline" disabled={busy} onClick={runTest}><Plug size={16} /> Verbindung testen</button>
          {test && (
            <span className={`text-sm ${test.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {test.ok ? <><Check size={14} className="inline" /> {test.msg}</> : test.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
