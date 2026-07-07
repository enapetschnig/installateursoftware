// ============================================================
// B4Y SuperAPP – Vorlagen (wiederverwendbare Positions-Sets)
// Aktuelles Dokument als Vorlage speichern oder Vorlage laden.
// Vorlagen sind nach frei wählbaren Kategorien gruppiert und durchsuchbar
// (Name, Kategorie, Dokumenttyp, Beschreibung, Positionsnamen). Migration 0124.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { LayoutTemplate, Trash2, Save, Search } from "lucide-react";
import { Modal, Spinner } from "../ui";
import { ErrorBanner } from "../calc-ui";
import { supabase } from "../../lib/supabase";
import { DocPosition, uid } from "../../lib/document-types";

type Template = {
  id: string;
  name: string;
  doc_type: string;
  category: string | null;
  description: string | null;
  items: DocPosition[];
  usage_count: number;
};

const DEFAULT_CATEGORY = "Standard";

/** Durchsuchbarer Text einer Vorlage (Name, Kategorie, Typ, Beschreibung, Positionsnamen). */
function templateHaystack(t: Template): string {
  const items = Array.isArray(t.items) ? t.items : [];
  const posText = items
    .map((i) => [i?.name, i?.description].filter(Boolean).join(" "))
    .join(" ");
  return [t.name, t.category, t.doc_type, t.description, posText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function TemplatesModal({
  docType, currentPositions, onLoad, onClose,
}: {
  docType: string;
  currentPositions: DocPosition[];
  onLoad: (positions: DocPosition[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    const { data, error } = await supabase.from("document_templates").select("*")
      .eq("active", true).order("usage_count", { ascending: false });
    if (error) setErr(error.message);
    setList((data as Template[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { reload(); /* eslint-disable-line */ }, []);

  // Vorhandene Kategorien als Vorschläge (freie Eingabe bleibt möglich).
  const existingCategories = useMemo(
    () => Array.from(new Set(list.map((t) => (t.category || "").trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "de-AT")),
    [list]
  );

  // Suche (clientseitig – Datenmenge klein) + Gruppierung nach Kategorie.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? list.filter((t) => templateHaystack(t).includes(q)) : list;
    const byCat = new Map<string, Template[]>();
    for (const t of filtered) {
      const cat = (t.category || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY;
      (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(t);
    }
    return Array.from(byCat.entries())
      // "Standard" zuerst, dann alphabetisch.
      .sort(([a], [b]) => (a === DEFAULT_CATEGORY ? -1 : b === DEFAULT_CATEGORY ? 1 : a.localeCompare(b, "de-AT")))
      .map(([cat, rows]) => ({ cat, rows }));
  }, [list, search]);

  const totalFiltered = groups.reduce((n, g) => n + g.rows.length, 0);

  async function saveTemplate() {
    if (!name.trim()) { setErr("Name erforderlich."); return; }
    if (currentPositions.length === 0) { setErr("Keine Positionen zum Speichern."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from("document_templates").insert({
      name: name.trim(),
      doc_type: docType,
      category: category.trim() || DEFAULT_CATEGORY,
      description: description.trim() || null,
      items: currentPositions,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setName(""); setDescription(""); reload();
  }

  function loadTemplate(t: Template) {
    // Neue lokale IDs; Gliederung wird beim Einfügen automatisch neu berechnet.
    const items = (Array.isArray(t.items) ? t.items : []).map((i) => ({
      ...i, id: uid(), parent_title_id: null, number: null,
    }));
    supabase.from("document_templates").update({ usage_count: (t.usage_count || 0) + 1 }).eq("id", t.id).then(() => {});
    onLoad(items);
    onClose();
  }

  async function deleteTemplate(id: string) {
    await supabase.from("document_templates").update({ active: false }).eq("id", id);
    reload();
  }

  return (
    <Modal open onClose={onClose} title="Vorlagen">
      <ErrorBanner message={err} />

      {/* Speichern: Name + frei wählbare/neue Kategorie + optionale Beschreibung */}
      <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>
        <label className="sm:col-span-2">
          <span className="label">Aktuelles Dokument als Vorlage speichern</span>
          <input className="input" placeholder="Vorlagenname …" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="label">Kategorie</span>
          <input className="input" list="template-category-list" placeholder="Standard" value={category}
            onChange={(e) => setCategory(e.target.value)} />
          <datalist id="template-category-list">
            {existingCategories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label>
          <span className="label">Beschreibung (optional)</span>
          <input className="input" placeholder="kurze Beschreibung …" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="sm:col-span-2 flex justify-end">
          <button className="btn-primary" onClick={saveTemplate} disabled={busy}><Save size={15} /> Speichern</button>
        </div>
      </div>

      {/* Suche über Name, Kategorie, Typ, Beschreibung und Positionsnamen */}
      <div className="relative mb-3">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Vorlagen durchsuchen …" value={search}
          onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="max-h-80 space-y-3 overflow-y-auto">
        {loading ? <Spinner /> : list.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">Noch keine Vorlagen.</div>
        ) : totalFiltered === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">Keine Vorlage passt zur Suche.</div>
        ) : groups.map((g) => (
          <div key={g.cat}>
            <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.cat}</div>
            <div className="space-y-2">
              {g.rows.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                  <LayoutTemplate size={16} className="shrink-0 text-[var(--accent)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{t.name}</div>
                    {t.description && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{t.description}</div>}
                    <div className="text-xs text-slate-400">
                      {Array.isArray(t.items) ? t.items.length : 0} Positionen · {t.doc_type}{t.usage_count ? ` · ${t.usage_count}x` : ""}
                    </div>
                  </div>
                  <button className="btn-outline px-2 py-1 text-xs" onClick={() => loadTemplate(t)}>Einfügen</button>
                  <button className="btn-ghost px-1.5 text-rose-500" title="Löschen" onClick={() => deleteTemplate(t.id)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><button className="btn-outline" onClick={onClose}>Schließen</button></div>
    </Modal>
  );
}
