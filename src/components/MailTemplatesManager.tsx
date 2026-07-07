import { useRef, useEffect, useState } from "react";
import {
  Plus, Pencil, Copy, Trash2, Power, Search, Mail,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Empty, Badge, Modal } from "./ui";
import { Toggle, ConfirmDialog, ErrorBanner } from "./calc-ui";
import {
  MailTemplate, MAIL_COLUMNS, MAIL_PLACEHOLDER_CATALOG,
  MAIL_CATEGORIES, MAIL_TRIGGERS, DOC_VARIANTS,
  categoryLabel, triggerLabel, triggersForDocType,
} from "../lib/mail-templates";
import { loadDocumentTypes, NATIVE_SLUGS } from "../lib/documents";
import RichTextEditor from "./RichTextEditor";
import PlaceholderMenu from "./PlaceholderMenu";
import { SortHeader } from "./SortHeader";
import { useTableSort } from "../lib/useTableSort";
import { useAuth } from "../lib/auth";

// Auswählbare Dokumentarten: geschützte Grund-Typen + benutzerdef. Dokumentarten des Mandanten.
type DocTypeOption = { slug: string; id: string | null; name: string };
const NATIVE_DOC_OPTIONS: DocTypeOption[] = [
  { slug: "angebote", id: null, name: "Angebot" },
  { slug: "auftraege", id: null, name: "Auftrag" },
  { slug: "rechnungen", id: null, name: "Rechnung" },
];
const docTypeName = (opts: DocTypeOption[], slug: string | null): string =>
  slug ? (opts.find((o) => o.slug === slug)?.name ?? slug) : "";

// Legacy-Kontext (Spalte context ist NOT NULL) aus neuer Zuordnung ableiten.
function deriveContext(category: string, slug: string | null, trigger: string | null): string {
  if (slug === "angebote") return "angebot";
  if (slug === "auftraege") return "auftrag";
  if (slug === "rechnungen") return (trigger === "mahnung" || trigger === "letzte_mahnung" || trigger === "zahlungserinnerung") ? "mahnung" : "rechnung";
  if (category === "dokument") return "dokument";
  if (category === "termin") return "termin";
  if (category === "subunternehmer") return "subunternehmer";
  if (category === "lieferant") return "lieferant";
  if (category === "projekt") return "projekt";
  return "allgemein";
}

