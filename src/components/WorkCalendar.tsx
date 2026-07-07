// ============================================================
// B4Y SuperAPP – Einstellungen: „Kalender & Arbeitszeiten"
// Flexibles, mandantenfähiges Arbeitszeitkalender-System.
// BUAK ist nur EINES von mehreren Modellen (nicht hart verdrahtet).
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock, CalendarPlus, Save, RotateCcw, Trash2, Info, Sparkles,
  Search, Globe, ExternalLink, Check, Plus, Copy,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Empty, Badge } from "./ui";
import { ConfirmDialog, ErrorBanner, Toggle } from "./calc-ui";
import {
  BuakWeek, BUAK_COLUMNS, WEEK_TYPES, BuakWeekType, generateYearWeeks,
} from "../lib/buak";
import {
  WorkTimeModel, WORK_TIME_MODELS, WorkCalendarSettings, WorkDayRule,
  defaultSettings, defaultDayRules, loadWorkSettings, saveWorkSettings,
  loadDayRules, saveDayRules, targetForWeekType, weeklyHoursFromDayRules, WEEKDAY_LABELS, workModelLabel,
} from "../lib/work-calendar";

const TONE: Record<string, "amber" | "blue" | "slate" | "green"> =
  { kurz: "amber", lang: "blue", neutral: "slate", frei: "green" };
