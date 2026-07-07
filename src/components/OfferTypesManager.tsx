import { useEffect, useState } from "react";
import { Layers, Plus, Pencil, Trash2, Info, GripVertical, Lock } from "lucide-react";
import { Spinner, Modal } from "./ui";
import { Toggle, ErrorBanner, ConfirmDialog } from "./calc-ui";
import { DISPLAY_FIELDS, OfferDisplay } from "../lib/offer-display";
import { OfferType, loadOfferTypes, saveOfferType, deleteOfferType, emptyOfferType, variantLabel, PROTECTED_OFFER_TYPE_MSG } from "../lib/offer-kinds";

export default function OfferTypesManager({ canManage = true }: { canManage?: boolean }) {
  const [types, setTypes] = useState<OfferType[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<OfferType | null>(null);
  const [del, setDel] = useState<OfferType | null>(null);
  const [busy, setBusy] = useState(false);

  function openEdit(t: OfferType | null) {
    if (!t) { setEdit(emptyOfferType(types.length + 1)); return; }
    setEdit({ ...t, display: { ...t.display } });
  }

  async function load() {
    setLoading(true); setErr(null);
    try {
      setTypes(await loadOfferTypes(false));
    } catch (e: any) { setErr(e?.message ?? "Fehler"); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!edit) return;
    if (!edit.name.trim()) { setErr("Bitte eine Bezeichnung angeben."); return; }
    const slug = (edit.slug || edit.name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    setBusy(true); setErr(null);
    const { error } = await saveOfferType({ ...edit, slug });
    setBusy(false);
    if (error) { setErr(error); return; }
    setEdit(null); load();
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    const { error } = await deleteOfferType(del.id);
    setBusy(false);
    if (error) setErr(error); else { setDel(null); load(); }
  }

  if (loading) return <div className="glass p-4"><Spinner /></div>;

  return (
    <div className="glass p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><Layers size={18} /> Dokumentvarianten & Texte</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Je Variante (z.&nbsp;B. Standard, Pauschal, Regie) eigene PDF-Darstellung, Bezeichnungen und Texte – durchgängig für Angebot, Auftrag und Rechnung.</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => openEdit(null)}><Plus size={16} /> Neuer Typ</button>
        )}
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-400/40 bg-blue-400/10 p-3 text-sm text-blue-700 dark:text-blue-300">
        <Info size={16} className="mt-0.5 shrink-0" />
        Beim Anlegen eines Dokuments werden Texte und Darstellung der gewählten Variante als Snapshot übernommen. Spätere Änderungen hier verändern bestehende (v.&nbsp;a. finalisierte/abgeschlossene) Dokumente nicht.
      </div>

      <ErrorBanner message={err} />

      {types.length === 0 ? (
        <p className="text-sm text-slate-400">Noch keine Dokumentvarianten.</p>
      ) : (
        <div className="space-y-5">
          {/* Nach Dokumentart gruppiert. Eine Datenquelle (Varianten-Familie) – je Stufe
              wird die passende Bezeichnung gezeigt (Angebot / Auftrag / Rechnung).
              „Bearbeiten" öffnet immer denselben Variant-Editor (alle Stufen). */}
          {([
            { key: "angebot", label: "Angebote", noun: "angebot", canDelete: true },
            { key: "auftrag", label: "Aufträge", noun: "auftrag", canDelete: false },
            { key: "rechnung", label: "Rechnungen", noun: "rechnung", canDelete: false },
            { key: "nachtrag", label: "Angebot Nachtrag", noun: "nachtrag", canDelete: false },
            { key: "auftrag_sub", label: "Auftrag SUB", noun: "auftrag_sub", canDelete: false },
          ] as const).map((stage) => (
            <div key={stage.key}>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{stage.label}</div>
              <div className="space-y-2">
                {types.map((t) => (
                  <div key={`${stage.key}-${t.id}`} className="flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex min-w-0 items-center gap-3">
                      <GripVertical size={16} className="shrink-0 text-slate-300" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Folge-Bezeichnung automatisch & zentral aus Dokumentart + Variante. */}
                          <span className="font-semibold">{variantLabel(stage.noun, t)}</span>
                          <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Variante: {t.name}</span>
                          {t.is_system && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-400/20 dark:text-amber-300" title={PROTECTED_OFFER_TYPE_MSG}>
                              <Lock size={11} /> geschützt
                            </span>
                          )}
                          {!t.is_active && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-400/20 dark:text-amber-300">inaktiv</span>}
                        </div>
                        {stage.key === "angebot" && t.description && <div className="truncate text-xs text-slate-400">{t.description}</div>}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1">
                        <button className="btn-ghost px-2" title="Variante bearbeiten (alle Stufen)" onClick={() => openEdit(t)}><Pencil size={16} /></button>
                        {stage.canDelete && !t.is_system && (
                          <button className="btn-ghost px-2 text-rose-500" title="Variante löschen" onClick={() => setDel(t)}><Trash2 size={16} /></button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Dokumentvariante bearbeiten" : "Neue Dokumentvariante"} size="xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">Bezeichnung der Variante</label>
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="z.B. Standard, Pauschal, Regie" /></div>
            <div><label className="label">PDF-Überschrift Angebot</label>
              <input className="input" value={edit.pdf_label} onChange={(e) => setEdit({ ...edit, pdf_label: e.target.value })} placeholder="z.B. Angebot / Pauschalangebot" /></div>
            <div className="sm:col-span-2"><label className="label">Beschreibung</label>
              <input className="input" value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            <div className="sm:col-span-2 mt-1">
              <div className="text-sm font-bold">Standardtexte dieser Variante</div>
              <p className="text-xs text-slate-400">Werden im Angebot als Standard vorgeschlagen und als Basis für die Folgedokumente verwendet. Im Dokument jederzeit überschreibbar.</p>
            </div>
            <div className="sm:col-span-2"><label className="label">Standard-Einleitungstext</label>
              <textarea className="input min-h-[70px]" value={edit.intro_text ?? ""} onChange={(e) => setEdit({ ...edit, intro_text: e.target.value })}
                placeholder="z.B. Gerne übermitteln wir Ihnen unser Angebot …" /></div>
            <div className="sm:col-span-2"><label className="label">Standard-Abschlusstext / Nachtext</label>
              <textarea className="input min-h-[110px]" value={edit.closing_text ?? ""} onChange={(e) => setEdit({ ...edit, closing_text: e.target.value })}
                placeholder="z.B. Preise gültig für 3 Monate …" /></div>
            <div className="sm:col-span-2"><label className="label">Fußzeilen-Zusatztext (PDF)</label>
              <input className="input" value={edit.footer_text ?? ""} onChange={(e) => setEdit({ ...edit, footer_text: e.target.value })}
                placeholder="z.B. Vielen Dank für Ihr Vertrauen" />
              <p className="mt-1 text-xs text-slate-400">Erscheint zusätzlich in der PDF-Fußzeile dieser Variante. Firmenstammdaten (Name, Adresse, UID, Bank …) kommen weiterhin zentral aus den Firmeneinstellungen.</p></div>
          </div>

          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-sm font-bold">PDF-Darstellung dieser Variante</div>
            <p className="mb-2 text-xs text-slate-400">Gilt durchgängig für Angebot, Auftrag und Rechnung dieser Variante (wird beim Anlegen je Dokument als Snapshot übernommen).</p>
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {DISPLAY_FIELDS.map((f) => (
                <Toggle key={f.key} checked={edit.display[f.key]}
                  onChange={(v) => setEdit({ ...edit, display: { ...edit.display, [f.key]: v } as OfferDisplay })} label={f.label} />
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">Reihenfolge in Auswahlmenüs</label>
              <input className="input" type="number" value={edit.sort_order}
                onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) || 0 })} />
              <p className="mt-1 text-xs text-slate-400">Bestimmt die Reihenfolge dieser Variante in Auswahlmenüs.</p></div>
            <div className="flex items-end">
              <Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Aktiv (im Editor auswählbar)" />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEdit(null)}>Abbrechen</button>
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
          </div>
        </Modal>
      )}

      <ConfirmDialog open={!!del} title="Dokumentvariante löschen?"
        message={<>Soll die Variante <b>{del?.name}</b> gelöscht werden? Bestehende Dokumente behalten ihren Snapshot.</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </div>
  );
}