const stripHtml = (html: string) =>
  (html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export default function MailTemplatesManager({ canManage = true }: { canManage?: boolean }) {
  const [list, setList] = useState<MailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("");       // Bereich/Dokumentart-Filter (Kategorie ODER doctype-slug)
  const [fTrigger, setFTrigger] = useState("");
  const [fStatus, setFStatus] = useState<"" | "active" | "inactive">("active");
  const [edit, setEdit] = useState<MailTemplate | "new" | null>(null);
  const [del, setDel] = useState<MailTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [docTypeOpts, setDocTypeOpts] = useState<DocTypeOption[]>(NATIVE_DOC_OPTIONS);

  async function load() {
    setLoading(true);
    const [tpl, types] = await Promise.all([
      supabase.from("mail_templates").select(MAIL_COLUMNS).order("sort_order").order("name"),
      loadDocumentTypes(false).catch(() => [] as any[]),
    ]);
    if (tpl.error) setErr(tpl.error.message);
    setList((tpl.data as unknown as MailTemplate[]) ?? []);
    // Grund-Typen + benutzerdefinierte Dokumentarten (ohne Duplikate der Native-Slugs)
    const custom = (types as any[])
      .filter((t) => !(NATIVE_SLUGS as readonly string[]).includes(t.slug))
      .map((t) => ({ slug: t.slug as string, id: t.id as string, name: t.name as string }));
    setDocTypeOpts([...NATIVE_DOC_OPTIONS, ...custom]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const nextSort = list.length ? Math.max(...list.map((r) => r.sort_order)) + 10 : 10;
  const shown = list.filter((r) => {
    // fCat matcht entweder die Kategorie ODER eine Dokumentart (slug)
    if (fCat && r.category !== fCat && r.document_type_slug !== fCat) return false;
    if (fTrigger && r.trigger_action !== fTrigger) return false;
    if (fStatus === "active" && !r.active) return false;
    if (fStatus === "inactive" && r.active) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return [r.name, r.subject, stripHtml(r.body_html), r.description]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
  });

  const { session } = useAuth();
  const tplSort = useTableSort<MailTemplate>(
    "mail_templates",
    {
      name: { get: (r) => r.name, type: "text" },
      docType: { get: (r) => (r.document_type_slug ? docTypeName(docTypeOpts, r.document_type_slug) : categoryLabel(r.category)), type: "text" },
      trigger: { get: (r) => (r.trigger_action ? triggerLabel(r.trigger_action) : null), type: "text" },
      subject: { get: (r) => r.subject, type: "text" },
      status: { get: (r) => (r.active ? 0 : 1), type: "number" },
    },
    { userId: session?.user?.id ?? null, default: { key: "name", dir: "asc" } }
  );
  const shownSorted = tplSort.sortRows(shown);

  async function toggleActive(r: MailTemplate) {
    if (!canManage) return;
    const { error } = await supabase.from("mail_templates").update({ active: !r.active }).eq("id", r.id);
    if (error) setErr(error.message); else load();
  }
  async function duplicate(r: MailTemplate) {
    if (!canManage) return;
    const { error } = await supabase.from("mail_templates").insert({
      name: `${r.name} (Kopie)`, context: r.context, subject: r.subject,
      body_html: r.body_html, description: r.description, sort_order: nextSort, active: r.active,
      category: r.category, document_type_slug: r.document_type_slug, document_type_id: r.document_type_id,
      doc_variant: r.doc_variant, trigger_action: r.trigger_action, is_default: false,
    });
    if (error) setErr(error.message); else load();
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("mail_templates").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); }
  }

  return (
    <div className="glass p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><Mail size={18} /> Mailvorlagen</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Wiederverwendbare E-Mail-Vorlagen mit Platzhaltern – Grundlage für die spätere Mail-Automatisierung.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={18} /> Mailvorlage</button>}
        </div>
      </div>

      {/* Such- und Filterleiste */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Name, Betreff, Inhalt suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="">Alle Bereiche / Dokumentarten</option>
          <optgroup label="Dokumentart">
            {docTypeOpts.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
          </optgroup>
          <optgroup label="Bereich">
            {MAIL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </optgroup>
        </select>
        <select className="input w-auto" value={fTrigger} onChange={(e) => setFTrigger(e.target.value)}>
          <option value="">Alle Auslöser</option>
          {MAIL_TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="input w-auto" value={fStatus} onChange={(e) => setFStatus(e.target.value as any)}>
          <option value="active">Aktiv</option>
          <option value="inactive">Inaktiv</option>
          <option value="">Alle Status</option>
        </select>
      </div>

      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Mailvorlagen" hint="Lege deine erste Vorlage an – z.B. „Angebot senden“ oder „Zahlungserinnerung“." />
      ) : shown.length === 0 ? (
        <Empty title="Keine Treffer" hint="Suche oder Filter anpassen." />
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader label="Name" sortKey="name" sort={tplSort.sort} onSort={tplSort.onSort} />
                <SortHeader label="Dokumentart / Bereich" sortKey="docType" sort={tplSort.sort} onSort={tplSort.onSort} />
                <SortHeader label="Auslöser" sortKey="trigger" sort={tplSort.sort} onSort={tplSort.onSort} />
                <SortHeader label="Betreff" sortKey="subject" sort={tplSort.sort} onSort={tplSort.onSort} />
                <SortHeader label="Status" sortKey="status" sort={tplSort.sort} onSort={tplSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((r) => (
                <tr
                  key={r.id}
                  className={`hover:bg-slate-50 dark:hover:bg-white/5 ${canManage ? "cursor-pointer" : ""}`}
                  onClick={canManage ? () => setEdit(r) : undefined}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    {r.description && <div className="line-clamp-1 max-w-xs text-xs text-slate-400">{r.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {r.document_type_slug
                      ? <Badge tone="blue">{docTypeName(docTypeOpts, r.document_type_slug)}{r.doc_variant ? ` · ${r.doc_variant}` : ""}</Badge>
                      : <Badge tone="slate">{categoryLabel(r.category)}</Badge>}
                    {r.is_default && <span className="ml-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">Standard</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.trigger_action ? <span className="text-xs">{triggerLabel(r.trigger_action)}</span> : <span className="text-slate-400">–</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="line-clamp-1 max-w-md">{r.subject || <span className="text-slate-400">–</span>}</div>
                    {r.body_html && <div className="line-clamp-1 max-w-md text-xs text-slate-400">{stripHtml(r.body_html)}</div>}
                  </td>
                  <td className="px-4 py-3">{r.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  {/* Aktionsspalte: eigene Buttons – Klick darf nicht die Zeile öffnen */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title={r.active ? "Deaktivieren" : "Aktivieren"} disabled={!canManage} onClick={() => toggleActive(r)}><Power size={16} /></button>
                      <button className="btn-ghost px-2" title="Duplizieren" disabled={!canManage} onClick={() => duplicate(r)}><Copy size={16} /></button>
                      <button className="btn-ghost px-2" title="Bearbeiten" disabled={!canManage} onClick={() => setEdit(r)}><Pencil size={16} /></button>
                      <button className="btn-ghost px-2 text-rose-500" title="Löschen" disabled={!canManage} onClick={() => setDel(r)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <MailTemplateForm
          row={edit === "new" ? null : edit}
          nextSort={nextSort}
          docTypeOpts={docTypeOpts}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
      <ConfirmDialog
        open={!!del}
        title="Mailvorlage löschen?"
        message={<>Soll die Vorlage <b>{del?.name}</b> dauerhaft gelöscht werden?</>}
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDel(null)}
      />
    </div>
  );
}

// ============================================================
// Betreff-Eingabe mit Platzhalter-Einfügung am Cursor
// ============================================================
function SubjectInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function insertToken(token: string) {
    const el = inputRef.current;
    if (!el) { onChange(value + token); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Cursor hinter den eingefügten Token setzen (nach dem Re-Render).
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="flex items-stretch gap-2">
      <input ref={inputRef} className="input flex-1" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="z.B. Ihr Angebot für {{Project.address}}" />
      <div className="flex items-center rounded-xl border px-1" style={{ borderColor: "var(--border)" }}>
        <PlaceholderMenu groups={MAIL_PLACEHOLDER_CATALOG} onInsert={insertToken} />
      </div>
    </div>
  );
}

// ============================================================
// Formular: Mailvorlage erstellen / bearbeiten
// ============================================================
function MailTemplateForm({ row, nextSort, docTypeOpts, onClose, onSaved }: {
  row: MailTemplate | null; nextSort: number; docTypeOpts: DocTypeOption[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: row?.name ?? "",
    category: (row?.category ?? "dokument") as string,
    document_type_slug: row?.document_type_slug ?? "",
    doc_variant: row?.doc_variant ?? "",
    trigger_action: row?.trigger_action ?? "",
    subject: row?.subject ?? "",
    body_html: row?.body_html ?? "",
    description: row?.description ?? "",
    sort_order: row?.sort_order ?? nextSort,
    active: row?.active ?? true,
    is_default: row?.is_default ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  const isDoc = f.category === "dokument";
  const allowedTriggers = triggersForDocType(f.document_type_slug || null);

  async function save() {
    setErr(null);
    if (!f.name.trim()) { setErr("Bitte einen Namen für die Vorlage eingeben."); return; }
    if (isDoc && !f.document_type_slug) { setErr("Bitte eine Dokumentart wählen (oder Kategorie ändern)."); return; }
    setBusy(true);
    const slug = isDoc ? (f.document_type_slug || null) : null;
    const trigger = f.trigger_action || null;
    const opt = docTypeOpts.find((d) => d.slug === slug);
    const payload = {
      name: f.name.trim(),
      category: f.category,
      document_type_slug: slug,
      document_type_id: opt?.id ?? null,
      doc_variant: isDoc ? (f.doc_variant || null) : null,
      trigger_action: trigger,
      context: deriveContext(f.category, slug, trigger), // Legacy-Spalte konsistent halten
      subject: f.subject,
      body_html: f.body_html,
      description: f.description.trim() || null,
      sort_order: Number(f.sort_order) || 0,
      active: f.active,
      is_default: f.is_default,
    };
    const res = row
      ? await supabase.from("mail_templates").update(payload).eq("id", row.id)
      : await supabase.from("mail_templates").insert(payload);
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={row ? "Mailvorlage bearbeiten" : "Neue Mailvorlage"} size="xl">
      <ErrorBanner message={err} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label label-req">Name der Vorlage</label>
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="z.B. Angebot senden" />
        </div>
        <div>
          <label className="label">Kategorie / Bereich</label>
          <select className="input" value={f.category} onChange={(e) => set("category", e.target.value)}>
            {MAIL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        {isDoc ? (
          <div>
            <label className="label label-req">Dokumentart</label>
            <select className="input" value={f.document_type_slug} onChange={(e) => { set("document_type_slug", e.target.value); set("trigger_action", ""); }}>
              <option value="">– wählen –</option>
              {docTypeOpts.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className="label">Sortierreihenfolge</label>
            <input type="number" className="input" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} />
          </div>
        )}
        {isDoc && (
          <div>
            <label className="label">Auslöser / Aktion</label>
            <select className="input" value={f.trigger_action} onChange={(e) => set("trigger_action", e.target.value)}>
              <option value="">– kein bestimmter –</option>
              {allowedTriggers.map((k) => {
                const t = MAIL_TRIGGERS.find((x) => x.key === k);
                return <option key={k} value={k}>{t?.label ?? k}</option>;
              })}
            </select>
          </div>
        )}
        {isDoc && (
          <div>
            <label className="label">Variante (optional)</label>
            <select className="input" value={f.doc_variant} onChange={(e) => set("doc_variant", e.target.value)}>
              {DOC_VARIANTS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </div>
        )}
        {isDoc && (
          <div>
            <label className="label">Sortierreihenfolge</label>
            <input type="number" className="input" value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="label">Betreff</label>
          <SubjectInput value={f.subject} onChange={(v) => set("subject", v)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">E-Mail-Text</label>
          <RichTextEditor value={f.body_html} onChange={(v) => set("body_html", v)} minHeight={220}
            placeholders={MAIL_PLACEHOLDER_CATALOG} placeholder="E-Mail-Text eingeben …" />
          <p className="mt-1 text-xs text-slate-400">Platzhalter über die Schaltfläche „Platzhalter" einfügen – sie werden beim Versand automatisch ersetzt.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Beschreibung / interne Notiz (optional)</label>
          <textarea className="input min-h-[60px]" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Nur intern sichtbar." />
        </div>
        <div className="flex flex-wrap items-center gap-5 pb-1 sm:col-span-2">
          <Toggle checked={f.active} onChange={(v) => set("active", v)} label="Aktiv" />
          {isDoc && (
            <Toggle checked={f.is_default} onChange={(v) => set("is_default", v)}
              label="Standardvorlage (zuerst vorschlagen)" />
          )}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? "Speichern …" : "Speichern"}</button>
      </div>
    </Modal>
  );
}
