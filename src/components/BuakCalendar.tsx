import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock, CalendarPlus, Save, RotateCcw, Trash2, Info, Sparkles,
  Search, Globe, ExternalLink, Check, AlertTriangle, Plus,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Empty, Badge } from "./ui";
import { ConfirmDialog, ErrorBanner } from "./calc-ui";
import {
  BuakWeek, BUAK_COLUMNS, WEEK_TYPES, BuakWeekType, generateYearWeeks, weekTypeLabel,
} from "../lib/buak";

const TONE: Record<string, "amber" | "blue" | "slate" | "green"> =
  { kurz: "amber", lang: "blue", neutral: "slate", frei: "green" };

const dmy = (s: string | null) =>
  s ? s.split("-").reverse().join(".") : "–";

export default function BuakCalendar({ canManage = true }: { canManage?: boolean }) {
  const nowYear = new Date().getFullYear();
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(nowYear);
  const [extraYears, setExtraYears] = useState<number[]>([]);
  const [rows, setRows] = useState<BuakWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [delYear, setDelYear] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  // Auto-Suche / KI-Auslese
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [parseUrl, setParseUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<any>(null);

  const yearOptions = useMemo(
    () => Array.from(new Set([...years, nowYear, nowYear + 1, ...extraYears])).sort((a, b) => b - a),
    [years, nowYear, extraYears],
  );
  const addNextYear = () => {
    const next = Math.max(...yearOptions) + 1;
    setExtraYears((a) => (a.includes(next) ? a : [...a, next]));
    setYear(next);
  };

  async function loadYears() {
    const { data } = await supabase.from("buak_calendar").select("year");
    setYears(Array.from(new Set((data ?? []).map((r: any) => r.year as number))).sort((a, b) => b - a));
  }
  async function loadYear(y: number) {
    setLoading(true); setErr(null); setSaved(false);
    const { data, error } = await supabase.from("buak_calendar").select(BUAK_COLUMNS).eq("year", y).order("week");
    if (error) setErr(error.message);
    setRows((data as BuakWeek[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { loadYears(); }, []);
  useEffect(() => { loadYear(year); /* eslint-disable-next-line */ }, [year]);

  const editRow = (week: number, patch: Partial<BuakWeek>) => {
    if (!canManage) return;
    setRows((rs) => rs.map((r) => (r.week === week ? { ...r, ...patch } : r)));
    setSaved(false);
  };

  async function generateYear() {
    if (!canManage) return;
    setBusy(true); setErr(null);
    const existing = new Set(rows.map((r) => r.week));
    const toAdd = generateYearWeeks(year)
      .filter((w) => !existing.has(w.week))
      .map((w) => ({ year, week: w.week, date_from: w.date_from, date_to: w.date_to, week_type: "neutral" }));
    if (toAdd.length) {
      const { error } = await supabase.from("buak_calendar").insert(toAdd);
      if (error) { setErr(error.message); setBusy(false); return; }
    }
    setBusy(false);
    await loadYears(); await loadYear(year);
  }

  async function saveAll() {
    if (!canManage) return;
    setBusy(true); setErr(null);
    const payload = rows.map((r) => ({
      id: r.id, year, week: r.week, date_from: r.date_from, date_to: r.date_to,
      week_type: r.week_type, soll_bau: r.soll_bau, soll_maler: r.soll_maler, note: r.note, source: r.source,
    }));
    const { error } = await supabase.from("buak_calendar").upsert(payload, { onConflict: "year,week" });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSaved(true); loadYear(year);
  }

  async function deleteWholeYear() {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("buak_calendar").delete().eq("year", year);
    setBusy(false); setDelYear(false);
    if (error) { setErr(error.message); return; }
    await loadYears(); await loadYear(year);
  }

  // ---- Automatische Suche im Internet (Edge Function) ----
  async function doSearch() {
    setSearching(true); setErr(null); setResults([]); setImportMsg(null);
    const { data, error } = await supabase.functions.invoke("buak-calendar", { body: { action: "search", year } });
    setSearching(false);
    if (error) { setErr("Suche fehlgeschlagen: " + error.message); return; }
    if ((data as any)?.error) { setErr((data as any).message); return; }
    const res = (data as any)?.results ?? [];
    setResults(res);
    if (!res.length) setImportMsg("Für dieses Jahr wurde kein eindeutiger BUAK-Kalender gefunden. Du kannst eine andere Suche starten, eine Datei manuell hochladen oder den Kalender manuell anlegen.");
  }

  async function doParse(url: string, domain?: string) {
    if (!url) return;
    setParsing(true); setErr(null); setImportMsg(null);
    const { data, error } = await supabase.functions.invoke("buak-calendar", { body: { action: "parse", year, url } });
    setParsing(false);
    if (error) { setErr("Auslesen fehlgeschlagen: " + error.message); return; }
    if ((data as any)?.error) { setErr((data as any).message); return; }
    const d = data as any;
    let dom = domain;
    if (!dom) { try { dom = new URL(url).hostname.replace(/^www\./, ""); } catch { dom = undefined; } }
    setPreview((d.rows ?? []).map((r: any) => ({ ...r, source_url: url, source_domain: dom ?? null })));
    setPreviewMeta({ status: d.status, detected: d.detected, total: d.total, aiUsed: d.aiUsed, message: d.message });
  }

  const editPreview = (week: number, week_type: BuakWeekType) =>
    setPreview((p) => (p ? p.map((r) => (r.week === week ? { ...r, week_type, confidence: 1 } : r)) : p));

  async function applyPreview() {
    if (!preview) return;
    setBusy(true); setErr(null);
    const payload = preview.map((r: any) => ({
      year, week: r.week, date_from: r.date_from, date_to: r.date_to,
      week_type: r.week_type, confidence: r.confidence,
      status: r.week_type === "unbekannt" || (r.confidence ?? 0) < 0.9 ? "pruefung" : "gespeichert",
      source_url: r.source_url, source_domain: r.source_domain, source: r.source_domain,
    }));
    const { error } = await supabase.from("buak_calendar").upsert(payload, { onConflict: "year,week" });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPreview(null); setPreviewMeta(null); setResults([]); setImportMsg(`Kalender ${year} übernommen.`);
    await loadYears(); await loadYear(year);
  }

  const counts = useMemo(() => {
    const c = { kurz: 0, lang: 0, neutral: 0, frei: 0 } as Record<string, number>;
    rows.forEach((r) => { c[r.week_type] = (c[r.week_type] ?? 0) + 1; });
    return c;
  }, [rows]);

  return (
    <div className="glass p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarClock size={18} /> BUAK-Kalender</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Bauarbeiter-Urlaubs- und Abfertigungskasse: legt je Kalenderwoche fest, ob <b>kurze</b> oder <b>lange</b> Woche. Quelle für Soll-Stunden – kein fixer Wechsel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}{years.includes(y) ? "" : " (leer)"}</option>)}
          </select>
          {canManage && (
            <button className="btn-ghost px-2" title="Nächstes Jahr hinzufügen" onClick={addNextYear}><Plus size={16} /> Jahr</button>
          )}
          {canManage && rows.length === 0 && (
            <button className="btn-primary" disabled={busy} onClick={generateYear}><CalendarPlus size={16} /> Jahr {year} generieren</button>
          )}
        </div>
      </div>

      <ErrorBanner message={err} />

      {/* Import + Aktionen */}
      {canManage && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {rows.length > 0 && <>
            <button className="btn-primary" disabled={busy} onClick={saveAll}><Save size={16} /> Speichern</button>
            <button className="btn-ghost" disabled={busy} onClick={() => loadYear(year)}><RotateCcw size={15} /> Zurücksetzen</button>
            <button className="btn-ghost text-rose-500" disabled={busy} onClick={() => setDelYear(true)}><Trash2 size={15} /> Jahr löschen</button>
          </>}
          {saved && <span className="text-sm font-medium text-emerald-600">Gespeichert ✓</span>}
        </div>
      )}

      {importMsg && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-400/40 bg-blue-400/10 p-3 text-sm text-blue-700 dark:text-blue-300">
          <Sparkles size={16} className="mt-0.5 shrink-0" /> {importMsg}
        </div>
      )}

      {/* Automatische Suche im Internet */}
      {canManage && (
        <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold"><Globe size={16} /> Automatisch aus dem Internet (BUAK)</div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" disabled={searching} onClick={doSearch}>
              <Search size={15} /> {searching ? "Suche läuft …" : `Kalender ${year} automatisch suchen`}
            </button>
            <span className="text-xs text-slate-400">oder PDF-Link:</span>
            <input className="input max-w-[16rem] flex-1" placeholder="https://…/buak…pdf" value={parseUrl} onChange={(e) => setParseUrl(e.target.value)} />
            <button className="btn-outline" disabled={parsing || !parseUrl} onClick={() => doParse(parseUrl)}>{parsing ? "Liest …" : "Auslesen"}</button>
          </div>

          {results.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                  <tr>
                    <th className="px-3 py-2">Titel</th><th className="px-3 py-2">Quelle</th>
                    <th className="px-3 py-2">Typ</th><th className="px-3 py-2">Qualität</th><th className="px-3 py-2 text-right">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {results.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-white/5">
                      <td className="px-3 py-2"><span className="line-clamp-1 max-w-xs">{r.title}</span></td>
                      <td className="px-3 py-2 text-slate-500">{r.domain}</td>
                      <td className="px-3 py-2"><Badge tone={r.fileType === "PDF" ? "green" : "slate"}>{r.fileType}</Badge></td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">{r.score}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <a className="btn-ghost px-2" href={r.link} target="_blank" rel="noreferrer" title="Öffnen"><ExternalLink size={15} /></a>
                          <button className="btn-outline px-2 py-1 text-xs" disabled={parsing} onClick={() => doParse(r.link, r.domain)}>Auslesen</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Vertrauenswürdige Quellen zuerst (buak.at, wko.at, GBH …). Es wird nichts ungeprüft gespeichert – du bestätigst den Import in der Vorschau.</p>
        </div>
      )}

      {/* Import-Vorschau */}
      {preview && (
        <div className="mb-4 rounded-xl border-2 p-4" style={{ borderColor: "var(--accent)" }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold">
              Import-Vorschau {year} {previewMeta?.aiUsed && <Badge tone="blue">KI</Badge>}
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => { setPreview(null); setPreviewMeta(null); }}>Verwerfen</button>
              <button className="btn-primary" disabled={busy} onClick={applyPreview}><Check size={15} /> Übernehmen</button>
            </div>
          </div>
          {previewMeta?.status === "pruefung" && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {previewMeta?.message} Unsichere Wochen bitte prüfen (gelb markiert) – sie werden mit Status „Prüfung erforderlich" gespeichert.
            </div>
          )}
          <div className="max-h-[22rem] overflow-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                <tr><th className="px-3 py-2">KW</th><th className="px-3 py-2">Zeitraum</th><th className="px-3 py-2">Erkannt</th><th className="px-3 py-2">Vertrauen</th></tr>
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
                      <td className="px-3 py-1.5 tabular-nums text-xs text-slate-500">{Math.round((r.confidence ?? 0) * 100)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading ? <Spinner /> : rows.length === 0 ? (
        <Empty title={`Kein Kalender für ${year}`} hint="Jahr generieren und Wochenart pflegen – oder eine BUAK-Datei importieren (PDF per Claude, CSV direkt)." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Badge tone="amber">{counts.kurz} kurz</Badge>
            <Badge tone="blue">{counts.lang} lang</Badge>
            <Badge tone="slate">{counts.neutral} neutral</Badge>
            <Badge tone="green">{counts.frei} frei</Badge>
          </div>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2.5 w-14">KW</th>
                  <th className="px-3 py-2.5">Zeitraum</th>
                  <th className="px-3 py-2.5">Wochenart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map((r) => (
                  <tr key={r.week} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-3 py-2 font-semibold tabular-nums text-slate-500">{r.week}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{dmy(r.date_from)} – {dmy(r.date_to)}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select className="input w-auto py-1 text-xs" value={r.week_type} onChange={(e) => editRow(r.week, { week_type: e.target.value as BuakWeekType })}>
                          {WEEK_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                        </select>
                      ) : <Badge tone={TONE[r.week_type]}>{weekTypeLabel(r.week_type)}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
            <Info size={13} className="mt-0.5 shrink-0" />
            Änderungen mit „Speichern" übernehmen. Der Kalender legt nur kurz/lang je KW fest – die tatsächlichen Tagesstunden kommen aus dem Stundenmodell des Mitarbeiters (Anstellung).
          </p>
        </>
      )}

      <ConfirmDialog
        open={delYear}
        title={`Kalender ${year} löschen?`}
        message={<>Alle {rows.length} Kalenderwochen für <b>{year}</b> werden dauerhaft gelöscht.</>}
        busy={busy} confirmLabel="Jahr löschen" onConfirm={deleteWholeYear} onClose={() => setDelYear(false)}
      />
    </div>
  );
}
