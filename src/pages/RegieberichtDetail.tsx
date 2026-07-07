// ============================================================
// Installateursoftware – Regiebericht-Detail
// Vollansicht eines Regieberichts: Kopf (Kunde/Projekt/Einsatz), Material
// mit Summen, Beteiligte, Foto-Galerie (Upload in project-files unter
// regie/<id>/), Kundenunterschrift (SignaturePad) und Aktionen
// (Bearbeiten, Verrechnet umschalten, Löschen, PDF/Druck).
// ============================================================
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Pencil, Trash2, Printer, ReceiptText, Upload, ImageOff, Star, X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { PageHeader, Spinner, Empty, Badge, Tone } from "../components/ui";
import { ConfirmDialog, ErrorBanner } from "../components/calc-ui";
import { eur, dateAt, dateTimeAt } from "../lib/format";
import { toast, toastError } from "../lib/toast";
import { usePermissions } from "../lib/permissions";
import { useSignedUrl } from "../lib/storage";
import SignaturePad from "../components/SignaturePad";
import { useEmployees, employeeDisplayName } from "../lib/project-config";
import {
  RegieReport, RegieMaterial, RegieWorker, RegiePhoto,
  regieStatusMeta, loadRegieReport, signRegieReport, setRegieVerrechnet,
  deleteRegieReport, addRegiePhoto, deleteRegiePhoto, materialSum,
} from "../lib/regie";
import RegieForm from "../components/regie/RegieForm";
import { openRegiePdf } from "../components/regie/regiePdf";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const timeStr = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : "");

type Data = { report: RegieReport; materials: RegieMaterial[]; workers: RegieWorker[]; photos: RegiePhoto[] };

