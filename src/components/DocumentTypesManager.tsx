import { useEffect, useState } from "react";
import { Plus, Pencil, Power, Trash2, FileStack, Lock } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "./ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "./calc-ui";
import { DocumentType, loadDocumentTypes } from "../lib/documents";
import { SortHeader } from "./SortHeader";
import { useTableSort } from "../lib/useTableSort";
import { useAuth } from "../lib/auth";

// Einheitlicher Aktions-Icon-Slot: feste Größe (32px), zentriert – sorgt für
// exakt bündige Icon-Spalten in jeder Zeile (Power/Stift/Papierkorb bzw. Schloss).
const ACT_BTN =
  "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent";

const slugify = (s: string) =>
  s.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// Sinnvolle Vorbelegung der Funktions-/Zugehörigkeits-/Compliance-Schalter je Dokumentstruktur.
// Wird NUR beim Wechsel der Struktur angewandt (danach sind manuelle Änderungen frei).
// is_system-Typen sind ohnehin fest auf 'positions' gesperrt und rufen den Preset nie auf.
type StructureFlags = Partial<{
  allow_upload: boolean; allow_create: boolean;
  belongs_to_project: boolean; belongs_to_customer: boolean;
  is_accounting_relevant: boolean; is_tax_relevant: boolean;
  versioning_enabled: boolean; finalization_required: boolean;
  lock_finalized_versions: boolean; create_pdf_snapshot_on_finalize: boolean; audit_log_enabled: boolean;
}>;
const STRUCTURE_PRESETS: Record<string, StructureFlags> = {
  // Leistungstabelle/Kalkulation (Angebot/Auftrag/Rechnung-artig): voll versioniert & abschließbar.
  positions: {
    allow_upload: true, allow_create: true,
    belongs_to_project: true, belongs_to_customer: true,
    versioning_enabled: true, finalization_required: true,
    lock_finalized_versions: true, create_pdf_snapshot_on_finalize: true, audit_log_enabled: true,
  },
  // Brief/Anschreiben: versioniert & auditierbar, aber nicht buchungs-/steuerrelevant.
  text: {
    allow_upload: true, allow_create: true, belongs_to_project: true,
    is_accounting_relevant: false, is_tax_relevant: false,
    versioning_enabled: true, finalization_required: false,
    lock_finalized_versions: false, create_pdf_snapshot_on_finalize: true, audit_log_enabled: true,
  },
  // Formular/Bericht: erstellbar (Editor vorhanden), versioniert & auditierbar.
  form: {
    allow_upload: true, allow_create: true, belongs_to_project: true,
    versioning_enabled: true, finalization_required: false,
    lock_finalized_versions: false, create_pdf_snapshot_on_finalize: true, audit_log_enabled: true,
  },
  // Reine Dateiablage: nur Upload, kein Erstellen, keine Positions-/Texteditor-Logik.
  upload_only: {
    allow_upload: true, allow_create: false,
    versioning_enabled: false, finalization_required: false,
    lock_finalized_versions: false, create_pdf_snapshot_on_finalize: false, audit_log_enabled: false,
  },
};

// Zugehörigkeits-Flags für die Übersicht (Reihenfolge wie im Bearbeiten-Dialog)
const ZUGEH_FIELDS: { key: keyof DocumentType; label: string }[] = [
  { key: "belongs_to_project", label: "Projekt" },
  { key: "belongs_to_customer", label: "Kunde" },
  { key: "belongs_to_employee", label: "Mitarbeiter" },
  { key: "belongs_to_supplier", label: "Lieferant" },
  { key: "belongs_to_subcontractor", label: "Subunternehmer" },
];

