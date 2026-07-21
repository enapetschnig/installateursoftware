// ============================================================
// Installateur SuperAPP – Foto-Schnellaufnahme (Baustelle)
// ------------------------------------------------------------
// Zwei große Knöpfe: "Foto aufnehmen" öffnet am Handy direkt die Rückkamera
// (capture="environment"), "Aus Galerie" wählt vorhandene Bilder. Am Desktop
// ignoriert der Browser `capture` und zeigt den normalen Dateidialog – genau
// das gewünschte Verhalten.
//
// Projektzuordnung passiert NACH dem Fotografieren: Der Monteur soll erst
// auslösen und dann zuordnen, nicht umgekehrt. Ist ein Projekt vorgegeben
// (z. B. auf der Projektseite) oder gibt es genau einen heutigen Einsatz,
// wird es automatisch vorausgewählt.
//
// Nutzt uploadProjectMedia() aus lib/media – kein zweiter Upload-Pfad.
// ============================================================
import { useRef, useState } from "react";
import { Camera, Images, Loader2, Check } from "lucide-react";
import { Modal } from "../ui";
import { toast, toastError } from "../../lib/toast";
import { supabase } from "../../lib/supabase";
import { uploadProjectMedia } from "../../lib/media";

export interface ProjektVorschlag { id: string; label: string }

/** Bilder vor dem Upload verkleinern – ein iPhone-Foto hat sonst 8–12 MB. */
async function verkleinern(file: File, maxKante = 2560, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size < 1_200_000) return file; // klein genug – nicht neu kodieren
  try {
    const bitmap = await createImageBitmap(file);
    const skala = Math.min(1, maxKante / Math.max(bitmap.width, bitmap.height));
    if (skala >= 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * skala);
    canvas.height = Math.round(bitmap.height * skala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // Verkleinern ist Komfort – im Zweifel Original hochladen
  }
}