export default function RegieberichtDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { can, isAdmin } = usePermissions();
  const { employees } = useEmployees();

  const [data, setData] = useState<Data | null>(null);
  const [projLabel, setProjLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delPhoto, setDelPhoto] = useState<RegiePhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signData, setSignData] = useState<string | null>(null);
  const [signName, setSignName] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setErr(null);
    try {
      const res = await loadRegieReport(id);
      if (!res.report) { setData(null); setLoading(false); return; }
      setData({ report: res.report, materials: res.materials, workers: res.workers, photos: res.photos });
      setSignName(res.report.unterschrift_name || res.report.kunde_name || "");
      if (res.report.project_id) {
        const { data: p } = await supabase
          .from("projects").select("project_number,title").eq("id", res.report.project_id).maybeSingle();
        const pr = p as { project_number: string | null; title: string | null } | null;
        setProjLabel(pr ? [pr.project_number, pr.title].filter(Boolean).join(" · ") : "");
      } else {
        setProjLabel("");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Regiebericht konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const report = data?.report ?? null;
  const verrechnet = !!report?.is_verrechnet;

  // Rechte: Bearbeiten/Löschen nur wenn nicht verrechnet – oder Admin.
  const canEdit = (isAdmin || can("regiestunden", "edit")) && (!verrechnet || isAdmin);
  const canDelete = (isAdmin || can("regiestunden", "delete")) && (!verrechnet || isAdmin);
  const canToggleVerrechnet = isAdmin || can("regiestunden", "edit");

  const total = useMemo(() => materialSum(data?.materials ?? []), [data]);
  const empName = (eid: string) => {
    const e = employees.find((x) => x.id === eid);
    return e ? employeeDisplayName(e) : "Mitarbeiter";
  };

  async function onUpload(files: FileList | null) {
    if (!id || !files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `regie/${id}/${uid()}.${ext}`;
        const up = await supabase.storage.from("project-files").upload(path, file, {
          cacheControl: "3600", upsert: false, contentType: file.type || undefined,
        });
        if (up.error) throw up.error;
        await addRegiePhoto(id, path, file.name);
      }
      toast("Foto(s) hochgeladen.");
      await load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  async function confirmDeletePhoto() {
    if (!delPhoto) return;
    setBusy(true);
    try {
      await deleteRegiePhoto(delPhoto.id);
      await supabase.storage.from("project-files").remove([delPhoto.file_path]).catch(() => undefined);
      toast("Foto gelöscht.");
      setDelPhoto(null);
      await load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Foto konnte nicht gelöscht werden.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSignature() {
    if (!id || !signData) { toastError("Bitte zuerst unterschreiben."); return; }
    setBusy(true);
    const res = await signRegieReport(id, signData, signName.trim());
    setBusy(false);
    if (res.error) { toastError(res.error); return; }
    toast("Unterschrift gespeichert.");
    setSigning(false); setSignData(null);
    await load();
  }

  async function toggleVerrechnet() {
    if (!id || !report) return;
    setBusy(true);
    const res = await setRegieVerrechnet(id, !report.is_verrechnet);
    setBusy(false);
    if (res.error) { toastError(res.error); return; }
    toast(!report.is_verrechnet ? "Als verrechnet markiert." : "Verrechnung aufgehoben.");
    await load();
  }

  async function confirmDelete() {
    if (!id) return;
    setBusy(true);
    const res = await deleteRegieReport(id);
    setBusy(false);
    if (res.error) { toastError(res.error); return; }
    toast("Regiebericht gelöscht.");
    nav("/regieberichte");
  }

  if (loading) return <Spinner />;
  if (!report) {
    return (
      <>
        <button className="btn-ghost mb-4" onClick={() => nav("/regieberichte")}><ArrowLeft size={16} /> Zur Übersicht</button>
        <Empty title="Regiebericht nicht gefunden" hint="Er wurde eventuell gelöscht oder du hast keine Berechtigung." />
      </>
    );
  }

  const meta = regieStatusMeta(report.status);
  const zeit = [timeStr(report.start_time), timeStr(report.end_time)].filter(Boolean).join(" – ");
  const showPad = canEdit && (signing || !report.unterschrift_kunde);

  return (
    <>
      <button className="btn-ghost mb-2" onClick={() => nav("/regieberichte")}><ArrowLeft size={16} /> Zur Übersicht</button>

      <PageHeader
        title={report.report_number || "Regiebericht"}
        subtitle={`${report.kunde_name || "–"} · ${dateAt(report.datum)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-outline min-h-[44px]" onClick={() => openRegiePdf(report.id)} title="PDF / Drucken"><Printer size={16} /> PDF</button>
            {canToggleVerrechnet && (
              <button className="btn-outline min-h-[44px]" onClick={toggleVerrechnet} disabled={busy} title="Verrechnet umschalten">
                <ReceiptText size={16} /> {verrechnet ? "Verrechnung aufheben" : "Als verrechnet"}
              </button>
            )}
            {canEdit && <button className="btn-outline min-h-[44px]" onClick={() => setEditing(true)}><Pencil size={16} /> Bearbeiten</button>}
            {canDelete && <button className="btn-outline min-h-[44px] text-rose-500" onClick={() => setDelOpen(true)}><Trash2 size={16} /> Löschen</button>}
          </div>
        }
      />

      <ErrorBanner message={err} />

      {/* Kopf */}
      <div className="glass mb-4 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone as Tone}>{meta.label}</Badge>
          {verrechnet ? <Badge tone="green">verrechnet</Badge> : <Badge tone="slate">nicht verrechnet</Badge>}
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <SectionLabel>Kunde</SectionLabel>
            <div className="text-sm">
              <div className="font-semibold">{report.kunde_name || "–"}</div>
              {report.kunde_strasse && <div className="text-slate-500">{report.kunde_strasse}</div>}
              {(report.kunde_plz || report.kunde_ort) && <div className="text-slate-500">{[report.kunde_plz, report.kunde_ort].filter(Boolean).join(" ")}</div>}
              {report.kunde_email && <div className="text-slate-500">{report.kunde_email}</div>}
              {report.kunde_telefon && <div className="text-slate-500">{report.kunde_telefon}</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Datum">{dateAt(report.datum)}</Field>
            <Field label="Uhrzeit">{zeit || "–"}</Field>
            <Field label="Pause">{report.pause_minutes ? `${report.pause_minutes} Min.` : "–"}</Field>
            <Field label="Stunden">{(Number(report.stunden) || 0).toLocaleString("de-AT")} h</Field>
            <Field label="Projekt" wide>{projLabel || "–"}</Field>
          </div>
        </div>
        {report.beschreibung?.trim() && (
          <div className="mt-5">
            <SectionLabel>Durchgeführte Arbeiten</SectionLabel>
            <p className="whitespace-pre-wrap text-sm">{report.beschreibung}</p>
          </div>
        )}
        {report.notizen?.trim() && (
          <div className="mt-4">
            <SectionLabel>Interne Notizen</SectionLabel>
            <p className="whitespace-pre-wrap text-sm text-slate-500 dark:text-slate-400">{report.notizen}</p>
          </div>
        )}
      </div>

      {/* Material */}
      <div className="glass mb-4 p-6">
        <SectionLabel>Material</SectionLabel>
        {data && data.materials.length === 0 ? (
          <p className="text-sm text-slate-400">Kein Material erfasst.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Bezeichnung</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Menge</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Einheit</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Einzelpreis</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Summe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data?.materials.map((m, i) => (
                  <tr key={m.id ?? i}>
                    <td className="px-3 py-2">{m.material}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(Number(m.menge) || 0).toLocaleString("de-AT")}</td>
                    <td className="px-3 py-2 text-slate-500">{m.einheit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(Number(m.einzelpreis) || 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur((Number(m.menge) || 0) * (Number(m.einzelpreis) || 0))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 dark:border-white/10">
                  <td colSpan={4} className="px-3 py-2 text-right font-semibold">Materialsumme (netto)</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{eur(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Beteiligte */}
      <div className="glass mb-4 p-6">
        <SectionLabel>Beteiligte Mitarbeiter</SectionLabel>
        {data && data.workers.length === 0 ? (
          <p className="text-sm text-slate-400">Keine Beteiligten erfasst.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data?.workers.map((w) => (
              <li key={w.employee_id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                {w.is_main && <Star size={16} className="text-amber-500" fill="currentColor" />}
                <span className="font-medium">{empName(w.employee_id)}</span>
                {w.is_main && <span className="text-xs text-amber-600 dark:text-amber-400">Hauptmonteur</span>}
                <span className="text-slate-400">·</span>
                <span className="tabular-nums text-slate-500">{((w.hours ?? report.stunden) || 0).toLocaleString("de-AT")} h</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fotos */}
      <div className="glass mb-4 p-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <SectionLabel className="mb-0">Fotos</SectionLabel>
          {canEdit && (
            <label className={`btn-outline min-h-[44px] cursor-pointer ${uploading ? "pointer-events-none opacity-60" : ""}`}>
              <Upload size={16} /> {uploading ? "Lädt …" : "Foto hochladen"}
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
            </label>
          )}
        </div>
        {data && data.photos.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-400"><ImageOff size={16} /> Noch keine Fotos.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {data?.photos.map((ph) => (
              <PhotoTile key={ph.id} photo={ph} canDelete={canEdit} onDelete={() => setDelPhoto(ph)} />
            ))}
          </div>
        )}
      </div>

      {/* Unterschrift */}
      <div className="glass mb-4 p-6">
        <SectionLabel>Kundenunterschrift</SectionLabel>
        {report.unterschrift_kunde && !signing ? (
          <div>
            <div className="inline-block rounded-xl border p-2" style={{ borderColor: "var(--border)", background: "#fff" }}>
              <img src={report.unterschrift_kunde} alt="Unterschrift" className="max-h-40" />
            </div>
            <div className="mt-2 text-sm text-slate-500">
              {report.unterschrift_name || report.kunde_name}
              {report.unterschrift_am && <> · unterschrieben am {dateTimeAt(report.unterschrift_am)}</>}
            </div>
            {canEdit && <button className="btn-ghost mt-2" onClick={() => { setSigning(true); setSignData(null); }}>Neu unterschreiben</button>}
          </div>
        ) : showPad ? (
          <div className="max-w-xl">
            <SignaturePad value={null} onChange={setSignData} height={200} />
            <div className="mt-3">
              <label className="label">Name (unterschreibende Person)</label>
              <input className="input max-w-sm" value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Name" />
            </div>
            <div className="mt-3 flex gap-2">
              {signing && report.unterschrift_kunde && <button className="btn-outline" onClick={() => setSigning(false)} disabled={busy}>Abbrechen</button>}
              <button className="btn-primary" onClick={saveSignature} disabled={busy || !signData}>{busy ? "Speichern …" : "Unterschrift speichern"}</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Noch nicht unterschrieben.</p>
        )}
      </div>

      {editing && (
        <RegieForm
          open
          reportId={report.id}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}

      <ConfirmDialog
        open={delOpen}
        title="Regiebericht löschen?"
        message={<>Soll der Regiebericht <b>{report.report_number || ""}</b> gelöscht werden? Automatisch erzeugte Zeiteinträge der Beteiligten werden mit entfernt.</>}
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDelOpen(false)}
      />
      <ConfirmDialog
        open={!!delPhoto}
        title="Foto löschen?"
        message="Soll dieses Foto dauerhaft entfernt werden?"
        busy={busy}
        onConfirm={confirmDeletePhoto}
        onClose={() => setDelPhoto(null)}
      />
    </>
  );
}

// ---------- kleine Bausteine ----------
function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${className}`}>{children}</div>;
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{children}</div>
    </div>
  );
}

function PhotoTile({ photo, canDelete, onDelete }: { photo: RegiePhoto; canDelete: boolean; onDelete: () => void }) {
  const url = useSignedUrl("project-files", photo.file_path);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
          <img src={url} alt={photo.file_name || "Foto"} className="h-full w-full object-cover" />
        </a>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-300"><ImageOff size={20} /></div>
      )}
      {canDelete && (
        <button
          type="button"
          className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
          title="Foto löschen"
          onClick={(e) => { e.preventDefault(); onDelete(); }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
