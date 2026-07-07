// ============================================================
// B4Y SuperAPP – Zentrale Versionshistorie (für alle finalisierbaren Dokumente)
// Zeigt alle abgeschlossenen Versionen: V-Nr., Abschlussdatum + Uhrzeit,
// abgeschlossen von, Netto/Brutto, Status, optionale Notiz. Je Version:
// „PDF öffnen" (Snapshot = damaliger Stand; im Viewer auch Download/Druck) und
// optional „Wiederherstellen" (übernimmt den Stand als Arbeitskopie → beim
// erneuten Abschließen entsteht eine NEUE Version; nichts wird gelöscht).
// ============================================================
import { useEffect, useState } from "react";
import { FileDown, RotateCcw, Clock } from "lucide-react";
import { Modal, DateStack } from "../ui";
import { eur, dateTimeAt } from "../../lib/format";
import { openSnapshotPdf, buildDocumentPdfFileName } from "../../lib/pdf";
import {
  DocVersion, AuditEntry, loadDocumentVersions, loadDocumentAudit,
  resolveVersionUser, loadProfileNames, versionNote,
} from "../../lib/document-versions";
import { SortHeader } from "../SortHeader";
import { useTableSort } from "../../lib/useTableSort";
import { useAuth } from "../../lib/auth";

export default function VersionHistoryModal({
  sourceTable, sourceId, baseLabel, currentNumber, canRestore, onRestore, restoreDisabledNote, onClose,
}: {
  sourceTable: string;
  sourceId: string;
  baseLabel: string;
  currentNumber?: string | null;
  canRestore?: boolean;
  onRestore?: (v: DocVersion) => void;
  /** Wenn Wiederherstellen fachlich gesperrt ist (z. B. Rechnung/§11): kurze Erklärung statt Button. */
  restoreDisabledNote?: string;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    Promise.all([
      loadDocumentVersions(sourceTable, sourceId),
      loadDocumentAudit(sourceTable, sourceId),
      loadProfileNames().catch(() => new Map<string, string>()),
    ])
      .then(([v, a, p]) => { if (!cancelled) { setVersions(v); setAudit(a); setProfiles(p); } })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? "Versionen konnten nicht geladen werden."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sourceTable, sourceId]);

  function openPdf(v: DocVersion) {
    if (!v.print_html) return;
    void openSnapshotPdf(v.print_html, undefined, buildDocumentPdfFileName({ number: v.doc_number || currentNumber || "", baseLabel }), {
      // Persistenter PDF-Cache je finaler Version (Snapshot unveränderlich → einmal rendern reicht).
      cacheRef: { sourceTable, sourceId, versionNo: v.version_no },
    });
  }

  const latest = versions[0]?.version_no;

  // Anzeige-Sortierung (nur Leserichtung der Historie – die Versionen selbst bleiben unverändert).
  const { session } = useAuth();
  const verSort = useTableSort<DocVersion>(
    "document_versions",
    {
      version: { get: (v) => v.version_no, type: "number" },
      number: { get: (v) => v.doc_number, type: "text" },
      net: { get: (v) => v.summary?.net, type: "number" },
      gross: { get: (v) => v.summary?.gross, type: "number" },
      status: { get: (v) => v.status, type: "text" },
      finalized: { get: (v) => v.finalized_at, type: "date" },
      who: { get: (v) => resolveVersionUser(v, { profiles, audit }), type: "text" },
    },
    { userId: session?.user?.id ?? null, default: { key: "version", dir: "desc" } }
  );
  const versionsSorted = verSort.sortRows(versions);

  return (
    <Modal open onClose={onClose} title="Versionen & Protokoll" size="2xl">
      {err && <div className="mb-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{err}</div>}
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-400">Lädt …</p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Noch keine abgeschlossenen Versionen. Eine unveränderliche Version mit PDF-Stand entsteht beim Abschließen.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Version" sortKey="version" sort={verSort.sort} onSort={verSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Nummer" sortKey="number" sort={verSort.sort} onSort={verSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Netto" sortKey="net" sort={verSort.sort} onSort={verSort.onSort} align="right" padClass="px-3 py-2" />
                <SortHeader label="Brutto" sortKey="gross" sort={verSort.sort} onSort={verSort.onSort} align="right" padClass="px-3 py-2" />
                <SortHeader label="Status" sortKey="status" sort={verSort.sort} onSort={verSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Abgeschlossen am" sortKey="finalized" sort={verSort.sort} onSort={verSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="von" sortKey="who" sort={verSort.sort} onSort={verSort.onSort} padClass="px-3 py-2" />
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {versionsSorted.map((v) => {
                const note = versionNote(v);
                return (
                  <tr key={v.id}>
                    <td className="px-3 py-2 font-semibold">
                      V{v.version_no}{v.version_no === latest && <span className="ml-1 rounded bg-emerald-500/15 px-1 text-[10px] font-medium text-emerald-600">aktuell</span>}
                    </td>
                    <td className="px-3 py-2">{v.doc_number || "–"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.summary?.net != null ? eur(v.summary.net) : "–"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.summary?.gross != null ? eur(v.summary.gross) : "–"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{v.status || "–"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-400"><DateStack d={v.finalized_at} /></td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-400">{resolveVersionUser(v, { profiles, audit })}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        {v.print_html ? (
                          <button className="btn-ghost whitespace-nowrap px-2 py-1 text-xs" title="PDF dieses Stands öffnen (Download/Druck im Viewer)" onClick={() => openPdf(v)}>
                            <FileDown size={14} /> PDF
                          </button>
                        ) : <span className="whitespace-nowrap px-2 text-xs text-slate-400">kein Druckstand</span>}
                        {canRestore && onRestore ? (
                          <button className="btn-ghost whitespace-nowrap px-2 py-1 text-xs text-[var(--accent)]" title="Diesen Stand als Arbeitskopie übernehmen (erzeugt beim Abschließen eine neue Version)"
                            onClick={() => onRestore(v)}>
                            <RotateCcw size={14} /> Wiederherstellen
                          </button>
                        ) : (restoreDisabledNote && (
                          <span className="whitespace-nowrap px-2 text-xs text-slate-400" title={restoreDisabledNote}>nicht wiederherstellbar</span>
                        ))}
                      </div>
                      {note && <div className="mt-0.5 text-right text-[11px] italic text-slate-400">{note}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {audit.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Clock size={12} /> Änderungsprotokoll
          </div>
          <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
            {audit.map((a) => <li key={a.id}>{dateTimeAt(a.created_at)} – {a.detail || a.action}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button className="btn-primary" onClick={onClose}>Schließen</button>
      </div>
    </Modal>
  );
}