export default function QuickPhotoButton({
  projectId, projektVorschlaege = [], uploadedBy, onDone,
}: {
  /** Fixes Projekt (z. B. auf einer Projektseite). Null = wird abgefragt. */
  projectId?: string | null;
  /** Projekte des heutigen Einsatzes – erste Wahl bei der Zuordnung. */
  projektVorschlaege?: ProjektVorschlag[];
  uploadedBy?: string | null;
  onDone?: () => void;
}) {
  const kameraRef = useRef<HTMLInputElement>(null);
  const galerieRef = useRef<HTMLInputElement>(null);
  const [dateien, setDateien] = useState<File[]>([]);
  const [quelle, setQuelle] = useState<"mobile_camera" | "upload">("upload");
  const [zielProjekt, setZielProjekt] = useState<string>("");
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<ProjektVorschlag[]>([]);
  const [busy, setBusy] = useState(false);
  const [fortschritt, setFortschritt] = useState({ fertig: 0, gesamt: 0 });

  function gewaehlt(files: FileList | null, q: "mobile_camera" | "upload") {
    const liste = Array.from(files ?? []);
    if (liste.length === 0) return;
    setDateien(liste);
    setQuelle(q);
    // Vorauswahl: fixes Projekt > genau ein Einsatz heute > leer
    setZielProjekt(projectId || (projektVorschlaege.length === 1 ? projektVorschlaege[0].id : ""));
    setSuche("");
    setTreffer([]);
  }

  async function projekteSuchen(text: string) {
    setSuche(text);
    if (text.trim().length < 2) { setTreffer([]); return; }
    const { data } = await supabase
      .from("projects")
      .select("id,project_number,title")
      .or(`title.ilike.%${text}%,project_number.ilike.%${text}%`)
      .eq("archived", false)
      .limit(8);
    setTreffer(((data as Record<string, unknown>[]) ?? []).map((p) => ({
      id: p.id as string,
      label: [p.project_number, p.title].filter(Boolean).join(" · "),
    })));
  }

  async function hochladen() {
    if (!zielProjekt || dateien.length === 0) return;
    setBusy(true);
    setFortschritt({ fertig: 0, gesamt: dateien.length });
    let fehler = 0;
    for (let i = 0; i < dateien.length; i++) {
      const f = dateien[i];
      try {
        const klein = await verkleinern(f);
        await uploadProjectMedia({
          projectId: zielProjekt,
          file: klein,
          fileName: klein.name,
          categoryId: null,
          categoryLabel: null,
          mediaType: f.type.startsWith("video/") ? "video" : "photo",
          source: quelle,
          uploadedBy: uploadedBy ?? null,
        });
      } catch (e) {
        fehler++;
        console.error("Foto-Upload fehlgeschlagen:", e);
      }
      setFortschritt({ fertig: i + 1, gesamt: dateien.length });
    }
    setBusy(false);
    setDateien([]);
    if (fehler > 0) toastError(`${fehler} von ${dateien.length} Dateien konnten nicht hochgeladen werden.`);
    else toast(dateien.length === 1 ? "Foto gespeichert." : `${dateien.length} Dateien gespeichert.`);
    onDone?.();
  }

  const auswahl = projektVorschlaege.length > 0 || treffer.length > 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button
          className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-bold text-white shadow-sm transition active:scale-[0.98]"
          style={{ background: "var(--accent)" }}
          onClick={() => kameraRef.current?.click()}
        >
          <Camera size={20} /> Foto aufnehmen
        </button>
        <button
          className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-bold transition active:scale-[0.98]"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
          onClick={() => galerieRef.current?.click()}
        >
          <Images size={20} /> Aus Galerie
        </button>
      </div>

      {/* capture="environment" öffnet am Handy die Rückkamera; Desktop zeigt den Dateidialog. */}
      <input ref={kameraRef} type="file" accept="image/*" capture="environment" className="hidden"
             onChange={(e) => { gewaehlt(e.target.files, "mobile_camera"); e.target.value = ""; }} />
      <input ref={galerieRef} type="file" accept="image/*,video/*" multiple className="hidden"
             onChange={(e) => { gewaehlt(e.target.files, "upload"); e.target.value = ""; }} />

      {/* Zuordnung NACH der Aufnahme */}
      <Modal open={dateien.length > 0} onClose={() => !busy && setDateien([])} title="Foto zuordnen">
        <p className="text-sm text-slate-500">
          {dateien.length === 1 ? "1 Datei" : `${dateien.length} Dateien`} – zu welchem Projekt?
        </p>

        {projektVorschlaege.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Heutige Einsätze</div>
            <div className="space-y-1.5">
              {projektVorschlaege.map((p) => (
                <button key={p.id}
                        className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-left text-sm transition ${zielProjekt === p.id ? "border-brand-400 bg-brand-50/50 dark:bg-brand-500/10" : ""}`}
                        style={{ borderColor: zielProjekt === p.id ? undefined : "var(--border)" }}
                        onClick={() => setZielProjekt(p.id)}>
                  {zielProjekt === p.id && <Check size={15} style={{ color: "var(--accent)" }} />}
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3">
          <label className="label">{auswahl ? "Anderes Projekt suchen" : "Projekt suchen"}</label>
          <input className="input" value={suche} placeholder="Projektnummer oder Name"
                 onChange={(e) => void projekteSuchen(e.target.value)} />
          {treffer.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {treffer.map((p) => (
                <button key={p.id}
                        className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-left text-sm transition ${zielProjekt === p.id ? "border-brand-400 bg-brand-50/50 dark:bg-brand-500/10" : ""}`}
                        style={{ borderColor: zielProjekt === p.id ? undefined : "var(--border)" }}
                        onClick={() => setZielProjekt(p.id)}>
                  {zielProjekt === p.id && <Check size={15} style={{ color: "var(--accent)" }} />}
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {busy && (
          <div className="mt-3 text-sm text-slate-500">
            Lädt … {fortschritt.fertig}/{fortschritt.gesamt}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-outline" disabled={busy} onClick={() => setDateien([])}>Abbrechen</button>
          <button className="btn-primary" disabled={busy || !zielProjekt} onClick={() => void hochladen()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Speichern
          </button>
        </div>
      </Modal>
    </>
  );
}
