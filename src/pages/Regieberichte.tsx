// ============================================================
// Installateursoftware – Regieberichte (Übersicht)
// Liste aller Regieberichte mit Status-/Verrechnet-Filter und Suche.
// Neuanlage über RegieForm, Zeilenklick öffnet die Detailseite.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageHeader, Spinner, Empty, Badge, Stat, Tone } from "../components/ui";
import { SearchInput, Toggle, ErrorBanner } from "../components/calc-ui";
import { dateAt } from "../lib/format";
import { usePermissions } from "../lib/permissions";
import { loadProjectOptions, ProjectOption } from "../lib/documents-overview";
import {
  RegieReport, REGIE_STATUS, regieStatusMeta, loadRegieReports,
} from "../lib/regie";
import RegieForm from "../components/regie/RegieForm";

export default function Regieberichte() {
  const nav = useNavigate();
  const { can, isAdmin } = usePermissions();
  const canCreate = isAdmin || can("regiestunden", "create");

  const [list, setList] = useState<RegieReport[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string>("alle");
  const [onlyVerrechnet, setOnlyVerrechnet] = useState(false);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [reports, projOpts] = await Promise.all([
        loadRegieReports({}),
        loadProjectOptions().catch(() => [] as ProjectOption[]),
      ]);
      setList(reports);
      setProjects(projOpts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Regieberichte konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const projectLabel = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.label]));
    return (id: string | null) => (id ? map.get(id) ?? "–" : "–");
  }, [projects]);

  const shown = useMemo(() => list.filter((r) => {
    if (fStatus !== "alle" && r.status !== fStatus) return false;
    if (onlyVerrechnet && !r.is_verrechnet) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      const hit = [r.report_number, r.kunde_name, r.kunde_ort, projectLabel(r.project_id), r.beschreibung]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
      if (!hit) return false;
    }
    return true;
  }), [list, fStatus, onlyVerrechnet, q, projectLabel]);

  const stats = useMemo(() => ({
    total: list.length,
    offen: list.filter((r) => r.status === "offen").length,
    verrechnet: list.filter((r) => r.is_verrechnet).length,
    stunden: list.reduce((a, r) => a + (Number(r.stunden) || 0), 0),
  }), [list]);

  const hasFilter = q || fStatus !== "alle" || onlyVerrechnet;
  const resetFilters = () => { setQ(""); setFStatus("alle"); setOnlyVerrechnet(false); };

  return (
    <>
      <PageHeader
        title="Regieberichte"
        subtitle={`${stats.total} Berichte · ${stats.offen} offen · ${stats.verrechnet} verrechnet`}
        action={canCreate ? <button className="btn-primary" onClick={() => setShowNew(true)}><Plus size={18} /> Neuer Regiebericht</button> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Berichte" value={stats.total} />
        <Stat label="Offen" value={stats.offen} />
        <Stat label="Verrechnet" value={stats.verrechnet} />
        <Stat label="Stunden gesamt" value={stats.stunden.toLocaleString("de-AT")} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Suche: Nummer, Kunde, Ort, Projekt" />
        <select className="input max-w-[12rem]" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="alle">Alle Status</option>
          {REGIE_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <Toggle checked={onlyVerrechnet} onChange={setOnlyVerrechnet} label="Nur verrechnete" />
        {hasFilter && <button className="btn-ghost" onClick={resetFilters}>Filter zurücksetzen</button>}
      </div>

      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Regieberichte" hint="Lege deinen ersten Regiebericht an – Einsatzzeiten, Material, Beteiligte und Kundenunterschrift an einem Ort." />
      ) : shown.length === 0 ? (
        <Empty title="Keine Treffer" hint="Suche oder Filter anpassen." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Nummer</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Datum</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kunde</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Projekt</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Stunden</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Verrechnet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shown.map((r) => {
                const meta = regieStatusMeta(r.status);
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => nav(`/regieberichte/${r.id}`)}>
                    <td className="px-3 py-2 font-medium">{r.report_number || "–"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dateAt(r.datum)}</td>
                    <td className="px-3 py-2">{r.kunde_name || "–"}</td>
                    <td className="px-3 py-2 text-slate-500">{projectLabel(r.project_id)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(Number(r.stunden) || 0).toLocaleString("de-AT")}</td>
                    <td className="px-3 py-2"><Badge tone={meta.tone as Tone}>{meta.label}</Badge></td>
                    <td className="px-3 py-2">{r.is_verrechnet ? <Badge tone="green">verrechnet</Badge> : <Badge tone="slate">offen</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <RegieForm
          open
          onClose={() => setShowNew(false)}
          onSaved={(id) => { setShowNew(false); nav(`/regieberichte/${id}`); }}
        />
      )}
    </>
  );
}
