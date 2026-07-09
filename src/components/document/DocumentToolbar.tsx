// ============================================================
// B4Y SuperAPP – Dokument-Toolbar
// Zum Projekt · Preise aktualisieren · Zeiten einfügen · Positionen ·
// Vorlagen · Rückgängig · Wiederholen · Speichern · Abschließen · Mehr
// ============================================================
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, RefreshCw, Clock, LayoutTemplate, Undo2, Redo2,
  Save, CheckCircle2, MoreHorizontal, FileDown, Settings, Plus, Layers, History, Sparkles,
  Send,
} from "lucide-react";

export type MoreAction = { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean };

// Dokumenttyp-Kennfarben (fixe, semantische Belegfarben – bewusst je Typ verschieden,
// damit Angebot/Auftrag/Rechnung im Editor auf einen Blick unterscheidbar sind).
const DOC_TYPE_TONES: Record<string, { fg: string; bg: string }> = {
  angebot: { fg: "#2563eb", bg: "rgba(37,99,235,.14)" },
  nachtrag: { fg: "#7c3aed", bg: "rgba(124,58,237,.14)" },
  auftrag: { fg: "#059669", bg: "rgba(5,150,105,.14)" },
  auftrag_sub: { fg: "#0d9488", bg: "rgba(13,148,136,.14)" },
  rechnung: { fg: "#4f46e5", bg: "rgba(79,70,229,.14)" },
  gutschrift: { fg: "#b45309", bg: "rgba(180,83,9,.14)" },
};
const docTone = (key?: string) => (key && DOC_TYPE_TONES[key]) || { fg: "var(--accent)", bg: "var(--accent-soft)" };

