// ============================================================
// B4Y SuperAPP – Datenreset (Testdaten sicher zurücksetzen)
// ------------------------------------------------------------
// Admin-Werkzeug (Einstellungen). Löscht Projekte + Projekt-Kinder und alle
// Dokumente/Belege + Dokumentketten der eigenen Organisation.
// BLEIBEN ERHALTEN: Kontakte (Kunden/Lieferanten/Subunternehmer) inkl.
// Ansprechpartner, Mitarbeiter, Rollen/Rechte, Firmeneinstellungen, Signaturen,
// Stammdaten. Nummernkreise: optional Projekt- + Dokument-Kreise auf 1
// (Kontaktkreise bleiben immer unverändert).
// Ablauf: Dry-Run-Zusammenfassung → Optionen → Bestätigung „RESET" → Ausführung.
// Die eigentliche Löschung passiert atomar/serverseitig im RPC reset_test_data
// (Migr. 0127, security definer, org-scoped, admin-gated). Storage-Dateien werden
// nur optional und GEZIELT (Dateien der gelöschten Dokumente/Medien) entfernt.
// ============================================================
import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCcw, ShieldAlert } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { ErrorBanner } from "../calc-ui";
import { toast } from "../../lib/toast";
import { germanError } from "../../lib/error-messages";

type Counts = Record<string, number>;

// Zu löschende Bewegungsdaten (Schlüssel = Zähler aus reset_test_data_preview()).
const LABELS: Record<string, string> = {
  projects: "Projekte",
  offers: "Angebote",
  orders: "Aufträge",
  sub_orders: "SUB-Aufträge",
  invoices: "Rechnungen",
  documents: "Dokumente",
  project_media: "Fotos/Medien",
  project_log: "Logbuch-Einträge",
  project_appointments: "Projekt-Termine",
  project_meetings: "Baubesprechungen",
  tasks: "Projekt-Aufgaben",
  time_entries: "Zeiteinträge",
  planning_events: "Planungs-Termine",
};

// Bleibt erhalten – wird nur informativ angezeigt, NICHT gelöscht.
const KEPT_LABELS: Record<string, string> = {
  kept_contacts: "Kontakte",
  kept_contact_persons: "Ansprechpartner",
};