const dmy = (s: string | null) => (s ? s.split("-").reverse().join(".") : "–");
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export default function WorkCalendar({ canManage = true }: { canManage?: boolean }) {
  const nowYear = new Date().getFullYear();
  const [years, setYears] = useState<number[]>([]);
  const [extraYears, setExtraYears] = useState<number[]>([]);
  const [year, setYear] = useState(nowYear);
  const [settings, setSettings] = useState<WorkCalendarSettings>(defaultSettings(nowYear));
  const [rows, setRows] = useState<BuakWeek[]>([]);
  const [dayRules, setDayRules] = useState<WorkDayRule[]>(defaultDayRules(nowYear));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delYear, setDelYear] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Tatsächlich gespeichertes (aktives) Modell – getrennt von der aktuellen Bearbeitung,
  // damit „aktiv/verwendet" eindeutig aus der echten Einstellung kommt.
  const [savedModel, setSavedModel] = useState<WorkTimeModel>("buak_auto");
  const [pendingModel, setPendingModel] = useState<WorkTimeModel | null>(null);

  // BUAK-Import-Status (nur Modell buak_auto)
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [parseUrl, setParseUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<any>(null);

  const model = settings.work_time_model;
  const setModel = (m: WorkTimeModel) => { setSettings((s) => ({ ...s, work_time_model: m })); setSaved(false); };
  const setS = (patch: Partial<WorkCalendarSettings>) => { setSettings((s) => ({ ...s, ...patch })); setSaved(false); };

  const yearOptions = useMemo(
    () => Array.from(new Set([...years, nowYear, nowYear + 1, ...extraYears])).sort((a, b) => b - a),
    [years, nowYear, extraYears],
  );

  async function loadYears() {
    const { data } = await supabase.from("buak_calendar").select("year");
    setYears(Array.from(new Set((data ?? []).map((r: any) => r.year as number))).sort((a, b) => b - a));
  }
  async function load(y: number) {
    setLoading(true); setErr(null); setSaved(false);
    const [s, w, d] = await Promise.all([
      loadWorkSettings(y).catch(() => null),
      supabase.from("buak_calendar").select(BUAK_COLUMNS).eq("year", y).order("week"),
      loadDayRules(y).catch(() => [] as WorkDayRule[]),
    ]);
    const eff = s ?? defaultSettings(y);
    setSettings(eff);
    setSavedModel(eff.work_time_model);  // echtes aktives Modell merken
    setRows((w.data as BuakWeek[]) ?? []);
    setDayRules(d.length ? d : defaultDayRules(y));
    setLoading(false);
  }
  useEffect(() => { loadYears(); }, []);
  useEffect(() => { load(year); /* eslint-disable-line */ }, [year]);

  const addNextYear = () => { const n = Math.max(...yearOptions) + 1; setExtraYears((a) => (a.includes(n) ? a : [...a, n])); setYear(n); };

  // ---- Wochen-Helfer ----
  function ensureRows(): BuakWeek[] {
    if (rows.length) return rows;
    const gen = generateYearWeeks(year).map((w) => ({
      id: "", year, week: w.week, date_from: w.date_from, date_to: w.date_to,
      week_type: "neutral" as BuakWeekType, soll_bau: null, soll_maler: null,
      note: null, source: "generated", target_hours: null, updated_at: null,
    }));
    setRows(gen);
    return gen;
  }
  const editRow = (week: number, patch: Partial<BuakWeek>) => {
    if (!canManage) return;
    setRows((rs) => rs.map((r) => (r.week === week ? { ...r, ...patch } : r))); setSaved(false);
  };
  function setAllWeeks(type: BuakWeekType) {
    if (!canManage) return;
    const base = ensureRows();
    setRows(base.map((r) => ({ ...r, week_type: type }))); setSaved(false);
  }
  const editDay = (weekday: number, patch: Partial<WorkDayRule>) => {
    if (!canManage) return;
    setDayRules((ds) => ds.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d))); setSaved(false);
  };

  // ---- Speichern: Modell-Logik in Wochen-Sollstunden übersetzen ----
  async function saveAll() {
    if (!canManage) return;
    setBusy(true); setErr(null);
    const r1 = await saveWorkSettings(settings);
    if (r1.error) { setErr(r1.error); setBusy(false); return; }
    if (model === "individual_week") {
      const r2 = await saveDayRules(year, dayRules);
      if (r2.error) { setErr(r2.error); setBusy(false); return; }
    }
    // Wochen je Modell berechnen (außer reines Tagesmodell ohne Wochenraster)
    let weekRows = rows;
    if (model !== "buak_auto" || rows.length) {
      weekRows = ensureRows();
    }
    if (weekRows.length) {
      const weeklyFromDays = weeklyHoursFromDayRules(dayRules);
      const payload = weekRows.map((r) => {
        let week_type = r.week_type;
        let target = r.target_hours ?? null;
        if (model === "only_short") { week_type = "kurz"; target = settings.short_week_hours; }
        else if (model === "only_long") { week_type = "lang"; target = settings.long_week_hours; }
        else if (model === "fixed_weekly") { target = settings.fixed_weekly_hours; }
        else if (model === "individual_week") { target = weeklyFromDays; }
        else if (model === "short_long_manual" || model === "buak_auto") { target = targetForWeekType(settings, week_type); }
        // manual_year: week_type + target_hours bleiben wie eingegeben
        return {
          id: r.id || undefined, year, week: r.week, date_from: r.date_from, date_to: r.date_to,
          week_type, target_hours: target, note: r.note, source: r.source || "manual",
        };
      });
      const { error } = await supabase.from("buak_calendar").upsert(payload, { onConflict: "year,week" });
      if (error) { setErr(error.message); setBusy(false); return; }
    }
    setBusy(false); setSaved(true);
    await loadYears(); await load(year);
  }

  async function deleteWholeYear() {
    setBusy(true); setErr(null);
    await supabase.from("buak_calendar").delete().eq("year", year);
    await supabase.from("company_work_calendar_settings").delete().eq("year", year);
    await supabase.from("company_work_day_rules").delete().eq("year", year);
    setBusy(false); setDelYear(false);
    await loadYears(); await load(year);
  }

  async function copyFromPrevious() {
    setBusy(true); setErr(null);
    const prev = year - 1;
    const [s, w, d] = await Promise.all([
      loadWorkSettings(prev), supabase.from("buak_calendar").select(BUAK_COLUMNS).eq("year", prev).order("week"), loadDayRules(prev),
    ]);
    if (s) setSettings({ ...s, year });
    const gen = generateYearWeeks(year);
    const prevRows = (w.data as BuakWeek[]) ?? [];
    setRows(gen.map((g) => {
      const p = prevRows.find((x) => x.week === g.week);
      return { id: "", year, week: g.week, date_from: g.date_from, date_to: g.date_to,
        week_type: (p?.week_type ?? "neutral") as BuakWeekType, soll_bau: null, soll_maler: null,
        note: p?.note ?? null, source: "copied_from_previous_year", target_hours: p?.target_hours ?? null, updated_at: null };
    }));
    if (d.length) setDayRules(d.map((x) => ({ ...x, year })));
    setBusy(false); setSaved(false); setMsg(`Aus ${prev} kopiert – zum Übernehmen „Speichern" klicken.`);
  }

  // ---- BUAK-Import (nur buak_auto) ----
  async function doSearch() {
    setSearching(true); setErr(null); setResults([]); setMsg(null);
    const { data, error } = await supabase.functions.invoke("buak-calendar", { body: { action: "search", year } });
    setSearching(false);
    if (error) { setErr("Suche fehlgeschlagen: " + error.message); return; }
    if ((data as any)?.error) { setErr((data as any).message); return; }
    const res = (data as any)?.results ?? [];
    setResults(res);
    if (!res.length) setMsg("Kein eindeutiger BUAK-Kalender gefunden. Du kannst einen PDF-Link auslesen oder die Wochen manuell pflegen.");
  }
  async function doParse(url: string, domain?: string) {
    if (!url) return;
    setParsing(true); setErr(null); setMsg(null);
    const { data, error } = await supabase.functions.invoke("buak-calendar", { body: { action: "parse", year, url } });
    setParsing(false);
    if (error) { setErr("Auslesen fehlgeschlagen: " + error.message); return; }
    if ((data as any)?.error) { setErr((data as any).message); return; }
    const d = data as any;
    let dom = domain; if (!dom) { try { dom = new URL(url).hostname.replace(/^www\./, ""); } catch { /* */ } }
    setPreview((d.rows ?? []).map((r: any) => ({ ...r, source_domain: dom ?? null })));
    setPreviewMeta({ status: d.status, total: d.total, aiUsed: d.aiUsed, message: d.message });
  }
  const editPreview = (week: number, week_type: BuakWeekType) =>
    setPreview((p) => (p ? p.map((r) => (r.week === week ? { ...r, week_type, confidence: 1 } : r)) : p));
  async function applyPreview() {
    if (!preview) return;
    setBusy(true); setErr(null);
    const payload = preview.map((r: any) => ({
      year, week: r.week, date_from: r.date_from, date_to: r.date_to, week_type: r.week_type,
      confidence: r.confidence, target_hours: targetForWeekType(settings, r.week_type),
      source: r.source_domain, source_domain: r.source_domain,
    }));
    const { error } = await supabase.from("buak_calendar").upsert(payload, { onConflict: "year,week" });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPreview(null); setPreviewMeta(null); setResults([]); setMsg(`Kalender ${year} übernommen.`);
    await loadYears(); await load(year);
  }

  const counts = useMemo(() => {
    const c = { kurz: 0, lang: 0, neutral: 0, frei: 0 } as Record<string, number>;
    rows.forEach((r) => { c[r.week_type] = (c[r.week_type] ?? 0) + 1; });
    return c;
  }, [rows]);

  const showWeekTable = ["buak_auto", "short_long_manual", "only_short", "only_long", "manual_year"].includes(model);
  const weeklyFromDays = weeklyHoursFromDayRules(dayRules);

  return (
    <div className="glass p-4">
      {/* Kopf */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarClock size={18} /> Jahreskalender & Standard-Arbeitszeit</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Firmenweiter Jahreskalender (Wochenarten kurz/lang/frei, BUAK als Quelle) und das <b>Standard-Arbeitszeitmodell</b> als Fallback.
            Individuelle Modelle pro Mitarbeiter werden unten als <b>Arbeitszeitmodelle</b> gepflegt und beim Mitarbeiter zugewiesen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}{years.includes(y) ? "" : " (leer)"}</option>)}
          </select>
          {canManage && <button className="btn-ghost px-2" title="Nächstes Jahr" onClick={addNextYear}><Plus size={16} /> Jahr</button>}
        </div>
      </div>

      <ErrorBanner message={err} />

      {/* Arbeitszeitmodell-Auswahl als Karten – aktives Modell klar erkennbar */}
      <div className="mb-4">
        <label className="label">Standard-Arbeitszeitmodell (Fallback für Mitarbeiter ohne eigenes Modell)</label>
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {WORK_TIME_MODELS.map((m) => {
            const isActive = m.key === savedModel;      // echtes, gespeichertes Modell
            const isSelected = m.key === model;          // aktuell in Bearbeitung gewählt
            const pendingSave = isSelected && !isActive; // gewählt, aber noch nicht gespeichert
            return (
              <button key={m.key} type="button" disabled={!canManage}
                onClick={() => { if (!canManage || isSelected) return; setPendingModel(m.key); }}
                className={`rounded-xl border p-3 text-left transition ${isSelected ? "border-transparent ring-2" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
                style={isSelected
                  ? { borderColor: "transparent", boxShadow: "0 0 0 2px var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" }
                  : { borderColor: "var(--border)" }}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold leading-snug">{m.label}</span>
                  {isActive
                    ? <Badge tone="green">Aktiv</Badge>
                    : pendingSave ? <Badge tone="amber">Ausgewählt</Badge> : <Badge tone="slate">Inaktiv</Badge>}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{m.desc}</div>
                <div className="mt-1 text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">{modelFacts(m.key, settings, weeklyFromDays)}</div>
                {isActive && <div className="mt-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Standardmodell – greift bei Mitarbeitern ohne eigenes Arbeitszeitmodell.</div>}
                {pendingSave && <div className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">Zum Aktivieren „Speichern" klicken.</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Aktionen */}
      {canManage && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={busy} onClick={saveAll}><Save size={16} /> Speichern</button>
          <button className="btn-ghost" disabled={busy} onClick={() => load(year)}><RotateCcw size={15} /> Zurücksetzen</button>
          <button className="btn-ghost" disabled={busy} onClick={copyFromPrevious}><Copy size={15} /> Jahr {year - 1} kopieren</button>
          <button className="btn-ghost text-rose-500" disabled={busy} onClick={() => setDelYear(true)}><Trash2 size={15} /> Jahr löschen</button>
          {saved && <span className="text-sm font-medium text-emerald-600">Gespeichert ✓</span>}
        </div>
      )}

      {msg && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-400/40 bg-blue-400/10 p-3 text-sm text-blue-700 dark:text-blue-300">
          <Sparkles size={16} className="mt-0.5 shrink-0" /> {msg}
        </div>
      )}

      {/* Modell-spezifische Parameter */}
      {(model === "short_long_manual" || model === "buak_auto" || model === "only_short") && (
        <Field3 label="Sollstunden kurze Woche" value={settings.short_week_hours} onChange={(v) => setS({ short_week_hours: v })} disabled={!canManage} />
      )}
      {(model === "short_long_manual" || model === "buak_auto" || model === "only_long") && (
        <Field3 label="Sollstunden lange Woche" value={settings.long_week_hours} onChange={(v) => setS({ long_week_hours: v })} disabled={!canManage} />
      )}
      {model === "fixed_weekly" && (
        <Field3 label="Fixe Wochenstunden (z. B. 38,5)" value={settings.fixed_weekly_hours} onChange={(v) => setS({ fixed_weekly_hours: v })} disabled={!canManage} />
      )}

      {/* „alle Wochen" Buttons */}
      {canManage && (model === "only_short" || model === "only_long") && (
        <button className="btn-outline mb-4" onClick={() => setAllWeeks(model === "only_short" ? "kurz" : "lang")}>
          <CalendarPlus size={15} /> Alle Wochen {year} auf {model === "only_short" ? "kurze" : "lange"} Woche setzen
        </button>
      )}

      {/* BUAK-Import nur bei buak_auto */}
      {model === "buak_auto" && canManage && (
        <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
          <div className="mb-1 flex items-center gap-2 text-sm font-bold"><Globe size={16} /> Automatisch aus BUAK-Kalender</div>
          <p className="mb-2 text-xs text-slate-400">
            Bauarbeiter-Urlaubs- und Abfertigungskasse: legt je Kalenderwoche kurze/lange Woche fest. Es wird nichts ungeprüft gespeichert – du bestätigst in der Vorschau.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" disabled={searching} onClick={doSearch}><Search size={15} /> {searching ? "Suche läuft …" : `Kalender ${year} automatisch suchen`}</button>
            <span className="text-xs text-slate-400">oder PDF-Link:</span>
            <input className="input max-w-[16rem] flex-1" placeholder="https://…/buak…pdf" value={parseUrl} onChange={(e) => setParseUrl(e.target.value)} />
            <button className="btn-outline" disabled={parsing || !parseUrl} onClick={() => doParse(parseUrl)}>{parsing ? "Liest …" : "Auslesen"}</button>
          </div>
          {results.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                  <tr><th className="px-3 py-2">Titel</th><th className="px-3 py-2">Quelle</th><th className="px-3 py-2">Typ</th><th className="px-3 py-2 text-right">Aktion</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {results.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-white/5">
                      <td className="px-3 py-2"><span className="line-clamp-1 max-w-xs">{r.title}</span></td>
                      <td className="px-3 py-2 text-slate-500">{r.domain}</td>
                      <td className="px-3 py-2"><Badge tone={r.fileType === "PDF" ? "green" : "slate"}>{r.fileType}</Badge></td>
                      <td className="px-3 py-2"><div className="flex justify-end gap-1">
                        <a className="btn-ghost px-2" href={r.link} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>
                        <button className="btn-outline px-2 py-1 text-xs" disabled={parsing} onClick={() => doParse(r.link, r.domain)}>Auslesen</button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* BUAK Import-Vorschau */}
      {preview && (
        <div className="mb-4 rounded-xl border-2 p-4" style={{ borderColor: "var(--accent)" }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold">Import-Vorschau {year} {previewMeta?.aiUsed && <Badge tone="blue">KI</Badge>}</div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => { setPreview(null); setPreviewMeta(null); }}>Verwerfen</button>
              <button className="btn-primary" disabled={busy} onClick={applyPreview}><Check size={15} /> Übernehmen</button>
            </div>
          </div>
          <div className="max-h-[22rem] overflow-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-white/5">
                <tr><th className="px-3 py-2">KW</th><th className="px-3 py-2">Zeitraum</th><th className="px-3 py-2">Erkannt</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {preview.map((r) => {
                  const unsure = r.week_type === "unbekannt" || (r.confidence ?? 0) < 0.9;
                  return (
                    <tr key={r.week} className={unsure ? "bg-amber-50 dark:bg-amber-500/10" : ""}>
                      <td className="px-3 py-1.5 font-semibold tabular-nums text-slate-500">{r.week}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-xs text-slate-500">{dmy(r.date_from)} – {dmy(r.date_to)}</td>
                      <td className="px-3 py-1.5">
                        <select className="input w-auto py-1 text-xs" value={r.week_type} onChange={(e) => editPreview(r.week, e.target.value as BuakWeekType)}>
                          {WEEK_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                          <option value="unbekannt">Unbekannt</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Individuelles Wochenmodell: Tagesregeln */}
      {model === "individual_week" && (
        <div className="mb-4 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr><th className="px-3 py-2">Tag</th><th className="px-3 py-2">Arbeitstag</th><th className="px-3 py-2">Sollstunden</th><th className="px-3 py-2">Beginn</th><th className="px-3 py-2">Ende</th><th className="px-3 py-2">Pause (Min)</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {dayRules.map((d) => (
                <tr key={d.weekday} className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className="px-3 py-2 font-medium">{WEEKDAY_LABELS[d.weekday - 1]}</td>
                  <td className="px-3 py-2"><Toggle checked={d.is_working_day} onChange={(v) => editDay(d.weekday, { is_working_day: v })} /></td>
                  <td className="px-3 py-2"><input className="input w-20 py-1" type="number" step="0.25" value={d.target_hours ?? ""} disabled={!canManage || !d.is_working_day} onChange={(e) => editDay(d.weekday, { target_hours: num(e.target.value) })} /></td>
                  <td className="px-3 py-2"><input className="input w-24 py-1" type="time" value={d.start_time ?? ""} disabled={!canManage || !d.is_working_day} onChange={(e) => editDay(d.weekday, { start_time: e.target.value })} /></td>
                  <td className="px-3 py-2"><input className="input w-24 py-1" type="time" value={d.end_time ?? ""} disabled={!canManage || !d.is_working_day} onChange={(e) => editDay(d.weekday, { end_time: e.target.value })} /></td>
                  <td className="px-3 py-2"><input className="input w-20 py-1" type="number" value={d.break_minutes ?? ""} disabled={!canManage || !d.is_working_day} onChange={(e) => editDay(d.weekday, { break_minutes: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 text-sm"><b>Wochenstunden gesamt: {weeklyFromDays.toLocaleString("de-AT")} h</b></div>
        </div>
      )}

      {model === "fixed_weekly" && (
        <p className="mb-4 text-sm text-slate-500">Sollstunden je Woche: <b>{(Number(settings.fixed_weekly_hours) || 0).toLocaleString("de-AT")} h</b> (für alle Kalenderwochen).</p>
      )}

      {/* Wochen-Tabelle */}
      {showWeekTable && (
        loading ? <Spinner /> : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <Badge tone="amber">{counts.kurz} kurze Wochen</Badge>
              <Badge tone="blue">{counts.lang} lange Wochen</Badge>
              <Badge tone="slate">{counts.neutral} neutral</Badge>
              <Badge tone="green">{counts.frei} frei</Badge>
            </div>
            {rows.length === 0 ? (
              <div className="mb-3">
                <Empty title={`Kein Kalender für ${year}`} hint="Wochen anlegen, um Wochenart/Sollstunden zu pflegen." />
                {canManage && <button className="btn-primary mt-2" onClick={() => ensureRows()}><CalendarPlus size={16} /> Wochen {year} anlegen</button>}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                    <tr>
                      <th className="px-3 py-2.5 w-14">KW</th>
                      <th className="px-3 py-2.5">Zeitraum</th>
                      <th className="px-3 py-2.5">Wochenart</th>
                      <th className="px-3 py-2.5">Sollstunden</th>
                      {model === "manual_year" && <th className="px-3 py-2.5">Notiz</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {rows.map((r) => {
                      const typeLocked = model === "only_short" || model === "only_long";
                      const computedTarget = model === "manual_year" ? (r.target_hours ?? null) : targetForWeekType(settings, r.week_type);
                      return (
                        <tr key={r.week} className="hover:bg-slate-50 dark:hover:bg-white/5">
                          <td className="px-3 py-2 font-semibold tabular-nums text-slate-500">{r.week}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{dmy(r.date_from)} – {dmy(r.date_to)}</td>
                          <td className="px-3 py-2">
                            {canManage && !typeLocked ? (
                              <select className="input w-auto py-1 text-xs" value={r.week_type} onChange={(e) => editRow(r.week, { week_type: e.target.value as BuakWeekType })}>
                                {WEEK_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                              </select>
                            ) : <Badge tone={TONE[r.week_type]}>{WEEK_TYPES.find((w) => w.value === r.week_type)?.label}</Badge>}
                          </td>
                          <td className="px-3 py-2">
                            {model === "manual_year" && canManage ? (
                              <input className="input w-24 py-1" type="number" step="0.25" value={r.target_hours ?? ""} onChange={(e) => editRow(r.week, { target_hours: num(e.target.value) })} />
                            ) : <span className="tabular-nums text-slate-500">{computedTarget != null ? `${Number(computedTarget).toLocaleString("de-AT")} h` : "–"}</span>}
                          </td>
                          {model === "manual_year" && (
                            <td className="px-3 py-2"><input className="input py-1 text-xs" value={r.note ?? ""} placeholder="Notiz / Sonderwoche" disabled={!canManage} onChange={(e) => editRow(r.week, { note: e.target.value })} /></td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        Änderungen mit „Speichern" übernehmen. Die Sollstunden je Woche fließen in Zeiterfassung, Stundenausgleich und Auswertungen ein. BUAK ist nur eine mögliche Kalenderquelle.
      </p>

      <ConfirmDialog open={delYear} title={`Kalender & Einstellungen ${year} löschen?`}
        message={<>Alle Kalenderwochen, Tagesregeln und Einstellungen für <b>{year}</b> werden gelöscht.</>}
        busy={busy} confirmLabel="Jahr löschen" onConfirm={deleteWholeYear} onClose={() => setDelYear(false)} />

      <ConfirmDialog open={!!pendingModel} title="Standard-Arbeitszeitmodell wechseln?"
        message={<>Als <b>Standard/Fallback</b> das Modell <b>{workModelLabel(pendingModel || "")}</b> wählen? Das gilt nur für Mitarbeiter <b>ohne</b> eigenes Arbeitszeitmodell – individuell zugewiesene Modelle bleiben unberührt. Kalenderwochen und Tagesregeln bleiben erhalten.</>}
        confirmLabel="Als Standard wählen" busy={busy}
        onConfirm={() => { if (pendingModel) setModel(pendingModel); setPendingModel(null); }}
        onClose={() => setPendingModel(null)} />
    </div>
  );
}

// Realistische Kurz-Eckdaten je Modell für die Karten-Übersicht (read-only).
function modelFacts(key: WorkTimeModel, s: WorkCalendarSettings, weeklyFromDays: number): string {
  const nf = (n: number) => Number(n).toLocaleString("de-AT");
  const sh = Number(s.short_week_hours) || 36;
  const lo = Number(s.long_week_hours) || 40;
  const fx = Number(s.fixed_weekly_hours) || 38.5;
  switch (key) {
    case "buak_auto": return `Kurz/lang automatisch · ${nf(sh)} / ${nf(lo)} h`;
    case "short_long_manual": return `Kurz ${nf(sh)} h · lang ${nf(lo)} h · manuell je KW`;
    case "only_short": return `Mo–Do · ${nf(sh)} h/Woche`;
    case "only_long": return `Mo–Fr · ${nf(lo)} h/Woche`;
    case "fixed_weekly": return `${nf(fx)} h/Woche (alle Wochen gleich)`;
    case "individual_week": return `Sollstunden je Wochentag · ${nf(weeklyFromDays)} h`;
    case "manual_year": return "Jede Kalenderwoche einzeln gepflegt";
    default: return "";
  }
}

function Field3({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <div className="mb-4 max-w-xs">
      <label className="label">{label}</label>
      <input className="input" type="number" step="0.25" value={value ?? ""} disabled={disabled}
        onChange={(e) => onChange(e.target.value.trim() === "" ? null : Number(e.target.value.replace(",", ".")))} />
    </div>
  );
}