export default function DocumentToolbar({
  projectId, onJumpProject, onRefreshPrices, refreshing, onInsertTimes, onHistory,
  onCreateArticle, onCreateService, onMultiInsert, aiActions,
  onTemplates, onSettings, onUndo, onRedo, canUndo, canRedo, onSave, saving, dirty,
  onFinalize, onPdf, moreActions, readOnly, autoSave, saveStatus, correctionPending, onRetry,
  docTypeKey, docTypeLabel, docNumber, onResend, resendLabel,
}: {
  projectId?: string | null;
  onJumpProject: () => void;
  onRefreshPrices: () => void;
  refreshing?: boolean;
  onInsertTimes: () => void;
  onHistory?: () => void; // Versionshistorie öffnen (zwischen Vorlagen und Einstellungen)
  // Prominente Dokumenttyp-Kennzeichnung (immer sichtbar, da Toolbar sticky):
  // großes farbiges Typ-Band am Zeilenanfang, Nummer/Entwurf direkt daneben.
  docTypeKey?: string;
  docTypeLabel?: string;
  docNumber?: string | null;
  // Stammdaten-/Einfügeaktionen (zentrale Masken): nur sichtbar wenn übergeben (Rechte/Editierbarkeit).
  onCreateArticle?: () => void;
  onCreateService?: () => void;
  /** „Positionen einfügen": EIN zentraler Einstieg für Mehrfach-Einfügen –
      im Dialog wird zwischen „Aus Stamm" und „Aus Dokument übernehmen" gewählt. */
  onMultiInsert?: () => void;
  /** Abgeschlossenes Dokument ohne Änderung erneut versenden (keine neue Version). */
  onResend?: () => void;
  resendLabel?: string;
  // KI-Aktionen (kompaktes „+ KI"-Dropdown). Nur sichtbar, wenn bearbeitbar + Liste nicht leer.
  aiActions?: MoreAction[];
  onTemplates: () => void;
  onSettings?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSave: () => void;
  saving?: boolean;
  dirty?: boolean;
  onFinalize: () => void;
  onPdf: () => void;
  moreActions?: MoreAction[];
  readOnly?: boolean;
  autoSave?: boolean;
  saveStatus?: "saved" | "saving" | "dirty" | "error";
  // Korrekturstand offen (abgeschlossenes Dokument entsperrt; neue Version noch nicht abgeschlossen).
  correctionPending?: boolean;
  onRetry?: () => void;
}) {
  const SS: Record<string, { label: string; cls: string }> = {
    saved: { label: "gespeichert", cls: "text-emerald-500" },
    saving: { label: "speichert …", cls: "text-slate-400" },
    dirty: { label: "Änderungen offen", cls: "text-amber-500" },
    error: { label: "Speichern fehlgeschlagen", cls: "text-rose-500" },
  };
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const aiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const h = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [moreOpen]);

  useEffect(() => {
    if (!aiOpen) return;
    const h = (e: MouseEvent) => { if (aiRef.current && !aiRef.current.contains(e.target as Node)) setAiOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [aiOpen]);

  const tone = docTone(docTypeKey);
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 rounded-2xl border bg-[var(--card)]/95 p-2 backdrop-blur"
      style={{ borderColor: "var(--border)" }}>
      {/* Unübersehbare Typ-Kennzeichnung: WAS bearbeite ich gerade? (sticky → immer sichtbar) */}
      {docTypeLabel && (
        <span className="mr-1 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-extrabold uppercase tracking-wide"
          style={{ color: tone.fg, background: tone.bg }}
          title={`Sie bearbeiten: ${docTypeLabel}${docNumber ? ` ${docNumber}` : " (Entwurf)"}`}>
          {docTypeLabel}
          <span className="font-mono text-[11px] font-semibold normal-case tracking-normal opacity-80">
            {docNumber || "Entwurf"}
          </span>
        </span>
      )}
      <TBtn icon={<ArrowLeft size={15} />} label="Zum Projekt" onClick={onJumpProject} disabled={!projectId} />
      <span className="mx-1 h-6 w-px" style={{ background: "var(--border)" }} />
      <TBtn icon={<RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />} label="Preise aktualisieren" title="Prüft verknüpfte Artikel/Leistungen auf aktuelle Stammpreise und übernimmt Änderungen nur nach Bestätigung." onClick={onRefreshPrices} disabled={readOnly} />
      <TBtn icon={<Clock size={15} />} label="Zeiten einfügen" onClick={onInsertTimes} disabled={readOnly || !projectId} />
      <TBtn icon={<LayoutTemplate size={15} />} label="Vorlagen" onClick={onTemplates} disabled={readOnly} />
      {onHistory && <TBtn icon={<History size={15} />} label="Versionen" onClick={onHistory} />}
      {/* Einstellungen bleiben auch bei gesperrten (finalisierten/abgeschlossenen) Dokumenten
          erreichbar: Kopf-/Stammdaten dürfen weiterhin geöffnet, geändert und gespeichert werden –
          nur Positionen/Canvas bleiben gesperrt (readOnly), der Versions-Snapshot bleibt eingefroren. */}
      {onSettings && <TBtn icon={<Settings size={15} />} label="Einstellungen" onClick={onSettings} />}
      {(onCreateArticle || onCreateService || onMultiInsert) && <span className="mx-1 h-6 w-px" style={{ background: "var(--border)" }} />}
      {onCreateArticle && <TBtn icon={<Plus size={15} />} label="Neuer Artikel" onClick={onCreateArticle} disabled={readOnly} />}
      {onCreateService && <TBtn icon={<Plus size={15} />} label="Neue Leistung" onClick={onCreateService} disabled={readOnly} />}
      {onMultiInsert && <TBtn icon={<Layers size={15} />} label="Positionen einfügen"
        title="Mehrere Positionen einfügen: aus Stamm (Leistungen/Artikel) oder aus einem bestehenden Dokument kopieren (reine Kopie, keine Statusänderung)."
        onClick={onMultiInsert} disabled={readOnly} />}
      {!readOnly && aiActions && aiActions.length > 0 && (
        <div className="relative" ref={aiRef}>
          <button className="btn-ghost flex items-center gap-1.5 px-2 py-1.5 text-xs" title="KI-Aktionen" onClick={() => setAiOpen((v) => !v)}>
            <Sparkles size={15} /> <span className="hidden lg:inline">+ KI</span>
          </button>
          {aiOpen && (
            <div className="absolute left-0 z-30 mt-1 w-56 rounded-xl border bg-[var(--card)] p-1 shadow-lg" style={{ borderColor: "var(--border)" }}>
              {aiActions.map((a, i) => (
                <button key={i} disabled={a.disabled}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-[var(--hover)] disabled:opacity-40"
                  onClick={() => { setAiOpen(false); a.onClick(); }}>
                  {a.icon ?? <Sparkles size={14} />}{a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <span className="mx-1 h-6 w-px" style={{ background: "var(--border)" }} />

      <TBtn icon={<Undo2 size={15} />} label="Rückgängig" onClick={onUndo} disabled={!canUndo || readOnly} iconOnly />
      <TBtn icon={<Redo2 size={15} />} label="Wiederholen" onClick={onRedo} disabled={!canRedo || readOnly} iconOnly />

      <div className="ml-auto flex items-center gap-1.5">
        {/* Korrekturstand offen hat Vorrang vor dem normalen Speicher-Status: macht klar, dass die
            neue Version erst nach „Abschließen" gültig ist (die alte Version bleibt erhalten). */}
        {correctionPending ? (
          <span className="px-1 text-xs font-medium text-amber-500" title="Eine neue Version entsteht erst beim Abschließen. Die abgeschlossene Version bleibt unverändert.">
            Korrektur offen – neue Version noch nicht abgeschlossen
          </span>
        ) : autoSave ? (
          <span className={`px-1 text-xs font-medium ${SS[saveStatus ?? "saved"].cls}`}>{SS[saveStatus ?? "saved"].label}</span>
        ) : (
          dirty ? <span className="px-1 text-xs text-amber-500">ungespeichert</span> : <span className="px-1 text-xs text-emerald-500">gespeichert</span>
        )}
        {autoSave && saveStatus === "error" && onRetry && (
          <button className="btn-ghost px-2 py-1 text-xs text-rose-500" onClick={onRetry}>Erneut versuchen</button>
        )}
        <button className="btn-outline px-3 py-1.5 text-sm" onClick={onPdf} title="PDF herunterladen">
          <FileDown size={15} /> <span className="hidden sm:inline">PDF</span>
        </button>
        {/* Speichern bleibt auch bei gesperrten Dokumenten möglich, damit geänderte Einstellungen
            (Kopf-/Stammdaten) in den LIVE-Datensatz übernommen werden. Positionen sind readOnly,
            der finalisierte Versions-Snapshot wird dabei NICHT verändert (nur finalize() schreibt ihn). */}
        {!autoSave && (
          <button className="btn-primary px-3 py-1.5 text-sm" onClick={onSave} disabled={saving}>
            <Save size={15} /> {saving ? "Speichert …" : "Speichern"}
          </button>
        )}
        {/* Abgeschlossen + unverändert: statt eines toten „Abschließen"-Buttons eine klare
            Senden-Aktion – versendet den bestehenden Stand OHNE neue Version/Snapshot. */}
        {readOnly && onResend ? (
          <button className="btn-primary px-3 py-1.5 text-sm" onClick={onResend}
            title="Versendet den abgeschlossenen Stand erneut – es entsteht KEINE neue Version.">
            <Send size={15} /> {resendLabel || "Erneut versenden"}
          </button>
        ) : (
          <button className="btn-outline px-3 py-1.5 text-sm" onClick={onFinalize} disabled={readOnly}>
            <CheckCircle2 size={15} /> Abschließen
          </button>
        )}
        {/* Drei-Punkte-Menü nur zeigen, wenn es tatsächlich Aktionen gibt (z.B. Löschen/Storno
            in Auftrag/Rechnung). Im Angebot ohne Aktionen entfällt der Button komplett – kein
            leerer Button, keine Layout-Lücke. */}
        {moreActions && moreActions.length > 0 && (
          <div className="relative" ref={moreRef}>
            <button className="btn-ghost px-2 py-1.5" title="Mehr" onClick={() => setMoreOpen((v) => !v)}>
              <MoreHorizontal size={16} />
            </button>
            {moreOpen && (
              <div className="absolute right-0 z-30 mt-1 w-48 rounded-xl border bg-[var(--card)] p-1 shadow-lg"
                style={{ borderColor: "var(--border)" }}>
                {moreActions.map((a, i) => (
                  <button key={i} disabled={a.disabled}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-[var(--hover)] disabled:opacity-40 ${a.danger ? "text-rose-500" : ""}`}
                    onClick={() => { setMoreOpen(false); a.onClick(); }}>
                    {a.icon}{a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TBtn({ icon, label, onClick, disabled, iconOnly, title }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; iconOnly?: boolean; title?: string;
}) {
  return (
    <button className="btn-ghost flex items-center gap-1.5 px-2 py-1.5 text-xs" onClick={onClick} disabled={disabled} title={title ?? label}>
      {icon}{!iconOnly && <span className="hidden lg:inline">{label}</span>}
    </button>
  );
}