/** Zerlegt eine Supabase-Storage-URL in Bucket + Pfad (public oder signed). */
function parseStoragePath(url: string | null | undefined): { bucket: string; path: string } | null {
  if (!url) return null;
  const m = String(url).match(/\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (!m) return null;
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

export default function DataReset({ canManage }: { canManage: boolean }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [resetNumberRanges, setResetNumberRanges] = useState(false);
  const [deleteStorage, setDeleteStorage] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadPreview() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc("reset_test_data_preview");
    if (error) setErr(germanError(error, "Vorschau konnte nicht geladen werden."));
    setCounts((data as Counts) ?? null);
    setLoading(false);
  }
  useEffect(() => {
    if (canManage) loadPreview();
    else setLoading(false);
  }, [canManage]);

  // Summe NUR über die zu löschenden Daten (kept_* zählt nicht mit).
  const total = counts
    ? Object.keys(LABELS).reduce((a, k) => a + (counts[k] || 0), 0)
    : 0;

  async function removeReferencedFiles() {
    // Nur gezielt: Storage-Objekte der zu löschenden Dokumente/Medien der eigenen Org (best-effort).
    try {
      const [docs, media] = await Promise.all([
        supabase.from("documents").select("file_url"),
        supabase.from("project_media").select("file_url, thumbnail_url"),
      ]);
      const urls: string[] = [];
      for (const d of (docs.data as { file_url: string | null }[]) ?? [])
        if (d.file_url) urls.push(d.file_url);
      for (const m of (media.data as { file_url: string | null; thumbnail_url: string | null }[]) ?? []) {
        if (m.file_url) urls.push(m.file_url);
        if (m.thumbnail_url) urls.push(m.thumbnail_url);
      }
      const byBucket = new Map<string, string[]>();
      for (const u of urls) {
        const p = parseStoragePath(u);
        if (!p) continue;
        (byBucket.get(p.bucket) ?? byBucket.set(p.bucket, []).get(p.bucket)!).push(p.path);
      }
      for (const [bucket, paths] of byBucket) {
        for (let i = 0; i < paths.length; i += 100) {
          await supabase.storage
            .from(bucket)
            .remove(paths.slice(i, i + 100))
            .catch(() => {});
        }
      }
    } catch {
      /* Storage best-effort – Fehler ignorieren, DB-Reset ist maßgeblich */
    }
  }

  async function runReset() {
    if (confirmText.trim() !== "RESET") {
      setErr("Bitte zur Bestätigung RESET eingeben.");
      return;
    }
    setBusy(true);
    setErr(null);
    // Storage-Dateien VOR dem DB-Reset einsammeln/entfernen (danach sind die Zeilen weg).
    if (deleteStorage) await removeReferencedFiles();
    const { data, error } = await supabase.rpc("reset_test_data", {
      p_confirm: "RESET",
      p_reset_number_ranges: resetNumberRanges,
    });
    setBusy(false);
    if (error) {
      console.error("Datenreset:", error);
      setErr(germanError(error, "Datenreset fehlgeschlagen."));
      return;
    }
    const deleted = (data as { deleted?: Counts } | null)?.deleted ?? {};
    const sum = Object.keys(LABELS).reduce((a, k) => a + (deleted[k] || 0), 0);
    toast(`Datenreset abgeschlossen – ${sum} Datensätze entfernt. Kontakte blieben erhalten.`);
    setConfirmText("");
    setDeleteStorage(false);
    loadPreview();
  }

  if (!canManage) {
    return (
      <div className="glass p-4">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
          <ShieldAlert size={20} /> Datenreset
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Der Datenreset kann nur von Administratoren ausgeführt werden.
        </p>
      </div>
    );
  }

  const armed = confirmText.trim() === "RESET";

  return (
    <div className="glass p-4">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <RefreshCcw size={20} /> Datenreset (Testdaten)
      </h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Löscht alle <b>Projekte</b> (inkl. Fotos, Logbuch, Terminen, Aufgaben, Regiestunden, Baubesprechungen)
        sowie alle <b>Dokumente und Belege</b> mit ihren Dokumentketten dieser Firma.{" "}
        <b>
          Kontakte, Lieferanten, Subunternehmer und Ansprechpartner bleiben erhalten – ebenso Mitarbeiter,
          Rollen/Rechte, Firmeneinstellungen, Signaturen und Stammdaten.
        </b>
      </p>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <span>
          Diese Aktion ist <b>nicht umkehrbar</b>. Die betroffenen Daten werden dauerhaft gelöscht. Bitte nur
          mit Testdaten verwenden.
        </span>
      </div>

      <ErrorBanner message={err} />

      {loading ? (
        <p className="text-sm text-slate-400">Lädt Vorschau …</p>
      ) : (
        <>
          <div className="mb-4 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Betroffen (Vorschau)
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              {counts &&
                Object.keys(LABELS).map((k) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">{LABELS[k]}</span>
                    <span className="font-mono tabular-nums font-semibold">{counts[k] ?? 0}</span>
                  </div>
                ))}
            </div>
            <div className="mt-2 border-t pt-2 text-sm" style={{ borderColor: "var(--border)" }}>
              Gesamt: <b className="tabular-nums">{total}</b> Datensätze
            </div>
            <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <span className="font-semibold">Bleibt erhalten:</span>{" "}
              {counts &&
                Object.keys(KEPT_LABELS)
                  .map((k) => `${counts[k] ?? 0} ${KEPT_LABELS[k]}`)
                  .join(" · ")}
            </div>
          </div>

          <div className="mb-4 space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={resetNumberRanges}
                onChange={(e) => setResetNumberRanges(e.target.checked)}
              />
              <span>
                Projekt- und Dokument-Nummernkreise auf 1 zurücksetzen (Kontaktkreise bleiben unverändert).
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteStorage}
                onChange={(e) => setDeleteStorage(e.target.checked)}
              />
              <span>
                Zusätzlich die hochgeladenen Dateien/PDFs der gelöschten Dokumente/Medien aus dem Speicher
                entfernen (best-effort).
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">
                Zur Bestätigung <b>RESET</b> eingeben
              </label>
              <input
                className="input font-mono w-40"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESET"
              />
            </div>
            <button
              className="btn-primary bg-rose-600 hover:bg-rose-700"
              style={{ background: "var(--c-red, #e11d48)" }}
              disabled={!armed || busy || total === 0}
              onClick={runReset}
            >
              <RefreshCcw size={16} /> {busy ? "Setzt zurück …" : "Daten jetzt zurücksetzen"}
            </button>
            {total === 0 && <span className="text-sm text-slate-400">Keine Bewegungsdaten vorhanden.</span>}
          </div>
        </>
      )}
    </div>
  );
}