export default function DocumentTypesManager({ canManage = true }: { canManage?: boolean }) {
  const [list, setList] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<DocumentType | "new" | null>(null);
  const [del, setDel] = useState<DocumentType | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setList(await loadDocumentTypes(false)); }
    catch (e: any) { setErr(e?.message ?? "Fehler beim Laden."); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const nextSort = list.length ? Math.max(...list.map((r) => r.sort_order)) + 10 : 10;

  async function toggleActive(t: DocumentType) {
    if (!canManage) return;
    const { error } = await supabase.from("document_types").update({ is_active: !t.is_active }).eq("id", t.id);
    if (error) setErr(error.message); else load();
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null); setNotice(null);
    // Geschützte Systemtypen: nie löschen (zusätzlich DB-Trigger). Deaktivieren bleibt möglich (Power).
    if (del.is_system) {
      setBusy(false);
      setErr(`„${del.name}" ist ein geschützter Standard-Dokumenttyp und kann nicht gelöscht werden. Er kann nur deaktiviert werden.`);
      setDel(null); return;
    }
    // Sind Dokumente verknüpft? Dann NICHT löschen (Daten + Liste sollen erhalten bleiben),
    // sondern den Typ deaktivieren: bestehende Dokumente bleiben sichtbar & filterbar,
    // der Typ wird nur nicht mehr für neue Dokumente angeboten.
    const { count } = await supabase.from("documents").select("id", { count: "exact", head: true }).eq("document_type_id", del.id);
    if ((count ?? 0) > 0) {
      const { error } = await supabase.from("document_types").update({ is_active: false }).eq("id", del.id);
      setBusy(false);
      if (error) { setErr(error.message); return; }
      setNotice(`„${del.name}" hat ${count} verknüpfte Dokument(e) und wurde daher nicht gelöscht, sondern deaktiviert. Die Dokumente und ihre Liste bleiben erhalten; der Typ wird nur nicht mehr für neue Dokumente angeboten.`);
      setDel(null); load(); return;
    }
    // Kein Dokument verknüpft → echte Löschung möglich.
    const { error } = await supabase.from("document_types").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); }
  }

  // Nach Kategorie gruppieren
  const cats = Array.from(new Set(list.map((t) => t.category || "Sonstige")));

  // Sortierung wirkt INNERHALB jeder Kategorie-Gruppe (Gruppen bleiben bestehen).
  const { session } = useAuth();
  const typeSort = useTableSort<DocumentType>(
    "document_types",
    {
      nr: { get: (t) => t.sort_order, type: "number" },
      name: { get: (t) => t.name, type: "text" },
      slug: { get: (t) => t.slug, type: "text" },
      upload: { get: (t) => (t.allow_upload ? 0 : 1), type: "number" },
      create: { get: (t) => (t.allow_create ? 0 : 1), type: "number" },
      status: { get: (t) => (t.is_active ? 0 : 1), type: "number" },
    },
    { userId: session?.user?.id ?? null, default: { key: "nr", dir: "asc" } }
  );

  return (
    <div className="glass p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><FileStack size={18} /> Dokumentarten</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Zentrale Verwaltung aller Dokumentarten. Nur vorhandene Arten erscheinen später als Ordner im Projekt.
          </p>
        </div>
        {canManage && <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Dokumentart</button>}
      </div>

      <ErrorBanner message={err} />
      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <span>{notice}</span>
          <button className="ml-auto shrink-0 opacity-70 hover:opacity-100" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Dokumentarten" hint="Lege Dokumentarten an, um Uploads und Dokumente sauber zu strukturieren." />
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
          {/* Eine Tabelle mit fixem Spaltenraster (colgroup) – Spalten stehen über
              alle Gruppen hinweg exakt untereinander. Kopf nur einmal (Variante A). */}
          <table className="w-full text-sm" style={{ tableLayout: "fixed", minWidth: 1180 }}>
            <colgroup>
              <col style={{ width: 70 }} />
              <col />
              <col />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
            </colgroup>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Nr." sortKey="nr" sort={typeSort.sort} onSort={typeSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Bezeichnung" sortKey="name" sort={typeSort.sort} onSort={typeSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Slug" sortKey="slug" sort={typeSort.sort} onSort={typeSort.onSort} padClass="px-3 py-2" />
                <SortHeader label="Hochladen" sortKey="upload" sort={typeSort.sort} onSort={typeSort.onSort} align="center" padClass="px-3 py-2" />
                <SortHeader label="Erstellen" sortKey="create" sort={typeSort.sort} onSort={typeSort.onSort} align="center" padClass="px-3 py-2" />
                <th className="px-3 py-2">Zugehörigkeit</th>
                <SortHeader label="Status" sortKey="status" sort={typeSort.sort} onSort={typeSort.onSort} padClass="px-3 py-2" />
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            {cats.map((cat) => (
              <tbody key={cat} className="divide-y divide-slate-100 dark:divide-white/5">
                <tr>
                  <td colSpan={8} className="border-t bg-slate-50/60 px-3 pb-1.5 pt-3 text-xs font-bold uppercase tracking-wide text-slate-400 dark:bg-white/5" style={{ borderColor: "var(--border)" }}>{cat}</td>
                </tr>
                {typeSort.sortRows(list.filter((t) => (t.category || "Sonstige") === cat)).map((t) => (
                  <tr
                    key={t.id}
                    className={`hover:bg-slate-50 dark:hover:bg-white/5 ${canManage ? "cursor-pointer" : ""}`}
                    onClick={canManage ? () => setEdit(t) : undefined}
                  >
                    <td className="px-3 py-2 tabular-nums text-slate-400">{t.sort_order}</td>
                    <td className="px-3 py-2 font-medium"><div className="truncate">{t.name}</div></td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400"><div className="truncate">{t.slug}</div></td>
                    <td className="px-3 py-2 text-center">{t.allow_upload ? "✓" : "–"}</td>
                    <td className="px-3 py-2 text-center">{t.allow_create ? "✓" : "–"}</td>
                    <td className="px-3 py-2">
                      {ZUGEH_FIELDS.some((z) => t[z.key]) ? (
                        <div className="flex flex-wrap gap-1">
                          {ZUGEH_FIELDS.filter((z) => t[z.key]).map((z) => (
                            <span key={z.key} className="rounded-md px-1.5 py-0.5 text-[11px] font-medium" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{z.label}</span>
                          ))}
                        </div>
                      ) : <span className="text-slate-400">–</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {t.is_active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}
                        {t.is_system && <Badge tone="blue">System</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {/* Einheitlich breite Aktions-Slots (je 32px) – Icons stehen in allen
                          Zeilen exakt untereinander; das Schloss belegt denselben Slot wie der
                          Papierkorb (geschützte Typen). */}
                      <div className="flex justify-end gap-1">
                        <button className={ACT_BTN} title={t.is_active ? "Deaktivieren" : "Aktivieren"} disabled={!canManage} onClick={() => toggleActive(t)}><Power size={16} /></button>
                        <button className={ACT_BTN} title="Bearbeiten" disabled={!canManage} onClick={() => setEdit(t)}><Pencil size={16} /></button>
                        {t.is_system
                          ? <span className={`${ACT_BTN} cursor-default text-slate-400`} title="Geschützte Dokumentart – kann nicht gelöscht werden."><Lock size={16} /></span>
                          : <button className={`${ACT_BTN} text-rose-500`} title="Löschen" disabled={!canManage} onClick={() => setDel(t)}><Trash2 size={16} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {edit && <TypeForm row={edit === "new" ? null : edit} nextSort={nextSort}
        categories={Array.from(new Set(list.map((t) => (t.category || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      <ConfirmDialog open={!!del} title="Dokumentart löschen?" message={<>Soll <b>{del?.name}</b> gelöscht werden? Sind bereits Dokumente verknüpft, wird der Typ <b>nicht gelöscht, sondern deaktiviert</b> – die Dokumente und ihre Liste bleiben erhalten, der Typ wird nur nicht mehr für neue Dokumente angeboten.</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </div>
  );
}

function TypeForm({ row, nextSort, categories, onClose, onSaved }: {
  row: DocumentType | null; nextSort: number; categories: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: row?.name ?? "", slug: row?.slug ?? "", category: row?.category ?? "",
    sort_order: row?.sort_order ?? nextSort, is_active: row?.is_active ?? true,
    allow_upload: row?.allow_upload ?? true, allow_create: row?.allow_create ?? false,
    document_structure: (row?.document_structure as string) ?? "upload_only",
    belongs_to_project: row?.belongs_to_project ?? true,
    belongs_to_customer: row?.belongs_to_customer ?? false,
    belongs_to_employee: row?.belongs_to_employee ?? false,
    belongs_to_supplier: row?.belongs_to_supplier ?? false,
    belongs_to_subcontractor: row?.belongs_to_subcontractor ?? false,
    // Versionierung & Compliance
    is_accounting_relevant: row?.is_accounting_relevant ?? false,
    is_tax_relevant: row?.is_tax_relevant ?? false,
    versioning_enabled: row?.versioning_enabled ?? false,
    finalization_required: row?.finalization_required ?? false,
    lock_finalized_versions: row?.lock_finalized_versions ?? false,
    create_pdf_snapshot_on_finalize: row?.create_pdf_snapshot_on_finalize ?? false,
    audit_log_enabled: row?.audit_log_enabled ?? false,
    slugTouched: !!row,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  // Strukturwechsel: passende Voreinstellungen mitsetzen (danach manuell frei anpassbar).
  const applyStructure = (structure: string) =>
    setF((p) => ({ ...p, document_structure: structure, ...(STRUCTURE_PRESETS[structure] ?? {}) }));

  // Buchungs-/steuerrelevant ⇒ Versionierung & Compliance verpflichtend (gesperrt)
  const compliance = f.is_accounting_relevant || f.is_tax_relevant;
  // Geschützte Systemtypen brauchen ebenfalls nachvollziehbare abgeschlossene Stände:
  // Versionierung/Abschluss/Snapshot/Sperre sind dann verpflichtend (gesperrt).
  const isSystem = !!row?.is_system;
  const versioningLocked = compliance || isSystem;
  function setComplianceFlag(k: "is_accounting_relevant" | "is_tax_relevant", v: boolean) {
    if (v) {
      setF((p) => ({
        ...p, [k]: true,
        versioning_enabled: true, finalization_required: true, lock_finalized_versions: true,
        create_pdf_snapshot_on_finalize: true, audit_log_enabled: true,
      }));
    } else {
      const other = k === "is_accounting_relevant" ? f.is_tax_relevant : f.is_accounting_relevant;
      if (!other && !window.confirm(
        "Achtung: Bei buchungs- oder steuerrelevanten Dokumenten ist die Versionierung verpflichtend. " +
        "Wirklich deaktivieren? Damit gehen verpflichtende Compliance-Einstellungen verloren.")) return;
      setF((p) => ({ ...p, [k]: false }));
    }
  }

  async function save() {
    setErr(null);
    if (!f.name.trim()) { setErr("Bitte eine Bezeichnung eingeben."); return; }
    const slug = (f.slug || slugify(f.name)).trim();
    if (!slug) { setErr("Bitte einen gültigen Slug eingeben."); return; }
    // Kategorie bereinigen + Dedupe: gibt es bereits (case-insensitive) dieselbe
    // Kategorie, deren vorhandene Schreibweise übernehmen (keine Dubletten).
    const catRaw = f.category.trim();
    const catExisting = categories.find((c) => c.toLowerCase() === catRaw.toLowerCase());
    const category = (catExisting || catRaw) || null;
    setBusy(true);
    const payload = {
      name: f.name.trim(), slug, category,
      sort_order: Number(f.sort_order) || 0, is_active: f.is_active,
      allow_upload: f.allow_upload, allow_create: f.allow_create,
      // is_system-Typen bleiben immer positions (Schutz – zusätzlich zur UI-Sperre).
      document_structure: isSystem ? "positions" : f.document_structure,
      belongs_to_project: f.belongs_to_project, belongs_to_customer: f.belongs_to_customer,
      belongs_to_employee: f.belongs_to_employee, belongs_to_supplier: f.belongs_to_supplier,
      belongs_to_subcontractor: f.belongs_to_subcontractor,
      // Versionierung & Compliance – bei buchungs-/steuerrelevant sind die Folge-Flags Pflicht
      // (zusätzlich DB-seitig per Trigger erzwungen).
      is_accounting_relevant: f.is_accounting_relevant,
      is_tax_relevant: f.is_tax_relevant,
      versioning_enabled: versioningLocked || f.versioning_enabled,
      versioning_required: compliance,
      finalization_required: versioningLocked || f.finalization_required,
      lock_finalized_versions: versioningLocked || f.lock_finalized_versions,
      create_pdf_snapshot_on_finalize: versioningLocked || f.create_pdf_snapshot_on_finalize,
      audit_log_enabled: compliance || f.audit_log_enabled,
    };
    const res = row
      ? await supabase.from("document_types").update(payload).eq("id", row.id)
      : await supabase.from("document_types").insert(payload);
    setBusy(false);
    if (res.error) { setErr(/unique|duplicate/i.test(res.error.message) ? "Dieser Slug ist bereits vergeben." : res.error.message); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={row ? "Dokumentart bearbeiten" : "Neue Dokumentart"} size="xl">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className="label label-req">Bezeichnung</label>
          <input className="input" value={f.name}
            onChange={(e) => setF((p) => ({ ...p, name: e.target.value, slug: p.slugTouched ? p.slug : slugify(e.target.value) }))} placeholder="z.B. Pläne" /></div>
        <div><label className="label">Slug (technisch)</label>
          <input className="input font-mono" value={f.slug} disabled={!!row?.is_system}
            onChange={(e) => setF((p) => ({ ...p, slug: slugify(e.target.value), slugTouched: true }))} />
          {row?.is_system
            ? <p className="mt-1 text-xs text-slate-400">Geschützter Systemtyp – Slug ist gesperrt.</p>
            : <p className="mt-1 text-xs text-slate-400">Technischer Schlüssel für die App. Wird automatisch aus der Bezeichnung erzeugt.</p>}</div>
        <div><label className="label">Kategorie</label>
          <input className="input" list="doctype-category-list" value={f.category}
            onChange={(e) => set("category", e.target.value)} placeholder="Bestehende wählen oder neue eingeben …" />
          <datalist id="doctype-category-list">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          <p className="mt-1 text-xs text-slate-400">Bestehende Kategorie wählen oder neue eingeben – sie gruppiert die Dokumentarten in der Liste.</p></div>
        <div><label className="label">Sortierreihenfolge</label>
          <input type="number" className="input" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} /></div>
        <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Funktionen</div>
        <div className="sm:col-span-2"><label className="label">Dokumentstruktur</label>
          <select className="input" value={isSystem ? "positions" : f.document_structure} disabled={isSystem}
            onChange={(e) => applyStructure(e.target.value)}>
            <option value="positions">Mit Leistungstabelle / Kalkulation</option>
            <option value="text">Reines Textdokument (Brief/Anschreiben)</option>
            <option value="form">Formular / Bericht</option>
            <option value="upload_only">Nur Upload / Ablage</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">
            {isSystem
              ? "Standard-/Systemdokument – Struktur fest auf „Mit Leistungstabelle“ (nicht änderbar)."
              : "Bestimmt, wie das Dokument erstellt/bearbeitet wird: Tabelle, Textdokument, Formular oder nur Dateiablage. Beim Wechsel werden passende Voreinstellungen gesetzt – danach frei anpassbar."}
          </p></div>
        <div className="flex items-center"><Toggle checked={f.allow_upload} onChange={(v) => set("allow_upload", v)} label="Hochladen erlaubt" /></div>
        <div className="flex items-center"><Toggle checked={f.allow_create} onChange={(v) => set("allow_create", v)} label="Erstellen erlaubt" /></div>
        <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Zugehörigkeit</div>
        <div className="flex items-center"><Toggle checked={f.belongs_to_project} onChange={(v) => set("belongs_to_project", v)} label="Projekt" /></div>
        <div className="flex items-center"><Toggle checked={f.belongs_to_customer} onChange={(v) => set("belongs_to_customer", v)} label="Kunde" /></div>
        <div className="flex items-center"><Toggle checked={f.belongs_to_employee} onChange={(v) => set("belongs_to_employee", v)} label="Mitarbeiter" /></div>
        <div className="flex items-center"><Toggle checked={f.belongs_to_supplier} onChange={(v) => set("belongs_to_supplier", v)} label="Lieferant" /></div>
        <div className="flex items-center"><Toggle checked={f.belongs_to_subcontractor} onChange={(v) => set("belongs_to_subcontractor", v)} label="Subunternehmer" /></div>

        <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Versionierung &amp; Compliance</div>
        <div className="flex items-center"><Toggle checked={f.is_accounting_relevant} onChange={(v) => setComplianceFlag("is_accounting_relevant", v)} label="Buchungsrelevant" /></div>
        <div className="flex items-center"><Toggle checked={f.is_tax_relevant} onChange={(v) => setComplianceFlag("is_tax_relevant", v)} label="Steuerrelevant" /></div>
        {versioningLocked && (
          <div className="sm:col-span-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {compliance
              ? "Bei buchungs- oder steuerrelevanten Dokumenten ist die Versionierung verpflichtend, damit abgeschlossene Dokumentstände nachvollziehbar erhalten bleiben."
              : "Für diese geschützte Dokumentart wird Versionierung verwendet, damit abgeschlossene Dokumentstände nachvollziehbar erhalten bleiben."}
          </div>
        )}
        <CompToggle label="Versionierung aktiv" k="versioning_enabled" f={f} set={set} locked={versioningLocked} />
        <CompToggle label="Abschluss erforderlich" k="finalization_required" f={f} set={set} locked={versioningLocked} />
        <CompToggle label="Abgeschlossene Version sperren" k="lock_finalized_versions" f={f} set={set} locked={versioningLocked} />
        <CompToggle label="PDF-Snapshot beim Abschluss speichern" k="create_pdf_snapshot_on_finalize" f={f} set={set} locked={versioningLocked} />
        <CompToggle label="Änderungsprotokoll aktiv" k="audit_log_enabled" f={f} set={set} locked={compliance} />

        <div className="flex items-center pb-1"><Toggle checked={f.is_active} onChange={(v) => set("is_active", v)} label="Aktiv" /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}

// Toggle für Versionierungs-/Compliance-Optionen.
// Bei buchungs-/steuerrelevanten Dokumenttypen (locked) ist die Option erzwungen aktiv + gesperrt.
function CompToggle({ label, k, f, set, locked }: {
  label: string; k: string; f: any; set: (key: any, v: any) => void; locked: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Toggle checked={locked ? true : !!f[k]} disabled={locked} onChange={(v) => set(k, v)} label={label} />
      {locked && (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Pflicht</span>
      )}
    </div>
  );
}
